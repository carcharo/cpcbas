#!/usr/bin/env python3
"""e2e-bare.py -- bare-metal (-D CPC_BAREMETAL) builds of the L2 subset on Caprice32.

For each program (default: tests/loco/hello.bas, int-print.bas, bare-text.bas):

  1. builds it with the built CLI (needs `npm run build`):
         node packages/cpcbas/dist/bin/cpcbas.js P.bas -D CPC_BAREMETAL -D __CPC_PRINTER_ECHO__ -o P.dsk
         node packages/cpcbas/dist/bin/cpcbas.js P.bas -D CPC_BAREMETAL -D CPC_OWNFONT -D __CPC_PRINTER_ECHO__ -o P.cpr
  2. runs the disc (firmware boots, then the program's bare prologue takes over) on the 464 and the
     6128, and the cartridge (cold start, no firmware, own font) on the 6128 Plus, through
     cpcbuild's tools/cpcrun.py (Caprice32, printer captured);
  3. normalises the capture with tools/loco-diff.py's `normalise` and compares it with
     tests/loco/<name>.expected (what the Locomotive interpreter printed; the same file the
     firmware-mode run is held to by tools/e2e-cpcbas.py). Both transcripts are printed.

    python3 tools/e2e-bare.py [--cpcbuild DIR] [--timeout S] [--keep DIR] [--firmware]
                              [--starts dsk464,dsk6128,cpr] [programs ...]

--firmware also builds each program without -D CPC_BAREMETAL and runs it on the 6128, as a control.
Exit 0 when every run matches; 1 build problem; 2 a run hung; 3 output differs; 4 no END marker.
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
DEFAULT_PROGRAMS = ["hello", "int-print", "bare-text"]
STARTS = {"dsk464": ("464", "dsk"), "dsk6128": ("6128", "dsk"), "cpr": ("plus", "cpr")}


def default_sibling(name: str) -> Path:
    here = REPO
    if here.parent.name == ".worktrees":
        here = here.parent.parent
    return here.parent / name


def load_module(name: str, path: Path):
    if not path.is_file():
        sys.exit(f"e2e-bare: {path} not found")
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def build(bas: Path, out: Path, defines: list[str]) -> bool:
    cmd = ["node", str(CLI), str(bas), "-o", str(out), "-M", str(out.with_suffix(".map")), "--asm", str(out.with_suffix(".asm"))]
    for d in defines:
        cmd += ["-D", d]
    print("build:", " ".join(cmd))
    p = subprocess.run(cmd, capture_output=True, text=True)
    sys.stderr.write(p.stderr)
    sys.stdout.write(p.stdout)
    return p.returncode == 0 and out.is_file()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("programs", nargs="*", help="program names under tests/loco (default: hello int-print bare-text)")
    ap.add_argument("--cpcbuild", type=Path, default=default_sibling("cpcbuild"), help="the cpcbuild checkout")
    ap.add_argument("--timeout", type=float, default=30)
    ap.add_argument("--keep", type=Path, help="keep the build files and raw captures in this directory")
    ap.add_argument("--firmware", action="store_true", help="also run the firmware-mode build on the 6128 as a control")
    ap.add_argument("--starts", default="dsk464,dsk6128,cpr")
    args = ap.parse_args()

    cpcrun = load_module("cpcrun", args.cpcbuild.resolve() / "tools" / "cpcrun.py")
    locodiff = load_module("loco_diff", REPO / "tools" / "loco-diff.py")
    env = cpcrun.subprocess_env()
    tmp = Path(tempfile.mkdtemp(prefix="e2e-bare-"))
    worst = 0
    try:
        for name in args.programs or DEFAULT_PROGRAMS:
            bas = (REPO / "tests" / "loco" / f"{name}.bas").resolve()
            expected = bas.with_suffix(".expected").read_text(encoding="latin-1")
            stem = bas.stem.upper()[:8]  # the disc file is NAME.BIN, 8 characters at most
            runs = []  # (label, model, file, is_cpr)
            echo = "__CPC_PRINTER_ECHO__"
            for start in args.starts.split(","):
                model, kind = STARTS[start]
                out = tmp / f"{bas.stem}-bare-{start}.{kind}"
                defs = ["CPC_BAREMETAL", echo] + (["CPC_OWNFONT"] if kind == "cpr" else [])
                if not build(bas, out, defs):
                    print(f"{name} {start}: FAIL build")
                    worst = max(worst, 1)
                    continue
                runs.append((f"bare {start}", model, out, kind == "cpr"))
            if args.firmware:
                out = tmp / f"{bas.stem}-fw.dsk"
                if build(bas, out, [echo]):
                    runs.append(("firmware 6128", "6128", out, False))
            for label, model, f, is_cpr in runs:
                tag = f"{name} [{label}]"
                printer = tmp / f"printer-{f.stem}.dat"
                try:
                    if is_cpr:
                        cpcrun.run_emulator(None, stem, printer, args.timeout, env, model, cpr_path=f)
                    else:
                        cpcrun.run_emulator(f, stem, printer, args.timeout, env, model)
                except cpcrun.TimeoutHit:
                    print(f"{tag}: FAIL timeout after {args.timeout}s (hang)")
                    worst = max(worst, 2)
                    continue
                except cpcrun.BuildError as exc:
                    print(f"{tag}: FAIL {exc}")
                    worst = max(worst, 1)
                    continue
                raw = printer.read_bytes().decode("latin-1") if printer.exists() else ""
                if args.keep:
                    args.keep.mkdir(parents=True, exist_ok=True)
                    (args.keep / f"{f.stem}.raw").write_bytes(raw.encode("latin-1"))
                    shutil.copy(f, args.keep / f.name)
                    for ext in (".map", ".asm"):
                        if f.with_suffix(ext).is_file():
                            shutil.copy(f.with_suffix(ext), args.keep / f.with_suffix(ext).name)
                print(f"{tag}: raw capture {raw!r}")
                text = locodiff.normalise(raw)
                if text is None:
                    print(f"{tag}: FAIL no END marker")
                    worst = max(worst, 4)
                    continue
                print(f"{tag}: normalised {text!r}")
                if text == expected:
                    print(f"{tag}: PASS {len(text.splitlines())} lines match {name}.expected")
                else:
                    diff = difflib.unified_diff(expected.splitlines(keepends=True), text.splitlines(keepends=True),
                                                f"{name}.expected", f"capture-{label}")
                    print(f"{tag}: FAIL output differs")
                    sys.stdout.writelines(diff)
                    worst = max(worst, 3)
        return worst
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
