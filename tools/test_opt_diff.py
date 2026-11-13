#!/usr/bin/env python3
"""Unit tests of tools/opt-diff.py: the comparison rule, the exit codes, the corpus plan (which program runs where), the level
parsing and the wrong pass of --inject-bug (stdlib unittest; development tooling, not part of `npm test`; no emulator runs
here). Run: python3 tools/test_opt_diff.py
"""
import argparse
import contextlib
import io
import importlib.util
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("opt_diff", HERE / "opt-diff.py")
od = importlib.util.module_from_spec(_spec)
sys.modules["opt_diff"] = od
_spec.loader.exec_module(od)


def ns(**kw) -> argparse.Namespace:
    base = dict(models=["464", "6128"], bare=False, emu=None, pattern="", suite=list(od.SUITES), timeout=10.0, shot_wait=20.0,
                cpcbuild=Path("/nonexistent"))
    base.update(kw)
    return argparse.Namespace(**base)


class Compare(unittest.TestCase):
    def test_equal_transcripts(self):
        self.assertIsNone(od.compare_outcomes(od.Outcome("ok", "a\nb\n"), od.Outcome("ok", "a\nb\n"), False))

    def test_first_difference_is_named(self):
        why = od.compare_outcomes(od.Outcome("ok", "a\nb\nc\n"), od.Outcome("ok", "a\nB\nc\n"), False)
        self.assertEqual(why, "line 2: -O0 'b', optimised 'B'")

    def test_a_shorter_transcript_differs(self):
        why = od.compare_outcomes(od.Outcome("ok", "a\nb\n"), od.Outcome("ok", "a\n"), False)
        self.assertIn("<missing>", why)

    def test_a_shot_program_needs_both_screens(self):
        a, b = od.Outcome("ok", "x\n", shot=b"x"), od.Outcome("ok", "x\n")
        self.assertEqual(od.compare_outcomes(a, b, True), "no screenshot from one of the builds")
        self.assertIsNone(od.compare_outcomes(a, b, False))  # not a shot program: the screens are not looked at


def unit(outcomes: dict[str, list[od.Outcome]], shot: bool = False) -> od.Unit:
    """A unit whose runs return the given outcomes in order, per level."""
    return od.Unit("loco", "p", "464", "cpcec", lambda level: outcomes[level].pop(0), shot=shot)


OK = od.Outcome("ok", "same\n", image="i")


class Measurements(unittest.TestCase):
    def test_digits_outside_the_protocol_lines_are_masked(self):
        text = "PASS a1\nINFO compute: frames= 12 hook= 3\n ticks= 7692 \nm0 o50 6s\nFAIL b got= 1 want= 2\nDONE"
        self.assertEqual(od.mask_measurements(text), "PASS a1\nINFO compute: frames= # hook= #\n ticks= # \nm# o# #s\nFAIL b got= 1 want= 2\nDONE")

    def test_two_builds_that_differ_in_a_measurement_only_are_equal(self):
        a = od.Outcome("ok", text=od.mask_measurements("INFO ticks: calibration(1.4M T)=471 empty=12\nSPEED 3 maps 191 ticks\nDONE"))
        b = od.Outcome("ok", text=od.mask_measurements("INFO ticks: calibration(1.4M T)=468 empty=9\nSPEED 3 maps 192 ticks\nDONE"))
        self.assertIsNone(od.compare_outcomes(a, b, shot=False))

    def test_a_protocol_line_still_differs(self):
        a = od.Outcome("ok", text=od.mask_measurements("FAIL x got=1\nDONE"))
        b = od.Outcome("ok", text=od.mask_measurements("FAIL x got=2\nDONE"))
        self.assertIsNotNone(od.compare_outcomes(a, b, shot=False))


class Judge(unittest.TestCase):
    def test_pass(self):
        r = od.judge(unit({"0": [OK], "2": [od.Outcome("ok", "same\n", image="j")]}), "2")
        self.assertEqual((r.status, r.same_image), ("pass", False))

    def test_same_image_is_noted(self):
        r = od.judge(unit({"0": [OK], "2": [OK]}), "2")
        self.assertEqual((r.status, r.same_image), ("pass", True))

    def test_a_difference_is_confirmed_by_a_second_run(self):
        bad = od.Outcome("ok", "other\n")
        r = od.judge(unit({"0": [OK, OK], "2": [bad, bad]}), "2")
        self.assertEqual(r.status, "DIFF")
        self.assertIn("+other", r.diff)

    def test_a_difference_that_does_not_repeat_is_flaky(self):
        r = od.judge(unit({"0": [OK, OK], "2": [od.Outcome("ok", "other\n"), OK]}), "2")
        self.assertEqual(r.status, "flaky")
        self.assertEqual(od.exit_code([r.status]), 3)

    def test_a_failing_baseline_is_not_a_pass(self):
        r = od.judge(unit({"0": [od.Outcome("hang", detail="timeout")], "2": []}), "2")
        self.assertEqual(r.status, "base-fail")
        self.assertEqual(od.exit_code([r.status]), 1)

    def test_a_rejected_optimised_build(self):
        r = od.judge(unit({"0": [OK], "s": [od.Outcome("not-compiled", detail="-O s: unknown level")]}), "s")
        self.assertEqual(r.status, "not-compiled")
        self.assertEqual(od.exit_code([r.status]), 5)

    def test_an_optimised_hang_is_a_hang(self):
        r = od.judge(unit({"0": [OK], "3": [od.Outcome("hang", "partial\n", detail="timeout")]}), "3")
        self.assertEqual(r.status, "hang")

    def test_a_tool_error_in_one_unit_is_reported_not_raised(self):
        def boom(level):
            raise RuntimeError("emulator gone")
        r = od.judge(od.Unit("loco", "p", "464", "cpcec", boom), "2")
        self.assertEqual(r.status, "error")
        self.assertIn("emulator gone", r.detail)


class Exit(unittest.TestCase):
    def test_a_difference_outranks_the_rest(self):
        self.assertEqual(od.exit_code(["pass", "pass"]), 0)
        self.assertEqual(od.exit_code(["pass", "hang", "DIFF", "not-compiled"]), 3)
        self.assertEqual(od.exit_code(["pass", "hang", "not-compiled"]), 5)
        self.assertEqual(od.exit_code(["hang", "error"]), 2)


class Summary(unittest.TestCase):
    def test_a_program_skipped_on_one_model_only_is_counted_apart(self):
        # R17: `banks` (MODELS: 6128 plus) is skipped on the 464 and runs on the 6128; `plus_core` runs nowhere
        unit = od.Unit("conformance", "banks", "6128", "chips", lambda level: None)
        results = [od.Result(unit, "pass", 1.0)]
        skipped = [("conformance/banks 464", "MODELS: 6128 plus"), ("conformance/plus_core 464", "MODELS: plus"),
                   ("conformance/plus_core 6128", "MODELS: plus")]
        text = od.summarise(results, skipped, "2", 1.0)
        self.assertIn("1 programs not run on any model, 1 on some models only", text)
        self.assertIn("not run, on one model or on both", text)


class Plan(unittest.TestCase):
    """The corpus is the gates' own: every blessed loco program, the conformance programs that run on chips (or on a disc
    emulator), tests/fork-diff and Lamplighter's two logic programs. No emulator runs."""

    def test_loco_covers_blessed_json(self):
        units, skipped = od.loco_units(ns(), None)
        names = {u.name for u in units}
        self.assertIn("int-arith", names)
        self.assertIn("keys-input", names)
        self.assertEqual({u.model for u in units}, {"464", "6128"})
        # a program that types keys runs on Caprice32, the others on CPCEC
        self.assertEqual({u.emu for u in units if u.name == "keys-input"}, {"cap32"})
        self.assertEqual({u.emu for u in units if u.name == "int-arith"}, {"cpcec"})
        self.assertTrue(any(u.shot for u in units))

    def test_loco_bare_leaves_out_the_bare_skip_programs(self):
        units, skipped = od.loco_units(ns(bare=True), None)
        self.assertNotIn("sound", {u.name for u in units})
        self.assertIn("loco/sound", [n for n, _ in skipped])

    def test_conformance_runs_on_chips_and_puts_disc_programs_on_cpcec(self):
        units, skipped = od.conformance_units(ns(), None)
        chips = {u.name for u in units if u.emu == "chips"}
        self.assertIn("arrays", chips)
        self.assertEqual({u.model for u in units if u.emu == "chips"}, {"464", "6128"})
        self.assertTrue(all(u.model == "6128" for u in units if u.emu == "cpcec"))
        # programs for another model or machine are not run, and are listed
        self.assertTrue(any(n.startswith("conformance/plus_") for n, _ in skipped))

    def test_fork_diff_and_lamp(self):
        f, _ = od.fork_units(ns(), None)
        self.assertEqual({u.name for u in f}, {p.stem for p in od.FORKDIFF.glob("*.bas") if p.stem != "common"})
        l, _ = od.lamp_units(ns(), None)
        self.assertEqual(sorted({u.name for u in l}), ["logic", "playthrough"])
        self.assertEqual(len(l), 4)

    def test_pattern_and_program_lookup(self):
        units, _ = od.build_units(ns(pattern="fork-diff/flow"), None)
        self.assertEqual({u.name for u in units}, {"flow"})
        self.assertEqual(od.program_suite(Path(od.FORKDIFF / "flow.bas")), ("fork-diff", "flow"))
        self.assertEqual(od.program_suite(Path(od.cf.CONFORMANCE_DIR / "arrays.bas")), ("conformance", "arrays"))
        with self.assertRaises(SystemExit):
            od.program_suite(Path("/tmp/x.bas"))

    def test_levels(self):
        self.assertEqual(od.LEVELS, ("0", "1", "2", "3", "s"))
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            od.main(["--all", "--level", "4"])


@unittest.skipUnless(od.CLI.is_file(), "the CLI is not built (npm run build)")
class WrongPass(unittest.TestCase):
    """--inject-bug: an optimised CLI build is followed by the deletion of the first `ld (_x), hl`; -O0 is untouched."""

    def build(self, level: str, source: str, wrong: bool = True, extra: tuple[str, ...] = ()):
        with tempfile.TemporaryDirectory() as t:
            src = Path(t) / "p.bas"
            src.write_text(source)
            out = Path(t) / "p.bin"
            cmd = ["node", str(od.CLI), str(src), "-o", str(out), "-D", "__CPC_PRINTER_ECHO__", "-O", level, *extra]
            p = (od.buggy_run if wrong else od._real_run)(cmd, capture_output=True, text=True)
            return p.returncode, out.read_bytes() if out.is_file() else b""

    def test_o0_is_untouched_and_optimised_builds_differ(self):
        prog = "DIM a AS INTEGER\na = 5\nPRINT a\n"
        rc0, bug0 = self.build("0", prog)
        _, plain0 = self.build("0", prog, wrong=False)
        rc2, bug2 = self.build("2", prog)
        # the wrong pass re-assembles the --asm text, which keeps every #include (L5-STRIP strips the image only): compare it with
        # the unstripped plain build
        _, plain2 = self.build("2", prog, wrong=False, extra=("--opt-disable", "strip"))
        self.assertEqual((rc0, rc2), (0, 0))
        self.assertEqual(bug0, plain0)  # -O0 is never touched
        self.assertNotEqual(bug2, plain2)
        self.assertLess(len(bug2), len(plain2))  # three bytes of ld (nn), hl

    def test_a_program_without_the_store_is_left_alone(self):
        od.BUG_LOG["no-store"].clear()
        rc, _ = self.build("2", "PRINT 1\n")
        self.assertEqual(rc, 0)
        self.assertEqual(od.BUG_LOG["no-store"], ["p.bas"])


if __name__ == "__main__":
    unittest.main()
