#!/usr/bin/env python3
"""size_rows.py -- what FWM-CORE changed in program sizes (FWM-BENCH; development tooling).

Reads the builds `tools/size-diff.py --all --fork-O 0 --variant precore=<CLI of the commit before FWM-CORE> --work DIR`
left in DIR (nothing is rebuilt) and prints Markdown: per program the image size in L3-SIZE (main 8e22268), before FWM-CORE (2dd8c99) and now, the region and runtime-chunk changes of the REAL programs, and the totals.

    python3 bench/size_rows.py --work DIR --precore <pre-core checkout>/packages/cpcbas/dist/bin/cpcbas.js
"""
from __future__ import annotations

import argparse
import importlib.util
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("size_diff", REPO / "tools" / "size-diff.py")
SD = importlib.util.module_from_spec(spec)
sys.modules["size_diff"] = SD
spec.loader.exec_module(SD)

REAL_PROGRAMS = ("floats", "lowram", "fixedpoint", "reals")


def l3size_bytes(report: Path) -> dict[tuple[str, str, str], int]:
    """(name, set, mode) -> cpcbas image bytes, from the two 'Per program' tables of the L3-SIZE report."""
    out, mode = {}, None
    for line in report.read_text().splitlines():
        if line.startswith("## Per program, firmware"):
            mode = "firmware"
        elif line.startswith("## Per program, bare"):
            mode = "bare"
        elif line.startswith("## "):
            mode = None
        elif mode and line.startswith("| ") and not line.startswith("| program") and not line.startswith("|---"):
            c = [x.strip() for x in line.strip("|\n").split("|")]
            if c[4].isdigit():
                out[(c[0], c[1], mode)] = int(c[4])
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--work", type=Path, required=True)
    ap.add_argument("--precore", type=Path, required=True, help="the CLI of the commit to compare with (builds it if --rebuild)")
    ap.add_argument("--programs", help="comma-separated program names (default: all)")
    ap.add_argument("--l3size", type=Path, required=True, help="the L3-SIZE report (Markdown) with the two 'Per program' tables")
    ap.add_argument("--rebuild", action="store_true", help="build in --work (needs poetry and ../zxbasic); default: read what is there")
    args = ap.parse_args()
    SD.REUSE = not args.rebuild
    old = l3size_bytes(args.l3size)
    rows = []
    for p in SD.programs(["forkdiff", "twin"], args.programs.split(",") if args.programs else None):
        for mode in ("firmware", "bare"):
            rows.append(SD.run_one(p, mode, args.work, {"precore": args.precore}, [], []))
    both = [r for r in rows if r["res"]["cpcbas"]["ok"] and r["res"]["precore"]["ok"]]
    out = []
    for mode in ("firmware", "bare"):
        out.append(f"### Programs whose image changed with FWM-CORE, {mode} build\n")
        out.append("| program | set | L3-SIZE (8e22268) | before FWM-CORE (2dd8c99) | now | now - before | main | program | runtime | data |")
        out.append("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|")
        for r in both:
            if r["mode"] != mode:
                continue
            p, c, o = r["program"], r["res"]["cpcbas"], r["res"]["precore"]
            if c["image"] == o["image"]:
                continue
            d = {k: c["regions"][k] - o["regions"][k] for k in ("main", "program", "runtime", "data")}
            first = old.get((p["name"], p["group"], mode))
            out.append(f"| {p['name']} | {p['group']} | {first if first else '-'} | {o['image']} | {c['image']} | {c['image'] - o['image']:+d} | "
                       f"{d['main']:+d} | {d['program']:+d} | {d['runtime']:+d} | {d['data']:+d} |")
        n_same = sum(1 for r in both if r["mode"] == mode and r["res"]["cpcbas"]["image"] == r["res"]["precore"]["image"])
        n = sum(1 for r in both if r["mode"] == mode)
        sb = sum(r["res"]["precore"]["image"] for r in both if r["mode"] == mode)
        sn = sum(r["res"]["cpcbas"]["image"] for r in both if r["mode"] == mode)
        out.append(f"\n{mode}: {n} programs built by both; {n_same} unchanged; sum of images {sb} before, {sn} now ({sn - sb:+d}).\n")
    for mode in ("firmware", "bare"):
        for name in REAL_PROGRAMS:
            for r in both:
                if r["mode"] == mode and r["program"]["name"] == name:
                    c, o = r["res"]["cpcbas"], r["res"]["precore"]
                    cm, om = {}, {}
                    for tgt, res in ((cm, c), (om, o)):
                        for n, _, s, reg in res["chunks"]:
                            if reg == "runtime":
                                tgt[n] = tgt.get(n, 0) + s
                    diff = sorted(((n, om.get(n, 0), cm.get(n, 0)) for n in set(cm) | set(om) if cm.get(n, 0) != om.get(n, 0)),
                                  key=lambda t: -abs(t[2] - t[1]))
                    out.append(f"**{name}, {mode}**: runtime chunks that changed (before -> now): " +
                               ", ".join(f"`{n.removeprefix('.core.')}` {a}->{b}" for n, a, b in diff[:10]) +
                               (f", and {len(diff) - 10} more" if len(diff) > 10 else "") + "\n")
    print("\n".join(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
