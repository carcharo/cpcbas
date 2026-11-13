# Locomotive conformance programs and the printer-diff harness

`tests/loco/*.bas` are the conformance programs of the L2 subset (numbered lines, integer and
string features only). `*.expected` are what the real Locomotive interpreter printed for them;
the compiled programs must print the same. `blessed.json` records, per program, the emulator
that produced the transcripts, the expected files, and the sha256 of each model's transcript.
`probes/` holds small programs used to measure interpreter behaviour; they are not blessed.

## Running

    npm run build                       # the harness assembles its hook with cpcbas's own assembler
    python3 tools/loco-diff.py --interpret tests/loco/hello.bas --model 464
    python3 tools/loco-diff.py --interpret tests/loco/hello.bas --model 6128 [--emu cap32|cpcec]
    python3 tools/loco-diff.py --interpret tests/loco/int-print.bas --bless   # both models, twice each

Without `--bless` the normalised transcript is printed. `--bless` runs each program twice per model,
refuses to write anything unless the runs agree, and writes `<name>.expected` when the 464 and
the 6128 agree (removing per-model files) or `<name>.464.expected` / `<name>.6128.expected` when
they differ. `--raw` prints the capture as the printer got it; `--unfiltered` builds the hook without
the filter, to see every byte the interpreter sends (CR, LF, control codes). `--keep DIR` keeps the
disc and the raw capture. Needs `../cpcbuild/tools/cpcrun.py`
(`--cpcbuild DIR`) and its Caprice32 build. `npm test` never runs an emulator; it only checks that
the blessed files exist and are well formed (`packages/cpcbas/test/loco-expected.test.ts`).

**Optimisation levels** (L5-DIFF): `--opt L` (0, 1, 2, 3 or s) on `--compiled` and `--all` builds the compiled side with `-O L`; the expected
files stay the interpreter's, so an optimiser can never bless its own output. `tools/conformance.py`, `tools/fork-diff.py` and `tools/lamp.py`
take the same flag, and `tools/opt-diff.py --all --level L` compares each program's `-O0` and `-O L` builds with each other on the emulators.

**The emulator** (R13): without `--emu`, every run (interpret, `--bless`, `--compiled`, `--all`) uses CPCEC (about 0.1 s a
run), except a program with `REM LOCO-TYPE`, which uses Caprice32 (CPCEC cannot type). `--emu cap32` or `--emu cpcec`
forces one for every program. Bless and gate on the same emulator: a shot's sha256 is checked only on the emulator its
record names.

## How the capture works

The harness disc holds `RUN.BAS` (a loader), `ECHO.BIN` (the hook, `tools/loco-harness/echo.asm`)
and `T.BAS` (the program, an ASCII file without an AMSDOS header). The emulator types `run"RUN`;
the loader does `MEMORY &8FFF`, loads the hook at &9000, calls it and runs `T.BAS`. (`RUN"T`
without the extension works too.) The program text is not changed: nothing is prepended to it.

The hook replaces the TXT OUT ACTION indirection (&BDD9, a RAM `JP` on both models) with a jump to
itself: every byte BASIC sends to the text screen goes to MC PRINT CHAR (&BD2B), then on to the
original routine.

## The echo filter

Every byte sent to the text screen is echoed, except: 13 becomes a line end (`\n`), 10 is dropped,
other codes below 32 are dropped. Parameters of control codes (above 31) are echoed like any other
byte. Compiled programs apply the same filter in the runtime (`__CPC_PRINTER_ECHO__`). The
interpreter prints `Ready` at the start of a line when the program ends; the hook then sends
the END marker (`\x04END\n`), which stops the emulator.

Normaliser (`normalise` in `tools/loco-diff.py`, shared with L2-CONF): line ends to `\n`; the END
marker and everything after it removed; the trailing `Ready` removed; the text ends with a `\n`
(the interpreter sends CR LF before `Ready` if the cursor is not at the start of a line, so the
two cases cannot be told apart); a line starting with `~` (a timing value) is reduced to `~`, so
only its presence is compared.

`compare.json` has two lists. `"real-exact"` (FWM-CORE; every REAL program: `real-arith`, `real-basic`, `real-bytes`, `real-fn`,
`real-rnd`, `real-round`, `real-val`) is compared byte for byte in a firmware build, because the firmware's maths are the
interpreter's own (`--all` passes on the 464, 664, 6128 and 6128 Plus on CPCEC; the 664 and Plus run against the 464/6128
transcript), and under the real rule in a bare build (`--bare`; the five-byte dumps of those programs are left out there).
`"real"` is for a program that cannot be exact (none today). The `real-*` programs print each result as text and as its five
bytes (`HEX$(PEEK(@a+i))`), so a last-bit difference shows. They keep to values that do not overflow: without an `ON ERROR` handler the
interpreter prints `Overflow` and carries on with the largest number (measured: "REAL errors"), and our
errors are fatal until L4. `probes/real-err.bas` records those cases and is not compared.

Real rule: a program listed under `"real"` in `compare.json` (or under `"real-exact"` in a bare build) is compared token by token instead of byte for byte: each line splits into numbers
(Locomotive number text such as `-1.5`, `.03`, `1.23457E+12`) and the text between them; the text
must be identical and each pair of numbers must agree to 8 significant digits (one unit in the 8th
digit). `--bless` copies the rule into the program's `blessed.json` record (`"compare": "real"`).
The rule is `transcripts_match` in `tools/loco-diff.py` (unit tests: `python3
tools/test_loco_diff.py`) and `transcriptsMatch` in `packages/cpcbas/test/compile-helper.ts` for the
in-process conformance.

## Headers, screens and the gate lists (L4-HARNESS)

A program can carry harness headers: numbered `REM` lines, read by `tools/loco-diff.py` (`parse_headers`) and left in the program
(the interpreter and the compiler see them as ordinary remarks).

| Header | Effect |
|---|---|
| `REM LOCO: shot` | the screens are compared too (below); the program must end by running out of lines, not with `END` or `STOP` |
| `REM LOCO-TYPE: text\|text\|...` | keys typed on both runs, each entry followed by RETURN, on the schedule of `run_emulator` (the first after 4 delays, about 4 s, the rest 1 s apart). **Caprice32 only**: CPCEC has no typed input (`--emu cpcec` stops with a message). A program that types keys should wait for them (a `PAUSE` or a loop) before it ends |
| `REM LOCO-DISK: NAME=path` | the file goes on the disc of both runs as AMSDOS `NAME` (8.3, upper case, no header), path relative to the program. The interpreter reads it through AMSDOS; the compiled disc gets it with `--dsk-add` |

**Screens.** The interpreter's transcript is compared as before. In addition, for each model, the harness runs the interpreted and
the compiled program once more as screenshot runs on the same emulator, and the two PNGs must be equal pixel for pixel. A mismatch
prints the number of differing pixels and the first one, and writes `<name>.<model>.diff.png` (red where they differ, the rest dimmed),
with the two shots beside it, to `--keep DIR` or `$TMPDIR/loco-diff-shots`.

- The shot run takes the screen `--shot-wait` seconds after the start (default 20; CPCEC: its end-of-run screen grab at that frame,
  Caprice32: CAP32_SCRNSHOT after that many delays). The program must be over by then; a program that needs longer sets the
  option, or the shots differ.
- The interpreter's hook is built with `SHOT` (`tools/loco-harness/echo.asm`): the characters of its own `Ready` are held back and
  never drawn (they are drawn if the line is not `Ready` after all), and when `Ready` is complete the hook stops there in a
  `HALT` loop. The screen is what the program left: no `Ready`, no prompt cursor. The compiled program is built without the
  printer echo: its `END` waits for a key (it does not reset), so its screen stays too.
- `--bless` runs the interpreted shot twice per model, refuses if the two PNGs differ, and records the sha256 of the PNG file per
  model in `blessed.json` (`"shot": {"464": ..., "6128": ...}`), next to the transcript's. A program that prints nothing blesses
  an empty transcript. Later runs check the interpreted shot against that sha256 (to notice an emulator that drifted) when they use
  the emulator the record names, and always compare it with the compiled shot. CPCEC and Caprice32 draw other colours and other
  sizes (768x536 and 768x540): bless on the emulator the gate runs on (`--emu cpcec` for `--all`).
- `--interpret FILE.bas --shot OUT.png` saves the interpreted screen of any program without blessing.
- `tests/loco/shot-plot.bas` is the two-line demo (`MODE 1: PLOT 100,100`), blessed on CPCEC. PLOT compiles since L4-GFX, so
  the program is compared like any other (it left `"compiled-skip"`); `gfx-plot.bas` and `gfx-origin.bas` are the full graphics
  programs with screens, `gfx-plot` also in a bare build.

**The gate lists** in `compare.json` (follow-up 68; `--all --bare` is clean and prints each skip with its reason):

- `"bare-skip": {name: reason}`: programs left out of a `--bare` run (`int-memory` needs the firmware; `real-rnd`'s bare RND is a
  different generator).
- `"bare-stop": {name: {rows, error, reason, timeout}}`: a bare run that ends in a documented runtime error (`real-round`: bare
  ROUND raises `Error 5` on row 52, R11 item 4). The first `rows` lines of the capture are compared with the blessed ones under the
  real rule, with the dumps left out; the run has no END marker, so it is not a hang.
- `"compiled-skip": {name: reason}`: a program the compiler rejects on purpose until a task merges. While the compiler rejects it,
  `--all` reports it as skipped (with the reason); once it compiles the entry is ignored and the program runs, with a note to remove it.
- The five-byte dumps of the `"real-exact"` programs are stripped from the joined lines in a bare run, so a dump the screen wrapped at
  column 40 (`:12EBDF5B` then `7F` on the next line) is removed whole.

## Limits and documented differences

- A program that prints `Ready` at the start of a line itself ends the run early: not supported.
- A program that raises a Syntax error in a DATA line (or any error that leaves BASIC in the line
  editor) never reaches `Ready`: the harness times out and shows what was printed.
- The 464 (BASIC 1.0) refuses `=<` and `=>` (Syntax error); the 6128 accepts them. They are in
  `int-compare-rev.bas`, blessed for the 6128 only (`int-compare-rev.6128.expected`).
- The conformance subset avoids what cpcbas does differently from Locomotive: `/` on integers (integer
  in cpcbas, real in Locomotive), assigning a real to an integer (cpcbas truncates, Locomotive
  rounds), integer overflow (cpcbas wraps, Locomotive reports Overflow), and runtime error text. (A FOR with an empty range runs zero times on both: measured
  2026-11-08, `probes/p-for-empty.bas`.) (`/` on integers covers
  literals too: `1/3` is 0 in cpcbas; real-basic.bas divides REAL variables.)
- `INKEY$` is only used with no key pressed. Timing is only compared by presence (`~` lines).
- The harness runs at emulator speed with sound off; a program must not depend on wall-clock time.

## The compiled side (L2-CONF)

    npm run build
    python3 tools/loco-diff.py --compiled tests/loco/hello.bas [--model 464|6128] [--emu cap32|cpcec]
    python3 tools/loco-diff.py --all [--model M] [--emu E] [--programs a,b] [--keep DIR]

`--compiled` builds the program with the CLI (`-D __CPC_PRINTER_ECHO__ -o T.dsk`, from a copy named
with the 8-character alphanumeric AMSDOS stem), runs the disc on the emulator and model with the
printer captured, passes the capture through `normalise` and compares it with the blessed
transcript. A program blessed for one model only (`int-compare-rev`) is compared with that
transcript on both models. Exit codes: 0 match, 3 differs (first differing line and a unified diff
printed), 5 the compiler rejected the program ("not compiled"), 2 hang, 4 no END marker.
`--all` runs every program of `blessed.json` on both models and prints a table with timings
(about 5 s per run on Caprice32, 0.1 s on CPCEC); the diffs follow the table.

`npm test` has the fast in-process version: `packages/cpcbas/test/loco-conformance.test.ts` compiles
every blessed program with `compile()`, runs the image on the test-only Z80 simulator and compares
with the blessed transcript. A program that needs an unmerged feature is listed in `SKIPS` with the
task name; a known difference is listed in `KNOWN_FAILURES` and asserted to still fail.
Results of the emulator runs are in the maintainers' private notes.
