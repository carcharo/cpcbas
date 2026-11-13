#!/usr/bin/env python3
"""speed.py -- cpcbas against the Boriel fork on emulated CPC time (L5-MEASURE; development tooling, never in `npm test`).

The six 2026-09-28 benchmarks (BM7, integer loop, sieve, float, strings, screen PRINT) and a game-shaped program are ONE
source each (bench/programs/speed/*.bas, in the subset common to both compilers, as tests/fork-diff). The same text is built by
the fork (`zxbc --arch cpc -O2`, cpcbuild's lib) and by cpcbas at each requested level, run on CPCEC (headless, the 6128 by
default) and timed by one shared function: `TICK()` (bench/programs/speed/tick.bas) reads KL TIME PLEASE, the firmware's 300 Hz
counter, through each compiler's firmware gate. Each program prints its checksum, and the checksums must agree between the
compilers (REALs to 8 significant digits: the compilers print 8 and 9). Nothing is estimated: CPCEC repeats tick counts exactly, so two runs of one build give the same figure, and any spread is reported as a FAULT.

    python3 bench/speed.py                                  # fork -O2 against cpcbas -O0, every program, 2 runs each
    python3 bench/speed.py --cpcbas-O 0,2,s --programs bm7,float
    python3 bench/speed.py --json speed.json --md speed.md
    python3 bench/speed.py --sim [--cpcbas-O 0,1,2,3,s]     # exact T-states of the compute kernels on the test Z80, no emulator
    python3 bench/speed.py --lamp [--cpcbas-O 0]            # Lamplighter's -D BENCH NOPACE rows (tools/lamp.py bench --fork)

Table columns: ticks (300 Hz), seconds, and cpcbas / fork. The target: cpcbas at -O2 within 1.10 x the fork at
-O2 on every program, and faster than the fork on the float programs.

The 2026-09-28 Caprice32 figures are history (cpcbuild bench/README.md); the fork is re-measured here so that both columns come
from one emulator.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import importlib.util
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
PROGRAMS_DIR = HERE / "programs" / "speed"
sys.dont_write_bytecode = True

LEVELS = ("0", "1", "2", "3", "s")
TICKS_PER_SECOND = 300
RATIO_LIMIT = 1.10
# (name, what, float program?) in the order of the 2026-09-28 table, then the game-shaped program
PROGRAMS = [
    ("bm7", "BM7 (800 outer iterations)", False),
    ("intloop", "integer loop (1500 iterations)", False),
    ("sieve", "sieve below 2000", False),
    ("float", "float (200 x SQR(i)*SIN(i)+i/3)", True),
    ("strings", "strings (2000 iterations)", False),
    ("screen", "screen PRINT (600 numbers)", False),
    ("game", "game-shaped (SIN/COS table, 2000 rotations)", True),
]
# significant digits at which the checksums of a program must agree: the game-shaped program rotates a point 2000 times, so the
# two calculators' last-digit differences grow to about 7 digits; everything else is compared to 8
CHECK_DIGITS = {"game": 6}
KNOWN_CHECKS = {("float", "chk"): "6688.08573"}  # the 2026-09-28 Locomotive value (9 digits)
NOECHO_MARK = "SPEED-NOECHO"  # a program with this word in its first lines is built without -D __CPC_PRINTER_ECHO__
END_MARKER = "\x04END\n"


def sibling(name: str) -> Path:
    here = REPO
    if here.parent.name == ".worktrees":
        here = here.parent.parent
    return here.parent / name


FORK = sibling("zxbasic")
CPCBUILD = sibling("cpcbuild")
CLI = REPO / "packages" / "cpcbas" / "dist" / "bin" / "cpcbas.js"


# ---------------------------------------------------------------- pure helpers (unit-tested)

def parse_levels(text: str) -> list[str]:
    """`0,2,s` -> ['0', '2', 's']; anything else is an error."""
    out = []
    for part in text.split(","):
        part = part.strip()
        if part not in LEVELS:
            raise ValueError(f"optimiser level '{part}' is not one of {', '.join(LEVELS)}")
        if part not in out:
            out.append(part)
    return out


def cpcbas_command(cli: Path, src: Path, out: Path, level: str, echo: bool) -> list[str]:
    """The CLI line of one cpcbas build: `-O L` for every level (`s` is passed as `-O s`, which the CLI takes from L5-0 on)."""
    cmd = ["node", str(cli), str(src)]
    if echo:
        cmd += ["-D", "__CPC_PRINTER_ECHO__"]
    return cmd + ["-O", level, "-o", str(out)]


def fork_command(src: Path, out_bin: Path, out_map: Path, level: int, echo: bool, lib: Path) -> list[str]:
    cmd = ["poetry", "run", "zxbc", "--arch", "cpc", "-I", str(lib), "-O", str(level)]
    if echo:
        cmd += ["-D", "__CPC_PRINTER_ECHO__"]
    return cmd + ["-M", str(out_map), "-o", str(out_bin), str(src)]


def wants_echo(source: str) -> bool:
    """Every program is built with the printer echo (its output and END marker reach the printer) except one that says
    SPEED-NOECHO in its first lines: it writes its own results to the printer."""
    return NOECHO_MARK not in "\n".join(source.splitlines()[:6])


LINE = re.compile(r"^(\w+)\s*\[\s*([^\]]*?)\s*\]\s*$")


def parse_output(raw: str) -> dict[str, str]:
    """The `NAME [value]` lines of a capture up to the END marker (spaces inside the brackets removed: cpcbas prints a
    number as ` 5 `), as an ordered dict. Raises ValueError without the marker."""
    if END_MARKER not in raw:
        raise ValueError(f"no END marker in the capture: {raw!r}")
    out: dict[str, str] = {}
    for line in raw.split(END_MARKER, 1)[0].replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        m = LINE.match(line.strip())
        if m:
            out[m.group(1)] = m.group(2).replace(" ", "")
    return out


def tick_keys(out: dict[str, str]) -> list[str]:
    """The timing entries of a parsed capture: T, or T1, T2 ... in order."""
    return [k for k in out if re.fullmatch(r"T\d*", k)]


NUMBER = re.compile(r"-?(?:\d+\.?\d*|\.\d+)(?:[Ee][+-]?\d+)?$")
WHOLE = re.compile(r"-?\d+$")


def numbers_close(a: str, b: str, digits: int = 8) -> bool:
    """Equal text, or two numbers (one at least with a fraction or exponent) within one unit of the 8th significant digit."""
    if a == b:
        return True
    if not (NUMBER.match(a) and NUMBER.match(b)) or (WHOLE.match(a) and WHOLE.match(b)):
        return False
    x, y = float(a), float(b)
    if x == y:
        return True
    big = max(abs(x), abs(y))
    return abs(x - y) <= 10.0 ** (math.floor(math.log10(big)) - digits + 1) * (1 + 1e-12)


def checks_agree(a: dict[str, str], b: dict[str, str], digits: int = 8) -> list[str]:
    """The names whose values differ between two parsed captures (timings excluded)."""
    keys = [k for k in a if k not in tick_keys(a)]
    bad = [k for k in keys if k not in b or not numbers_close(a[k], b[k], digits)]
    return bad + [k for k in b if k not in tick_keys(b) and k not in a]


def git_state() -> dict:
    """The commit of this checkout and whether the tree has uncommitted changes (the commit a figure was made at)."""
    def git(*a: str) -> str:
        p = subprocess.run(["git", "-C", str(REPO), *a], capture_output=True, text=True)
        return p.stdout.strip() if p.returncode == 0 else ""
    return {"commit": git("rev-parse", "HEAD"), "dirty": bool(git("status", "--porcelain", "--untracked-files=no"))}


def ratio(mine: int, fork: int) -> float:
    return mine / fork if fork else float("inf")


def verdict(r: float, is_float: bool) -> str:
    """The milestone's speed target: cpcbas within 1.10 x the fork, and faster than the fork on a float program."""
    if is_float:
        return "met" if r < 1.0 else "not met"
    return "met" if r <= RATIO_LIMIT + 1e-12 else "not met"


def spread(runs: list[list[int]]) -> bool:
    """True when the runs of one build do not all give the same ticks (CPCEC repeats exactly: that is a fault)."""
    return any(r != runs[0] for r in runs)


def geomean(values: list[float]) -> float:
    return math.exp(sum(math.log(v) for v in values) / len(values)) if values else float("nan")


# ---------------------------------------------------------------- building and running

def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


_CPCRUN = None


def cpcrun():
    global _CPCRUN
    if _CPCRUN is None:
        path = CPCBUILD / "tools" / "cpcrun.py"
        if not path.is_file():
            sys.exit(f"speed: {path} not found")
        os.environ.setdefault("ZXBASIC", str(FORK))
        os.environ.setdefault("CPC_ROM_DIR", str(sibling("caprice32") / "rom"))
        _CPCRUN = load_module("cpcrun", path)
    return _CPCRUN


class BuildFailed(Exception):
    pass


def stage(name: str, work: Path) -> Path:
    """A private directory holding the program and tick.bas, so that both compilers find `#include "tick.bas"`."""
    d = work / name
    shutil.rmtree(d, ignore_errors=True)
    d.mkdir(parents=True)
    shutil.copy(PROGRAMS_DIR / "tick.bas", d / "tick.bas")
    return d


def build(prog: str, side: str, level: str, work: Path) -> tuple[Path, str, int]:
    """Build one program with the fork (side `fork`, level 0-3) or cpcbas (side `cpcbas`, level 0-3 or s). Returns
    (dsk, AMSDOS stem, image bytes)."""
    cr = cpcrun()
    src_text = (PROGRAMS_DIR / f"{prog}.bas").read_text()
    echo = wants_echo(src_text)
    d = stage(f"{prog}-{side}-O{level}", work)
    stem = cr.amsdos_stem(Path(f"{prog}.bas"))
    src = d / f"{stem}.bas"
    src.write_text(src_text)
    dsk = d / f"{stem}.dsk"
    if side == "cpcbas":
        p = subprocess.run(cpcbas_command(CLI, src, dsk, level, echo), capture_output=True, text=True)
        if p.returncode != 0 or not dsk.is_file():
            raise BuildFailed(f"{prog} cpcbas -O{level}: {(p.stderr + p.stdout).strip()[:300]}")
        return dsk, stem, image_size(dsk, d, stem, src, level, echo)
    binf, mapf = d / "p.bin", d / "p.map"
    p = subprocess.run(fork_command(src, binf, mapf, int(level), echo, CPCBUILD / "lib"), cwd=FORK,
                       env=cr.subprocess_env(), capture_output=True, text=True)
    if p.returncode != 0 or not binf.is_file():
        raise BuildFailed(f"{prog} fork -O{level}: {(p.stderr + p.stdout).strip()[:300]}")
    m = re.search(r"^([0-9A-Fa-f]+): \.core\.__START_PROGRAM$", mapf.read_text(), re.M)
    if not m:
        raise BuildFailed(f"{prog} fork: no .core.__START_PROGRAM in the map")
    load = "0x" + m.group(1)
    p = subprocess.run([sys.executable, str(FORK / "tools" / "cpc" / "mkdsk.py"), "-o", str(dsk), "--load", load, "--exec", load,
                        "--name", f"{stem}.BIN", str(binf)], capture_output=True, text=True)
    if p.returncode != 0:
        raise BuildFailed(f"{prog} fork mkdsk: {p.stderr[:200]}")
    return dsk, stem, binf.stat().st_size


def image_size(dsk: Path, d: Path, stem: str, src: Path, level: str, echo: bool) -> int:
    """The image bytes of the cpcbas build (a second compile to .bin: the size column of the speed table)."""
    binf = d / "p.bin"
    p = subprocess.run(cpcbas_command(CLI, src, binf, level, echo), capture_output=True, text=True)
    if p.returncode != 0 or not binf.is_file():
        raise BuildFailed(f"{src.stem} cpcbas -O{level} .bin: {(p.stderr + p.stdout).strip()[:300]}")
    data = binf.read_bytes()
    return len(data) - 128


def run_once(dsk: Path, model: str, timeout: float, tag: str) -> str:
    cr = cpcrun()
    printer = dsk.parent / f"printer-{model}-{tag}.dat"
    printer.unlink(missing_ok=True)
    try:
        cr.run_cpcec(dsk, printer, timeout, cr.subprocess_env(), model)
    except cr.TimeoutHit:
        raise BuildFailed(f"{dsk.parent.name}: timeout after {timeout} emulated seconds") from None
    return printer.read_bytes().decode("latin-1") if printer.exists() else ""


def measure(prog: str, side: str, level: str, model: str, runs: int, timeout: float, work: Path) -> dict:
    """One build, `runs` emulator runs. Returns the record written to the JSON."""
    dsk, stem, image = build(prog, side, level, work)
    caps, ticks = [], []
    for k in range(runs):
        out = parse_output(run_once(dsk, model, timeout, str(k)))
        caps.append(out)
        ticks.append([int(out[t]) for t in tick_keys(out)])
    return {"program": prog, "side": side, "level": level, "model": model, "image": image, "runs": runs,
            "ticks": ticks, "keys": tick_keys(caps[0]), "checks": {k: v for k, v in caps[0].items() if k not in tick_keys(caps[0])},
            "checks_all": [{k: v for k, v in c.items() if k not in tick_keys(c)} for c in caps],
            "exact": not spread(ticks) and all(c == caps[0] for c in caps)}


# ---------------------------------------------------------------- the report

def seconds(ticks: int) -> str:
    return f"{ticks / TICKS_PER_SECOND:.2f}"


def report(rows: list[dict], cpcbas_levels: list[str], fork_level: str, model: str) -> str:
    by = {(r["program"], r["side"], r["level"]): r for r in rows}
    out = []
    head = ["program", "part", f"fork -O{fork_level} ticks", "s"] + [f"cpcbas -O{lv} ticks (cpcbas / fork)" for lv in cpcbas_levels] + ["target met at"]
    out.append(f"Emulated CPC time on CPCEC, model {model}: ticks of the firmware's 300 Hz counter (seconds = ticks / 300). "
               f"Target: cpcbas within {RATIO_LIMIT:.2f} x the fork, and faster than the fork on a float program.\n")
    out.append("| " + " | ".join(head) + " |")
    out.append("|---|---|---:|---:|" + "---:|" * len(cpcbas_levels) + "---|")
    ratios: dict[str, list[float]] = {lv: [] for lv in cpcbas_levels}
    faults = []
    for name, _what, is_float in PROGRAMS:
        f = by.get((name, "fork", fork_level))
        if not f:
            continue
        for i, key in enumerate(f["keys"]):
            ft = f["ticks"][0][i]
            cells = [name, key, str(ft), seconds(ft)]
            met = []
            for lv in cpcbas_levels:
                c = by.get((name, "cpcbas", lv))
                if not c:
                    cells.append("-")
                    continue
                ct = c["ticks"][0][i]
                r = ratio(ct, ft)
                ratios[lv].append(r)
                cells.append(f"{ct} ({r:.3f})")
                if verdict(r, is_float) == "met":
                    met.append(lv)
            cells.append(", ".join(f"-O{lv}" for lv in met) if met else "none")
            out.append("| " + " | ".join(cells) + " |")
    out.append("")
    out.append("Geometric mean of cpcbas / fork over the timed parts: " + "; ".join(
        f"-O{lv} {geomean(v):.3f}" for lv, v in ratios.items()))
    out.append("\nChecksums (the compilers must agree; REALs to 8 significant digits, the game-shaped program to 6: it rotates a point 2000 times):\n")
    out.append("| program | fork | cpcbas | agree | 2026-09-28 Locomotive |")
    out.append("|---|---|---|---|---|")
    for name, _what, _f in PROGRAMS:
        f = by.get((name, "fork", fork_level))
        if not f:
            continue
        for lv in cpcbas_levels:
            c = by.get((name, "cpcbas", lv))
            if not c:
                continue
            bad = checks_agree(f["checks"], c["checks"], CHECK_DIGITS.get(name, 8))
            ref = " ".join(f"{k}={v}" for (p, k), v in KNOWN_CHECKS.items() if p == name)
            refok = ""
            for (p, k), v in KNOWN_CHECKS.items():
                if p == name and k in f["checks"]:
                    refok = f" (fork {'agrees' if numbers_close(f['checks'][k], v) else 'DIFFERS'}, cpcbas {'agrees' if numbers_close(c['checks'].get(k, ''), v) else 'DIFFERS'})"
            out.append(f"| {name} -O{lv} | {' '.join(f'{k}={v}' for k, v in f['checks'].items())} | "
                       f"{' '.join(f'{k}={v}' for k, v in c['checks'].items())} | {'yes' if not bad else 'NO: ' + ','.join(bad)} | {ref}{refok} |")
    for r in rows:
        if not r["exact"]:
            faults.append(f"FAULT: {r['program']} {r['side']} -O{r['level']}: the {r['runs']} runs differ: {r['ticks']}")
    out.append("")
    out.append("Repeatability: " + ("every build gave identical ticks and output on each of its runs." if not faults else ""))
    out += faults
    out.append("\nImage bytes (org &0040, firmware build):\n")
    out.append("| program | fork -O" + fork_level + " | " + " | ".join(f"cpcbas -O{lv}" for lv in cpcbas_levels) + " |")
    out.append("|---|---:|" + "---:|" * len(cpcbas_levels))
    for name, _what, _f in PROGRAMS:
        f = by.get((name, "fork", fork_level))
        if f:
            out.append(f"| {name} | {f['image']} | " + " | ".join(str(by[(name, 'cpcbas', lv)]["image"]) if (name, 'cpcbas', lv) in by else "-" for lv in cpcbas_levels) + " |")
    return "\n".join(out) + "\n"


# ---------------------------------------------------------------- --sim and --lamp

def run_sim(levels: list[str], out: Path | None) -> int:
    """The compute kernels on the test Z80 (packages/cpcbas/test/bench/sim.bench.ts): exact T-states per level."""
    tmp = out or Path(tempfile.mkdtemp(prefix="speed-sim-")) / "sim.json"
    env = dict(os.environ, SIM_LEVELS=",".join(levels), SIM_OUT=str(tmp))
    p = subprocess.run(["npm", "run", "bench:sim"], cwd=REPO, env=env, capture_output=True, text=True)
    if p.returncode != 0 or not tmp.is_file():
        sys.stderr.write(p.stdout + p.stderr)
        return 1
    cells = json.loads(tmp.read_text())
    print(sim_table(cells, levels))
    return 0


def sim_table(cells: list[dict], levels: list[str]) -> str:
    kernels = list(dict.fromkeys(c["kernel"] for c in cells))
    out = ["| kernel | " + " | ".join(f"-O{lv} T-states" for lv in levels) + " | equal at every level |", "|---|" + "---:|" * len(levels) + "---|"]
    for k in kernels:
        vals = {c["level"]: c for c in cells if c["kernel"] == k}
        cs = [vals.get(lv, {}) for lv in levels]
        nums = [c.get("tstates") for c in cs]
        out.append(f"| {k} | " + " | ".join(str(n) if n is not None else "n/a (" + c.get("error", "not run")[:50] + ")" for n, c in zip(nums, cs)) +
                   " | " + ("yes" if len({n for n in nums if n is not None}) == 1 and None not in nums else "no") + " |")
    return "\n".join(out)


def run_lamp(levels: list[str]) -> int:
    rc = 0
    for lv in levels:
        for plus in (False, True):
            cmd = [sys.executable, str(REPO / "tools" / "lamp.py"), "bench", "--fork", "--opt", lv] + (["--plus"] if plus else [])
            print(f"$ {' '.join(cmd[1:])}", flush=True)
            p = subprocess.run(cmd, capture_output=True, text=True)
            print(p.stdout + p.stderr, flush=True)
            rc = rc or p.returncode
    return rc


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--programs", help="comma-separated names (default: all of " + ", ".join(p[0] for p in PROGRAMS) + ")")
    ap.add_argument("--cpcbas-O", default="0", dest="levels", help="cpcbas levels, a list of 0,1,2,3,s (default 0)")
    ap.add_argument("--fork-O", type=int, default=2, choices=(0, 1, 2, 3), dest="fork_o", help="the fork's level (default 2, its default)")
    ap.add_argument("--model", default="6128", choices=("464", "6128"))
    ap.add_argument("--runs", type=int, default=2, help="emulator runs of each build (default 2; they must agree exactly)")
    ap.add_argument("--timeout", type=float, default=300, help="emulated seconds before a run is a hang")
    ap.add_argument("--jobs", type=int, default=3)
    ap.add_argument("--work", type=Path, help="build directory (default: a temp dir, removed)")
    ap.add_argument("--json", type=Path, help="write every measurement here")
    ap.add_argument("--md", type=Path, help="also write the tables here")
    ap.add_argument("--sim", action="store_true", help="exact T-states of the compute kernels on the test Z80 (no emulator, no fork)")
    ap.add_argument("--lamp", action="store_true", help="Lamplighter's -D BENCH rows through tools/lamp.py bench --fork --opt L")
    args = ap.parse_args(argv)
    try:
        levels = parse_levels(args.levels)
    except ValueError as exc:
        ap.error(str(exc))
    if args.sim:
        return run_sim(levels, args.json)
    if args.lamp:
        return run_lamp(levels)
    if not CLI.is_file():
        print(f"speed: {CLI} missing; run `npm ci && npm run build` first", file=sys.stderr)
        return 1
    if not FORK.is_dir() or not shutil.which("poetry"):
        print(f"speed: need the fork checkout at {FORK} and poetry in the PATH", file=sys.stderr)
        return 1
    names = args.programs.split(",") if args.programs else [p[0] for p in PROGRAMS]
    unknown = [n for n in names if n not in {p[0] for p in PROGRAMS}]
    if unknown:
        ap.error(f"unknown program(s): {', '.join(unknown)}")
    work = args.work or Path(tempfile.mkdtemp(prefix="speed-"))
    work.mkdir(parents=True, exist_ok=True)
    jobs = [(n, "fork", str(args.fork_o)) for n in names] + [(n, "cpcbas", lv) for n in names for lv in levels]
    rows: list[dict] = []
    failed: list[str] = []

    def one(job):
        n, side, lv = job
        try:
            r = measure(n, side, lv, args.model, args.runs, args.timeout, work)
            print(f"{n:8} {side:6} -O{lv} ticks {r['ticks']} {r['checks']}", file=sys.stderr, flush=True)
            return r
        except BuildFailed as exc:
            failed.append(str(exc))
            print(f"{n:8} {side:6} -O{lv} FAILED {exc}", file=sys.stderr, flush=True)
            return None

    with concurrent.futures.ThreadPoolExecutor(args.jobs) as ex:
        rows = [r for r in ex.map(one, jobs) if r]
    if args.work is None:
        shutil.rmtree(work, ignore_errors=True)
    text = report(rows, levels, str(args.fork_o), args.model)
    if failed:
        text += "\nBuilds or runs that failed:\n\n" + "\n".join(f"- {f}" for f in failed) + "\n"
    print(text)
    if args.md:
        args.md.write_text(text)
    if args.json:
        args.json.write_text(json.dumps({**git_state(), "tool": "bench/speed.py", "model": args.model, "fork_level": args.fork_o, "cpcbas_levels": levels, "rows": rows}, indent=1))
    bad = failed or any(not r["exact"] for r in rows)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
