#!/usr/bin/env python3
"""size-diff.py -- binary size of cpcbas against the frozen Boriel BASIC fork (L3-SIZE; development tooling, never in `npm test`).

Builds every program with the fork (`poetry run zxbc --arch cpc`, in ../zxbasic) and with the built cpcbas CLI,
both at their default settings, and reads every figure from the two map files (-M) and the image the compiler
wrote. Nothing is estimated.

    python3 tools/size-diff.py --all                           # tables on stdout
    python3 tools/size-diff.py --all --md out.md               # and into a file
    python3 tools/size-diff.py --programs flow,cb_tiles --modes firmware --detail
    python3 tools/size-diff.py --all --variant prefix=/path/to/other/checkout/packages/cpcbas/dist/bin/cpcbas.js

Program sets (--groups, default all of them):
  forkdiff  tests/fork-diff/*.bas (except common.bas): ONE source file, built by both compilers.
  game      Lamplighter (L4-LAMP): lamp464, lamp6128, lampplus and lamppluc (the cartridge, bare), the fork from
            ../cpcbuild/games/lamplighter and cpcbas from tests/games/lamplighter, org &0040. The two sources are
            the same game in each dialect (the translation of the Lamplighter port). Not in the
            default --groups: `--groups game`.
  twin      tests/conformance/NAME.bas for each NAME that also exists in cpcbuild's tests/conformance and builds
            on both sides. The two files are the same test written in each compiler's dialect (the cpcbas one is
            the port), so these are comparable programs, not identical sources.
Until L4 no game built on both (cpcbuild's games use the Boriel dialect); the `game` group has the translated Lamplighter.

Builds: `firmware` (the default) and `bare` (-D CPC_BAREMETAL) on both sides. The fork is built at its default
optimiser level (-O2), which is what cpcbuild's release builds use (build_cpc.sh and the Studio pass no -O).

L5-MEASURE:
  --cpcbas-O 0,1,2,3,s   one cpcbas column per level (`-O L`); without it a single `cpcbas` column built with no -O, as before
  --fork-O 2,0,3         the fork's columns (default `2`, the milestone's reference; `0` and `3` are informative)
  --json FILE            every program, build, region and chunk, plus the commit and the options, so that two runs can be diffed
  --summary              the milestone rows: per set and mode the programs over the fork at the last level (-Os when given),
                         the bytes over, the sum of images per level, the main and procedure regions against the fork
  --against FILE.json    the change from an earlier --json run, per program and in total, with the wave's overall gain
  --diff OLD.json NEW.json   the same, between two files, building nothing
  --report FILE.json     the --summary rows and the biggest contributors of an earlier run, building nothing
  --patterns             the instruction patterns of the generated code (from `--asm`), counted over the cpcbas programs
The primary cpcbas column, which the older tables and the summary compare with the fork, is `-Os` when asked for, else the
last level given. `--variant NAME=CLI` adds a column for another cpcbas CLI (a
detached checkout of an older commit, or a scratch copy with one define removed): the same programs, the same
reading of the map.

Figures per build (all from the map and the image):
  image    bytes the compiler wrote (the AMSDOS header of a cpcbas .bin is removed and checked against its length field)
  end      org + image
  free     the first reserved address below the program (the heap start when the program links the heap,
           else the code limit: &9E00 firmware, &B800 bare) minus end. The heap is top-aligned and 4768 bytes
           unless `#pragma heap_size` says otherwise (both compilers share the layout).
  startup  org .. ZXBASIC_USER_DATA   data  USER_DATA .. USER_DATA_END   main  .. __END_PROGRAM
  program  from __END_PROGRAM on: SUB/FUNCTION bodies (user and library BASIC), string literals
  runtime  the asm runtime routines (`.core.` labels)
  library  library asm that is neither: the music player (`.PLY_*`, akg_cpc.asm) and its glue (`.__MUSIC_*`, music_cpc.bas)

A chunk is classified by the name of its label, not by its position (L5-MEASURE-B, follow-up 170): the fork links the music
player inside the main region and cpcbas after the first runtime routine, and position alone put it in `main` for one and in
`runtime` for the other. After __END_PROGRAM a `.core.` label starts runtime, a `._Name`, `.L.` or `.S.` label starts program,
and a label that says nothing (`.T.n`, `.LABEL.__LABELn`, a firmware address) continues the region of the chunk before it.
`classify_chunks` holds the rules; `--report` applies them to a `--json` file made before them (`reclassify_doc`).
"""
import argparse
import concurrent.futures
import gzip
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


def sibling(name: str) -> Path:
    here = REPO
    if here.parent.name == ".worktrees":
        here = here.parent.parent
    return here.parent / name


FORK = sibling("zxbasic")
CPCBUILD = sibling("cpcbuild")
CLI = REPO / "packages" / "cpcbas" / "dist" / "bin" / "cpcbas.js"
REUSE = False  # --reuse: keep a build whose .bin and .map are already in --work
DEFAULT_HEAP = 4768
# (name, mode, -D flags) of the Lamplighter builds; the bare one gets -D CPC_BAREMETAL from its mode
GAME_BUILDS = [("lamp464", "firmware", ["CPC464"]), ("lamp6128", "firmware", ["CPC6128"]),
               ("lampplus", "firmware", ["PLUS"]), ("lamppluc", "bare", ["PLUS", "CPC_OWNFONT"])]
LIMITS = {"firmware": (0x9E00, 0x9E00), "bare": (0xB800, 0xB800)}  # (code limit, heap top)
STRUCTURAL = {".core.__START_PROGRAM", ".core.ZXBASIC_USER_DATA", ".core.ZXBASIC_USER_DATA_END",
              ".core.__MAIN_PROGRAM__", ".core.__END_PROGRAM"}
REGIONS = ("startup", "data", "main", "program", "runtime", "library")
CLASSIFIER = 2  # 1: by position (L5-MEASURE); 2: by label name (L5-MEASURE-B)
# library asm, by the file whose labels they are: akg_cpc.asm (the Arkos player), music_cpc.bas (its glue); the same in both dialects
LIBRARY_PREFIXES = (".PLY_", ".__MUSIC_")
PROCEDURE = re.compile(r"^\.(?:L\.|S\.|_[A-Za-z0-9])")  # a SUB/FUNCTION body (`._Name`, `.L.name`) or a string literal (`.S.n`)
MAPLINE = re.compile(r"^([0-9A-Fa-f]{4,}): (\S+)\s*$")


# ---------------------------------------------------------------- map and image reading

def parse_map(text: str) -> list[tuple[int, str]]:
    """[(address, name)] in file order. A map line is `ADDR: .label`."""
    out = []
    for line in text.splitlines():
        m = MAPLINE.match(line.strip())
        if m:
            out.append((int(m.group(1), 16), m.group(2)))
    return out


def strip_amsdos(data: bytes) -> tuple[bytes, int]:
    """Remove the 128-byte AMSDOS header of a cpcbas .bin after checking its length and checksum fields.
    Returns (image, load address)."""
    if len(data) < 128:
        raise ValueError("file shorter than an AMSDOS header")
    if sum(data[:67]) & 0xFFFF != data[67] | (data[68] << 8):
        raise ValueError("AMSDOS header checksum does not match")
    length = data[24] | (data[25] << 8)
    if length + 128 != len(data):
        raise ValueError(f"header length {length} but file holds {len(data) - 128} bytes")
    return data[128:], data[21] | (data[22] << 8)


def classify_chunks(names: list[list[str]], starts: list[int], sizes: list[int], zones: list[str]) -> list[tuple[str, int, int, str]]:
    """[(name, start, size, region)] from the labels of each chunk, in address order. `zones` is where the chunk lies by position:
    startup, data, main (before __END_PROGRAM) or tail (from it on). startup and data stay; the rest goes by the label:
      library   a label of LIBRARY_PREFIXES (the player), in main or in the tail
      runtime   a `.core.` label that is not structural, in the tail
      program   a `._Name`, `.L.` or `.S.` label, in the tail
      otherwise main in the main zone, and in the tail the region of the last runtime or program chunk (a label that says
      nothing, `.T.n` or `.LABEL.__LABELn` or a firmware address, continues the routine before it).
    The chunk's name is the label that decided, so that the same routine has the same name in both compilers."""
    out = []
    cur = "program"  # the tail starts with the procedures, as in both compilers
    for ns, a, size, zone in zip(names, starts, sizes, zones):
        if zone in ("startup", "data"):
            out.append((ns[0], a, size, zone))
            continue
        lib = next((n for n in ns if n.startswith(LIBRARY_PREFIXES)), None)
        if lib:
            out.append((lib, a, size, "library"))
            continue
        if zone == "main":
            out.append((ns[0], a, size, "main"))
            continue
        core = next((n for n in ns if n.startswith(".core.") and n not in STRUCTURAL), None)
        proc = next((n for n in ns if PROCEDURE.match(n)), None)
        if core:
            cur = "runtime"
            out.append((core, a, size, cur))
        elif proc:
            cur = "program"
            out.append((proc, a, size, cur))
        else:
            out.append((ns[0], a, size, cur))
    return out


def analyse(syms: list[tuple[int, str]], org: int, image: int, mode: str, heap_size: int) -> dict:
    """Region totals, chunks and free memory from a map and the image size."""
    end = org + image
    by_name = {n: a for a, n in syms}
    for need in (".core.ZXBASIC_USER_DATA", ".core.ZXBASIC_USER_DATA_END", ".core.__END_PROGRAM"):
        if need not in by_name:
            raise ValueError(f"map has no {need}")
    # chunks: one per distinct address, all the labels listed there
    labels: dict[int, list[str]] = {}
    for a, n in syms:
        labels.setdefault(a, []).append(n)
    addrs = sorted(labels)
    zones, raw = [], []
    for i, a in enumerate(addrs):
        nxt = addrs[i + 1] if i + 1 < len(addrs) else end
        zones.append("startup" if a < by_name[".core.ZXBASIC_USER_DATA"] else "data" if a < by_name[".core.ZXBASIC_USER_DATA_END"]
                     else "main" if a < by_name[".core.__END_PROGRAM"] else "tail")
        raw.append((a, max(0, min(nxt, end) - a)))
    chunks = classify_chunks([labels[a] for a in addrs], [a for a, _ in raw], [s for _, s in raw], zones)
    regions = {r: 0 for r in REGIONS}
    for _, _, s, r in chunks:
        regions[r] += s
    # bytes before the first label (the org itself carries __START_PROGRAM, so normally none)
    lead = addrs[0] - org
    if lead > 0:
        regions["startup"] += lead
    heap = ".core.__MEM_INIT" in by_name or ".core.__MEM_ALLOC" in by_name or ".core.MEM_ALLOC" in by_name
    code_limit, heap_top = LIMITS[mode]
    heap_start = heap_top - heap_size
    free = (heap_start if heap else code_limit) - end
    return {"org": org, "image": image, "end": end, "heap": heap, "heap_start": heap_start if heap else None,
            "free": free, "regions": regions, "chunks": chunks}


# ---------------------------------------------------------------- builders

def pragma_heap(src: Path) -> int:
    try:
        m = re.search(r"^\s*#pragma\s+heap_size\s*=\s*(&[hH]?[0-9A-Fa-f]+|0[xX][0-9A-Fa-f]+|\d+)", src.read_text(errors="replace"), re.M | re.I)
    except OSError:
        return DEFAULT_HEAP
    if not m:
        return DEFAULT_HEAP
    t = m.group(1)
    return int(t[1:].lstrip("hH"), 16) if t.startswith("&") else int(t, 0)


def build_fork(src: Path, mode: str, work: Path, olevel: int | None, defs: list[str], extra: list[str] | None = None) -> dict:
    tag = f"fork{'' if olevel is None else olevel}"
    binf, mapf = work / f"{tag}.bin", work / f"{tag}.map"
    cmd = ["poetry", "run", "zxbc", "--arch", "cpc", "-I", str(CPCBUILD / "lib"), "-M", str(mapf), "-o", str(binf)]
    if olevel is not None:
        cmd += ["-O", str(olevel)]
    if mode == "bare":
        cmd += ["-D", "CPC_BAREMETAL"]
    for d in defs:
        cmd += ["-D", d]
    cmd += extra or []
    cmd.append(str(src))
    if REUSE and binf.is_file() and mapf.is_file():
        p = subprocess.CompletedProcess(cmd, 0, "", "")
    else:
        for f in (binf, mapf):
            f.unlink(missing_ok=True)
        p = subprocess.run(cmd, cwd=FORK, capture_output=True, text=True)
    if p.returncode != 0 or not binf.is_file() or not mapf.is_file():
        err = next((l for l in (p.stderr + p.stdout).splitlines() if "error" in l.lower()), (p.stderr + p.stdout).strip()[:200])
        return {"ok": False, "err": f"exit {p.returncode}: {err}"}
    syms = parse_map(mapf.read_text())
    org = min(a for a, _ in syms)
    return finish(syms, org, binf.stat().st_size, mode, src)


def cpcbas_cmd(cli: Path, src: Path, mapf: Path, binf: Path, level: str | None) -> list[str]:
    """The CLI line of a cpcbas build; `level` is passed as `-O L` (`s` included: the CLI takes it from L5-0 on)."""
    cmd = ["node", str(cli), str(src), "-M", str(mapf), "-o", str(binf)]
    if level is not None:
        cmd += ["-O", level]
    return cmd


def build_cpcbas(cli: Path, src: Path, mode: str, work: Path, tag: str, defs: list[str], extra: list[str] | None = None,
                 level: str | None = None) -> dict:
    binf, mapf = work / f"{tag}.bin", work / f"{tag}.map"
    cmd = cpcbas_cmd(cli, src, mapf, binf, level)
    if mode == "bare":
        cmd += ["-D", "CPC_BAREMETAL"]
    for d in defs:
        cmd += ["-D", d]
    cmd += extra or []
    if REUSE and binf.is_file() and mapf.is_file():
        p = subprocess.CompletedProcess(cmd, 0, "", "")
    else:
        for f in (binf, mapf):
            f.unlink(missing_ok=True)
        p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0 or not binf.is_file() or not mapf.is_file():
        err = next((l for l in (p.stderr + p.stdout).splitlines() if "error" in l.lower()), (p.stderr + p.stdout).strip()[:200])
        return {"ok": False, "err": f"exit {p.returncode}: {err}"}
    try:
        image, org = strip_amsdos(binf.read_bytes())
    except ValueError as exc:
        return {"ok": False, "err": f"{binf.name}: {exc}"}
    return finish(parse_map(mapf.read_text()), org, len(image), mode, src)


def finish(syms, org, image, mode, src) -> dict:
    try:
        r = analyse(syms, org, image, mode, pragma_heap(src))
    except ValueError as exc:
        return {"ok": False, "err": str(exc)}
    r["ok"] = True
    return r


# ---------------------------------------------------------------- program sets

def programs(groups: list[str], only: list[str] | None) -> list[dict]:
    out = []
    fd = REPO / "tests" / "fork-diff"
    if "forkdiff" in groups:
        for f in sorted(fd.glob("*.bas")):
            if f.name != "common.bas":
                out.append({"name": f.stem, "group": "forkdiff", "fork": f, "cpcbas": f})
    if "twin" in groups:
        cb = CPCBUILD / "tests" / "conformance"
        for f in sorted((REPO / "tests" / "conformance").glob("*.bas")):
            if (cb / f.name).is_file():
                out.append({"name": f.stem, "group": "twin", "fork": cb / f.name, "cpcbas": f})
    if "game" in groups:
        # Lamplighter, the four builds of cpcbuild's build_cpc.sh and build_plus.sh (org &0040, -I lib), the fork from
        # ../cpcbuild/games/lamplighter and cpcbas from tests/games/lamplighter (the same game in each dialect)
        game_fork = CPCBUILD / "games" / "lamplighter" / "main.bas"
        game_cpcbas = REPO / "tests" / "games" / "lamplighter" / "main.bas"
        for name, mode, gdefs in GAME_BUILDS:
            out.append({"name": name, "group": "game", "fork": game_fork, "cpcbas": game_cpcbas, "mode": mode,
                        "defs": gdefs, "args": ["--org", "0x40"]})
    if only:
        out = [p for p in out if p["name"] in only]
    return out


# ---------------------------------------------------------------- running

def fork_col(level: int) -> str:
    return f"fork-O{level}"


def cpcbas_col(level: str) -> str:
    return f"cpcbas-O{level}"


def reference_fork(levels: list[int]) -> int:
    """The fork column the milestone compares with: its default, -O2, when it is in the list, else the first."""
    return 2 if 2 in levels else levels[0]


def primary_level(levels: list[str]) -> str:
    """The cpcbas level the older tables and the summary compare with the fork: -Os when asked for, else the last given."""
    return "s" if "s" in levels else levels[-1]


def run_one(p: dict, mode: str, work: Path, variants: dict[str, Path], fork_o: list[int], defs: list[str],
            cpcbas_o: list[str] | None = None) -> dict:
    """Every build of one program in one mode. `fork_o` empty: one fork column `fork` at the fork's default (the older
    callers); otherwise one `fork-O{n}` column per level and `fork` is the reference one. `cpcbas_o` None: one `cpcbas` column
    with no -O; otherwise one `cpcbas-O{l}` column per level and `cpcbas` is the primary one."""
    w = work / f"{p['group']}-{p['name']}-{mode}"
    w.mkdir(parents=True, exist_ok=True)
    defs = [*p.get("defs", []), *defs]
    extra = p.get("args", [])
    res = {}
    if fork_o:
        for o in fork_o:
            res[fork_col(o)] = build_fork(p["fork"], mode, w, o, defs, extra)
        res["fork"] = res[fork_col(reference_fork(fork_o))]
    else:
        res["fork"] = build_fork(p["fork"], mode, w, None, defs, extra)
    if cpcbas_o is None:
        res["cpcbas"] = build_cpcbas(CLI, p["cpcbas"], mode, w, "cpcbas", defs, extra)
    else:
        for lv in cpcbas_o:
            res[cpcbas_col(lv)] = build_cpcbas(CLI, p["cpcbas"], mode, w, cpcbas_col(lv), defs, extra, lv)
        res["cpcbas"] = res[cpcbas_col(primary_level(cpcbas_o))]
    for name, cli in variants.items():
        res[name] = build_cpcbas(CLI if cli is None else cli, p["cpcbas"], mode, w, name, defs, extra)
    return {"program": p, "mode": mode, "res": res}


def fmt_free(r: dict) -> str:
    return str(r["free"]) if r["ok"] else "-"


def table(rows: list[dict], cols: list[str], ref: str = "fork") -> str:
    """Per program: image bytes of every column, the difference cpcbas - fork (cpcbas is the primary column, fork the reference
    one) and - each other fork level, free memory."""
    forks = [c for c in cols if c.startswith("fork-O") and c != ref]
    head = ["program", "set", "mode"] + [f"{c} bytes" for c in cols] + ["cpcbas - fork", "%"] + [f"cpcbas - {c}" for c in forks] + ["free fork", "free cpcbas"]
    out = ["| " + " | ".join(head) + " |", "|---|---|---|" + "---:|" * (len(head) - 3)]
    for row in rows:
        r = row["res"]
        cells = [str(r[c]["image"]) if r[c]["ok"] else "-" for c in cols]
        c = r["cpcbas"]
        extra = []
        for base in ["fork"] + forks:
            if r[base]["ok"] and c["ok"]:
                d = c["image"] - r[base]["image"]
                extra.append(f"{d:+d}")
                if base == "fork":
                    extra.append(f"{100.0 * d / r['fork']['image']:+.1f}")
            else:
                extra += ["-"] * (2 if base == "fork" else 1)
        out.append(f"| {row['program']['name']} | {row['program']['group']} | {row['mode']} | " + " | ".join(cells) + " | " + " | ".join(extra) +
                   f" | {fmt_free(r['fork'])} | {fmt_free(c)} |")
    return "\n".join(out)


def regions_table(rows: list[dict]) -> str:
    out = ["| program | set | mode | side | startup | data | main | program (procs, strings) | runtime | library | image | end | heap | free |",
           "|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|"]
    for row in rows:
        for side in ("fork", "cpcbas"):
            r = row["res"][side]
            if not r["ok"]:
                out.append(f"| {row['program']['name']} | {row['program']['group']} | {row['mode']} | {side} | " + " | ".join(["-"] * 10) + " |")
                continue
            g = r["regions"]
            out.append(f"| {row['program']['name']} | {row['program']['group']} | {row['mode']} | {side} | {g['startup']} | {g['data']} | {g['main']} | "
                       f"{g['program']} | {g['runtime']} | {g['library']} | {r['image']} | &{r['end']:04X} | {'yes' if r['heap'] else 'no'} | {r['free']} |")
    return "\n".join(out)


def chunk_delta(row: dict) -> list[tuple[str, int, int, int]]:
    """Runtime chunks by name: [(name, fork bytes, cpcbas bytes, cpcbas - fork)], largest |delta| first."""
    f, c = row["res"]["fork"], row["res"]["cpcbas"]
    if not (f["ok"] and c["ok"]):
        return []
    fm: dict[str, int] = {}
    cm: dict[str, int] = {}
    for n, _, s, reg in f["chunks"]:
        if reg in ("runtime", "library"):
            fm[n] = fm.get(n, 0) + s
    for n, _, s, reg in c["chunks"]:
        if reg in ("runtime", "library"):
            cm[n] = cm.get(n, 0) + s
    rows = [(n, fm.get(n, 0), cm.get(n, 0), cm.get(n, 0) - fm.get(n, 0)) for n in set(fm) | set(cm)]
    rows.sort(key=lambda t: (-abs(t[3]), t[0]))
    return [r for r in rows if r[3] != 0]


def detail(rows: list[dict], top: int) -> str:
    out = []
    for row in rows:
        d = chunk_delta(row)
        if not d:
            continue
        f, c = row["res"]["fork"], row["res"]["cpcbas"]
        out.append(f"\n#### {row['program']['name']} ({row['program']['group']}, {row['mode']}): runtime {f['regions']['runtime']} -> {c['regions']['runtime']}, "
                   f"library {f['regions']['library']} -> {c['regions']['library']}, program {f['regions']['program']} -> {c['regions']['program']}, main {f['regions']['main']} -> {c['regions']['main']}, "
                   f"data {f['regions']['data']} -> {c['regions']['data']}\n")
        out.append("| runtime chunk | fork | cpcbas | delta |\n|---|---:|---:|---:|")
        for n, a, b, dl in d[:top]:
            out.append(f"| `{n}` | {a} | {b} | {dl:+d} |")
    return "\n".join(out)


def aggregate(rows: list[dict], top: int) -> str:
    """Sum of every runtime chunk's delta over the rows, plus the chunk's presence count on each side."""
    tot: dict[str, list[int]] = {}
    for row in rows:
        for n, a, b, dl in chunk_delta(row):
            t = tot.setdefault(n, [0, 0, 0, 0, 0])
            t[0] += a
            t[1] += b
            t[2] += dl
            t[3] += 1 if a else 0
            t[4] += 1 if b else 0
    items = sorted(tot.items(), key=lambda kv: (-abs(kv[1][2]), kv[0]))
    out = ["| runtime chunk | fork bytes (sum) | cpcbas bytes (sum) | delta (sum) | programs with it: fork | cpcbas |", "|---|---:|---:|---:|---:|---:|"]
    for n, t in items[:top]:
        out.append(f"| `{n}` | {t[0]} | {t[1]} | {t[2]:+d} | {t[3]} | {t[4]} |")
    return "\n".join(out)


def totals(rows: list[dict], bases: list[str]) -> str:
    """Region sums of the programs that built on both sides, per set and in all, cpcbas against each fork column."""
    out = ["| set | against | programs | region | base (sum) | cpcbas (sum) | delta |", "|---|---|---:|---|---:|---:|---:|"]
    for grp in ["all"] + sorted({r["program"]["group"] for r in rows}):
        sel = [r for r in rows if grp == "all" or r["program"]["group"] == grp]
        for base in bases:
            ok = [r for r in sel if r["res"][base]["ok"] and r["res"]["cpcbas"]["ok"]]
            for key in (*REGIONS, "image"):
                f = sum(r["res"][base]["image"] if key == "image" else r["res"][base]["regions"][key] for r in ok)
                c = sum(r["res"]["cpcbas"]["image"] if key == "image" else r["res"]["cpcbas"]["regions"][key] for r in ok)
                out.append(f"| {grp} | {base} | {len(ok)} | {key} | {f} | {c} | {c - f:+d} |")
    return "\n".join(out)


def reach_table(rows: list[dict]) -> str:
    """prefix = main before L3-FIX; nomemcheck = this checkout without __MEMORY_CHECK__; cpcbas = this checkout."""
    out = ["| program | set | mode | before L3-FIX | after, no __MEMORY_CHECK__ | after (shipped) | reachability gain | __MEMORY_CHECK__ cost | heap linked |",
           "|---|---|---|---:|---:|---:|---:|---:|---|"]
    gain = cost = n = 0
    for r in rows:
        x = r["res"]
        if not all(x[k]["ok"] for k in ("prefix", "nomemcheck", "cpcbas")):
            continue
        p, nm, c = x["prefix"]["image"], x["nomemcheck"]["image"], x["cpcbas"]["image"]
        gain += p - nm
        cost += c - nm
        n += 1
        out.append(f"| {r['program']['name']} | {r['program']['group']} | {r['mode']} | {p} | {nm} | {c} | {p - nm:+d} | {c - nm:+d} | {'yes' if x['cpcbas']['heap'] else 'no'} |")
    out.append(f"| total of {n} | | | | | | {gain:+d} | {cost:+d} | |")
    return "\n".join(out)


def failures(rows: list[dict]) -> str:
    lines = []
    for r in rows:
        for side, x in r["res"].items():
            if not x["ok"]:
                lines.append(f"- {r['program']['name']} ({r['program']['group']}, {r['mode']}) {side}: {x['err'][:230]}")
    return "\n".join(lines)


# ---------------------------------------------------------------- JSON, summary, comparison with an earlier run (L5-MEASURE)

ALIASES = ("fork", "cpcbas")


def git_state() -> dict:
    """The commit of this checkout and whether the tree is dirty."""
    def git(*a: str) -> str:
        p = subprocess.run(["git", "-C", str(REPO), *a], capture_output=True, text=True)
        return p.stdout.strip() if p.returncode == 0 else ""
    return {"commit": git("rev-parse", "HEAD"), "dirty": bool(git("status", "--porcelain", "--untracked-files=no"))}


def build_json(r: dict, chunks: bool = True) -> dict:
    """One build as plain data: the figures of analyse(), with the chunks as lists when `chunks`."""
    if not r["ok"]:
        return {"ok": False, "err": r["err"].replace(str(REPO), ".").replace(str(CPCBUILD), "../cpcbuild").replace(str(FORK), "../zxbasic")}
    out = {"ok": True, "org": r["org"], "image": r["image"], "end": r["end"], "free": r["free"], "heap": r["heap"], "regions": r["regions"]}
    if chunks:
        out["chunks"] = [list(c) for c in r["chunks"]]
    return out


def read_json(path: Path) -> dict:
    """A --json file; `.gz` is read through gzip."""
    with (gzip.open(path, "rt") if path.suffix == ".gz" else open(path)) as f:
        return json.load(f)


def write_json(path: Path, doc: dict) -> None:
    if path.suffix == ".gz":
        with gzip.open(path, "wt", compresslevel=9) as f:
            json.dump(doc, f, separators=(",", ":"))
    else:
        path.write_text(json.dumps(doc, indent=1))


def reclassify_doc(doc: dict) -> dict:
    """A `--json` document made by the position classifier (meta without `classifier` 2) read again by label name: the regions
    of every build that kept its chunks (the reference fork and the primary cpcbas column) are recomputed from them, and the
    other builds lose their regions (None), which would be the old ones. Images and chunk sizes do not change."""
    if doc.get("meta", {}).get("classifier") == CLASSIFIER:
        return doc
    for row in doc["rows"]:
        for b in row["builds"].values():
            if not b.get("ok"):
                continue
            ch = b.get("chunks")
            if ch is None:
                b["regions"] = None
                continue
            zones = ["tail" if c[3] in ("program", "runtime") else c[3] for c in ch]
            new = classify_chunks([[c[0]] for c in ch], [c[1] for c in ch], [c[2] for c in ch], zones)
            regions = {r: 0 for r in REGIONS}
            for _, _, size, r in new:
                regions[r] += size
            regions["startup"] += b["image"] - sum(c[2] for c in ch)  # the bytes before the first label
            assert sum(regions.values()) == b["image"], (row["name"], b["image"], regions)
            b["regions"], b["chunks"] = regions, [list(c) for c in new]
    doc["meta"] = {**doc.get("meta", {}), "classifier": CLASSIFIER, "reclassified": True}
    return doc


def to_json(rows: list[dict], meta: dict) -> dict:
    """Every program, build and region of a run, and the chunks of the reference fork and the primary cpcbas column (the
    others differ in nothing a diff of two runs needs, and would make the file ten times larger). The alias columns `fork` and
    `cpcbas` are left out when real per-level columns exist (they would only repeat one of them); the meta names the column
    each alias stood for."""
    keep = {meta.get("reference_fork_col"), meta.get("primary_cpcbas_col"), "fork", "cpcbas"}
    out = []
    for row in rows:
        res = row["res"]
        has_fork = any(k.startswith("fork-O") for k in res)
        has_cp = any(k.startswith("cpcbas-O") for k in res)
        builds = {k: build_json(v, k in keep or k not in meta.get("fork_cols", []) + meta.get("cpcbas_cols", [])) for k, v in res.items() if not ((k == "fork" and has_fork) or (k == "cpcbas" and has_cp))}
        out.append({"name": row["program"]["name"], "group": row["program"]["group"], "mode": row["mode"], "builds": builds})
    return {"meta": meta, "rows": out}


def key_of(row: dict) -> tuple[str, str, str]:
    return (row["name"], row["group"], row["mode"])


def sel_sets(rows: list[dict]) -> list[str]:
    """The sets of a run in a fixed order, then `all`."""
    order = ["forkdiff", "twin", "game"]
    present = [g for g in order if any(r["group"] == g for r in rows)] + sorted({r["group"] for r in rows} - set(order))
    return present + ["all"]


def both_ok(row: dict, cols: list[str]) -> bool:
    return all(row["builds"].get(c, {}).get("ok") for c in cols)


def summary(doc: dict) -> str:
    """The milestone rows of a to_json() document: per set and mode, at the primary cpcbas level against the reference fork."""
    meta, rows = doc["meta"], doc["rows"]
    fork_c, cp_cols, prim = meta["reference_fork_col"], meta["cpcbas_cols"], meta["primary_cpcbas_col"]
    fork_cols = meta["fork_cols"]
    modes = [m for m in ("firmware", "bare") if any(r["mode"] == m for r in rows)]
    out = []
    lvl = prim.removeprefix("cpcbas-O")
    out.append(f"#### Size at -O{lvl} against the fork at -O{fork_c.removeprefix('fork-O')} (image bytes; a program is over when cpcbas > fork)\n")
    out.append("| set | mode | programs | over the fork | bytes over | bytes under | net | fork sum | cpcbas sum |")
    out.append("|---|---|---:|---:|---:|---:|---:|---:|---:|")
    over_lists = []
    for g in sel_sets(rows):
        for m in modes:
            sel = [r for r in rows if (g == "all" or r["group"] == g) and r["mode"] == m and both_ok(r, [fork_c, prim])]
            if not sel:
                continue
            d = [(r["name"], r["builds"][prim]["image"] - r["builds"][fork_c]["image"]) for r in sel]
            over = [x for x in d if x[1] > 0]
            under = sum(x[1] for x in d if x[1] < 0)
            out.append(f"| {g} | {m} | {len(sel)} | {len(over)} | {sum(x[1] for x in over):+d} | {under:+d} | {sum(x[1] for x in d):+d} | "
                       f"{sum(r['builds'][fork_c]['image'] for r in sel)} | {sum(r['builds'][prim]['image'] for r in sel)} |")
            if g != "all" and over:
                top = sorted(over, key=lambda x: -x[1])[:10]
                over_lists.append(f"- {g}, {m}: " + ", ".join(f"{n} {dv:+d}" for n, dv in top) + (f" (and {len(over) - 10} more)" if len(over) > 10 else ""))
    if over_lists:
        out.append("\nPrograms over the fork (largest first):\n")
        out += over_lists
    out.append("\n#### Sum of images per level\n")
    req = [fork_c] + cp_cols
    out.append(f"Over the programs that built in the reference fork column and in every cpcbas column; an informative fork column that failed to build "
               f"some of them (the fork at -O0 overlaps a reserved range, or links a routine it would have dropped) shows `(k of n)`.\n")
    cols = fork_cols + cp_cols
    out.append("| set | mode | programs | " + " | ".join(cols) + " |")
    out.append("|---|---|---:|" + "---:|" * len(cols))
    for g in sel_sets(rows):
        for m in modes:
            sel = [r for r in rows if (g == "all" or r["group"] == g) and r["mode"] == m and both_ok(r, req)]
            if sel:
                out.append(f"| {g} | {m} | {len(sel)} | " + " | ".join(col_sum(sel, c, lambda b: b["image"]) for c in cols) + " |")
    out.append("\n#### Main and procedure regions against the fork\n")
    out.append("`main` is the main program's code (and data blocks in it), `program` the SUB and FUNCTION bodies and string literals, `library` the music player and its glue "
               "(classified by label, follow-up 170); same programs as above.\n")
    out.append("| set | mode | region | " + " | ".join(cols) + f" | {prim} - {fork_c} |")
    out.append("|---|---|---|" + "---:|" * (len(cols) + 1))
    for g in sel_sets(rows):
        for m in modes:
            sel = [r for r in rows if (g == "all" or r["group"] == g) and r["mode"] == m and both_ok(r, req)]
            for region in ("main", "program", "library"):
                if sel and (region != "library" or any(r["builds"][prim]["regions"].get(region) or r["builds"][fork_c]["regions"].get(region) for r in sel)):
                    d = sum(r["builds"][prim]["regions"][region] - r["builds"][fork_c]["regions"][region] for r in sel)
                    out.append(f"| {g} | {m} | {region} | " + " | ".join(col_sum(sel, c, lambda b, rg=region: (b["regions"] or {}).get(rg)) for c in cols) + f" | {d:+d} |")
    return "\n".join(out)


def contributors(doc: dict, top: int = 8) -> str:
    """Per set and mode, where the primary cpcbas column differs from the reference fork: the five regions' sums, then the runtime
    chunks (by routine name) that are larger or only in cpcbas, and the ones that are smaller or only in the fork."""
    meta, rows = doc["meta"], doc["rows"]
    fork_c, prim = meta["reference_fork_col"], meta["primary_cpcbas_col"]
    out = ["#### Biggest contributors to the difference, per set (cpcbas - fork; the sets' own programs, both builds ok)\n"]
    for g in sel_sets(rows)[:-1]:
        for m in [m for m in ("firmware", "bare") if any(r["mode"] == m and r["group"] == g for r in rows)]:
            sel = [r for r in rows if r["group"] == g and r["mode"] == m and both_ok(r, [fork_c, prim]) and "chunks" in r["builds"][prim]
                   and "chunks" in r["builds"][fork_c]]
            if not sel:
                continue
            reg = {k: sum(r["builds"][prim]["regions"][k] - r["builds"][fork_c]["regions"][k] for r in sel)
                   for k in REGIONS}
            out.append(f"**{g}, {m}** ({len(sel)} programs): " + ", ".join(f"{k} {v:+d}" for k, v in reg.items()) +
                       f"; image {sum(r['builds'][prim]['image'] - r['builds'][fork_c]['image'] for r in sel):+d}\n")
            delta: dict[str, list[int]] = {}
            for r in sel:
                for side, sign in ((prim, 1), (fork_c, -1)):
                    for name, _a, size, region in r["builds"][side]["chunks"]:
                        if region in ("runtime", "library"):
                            d = delta.setdefault(name, [0, 0, 0])
                            d[0] += sign * size
                            d[1 if sign > 0 else 2] += 1
            items = sorted(delta.items(), key=lambda kv: (-kv[1][0], kv[0]))
            out.append("| runtime chunk | cpcbas - fork (sum) | programs with it: cpcbas | fork |\n|---|---:|---:|---:|")
            for name, d in [x for x in items if x[1][0] > 0][:top] + [x for x in items[::-1] if x[1][0] < 0][:top]:
                out.append(f"| `{name.removeprefix('.core.')}` | {d[0]:+d} | {d[1]} | {d[2]} |")
            out.append("")
    return "\n".join(out)


def col_sum(sel: list[dict], col: str, get) -> str:
    """The sum of a figure of one column over the rows that built in it; `(k of n)` when not all of them did."""
    ok = [r for r in sel if r["builds"].get(col, {}).get("ok") and get(r["builds"][col]) is not None]
    total = sum(get(r["builds"][col]) for r in ok)
    return str(total) if len(ok) == len(sel) else f"{total} ({len(ok)} of {len(sel)})"


def against(old: dict, new: dict, col: str | None = None) -> str:
    """The change from an earlier run to this one: per program (image bytes of the primary cpcbas column), in total, and the
    wave's overall gain: the sum of the images over the size set, at least 1 %."""
    col = col or new["meta"]["primary_cpcbas_col"]
    # the same column when the old run has it; else the old run's primary column (the RC3 baseline has -O0..-O3 and no -Os,
    # and its primary is -O3, the same image as -O0); else a legacy run's single `cpcbas` column (R17)
    old_primary = old.get("meta", {}).get("primary_cpcbas_col")
    has = lambda c: c is not None and any(c in r["builds"] for r in old["rows"])  # noqa: E731
    oc = col if has(col) else old_primary if has(old_primary) else "cpcbas"
    before = {key_of(r): r["builds"][oc]["image"] for r in old["rows"] if r["builds"].get(oc, {}).get("ok")}
    after = {key_of(r): r["builds"][col]["image"] for r in new["rows"] if r["builds"].get(col, {}).get("ok")}
    common = sorted(set(before) & set(after))
    out = [f"#### Change in image bytes, {oc} (old) to {col} (new), {len(common)} programs built in both\n"]
    changed = [(k, before[k], after[k]) for k in common if before[k] != after[k]]
    out.append("| program | set | mode | old | new | change | % |")
    out.append("|---|---|---|---:|---:|---:|---:|")
    for k, a, b in sorted(changed, key=lambda t: t[2] - t[1]):
        out.append(f"| {k[0]} | {k[1]} | {k[2]} | {a} | {b} | {b - a:+d} | {100.0 * (b - a) / a:+.1f} |")
    tb, ta = sum(before[k] for k in common), sum(after[k] for k in common)
    gain = 100.0 * (tb - ta) / tb if tb else 0.0
    out.append(f"\n{len(changed)} of {len(common)} programs changed. Sum of images: {tb} -> {ta} ({ta - tb:+d} bytes, "
               f"overall gain {gain:.2f} %; the wave's size test is a gain of at least 1 %: {'passed' if gain >= 1.0 else 'not passed'}).")
    miss = sorted(set(before) ^ set(after))
    if miss:
        out.append(f"Not built in both runs: {', '.join('/'.join(k) for k in miss[:12])}{' ...' if len(miss) > 12 else ''}.")
    return "\n".join(out)


# ---------------------------------------------------------------- instruction patterns of the generated code (from --asm)

INSN = re.compile(r"^\t([a-z]{2,4})\b\s*(.*?)\s*$")
DATA_OPS = {"defb", "defw", "defs", "defm", "org", "equ", "db", "dw"}


def instructions(asm: str) -> list[tuple[str, str]]:
    """(mnemonic, operands without spaces) of every instruction line of a `--asm` text from the main program on (the runtime
    library is not in it). A label line is ('label', name): it breaks adjacency in `pattern_counts`."""
    out: list[tuple[str, str]] = []
    started = False
    for line in asm.splitlines():
        if line.startswith(".core.__MAIN_PROGRAM__"):
            started = True
        if not started:
            continue
        if line and not line.startswith("\t") and line.rstrip().endswith(":"):
            out.append(("label", line.strip()))
            continue
        m = INSN.match(line)
        if m and m.group(1) not in DATA_OPS:
            out.append((m.group(1), m.group(2).replace(" ", "")))
    return out


PATTERNS = [
    "push r / pop r (same register, adjacent)",
    "push r / pop s (different registers, adjacent)",
    "boolean materialised: sbc a,a / ld h,a / ld l,a",
    "ld de,1 / add hl,de",
    "REAL operand pushed: ld hl,(X+3) / push hl / ld hl,(X+1) / push hl / ld hl,(X-1) / push hl",
    "REAL operand loaded: ld a,(X) / ld de,(X+1) / ld bc,(X+3)",
    "REAL result round trip: push bc / push de / push af / pop af / pop de / pop bc",
    "jp to a label (unconditional; `jr` candidates at -Os; this and the next row together are every `jp` but `jp (hl)`)",
    "jp cc to a label (conditional)",
    "push hl / pop de (a subset of the push/pop pairs above)",
    "ld a,h / or l (HL tested against zero)",
    "ld de,N / ld hl,(X) / add hl,de (a constant added to a variable)",
]


def pattern_counts(ins: list[tuple[str, str]]) -> dict[str, int]:
    """Occurrence counts of PATTERNS in an instruction list (a label between two instructions breaks adjacency)."""
    c = {name: 0 for name in PATTERNS}
    k = PATTERNS
    n = len(ins)
    for i, (op, a) in enumerate(ins):
        nxt = ins[i + 1] if i + 1 < n else ("", "")
        if op == "push" and nxt[0] == "pop":
            c[k[0] if a == nxt[1] else k[1]] += 1
            if a == "hl" and nxt[1] == "de":
                c[k[9]] += 1
        if op == "sbc" and a == "a,a" and ins[i + 1:i + 3] == [("ld", "h,a"), ("ld", "l,a")]:
            c[k[2]] += 1
        if op == "ld" and a == "de,1" and nxt == ("add", "hl,de"):
            c[k[3]] += 1
        m = re.fullmatch(r"hl,\((.+)\+3\)", a) if op == "ld" else None
        if m:
            x = m.group(1)
            if ins[i + 1:i + 6] == [("push", "hl"), ("ld", f"hl,({x}+1)"), ("push", "hl"), ("ld", f"hl,({x}-1)"), ("push", "hl")]:
                c[k[4]] += 1
        m = re.fullmatch(r"a,\((.+)\)", a) if op == "ld" else None
        if m and ins[i + 1:i + 3] == [("ld", f"de,({m.group(1)}+1)"), ("ld", f"bc,({m.group(1)}+3)")]:
            c[k[5]] += 1
        if op == "push" and a == "bc" and ins[i + 1:i + 6] == [("push", "de"), ("push", "af"), ("pop", "af"), ("pop", "de"), ("pop", "bc")]:
            c[k[6]] += 1
        if op == "jp" and "," not in a and not a.startswith("("):
            c[k[7]] += 1
        if op == "jp" and "," in a:
            c[k[8]] += 1
        if op == "ld" and a == "a,h" and nxt == ("or", "l"):
            c[k[10]] += 1
        if op == "ld" and re.fullmatch(r"de,-?\d+", a) and i + 2 < n and ins[i + 1][0] == "ld" and ins[i + 1][1].startswith("hl,(") \
                and ins[i + 2] == ("add", "hl,de"):
            c[k[11]] += 1
    return c


def normalise_operand(a: str) -> str:
    a = re.sub(r"\.[A-Za-z_][\w.]*", "L", a)
    a = re.sub(r"_[A-Za-z]\w*", "V", a)
    return re.sub(r"\b\d+\b", "N", a)


def ngrams(ins: list[tuple[str, str]], n: int) -> dict[str, int]:
    """Counts of runs of n adjacent instructions (labels skipped) with the operands reduced to N (a number), L (a label), V (a variable)."""
    flat = [x for x in ins if x[0] != "label"]
    out: dict[str, int] = {}
    for i in range(len(flat) - n + 1):
        key = " / ".join(f"{o} {normalise_operand(a)}".strip() for o, a in flat[i:i + n])
        out[key] = out.get(key, 0) + 1
    return out


def asm_of(p: dict, mode: str, work: Path, level: str | None, defs: list[str]) -> str | None:
    """The `--asm` text of a cpcbas build of one program (None when it does not build)."""
    w = work / f"{p['group']}-{p['name']}-{mode}"
    w.mkdir(parents=True, exist_ok=True)
    asm, binf = w / "patterns.asm", w / "patterns.bin"
    cmd = ["node", str(CLI), str(p["cpcbas"]), "--asm", str(asm), "-o", str(binf)] + (["-O", level] if level is not None else [])
    if mode == "bare":
        cmd += ["-D", "CPC_BAREMETAL"]
    for d in [*p.get("defs", []), *defs]:
        cmd += ["-D", d]
    cmd += p.get("args", [])
    asm.unlink(missing_ok=True)
    pr = subprocess.run(cmd, capture_output=True, text=True)
    return asm.read_text(errors="replace") if pr.returncode == 0 and asm.is_file() else None


def patterns_programs(jobs: list[tuple[dict, str]], modes: list[str], built: list[tuple[dict, str]]) -> list[tuple[dict, str]]:
    """The builds whose generated code is counted: the firmware build of each program (the bare one only when that is the only
    mode asked for or the program has no other), and one build of the `game` set (its four builds are one source)."""
    mode = "firmware" if "firmware" in modes else modes[0]
    out, seen_game = [], False
    for p, m in jobs:
        if (p, m) not in [(b, bm) for b, bm in built] or (m != mode and p.get("mode") != m):
            continue
        if p["group"] == "game":
            if seen_game:
                continue
            seen_game = True
        out.append((p, m))
    return out


def patterns_report(progs: list[tuple[dict, str]], work: Path, level: str | None, defs: list[str], jobs: int, top: int) -> str:
    """Per set: the pattern counts over the cpcbas programs' generated code, and the most frequent adjacent pairs and triples."""
    with concurrent.futures.ThreadPoolExecutor(jobs) as ex:
        texts = list(ex.map(lambda pm: asm_of(pm[0], pm[1], work, level, defs), progs))
    out = []
    sets = sorted({p["group"] for p, _ in progs})
    for g in sets + (["all"] if len(sets) > 1 else []):
        sel = [(pm, t) for pm, t in zip(progs, texts) if t is not None and (g == "all" or pm[0]["group"] == g)]
        if not sel:
            continue
        total = {name: 0 for name in PATTERNS}
        bi: dict[str, int] = {}
        tri: dict[str, int] = {}
        n_ins = 0
        for _pm, t in sel:
            ins = instructions(t)
            n_ins += sum(1 for o, _ in ins if o != "label")
            for key, v in pattern_counts(ins).items():
                total[key] += v
            for src, n in ((bi, 2), (tri, 3)):
                for key, v in ngrams(ins, n).items():
                    src[key] = src.get(key, 0) + v
        out.append(f"#### Instruction patterns, set `{g}`: {len(sel)} builds, {n_ins} instructions of generated code (main and procedures)\n")
        out.append("| pattern | count |\n|---|---:|")
        for name in PATTERNS:
            out.append(f"| {name} | {total[name]} |")
        for title, src in (("adjacent pairs", bi), ("adjacent triples", tri)):
            out.append(f"\nMost frequent {title} (operands reduced: N number, L label, V variable):\n")
            out.append("| count | instructions |\n|---:|---|")
            for key, v in sorted(src.items(), key=lambda kv: (-kv[1], kv[0]))[:top]:
                out.append(f"| {v} | `{key}` |")
        out.append("")
    return "\n".join(out)


def parse_int_levels(text: str) -> list[int]:
    out = []
    for part in text.split(","):
        if part.strip() not in ("0", "1", "2", "3"):
            raise ValueError(f"fork level '{part}' is not 0, 1, 2 or 3")
        if int(part) not in out:
            out.append(int(part))
    return out


def parse_cpcbas_levels(text: str) -> list[str]:
    out = []
    for part in text.split(","):
        if part.strip() not in ("0", "1", "2", "3", "s"):
            raise ValueError(f"cpcbas level '{part}' is not 0, 1, 2, 3 or s")
        if part.strip() not in out:
            out.append(part.strip())
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--all", action="store_true", help="every program of the chosen groups")
    ap.add_argument("--programs", help="comma-separated program names")
    ap.add_argument("--groups", default="forkdiff,twin")
    ap.add_argument("--modes", default="firmware,bare")
    ap.add_argument("--variant", action="append", default=[], metavar="NAME=CLI", help="an extra cpcbas CLI column (repeatable)")
    ap.add_argument("--fork-O", default="2", dest="fork_o", metavar="LIST", help="the fork's levels, one column each (default 2; 0 and 3 are informative)")
    ap.add_argument("--cpcbas-O", default=None, dest="cpcbas_o", metavar="LIST",
                    help="cpcbas levels, a list of 0,1,2,3,s, one column each (default: one column, no -O)")
    ap.add_argument("-D", action="append", default=[], dest="defs", help="define passed to both compilers")
    ap.add_argument("--detail", action="store_true", help="per-program runtime chunk deltas")
    ap.add_argument("--summary", action="store_true", help="the milestone rows (per set and mode; see the module docstring)")
    ap.add_argument("--patterns", action="store_true", help="instruction pattern counts of the generated code, from --asm")
    ap.add_argument("--json", type=Path, help="write every program, build, region and chunk here")
    ap.add_argument("--against", type=Path, metavar="FILE.json", help="print the change from this earlier --json run")
    ap.add_argument("--diff", nargs=2, type=Path, metavar=("OLD.json", "NEW.json"), help="print the change between two --json files; build nothing")
    ap.add_argument("--report", type=Path, metavar="FILE.json", help="print the milestone rows and contributors of an existing --json file; build nothing")
    ap.add_argument("--top", type=int, default=12)
    ap.add_argument("--md", type=Path, help="also write the tables to this file")
    ap.add_argument("--work", type=Path, help="build directory (default: a temp dir, removed)")
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--reuse", action="store_true", help="with --work: reuse builds already there (re-run the tables only)")
    args = ap.parse_args()
    global REUSE
    REUSE = args.reuse
    if args.report:
        doc = reclassify_doc(read_json(args.report))
        print("## Milestone rows\n\n" + summary(doc) + "\n\n" + contributors(doc, args.top))
        return 0
    if args.diff:
        old, new = (read_json(f) for f in args.diff)
        print(against(old, new))
        return 0
    if not args.all and not args.programs:
        ap.error("give --all or --programs")
    try:
        fork_levels = parse_int_levels(args.fork_o)
        cp_levels = parse_cpcbas_levels(args.cpcbas_o) if args.cpcbas_o is not None else None
    except ValueError as exc:
        ap.error(str(exc))
    if not CLI.is_file():
        print(f"size-diff: {CLI} missing; run `npm ci && npm run build` first", file=sys.stderr)
        return 1
    if not FORK.is_dir() or not shutil.which("poetry"):
        print(f"size-diff: need the fork checkout at {FORK} and poetry in the PATH", file=sys.stderr)
        return 1
    variants = {}
    for v in args.variant:
        name, _, path = v.partition("=")
        if not path or not Path(path).is_file():
            print(f"size-diff: --variant {v}: not NAME=existing-CLI-path", file=sys.stderr)
            return 1
        variants[name] = Path(path)
    progs = programs(args.groups.split(","), args.programs.split(",") if args.programs else None)
    modes = args.modes.split(",")
    work = args.work or Path(tempfile.mkdtemp(prefix="size-diff-"))
    work.mkdir(parents=True, exist_ok=True)
    jobs = [(p, m) for p in progs for m in modes if p.get("mode", m) == m]
    with concurrent.futures.ThreadPoolExecutor(args.jobs) as ex:
        rows = list(ex.map(lambda pm: run_one(pm[0], pm[1], work, variants, fork_levels, args.defs, cp_levels), jobs))
    forks = [fork_col(o) for o in fork_levels]
    cp_cols = [cpcbas_col(lv) for lv in cp_levels] if cp_levels is not None else ["cpcbas"]
    cols = forks + cp_cols + list(variants)
    ref = fork_col(reference_fork(fork_levels))
    parts = []
    for mode in modes:
        mrows = [r for r in rows if r["mode"] == mode]
        ok = [r for r in mrows if r["res"]["fork"]["ok"] and r["res"]["cpcbas"]["ok"]]
        parts.append(f"### Image size, {mode} build\n\n" + table(ok, cols, ref))
        parts.append(f"Regions summed over the programs built on both sides ({mode}):\n\n" + totals(ok, forks))
        if {"prefix", "nomemcheck"} <= set(variants):
            parts.append(f"### Reachability and __MEMORY_CHECK__, {mode} build\n\n" + reach_table(ok))
        bad = failures(mrows)
        if bad:
            parts.append(f"Builds that failed ({mode}; a `-` in the tables above):\n\n" + bad)
        parts.append(f"### Regions per program, {mode} build\n\n" + regions_table(ok))
        parts.append(f"### Runtime chunks that differ, summed over the programs, {mode} build\n\n" + aggregate(ok, args.top))
        if args.detail:
            parts.append(f"### Runtime chunks per program, {mode} build\n" + detail(ok, args.top))
    meta = {"tool": "tools/size-diff.py", "classifier": CLASSIFIER, **git_state(), "groups": args.groups.split(","), "modes": modes, "defines": args.defs,
            "fork_cols": forks, "reference_fork_col": ref,
            "cpcbas_cols": cp_cols, "primary_cpcbas_col": cp_cols[-1 if cp_levels is None else cp_cols.index(cpcbas_col(primary_level(cp_levels)))],
            "variants": sorted(variants), "programs": args.programs}
    doc = to_json(rows, meta)
    if args.summary:
        if cp_levels is None:
            ap.error("--summary needs --cpcbas-O")
        parts.append("## Milestone rows\n\n" + summary(doc))
        parts.append(contributors(doc, args.top))
    if args.against:
        parts.append("## Against " + str(args.against) + "\n\n" + against(read_json(args.against), doc))
    if args.patterns:
        plevel = primary_level(cp_levels) if cp_levels is not None else None
        pp = patterns_programs(jobs, modes, [(r["program"], r["mode"]) for r in rows if r["res"]["cpcbas"]["ok"]])
        parts.append("## Generated code\n\n" + patterns_report(pp, work, plevel, args.defs, args.jobs, args.top))
    if args.work is None:
        shutil.rmtree(work, ignore_errors=True)
    text = "\n\n".join(parts) + "\n"
    print(text)
    if args.md:
        args.md.write_text(text)
    if args.json:
        write_json(args.json, doc)
    return 0


if __name__ == "__main__":
    sys.exit(main())
