#!/usr/bin/env python3
"""Writes the DSK fixtures into OUTDIR (default tests/pack/dsk): <case>.dsk made by the reference
tools/cpc/mkdsk.py (its DiskImage), and cases.json describing every case.

Inputs are not stored: file `seed`/`length` give bytes[i] = (i * 7 + seed) & 0xFF, which the test
regenerates. A case that overflows the disc stores the reference error text instead of a .dsk.

Usage: python3 tools/gen-dsk-fixtures.py [OUTDIR] [PATH-TO-mkdsk.py]
mkdsk.py is stdlib-only, so plain python3 is enough.
"""
import importlib.util
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
out = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "tests" / "pack" / "dsk"
if len(sys.argv) > 2:
    mkdsk_path = Path(sys.argv[2])
else:
    # The fork is a sibling of this repository (or of the main checkout, from a worktree).
    candidates = [d / "zxbasic" / "tools" / "cpc" / "mkdsk.py" for d in root.parents]
    mkdsk_path = next((c for c in candidates if c.exists()), candidates[0])
spec = importlib.util.spec_from_file_location("mkdsk", mkdsk_path)
mkdsk = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mkdsk)

HDR = 128
BLOCK = 1024
CAPACITY = 178 * BLOCK  # data bytes on an empty disc


def f(name, length, seed=1, load=0x4000, entry=None):
    return {"name": name, "length": length, "seed": seed, "load": load, "entry": load if entry is None else entry}


cases = {
    "one_byte": [f("A.BIN", 1)],
    "len_1023": [f("B1023.BIN", BLOCK - HDR - 1)],  # 1023 bytes with the header
    "len_1024": [f("B1024.BIN", BLOCK - HDR)],  # 1024 with the header
    "len_1025": [f("B1025.BIN", BLOCK - HDR + 1)],  # 1025 with the header
    "extent_full": [f("EXT16.BIN", 16 * BLOCK - HDR)],  # exactly 16 KB with the header
    "extent_plus1": [f("EXT17.BIN", 16 * BLOCK - HDR + 1)],  # two extents
    "size_64k": [f("BIG64K.BIN", 65536)],
    "three_files": [f("MAIN.BIN", 3000, 1, 0x1000, 0x1000), f("DATA1.DAT", 700, 2, 0x4000, 0), f("DATA2.DAT", 5000, 3, 0x4000, 0)],
    "long_name": [f("VERYLONGNAME.BINARY", 300, 4)],
    "lower_name": [f("game.bin", 300, 5)],
    "no_ext": [f("NOEXT", 300, 6)],
    "load_ne_entry": [f("GAME.BIN", 1234, 7, 0x0170, 0x0200)],
    "disc_exact": [f("FULL.BIN", CAPACITY - HDR)],
    "disc_over": [f("OVER.BIN", CAPACITY - HDR + 1)],
}


def data(spec):
    return bytes((i * 7 + spec["seed"]) & 0xFF for i in range(spec["length"]))


meta = {}
out.mkdir(parents=True, exist_ok=True)
for name, files in cases.items():
    disk = mkdsk.DiskImage()
    entry = {"files": files}
    try:
        for s in files:
            disk.add_file(s["name"], data(s), load_addr=s["load"], exec_addr=s["entry"])
        (out / f"{name}.dsk").write_bytes(disk.to_dsk_bytes())
    except mkdsk.DiskFullError as exc:
        entry["error"] = str(exc)
    meta[name] = entry
(out / "cases.json").write_text(json.dumps(meta, indent=1) + "\n")
print(f"wrote {len(meta)} cases to {out}")
