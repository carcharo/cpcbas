#!/usr/bin/env python3
"""Unit tests of the helpers of fwm_bench.py (no emulator): python3 bench/test_fwm_bench.py"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fwm_bench as F


def decode(b):
    m = b[0] | b[1] << 8 | b[2] << 16 | (b[3] & 127) << 24
    return (1 + m / 2 ** 31) * 2.0 ** (b[4] - 129)


class Helpers(unittest.TestCase):
    def test_real5(self):
        for x in (1.2345, 2.3456, 0.75, 100.0):
            self.assertAlmostEqual(decode(F.real5(x)), x, places=8)
        self.assertEqual(F.real5(1.0), [0, 0, 0, 0, 129])

    def test_parse(self):
        times, rest = F.parse("~ 4484 \r\n 0.943983324 \r\nReady\x04END\n\n")
        self.assertEqual(times, [4484])
        self.assertEqual(rest, "0.943983324")
        times, _ = F.parse("~ 3109 \n~ 5851 \n-50 86\nReady\x04END\n")
        self.assertEqual(times, [3109, 5851])
        with self.assertRaises(RuntimeError):
            F.parse("no marker")

    def test_op_source(self):
        loco = F.op_source("y=SIN(a)", "", 1000, "loco")
        self.assertIn("TIME", loco)
        self.assertNotIn("TICK", loco)
        comp = F.op_source("y=SIN(a)", "", 1000, "firmware")
        self.assertIn("TICK()", comp)
        self.assertIn("FUNCTION FASTCALL TICK", comp)
        self.assertIn("FOR i=1 TO 1000", comp)

    def test_report_math(self):
        res = {"op:base": {"loco": {"6128": {"ticks": [[300]]}}}, "op:add": {"loco": {"6128": {"ticks": [[600]]}}}}
        self.assertAlmostEqual(F.per_op(res, "add", "loco", "6128"), 1.0)  # 300 ticks = 1 s over 1000 = 1 ms


if __name__ == "__main__":
    unittest.main()
