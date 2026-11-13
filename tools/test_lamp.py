#!/usr/bin/env python3
"""Unit tests of tools/lamp.py: the memory checks, the image comparison, the transcript and bench readers, the job
plan, and (when the CLI is built) the loader assembled and the discs packed by `cpcbas asm` and `cpcbas dsk`. No emulator runs
here (stdlib unittest; development tooling, not part of `npm test`). Run: python3 tools/test_lamp.py
"""
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("lamp", HERE / "lamp.py")
lamp = importlib.util.module_from_spec(_spec)
sys.modules["lamp"] = lamp
_spec.loader.exec_module(lamp)


def header(length: int) -> bytes:
    h = bytearray(128)
    h[24], h[25] = length & 255, length >> 8
    return bytes(h)


class Memory(unittest.TestCase):
    def test_strip_amsdos(self):
        self.assertEqual(lamp.strip_amsdos(header(3) + b"abc"), b"abc")
        with self.assertRaises(ValueError):
            lamp.strip_amsdos(header(4) + b"abc")
        with self.assertRaises(ValueError):
            lamp.strip_amsdos(b"short")

    def test_firmware_end_against_the_heap(self):
        self.assertEqual(lamp.HEAP_START, 0x8B60)
        self.assertIsNone(lamp.check_firmware_end("x", 0x8B60))
        self.assertIn("above the heap", lamp.check_firmware_end("x", 0x8B61))

    def test_plus_end_against_the_buffer_below_the_loader(self):
        # question 4: the loader at &9E00 with the 2 KB AMSDOS buffer below it
        self.assertEqual(lamp.LOADER_ORG - lamp.AMSDOS_BUFFER, 0x800)
        self.assertIsNone(lamp.check_plus_end("x", 0x87A0))
        # above the heap but below the buffer: the compiler's own E402 catches the heap, this check the buffer
        self.assertIn("AMSDOS buffer", lamp.check_plus_end("x", 0x9601))


class Reading(unittest.TestCase):
    def test_parse_info_locomotive_spacing(self):
        # cpcbas prints numbers the Locomotive way and wraps at 40 columns; the fork does not
        loco = "INFO steps= 250 \n frames= 503 \n per second= 24 . 9  late= 8  longest=\n 3 \n"
        fork = "INFO steps=250 frames=499 per second=25.1 late=9 longest=3\n"
        self.assertEqual(lamp.parse_info(loco), "steps=250 frames=503 per second=24.9 late=8 longest=3")
        self.assertEqual(lamp.parse_info(fork), "steps=250 frames=499 per second=25.1 late=9 longest=3")
        self.assertIsNone(lamp.parse_info("nothing"))

    def test_fork_rows_are_recorded_history(self):
        head, rows = lamp.fork_rows()
        self.assertIn("recorded 2026-11-12", head)
        self.assertEqual(len(rows), 10)
        self.assertEqual(rows["chips 464 default"], "steps=250 frames=499 per second=25.1 late=9 longest=3")
        for label, line in rows.items():
            self.assertEqual(lamp.parse_info("INFO " + line.replace(" ", "")), line, label)

    def test_bench_never_builds_with_the_fork(self):
        """follow-up 224: `bench --fork` prints the recorded rows and runs only cpcbas; no zxbc argument is passed."""
        import argparse
        import contextlib
        import io

        built = []
        saved = (lamp.bench_chips, lamp.bench_plus_cpcec, lamp.subprocess.run)
        lamp.bench_chips = lambda model, extra: built.append(("chips", model, tuple(extra))) or "steps=250 frames=1 per second=1.0 late=0 longest=1"
        lamp.bench_plus_cpcec = lambda variant, extra: built.append(("plus", variant, tuple(extra))) or "steps=250 frames=1 per second=1.0 late=0 longest=1"
        lamp.subprocess.run = lambda *a, **k: self.fail("bench started a process")
        try:
            for plus in (False, True):
                out = io.StringIO()
                with contextlib.redirect_stdout(out):
                    self.assertEqual(lamp.cmd_bench(argparse.Namespace(plus=plus, fork=True)), 0)
                text = out.getvalue()
                self.assertEqual(text.count(" fork* "), 6 if not plus else 4)
                self.assertEqual(text.count(" cpcbas "), 6 if not plus else 4)
                self.assertIn("* fork rows: recorded 2026-11-12", text)
                self.assertIn("steps=250 frames=499 per second=25.1 late=" + ("2" if plus else "9"), text)
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                lamp.cmd_bench(argparse.Namespace(plus=False, fork=False))
            self.assertNotIn("fork", out.getvalue())
        finally:
            lamp.bench_chips, lamp.bench_plus_cpcec, lamp.subprocess.run = saved
        self.assertNotIn("zxbc-arg", (HERE / "lamp.py").read_text())

    def test_transcript(self):
        self.assertEqual(lamp.check_transcript("t", "PASS a\nPASS b\nDONE\n")[0][0], "PASS")
        self.assertEqual(lamp.check_transcript("t", "PASS a\nFAIL b\nDONE\n")[0][0], "FAIL")
        self.assertEqual(lamp.check_transcript("t", "PASS a\n")[0][0], "FAIL")
        self.assertEqual(lamp.check_transcript("t", "PASS won\nDONE\n", ("won", "x"))[0][0], "FAIL")

    def test_shot_defs(self):
        self.assertEqual(lamp.shot_defs("room07", lamp.SCENES), ["SHOT=3", "START_ROOM=7"])
        self.assertIn("SHOT_LIT", lamp.shot_defs("lit09", lamp.SCENES))
        self.assertIn("lit09b", lamp.PLUS_SCENES)
        self.assertNotIn("lit09b", lamp.SCENES)


class Pictures(unittest.TestCase):
    def test_compare(self):
        from PIL import Image

        with tempfile.TemporaryDirectory() as t:
            gold = Path(t) / "g" / "room.png"
            gold.parent.mkdir()
            a = Image.new("RGB", (8, 8), (10, 20, 30))
            self.assertEqual(lamp.compare(a, gold, "x")[0][0], "FAIL")  # no golden
            a.save(gold)
            self.assertEqual(lamp.compare(a, gold, "x")[0][0], "PASS")
            b = a.copy()
            b.putpixel((1, 1), (255, 0, 0))
            r = lamp.compare(b, gold, "x")[0]
            self.assertEqual(r[0], "FAIL")
            self.assertIn("1 pixels differ", r[2])
            self.assertTrue(gold.with_suffix(".diff.png").exists())
            self.assertEqual(lamp.compare(Image.new("RGB", (4, 4)), gold, "x")[0][0], "FAIL")  # size


class Plan(unittest.TestCase):
    def test_chips_jobs(self):
        names = [n for n, _ in lamp.chips_jobs(["464"], 60, False)]
        self.assertEqual(len(names), 27)  # 2 logic, 2 LAMP_BASIC, 12 rooms, 5 scenes, 5 switches, autoplay
        self.assertIn("464/autoplay", names)
        self.assertEqual(len([n for n, _ in lamp.chips_jobs(["6128"], 60, False)]), 20)

    def test_bless_makes_only_autoplay_jobs(self):
        self.assertEqual([n for n, _ in lamp.chips_jobs(["464", "6128"], 60, True)], ["464/autoplay", "6128/autoplay"])
        names = [n for n, _ in lamp.plus_jobs(["cap32"], ["disc", "cart"], 60, True)]
        self.assertEqual(names, ["cap32/disc/autoplay", "cap32/cart/autoplay"])

    def test_plus_jobs(self):
        # per emulator and variant: 3 programs, 12 rooms, 6 scenes, autoplay
        self.assertEqual(len(lamp.plus_jobs(["cap32", "cpcec"], ["disc", "cart"], 60, False)), 4 * 22)


class OptFlag(unittest.TestCase):
    """--opt L (L5-MEASURE): every cpcbas compile gets `-O L`; no flag, no -O."""

    def setUp(self):
        self.old = lamp.OPT
        self.cmds = []
        self.real_run = lamp.subprocess.run

        def fake(cmd, **kw):
            self.cmds.append(cmd)
            Path(cmd[cmd.index("-o") + 1]).write_bytes(b"x")
            return lamp.subprocess.CompletedProcess(cmd, 0, "", "")
        lamp.subprocess.run = fake

    def tearDown(self):
        lamp.OPT = self.old
        lamp.subprocess.run = self.real_run

    def test_levels(self):
        self.assertEqual(lamp.OPT_LEVELS, ("0", "1", "2", "3", "s"))

    def test_no_flag_no_level(self):
        lamp.OPT = None
        self.assertEqual(lamp.opt_args(), [])
        with tempfile.TemporaryDirectory() as t:
            lamp.compile_cli(Path("a.bas"), Path(t) / "o.bin", [])
        self.assertNotIn("-O", self.cmds[0])

    def test_level_reaches_the_compile(self):
        for lv in lamp.OPT_LEVELS:
            lamp.OPT = lv
            with tempfile.TemporaryDirectory() as t:
                lamp.compile_cli(Path("a.bas"), Path(t) / "o.bin", ["X"], extra=["-M", "m"])
            cmd = self.cmds[-1]
            self.assertEqual(cmd[cmd.index("-O") + 1], lv)

    def test_parser_takes_the_flag_on_every_subcommand(self):
        calls = []
        for name in ("cmd_build", "cmd_bench", "cmd_test"):
            setattr(self, "_o" + name, getattr(lamp, name))
            setattr(lamp, name, lambda a, n=name: calls.append((n, lamp.OPT)) or 0)
        try:
            lamp.main(["--opt", "2"])
            lamp.main(["build", "--opt", "s"])
            lamp.main(["bench", "--opt", "1"])
            lamp.main(["test", "--opt", "3"])
            lamp.main(["bench"])
        finally:
            for name in ("cmd_build", "cmd_bench", "cmd_test"):
                setattr(lamp, name, getattr(self, "_o" + name))
        self.assertEqual(calls, [("cmd_test", "2"), ("cmd_build", "s"), ("cmd_bench", "1"), ("cmd_test", "3"), ("cmd_bench", None)])

    def test_test_options_before_or_after_the_subcommand(self):
        """R18: `--plus --emu cpcec test` ran chipsrun: the `test` subparser's defaults overwrote the top level's."""
        seen = []
        saved = lamp.cmd_test
        lamp.cmd_test = lambda a: seen.append((a.plus, a.emu, a.model, a.jobs)) or 0
        try:
            lamp.main(["--plus", "--emu", "cpcec", "--model", "6128", "test"])
            lamp.main(["test", "--plus", "--emu", "cpcec", "-j", "2"])
            lamp.main([])
        finally:
            lamp.cmd_test = saved
        self.assertEqual(seen, [(True, ["cpcec"], "6128", 4), (True, ["cpcec"], None, 2), (False, None, None, 4)])


@unittest.skipUnless(lamp.CLI.is_file(), "needs npm run build")
class Packing(unittest.TestCase):
    def test_loader_and_disc(self):
        with tempfile.TemporaryDirectory() as t:
            tmp = Path(t)
            loader = lamp.loader_image(tmp)
            self.assertEqual(loader[:3], bytes([0x21, 0x75, 0x9E]))  # ld hl, nameplus (inside the loader at &9E00)
            self.assertLess(len(loader), 256)
            self.assertLessEqual(lamp.LOADER_ORG + len(loader), 0xA600)
            self.assertIn(b"LAMPPLUS.BIN", loader)
            dsk = tmp / "t.dsk"
            lamp.pack_dsk(dsk, [("PLUS.BIN", loader, lamp.LOADER_ORG), ("LAMPPLUS.BIN", b"\x00" * 2000, lamp.ORG)], tmp)
            data = dsk.read_bytes()
            self.assertTrue(data.startswith(b"MV - CPCEMU Disk-File"))
            self.assertIn(b"PLUS    BIN", data)
            self.assertIn(b"LAMPPLUS", data)


class OptFlagParse(unittest.TestCase):
    """--opt L is read after the subcommand as well as before it, and adds `-O L` to every build (L5-DIFF)."""

    def parse(self, *argv):
        saved, saved_test = lamp.OPT, lamp.cmd_test
        try:
            lamp.cmd_test = lambda a: 0
            lamp.main(list(argv))
            return lamp.OPT
        finally:
            lamp.OPT, lamp.cmd_test = saved, saved_test

    def test_levels(self):
        self.assertIsNone(self.parse("test"))
        self.assertEqual(self.parse("test", "--opt", "2"), "2")
        self.assertEqual(self.parse("--opt", "s", "test"), "s")
        with self.assertRaises(SystemExit):
            self.parse("test", "--opt", "9")


if __name__ == "__main__":
    unittest.main()
