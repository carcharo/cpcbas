#!/usr/bin/env python3
"""opt-diff.py -- the emulator differential of the optimiser (L5-DIFF layer 3; development tooling, never part of `npm test`).

An optimisation is correct when the optimised program does what the unoptimised one does. This tool builds each program of the
emulator corpus at -O0 and at level L, runs both on the emulator the program's own gate uses, and compares what they print (and,
for the programs that compare screens, the screenshot). It does not use the blessed files: the -O0 build is the reference, and
the gates' own `--opt L` (loco-diff.py, conformance.py, fork-diff.py, lamp.py) check the optimised build against the
interpreter's and the fork's blessed output. Both are needed; neither blesses anything.

    python3 tools/opt-diff.py --all [--level L] [--suite loco,conformance,fork-diff,lamp] [--models 464,6128]
                              [--bare] [-k PATTERN] [-j N] [--timeout S] [--keep DIR]
    python3 tools/opt-diff.py --program tests/conformance/arrays.bas [--level L]

L is 0, 1, 2, 3 or s (default 2; `-O s` is accepted by the CLI once L5-0 has merged). The corpus, and where each program runs
("the way its own gate does"):

    loco         tests/loco, the programs of blessed.json that compile: CPCEC on a disc (464, 6128), Caprice32 for the programs
                 that type keys or write a disc (REM LOCO-TYPE, REM LOCO: cap32); REM LOCO: shot programs also compare the
                 screen pixel for pixel; --bare as loco-diff.py --bare (bare-skip programs left out)
    conformance  tests/conformance: chipsrun 464 and 6128 (-D __CPC_PRINTER_ECHO__ -D CPC464|CPC6128); the programs that need a
                 disc, and allow it, on CPCEC 6128 (the Plus rows are conformance.py --emu cpcec --model plus); typed-key programs
                 need Caprice32 and are listed as skipped
    fork-diff    tests/fork-diff: the cpcbas side, chipsrun 464 and 6128
    lamp         tests/games/lamplighter/tests/logic.bas and playthrough.bas: chipsrun 464 and 6128

The note "same image" marks a unit whose two builds are byte for byte the same program (every level emits -O0's code in wave 0, so
then a pass checks the harness and the emulators, not an optimiser). A unit passes when the two builds' transcripts (loco-diff's normaliser: line ends, END marker, `Ready`, `~` timing lines reduced
to `~`; conformance: the cleaned printer output, with the digits of every line but the PASS/FAIL/DONE protocol lines compared by
presence only: some print measurements) are equal, and the screenshots of a shot program too. A unit whose -O0 build or run
fails is "base-fail" (the gate itself does not pass at -O0). A difference is run once more, from fresh builds; if the second pair
agrees it is reported as "flaky" (and fails the run: a program whose output varies is not a differential).

    --inject-bug        TEST ONLY: the level-L build is made wrong on purpose (tools/opt-diff-bug.mjs deletes the first
                        `ld (_x), hl` from the asm and assembles the rest); the run must then FAIL. Shown once in the L5-DIFF report.

Exit codes: 0 every unit equal; 1 tool problem; 2 a run hung; 3 a difference; 5 a build was rejected (at the level asked for).
Needs `npm run build`, node, cpcbuild's tools/cpcrun.py (--cpcbuild) and its emulators, as the gates do.
"""
import argparse
import difflib
import hashlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
CLI = REPO / "packages" / "cpcbas" / "dist" / "bin" / "cpcbas.js"
BUG = HERE / "opt-diff-bug.mjs"
FORKDIFF = REPO / "tests" / "fork-diff"
LEVELS = ("0", "1", "2", "3", "s")
SUITES = ("loco", "conformance", "fork-diff", "lamp")
MODELS = ("464", "6128")


def load(name: str, file: str):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


# the gates, loaded by file name (their names have a dash); `cf` and `lamp` import cpcrun themselves when asked
ld = load("loco_diff", "loco-diff.py")
cf = load("conformance", "conformance.py")
lamp = load("lamp", "lamp.py")


@dataclass
class Outcome:
    """What one build-and-run produced. status: ok, not-compiled, hang, no-marker, error."""
    status: str
    text: str = ""
    shot: bytes | None = None
    detail: str = ""
    image: str = ""  # sha256 of the built program, when the build step can say


@dataclass
class Unit:
    suite: str
    name: str
    model: str
    emu: str
    run: Callable[[str], Outcome]  # level -> outcome
    shot: bool = False
    note: str = ""


@dataclass
class Result:
    unit: Unit
    status: str  # pass, DIFF, flaky, base-fail, not-compiled, hang, error, skipped
    seconds: float = 0.0
    detail: str = ""
    diff: str = ""
    same_image: bool = False


# ------------------------------------------------------------------------------------------------ the wrong pass (--inject-bug)

_real_run = subprocess.run
BUG_LOG: dict[str, list[str]] = {"applied": [], "no-store": []}  # --inject-bug: the builds the wrong pass changed, and those it could not


def _arg_after(cmd: list[str], flag: str) -> str | None:
    return cmd[cmd.index(flag) + 1] if flag in cmd and cmd.index(flag) + 1 < len(cmd) else None


def buggy_run(cmd, *args, **kwargs):
    """subprocess.run, except that a CLI build at an optimised level is followed by the deliberately wrong pass: the asm of the
    build is written (--asm), its first `ld (_x), hl` is deleted and the rest assembled over the build's output file."""
    if (isinstance(cmd, list) and len(cmd) > 2 and cmd[0] == "node" and cmd[1] == str(CLI) and "-O" in cmd
            and _arg_after(cmd, "-O") != "0" and "-o" in cmd):
        out = Path(_arg_after(cmd, "-o"))
        asm = out.with_suffix(".bug.asm")
        p = _real_run(cmd + ["--asm", str(asm)], *args, **kwargs)
        if p.returncode != 0 or not asm.is_file():
            return p
        src = next((c for c in cmd[2:] if c.endswith(".bas")), "prog.bas")
        bug = ["node", str(BUG), "--asm", str(asm), "--out", str(out), "--name", Path(src).stem.upper()[:8] + ".BIN"]
        for i, c in enumerate(cmd):
            if c == "-D" and i + 1 < len(cmd):
                bug += ["-D", cmd[i + 1]]
            elif c == "--org" and i + 1 < len(cmd):
                bug += ["--org", str(int(cmd[i + 1], 0))]
        q = _real_run(bug, *args, **{**kwargs, "capture_output": True, "text": True})
        if q.returncode not in (0, 3):
            return subprocess.CompletedProcess(bug, q.returncode, "", q.stderr + q.stdout)
        # 3: no store to delete in this program: the build stays as the CLI made it, and cannot be expected to differ
        BUG_LOG["no-store" if q.returncode == 3 else "applied"].append(Path(src).name)
        return p
    return _real_run(cmd, *args, **kwargs)


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else ""


# ------------------------------------------------------------------------------------------------ loco

def loco_units(args, cpcrun) -> tuple[list[Unit], list[tuple[str, str]]]:
    units: list[Unit] = []
    skipped: list[tuple[str, str]] = []
    for name in sorted(json.loads((ld.LOCO / "blessed.json").read_text())):
        bas = ld.LOCO / f"{name}.bas"
        if args.bare and (why := ld.bare_skip_reason(name)) is not None:
            skipped.append((f"loco/{name}", f"bare-skip: {why}"))
            continue
        headers = ld.headers_of(bas)
        emu = ld.pick_emu(args.emu, headers)
        stop = ld.bare_stop(name) if args.bare else None
        for model in args.models:
            def run(level: str, bas=bas, headers=headers, emu=emu, model=model, stop=stop) -> Outcome:
                return loco_run(cpcrun, bas, headers, emu, model, level, args, stop)
            units.append(Unit("loco", name, model, emu, run, shot=headers.shot))
    return units, skipped


def loco_run(cpcrun, bas: Path, headers, emu: str, model: str, level: str, args, stop) -> Outcome:
    tmp = Path(tempfile.mkdtemp(prefix="opt-diff-loco-"))
    try:
        try:
            dsk, stem = ld.build_compiled(cpcrun, bas, tmp, args.bare, headers=headers, opt=level)
        except ld.NotCompiled as exc:
            return Outcome("not-compiled", detail=(str(exc).splitlines() or [""])[0])
        out = Outcome("ok", image=sha(dsk))
        try:
            raw = ld.run_compiled(cpcrun, dsk, stem, model, emu, args.timeout, tmp, headers.typed, marker=headers.cap32)
        except ld.RunFailure as exc:
            stopped = ld.bare_stop_text(exc.seen or "", stop) if stop and exc.code == 2 else None
            if stopped is None:
                return Outcome("hang" if exc.code == 2 else "error", detail=str(exc), image=out.image)
            out.text = stopped  # a bare run that ends in its documented error: the text before the error
        else:
            text = ld.normalise(raw)
            if text is None:
                return Outcome("no-marker", text=raw, detail=f"no END marker; capture {raw[-80:]!r}", image=out.image)
            out.text = text
        if headers.shot:
            shot = tmp / "shot.png"
            sdsk, sstem = ld.build_compiled(cpcrun, bas, tmp, args.bare, echo=False, headers=headers, opt=level)
            try:
                ld.run_compiled(cpcrun, sdsk, sstem, model, emu, args.timeout, tmp, headers.typed, shot=shot, shot_wait=args.shot_wait)
            except ld.RunFailure as exc:
                return Outcome("error", text=out.text, detail=f"screenshot run: {exc}", image=out.image)
            out.shot = shot.read_bytes() if shot.is_file() else None
        return out
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# ------------------------------------------------------------------------------------------------ conformance (chipsrun, CPCEC)

def conformance_units(args, cpcrun) -> tuple[list[Unit], list[tuple[str, str]]]:
    units: list[Unit] = []
    skipped: list[tuple[str, str]] = []
    for bas in sorted(cf.CONFORMANCE_DIR.glob("*.bas")):
        h = cf.parse_headers(bas.read_text(encoding="latin-1"))
        runs: list[tuple[str, str]] = []
        for model in args.models:
            why = cf.plan(h, model, "chips", args.bare)
            if why is None:
                runs.append(("chips", model))
            elif why == "needs a disc (chips has none)" and cf.plan(h, "6128", "cpcec", args.bare) is None and ("cpcec", "6128") not in runs:
                runs.append(("cpcec", "6128"))
            elif why == "needs a disc (chips has none)":
                skipped.append((f"conformance/{bas.stem}", "needs a disc and Caprice32 (typed keys) or an emulator not allowed by EMUS"))
                break
            else:
                skipped.append((f"conformance/{bas.stem} {model}", why))
        for emu, model in runs:
            def run(level: str, bas=bas, emu=emu, model=model) -> Outcome:
                return conformance_run(cpcrun, bas, emu, model, level, args)
            units.append(Unit("conformance", bas.stem, model, emu, run))
    return units, skipped


def conformance_run(cpcrun, bas: Path, emu: str, model: str, level: str, args) -> Outcome:
    ns = argparse.Namespace(model=model, emu=emu, bare=args.bare, cold=False, org=None, timeout=args.timeout,
                            cpcbuild=args.cpcbuild, end_on_marker=False, opt=level)
    r = cf.run_one(bas, ns)
    if r.skip_reason is not None:
        return Outcome("error", detail=f"skipped: {r.skip_reason}")
    if r.exit_code == 1 and not r.output:
        return Outcome("not-compiled", detail=(r.stderr.strip().splitlines() or [""])[0])
    if r.exit_code == 2:
        return Outcome("hang", text=r.output, detail="timeout")
    if r.exit_code != 0:
        return Outcome("no-marker" if r.exit_code == 4 else "error", text=r.output, detail=r.stderr.strip()[-200:])
    return Outcome("ok", text=mask_measurements(r.output))


PROTOCOL = re.compile(r"^(?:PASS|FAIL|XFAIL|DONE)\b")
DIGITS = re.compile(r"[0-9]+")


def mask_measurements(text: str) -> str:
    """A conformance program judges itself by its PASS/FAIL/DONE lines; its other lines are information, and six programs
    print measurements there (ticks, frames, T-states, seconds: `cb_sprites`, `cb_tilerestore`, `cb_tiles`, `framehook`,
    `framehook_game`, `music`) that a faster build changes, sometimes wrapped onto a second line at 40 columns. So in every
    line that is not a protocol line each run of digits is compared by presence only (`#`), as loco-diff's `~` lines are
    (R18, follow-up 183f). The protocol lines and all other text are compared exactly."""
    return "\n".join(ln if PROTOCOL.match(ln) else DIGITS.sub("#", ln) for ln in text.split("\n"))


# ------------------------------------------------------------------------------------------------ fork-diff and Lamplighter (chipsrun)

def chips_run(cpcrun, src: Path, model: str, level: str, args, extra_defs: list[str] | None = None, org: bool = False) -> Outcome:
    """The cpcbas build of a program that prints through the printer, run on chipsrun: the way tools/conformance.py and
    tools/lamp.py run them."""
    with tempfile.TemporaryDirectory(prefix="opt-diff-chips-") as t:
        binf = Path(t) / "prog.bin"
        flag = {"464": "CPC464", "6128": "CPC6128"}[model]
        cmd = ["node", str(CLI)] + (["--org", "0x40"] if org else []) + [str(src), "-o", str(binf), "-D", "__CPC_PRINTER_ECHO__",
                                                                          "-D", flag] + [x for d in (extra_defs or []) for x in ("-D", d)] + ["-O", level]
        p = subprocess.run(cmd, capture_output=True, text=True, cwd=src.parent)
        if p.returncode != 0 or not binf.is_file():
            errs = [ln for ln in (p.stderr + p.stdout).splitlines() if "error" in ln.lower()]
            return Outcome("not-compiled", detail="; ".join(errs[:2]) or (p.stderr + p.stdout).strip()[-200:])
        ns = argparse.Namespace(model=model, timeout=args.timeout, cold=False, end_on_marker=False, cpcbuild=args.cpcbuild)
        code, out, err = cf.run_chips(cpcrun, binf, ns, cf.Headers())
        out = cf.clean_transcript(out)
        image = sha(binf)
        if code == 2:
            return Outcome("hang", text=out, detail="timeout", image=image)
        if code != 0:
            return Outcome("no-marker" if code == 4 else "error", text=out, detail=err.strip()[-200:], image=image)
        text = ld.normalise(out)
        return Outcome("ok", text=text if text is not None else out, image=image)


def fork_units(args, cpcrun) -> tuple[list[Unit], list[tuple[str, str]]]:
    units = []
    for bas in sorted(p for p in FORKDIFF.glob("*.bas") if p.stem != "common"):
        for model in args.models:
            units.append(Unit("fork-diff", bas.stem, model, "chips",
                              lambda level, bas=bas, model=model: chips_run(cpcrun, bas, model, level, args)))
    return units, []


def lamp_units(args, cpcrun) -> tuple[list[Unit], list[tuple[str, str]]]:
    units = []
    for prog in ("logic", "playthrough"):
        for model in args.models:
            units.append(Unit("lamp", prog, model, "chips",
                              lambda level, prog=prog, model=model: chips_run(cpcrun, lamp.TESTS / f"{prog}.bas", model, level, args, org=True)))
    return units, []


# ------------------------------------------------------------------------------------------------ comparing

def compare_outcomes(a: Outcome, b: Outcome, shot: bool) -> str | None:
    """None when the two builds behaved alike, else the first difference."""
    if a.text != b.text:
        want, got = a.text.splitlines(), b.text.splitlines()
        for i in range(max(len(want), len(got))):
            x = want[i] if i < len(want) else "<missing>"
            y = got[i] if i < len(got) else "<missing>"
            if x != y:
                return f"line {i + 1}: -O0 {x!r}, optimised {y!r}"
        return "the transcripts differ only in their line ends"
    if shot:
        if a.shot is None or b.shot is None:
            return "no screenshot from one of the builds"
        equal, detail, _ = ld.compare_shots(a.shot, b.shot)
        if not equal:
            return f"screen: {detail} (sha256 -O0 {hashlib.sha256(a.shot).hexdigest()[:12]}, optimised {hashlib.sha256(b.shot).hexdigest()[:12]})"
    return None


def text_diff(a: Outcome, b: Outcome) -> str:
    return "".join(difflib.unified_diff(a.text.splitlines(keepends=True), b.text.splitlines(keepends=True), "-O0", "optimised", n=2))


def judge(unit: Unit, level: str) -> Result:
    t0 = time.monotonic()
    try:
        base = unit.run("0")
        if base.status != "ok":
            return Result(unit, "base-fail", time.monotonic() - t0, f"-O0 {base.status}: {base.detail}")
        if level == "0":
            return Result(unit, "pass", time.monotonic() - t0, "level 0 against itself")
        opt = unit.run(level)
        same = bool(base.image) and base.image == opt.image
        if opt.status == "not-compiled":
            return Result(unit, "not-compiled", time.monotonic() - t0, f"-O{level}: {opt.detail}")
        if opt.status != "ok":
            return Result(unit, "hang" if opt.status == "hang" else "DIFF", time.monotonic() - t0, f"-O{level} {opt.status}: {opt.detail}",
                          text_diff(base, opt), same)
        why = compare_outcomes(base, opt, unit.shot)
        if why is None:
            return Result(unit, "pass", time.monotonic() - t0, "same image" if same else "", same_image=same)
        # once more from fresh builds: a program whose output varies from run to run is not a differential
        base2, opt2 = unit.run("0"), unit.run(level)
        if base2.status == "ok" and opt2.status == "ok" and compare_outcomes(base2, opt2, unit.shot) is None:
            return Result(unit, "flaky", time.monotonic() - t0, f"differed once ({why}), then agreed", same_image=same)
        return Result(unit, "DIFF", time.monotonic() - t0, why, text_diff(base, opt), same)
    except Exception as exc:  # a tool problem in one unit must not hide the others
        return Result(unit, "error", time.monotonic() - t0, f"{type(exc).__name__}: {exc}")


EXIT = {"pass": 0, "skipped": 0, "DIFF": 3, "flaky": 3, "base-fail": 1, "not-compiled": 5, "hang": 2, "error": 1}


def exit_code(statuses: list[str]) -> int:
    bad = [s for s in statuses if EXIT.get(s, 1) != 0]
    if not bad:
        return 0
    return 3 if ("DIFF" in bad or "flaky" in bad) else max(EXIT[s] for s in bad)


def summarise(results: list[Result], skipped: list[tuple[str, str]], level: str, seconds: float) -> str:
    lines = []
    if skipped:
        # one line per program: the per-model reasons of a program are joined
        merged: dict[str, list[str]] = {}
        for n, why in skipped:
            merged.setdefault(n.split(" ")[0], [])
            if why not in merged[n.split(" ")[0]]:
                merged[n.split(" ")[0]].append(why)
        lines.append("not run, on one model or on both (the program's own headers):")
        lines += [f"  {n}: {'; '.join(whys)}" for n, whys in sorted(merged.items())]
    w = max((len(f"{r.unit.suite}/{r.unit.name}") for r in results), default=10)
    lines.append(f"{'program'.ljust(w)}  model  emu     result        time   note")
    for r in results:
        lines.append(f"{(r.unit.suite + '/' + r.unit.name).ljust(w)}  {r.unit.model.ljust(5)}  {r.unit.emu.ljust(6)}  {r.status.ljust(12)}  {r.seconds:5.1f}s  {r.detail}")
    by: dict[tuple[str, str], list[str]] = {}
    for r in results:
        by.setdefault((r.unit.emu, r.unit.model), []).append(r.status)
    lines.append("")
    for (emu, model), sts in sorted(by.items()):
        lines.append(f"  {emu:6} {model:5} {sts.count('pass')}/{len(sts)} equal, {len(sts) - sts.count('pass')} not")
    n = len(results)
    # R17: a program skipped on one model may run on the other (`banks`: MODELS 6128 plus), so count the two cases apart
    ran = {f"{r.unit.suite}/{r.unit.name}" for r in results}
    names = {k.split(" ")[0] for k, _ in skipped}
    not_run, partly = names - ran, names & ran
    lines.append(f"-O0 against -O{level}: {sum(r.status == 'pass' for r in results)}/{n} equal, "
                 f"{sum(r.status in ('DIFF', 'flaky') for r in results)} differ, "
                 f"{sum(r.status == 'base-fail' for r in results)} base-fail, "
                 f"{sum(r.status == 'not-compiled' for r in results)} not compiled, "
                 f"{sum(r.status in ('hang', 'error') for r in results)} other; "
                 f"{sum(r.same_image for r in results)} with the same image as -O0 (not known for conformance); "
                 f"{len(not_run)} programs not run on any model, {len(partly)} on some models only; total {seconds:.0f}s")
    return "\n".join(lines)


def build_units(args, cpcrun) -> tuple[list[Unit], list[tuple[str, str]]]:
    units: list[Unit] = []
    skipped: list[tuple[str, str]] = []
    makers = {"loco": loco_units, "conformance": conformance_units, "fork-diff": fork_units, "lamp": lamp_units}
    for suite in args.suite:
        u, s = makers[suite](args, cpcrun)
        units += u
        skipped += s
    if args.pattern:
        units = [u for u in units if args.pattern in f"{u.suite}/{u.name}"]
        skipped = [(n, why) for n, why in skipped if args.pattern in n]
    return units, skipped


def program_suite(path: Path) -> tuple[str, str]:
    path = path.resolve()
    if path.parent == ld.LOCO.resolve():
        return "loco", path.stem
    if path.parent == cf.CONFORMANCE_DIR.resolve():
        return "conformance", path.stem
    if path.parent == FORKDIFF.resolve():
        return "fork-diff", path.stem
    if path.parent == lamp.TESTS.resolve():
        return "lamp", path.stem
    sys.exit(f"opt-diff: {path} is not in tests/loco, tests/conformance, tests/fork-diff or the Lamplighter tests")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--all", action="store_true", help="every program of every suite")
    ap.add_argument("--program", type=Path, metavar="FILE.bas", help="one program of the corpus")
    ap.add_argument("--level", choices=LEVELS, default="2", metavar="L", help="the optimisation level to test against -O0: 0 1 2 3 s (default 2)")
    ap.add_argument("--suite", default=",".join(SUITES), help=f"comma-separated: {', '.join(SUITES)} (default all)")
    ap.add_argument("--models", default=",".join(MODELS), help="comma-separated, from 464 and 6128 (default both)")
    ap.add_argument("--emu", choices=("cap32", "cpcec"), default=None, help="loco programs: this emulator instead of the gate's choice")
    ap.add_argument("--bare", action="store_true", help="bare-metal builds (loco and conformance), as the gates' --bare")
    ap.add_argument("-k", dest="pattern", default="", help="only programs whose suite/name contains this")
    ap.add_argument("-j", dest="jobs", type=int, default=1, help="parallel units (default 1: one emulator at a time)")
    ap.add_argument("--timeout", type=float, default=120, help="seconds of emulated time per run (default 120)")
    ap.add_argument("--shot-wait", type=float, default=ld.SHOT_WAIT)
    ap.add_argument("--keep", type=Path, help="write the two transcripts of every differing unit here")
    ap.add_argument("--inject-bug", action="store_true", help="TEST ONLY: make the optimised build wrong on purpose (the run must fail)")
    ap.add_argument("--cpcbuild", type=Path, default=ld.default_sibling("cpcbuild"))
    args = ap.parse_args(argv)
    if not (args.all or args.program):
        ap.error("give --all or --program FILE.bas")
    args.suite = [s for s in args.suite.split(",") if s]
    args.models = [m for m in args.models.split(",") if m]
    for s in args.suite:
        if s not in SUITES:
            ap.error(f"--suite: unknown suite {s!r}")
    for m in args.models:
        if m not in MODELS:
            ap.error(f"--models: {m!r} is not 464 or 6128")
    if not CLI.is_file():
        print("opt-diff: the CLI is not built (npm run build)", file=sys.stderr)
        return 1
    cpcrun = ld.load_cpcrun(args.cpcbuild.resolve())
    cf.load_cpcrun(args.cpcbuild)
    if "CPC_ROM_DIR" not in os.environ:
        rom = args.cpcbuild.resolve().parent / "caprice32" / "rom"
        if rom.is_dir():
            os.environ["CPC_ROM_DIR"] = str(rom)
    if args.inject_bug:
        if not BUG.is_file():
            print(f"opt-diff: {BUG} not found", file=sys.stderr)
            return 1
        subprocess.run = buggy_run  # type: ignore[assignment]
    if args.program:
        suite, name = program_suite(args.program)
        args.suite = [suite]
        args.pattern = f"{suite}/{name}"
    units, skipped = build_units(args, cpcrun)
    if args.program and not units:
        print(f"opt-diff: {args.program} is not in the corpus for these options (see the 'not run' list: {skipped})", file=sys.stderr)
        return 1
    t0 = time.monotonic()
    results: list[Result] = []
    with ThreadPoolExecutor(max_workers=max(1, args.jobs)) as ex:
        for r in ex.map(lambda u: judge(u, args.level), units):
            results.append(r)
            print(f"  {r.unit.suite}/{r.unit.name} {r.unit.model} ({r.unit.emu}): {r.status} ({r.seconds:.1f}s){' ' + r.detail if r.detail else ''}",
                  file=sys.stderr, flush=True)
    print(summarise(results, skipped, args.level, time.monotonic() - t0))
    if args.inject_bug:
        print(f"inject-bug: the wrong pass changed {len(BUG_LOG['applied'])} optimised builds and found no `ld (_x), hl` in {len(BUG_LOG['no-store'])}"
              f" (those cannot differ); {sum(r.status in ('DIFF', 'flaky') for r in results)} units differ")
    for r in results:
        if r.diff:
            print(f"\n--- {r.unit.suite}/{r.unit.name} {r.unit.model}\n{r.diff}", end="")
    return exit_code([r.status for r in results])


if __name__ == "__main__":
    sys.exit(main())
