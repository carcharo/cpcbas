#!/usr/bin/env python3
"""Unit tests of bench/speed.py's parsing, comparison and report code (stdlib unittest; no emulator, no compiler).
Run: python3 bench/test_speed.py
"""
import importlib.util
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("speed", HERE / "speed.py")
sp = importlib.util.module_from_spec(_spec)
sys.modules["speed"] = sp
_spec.loader.exec_module(sp)

RAW_FORK = "T [123]\nv [5]\nm [800]\n\x04END\n"
RAW_CPCBAS = "T [ 123 ]\r\nv [ 5 ]\r\nm [ 800 ]\r\n\x04END\n"


class Levels(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(sp.parse_levels("0,2,s"), ["0", "2", "s"])
        self.assertEqual(sp.parse_levels("s,s,1"), ["s", "1"])
        for bad in ("4", "-O2", "", "S", "0,x"):
            with self.assertRaises(ValueError):
                sp.parse_levels(bad)

    def test_s_reaches_the_cli_as_dash_O_s(self):
        cmd = sp.cpcbas_command(Path("cli.js"), Path("p.bas"), Path("p.dsk"), "s", True)
        self.assertEqual(cmd[cmd.index("-O") + 1], "s")
        self.assertIn("__CPC_PRINTER_ECHO__", cmd)
        cmd = sp.cpcbas_command(Path("cli.js"), Path("p.bas"), Path("p.dsk"), "2", False)
        self.assertEqual(cmd[cmd.index("-O") + 1], "2")
        self.assertNotIn("__CPC_PRINTER_ECHO__", cmd)

    def test_fork_command_is_o2_by_default_value(self):
        cmd = sp.fork_command(Path("p.bas"), Path("p.bin"), Path("p.map"), 2, True, Path("lib"))
        self.assertEqual(cmd[cmd.index("-O") + 1], "2")
        self.assertEqual(cmd[-1], "p.bas")


class Parsing(unittest.TestCase):
    def test_both_dialects_give_the_same_dict(self):
        self.assertEqual(sp.parse_output(RAW_FORK), {"T": "123", "v": "5", "m": "800"})
        self.assertEqual(sp.parse_output(RAW_CPCBAS), sp.parse_output(RAW_FORK))

    def test_no_marker_is_an_error(self):
        with self.assertRaises(ValueError):
            sp.parse_output("T [1]\n")

    def test_tick_keys(self):
        self.assertEqual(sp.tick_keys({"T1": "1", "T2": "2", "x": "3", "T": "4", "Total": "5"}), ["T1", "T2", "T"])

    def test_text_after_the_marker_is_ignored(self):
        self.assertEqual(sp.parse_output("T [9]\n\x04END\nT [1]\n"), {"T": "9"})


class Checks(unittest.TestCase):
    def test_numbers(self):
        self.assertTrue(sp.numbers_close("6688.0857", "6688.08573"))      # 8 digits against 9
        self.assertFalse(sp.numbers_close("6688.0857", "6688.0867"))
        self.assertFalse(sp.numbers_close("2731", "2732"))                 # whole numbers are exact
        self.assertTrue(sp.numbers_close("00300", "00300"))
        self.assertTrue(sp.numbers_close("-49.999945", "-49.9999539", 6))
        self.assertFalse(sp.numbers_close("-49.999945", "-49.9999539", 8))

    def test_agree_ignores_timings(self):
        a = {"T": "10", "s": "5", "chk": "1.5"}
        self.assertEqual(sp.checks_agree(a, {"T": "99", "s": "5", "chk": "1.5"}), [])
        self.assertEqual(sp.checks_agree(a, {"T": "99", "s": "6", "chk": "1.5"}), ["s"])
        self.assertEqual(sp.checks_agree(a, {"T": "99", "s": "5"}), ["chk"])
        self.assertEqual(sp.checks_agree({"T": "1"}, {"T": "1", "extra": "1"}), ["extra"])


class Verdicts(unittest.TestCase):
    def test_ratio_and_target(self):
        self.assertAlmostEqual(sp.ratio(110, 100), 1.10)
        self.assertEqual(sp.verdict(1.10, False), "met")
        self.assertEqual(sp.verdict(1.101, False), "not met")
        self.assertEqual(sp.verdict(1.0, True), "not met")   # floats must be faster, not equal
        self.assertEqual(sp.verdict(0.99, True), "met")

    def test_spread(self):
        self.assertFalse(sp.spread([[5, 6], [5, 6]]))
        self.assertTrue(sp.spread([[5, 6], [5, 7]]))

    def test_geomean(self):
        self.assertAlmostEqual(sp.geomean([2.0, 8.0]), 4.0)

    def test_echo_mark(self):
        self.assertFalse(sp.wants_echo("' x\n' SPEED-NOECHO: built without\nDIM a"))
        self.assertTrue(sp.wants_echo("' x\nDIM a"))


class Report(unittest.TestCase):
    def row(self, prog, side, level, ticks, exact=True, checks=None):
        return {"program": prog, "side": side, "level": level, "model": "6128", "image": 1000, "runs": 2, "ticks": [[ticks], [ticks]],
                "keys": ["T"], "checks": checks or {"s": "5"}, "exact": exact}

    def test_table_and_faults(self):
        rows = [self.row("intloop", "fork", "2", 100), self.row("intloop", "cpcbas", "0", 150),
                self.row("intloop", "cpcbas", "2", 105, exact=False),
                self.row("float", "fork", "2", 1000), self.row("float", "cpcbas", "0", 900), self.row("float", "cpcbas", "2", 1000)]
        text = sp.report(rows, ["0", "2"], "2", "6128")
        self.assertIn("| intloop | T | 100 | 0.33 | 150 (1.500) | 105 (1.050) | -O2 |", text)
        self.assertIn("| float | T | 1000 | 3.33 | 900 (0.900) | 1000 (1.000) | -O0 |", text)
        self.assertIn("FAULT: intloop cpcbas -O2", text)

    def test_sim_table(self):
        cells = [{"kernel": "bm7", "level": "0", "tstates": 10}, {"kernel": "bm7", "level": "2", "tstates": 10},
                 {"kernel": "sieve", "level": "0", "tstates": 20}, {"kernel": "sieve", "level": "2", "tstates": 18}]
        t = sp.sim_table(cells, ["0", "2"])
        self.assertIn("| bm7 | 10 | 10 | yes |", t)
        self.assertIn("| sieve | 20 | 18 | no |", t)
        t = sp.sim_table([{"kernel": "bm7", "level": "0", "tstates": 10}, {"kernel": "bm7", "level": "s", "error": "-O: 's' is not 0, 1, 2 or 3"}], ["0", "s"])
        self.assertIn("n/a", t)
        self.assertIn("| no |", t)


class Programs(unittest.TestCase):
    def test_every_program_exists_and_includes_tick(self):
        for name, _what, _f in sp.PROGRAMS:
            text = (sp.PROGRAMS_DIR / f"{name}.bas").read_text()
            self.assertIn('#include "tick.bas"', text, name)
        self.assertIn("$BD0D", (sp.PROGRAMS_DIR / "tick.bas").read_text())

    def test_only_screen_is_built_without_echo(self):
        noecho = [n for n, _w, _f in sp.PROGRAMS if not sp.wants_echo((sp.PROGRAMS_DIR / f"{n}.bas").read_text())]
        self.assertEqual(noecho, ["screen"])


if __name__ == "__main__":
    unittest.main()
