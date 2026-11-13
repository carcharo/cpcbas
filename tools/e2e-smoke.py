#!/usr/bin/env python3
"""e2e-smoke.py -- first bytes on a (virtual) CPC through cpcbas's own assembler and disc writer.

  1. compiles tests/e2e/hello.bas with the fork's `zxbc --arch cpc -f asm -D __CPC_PRINTER_ECHO__`;
  2. assembles the asm and writes HELLO.BIN on a .dsk with cpcbas (tools/e2e-assemble.mjs;
     needs `npm run build`);
  3. runs the .dsk on an emulated 464 and 6128 through cpcbuild's tools/cpcrun.py (its
     run_emulator for Caprice32, or run_cpcec for CPCEC; chipsrun has no disc, so it cannot
     take a .dsk), printer captured;
  4. diffs the capture (END marker line dropped, as cpcrun.py does) with tests/e2e/hello.expected.

    python3 tools/e2e-smoke.py [--fork DIR] [--cpcbuild DIR] [--emu cap32|cpcec]
                               [--models 464,6128] [--timeout S] [--keep DIR]

--fork and --cpcbuild default to zxbasic and cpcbuild beside the main checkout (two levels up
from a worktree's repo root: <root>/.worktrees/<name>, so the siblings are <root>/..).
Exit 0 when every model matches; 1 build/compile problem; 2 a run hung; 3 output differs;
4 no END marker.
"""
import argparse
import difflib
import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
E2E = REPO / "tests" / "e2e"


def default_sibling(name: str) -> Path:
    """<name> beside the repository, or beside the main checkout when run from a worktree."""
    here = REPO
    if here.parent.name == ".worktrees":
        here = here.parent.parent
    return here.parent / name


def load_cpcrun(cpcbuild: Path):
    path = cpcbuild / "tools" / "cpcrun.py"
    if not path.is_file():
        sys.exit(f"e2e-smoke: {path} not found (use --cpcbuild)")
    spec = importlib.util.spec_from_file_location("cpcrun", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["cpcrun"] = mod
    spec.loader.exec_module(mod)
    return mod


def compile_asm(fork: Path, bas: Path, out_asm: Path, env: dict) -> None:
    cmd = ["poetry", "run", "zxbc", "--arch", "cpc", "-f", "asm", "-D", "__CPC_PRINTER_ECHO__",
           "-o", str(out_asm), str(bas)]
    p = subprocess.run(cmd, cwd=fork, env=env, capture_output=True, text=True)
    if p.returncode != 0 or not out_asm.is_file():
        sys.stderr.write(p.stderr + p.stdout)
        sys.exit(f"e2e-smoke: zxbc failed (exit {p.returncode})")
    # machine-independent #line paths, as tests/e2e/hello.asm is committed
    text = out_asm.read_text(encoding="latin-1").replace(str(bas), "tests/e2e/hello.bas")
    out_asm.write_bytes(text.encode("latin-1"))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fork", type=Path, default=default_sibling("zxbasic"), help="the zxbasic fork checkout")
    ap.add_argument("--cpcbuild", type=Path, default=default_sibling("cpcbuild"), help="the cpcbuild checkout")
    ap.add_argument("--emu", choices=["cap32", "cpcec"], default="cap32")
    ap.add_argument("--models", default="464,6128")
    ap.add_argument("--timeout", type=float, default=30)
    ap.add_argument("--keep", type=Path, help="keep the build files and captures in this directory")
    args = ap.parse_args()
    fork = args.fork.resolve()
    if not (fork / "pyproject.toml").is_file():
        print(f"e2e-smoke: the zxbasic fork is not at {fork} (give its checkout with --fork DIR)", file=sys.stderr)
        return 1

    cpcrun = load_cpcrun(args.cpcbuild.resolve())
    env = cpcrun.subprocess_env()
    tmp = Path(tempfile.mkdtemp(prefix="e2e-smoke-"))
    try:
        asm, bin_, dsk = tmp / "hello.asm", tmp / "hello.bin", tmp / "hello.dsk"
        compile_asm(fork, E2E / "hello.bas", asm, env)
        committed = (E2E / "hello.asm").read_bytes()
        if committed != asm.read_bytes():
            print("e2e-smoke: note: tests/e2e/hello.asm differs from the fresh zxbc output (regenerate it)",
                  file=sys.stderr)
        p = subprocess.run(["node", str(REPO / "tools" / "e2e-assemble.mjs"), "--asm", str(asm), "--bin", str(bin_),
                            "--dsk", str(dsk), "--map", str(tmp / "hello.map"), "--name", "HELLO.BIN"],
                           capture_output=True, text=True)
        sys.stderr.write(p.stderr)
        if p.returncode != 0:
            print("e2e-smoke: cpcbas assemble/pack failed", file=sys.stderr)
            return 1
        print(f"assembled: {p.stdout.strip()}")

        expected = (E2E / "hello.expected").read_text(encoding="latin-1")
        worst = 0
        for model in args.models.split(","):
            printer = tmp / f"printer-{model}.dat"
            try:
                if args.emu == "cpcec":
                    cpcrun.run_cpcec(dsk, printer, args.timeout, env, model)
                else:
                    cpcrun.run_emulator(dsk, "HELLO", printer, args.timeout, env, model)
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
            if cpcrun.END_MARKER not in raw:
                print(f"{model}: FAIL no END marker; capture {raw!r}")
                worst = max(worst, 4)
                continue
            # as cpcrun.py: the marker is the last output; anything after it is junk
            text = raw.split(cpcrun.END_MARKER, 1)[0]
            if text == expected:
                print(f"{model}: PASS ({args.emu}) {len(text.splitlines())} lines match hello.expected")
            else:
                diff = list(difflib.unified_diff(expected.splitlines(keepends=True), text.splitlines(keepends=True),
                                                 "hello.expected", f"capture-{model}"))
                print(f"{model}: FAIL output differs; capture {text!r}")
                sys.stdout.writelines(diff)
                worst = max(worst, 3)
        if args.keep:
            for f in (asm, bin_, dsk, tmp / "hello.map"):
                shutil.copy(f, args.keep / f.name)
        return worst
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
