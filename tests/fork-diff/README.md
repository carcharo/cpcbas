# Fork diff: cpcbas against the frozen Boriel BASIC fork

Each program here is written in the subset common to CPC BASIC and the fork's Boriel dialect. The
harness builds it with both compilers, runs both discs on Caprice32 (464 and 6128) with the printer
captured, normalises and diffs the transcripts.

    npm run build
    python3 tools/fork-diff.py --all                      # every program, both models, a table
    python3 tools/fork-diff.py --program tests/fork-diff/flow.bas --model 6128 --show

Needs the fork checkout (`../zxbasic`, `poetry`), cpcbuild's `tools/cpcrun.py` and Caprice32 (`--fork`,
`--cpcbuild`, `--emu`). Results, differences found and the normalisation rules
are in the maintainers' private notes.

Rules for a program here: numbers print as `PRINT "[";x;"]"`; comparisons only inside IF; functions
defined before they are used; no ASC, MID$, LEFT$, RIGHT$ except through the macros in `common.bas`;
no names that are Locomotive keywords (`Width`); arrays are fine (`DIM a(9) AS UBYTE`, `AS FLOAT` for REAL, one `UBOUND(a, 1)` spelling); lines under 40 columns on the cpcbas
side. `known/` holds probes of differences that are not bugs to fix; `--all` skips it.
No `EXIT SUB` / `EXIT FUNCTION` and no GOSUB, ON ... GOSUB or a bare RETURN inside a SUB or FUNCTION: the fork has no `EXIT SUB` (its EXIT is for loops only) and forbids GOSUB in a procedure, so a program compiled by both compilers uses neither form (they are cpcbas-only; main-program GOSUB is fine).
