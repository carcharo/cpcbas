#!/usr/bin/env python3
"""Unit tests of tools/loco-diff.py's normaliser and the real rule (stdlib unittest; development
tooling, not part of `npm test`, no emulator needed). Run: python3 tools/test_loco_diff.py
"""
import importlib.util
import json
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("loco_diff", HERE / "loco-diff.py")
ld = importlib.util.module_from_spec(_spec)
sys.modules["loco_diff"] = ld
_spec.loader.exec_module(ld)


class Normalise(unittest.TestCase):
    def test_marker_ready_and_timing(self):
        self.assertEqual(ld.normalise("a\r\n~123\r\nReady\x04END\njunk"), "a\n~\n")
        self.assertIsNone(ld.normalise("no marker"))


class CompareRule(unittest.TestCase):
    def test_real_exact_is_exact_in_firmware_and_8_digits_in_bare(self):
        # tests/loco/compare.json (FWM-CORE): the firmware's maths are the interpreter's own
        self.assertEqual(ld.compare_rule("real-arith"), "exact")
        self.assertEqual(ld.compare_rule("real-arith", bare=True), "real")
        self.assertEqual(ld.compare_rule("hello"), "exact")
        self.assertEqual(ld.compare_rule("hello", bare=True), "exact")


class RealRule(unittest.TestCase):
    def test_numbers_agree_to_8_digits(self):
        self.assertTrue(ld.numbers_agree("0.333333333", "0.333333334"))
        self.assertTrue(ld.numbers_agree("3.14159265", "3.14159266"))
        self.assertTrue(ld.numbers_agree("1E+10", "1.00000E+10"))
        self.assertTrue(ld.numbers_agree("-2.5", "-2.5"))
        self.assertTrue(ld.numbers_agree("0", "0"))
        self.assertFalse(ld.numbers_agree("3.1415926", "3.1415928"))  # two units in the 8th digit
        self.assertFalse(ld.numbers_agree("1.23457E+12", "1.23458E+12"))
        self.assertFalse(ld.numbers_agree("2", "-2"))
        self.assertFalse(ld.numbers_agree("0", "0.0000001"))

    def test_lines(self):
        self.assertTrue(ld.lines_match(" 0.333333333  1.41421356 ", " 0.333333334  1.41421357 ", "real"))
        self.assertTrue(ld.lines_match("x= 0.142857143 ", "x= 0.142857142 ", "real"))
        # text between the numbers must be identical: spacing, letters, sign position
        self.assertFalse(ld.lines_match(" 0.5  1 ", " 0.5 1 ", "real"))
        self.assertFalse(ld.lines_match("a 1 ", "b 1 ", "real"))
        self.assertFalse(ld.lines_match(" 1 ", "-1 ", "real"))
        self.assertFalse(ld.lines_match(" 1  2 ", " 1 ", "real"))
        # the exact rule does not tolerate a digit
        self.assertFalse(ld.lines_match(" 0.333333333 ", " 0.333333334 ", "exact"))

    def test_transcripts(self):
        want = " 0.333333333 \n 1.5|-2.5\n"
        self.assertTrue(ld.transcripts_match(want, " 0.333333334 \n 1.5|-2.5\n", "real"))
        self.assertFalse(ld.transcripts_match(want, " 0.333333334 \n 1.5|-2.5\n", "exact"))
        self.assertFalse(ld.transcripts_match(want, " 0.333333334 \n", "real"))
        self.assertFalse(ld.transcripts_match(want, want + "extra\n", "real"))
        self.assertIn("line 2", ld.first_difference(want, " 0.333333334 \n 1.5|-2.6\n", "real"))

    def test_real_basic_is_real_exact(self):
        self.assertEqual(ld.compare_rule("real-basic"), "exact")
        self.assertEqual(ld.compare_rule("real-basic", bare=True), "real")
        self.assertEqual(ld.compare_rule("hello"), "exact")


class Headers(unittest.TestCase):
    def test_none(self):
        h = ld.parse_headers("10 PRINT 1\n20 REM an ordinary remark\n")
        self.assertEqual((h.shot, h.typed, h.disk), (False, [], []))

    def test_shot_numbered_or_not_any_case(self):
        self.assertTrue(ld.parse_headers("10 REM LOCO: shot\n20 MODE 1: PLOT 100,100\n").shot)
        self.assertTrue(ld.parse_headers("rem loco: SHOT").shot)
        self.assertTrue(ld.parse_headers("10 'LOCO: shot").shot)

    def test_unknown_flag(self):
        with self.assertRaises(ld.HeaderError):
            ld.parse_headers("10 REM LOCO: shoot\n")

    def test_type_entries(self):
        h = ld.parse_headers("10 REM LOCO-TYPE: hello|wor ld||x\n20 REM LOCO-TYPE: more\n")
        self.assertEqual(h.typed, ["hello", "wor ld", "", "x", "more"])

    def test_disk(self):
        h = ld.parse_headers("10 REM LOCO-DISK: data.txt=files/in.txt\n20 REM LOCO-DISK: B.DAT=/abs/b.dat\n", Path("/p/q"))
        self.assertEqual(h.disk, [("DATA.TXT", Path("/p/q/files/in.txt")), ("B.DAT", Path("/abs/b.dat"))])

    def test_default_emulator(self):
        # R13: CPCEC unless the program types keys (Caprice32); --emu forces one
        plain, typing = ld.parse_headers("10 PRINT 1\n"), ld.parse_headers("10 REM LOCO-TYPE: a\n")
        self.assertEqual((ld.pick_emu(None, plain), ld.pick_emu(None, typing)), ("cpcec", "cap32"))
        self.assertEqual((ld.pick_emu("cap32", plain), ld.pick_emu("cpcec", typing)), ("cap32", "cpcec"))

    def test_cap32_flag(self):
        # L4-FILES: a program that writes a file needs Caprice32 (CPCEC's disc is write protected)
        writing = ld.parse_headers("10 REM LOCO: cap32\n20 OPENOUT \"A.TXT\"\n")
        self.assertTrue(writing.cap32)
        self.assertFalse(ld.parse_headers("10 REM LOCO: shot\n").cap32)
        self.assertEqual(ld.pick_emu(None, writing), "cap32")
        self.assertEqual(ld.pick_emu("cpcec", writing), "cpcec")
        both = ld.parse_headers("10 REM LOCO: shot, cap32\n")
        self.assertTrue(both.shot and both.cap32)

    def test_disk_errors(self):
        for bad in ("REM LOCO-DISK: NOEQUALS", "REM LOCO-DISK: TOOLONGNAME.TXT=a", "REM LOCO-DISK: A.TOOLONG=a", "REM LOCO-DISK: =a",
                    "REM LOCO-DISK: A B=a", "REM LOCO-DISK: A.B="):
            with self.assertRaises(ld.HeaderError, msg=bad):
                ld.parse_headers(bad)

    def test_headers_of_a_real_program(self):
        h = ld.headers_of(ld.LOCO / "shot-plot.bas")
        self.assertTrue(h.shot)
        self.assertEqual(ld.headers_of(ld.LOCO / "hello.bas").shot, False)


def png_of(rows, w=None):
    """A test PNG (RGB, filter 0) from rows of (r, g, b) tuples."""
    w = w or len(rows[0])
    return ld.write_png(w, len(rows), [bytes(v for px in r for v in px) for r in rows])


BLUE, YELLOW = (0, 0, 160), (255, 255, 0)


class Shots(unittest.TestCase):
    def test_roundtrip(self):
        rows = [[BLUE, YELLOW, BLUE], [YELLOW, BLUE, YELLOW]]
        w, h, back = ld.read_png(png_of(rows))
        self.assertEqual((w, h), (3, 2))
        self.assertEqual(back[1], bytes(YELLOW + BLUE + YELLOW))

    def test_equal_shots(self):
        a = png_of([[BLUE] * 8] * 4)
        self.assertEqual(ld.compare_shots(a, png_of([[BLUE] * 8] * 4)), (True, "", None))

    def test_a_changed_pixel_fails_and_makes_a_diff_image(self):
        base = [[BLUE] * 8 for _ in range(4)]
        changed = [list(r) for r in base]
        changed[2][5] = YELLOW  # one pixel
        equal, detail, diff = ld.compare_shots(png_of(base), png_of(changed))
        self.assertFalse(equal)
        self.assertIn("1 pixels differ", detail)
        self.assertIn("x=5, y=2", detail)
        w, h, rows = ld.read_png(diff)
        self.assertEqual((w, h), (8, 4))
        self.assertEqual(rows[2][5 * 3:5 * 3 + 3], b"\xff\x00\x00")  # the differing pixel is red
        self.assertEqual(rows[0][:3], bytes(v >> 2 for v in BLUE))  # the rest is dimmed
        self.assertEqual(sum(1 for y in range(4) for x in range(8) if rows[y][x * 3:x * 3 + 3] == b"\xff\x00\x00"), 1)

    def test_colour_change_of_every_pixel(self):
        equal, detail, _ = ld.compare_shots(png_of([[BLUE] * 3] * 2), png_of([[YELLOW] * 3] * 2))
        self.assertFalse(equal)
        self.assertIn("6 pixels differ", detail)

    def test_size_mismatch(self):
        equal, detail, diff = ld.compare_shots(png_of([[BLUE] * 4] * 2), png_of([[BLUE] * 4] * 3))
        self.assertFalse(equal)
        self.assertIn("sizes differ", detail)
        self.assertIsNone(diff)

    def test_png_filters(self):
        # a 2x3 RGB PNG written with filters Sub (1), Up (2) and Paeth (4): the reader undoes them
        pix = [bytes([10, 20, 30, 40, 50, 60]), bytes([11, 22, 33, 44, 55, 66]), bytes([12, 24, 36, 48, 60, 72])]
        def paeth(a, b, c):
            pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
            return a if pa <= pb and pa <= pc else b if pb <= pc else c
        raw = b""
        prev = bytes(6)
        for ft, row in zip((1, 2, 4), pix):
            enc = bytearray()
            for i, v in enumerate(row):
                a = row[i - 3] if i >= 3 else 0
                b = prev[i]
                c = prev[i - 3] if i >= 3 else 0
                enc.append((v - (a if ft == 1 else b if ft == 2 else paeth(a, b, c))) & 255)
            raw += bytes([ft]) + bytes(enc)
            prev = row
        def chunk(k, b):
            return struct.pack(">I", len(b)) + k + b + struct.pack(">I", zlib.crc32(k + b))
        data = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 2, 3, 8, 2, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
        self.assertEqual(ld.read_png(data)[2], pix)

    def test_not_a_png(self):
        with self.assertRaises(ValueError):
            ld.read_png(b"GIF89a")


class BareGate(unittest.TestCase):
    """Follow-up 68: tests/loco/compare.json's lists and the dump strip."""

    def test_lists_in_compare_json(self):
        self.assertIn("firmware", ld.bare_skip_reason("int-memory"))
        self.assertIn("xorshift", ld.bare_skip_reason("real-rnd"))
        self.assertIsNone(ld.bare_skip_reason("hello"))
        stop = ld.bare_stop("real-round")
        self.assertEqual((stop["rows"], stop["error"]), (51, "Error 6"))  # Locomotive Overflow since L4-ERR (follow-up 21)
        self.assertIsNone(ld.bare_stop("hello"))

    def test_the_blessed_programs_all_have_a_reason(self):
        rules = ld.load_rules()
        blessed = json.loads((ld.LOCO / "blessed.json").read_text())
        for key in ("bare-skip", "bare-stop", "compiled-skip"):
            for name, why in rules.get(key, {}).items():
                self.assertIn(name, blessed, f"{key}: {name}")
                self.assertTrue(why if isinstance(why, str) else why["reason"], f"{key}: {name} has no reason")

    def test_dump_strip_on_a_wrapped_dump(self):
        # the screen wrapped the dump at column 40: ":12EBDF5B" then "7F" on the next line (real-fn line 223)
        wrapped = "x= 1234.5678  SIN 0.429442736 :12EBDF5B\n7F\nnext\n"
        whole = "x= 1234.5678  SIN 0.429442736 :12EBDF5B7F\nnext\n"
        self.assertEqual(ld.DUMP.sub("", wrapped), "x= 1234.5678  SIN 0.429442736\nnext\n")
        self.assertEqual(ld.DUMP.sub("", whole), "x= 1234.5678  SIN 0.429442736\nnext\n")
        # a wrapped dump in one transcript and a whole one in the other agree after the strip
        self.assertTrue(ld.transcripts_match(ld.DUMP.sub("", wrapped), ld.DUMP.sub("", whole), "real"))

    def test_dump_strip_leaves_an_empty_dump_and_the_next_line_alone(self):
        text = " 0.49  0  0 :\n 1234.5678 -2  1200 :000000168B\n"
        self.assertEqual(ld.DUMP.sub("", text), " 0.49  0  0 :\n 1234.5678 -2  1200\n")
        self.assertEqual(ld.DUMP.sub("", "a :\nABCDEF0123 next\n"), "a :\nABCDEF0123 next\n")  # no dump: ':' ends the line

    def test_bare_stop_text(self):
        stop = {"error": "Error 5", "rows": 2}
        self.assertEqual(ld.bare_stop_text("a 1\r\nb 2\r\n\r\nError 5", stop), "a 1\nb 2\n")
        self.assertIsNone(ld.bare_stop_text("a 1\nb 2\n", stop))

    def test_status_codes_with_skips(self):
        self.assertEqual(ld.worst_code(["pass", "skipped"]), 0)
        self.assertEqual(ld.worst_code(["skipped", "fail"]), 3)
        self.assertEqual(ld.worst_code(["skipped", "not-compiled"]), 5)


class HarnessBuild(unittest.TestCase):
    """The disc builder (needs `npm run build`; skipped without it)."""

    def build(self, *extra):
        if not (ld.REPO / "packages" / "cpcbas" / "dist" / "src" / "asm" / "index.js").is_file():
            self.skipTest("npm run build first")
        d = tempfile.TemporaryDirectory()
        self.addCleanup(d.cleanup)
        bas, dsk = Path(d.name) / "p.bas", Path(d.name) / "o.dsk"
        bas.write_text("10 PRINT 1\n")
        (Path(d.name) / "data.txt").write_bytes(b"hello\r\n")
        p = subprocess.run(["node", str(ld.REPO / "tools" / "loco-harness" / "build.mjs"), "--bas", str(bas), "--dsk", str(dsk),
                            *[a.replace("@", d.name) for a in extra]], capture_output=True, text=True)
        return p, dsk

    def test_disc_files(self):
        p, dsk = self.build("--file", "DATA.TXT=@/data.txt")
        self.assertEqual(p.returncode, 0, p.stderr)
        data = dsk.read_bytes()
        self.assertIn(b"DATA    TXT", data)  # the directory entry
        self.assertIn(b"hello\r\n", data)

    def test_bad_file_spec(self):
        p, _ = self.build("--file", "NOEQUALS")
        self.assertEqual(p.returncode, 2)

    def test_shot_hook_assembles_and_is_longer(self):
        plain, _ = self.build()
        shot, _ = self.build("--shot")
        self.assertEqual(shot.returncode, 0, shot.stderr)
        self.assertGreater(json.loads(shot.stdout)["length"], json.loads(plain.stdout)["length"])


class OptFlag(unittest.TestCase):
    """--opt L: the compiled side is built with `-O L`; nothing else about the build changes (L5-DIFF)."""

    class FakeRun:
        def __init__(self):
            self.cmds = []

        def __call__(self, cmd, **kw):
            self.cmds.append(cmd)
            Path(cmd[cmd.index("-o") + 1]).write_bytes(b"dsk")
            return subprocess.CompletedProcess(cmd, 0, "", "")

    class FakeCpcrun:
        @staticmethod
        def amsdos_stem(bas):
            return "T"

    def build(self, opt):
        saved, ld.OPT = ld.OPT, opt
        fake = self.FakeRun()
        real, subprocess.run = subprocess.run, fake
        try:
            with tempfile.TemporaryDirectory() as t:
                bas = Path(t) / "p.bas"
                bas.write_text("10 PRINT 1\n")
                tmp = Path(t) / "out"
                tmp.mkdir()
                ld.build_compiled(self.FakeCpcrun, bas, tmp)
        finally:
            subprocess.run, ld.OPT = real, saved
        return fake.cmds[0]

    def test_default_has_no_level(self):
        self.assertNotIn("-O", self.build(None))

    def test_each_level_is_passed_to_the_cli(self):
        for level in ld.OPT_LEVELS:
            cmd = self.build(level)
            self.assertEqual(cmd[cmd.index("-O") + 1], level)
            self.assertIn("__CPC_PRINTER_ECHO__", cmd)

    def test_levels(self):
        self.assertEqual(ld.OPT_LEVELS, ("0", "1", "2", "3", "s"))

    def test_the_command_line_sets_the_level(self):
        """R18: main() assigned OPT as a local, so `--opt L` built at the CLI's default level (-O2)."""
        seen = {}
        saved = (ld.OPT, ld.load_cpcrun, ld.compiled_one, sys.argv)
        ld.load_cpcrun = lambda cpcbuild: None
        ld.compiled_one = lambda *a, **k: seen.setdefault("opt", ld.OPT) and 0
        sys.argv = ["loco-diff.py", "--compiled", str(HERE / "loco-diff.py"), "--opt", "1"]
        try:
            ld.main()
        finally:
            ld.OPT, ld.load_cpcrun, ld.compiled_one, sys.argv = saved
        self.assertEqual(seen.get("opt"), "1")

if __name__ == "__main__":
    unittest.main()
