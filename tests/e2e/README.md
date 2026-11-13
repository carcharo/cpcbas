# End-to-end smoke test

A program assembled and packed by cpcbas runs on an emulated CPC and prints the expected text.

- `hello.bas`: the program, in the Boriel dialect of the reference compiler (this test is about the
  assembler and the disc writer, not the parser): `PRINT "Hello CPC"`, then a FOR loop printing 1 to 5.
- `hello.asm`: the reference compiler's output for it
  (`zxbc --arch cpc -f asm -D __CPC_PRINTER_ECHO__`), with the `#line` path made relative. The
  `-D __CPC_PRINTER_ECHO__` build copies PRINT output to the printer port and makes END send a
  marker line, which is how the run is captured.
- `hello.expected`: the exact printer capture, without the marker line (`\x04END\n`) that the
  harness drops and everything after it.

## Running it

    npm run build
    python3 tools/e2e-smoke.py [--fork DIR] [--cpcbuild DIR] [--emu cap32|cpcec] [--models 464,6128]

The script compiles `hello.bas` with the fork, assembles and packs it with cpcbas
(`tools/e2e-assemble.mjs`: `HELLO.BIN` on a `.dsk`, load and entry at the program's origin), runs the
disc headless on a 464 and a 6128 through cpcbuild's `tools/cpcrun.py` and diffs the capture with
`hello.expected`. It prints one line per model and exits 0 when all match.

`--fork` and `--cpcbuild` default to `zxbasic` and `cpcbuild` beside the repository (or beside the main
checkout when run from a worktree). The fork needs `poetry`; the emulators are the ones cpcrun.py
finds (Caprice32, or CPCEC with `--emu cpcec`). chipsrun cannot be used: it quickloads an AMSDOS
binary and has no disc, so it would not exercise the disc writer.

## Without an emulator

`packages/cpcbas/test/e2e-pipeline.test.ts` assembles the committed `hello.asm` and packs it on a disc,
so CI covers the pipeline without the emulator. To regenerate `hello.asm` after a change in the
reference compiler, run the zxbc command above and replace the absolute path in the `#line` lines by
`tests/e2e/hello.bas` (the smoke script prints a note when the committed file differs).

## The compiled program: tools/e2e-cpcbas.py

    npm run build
    python3 tools/e2e-cpcbas.py [--cpcbuild DIR] [--emu cap32|cpcec] [--models 464,6128]

Builds `tests/loco/hello.bas` with the built CLI (`node packages/cpcbas/dist/bin/cpcbas.js
tests/loco/hello.bas -D __CPC_PRINTER_ECHO__ -o hello.dsk`), runs the disc on a 464 and a 6128
through cpcrun.py with the printer captured, normalises the capture with `tools/loco-diff.py`'s
`normalise` and compares it with `tests/loco/hello.expected`. It prints the raw and the normalised
capture per model. `packages/cpcbas/test/compile-e2e.test.ts` and `cli-build.test.ts` cover the same
path on the test Z80 without an emulator.
