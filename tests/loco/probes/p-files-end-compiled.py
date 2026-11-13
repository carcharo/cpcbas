#!/usr/bin/env python3
"""Run the compiled twin of a p-files-end*.bas probe on Caprice32 and print the raw printer capture (L4-FIX-B, follow-up 127).

The probe's lines below 100 are compiled with cpcbas and run (they open a file and stop: END, ERROR, STOP, running off the end).
The machine then resets to the firmware's Ready (the compiled program ends at RST 0, the disc image stays in the emulator), where
lines 100 and above are typed (PRINT becomes PRINT #8, the printer) and run with GOTO 100: they report whether the file is still open
(error 27 at OPENOUT/OPENIN) and whether the output file reached the disc, as the interpreter's probe does (p-files-end.py).
Development tooling only (never in npm test).

    python3 tests/loco/probes/p-files-end-compiled.py tests/loco/probes/p-files-end.bas [464|6128]
"""
import importlib.util
import re
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("locodiff", REPO / "tools" / "loco-diff.py")
ld = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ld)
cpcrun = ld.load_cpcrun(ld.default_sibling("cpcbuild"))

bas, model = Path(sys.argv[1]).resolve(), (sys.argv[2] if len(sys.argv) > 2 else "6128")
lines = bas.read_text().splitlines()
num = lambda l: int(re.match(r"\d+", l).group())
head = [re.sub(r"^(\d+) GOTO 300$", r"\1 REM", l) for l in lines if num(l) < 100]  # end-fall: the jump to a missing line is the fall-off
tail = [re.sub(r"\bPRINT ", "PRINT #8,", l) for l in lines if num(l) >= 100]
with tempfile.TemporaryDirectory() as t:
    tmp = Path(t)
    srcdir = tmp / "src"
    srcdir.mkdir()
    twin = srcdir / "twin.bas"
    twin.write_text("\n".join(head) + "\n")
    dsk, stem = ld.build_compiled(cpcrun, twin, tmp)
    pr = tmp / "printer.dat"
    try:  # the run goes on after the program's reset and ends at its timeout
        cpcrun.run_emulator(dsk, stem, pr, 45, cpcrun.subprocess_env(), model, typed=["", "", "", ""] + tail + ["GOTO 100"])
    except cpcrun.TimeoutHit:
        pass
    print(repr(pr.read_bytes().decode("latin-1") if pr.exists() else None))
