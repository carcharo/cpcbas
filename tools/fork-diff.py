#!/usr/bin/env python3
"""fork-diff.py -- cpcbas against the frozen Boriel BASIC fork (L2-FORKDIFF; development tooling, never in `npm test`).

The same program, written in the subset common to CPC BASIC and the fork's Boriel dialect, is built
by both compilers, both discs run on the emulator with the printer captured, the captures are
normalised and diffed.

    python3 tools/fork-diff.py --program tests/fork-diff/p.bas [--model 464|6128] [--emu cap32|cpcec]
    python3 tools/fork-diff.py --all [--model M] [--programs a,b] [--keep DIR]

fork side: `poetry run zxbc --arch cpc -D __CPC_PRINTER_ECHO__ -M map -o p.bin` in the fork checkout, packed
with the fork's own tools/cpc/mkdsk.py at the origin read from the map (as the fork's tools/cpc/run.sh does).
cpcbas side: the built CLI (`-D __CPC_PRINTER_ECHO__ -o p.dsk`), as tools/loco-diff.py --compiled.

Normaliser: loco-diff's `normalise` (line ends, END marker, trailing Ready),
then the bracket rule: inside every `[...]` one space at each end is removed (at most one), because
cpcbas prints a number as ` 5 ` and the fork as `5`. Programs print numbers as PRINT "[";x;"]" and never anything else
in brackets that depends on edge spaces.

REAL values (FWM-CORE): the two compilers print REALs differently (cpcbas 9 significant digits, Locomotive's rule: `1E+09`,
`0.0001`; the fork 8 digits and the Spectrum's: `1000000000`, `.0001`) and their calculators round differently, so a bracket that
holds a number with a fraction or an exponent on either side is compared as a number, to 8 significant digits
(`numbers_close`: one unit in the 8th digit, loco-diff's real rule). Brackets of whole numbers on both sides, and all text
outside the brackets, must match exactly.

Exit codes: 0 every compared model matches; 1 build/tool problem; 2 a run hung; 3 outputs differ;
4 no END marker; 5 a compiler rejected the program. A differing program is run again (once per side,
fresh build) before it is reported; both runs are shown if they disagree with each other.
"""
import argparse
import difflib
import importlib.util
import math
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
FORKDIFF = REPO / "tests" / "fork-diff"
MODELS = ("464", "6128")


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def default_sibling(name: str) -> Path:
    here = REPO
    if here.parent.name == ".worktrees":
        here = here.parent.parent
    return here.parent / name


BRACKET = re.compile(r"\[([^\[\]\n]*)\]")


def strip_edges(inner: str) -> str:
    """At most one space removed at each end: cpcbas's sign position and trailing space of a number.
    A second space is kept, so a doubled space on either side still shows as a difference."""
    if inner.startswith(" "):
        inner = inner[1:]
    if inner.endswith(" "):
        inner = inner[:-1]
    return inner


def normalise_forkdiff(raw: str, locodiff) -> str | None:
    """loco-diff's normaliser, then the bracket rule."""
    text = locodiff.normalise(raw)
    if text is None:
        return None
    return BRACKET.sub(lambda m: "[" + strip_edges(m.group(1)) + "]", text)


NUMBER = re.compile(r"-?(?:\d+\.?\d*|\.\d+)(?:[Ee][+-]?\d+)?$")
WHOLE = re.compile(r"-?\d+$")


def numbers_close(a: str, b: str) -> bool:
    """Two bracket contents that are numbers, at least one with a fraction or an exponent, agree to 8 significant digits."""
    if not (NUMBER.match(a) and NUMBER.match(b)) or (WHOLE.match(a) and WHOLE.match(b)):
        return False
    x, y = float(a), float(b)
    if x == y:
        return True
    big = max(abs(x), abs(y))
    return abs(x - y) <= 10.0 ** (math.floor(math.log10(big)) - 8 + 1) * (1 + 1e-12)


def transcripts_equal(fork: str, mine: str) -> bool:
    """Equal, or equal line by line with the REAL rule above applied inside the brackets."""
    if fork == mine:
        return True
    f, m = fork.split("\n"), mine.split("\n")
    if len(f) != len(m):
        return False
    for a, b in zip(f, m):
        if a == b:
            continue
        ta, tb = BRACKET.split(a), BRACKET.split(b)  # text, inside, text, inside, ..., text
        if len(ta) != len(tb):
            return False
        for i, (x, y) in enumerate(zip(ta, tb)):
            if x != y and (i % 2 == 0 or not numbers_close(x, y)):
                return False
    return True


class Rejected(Exception):
    def __init__(self, side: str, message: str):
        super().__init__(f"{side}: {message}")
        self.side = side


def build_fork(cpcrun, fork: Path, bas: Path, tmp: Path) -> tuple[Path, str]:
    stem = cpcrun.amsdos_stem(bas)
    binf, mapf, dsk = tmp / "fork.bin", tmp / "fork.map", tmp / "fork.dsk"
    env = cpcrun.subprocess_env()
    p = subprocess.run(["poetry", "run", "zxbc", "--arch", "cpc", "-D", "__CPC_PRINTER_ECHO__",
                        "-M", str(mapf), "-o", str(binf), str(bas)],
                       cwd=fork, env=env, capture_output=True, text=True)
    if p.returncode != 0 or not binf.is_file():
        raise Rejected("fork", (p.stderr + p.stdout).strip() or f"zxbc exit {p.returncode}")
    m = re.search(r"^([0-9A-Fa-f]+): \.core\.__START_PROGRAM$", mapf.read_text(), re.M)
    if not m:
        raise Rejected("fork", "no .core.__START_PROGRAM in the map")
    load = "0x" + m.group(1)
    p = subprocess.run([sys.executable, str(fork / "tools" / "cpc" / "mkdsk.py"), "-o", str(dsk), "--load", load,
                        "--exec", load, "--name", f"{stem}.BIN", str(binf)], capture_output=True, text=True)
    if p.returncode != 0:
        raise Rejected("fork", "mkdsk failed: " + p.stderr)
    return dsk, stem


def build_cpcbas(locodiff, cpcrun, bas: Path, tmp: Path) -> tuple[Path, str]:
    sub = tmp / "cpcbas"
    sub.mkdir()
    for inc in bas.parent.glob("*.bas"):
        if inc != bas and inc.name == "common.bas":  # #include "common.bas": build_compiled copies only the program
            shutil.copy(inc, sub / inc.name)
    try:
        return locodiff.build_compiled(cpcrun, bas, sub)
    except locodiff.NotCompiled as exc:
        raise Rejected("cpcbas", str(exc)) from None


def run_side(locodiff, cpcrun, dsk, stem, model, emu, timeout, tmp):
    return locodiff.run_compiled(cpcrun, dsk, stem, model, emu, timeout, tmp)


def compare_once(ctx, bas: Path, model: str, keep: Path | None) -> dict:
    """One fresh build of each side and one run on `model`."""
    locodiff, cpcrun = ctx["locodiff"], ctx["cpcrun"]
    tmp = Path(tempfile.mkdtemp(prefix="fork-diff-"))
    res = {"status": "pass", "detail": "", "diff": "", "fork": None, "cpcbas": None}
    try:
        try:
            fdsk, fstem = build_fork(cpcrun, ctx["fork"], bas, tmp)
            cdsk, cstem = build_cpcbas(locodiff, cpcrun, bas, tmp)
        except Rejected as exc:
            first = next((l for l in str(exc).splitlines() if "rror" in l), str(exc).splitlines()[0])
            res.update(status="rejected", detail=f"{exc.side}: {first}", diff=str(exc))
            return res
        texts = {}
        for side, dsk, stem in (("fork", fdsk, fstem), ("cpcbas", cdsk, cstem)):
            try:
                raw = run_side(locodiff, cpcrun, dsk, stem, model, ctx["emu"], ctx["timeout"], tmp)
            except locodiff.RunFailure as exc:
                res.update(status="hang" if exc.code == 2 else "error", detail=f"{side}: {exc}")
                return res
            if keep:
                keep.mkdir(parents=True, exist_ok=True)
                shutil.copy(dsk, keep / f"{bas.stem}.{side}.{model}.dsk")
                (keep / f"{bas.stem}.{side}.{model}.raw").write_bytes(raw.encode("latin-1"))
            text = normalise_forkdiff(raw, locodiff)
            if text is None:
                res.update(status="no-marker", detail=f"{side}: no END marker; capture {raw!r}")
                return res
            texts[side] = text
        res["fork"], res["cpcbas"] = texts["fork"], texts["cpcbas"]
        if not transcripts_equal(texts["fork"], texts["cpcbas"]):
            res.update(status="differ", detail=locodiff.first_difference(texts["fork"], texts["cpcbas"]),
                       diff="".join(difflib.unified_diff(texts["fork"].splitlines(keepends=True),
                                                         texts["cpcbas"].splitlines(keepends=True),
                                                         f"{bas.stem}.fork", f"{bas.stem}.cpcbas")))
        return res
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def compare(ctx, bas: Path, model: str, keep: Path | None) -> dict:
    """compare_once; a differing result is re-run once and reported with `stable` = both runs agree."""
    t0 = time.monotonic()
    r = compare_once(ctx, bas, model, keep)
    if r["status"] == "differ":
        r2 = compare_once(ctx, bas, model, keep)
        r["stable"] = r2["status"] == "differ" and (r2["fork"], r2["cpcbas"]) == (r["fork"], r["cpcbas"])
        r["detail"] += "  [same on a second run]" if r["stable"] else f"  [second run: {r2['status']} {r2['detail']}]"
    r["seconds"] = time.monotonic() - t0
    return r


CODES = {"pass": 0, "differ": 3, "rejected": 5, "hang": 2, "no-marker": 4, "error": 1}


def worst(statuses: list[str]) -> int:
    bad = [s for s in statuses if s != "pass"]
    if not bad:
        return 0
    return 3 if "differ" in bad else max(CODES[s] for s in bad)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--program", type=Path)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--programs", help="with --all: comma-separated names")
    ap.add_argument("--model", choices=MODELS)
    ap.add_argument("--emu", choices=["cap32", "cpcec"], default="cap32")
    ap.add_argument("--timeout", type=float, default=30)
    ap.add_argument("--keep", type=Path)
    ap.add_argument("--show", action="store_true", help="print the normalised transcript of a passing program")
    ap.add_argument("--fork", type=Path, default=default_sibling("zxbasic"))
    ap.add_argument("--cpcbuild", type=Path, default=default_sibling("cpcbuild"))
    ap.add_argument("--opt", choices=("0", "1", "2", "3", "s"), default=None, metavar="L",
                    help="build the cpcbas side at optimisation level L (0, 1, 2, 3 or s): `-O L`; the fork side is unchanged")
    args = ap.parse_args()
    if not (args.program or args.all):
        ap.error("give --program FILE.bas or --all")
    cli = REPO / "packages" / "cpcbas" / "dist" / "bin" / "cpcbas.js"
    if not cli.is_file():
        print("fork-diff: the CLI is not built (npm run build)", file=sys.stderr)
        return 1
    if not (args.fork.resolve() / "pyproject.toml").is_file():
        print(f"fork-diff: the zxbasic fork is not at {args.fork.resolve()} (give its checkout with --fork DIR)", file=sys.stderr)
        return 1
    if not (args.cpcbuild.resolve() / "tools" / "cpcrun.py").is_file():
        print(f"fork-diff: {args.cpcbuild.resolve() / 'tools' / 'cpcrun.py'} not found (use --cpcbuild)", file=sys.stderr)
        return 1
    cpcrun = _load("cpcrun", args.cpcbuild.resolve() / "tools" / "cpcrun.py")
    locodiff = _load("loco_diff", REPO / "tools" / "loco-diff.py")
    locodiff.OPT = args.opt
    ctx = {"cpcrun": cpcrun, "locodiff": locodiff, "fork": args.fork.resolve(), "emu": args.emu, "timeout": args.timeout}
    models = [args.model] if args.model else list(MODELS)
    if args.all:
        progs = sorted(p for p in FORKDIFF.glob("*.bas") if p.stem != "common")
        if args.programs:
            want = args.programs.split(",")
            progs = [p for p in progs if p.stem in want]
    else:
        progs = [args.program.resolve()]
    rows, statuses, diffs = [], [], []
    t_all = time.monotonic()
    for bas in progs:
        for model in models:
            r = compare(ctx, bas, model, args.keep)
            statuses.append(r["status"])
            rows.append((bas.stem, model, r["status"], r["seconds"], r["detail"]))
            if r["diff"]:
                diffs.append((bas.stem, model, r["diff"]))
            if args.show and r["status"] == "pass":
                sys.stdout.write(r["fork"])
            print(f"  {bas.stem} {model}: {r['status']} ({r['seconds']:.1f}s)", file=sys.stderr, flush=True)
    w = max(len(n) for n, *_ in rows)
    print(f"{'program'.ljust(w)}  model  result    time   first differing line / note")
    for name, model, status, secs, detail in rows:
        print(f"{name.ljust(w)}  {model.ljust(5)}  {status.ljust(8)}  {secs:5.1f}s  {detail}")
    print(f"{statuses.count('pass')}/{len(statuses)} match; total {time.monotonic() - t_all:.0f}s")
    for name, model, diff in diffs:
        print(f"\n--- {name} {model}\n{diff}", end="")
    return worst(statuses)


if __name__ == "__main__":
    sys.exit(main())
