#!/usr/bin/env python3
"""Unit tests of tools/conformance.py: header parsing, the plan (what is skipped and why), the
PASS/FAIL/DONE count and its summary, the form-feed and wrapped-line handling, the state check.
Stdlib unittest; development tooling, not part of `npm test`, no emulator needed.
Run: python3 tools/test_conformance.py
"""
import importlib.util
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("conformance", HERE / "conformance.py")
cf = importlib.util.module_from_spec(_spec)
sys.modules["conformance"] = cf
_spec.loader.exec_module(cf)

GOOD = "PASS a\nPASS b\nDONE\n"


def result(text="", output=GOOD, code=0, skip=None):
    r = cf.Result(Path("x.bas"), cf.parse_headers(text))
    r.exit_code, r.output, r.skip_reason = code, output, skip
    return r


class Headers(unittest.TestCase):
    def test_every_keyword(self):
        h = cf.parse_headers(
            "REM MODELS: 464 6128\nrem models: plus\n"
            "REM EMUS: cap32\n"
            "REM CPCBAS: -W 320 -D X=1\n"
            "REM DISKFILE: bankdat.bin=assets/bankdat.bin\n"
            "REM TYPE: Q\nREM TYPE:\n"
            "REM BARE: skip uses the firmware clock\n"
            "REM STATE: mode=1 lrom=off\nREM STATE: ramcfg=0\n"
            "REM XFAIL: needs L3-LIB\n"
            "PRINT 1\n")
        self.assertEqual(h.models, ["464", "6128", "plus"])
        self.assertEqual(h.emus, ["cap32"])
        self.assertEqual(h.args, ["-W", "320", "-D", "X=1"])
        self.assertEqual(h.diskfiles, [("BANKDAT.BIN", "assets/bankdat.bin")])
        self.assertEqual(h.typed, ["Q", ""])
        self.assertEqual((h.bare_kind, h.bare_reason), ("skip", "uses the firmware clock"))
        self.assertEqual(h.state, ["mode=1", "lrom=off", "ramcfg=0"])
        self.assertEqual(h.xfail, "needs L3-LIB")

    def test_timeout_overrides_a_smaller_default_only(self):
        h = cf.parse_headers("REM TIMEOUT: 300\nPRINT 1\n")
        self.assertEqual(h.timeout, 300.0)
        self.assertEqual(cf.timeout_for(h, 60.0), 300.0)
        self.assertEqual(cf.timeout_for(h, 1000.0), 1000.0)
        self.assertEqual(cf.timeout_for(cf.parse_headers("PRINT 1\n"), 60.0), 60.0)
        self.assertIsNone(cf.parse_headers("REM see TIMEOUT: 5 here\n").timeout)

    def test_zxbc_is_not_a_header(self):
        self.assertEqual(cf.parse_headers("REM ZXBC: -D X\n").args, [])

    def test_a_remark_that_merely_mentions_a_keyword(self):
        h = cf.parse_headers("REM this test says XFAIL: nothing\nREM see MODELS: here\n")
        self.assertIsNone(h.xfail)
        self.assertEqual(h.models, [])

    def test_bare_only(self):
        h = cf.parse_headers("REM BARE: only\n")
        self.assertEqual((h.bare_kind, h.bare_reason), ("only", ""))


class Plan(unittest.TestCase):
    def test_no_models_runs_everywhere_but_chips_has_no_plus_or_664(self):
        h = cf.parse_headers("")
        for m in ("464", "6128"):
            self.assertIsNone(cf.plan(h, m, "chips", False))
        self.assertIsNone(cf.plan(h, "plus", "cpcec", False))
        self.assertIsNone(cf.plan(h, "664", "cap32", False))
        self.assertIn("no 664", cf.plan(h, "664", "chips", False))

    def test_models_list_without_plus_skips_plus(self):
        h = cf.parse_headers("REM MODELS: 464 664 6128\n")
        self.assertIsNone(cf.plan(h, "6128", "cap32", False))
        self.assertIn("MODELS", cf.plan(h, "plus", "cpcec", False))

    def test_emus_and_keys_and_disc(self):
        self.assertIn("EMUS", cf.plan(cf.parse_headers("REM EMUS: cap32\n"), "6128", "chips", False))
        self.assertIn("type", cf.plan(cf.parse_headers("REM TYPE: Q\n"), "6128", "cpcec", False))
        self.assertIsNone(cf.plan(cf.parse_headers("REM TYPE: Q\n"), "6128", "chips", False))
        self.assertIn("disc", cf.plan(cf.parse_headers("REM DISKFILE: A.BIN=a\n"), "6128", "chips", False))

    def test_bare_modes(self):
        skip = cf.parse_headers("REM BARE: skip firmware clock\n")
        only = cf.parse_headers("REM BARE: only\n")
        self.assertIsNone(cf.plan(skip, "6128", "chips", False))
        self.assertIn("firmware only", cf.plan(skip, "6128", "chips", True))
        self.assertIn("bare metal only", cf.plan(only, "6128", "chips", False))
        self.assertIsNone(cf.plan(only, "6128", "chips", True))


class Build(unittest.TestCase):
    def test_defines(self):
        self.assertEqual(cf.defines_for("6128", False, False), ["__CPC_PRINTER_ECHO__", "CPC6128"])
        self.assertEqual(cf.defines_for("plus", False, False), ["__CPC_PRINTER_ECHO__", "PLUS"])
        self.assertEqual(cf.defines_for("464", True, False)[-1], "CPC_BAREMETAL")
        self.assertEqual(cf.defines_for("464", True, True)[-2:], ["CPC_BAREMETAL", "CPC_LINE_464"])
        self.assertNotIn("CPC_LINE_464", cf.defines_for("6128", True, True))

    def test_command(self):
        cmd = cf.build_command(Path("/t/p.bas"), Path("/o/p.dsk"), ["A", "B"], ["-W", "320"],
                               [("N.BIN", "assets/n.bin")], base=Path("/c"))
        self.assertEqual(cmd[2:], ["/t/p.bas", "-o", "/o/p.dsk", "-D", "A", "-D", "B", "-W", "320",
                                   "--dsk-add", "N.BIN=/c/assets/n.bin"])


class Transcript(unittest.TestCase):
    def test_form_feed_is_dropped_whatever_the_model(self):
        # 464: CLS echoes byte 12 to the printer; 6128: it does not
        on464 = cf.clean_transcript("\x0cFAIL x got=1 want=2\nDONE\n")
        on6128 = cf.clean_transcript("FAIL x got=1 want=2\nDONE\n")
        self.assertEqual(on464, on6128)
        self.assertEqual(result(output=on464).fail_lines, ["FAIL x got=1 want=2"])

    def test_wrapped_fail_line_is_joined(self):
        out = "PASS a\nFAIL name got=\n-0.000004 want=-4E-06\nPASS b\nDONE\n"
        self.assertEqual(cf.fail_lines(out), ["FAIL name got=-0.000004 want=-4E-06"])
        out = "FAIL name got=abc want=\ndef\nDONE\n"
        self.assertEqual(cf.fail_lines(out), ["FAIL name got=abc want=def"])

    def test_a_complete_fail_line_takes_no_continuation(self):
        out = "FAIL a got=1 want=2\nsome other output\nFAIL b got=3 want=4\nDONE\n"
        self.assertEqual(cf.fail_lines(out), ["FAIL a got=1 want=2", "FAIL b got=3 want=4"])

    def test_state_lines(self):
        err = "chipsrun-state: mode=1 lrom=off ramcfg=0\n"
        self.assertEqual(cf.state_output(err, ["mode=1", "ramcfg=0"]), "PASS state_mode\nPASS state_ramcfg\n")
        self.assertEqual(cf.state_output(err, ["mode=2"]), "FAIL state_mode got=1 want=2\n")
        self.assertIn("state_missing", cf.state_output("", ["mode=1"]))
        self.assertEqual(cf.state_output(err, []), "")


class Counting(unittest.TestCase):
    def test_status(self):
        self.assertEqual(result().status, "PASS")
        self.assertEqual(result(output="PASS a\nFAIL b got=1 want=2\nDONE\n").status, "FAIL")
        self.assertEqual(result(output="PASS a\n").status, "FAIL")  # no DONE
        self.assertEqual(result(code=2).status, "TIMEOUT")
        self.assertEqual(result(code=1).status, "BUILDERR")
        self.assertEqual(result(code=4).status, "FAIL")  # no END marker
        self.assertEqual(result(skip="MODELS: 464").status, "SKIP")

    def test_done_must_start_a_line(self):
        self.assertEqual(result(output="PASS a\nNOT DONE\n").status, "FAIL")

    def test_timeout_message_says_the_budget_and_the_last_line(self):
        r = result(code=2, output="PASS a\nPASS b\n")
        r.timeout_s = 60.0
        self.assertEqual(r.first_problem(),
                         "timeout after 60 s emulated (REM TIMEOUT: n raises it); last transcript line: PASS b")
        self.assertEqual(result(code=2, output="").first_problem(), "timeout (hang)")

    def test_xfail_and_xpass(self):
        self.assertEqual(result("REM XFAIL: needs L3-X\n", output="", code=1).status, "XFAIL")
        self.assertEqual(result("REM XFAIL: needs L3-X\n").status, "XPASS")

    def test_counts_and_summary(self):
        rs = [result(), result(), result(output="FAIL a got=1 want=2\nDONE\n"), result(code=2),
              result(code=1), result("REM XFAIL: w\n", output="", code=1), result(skip="x")]
        c = cf.count(rs)
        self.assertEqual((c.passed, c.failed, c.timeout, c.builderr, c.xfail, c.xpass, c.skipped, c.total),
                         (2, 1, 1, 1, 1, 0, 1, 6))
        self.assertFalse(c.ok)
        self.assertEqual(cf.summary_line(c),
                         "2/6 passed, 1 failed, 1 timed out, 1 build errors, 1 expected failures, "
                         "0 unexpected passes, 1 skipped (other model/emulator/mode)")

    def test_ok_needs_no_failure_and_no_xpass(self):
        self.assertTrue(cf.count([result(), result("REM XFAIL: w\n", output="", code=1)]).ok)
        self.assertFalse(cf.count([result("REM XFAIL: w\n")]).ok)  # XPASS: remove the header
        self.assertTrue(cf.count([result(skip="x")]).ok)


class OptFlag(unittest.TestCase):
    """--opt L adds `-O L` to every build (L5-DIFF); the default adds nothing."""

    def command(self, opt):
        saved, cf.OPT = cf.OPT, opt
        try:
            return cf.build_command(Path("/t/p.bas"), Path("/o/p.dsk"), ["A"], ["-W", "320"], [], base=Path("/c"))
        finally:
            cf.OPT = saved

    def test_default(self):
        self.assertNotIn("-O", self.command(None))

    def test_levels(self):
        for level in cf.OPT_LEVELS:
            cmd = self.command(level)
            self.assertEqual(cmd[cmd.index("-O") + 1], level)
            self.assertEqual(cmd[-2:], ["-W", "320"])  # the program's own options still come last

    def test_option_parses(self):
        for bad in ("4", "S", "-1"):
            with self.assertRaises(SystemExit):
                cf.main(["--opt", bad, "--list"])

if __name__ == "__main__":
    unittest.main()
