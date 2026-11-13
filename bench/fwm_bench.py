#!/usr/bin/env python3
"""fwm_bench.py -- REAL speed of cpcbas against Locomotive BASIC (FWM-BENCH; development tooling).

Per-operation loops (1000 iterations of `y = a op b` or `y = f(a)`, minus the same loop with `y = a`), and
the two whole programs (bench/programs/float.bas, game.bas), each built three ways:

  loco      the program under the Locomotive interpreter (tools/loco-diff.py --interpret's disc)
  firmware  cpcbas, default (REAL through the firmware maths)
  bare      cpcbas -D CPC_BAREMETAL (the software calculator)

on CPCEC, models 464 and 6128. The clock is the CPC's own: TIME (300 Hz) in the interpreter and KL TIME PLEASE
in a firmware build (the same counter; cpcbas does not implement TIME yet, so a FUNCTION TICK() is appended to the
compiled source); a bare build has no firmware tick, so TICK() is the frame counter FH_FRAMES x 6 (50 Hz:
a resolution of 20 ms, which is 0.02 ms per operation over 1000 iterations). Nothing is estimated: each figure
is the median of --runs runs of the emulated CPC.

    python3 bench/fwm_bench.py --cpcbuild ../cpcbuild --work bench/_work    # everything (about 2 minutes), then the tables
    python3 bench/fwm_bench.py --cpcbuild ../cpcbuild --only add,sin --models 6128 --runs 1
    python3 bench/fwm_bench.py --programs only                         # the two whole programs
    python3 bench/fwm_bench.py --report bench/_work/results.json       # the tables again
Results: --work DIR/results.json (default bench/_work, git-ignored) and the Markdown tables on stdout.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import re
import shutil
import statistics
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.dont_write_bytecode = True


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


LD = load_module("loco_diff", REPO / "tools" / "loco-diff.py")

N = 1000
BUILDS = ("loco", "firmware", "bare")

# name, label, statement for the loop body, setup lines (after the common a, b), iterations
OPS = [
    ("base", "y=a", "y=a", "", N),
    ("add", "a+b", "y=a+b", "", N),
    ("sub", "a-b", "y=a-b", "", N),
    ("mul", "a*b", "y=a*b", "", N),
    ("div", "a/b", "y=a/b", "", N),
    ("pow", "a^b", "y=a^b", "", N),
    ("sqr", "SQR(a)", "y=SQR(a)", "", N),
    ("exp", "EXP(a)", "y=EXP(a)", "", N),
    ("log", "LOG(a)", "y=LOG(a)", "", N),
    ("log10", "LOG10(a)", "y=LOG10(a)", "", N),
    ("sin", "SIN(a)", "y=SIN(a)", "", N),
    ("cos", "COS(a)", "y=COS(a)", "", N),
    ("tan", "TAN(a)", "y=TAN(a)", "", N),
    ("atn", "ATN(a)", "y=ATN(a)", "", N),
    ("int", "INT(a)", "y=INT(a)", "", N),
    ("fix", "FIX(a)", "y=FIX(a)", "", N),
    ("cint", "CINT(a)", "y=CINT(a)", "", N),
    ("cmp", "a<b", "y=a<b", "", N),
    ("str", "STR$(a)", "s$=STR$(a)", "", N),
    ("val", "VAL(s$)", "y=VAL(s$)", 's$="1.2345"', N),
    ("rnd", "RND", "y=RND", "", N),
]

TICK_FN = """\

FUNCTION FASTCALL TICK() AS UINTEGER
#ifdef CPC_BAREMETAL
  ASM
  ld hl, (.core.FH_FRAMES)
  ld d, h
  ld e, l
  add hl, hl
  add hl, de
  add hl, hl
  END ASM
#else
  ASM
  call .core.__FW_CALL
  defw $BD0D
  END ASM
#endif
END FUNCTION
"""


def op_source(body: str, setup: str, n: int, build: str) -> str:
    clock = "TIME" if build == "loco" else "TICK()"
    lines = ["DEFREAL a-z", "DEFINT i", "a=1.2345:b=2.3456:y=0"] + ([setup] if setup else []) + [
        f"t={clock}", f"FOR i=1 TO {n}", body, "NEXT i", f"d={clock}-t", "IF d<0 THEN d=d+65536",
        'PRINT "~";d', "PRINT y", "END"]
    src = "".join(f"{10 * (k + 1)} {l}\n" for k, l in enumerate(lines))
    return src if build == "loco" else src + TICK_FN


def whole_source(path: Path, build: str) -> str:
    """The numbered program with TIME read through TICK() in a compiled build; TICK() deltas are unwrapped."""
    text = path.read_text()
    if build == "loco":
        return text
    text = re.sub(r"\bTIME\b", "TICK()", text)
    # d = e - t may wrap (16-bit tick): the programs print `e-t`; make that wrap-safe
    text = re.sub(r'PRINT "~";e-t', 'd=e-t:IF d<0 THEN d=d+65536:PRINT "~";d ELSE PRINT "~";d', text)
    return text + TICK_FN


# ---- raw entry + gate (firmware builds only) -------------------------------------------------------------------
# entry offsets of lib/loco/fwmath.asm (FWMO_*); the operands are 1.2345 (A) and 2.3456 (B) in Locomotive's layout
RAW_ENTRIES = [("add", "ADD", 0), ("sub", "RSUB", 2), ("mul", "MUL", 4), ("div", "DIV", 6), ("pow", "POW", 8),
               ("sqr", "SQR", 10), ("exp", "EXP", 12), ("log", "LOG", 14), ("log10", "LOG10", 16),
               ("sin", "SIN", 18), ("cos", "COS", 20), ("tan", "TAN", 22), ("atn", "ATN", 24),
               ("rnd", "RND", 26), ("angle", "ANGLE", 30)]


def real5(x: float) -> list[int]:
    """x (positive) as the firmware's five bytes: mantissa LSB first with the sign in bit 7 of byte 3, then the exponent."""
    import math
    e = math.floor(math.log2(x)) + 1          # x = 0.5..1 * 2^e
    m = round((x / 2.0 ** e * 2 - 1) * 2 ** 31)
    return [m & 255, m >> 8 & 255, m >> 16 & 255, m >> 24 & 127, 128 + e]


def raw_source(offset: int, n: int) -> str:
    a, b = real5(1.2345), real5(2.3456)
    db = lambda v: "defb " + ",".join(f"${x:02X}" for x in v)
    loop = lambda lvl, call: f"""
SUB Raw{lvl}()
  ASM
  push ix
  push iy
  call .core.__FWM_TBLHL
  ld de, {offset}
  add hl, de
  ld e, (hl)
  inc hl
  ld d, (hl)
  ld (.core.__FWM_T + 1), de
  jr RS{lvl}
RA{lvl}: {db(a)}
RB{lvl}: {db(b)}
RS{lvl}:
  ld bc, {n}
RL{lvl}:
  push bc
  ld hl, RA{lvl}
  ld de, .core.FWM_A
  ld bc, 5
  ldir
  ld hl, RB{lvl}
  ld de, .core.FWM_B
  ld bc, 5
  ldir
{call}
  pop bc
  dec bc
  ld a, b
  or c
  jr nz, RL{lvl}
  pop iy
  pop ix
  END ASM
END SUB
"""
    return f"""DIM a, b, y AS REAL
DIM t, e AS UINTEGER
DIM k AS UBYTE
a = 1.2345: b = 2.3456
y = a + b
{loop(0, "  nop")}
{loop(1, "  xor a" + chr(10) + "  call .core.__FWM_GATE")}
{loop(2, "  ld a, " + str(offset) + chr(10) + "  call .core.__FWM_CALL")}
t = TICK(): Raw0(): e = TICK(): PRINT "~"; e - t
t = TICK(): Raw1(): e = TICK(): PRINT "~"; e - t
t = TICK(): Raw2(): e = TICK(): PRINT "~"; e - t
FOR k = 0 TO 4: PRINT PEEK(40691 + k); " ";: NEXT k
PRINT
""" + TICK_FN


def parse(raw: str) -> tuple[list[int], str]:
    """The timing values (ticks, from the `~` lines) and the other output lines of a raw capture."""
    if LD.END_MARKER not in raw:
        raise RuntimeError(f"no END marker: {raw!r}")
    text = raw.split(LD.END_MARKER, 1)[0].replace("\r\n", "\n").replace("\r", "\n")
    if text.endswith("Ready"):
        text = text[:-5]
    times, rest = [], []
    for line in text.splitlines():
        if line.startswith("~"):
            times.append(int(float(line[1:].strip())))
        else:
            rest.append(line)
    return times, "\n".join(rest).strip()


class Runner:
    def __init__(self, cpcbuild: Path, work: Path, timeout: float):
        self.cpcrun = LD.load_cpcrun(cpcbuild.resolve())
        self.work, self.timeout = work, timeout
        work.mkdir(parents=True, exist_ok=True)

    def prepare(self, name: str, build: str, source: str) -> tuple[str, Path, str]:
        """Write the source and build the disc once; returns (kind, dsk, stem)."""
        d = self.work / f"{name}-{build}"
        shutil.rmtree(d, ignore_errors=True)
        d.mkdir(parents=True)
        (d / "in").mkdir()
        bas = d / "in" / "P.bas"
        bas.write_text(source)
        if build == "loco":
            dsk = d / "loco.dsk"
            p = subprocess.run(["node", str(REPO / "tools" / "loco-harness" / "build.mjs"), "--bas", str(bas),
                                "--dsk", str(dsk)], capture_output=True, text=True)
            if p.returncode != 0:
                raise RuntimeError(f"{name} loco disc: {p.stderr}")
            return "loco", dsk, "RUN"
        dsk, stem = LD.build_compiled(self.cpcrun, bas, d, bare=build == "bare")  # copies the source to d/<stem>.bas
        return "compiled", dsk, stem

    def run(self, prepared: tuple[str, Path, str], model: str) -> tuple[list[int], str]:
        kind, dsk, stem = prepared
        printer = dsk.parent / f"printer-{model}.dat"
        printer.unlink(missing_ok=True)
        env = self.cpcrun.subprocess_env()
        self.cpcrun.run_cpcec(dsk, printer, self.timeout, env, model)
        raw = printer.read_bytes().decode("latin-1") if printer.exists() else ""
        return parse(raw)


# ---- the report ------------------------------------------------------------------------------------------------
FORK = {  # cpcbuild bench/micro_results.md (2026-09-28): the fork's calculator route on Caprice32, 6128, ms per call
    "add": 0.88, "sub": 1.25, "mul": 1.95, "div": 2.56, "sin": 40.2, "cos": 42.5, "exp": 40.8, "atn": 62.8, "sqr": 112.1,
    "log": 66.9}


def med(res: dict, key: str, build: str, model: str, idx: int = 0) -> float:
    return statistics.median(run[idx] for run in res[key][build][model]["ticks"])


def per_op(res: dict, name: str, build: str, model: str) -> float:
    """ms per operation: (loop ticks - the y=a loop's ticks) / 300 Hz / N * 1000 (N = 1000)."""
    return (med(res, f"op:{name}", build, model) - med(res, "op:base", build, model)) / 300 * 1000 / N


def report(res: dict, old: dict | None) -> str:
    out = []
    ops = [o for o in OPS if o[0] != "base" and f"op:{o[0]}" in res]
    out.append("| operation | 464 loco | 464 firmware | 464 bare | 6128 loco | 6128 firmware | 6128 bare | fork (calculator, 2026-09-28) |")
    out.append("|---|---:|---:|---:|---:|---:|---:|---:|")
    for name, label, *_ in ops:
        cells = [f"{per_op(res, name, b, m):.2f}" for m in ("464", "6128") for b in BUILDS]
        out.append(f"| `{label}` | " + " | ".join(cells) + f" | {FORK[name]:.2f} |" if name in FORK else
                   f"| `{label}` | " + " | ".join(cells) + " | - |")
    out.append("")
    out.append("loop cost of `y=a` (ms per iteration, the subtracted base): " + "; ".join(
        f"{m} {b} {med(res, 'op:base', b, m) / 300 * 1000 / N:.3f}" for m in ("464", "6128") for b in BUILDS))
    out.append("")
    raws = [r for r in RAW_ENTRIES if f"raw:{r[0]}" in res]
    out.append("| entry | model | gate + entry | + `__FWM_CALL` | library `op` | op - (gate + entry) | within 0.1 ms | op - (`__FWM_CALL`) |")
    out.append("|---|---|---:|---:|---:|---:|---|---:|")
    for name, entry, off in raws:
        for m in ("464", "6128"):
            t = [med(res, f"raw:{name}", "firmware", m, i) for i in range(3)]
            g, c = (t[1] - t[0]) / 300 * 1000 / N, (t[2] - t[0]) / 300 * 1000 / N
            if f"op:{name}" in res:
                o = per_op(res, name, "firmware", m)
                out.append(f"| {entry} | {m} | {g:.3f} | {c:.3f} | {o:.3f} | {o - g:+.3f} | {'yes' if o - g <= 0.1 else 'no'} | {o - c:+.3f} |")
            else:
                out.append(f"| {entry} | {m} | {g:.3f} | {c:.3f} | - | - | - | - |")
    out.append("")
    out.append("| program | model | loco | firmware | bare | result (loco / firmware / bare) |")
    out.append("|---|---|---:|---:|---:|---|")
    for prog, parts in (("float", ["total"]), ("game", ["SIN/COS table", "2000 rotations"])):
        for m in ("464", "6128"):
            if f"prog:{prog}" not in res:
                continue
            for i, part in enumerate(parts):
                secs = [med(res, f"prog:{prog}", b, m, i) / 300 for b in BUILDS]
                outs = [res[f"prog:{prog}"][b][m]["output"][0] for b in BUILDS]
                out.append(f"| {prog} {part} | {m} | {secs[0]:.2f} s | {secs[1]:.2f} s | {secs[2]:.2f} s | "
                           + (" / ".join(f"`{o}`" for o in outs) if i == len(parts) - 1 else "") + " |")
    if old and "op:sqr" in res and "op:sqr" in old:
        out.append("")
        out.append("| SQR(a), ms per call | model | before FWM-CORE (2dd8c99) | now |")
        out.append("|---|---|---:|---:|")
        for b in ("firmware", "bare"):
            for m in ("464", "6128"):
                out.append(f"| {b} | {m} | {per_op(old, 'sqr', b, m):.2f} | {per_op(res, 'sqr', b, m):.2f} |")
    return "\n".join(out) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cpcbuild", type=Path, default=LD.default_sibling("cpcbuild"))
    ap.add_argument("--work", type=Path, default=HERE / "_work")
    ap.add_argument("--models", default="464,6128")
    ap.add_argument("--builds", default=",".join(BUILDS))
    ap.add_argument("--runs", type=int, default=2)
    ap.add_argument("--only", help="comma-separated operation names (base is always run)")
    ap.add_argument("--programs", choices=["yes", "no", "only"], default="yes", help="the two whole programs")
    ap.add_argument("--raw", choices=["yes", "no", "only"], default="yes", help="the raw entry + gate loops (firmware only)")
    ap.add_argument("--timeout", type=float, default=900, help="seconds of emulated time per run")
    ap.add_argument("--report", type=Path, metavar="RESULTS.json", help="print the Markdown tables of a results file and exit")
    ap.add_argument("--old", type=Path, metavar="RESULTS.json", help="with --report: the results of the pre-FWM-CORE CLI (SQR only)")
    ap.add_argument("--cli", type=Path, help="another cpcbas CLI (cli/dist/bin/cpcbas.js), e.g. a build of the pre-FWM-CORE commit")
    args = ap.parse_args()
    if args.cli:
        LD.CLI = args.cli.resolve()
    if args.report:
        sys.stdout.write(report(json.loads(args.report.read_text()), json.loads(args.old.read_text()) if args.old else None))
        return 0
    models, builds = args.models.split(","), args.builds.split(",")
    runner = Runner(args.cpcbuild, args.work, args.timeout)
    results: dict = {}
    out = args.work / "results.json"
    if out.is_file():
        results = json.loads(out.read_text())

    def record(key: str, build: str, model: str, times: list[list[int]], text: list[str]) -> None:
        results.setdefault(key, {}).setdefault(build, {})[model] = {"ticks": times, "output": text}
        out.write_text(json.dumps(results, indent=1))

    def measure(key: str, build: str, source: str) -> None:
        prepared = runner.prepare(key, build, source)
        for model in models:
            runs, texts = [], []
            for _ in range(args.runs):
                t, text = runner.run(prepared, model)
                runs.append(t)
                texts.append(text)
            record(key, build, model, runs, texts)
            print(f"{key:8} {build:8} {model:5} ticks {runs} -> {texts[0][:40]!r}", file=sys.stderr, flush=True)

    if args.programs != "only" and args.raw != "no":
        for name, label, offset in RAW_ENTRIES:
            if args.only and name not in args.only.split(","):
                continue
            measure(f"raw:{name}", "firmware", raw_source(offset, N))
    if args.programs != "only" and args.raw != "only":
        wanted = set(args.only.split(",")) | {"base"} if args.only else None
        for name, label, body, setup, n in OPS:
            if wanted and name not in wanted:
                continue
            for build in builds:
                measure(f"op:{name}", build, op_source(body, setup, n, build))
    if args.programs != "no" and args.raw != "only":
        for prog in ("float", "game"):
            for build in builds:
                measure(f"prog:{prog}", build, whole_source(HERE / "programs" / f"{prog}.bas", build))
    sys.stdout.write(report(results, json.loads(args.old.read_text()) if args.old else None))
    return 0


if __name__ == "__main__":
    sys.exit(main())
