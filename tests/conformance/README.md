# Conformance programs

Self-checking programs, one per language area, run on an emulated CPC. Each prints one line per
check, `PASS name` or `FAIL name got=... want=...`, and ends with `DONE` if every check ran. A
program passes when the run reached its end (the END marker), printed `DONE` on a line of its own and
printed no `FAIL` line. The programs are ported from cpcbuild's conformance suite; where the
language differs from the reference compiler's, the expected value changed and a `REM` next to
it says why.

The directory holds 74 programs: 12 language programs (`arithint`, `arrays`, `controlflow`,
`dataread`, `fixedpoint`, `floats`, `heap`, `lowram`, `strings`, `subsfuncs`, `swap32`, `bareframes`),
34 library programs (the `cb_*` programs, `banks`, `banks464`, `music` and the 20 `plus_*`
programs) and 28 programs ported in L4-CONF: the text, graphics, keyboard, sound, machine-state and
bank/hook programs (table below; "Left out" says which two of cpcbuild's programs are not here). The language programs exercise arrays, strings, procedures and the number types; the
library programs exercise the BASIC library in `lib/` (see `lib/README.md`) and its assembly.
The newer statements and functions (`HEX$`, `BIN$`, `DEC$`, the `MID$` statement, `PRINT AT`,
`RND`, `ROUND`) are not in this directory: they are checked by the unit tests in
`packages/cpcbas/test/` (`str-more.test.ts`, `math-run.test.ts`), with expected values measured on
the Locomotive interpreter (measured transcripts).

## Running

    npm run build
    python3 tools/conformance.py --emu chips                          # 6128, firmware (default)
    python3 tools/conformance.py --emu chips --model 464
    python3 tools/conformance.py --emu chips --model 6128 --bare      # -D CPC_BAREMETAL
    python3 tools/conformance.py --emu chips --model 464 --cold       # bare, no firmware at all
    python3 tools/conformance.py --emu cpcec --model plus             # a 6128 Plus (also --emu cap32)
    python3 tools/conformance.py --list --bare                        # what would run, nothing runs
    python3 tools/conformance.py -k heap arithint.bas                 # a subset
    python3 tools/test_conformance.py                                 # the runner's own tests

`npm test` runs the same programs in-process on the Z80 simulator
(`packages/cpcbas/test/conformance-sim.test.ts`, firmware mode, 6128). The runner needs the cpcbuild
checkout next to this one for `tools/cpcrun.py` and the chipsrun binary (`--cpcbuild DIR`).

The library programs are bigger and slower than the language programs (no optimiser yet): a
few need more than the default 60 s of emulated time on chipsrun (`cb_sprites`, `cb_tiles`, `cb_tilerestore`
and `cb_tilewidth` say so with `REM TIMEOUT: 300`; each takes 5 to 9 s of real time; the Plus runs on CPCEC and
Caprice32 take under a second per program).

Exit status 0: nothing failed, timed out, did not build or passed unexpectedly. The summary line
counts as `run.py` did: passed, failed, timed out, build errors, expected failures (XFAIL),
unexpected passes (XPASS) and skipped programs (other model, emulator or mode, with the reason).

## Header lines

`REM` lines anywhere in a program:

| Line | Meaning |
|---|---|
| `REM MODELS: 464 6128` | only these models (464 664 6128 plus); none listed = every model, Plus included |
| `REM EMUS: cap32` | only this emulator (a test that needs a disc) |
| `REM CPCBAS: -W 320` | extra compiler arguments |
| `REM DISKFILE: N.BIN=assets/n.bin` | a data file on the disc (`--dsk-add`; not with chips) |
| `REM TYPE: text` | keys typed while it runs (not with CPCEC) |
| `REM BARE: skip <reason>` | never works bare (firmware features): skipped under `--bare`/`--cold` |
| `REM BARE: only` | a bare-metal test: skipped in a normal run (no `PRINT`: `lib/bareout.bas`) |
| `REM STATE: key=value ...` | chips: compare the state dump the program asked for (`BState()`) |
| `REM TIMEOUT: n` | seconds of emulated time for this program, used in place of `--timeout` when larger (the default is 60) |
| `REM XFAIL: needs L3-XXX` | waiting for a feature that is not merged (or a follow-up that is not done): reported as XFAIL with the reason, not counted against the total. When the program passes the run reports XPASS and fails: remove the line |
| `REM SIM: skip <reason>` | read only by `npm test` (`conformance-sim.test.ts`): the program is not run on the Z80 simulator (it needs RAM banking, pixels read back, a hardware scroll offset, frame flybacks or the firmware's sound events, which the simulator does not model); `tools/conformance.py` ignores the line |

The runner adds `-D __CPC_PRINTER_ECHO__` (the printer hook the capture reads), `-D CPC464`
(464 and 664), `-D CPC6128` or `-D PLUS`, `-D CPC_BAREMETAL` with `--bare`/`--cold` and
`-D CPC_LINE_464` for a cold 464. Byte 12 is dropped from every transcript before it is read: on the
464 `CLS` echoes a form feed to the printer hook, on the 6128 it does not.

## Helpers

| File | Purpose |
|---|---|
| `lib/chk.bas` | `CHK(name, got$, want$)`; `N$(v)` is the text of an integer without Locomotive's leading space (`STR$(5)` is `" 5"`), `T$(s$)` drops one leading space from any text, e.g. `T$(STR$(x))` for a REAL, a FIXED or a ULONG |
| `lib/heapinfo.bas` | `MemAvail()` and `MaxAvail()`: the free-list walks of `heap.bas` |
| `lib/ticks.bas` | `Ticks()`, a 300 Hz clock in both modes |
| `lib/bareout.bas` | output without `PRINT` for bare-metal tests: `BPutCh`, `BPrint`, `BLine`, `BNum`, `BCHK`, `BRng`, `BDone`, `BState` |
| `lib/tstr.bas` | `T$` and `N$` alone (for programs that keep their own `CHK`) |
| `lib/chkbuf.bas` | the screen-checking programs' `CHK`: it counts passes and failures and keeps the failing lines in `results$` (no printing, which would disturb the screen); `Report()` prints them at the end, with a `FAIL n of m checks failed` line if any check failed. Passing lines are not collected: a string past about 1 KB makes the next concatenation run out of the 4.7 KB heap and `results$` silently comes back empty (cpcbuild's cb_fill lost its first 40 results that way) |
| `lib/pixel.bas` | `Pt(x, y)` (the old `POINT`: pen of a pixel, mode pixels from the bottom-left) and `PlotPx(x, y)`: POINT and PLOT are statements now (L4-GFX); the `cb_*` programs keep these as an independent view of the screen, the L4-CONF programs use POINT |
| `lib/scrolloff.bas` (also used by `text.bas`), `lib/ticks.bas`, `lib/banktrack.bas`, `lib/fhlib.bas` (the frame hook helpers of `framehook.bas`: ported in L4-CONF, nothing used it before), `lib/cb_fastcase.bas`, `lib/plushelp.bas`, `lib/plusbig_body.bas`, `lib/plusnone_body.bas` | shared pieces of the library programs |
| `assets/**` | the asset tools' `DIM ... => {}` files (sprites, masks, a tile picture, a map, Plus sprites, Arkos songs), `$XX` translated to `&XX` |

## Programs

| Program | Covers |
|---|---|
| `arithint` | 8/16/32-bit wrap, `\` and MOD by negatives, shifts, bitwise, comparisons (-1 is true) |
| `arrays` | 1D to 3D, LBOUND/UBOUND (no dimension means dimension 1), string arrays, element copy |
| `controlflow` | GOTO, GOSUB, ON GOTO/GOSUB (1-based), DO/LOOP, WHILE/WEND |
| `dataread` | DATA, READ, RESTORE with and without a label |
| `fixedpoint` | FIXED arithmetic and its number text |
| `floats` | REAL arithmetic, functions and the 9-digit number text |
| `heap` | heap bytes after string allocation, concatenation and churn |
| `strings` | concatenation, MID$/LEFT$/RIGHT$, ASC/CHR$, STR$, comparisons, string arrays, long strings |
| `subsfuncs` | BYVAL/BYREF, recursion, a local array |
| `swap32` | 32-bit division and MOD with interrupts running |
| `lowram` | the restart area &0000-&003F survives floats, printing and a wait |
| `bareframes` | bare metal only: the frame counter and the frame hook |
| `cb_display` | screen addressing with and without a scroll offset, double buffering, `WaitRetrace` |
| `cb_fill` | `PenByte` against the firmware, `FillRect` clipping and wrapped rows, `ClearScreen` |
| `cb_sprites` | `PutSprite`, `PutSpriteMasked`, `GetBlock`: clipping, wrap, the fast widths, in modes 0-2 |
| `cb_tiles`, `cb_tilewidth`, `cb_tilerestore` | tiles and tile maps in modes 0-2, tile widths, `TileRestore` and `TileMapPart` |
| `cb_tilesdbuf`, `cb_fastdbuf` | tiles and the fast sprite paths on the back screen (&4000) |
| `cb_assets` | the asset tools' sprite, mask, tile and map data drawn by the library |
| `cb_bare_display` | bare metal only: the display library with the state dump compared |
| `cb_palette` | `SetPalette`, `SetInk`, `SetBorder` against the firmware's ink tables (firmware only) |
| `banks`, `banks464` | the extra-RAM banks (6128) and the 464's refusals |
| `music` | the Arkos player and the sound effects |
| `plus_none`, `plus_none_hi`, `plus_none_state` | the cpcplus library on a machine without an ASIC (464, 664, 6128) |
| `plus_*` | the cpcplus library on a 6128 Plus: sprites, palette, scroll, DMA, raster interrupts, the sprite manager, `plus_big` (a 20 and a 32 KB program) |
| `text` | text output and its pixels in modes 0-2, the cursor (wrap, scroll, `PRINT AT`, `TAB`, the comma zone), read straight from screen memory |
| `textio` | `INKEY$` idle, `PAUSE`, `BEEP` timing and period, `BORDER`, text width per mode |
| `screen` | `COPYCHR$(#0)` on the 6128 and Plus (firmware only) |
| `udg`, `udg_blocks` | `SYMBOL` (user-defined characters) and the CPC's block graphics CHR$ 128-143 (firmware only) |
| `font` | `SYMBOL AFTER 32` and a redefined font for characters 32-127 |
| `graphics`, `graphics_xor` | `PLOT`, `DRAW`, `DRAWR`, `CIRCLE`, `GRAPHICS PEN`, `POINT` in the three modes; the XOR ink mode (firmware only) |
| `input`, `keyboard` | `LINE INPUT` and `INPUT` with typed keys; the buffered `INKEY$` (firmware only) |
| `inkey`, `inkey_locks`, `keytables` | `INKEY$` with typed keys, the key translation seam `__CPC_KEYCHAR` with its tables, caps lock and shift lock |
| `keys_cpc`, `cb_keys` | `INKEY(n)` and the `KEY_` constants; the direct matrix scan of `cpcbuild/keyboard.bas` |
| `sound`, `play` | the firmware sound manager through `SOUND`, `ENV`, `SQ`, `RELEASE` and `BEEP`; the AY primitive `AyWrite`/`AyRead` |
| `bare_sound`, `bare_beep`, `barestate`, `romoff`, `isr` | bare-metal `BEEP`, `PAUSE`, `FRAME` and the frame counter; the machine state a bare boot leaves; both ROMs off at the start; the interrupt front-end |
| `banks_hook`, `banks_music`, `banks_disc`, `music_hook`, `framehook`, `framehook_game` | bank paging under a frame hook, a song played from a bank, `BankLoad` from a disc, the Arkos player under the frame hook, the frame hook in normal mode and in game mode |

## Changed expectations (summary)

Each is explained by a `REM` at the check. `STR$`/`PRINT` number text has a leading space
(`N$`/`T$` drop it, except where the space is the thing checked); a true comparison is -1; `/` on
integers is an integer division, `\` truncates toward zero and MOD takes the sign of the dividend
on every path; mixed signed/unsigned 16-bit operands are compared as LONGs; ON GOTO/GOSUB count from 1;
REAL text is Locomotive's (9 digits); UBOUND/LBOUND without a dimension mean dimension 1; slicing is
MID$ (1-based) and CODE is ASC.

L4-CONF programs also (each has its own REM): PRINT AT stays (0-based, row first) and `POS`/`VPOS` count from 1; `PRINT` of a
string that does not fit in the columns left starts a new line (so a wrap at the last column is two PRINTs); the scroll after a
line feed on the last row is still pending (Locomotive and the firmware); the Spectrum's `INK`/`PAPER` in `PRINT`, `PLOT INK`
and `OVER` are `PEN`, `PAPER`, `PLOT x, y, pen` and the ink mode (firmware only, `graphics_xor.bas`); `PLOT`/`DRAW` take
Locomotive's 640 x 400 units (the mode 1 pixel (x, y) is unit (2x, 2y)); `SCREEN$` is `COPYCHR$` (firmware only, 6128 and Plus); `INPUT(n)` is
`LINE INPUT` (no limit); `INKEY$` held-now is `INKEY(n)`; `SoundQueue`/`SoundFree` are `SOUND` and `SQ`; the CPC block graphics
CHR$ 129 is the top left quadrant (not the Spectrum's top right).

Library programs (cb_*, banks*, music, plus_*) also: a true comparison given to `STR$`/`N$` is
wrapped in `-( )` so the expected value stays 1; `DIM a(0 TO n)` is `DIM a(n)`; names that are now
keywords are renamed (`PEN` to `penNo`, `MODE` to `md`, `REAL` to `isReal`, `Pos` to `PosOf`,
`AFTER` to `afterSum`, `Run`/`Wait` to `RunFrames`/`WaitFrames`); `POINT`, `PLOT` and `SCREEN$` are
`Pt`, `PlotPx` and `ReadChr` (lib/pixel.bas, cb_palette.bas); `UBYTE * 256` is INTEGER arithmetic
(the literal does not fit a UBYTE), so byte pairs are summed as UINTEGER. A check that never ran in
cpcbuild (results lost to the heap, see lib/chkbuf.bas) and was wrong is corrected with a `REM`:
cb_fill `fill_mode2_clipped` (100, not 90) and `clip_four_corners_where`. plus_fast's `tbl` was 32
bytes and written to 64 (it ran into the loop counter here); plus_dma waits 10 frames, not 2 (follow-up 53: measured, cause not found; see the REM at `start_macro_list`).

## Left out of the port (L4-CONF)

cpcbuild's `tests/conformance/` has 26 programs that L3 did not port. 24 are here (the table above; `udg`, `framehook` and
`graphics` each also gave a second program, and `bare_beep` is new). Two are not, each tests only Spectrum behaviour:

- **`floatfmt`** is the Spectrum 48K ROM's number text (up to 8 digits, no leading space, `.03`, `1E+8`), "the output of the
  Spectrum ROM for the same values". Locomotive's REAL text is nine digits with a leading space and `E+08`, and its tests
  are `tests/loco/real-*.bas` (blessed on the interpreter) and `floats.bas` here.
- **`keys_port`** is a program written for zx48k's `keys.bas` (`MultiKeys`, `GetKeyScanCode`, `KEYQ` ...: a key is a row and a
  bit mask on the Spectrum's port). The CPC dialect's key API is `INKEY(n)` and the `KEY_` constants, which `keys_cpc.bas`
  tests (it was cpcbuild's CPC mapping of the same zx48k API, with the same typed keys).

Parts of ported programs that are not here: `play`'s MML (`Play "O4C"`, the divider table, repeats, channels: the Play
library is a Spectrum/Next feature that Locomotive does not have, see the header of `play.bas`); `udg`'s three `USR "a"`
address checks (the Spectrum's UDG table); `text`'s `__ERR_SCR` check (the runtime's error text is in `tests/loco/err-*`);
`graphics`'s `DRAW x, y, angle` arcs and `CIRCLE OVER` (Spectrum only; the XOR circle is in `graphics_xor.bas`);
`screen`'s two out-of-range cells (`LOCATE` wraps) and its misread-cell case; `sound`'s "period clamped to 4095" (Locomotive
raises error 5).

## Programs that need an emulator that can type or a disc

`input`, `keyboard`, `inkey`, `keys_cpc` and `cb_keys` have `REM TYPE:` lines: chipsrun and Caprice32 type them, CPCEC cannot (follow-up 69), so the
Plus rows of the run table for these five come from Caprice32 (`--emu cap32 --model plus`). `banks_disc` needs a disc and
is Caprice32 only.

## XFAIL, and why

One program is marked `REM XFAIL`, with a follow-up:

- `framehook_game`: in game mode ten MC WAIT FLYBACK calls take 3 frames, and a `WaitRetrace(3)` loop never ends: follow-up 132.

Earlier, none were marked. The groups that were, are closed:

- `banks_disc` (L4-CONF, follow-up 131): its two disc files carried hand-made AMSDOS headers with the fields three bytes
  early, so `BankLoad` read the load address as the file's length and refused the 3000-byte file. The headers were
  rebuilt (R15); `assets/bankdat.bin` and `assets/music/bank_tune.bin` are cpcbuild's files with a 128-byte header in front,
  because the cpcbas CLI's `--dsk-add` writes a file as it is (follow-up 133).

- The E400 layout refusals (`cb_sprites`, `cb_tiles`, `cb_tilewidth`, `cb_tilerestore`, `music`, `plus_big`,
  `plus_big_hi`, `plus_raster`, `plus_rastermove`, and `plus_sprman`, `plus_speed` in bare mode) came from
  `CbReserve4000` always being linked; the compiler now emits only the procedures a program reaches (L3-FIX).
- `lowram` came from the FP calculator zeroing `&0000-&0004` (follow-up 43, fixed in `lib/runtime/fp_calc.asm`).

