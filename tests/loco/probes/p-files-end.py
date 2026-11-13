#!/usr/bin/env python3
"""Run a p-files-end*.bas probe under the interpreter on Caprice32 and print the raw printer capture (R15, follow-up 127).

The probe's lines 10-20 open a file and stop (END, ERROR, STOP, running off the end); then the direct command `GOTO 100`
is typed at the interpreter's Ready, and lines 100 on report whether the file is still open (error 27 at OPENOUT/OPENIN)
and whether the output file reached the disc. loco-diff.py cannot do this: it ends the run at the first Ready.
Development tooling only (never in npm test).

    python3 tests/loco/probes/p-files-end.py tests/loco/probes/p-files-end.bas [464|6128]
"""
import importlib.util
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("locodiff", REPO / "tools" / "loco-diff.py")
ld = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ld)
cpcrun = ld.load_cpcrun(ld.default_sibling("cpcbuild"))

bas, model = Path(sys.argv[1]).resolve(), (sys.argv[2] if len(sys.argv) > 2 else "6128")
with tempfile.TemporaryDirectory() as tmp:
    dsk, pr = Path(tmp) / "loco.dsk", Path(tmp) / "printer.dat"
    subprocess.run(["node", str(REPO / "tools/loco-harness/build.mjs"), "--bas", str(bas), "--dsk", str(dsk), "--unfiltered"],
                   check=True, capture_output=True)
    try:  # no end-on-marker: the run goes on after the first Ready and ends at its timeout
        cpcrun.run_emulator(dsk, "RUN", pr, 45, cpcrun.subprocess_env(), model, typed=["", "GOTO 100"])
    except cpcrun.TimeoutHit:
        pass
    print(repr(pr.read_bytes().decode("latin-1") if pr.exists() else None))
