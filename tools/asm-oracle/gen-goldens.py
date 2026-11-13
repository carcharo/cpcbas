#!/usr/bin/env python3
"""Regenerate the assembler's golden fixtures from the reference assembler.

Usage:
    python3 tools/asm-oracle/gen-goldens.py                  # write tests/asm-golden
    python3 tools/asm-oracle/gen-goldens.py --check          # exit 1 if a re-run would change anything

    --fork PATH       the reference checkout (default ../zxbasic from the repo root's parent
                      layout: <repo>/../zxbasic, or ../../../zxbasic from a worktree)
    --cpcbuild PATH   the toolchain checkout (examples, games, lib; default likewise)
    --jobs N          parallel reference runs (default 8)

Needs `poetry` (the fork's environment) in the PATH. Python 3, standard library only.

What it makes (see tests/asm-golden/README.md):
  runtime/<file>.<fw|bare>.bin|.map   every lib/runtime file, wrapped and assembled by zxbasm
  runtime/excluded.txt                files zxbasm cannot assemble standalone in a variant
  library/<path>.<fw|bare>.bin|.map   every asm file of lib/cpcbuild, lib/cpcplus, lib/music, likewise
  library/excluded.txt                the same list for the library
  programs/<name>.asm|.bin|.map       programs compiled by zxbc and assembled by zxbasm
"""

from __future__ import annotations

import argparse
import filecmp
import os
import re
import shutil
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
DRIVER = HERE / "driver.py"
ZXBC_DRIVER = HERE / "zxbc-driver.py"

# Memory-map EQUs of the CPC prologue (src/arch/cpc/backend/main.py _layout()).
# The last number is the heap start the compiler computes for cpc_strings.bas (the heap size,
# 4768, is the same in both modes); runtime files that use the heap need both symbols.
FW_EQUS = (40448, 1024, 42496, 42619, 35680)
BARE_EQUS = (48128, 1024, 48128, 49151, 42336)
HEAP_SIZE = 4768


def wrapper_text(path: str, variant: str) -> str:
    """The text assembled for lib/runtime/<path>. tests/asm-golden.test.ts rebuilds it exactly."""
    priv_base, priv_size, stack_top, mem_top, heap = BARE_EQUS if variant == "bare" else FW_EQUS
    lines = [
        "org 64",
        f".core.CPC_PRIV_BASE EQU {priv_base}",
        f".core.CPC_PRIV_SIZE EQU {priv_size}",
        f".core.CPC_STACK_TOP EQU {stack_top}",
        f".core.CPC_MEM_TOP EQU {mem_top}",
        f".core.ZXBASIC_HEAP_SIZE EQU {HEAP_SIZE}",
        f".core.ZXBASIC_MEM_HEAP EQU {heap}",
    ]
    if variant == "bare":
        lines.append("#define CPC_BAREMETAL")
    lines.append(f"#include once <{path}>")
    return "\n".join(lines) + "\n"


# Programs: (name, source, zxbc flags). Source roots: F = fork tests, C = cpcbuild.
FUNCTIONAL = "tests/functional/arch/cpc"
PLUS_BARE = ["-D", "CPC_BAREMETAL", "-D", "CPC_OWNFONT"]
EXTRA_PROGRAMS = [
    # examples/*.bas, as the Makefile's run target builds them (firmware mode); plusdemo as
    # examples/plusdemo/build.sh does (bare-metal).
    ("example_bounce", "C:examples/bounce.bas", []),
    ("example_finetiles", "C:examples/finetiles.bas", []),
    ("example_plusdemo_bare", "C:examples/plusdemo.bas", PLUS_BARE),
    # games/lamplighter, as build_cpc.sh and build_plus.sh build them.
    ("lamplighter_464", "C:games/lamplighter/main.bas", ["--org", "0x40", "-D", "CPC464"]),
    ("lamplighter_6128", "C:games/lamplighter/main.bas", ["--org", "0x40", "-D", "CPC6128"]),
    ("lamplighter_plus", "C:games/lamplighter/main.bas", ["--org", "0x40", "-D", "PLUS"]),
    ("lamplighter_plus_bare", "C:games/lamplighter/main.bas", ["--org", "0x40", "-D", "PLUS", *PLUS_BARE]),
    # a bare-metal build of a small functional program
    ("cpc_strings_bare", "F:" + FUNCTIONAL + "/cpc_strings.bas", ["-D", "CPC_BAREMETAL"]),
]


def run(cmd: list[str], cwd: Path, extra_env: dict[str, str] | None = None) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env.update(extra_env or {})
    env["PATH"] = str(Path.home() / ".local/bin") + os.pathsep + env.get("PATH", "")
    env["PYTHONHASHSEED"] = "0"
    return subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True)


def runtime_files(lib_runtime: Path) -> list[str]:
    return sorted(p.relative_to(lib_runtime).as_posix() for p in lib_runtime.rglob("*") if p.is_file())


LIBRARY_DIRS = ("cpcbuild", "cpcplus", "music")


def library_files(lib: Path) -> list[str]:
    """The asm files of the BASIC library (lib/cpcbuild, lib/cpcplus, lib/music), as `dir/name.asm`."""
    return sorted(p.relative_to(lib).as_posix() for d in LIBRARY_DIRS for p in (lib / d).rglob("*.asm"))


def patched_files() -> list[str]:
    """The files lib/runtime deliberately patches (PATCHED in tools/import-runtime.py). The reference assembler and
    compiler find them through an override directory (CPCBAS_OVERRIDE, searched first: driver.py, zxbc-driver.py), so
    every fixture that links one is made from the patched source (L4-ERR: error.asm gained code, which shifts every
    fixture that links it; the hand-corrected bytes of div8.asm and fp_calc.asm come out of the same mechanism)."""
    import importlib.util

    spec = importlib.util.spec_from_file_location("import_runtime", REPO / "tools/import-runtime.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return sorted(mod.PATCHED)


def make_override(lib_runtime: Path, into: Path) -> Path:
    """Copies the patched runtime files into `into` (same relative paths) and returns it."""
    for f in patched_files():
        dest = into / f
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(lib_runtime / f, dest)
    return into


def check_runtime_matches_fork(files: list[str], lib_runtime: Path, fork: Path) -> None:
    """The oracle resolves includes in the fork; the runner resolves them in lib/runtime.
    They must be the same bytes, or the fixtures prove nothing."""
    bad = []
    patched = set(patched_files())
    for f in files:
        if f in patched:
            continue  # tools/import-runtime.py --check holds these to the fork's file plus the patch
        cpc = fork / "src/lib/arch/cpc/runtime" / f
        zx = fork / "src/lib/arch/zx48k/runtime" / f
        src = cpc if cpc.is_file() else zx
        if not src.is_file() or src.read_bytes() != (lib_runtime / f).read_bytes():
            bad.append(f)
    if bad:
        sys.exit("lib/runtime differs from the fork (re-run tools/import-runtime.py): " + ", ".join(bad[:10]))


def scrub(text: str, tmp: Path) -> str:
    """Make a reference error message independent of the machine."""
    text = text.replace(str(tmp) + os.sep, "").replace(str(tmp), "")
    return text


def make_runtime(
    path: str, variant: str, fork: Path, outdir: Path, sub: str = "runtime", lib: Path | None = None, override: Path | None = None
) -> tuple[str, str, str | None]:
    """Returns (path, variant, error text or None). `sub` is the fixture directory; for the BASIC
    library's asm (`library`) `lib` is the directory the reference also searches (CPCBAS_LIB)."""
    with tempfile.TemporaryDirectory(prefix="asmgold-") as t:
        tmp = Path(t)
        wrapper = tmp / "wrapper.asm"
        wrapper.write_text(wrapper_text(path, variant), newline="\n")
        binf, mapf = tmp / "out.bin", tmp / "out.map"
        env = {"CPCBAS_LIB": str(lib)} if lib else {}
        if override:
            env["CPCBAS_OVERRIDE"] = str(override)
        p = run(["poetry", "run", "python", str(DRIVER), str(wrapper), "-o", str(binf), "-M", str(mapf)], fork, env)
        if p.returncode != 0:
            err = scrub((p.stderr + p.stdout).strip(), tmp)
            if lib:
                # machine-independent: the library path as lib/, and no Python traceback
                err = err.replace(str(lib) + os.sep, "lib/").split("Traceback")[0]
            lines = [ln.strip() for ln in err.splitlines() if ln.strip()]
            return path, variant, " | ".join(lines) if lines else f"exit {p.returncode}"
        if not binf.is_file():
            # zxbasm prints "Nothing to assemble" and writes no files
            return path, variant, "Nothing to assemble (no bytes)"
        dest = outdir / sub / f"{path}.{variant}"
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(binf, str(dest) + ".bin")
        shutil.copyfile(mapf, str(dest) + ".map")
        return path, variant, None


def make_program(
    name: str, src: str, flags: list[str], fork: Path, cpcbuild: Path, outdir: Path, override: Path | None = None
) -> tuple[str, str | None]:
    root, rel = src.split(":", 1)
    source = (fork if root == "F" else cpcbuild) / rel
    O = ["-O1"] if rel.startswith(FUNCTIONAL) else []
    with tempfile.TemporaryDirectory(prefix="asmgold-") as t:
        tmp = Path(t)
        asm = tmp / "prog.asm"
        cmd = ["poetry", "run", "python", str(ZXBC_DRIVER), *O, "--arch", "cpc", "-I", str(cpcbuild / "lib"), *flags,
               "-f", "asm", str(source), "-o", str(asm)]
        p = run(cmd, fork, {"CPCBAS_OVERRIDE": str(override)} if override else None)
        if p.returncode != 0 or not asm.is_file():
            return name, scrub((p.stderr + p.stdout).strip(), tmp)
        text = asm.read_text(encoding="latin-1")
        # Machine-independent: #line paths name the toolchain checkout as "cpcbuild".
        text = text.replace(str(cpcbuild) + os.sep, "cpcbuild/").replace(str(fork) + os.sep, "")
        if override:
            # a patched file was read from the override directory: name it where the fork keeps it
            for f in patched_files():
                home = "cpc" if (fork / "src/lib/arch/cpc/runtime" / f).is_file() else "zx48k"
                for base in sorted({str(override), os.path.realpath(override)}, key=len, reverse=True):  # /private/var before /var
                    text = text.replace(f"{base}{os.sep}{f}", f"src/lib/arch/{home}/runtime/{f}")
        asm.write_bytes(text.encode("latin-1"))
        binf, mapf = tmp / "prog.bin", tmp / "prog.map"
        p = run(["poetry", "run", "python", str(DRIVER), str(asm), "-o", str(binf), "-M", str(mapf)], fork,
                {"CPCBAS_OVERRIDE": str(override)} if override else None)
        if p.returncode != 0 or not binf.is_file():
            return name, "zxbasm: " + scrub((p.stderr + p.stdout).strip(), tmp)
        dest = outdir / "programs"
        dest.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(asm, dest / f"{name}.asm")
        shutil.copyfile(binf, dest / f"{name}.bin")
        shutil.copyfile(mapf, dest / f"{name}.map")
        return name, None


def generate(outdir: Path, fork: Path, cpcbuild: Path, jobs: int, override: Path) -> None:
    lib_runtime = REPO / "lib/runtime"
    make_override(lib_runtime, override)
    files = runtime_files(lib_runtime)
    check_runtime_matches_fork(files, lib_runtime, fork)

    programs = [(p.stem, f"F:{FUNCTIONAL}/{p.name}", []) for p in sorted((fork / FUNCTIONAL).glob("*.bas"))]
    programs += EXTRA_PROGRAMS

    lib_dir = REPO / "lib"
    lib_files = library_files(lib_dir)
    # lib/ keeps cpcbuild's frozen copy of these files byte for byte (the programs below are built from cpcbuild's lib)
    moved = [f for f in lib_files if (cpcbuild / "lib" / f).is_file() and (cpcbuild / "lib" / f).read_bytes() != (lib_dir / f).read_bytes()]
    if moved:
        sys.exit("lib/ differs from cpcbuild/lib in: " + ", ".join(moved[:10]))

    with ThreadPoolExecutor(max_workers=jobs) as ex:
        rt_futs = [ex.submit(make_runtime, f, v, fork, outdir, "runtime", None, override) for f in files for v in ("fw", "bare")]
        lb_futs = [ex.submit(make_runtime, f, v, fork, outdir, "library", lib_dir, override) for f in lib_files for v in ("fw", "bare")]
        pr_futs = [ex.submit(make_program, n, s, fl, fork, cpcbuild, outdir, override) for n, s, fl in programs]
        excluded = sorted((p, v, e) for p, v, e in (f.result() for f in rt_futs) if e is not None)
        lib_excluded = sorted((p, v, e) for p, v, e in (f.result() for f in lb_futs) if e is not None)
        failed = [r for r in (f.result() for f in pr_futs) if r[1] is not None]

    if failed:
        for n, e in failed:
            print(f"program {n} failed:\n{e}", file=sys.stderr)
        sys.exit(1)

    text = "".join(f"{p}\t{v}\t{e}\n" for p, v, e in excluded)
    (outdir / "runtime").mkdir(parents=True, exist_ok=True)
    (outdir / "runtime/excluded.txt").write_text(text, newline="\n")
    (outdir / "library").mkdir(parents=True, exist_ok=True)
    (outdir / "library/excluded.txt").write_text("".join(f"{p}\t{v}\t{e}\n" for p, v, e in lib_excluded), newline="\n")
    print(f"library: {len(lib_files)} files x 2 variants, {len(lib_excluded)} excluded")
    print(f"runtime: {len(files)} files x 2 variants, {len(excluded)} excluded; programs: {len(programs)}")


def tree(root: Path) -> dict[str, Path]:
    return {p.relative_to(root).as_posix(): p for p in sorted(root.rglob("*")) if p.is_file()}


GENERATED = ("runtime", "library", "programs")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    base = REPO.parent
    # a worktree (<repo>/.worktrees/<name>) sits two levels below the repo root
    if REPO.parent.name == ".worktrees":
        base = REPO.parent.parent.parent
    ap.add_argument("--fork", type=Path, default=base / "zxbasic")
    ap.add_argument("--cpcbuild", type=Path, default=base / "cpcbuild")
    ap.add_argument("--out", type=Path, default=REPO / "tests/asm-golden")
    ap.add_argument("--jobs", type=int, default=8)
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    fork, cpcbuild, out = a.fork.resolve(), a.cpcbuild.resolve(), a.out.resolve()

    with tempfile.TemporaryDirectory(prefix="asmgold-out-") as t, tempfile.TemporaryDirectory(prefix="asmgold-over-") as o:
        stage = Path(t)
        generate(stage, fork, cpcbuild, a.jobs, Path(o))
        new = {k: v for k, v in tree(stage).items()}
        old = {f"{sub}/{k}": v for sub in GENERATED if (out / sub).is_dir() for k, v in tree(out / sub).items()}
        if a.check:
            changed = sorted(k for k in new if k not in old or not filecmp.cmp(new[k], old[k], shallow=False))
            stale = sorted(k for k in old if k not in new)
            for k in changed:
                print(("new     " if k not in old else "changed ") + k)
            for k in stale:
                print("stale   " + k)
            print("asm-oracle: " + ("fixtures differ" if changed or stale else "clean"))
            return 1 if changed or stale else 0
        for sub in GENERATED:
            shutil.rmtree(out / sub, ignore_errors=True)
        for k, v in new.items():
            dest = out / k
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(v, dest)
    return 0


if __name__ == "__main__":
    sys.exit(main())
