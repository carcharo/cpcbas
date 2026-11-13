#!/usr/bin/env python3
"""Unit tests of tools/size-diff.py's map and header reading (stdlib unittest; development tooling, not part of
`npm test`, no compiler needed). Run: python3 tools/test_size_diff.py
"""
import importlib.util
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("size_diff", HERE / "size-diff.py")
sd = importlib.util.module_from_spec(_spec)
sys.modules["size_diff"] = sd
_spec.loader.exec_module(sd)

MAP = """0040: .core.__START_PROGRAM
004D: ._i
004D: .core.ZXBASIC_USER_DATA
0053: .core.ZXBASIC_USER_DATA_END
0053: .core.__MAIN_PROGRAM__
0059: .T.0
0100: .core.__END_PROGRAM
0100: .L.proc
0120: .S.0
0130: .core.__MUL8
0130: .core.MUL8_FAST
0150: .core.__PRINTU8"""


class GameGroup(unittest.TestCase):
    def test_four_lamplighter_builds(self):
        ps = sd.programs(["game"], None)
        self.assertEqual([p["name"] for p in ps], ["lamp464", "lamp6128", "lampplus", "lamppluc"])
        self.assertEqual([p["mode"] for p in ps], ["firmware", "firmware", "firmware", "bare"])
        self.assertTrue(all(p["group"] == "game" and p["args"] == ["--org", "0x40"] for p in ps))
        self.assertEqual(ps[3]["defs"], ["PLUS", "CPC_OWNFONT"])  # the bare mode adds CPC_BAREMETAL itself
        self.assertEqual(ps[0]["fork"].parts[-3:], ("games", "lamplighter", "main.bas"))
        self.assertEqual(ps[0]["cpcbas"].parts[-4:], ("tests", "games", "lamplighter", "main.bas"))

    def test_not_in_the_default_groups(self):
        self.assertEqual([p for p in sd.programs(["forkdiff", "twin"], None) if p["group"] == "game"], [])


class Reading(unittest.TestCase):
    def test_parse_map(self):
        s = sd.parse_map(MAP)
        self.assertEqual(s[0], (0x40, ".core.__START_PROGRAM"))
        self.assertEqual(len(s), 12)

    def test_regions_and_free(self):
        r = sd.analyse(sd.parse_map(MAP), 0x40, 0x170 - 0x40, "firmware", 4768)
        self.assertEqual(r["regions"], {"startup": 0x0D, "data": 6, "main": 0x100 - 0x53, "program": 0x30, "runtime": 0x170 - 0x130, "library": 0})
        self.assertEqual(r["end"], 0x170)
        self.assertFalse(r["heap"])
        self.assertEqual(r["free"], 0x9E00 - 0x170)
        # sum of regions is the image
        self.assertEqual(sum(r["regions"].values()), r["image"])

    def test_heap_moves_the_limit(self):
        m = MAP + "\n0160: .core.__MEM_INIT"
        r = sd.analyse(sd.parse_map(m), 0x40, 0x170 - 0x40, "firmware", 4768)
        self.assertTrue(r["heap"])
        self.assertEqual(r["free"], 0x9E00 - 4768 - 0x170)
        b = sd.analyse(sd.parse_map(m), 0x40, 0x170 - 0x40, "bare", 1000)
        self.assertEqual(b["free"], 0xB800 - 1000 - 0x170)

    def test_missing_structural_label(self):
        with self.assertRaises(ValueError):
            sd.analyse([(0x40, ".core.__START_PROGRAM")], 0x40, 10, "firmware", 4768)

    def test_amsdos_header(self):
        h = bytearray(128)
        h[21], h[22] = 0x40, 0x00
        h[24], h[25] = 3, 0
        c = sum(h[:67])
        h[67], h[68] = c & 0xFF, c >> 8
        image, load = sd.strip_amsdos(bytes(h) + b"abc")
        self.assertEqual((image, load), (b"abc", 0x40))
        with self.assertRaises(ValueError):
            sd.strip_amsdos(bytes(h) + b"abcd")
        h[67] ^= 1
        with self.assertRaises(ValueError):
            sd.strip_amsdos(bytes(h) + b"abc")


# Lamplighter's shape: the player (.PLY_AKG_*, akg_cpc.asm) and the glue (.__MUSIC_*) are library asm. The fork links the player
# inside the main region, cpcbas after the first runtime routine; both have a procedure, a runtime routine and a string.
FORK_LAMP = """0040: .core.__START_PROGRAM
0040: .core.ZXBASIC_USER_DATA
0050: .core.ZXBASIC_USER_DATA_END
0050: .core.__MAIN_PROGRAM__
0053: .PLY_AKG_Start
0060: .PLY_AKG_Init
00A0: .__MUSIC_RUN
00B0: .LABEL.__LABEL0
00C0: .core.__END_PROGRAM
00C0: ._Draw
00C0: .LABEL.__LABEL1
00E0: .LABEL.__LABEL2
0100: .core.__PRINTU8
0120: .L32D7"""
CPCBAS_LAMP = """0040: .core.__START_PROGRAM
0040: .core.ZXBASIC_USER_DATA
0050: .core.ZXBASIC_USER_DATA_END
0050: .core.__MAIN_PROGRAM__
0053: .__MUSIC_RUN
0063: .T.0
0070: .core.__END_PROGRAM
0070: .L.Draw
0090: .T.1
00B0: .S.0
00C0: .core.__PRINTU8
00E0: .PLY_AKG_Start
0120: .PLY_AKG_Init
0150: ._Late
0160: .T.2"""


def fake_build(image, main=100, program=50, runtime=500):
    return {"ok": True, "org": 0x40, "image": image, "end": 0x40 + image, "free": 1000, "heap": True, "heap_start": 0x8B60,
            "regions": {"startup": 13, "data": 6, "main": main, "program": program, "runtime": runtime, "library": 0},
            "chunks": [(".core.__START_PROGRAM", 0x40, 13, "startup")]}


def fake_rows():
    """Two programs, one twin and one game, firmware: the fork at -O2 and -O0, cpcbas at -O0, -O2 and -Os."""
    prog = lambda n, g: {"name": n, "group": g}
    a = {"program": prog("a", "twin"), "mode": "firmware", "res": {
        "fork-O2": fake_build(1000, main=100), "fork-O0": fake_build(1100, main=150), "cpcbas-O0": fake_build(1050, main=130),
        "cpcbas-O2": fake_build(1050, main=130), "cpcbas-Os": fake_build(990, main=90)}}
    b = {"program": prog("lamp464", "game"), "mode": "firmware", "res": {
        "fork-O2": fake_build(5000, main=900), "fork-O0": fake_build(5200, main=1000), "cpcbas-O0": fake_build(5600, main=1500),
        "cpcbas-O2": fake_build(5600, main=1500), "cpcbas-Os": fake_build(5100, main=1000)}}
    for r in (a, b):
        r["res"]["fork"], r["res"]["cpcbas"] = r["res"]["fork-O2"], r["res"]["cpcbas-Os"]
    return [a, b]


META = {"fork_cols": ["fork-O2", "fork-O0"], "reference_fork_col": "fork-O2", "cpcbas_cols": ["cpcbas-O0", "cpcbas-O2", "cpcbas-Os"],
        "primary_cpcbas_col": "cpcbas-Os"}


class ByLabel(unittest.TestCase):
    """Follow-up 170: a chunk is classified by the name of its label, not by its position."""

    def lamp(self, text, image):
        return sd.analyse(sd.parse_map(text), 0x40, image, "firmware", 4768)

    def test_the_player_is_library_in_both_layouts(self):
        f = self.lamp(FORK_LAMP, 0x130 - 0x40)
        c = self.lamp(CPCBAS_LAMP, 0x170 - 0x40)
        # fork: player and glue 0x53..0xB0 = 93 bytes in main; cpcbas: player 0xE0..0x150 = 112 bytes after the first runtime
        # routine, and the glue 0x53..0x63 = 16 bytes in main
        self.assertEqual(f["regions"]["library"], 0xB0 - 0x53)
        self.assertEqual(c["regions"]["library"], (0x150 - 0xE0) + (0x63 - 0x53))
        # main is what is left of the main zone
        self.assertEqual(f["regions"]["main"], (0x53 - 0x50) + (0xC0 - 0xB0))
        self.assertEqual(c["regions"]["main"], (0x53 - 0x50) + (0x70 - 0x63))

    def test_procedures_after_a_runtime_routine_are_program(self):
        c = self.lamp(CPCBAS_LAMP, 0x170 - 0x40)
        # .L.Draw .T.1 .S.0 (0x70..0xC0) and ._Late .T.2 (0x150..0x170) are program; .core.__PRINTU8 (0xC0..0xE0) is runtime
        self.assertEqual(c["regions"]["program"], 0x50 + 0x20)
        self.assertEqual(c["regions"]["runtime"], 0x20)

    def test_a_label_that_says_nothing_continues_the_routine_before(self):
        f = self.lamp(FORK_LAMP, 0x130 - 0x40)
        # ._Draw, .LABEL.__LABEL1 and 2 are program (0xC0..0x100); .core.__PRINTU8 and the firmware label .L32D7 are runtime
        self.assertEqual((f["regions"]["program"], f["regions"]["runtime"]), (0x40, 0x30))

    def test_image_totals_do_not_change(self):
        for text, image in ((FORK_LAMP, 0x130 - 0x40), (CPCBAS_LAMP, 0x170 - 0x40), (MAP, 0x170 - 0x40)):
            r = self.lamp(text, image)
            self.assertEqual(sum(r["regions"].values()), image)
            self.assertEqual(sum(c[2] for c in r["chunks"]), image - (0x40 - r["org"]) - 0)
            self.assertEqual(r["image"], image)

    def test_the_chunk_is_named_by_the_label_that_decided(self):
        f = self.lamp(FORK_LAMP, 0x130 - 0x40)
        self.assertIn((".core.__PRINTU8", 0x100, 0x20, "runtime"), f["chunks"])
        self.assertIn(("._Draw", 0xC0, 0x20, "program"), f["chunks"])  # not .LABEL.__LABEL1, the other label at that address

    def test_reclassify_an_old_document(self):
        # a position-classified JSON: the player in main (fork) and in runtime (cpcbas), chunks as the old tool wrote them
        old_f = [[".core.__START_PROGRAM", 0x40, 16, "startup"], [".core.ZXBASIC_USER_DATA_END", 0x50, 3, "main"],
                 [".PLY_AKG_Start", 0x53, 77, "main"], [".sf_x", 0xA0, 32, "main"], [".core.__END_PROGRAM", 0xC0, 3, "program"],
                 ["._Draw", 0xC3, 29, "program"], [".core.__PRINTU8", 0xE0, 16, "runtime"]]
        old_c = [[".core.__START_PROGRAM", 0x40, 16, "startup"], [".core.ZXBASIC_USER_DATA_END", 0x50, 3, "main"],
                 [".sf_x", 0x53, 32, "main"], [".core.__END_PROGRAM", 0x73, 3, "program"], [".L.Draw", 0x76, 20, "program"],
                 [".core.__PRINTU8", 0x8A, 16, "runtime"], [".PLY_AKG_Start", 0x9A, 77, "runtime"], ["._Late", 0xE7, 9, "runtime"]]
        mk = lambda image, ch, reg: {"ok": True, "image": image, "regions": reg, "chunks": ch}
        doc = {"meta": {}, "rows": [{"name": "g", "group": "game", "mode": "firmware", "builds": {
            "fork-O2": mk(176, old_f, {"startup": 16, "data": 0, "main": 112, "program": 32, "runtime": 16}),
            "cpcbas-O3": mk(176, old_c, {"startup": 16, "data": 0, "main": 35, "program": 23, "runtime": 102}),
            "fork-O3": {"ok": True, "image": 5, "regions": {"main": 99}}}}]}
        new = sd.reclassify_doc(doc)
        b = new["rows"][0]["builds"]
        self.assertEqual(b["fork-O2"]["regions"], {"startup": 16, "data": 0, "main": 35, "program": 32, "runtime": 16, "library": 77})
        self.assertEqual(b["cpcbas-O3"]["regions"], {"startup": 16, "data": 0, "main": 35, "program": 32, "runtime": 16, "library": 77})
        self.assertIsNone(b["fork-O3"]["regions"])  # no chunks: the old regions would be the wrong ones
        self.assertEqual(new["meta"]["classifier"], sd.CLASSIFIER)
        self.assertEqual(sd.reclassify_doc(new), new)  # idempotent

    def test_summary_shows_the_library_row_only_when_there_is_one(self):
        rows = fake_rows()
        rows[1]["res"]["fork-O2"]["regions"]["library"] = 3412
        rows[1]["res"]["cpcbas-Os"]["regions"]["library"] = 3412
        text = sd.summary(sd.to_json(rows, {**META}))
        self.assertIn("| game | firmware | library | 3412 |", text)
        self.assertNotIn("| twin | firmware | library |", text)


class Levels(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(sd.parse_cpcbas_levels("0,1,2,3,s"), ["0", "1", "2", "3", "s"])
        self.assertEqual(sd.parse_cpcbas_levels("s,0,s"), ["s", "0"])
        self.assertEqual(sd.parse_int_levels("2,0,3"), [2, 0, 3])
        for bad in ("4", "S", "", "0,x"):
            with self.assertRaises(ValueError):
                sd.parse_cpcbas_levels(bad)
        with self.assertRaises(ValueError):
            sd.parse_int_levels("s")

    def test_reference_and_primary(self):
        self.assertEqual(sd.reference_fork([0, 2, 3]), 2)
        self.assertEqual(sd.reference_fork([3, 0]), 3)
        self.assertEqual(sd.primary_level(["0", "2", "s"]), "s")
        self.assertEqual(sd.primary_level(["s", "0", "2"]), "s")
        self.assertEqual(sd.primary_level(["0", "1", "2"]), "2")
        self.assertEqual((sd.fork_col(2), sd.cpcbas_col("s")), ("fork-O2", "cpcbas-Os"))

    def test_s_reaches_the_cli_as_dash_O_s(self):
        cmd = sd.cpcbas_cmd(Path("cli.js"), Path("p.bas"), Path("p.map"), Path("p.bin"), "s")
        self.assertEqual(cmd[cmd.index("-O") + 1], "s")
        self.assertNotIn("-O", sd.cpcbas_cmd(Path("cli.js"), Path("p.bas"), Path("p.map"), Path("p.bin"), None))


class Summary(unittest.TestCase):
    def doc(self):
        return sd.to_json(fake_rows(), {**META, "commit": "x", "dirty": False})

    def test_aliases_are_left_out_of_the_json(self):
        d = self.doc()
        self.assertEqual(sorted(d["rows"][0]["builds"]), ["cpcbas-O0", "cpcbas-O2", "cpcbas-Os", "fork-O0", "fork-O2"])
        self.assertEqual(d["rows"][0]["builds"]["cpcbas-Os"]["chunks"], [[".core.__START_PROGRAM", 0x40, 13, "startup"]])

    def test_chunks_only_for_the_two_compared_columns(self):
        d = self.doc()
        b = d["rows"][0]["builds"]
        self.assertIn("chunks", b["fork-O2"])
        self.assertIn("chunks", b["cpcbas-Os"])
        self.assertNotIn("chunks", b["fork-O0"])
        self.assertNotIn("chunks", b["cpcbas-O2"])

    def test_json_round_trip_and_gzip(self):
        import tempfile
        d = self.doc()
        with tempfile.TemporaryDirectory() as t:
            for name in ("a.json", "a.json.gz"):
                sd.write_json(Path(t) / name, d)
                self.assertEqual(sd.read_json(Path(t) / name), d)

    def test_legacy_columns_are_kept(self):
        r = {"program": {"name": "p", "group": "twin"}, "mode": "firmware", "res": {"fork": fake_build(10), "cpcbas": fake_build(11)}}
        self.assertEqual(sorted(sd.to_json([r], {})["rows"][0]["builds"]), ["cpcbas", "fork"])

    def test_milestone_rows(self):
        text = sd.summary(self.doc())
        # at -Os: twin a is 10 under, lamp464 is 100 over
        self.assertIn("| twin | firmware | 1 | 0 | +0 | -10 | -10 | 1000 | 990 |", text)
        self.assertIn("| game | firmware | 1 | 1 | +100 | +0 | +100 | 5000 | 5100 |", text)
        self.assertIn("| all | firmware | 2 | 1 | +100 | -10 | +90 | 6000 | 6090 |", text)
        self.assertIn("- game, firmware: lamp464 +100", text)
        # the sum of images per level, and the regions against the fork
        self.assertIn("| all | firmware | 2 | 6000 | 6300 | 6650 | 6650 | 6090 |", text)
        self.assertIn("| all | firmware | main | 1000 | 1150 | 1630 | 1630 | 1090 | +90 |", text)
        # an informative fork column that did not build one program is summed over the others and says so
        rows = fake_rows()
        rows[1]["res"]["fork-O0"] = {"ok": False, "err": "x"}
        t2 = sd.summary(sd.to_json(rows, {**META}))
        self.assertIn("| all | firmware | 2 | 6000 | 1100 (1 of 2) | 6650 | 6650 | 6090 |", t2)
        self.assertIn("Size at -Os against the fork at -O2", text)

    def test_contributors(self):
        rows = fake_rows()
        rows[0]["res"]["cpcbas-Os"]["chunks"] = [(".core.__START_PROGRAM", 0x40, 13, "startup"), (".core.__LOCO_NUMFMT", 0x200, 242, "runtime")]
        rows[0]["res"]["fork-O2"]["chunks"] = [(".core.__START_PROGRAM", 0x40, 13, "startup"), (".core.__PRINT_NEWLINE", 0x200, 100, "runtime")]
        text = sd.contributors(sd.to_json(rows[:1], {**META}))
        self.assertIn("**twin, firmware** (1 programs): startup +0, data +0, main -10, program +0, runtime +0, library +0; image -10", text)
        self.assertIn("| `__LOCO_NUMFMT` | +242 | 1 | 0 |", text)
        self.assertIn("| `__PRINT_NEWLINE` | -100 | 0 | 1 |", text)

    def test_against_and_the_one_percent_test(self):
        old = self.doc()
        new = self.doc()
        for r in new["rows"]:
            r["builds"]["cpcbas-Os"]["image"] -= 100
        text = sd.against(old, new)
        self.assertIn("| a | twin | firmware | 990 | 890 | -100 | -10.1 |", text)
        self.assertIn("Sum of images: 6090 -> 5890 (-200 bytes, overall gain 3.28 %", text)
        self.assertIn("passed", text)
        same = sd.against(old, old)
        self.assertIn("0 of 2 programs changed", same)
        self.assertIn("not passed", same)

    def test_against_a_run_without_the_level_uses_its_primary_column(self):
        # the RC3 baseline: cpcbas -O0..-O3, primary -O3, no -Os column (R17: `--against` found no common program)
        old = {"meta": {"primary_cpcbas_col": "cpcbas-O3"},
               "rows": [{"name": "a", "group": "twin", "mode": "firmware",
                         "builds": {"cpcbas-O0": {"ok": True, "image": 990}, "cpcbas-O3": {"ok": True, "image": 990}}}]}
        text = sd.against(old, self.doc())
        self.assertIn("cpcbas-O3 (old) to cpcbas-Os (new), 1 programs built in both", text)
        self.assertIn("0 of 1 programs changed", text)

    def test_against_a_legacy_run(self):
        old = {"meta": {}, "rows": [{"name": "a", "group": "twin", "mode": "firmware", "builds": {"cpcbas": {"ok": True, "image": 1100}}}]}
        text = sd.against(old, self.doc())
        self.assertIn("cpcbas (old) to cpcbas-Os (new)", text)
        self.assertIn("| a | twin | firmware | 1100 | 990 | -110 |", text)


ASM = """\torg 64
.core.__START_PROGRAM:
\tjp .core.__MAIN_PROGRAM__
.core.__MAIN_PROGRAM__:
\tld hl, (_a+3)
\tpush hl
\tld hl, (_a+1)
\tpush hl
\tld hl, (_a-1)
\tpush hl
\tld a, (_b)
\tld de, (_b+1)
\tld bc, (_b+3)
\tcall .core.__LOCO_FADD
\tpush bc
\tpush de
\tpush af
\tpop af
\tpop de
\tpop bc
\tpush hl
\tpop hl
\tpush hl
\tpop de
\tsbc a, a
\tld h, a
\tld l, a
\tld de, 1
\tadd hl, de
\tld a, h
\tor l
\tjp nz, .T.1
.T.1:
\tpush hl
.T.2:
\tpop hl
\tjp .T.1
\tjp _Proc__exit
\tjp (hl)
\tld de, 5
\tld hl, (_n)
\tadd hl, de
.S.0:
\tDEFW 0004h
\tDEFB 64h
"""


class Patterns(unittest.TestCase):
    def test_instruction_reading(self):
        ins = sd.instructions(ASM)
        self.assertEqual(ins[:2], [("label", ".core.__MAIN_PROGRAM__:"), ("ld", "hl,(_a+3)")])  # nothing before __MAIN_PROGRAM__
        self.assertNotIn("defb", [o for o, _ in ins])
        self.assertIn(("label", ".T.1:"), ins)

    def test_counts(self):
        c = sd.pattern_counts(sd.instructions(ASM))
        P = sd.PATTERNS
        self.assertEqual(c[P[0]], 2)    # push af/pop af and push hl/pop hl; the label between the last push and pop breaks it
        self.assertEqual(c[P[1]], 1)    # push hl / pop de
        self.assertEqual(c[P[9]], 1)
        self.assertEqual(c[P[2]], 1)
        self.assertEqual(c[P[3]], 1)
        self.assertEqual(c[P[4]], 1)
        self.assertEqual(c[P[5]], 1)
        self.assertEqual(c[P[6]], 1)
        self.assertEqual(c[P[7]], 2)    # jp .T.1 and jp _Proc__exit; jp (hl) is not a jump to a label
        self.assertEqual(c[P[8]], 1)
        self.assertEqual(c[P[10]], 1)
        self.assertEqual(c[P[11]], 1)

    def test_ngrams_reduce_operands(self):
        g = sd.ngrams(sd.instructions(ASM), 2)
        self.assertEqual(g["ld hl,(V+N) / push hl"], 2)
        self.assertEqual(g["ld hl,(V-N) / push hl"], 1)
        self.assertEqual(sd.normalise_operand("hl,(_a+3)"), "hl,(V+N)")
        self.assertEqual(sd.normalise_operand("nz,.T.12"), "nz,L")
        self.assertEqual(sd.normalise_operand("de,1"), "de,N")

    def test_patterns_programs_picks_firmware_and_one_game_build(self):
        mk = lambda n, g, mode=None: {"name": n, "group": g, **({"mode": mode} if mode else {})}
        jobs = [(mk("a", "twin"), "firmware"), (mk("a", "twin"), "bare"), (mk("lamp464", "game", "firmware"), "firmware"),
                (mk("lamp6128", "game", "firmware"), "firmware"), (mk("lamppluc", "game", "bare"), "bare")]
        got = sd.patterns_programs(jobs, ["firmware", "bare"], jobs)
        self.assertEqual([(p["name"], m) for p, m in got], [("a", "firmware"), ("lamp464", "firmware")])


if __name__ == "__main__":
    unittest.main()
