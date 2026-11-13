#!/usr/bin/env python3
"""Unit tests of tools/fork-diff.py's REAL rule (stdlib unittest; development tooling, not part of `npm test`).
Run: python3 tools/test_fork_diff.py
"""
import importlib.util
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("fork_diff", HERE / "fork-diff.py")
fd = importlib.util.module_from_spec(_spec)
sys.modules["fork_diff"] = fd
_spec.loader.exec_module(fd)


class RealRule(unittest.TestCase):
    def test_numbers_close(self):
        self.assertTrue(fd.numbers_close("0.66666667", "0.666666667"))
        self.assertTrue(fd.numbers_close("1000000000", "1E+09"))
        self.assertTrue(fd.numbers_close(".0001", "0.0001"))
        self.assertTrue(fd.numbers_close("3.1415927", "3.14159265"))
        self.assertFalse(fd.numbers_close("3.1415927", "3.1415929"))
        self.assertFalse(fd.numbers_close("12345678", "12345679"))  # whole numbers on both sides: exact
        self.assertFalse(fd.numbers_close("abc", "1.5"))

    def test_transcripts(self):
        self.assertTrue(fd.transcripts_equal("a [0.33333333]\nb [4]\n", "a [0.333333333]\nb [4]\n"))
        self.assertFalse(fd.transcripts_equal("a [0.33333333]\n", "b [0.333333333]\n"))  # text outside the brackets is exact
        self.assertFalse(fd.transcripts_equal("a [7]\n", "a [8]\n"))
        self.assertFalse(fd.transcripts_equal("a [0.5]\n", "a [0.5]\nb [1]\n"))


class OptFlag(unittest.TestCase):
    def test_the_option_is_passed_to_the_cpcbas_build_only(self):
        # --opt sets loco-diff's OPT (the build of the cpcbas side); the fork side's command has no -O
        src = (HERE / "fork-diff.py").read_text()
        self.assertIn("locodiff.OPT = args.opt", src)
        self.assertIn('choices=("0", "1", "2", "3", "s")', src)
        self.assertNotIn('"-O"', src)

if __name__ == "__main__":
    unittest.main()
