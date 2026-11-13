#!/usr/bin/env python3
"""e2e-cpcbas.py -- tests/loco/hello.bas built by the cpcbas CLI and run on an emulated CPC.

  1. builds the program with the built CLI:
         node packages/cpcbas/dist/bin/cpcbas.js tests/loco/hello.bas -D __CPC_PRINTER_ECHO__ -o hello.dsk
     (needs `npm run build`);
  2. runs the .dsk through cpcbuild's tools/cpcrun.py (run_emulator for Caprice32, run_cpcec for
     CPCEC) on each model with the printer captured;
  3. normalises the capture with tools/loco-diff.py's `normalise` and compares it with
     tests/loco/hello.expected; both transcripts are printed.

    python3 tools/e2e-cpcbas.py [--cpcbuild DIR] [--emu cap32|cpcec] [--models 464,6128]
                                [--timeout S] [--keep DIR] [--program tests/loco/hello.bas]

Exit 0 when every model matches; 1 build problem; 2 a run hung; 3 output differs; 4 no END marker.
"""
import argparse
import difflib
import importlib.util
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CLI = REPO / "packages" / "cpcbas" / "dist" / "bin" / "cpcbas.js"


def default_sibling(name: str) -> Path:
    here = REPO
    if here.parent.name == ".worktrees":
        here = here.parent.parent
    return here.parent / name


def load_module(name: str, path: Path):
    if not path.is_file():
        sys.exit(f"e2e-cpcbas: {path} not found")
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cpcbuild", type=Path, default=default_sibling("cpcbuild"), help="the cpcbuild checkout")
    ap.add_argument("--emu", choices=["cap32", "cpcec"], default="cap32")
    ap.add_argument("--models", default="464,6128")
    ap.add_argument("--timeout", type=float, default=30)
    ap.add_argument("--keep", type=Path, help="keep the build files and captures in this directory")
    ap.add_argument("--program", type=Path, default=REPO / "tests" / "loco" / "hello.bas")
    args = ap.parse_args()

    cpcrun = load_module("cpcrun", args.cpcbuild.resolve() / "tools" / "cpcrun.py")
    locodiff = load_module("loco_diff", REPO / "tools" / "loco-diff.py")
    bas = args.program.resolve()
    expected = bas.with_suffix(".expected").read_text(encoding="latin-1")
    stem = bas.stem.upper()
    env = cpcrun.subprocess_env()
    tmp = Path(tempfile.mkdtemp(prefix="e2e-cpcbas-"))
    try:
        dsk = tmp / f"{bas.stem}.dsk"
        cmd = ["node", str(CLI), str(bas), "-D", "__CPC_PRINTER_ECHO__", "-o", str(dsk),
               "-M", str(tmp / "prog.map"), "--asm", str(tmp / "prog.asm")]
        print("build:", " ".join(cmd))
        p = subprocess.run(cmd, capture_output=True, text=True)
        sys.stderr.write(p.stderr)
        sys.stdout.write(p.stdout)
        if p.returncode != 0 or not dsk.is_file():
            print(f"e2e-cpcbas: cpcbas failed (exit {p.returncode})", file=sys.stderr)
            return 1

        worst = 0
        for model in args.models.split(","):
            printer = tmp / f"printer-{model}.dat"
            try:
                if args.emu == "cpcec":
                    cpcrun.run_cpcec(dsk, printer, args.timeout, env, model)
                else:
                    cpcrun.run_emulator(dsk, stem, printer, args.timeout, env, model)
            except cpcrun.TimeoutHit:
                print(f"{model}: FAIL timeout after {args.timeout}s (hang)")
                worst = max(worst, 2)
                continue
            except cpcrun.BuildError as exc:
                print(f"{model}: FAIL {exc}")
                worst = max(worst, 1)
                continue
            raw = printer.read_bytes().decode("latin-1") if printer.exists() else ""
            if args.keep:
                args.keep.mkdir(parents=True, exist_ok=True)
                (args.keep / f"printer-{model}.raw").write_bytes(raw.encode("latin-1"))
            print(f"{model}: raw capture {raw!r}")
            text = locodiff.normalise(raw)
            if text is None:
                print(f"{model}: FAIL no END marker")
                worst = max(worst, 4)
                continue
            print(f"{model}: normalised {text!r}")
            if text == expected:
                print(f"{model}: PASS ({args.emu}) {len(text.splitlines())} lines match {bas.stem}.expected")
            else:
                diff = difflib.unified_diff(expected.splitlines(keepends=True), text.splitlines(keepends=True),
                                            f"{bas.stem}.expected", f"capture-{model}")
                print(f"{model}: FAIL output differs")
                sys.stdout.writelines(diff)
                worst = max(worst, 3)
        if args.keep:
            for f in (dsk, tmp / "prog.map", tmp / "prog.asm"):
                shutil.copy(f, args.keep / f.name)
        return worst
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
