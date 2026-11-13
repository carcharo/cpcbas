# lib/loco

The Locomotive text layer of the runtime: PRINT of strings and numbers with Locomotive's
number text, zones, SPC and TAB; MODE, PEN, PAPER, BORDER, LOCATE, CLS, POS, VPOS; INKEY$.
MIT, written for this project (see `../LICENSE`). Every routine's header gives its entry
registers, exit registers, what it clobbers and the firmware entries it calls. Included as
`<loco/name.asm>`; the labels (all `.core.__LOCO_*`) are listed in
`packages/cpcbas/src/runtime/loco-labels.ts`.

| File | Entries |
| --- | --- |
| `txtout.asm` | `__LOCO_PUTC` (A = byte to TXT OUTPUT plus the printer echo; another device through the table of `window.asm`), `__LOCO_NL`, `__LOCO_ECHO`; bare builds link the glyph renderer and its font (`txtglyph.asm`) with this file and no other (L5-HOT, follow-up 186) |
| `txt.asm` | `__LOCO_ZONE_SET`, `__LOCO_ZONE`, `__LOCO_ZONEN` (ZONE n, error 5 unless 1-255), `__LOCO_CURSOR` (the position of the next character in the stream's window), `__LOCO_COLW` (the same for the device: column and line width) |
| `print.asm` | `__LOCO_FIT`, `__LOCO_PUTS`, `__LOCO_PRINTSTR` (HL string, A free flag), `__LOCO_COMMA`, `__LOCO_SPC`, `__LOCO_TAB` |
| `number.asm` | `__LOCO_FMT{I16,U16,I32,U32}`, `__LOCO_PRINT{I16,U16,I32,U32}`, `__LOCO_STR{I16,U16,I32,U32}` |
| `screen.asm` | `__LOCO_MODE`, `__LOCO_PEN`, `__LOCO_PAPER`, `__LOCO_BORDER`, `__LOCO_LOCATE`, `__LOCO_CLS`, `__LOCO_POS`, `__LOCO_VPOS` |
| `inkey.asm` | `__LOCO_INKEY` (the runtime's INKEY) |
| `gosubchk.asm` | `__LOCO_GOSUBCHK` (error 3 for a RETURN alone in a procedure when no GOSUB is pending) |
| `arg255.asm` | `__LOCO_ARG255` (error 5 for an ON selector or LOCATE argument above 255) |
| `str.asm` | `__LOCO_LEN`, `__LOCO_ASC` (error 5 for the empty string), `__LOCO_UPPER`, `__LOCO_LOWER`, `__LOCO_CHR`, `__LOCO_SPACE`, `__LOCO_STRING`, `__LOCO_LEFT`, `__LOCO_RIGHT`, `__LOCO_MID`, `__LOCO_MID2`, `__LOCO_INSTR`, `__LOCO_INSTR3`, `__LOCO_STRDESC` (the 3-byte CALL descriptor of a string: HL = string, stack: the buffer address) |
| `strval.asm` | `__LOCO_VAL` (VAL: skips blanks and a `+`, "0" for no text; firmware builds make the REAL as Locomotive's tokeniser does: the digits as an integer, then the firmware's x 10^E) |
| `real.asm` | `__LOCO_FMTF` (REAL -> text), `__LOCO_PRINTF`, `__LOCO_STRF`, `__LOCO_FMTDIG` (the 9 digits, exponent and sign of a non-zero REAL, for DEC$) (firmware builds take the 9 digits from the firmware's PREP, bare builds generate them on integers; no calculator linked either way) |
| `realfn.asm` | `__LOCO_DEG`, `__LOCO_RAD`, `__LOCO_SIN`, `__LOCO_COS`, `__LOCO_TAN`, `__LOCO_ATN`, `__LOCO_SQR`, `__LOCO_EXP`, `__LOCO_LOG`, `__LOCO_LOG10`, `__LOCO_INT`, `__LOCO_FIX`, `__LOCO_CINT`, `__LOCO_INTF16`, `__LOCO_FIXF16`, `__LOCO_FTOF16`, `__LOCO_FTOI`, `__LOCO_ABSF`, `__LOCO_POW`, `__LOCO_MINF`, `__LOCO_MAXF`, `__LOCO_RND`, `__LOCO_RNDLAST`, `__LOCO_RNDARG`, `__LOCO_RANDOMIZE`, `__LOCO_RANDTIME`, `__LOCO_ROUND` (n in HL, x on the stack), `__LOCO_FNORM` |
| `readf.asm` | `__LOCO_READF` (READ into a REAL variable: any numeric item, as a REAL) |
| `read.asm` | `__LOCO_READ` (A = variable type tag; result in the type's register; error 4 past the last item, error 2 for a string into a number), `__LOCO_RESTORE` (HL = table address) |
| `strfmt.asm` | `__LOCO_HEX`, `__LOCO_BIN` (stack: n, w), `__LOCO_MIDSET`, `__LOCO_MIDSET2` (the MID$ statement: HL = a$, stack: p, [n,] the pointer of b$; the `F` forms free b$), `__LOCO_DEC` (DEC$: HL = format, A = free flag, stack: the REAL) |
| `array.asm` | `__LOCO_ALOCAL` (a local array's elements on the heap, zeroed, and its descriptor filled; error 7 when the heap is full) |
| `fmath.asm` | `__LOCO_FADD`, `__LOCO_FSUB`, `__LOCO_FMUL`, `__LOCO_FDIV` (a stacked, b in the registers; the firmware in firmware builds, the calculator in bare ones), `__LOCO_FNEG` (flips the sign bit, also of zero, like the firmware's NEG) |
| `fmathcalc.asm` | the bridge to the imported calculator: `__LOCO_FOUT`, `__LOCO_FPUSH`, `__LOCO_FPOP` (see "The REAL layout" below); it includes `fmathrev.asm` |
| `fwmath.asm` | the firmware maths gate (empty in bare builds): `__FWM_CALL`, `__FWM_CALLA`, `__FWM_TBLHL`, `__FWM_ANGLE`, `__FWM_PUTA`, `__FWM_PUTB`, `__FWM_GETA`, the three entry tables, the operand slots (lib/README.md), and the firmware bodies of `+ - * /` |
| `fmathcmp.asm` | `__LOCO_FEQ`, `__LOCO_FNE`, `__LOCO_FLT`, `__LOCO_FLE`, `__LOCO_FGT`, `__LOCO_FGE` (a stacked, b in the registers -> A = 1 or 0; firmware builds compare the five bytes, bare builds use the calculator) |
| `fmathcv.asm` | `__LOCO_FU8`, `__LOCO_FI8`, `__LOCO_FU32`, `__LOCO_FI32`, `__LOCO_FF16` (integer or FIXED to REAL), `__LOCO_FTOU32`, `__LOCO_FTOF16REG` (REAL to DEHL) |
| `fmathrev.asm` | `__LOCO_FREV` (Locomotive <-> calculator byte order), `__LOCO_FNZ` (a zero-exponent value as the exact zero); no calculator, so the conversions of `fmathcv.asm` link without it (R12, follow-up 64) |
| `misc.asm` | `__LOCO_FRAME`, `__LOCO_FRE`, `__LOCO_HIMEM`, `__LOCO_RANDOM` (HL = n -> HL = 0..n-1; seeded from the clock at its first call) (L4-SMALL) |
| `brk.asm` | `__LOCO_STOP`, `__LOCO_STOPAT` (HL = line, 65535 = none): the Break message of STOP and of `ON BREAK STOP` (L4-FIX) |
| `randseed.asm` | `__LOCO_RANDSEEDT` (DE HL -> RANDOM's state; RANDOMIZE, RND(-n) and the first RANDOM call use it) (L4-FIX) |
| `event.asm` | `__EVENT_POLL` (the statement-boundary poll: runs the due EVERY/AFTER handlers), `__LOCO_EVERY`, `__LOCO_AFTER` (HL = handler; stack: n, t), `__LOCO_REMAIN` (HL = t), `__LOCO_DI`, `__LOCO_EI`, `__LOCO_TIME` (DEHL, 1/300 s) (firmware: the ticker, KL TIME PLEASE; bare: the frame counter) |
| `beep.asm` | `__LOCO_BEEP` (run-time `BEEP duration, pitch`: duration a pushed REAL, pitch in A E D C B; firmware and bare builds; a constant BEEP is folded by the compiler and calls `__BEEPER`) |
| `sound.asm` | `__LOCO_SOUND`, `__LOCO_ENV`, `__LOCO_ENT`, `__LOCO_RELEASE`, `__LOCO_SQ` (firmware builds only; the file is empty in a bare build, where the checker refuses the statements: E270) |
| `gfx.asm` | L4-GFX, Locomotive's graphics: `__LOCO_GMOVE`, `__LOCO_GMOVER`, `__LOCO_GPLOT`, `__LOCO_GPLOTR`, `__LOCO_GDRAW`, `__LOCO_GDRAWR` (stack: x, y), `__LOCO_GTEST`, `__LOCO_GTESTR` (stack: x, y; HL = the pen), `__LOCO_GXPOS`, `__LOCO_GYPOS`, `__LOCO_GCLG`, `__LOCO_GCLGP`, `__LOCO_GPEN`, `__LOCO_GPENP`, `__LOCO_GPAPER`, `__LOCO_GMODE` (HL = the value), `__LOCO_GORIGIN`, `__LOCO_GORIGINW` (stack: x, y[, l, r, t, b]), `__LOCO_GMASK`, `__LOCO_GFIRST`, `__LOCO_GBACK` (the last four: firmware builds only). Firmware builds call the GRA entries; bare builds draw with gfxbare.asm's rasteriser in their own graphics state (`vars.asm`) |
| `gfxpx.asm` | `__LOCO_GCIRCLE` (stack: x, y, r), `__LOCO_GPOINT` (stack: x, y; HL = the pen): CIRCLE and POINT in the mode's own pixels, as the fork's |
| `gfxfill.asm` | `__LOCO_GFILL` (HL = the pen; GRA FILL with a 512-byte buffer; firmware builds only) |
| `inkset.asm` | `__LOCO_INK` (stack: pen, c1, c2), `__LOCO_INK1` (stack: pen, c), `__LOCO_SPEEDINK` (stack: a, b; firmware builds only) |
| `window.asm` | `__LOCO_STREAM` (A = stream 0-9: TXT STR SELECT for 0-7, `LOCO_DEV` 8 or 9 for the printer and the file), `__LOCO_STREAM0`, `__LOCO_WINDOW` (stack: l, r, t; HL = b), `__LOCO_WINSWAP` (stack: a; HL = b), `__LOCO_TAG`, `__LOCO_TAGOFF`, `__LOCO_POSS`, `__LOCO_VPOSS` (A = stream), `__LOCO_WIDTH`, the device table (`__LOCO_PUTDEV`, `__LOCO_COLDEV`, `__LOCO_NLDEV`: the printer's column, width and line wrap); bare builds have the stream 0 entries only |
| `using.asm` | `__LOCO_USING` (HL = format, A = free flag), `__LOCO_USINGN` (A E D C B = the REAL), `__LOCO_USINGS` (HL = string, A = free flag), `__LOCO_USINGE`: PRINT USING, numeric fields by DEC$'s code |
| `symbol.asm` | `__LOCO_SYMBOL` (stack: c, r1..r7; HL = r8), `__LOCO_SYMAFTER` (HL = n 0-256): the firmware's user matrix table taken from the heap, or the bare glyph table |
| `copychr.asm` | `__LOCO_COPYCHR` (A = stream 0-7 -> HL = a one-byte string, or 0 for none) |
| `error.asm` | `__LOCO_MARK`, `__LOCO_ONERR`, `__LOCO_ONERR0`, `__LOCO_TRAP`, `__LOCO_RESUME`, `__LOCO_RESUMENEXT`, `__LOCO_RESUMETO`, `__LOCO_ERROR`, `__LOCO_ERR`, `__LOCO_ERL`, `__LOCO_RETCHK` (error 3 for a RETURN with no GOSUB pending), `__LOCO_SOFTERR` (Overflow and Division by zero that carry on, firmware builds; docs/ir.md "Errors") |
| `keys.asm` | `__LOCO_INKEYN`, `__LOCO_JOY`, `__LOCO_CLEARIN`, `__LOCO_KEY`, `__LOCO_KEYDEF`, `__LOCO_SPEEDKEY` (the last three firmware only), `__LOCO_ONBREAK`, `__LOCO_CHKBRK` (the statement-boundary ESC check of `ON BREAK STOP`), `__LOCO_GETKEY` (INPUT's key reader) |
| `input.asm` | `__LOCO_INPUT` (a whole INPUT or LINE INPUT: prompt, editor, split, convert, redo), `__LOCO_INGETW`, `__LOCO_INGETF` (fetch an item); the control block is in the file header |
| `filecom.asm` | `__LOCO_DERR` (DERR), `__FL_NAMEPUSH` (a file name copied onto the stack in capitals, for AMSDOS), `__FL_FAIL` (the failed firmware call: DERR and error 32) |
| `file.asm` | the input side of files, firmware only: `__LOCO_OPENIN`, `__LOCO_CLOSEIN`, `__LOCO_EOF`, `__LOCO_FINITEM` (one item of INPUT #9: a heap string, converted by the caller), `__LOCO_FLINE` (LINE INPUT #9), `__LOCO_LOAD`, `__LOCO_LOADH`, `__LOCO_CAT`, `__LOCO_CHAIN` (MC BOOT PROGRAM with a loader above the private block); the 2 KB AMSDOS buffer under the private block |
| `fileout.asm` | the output side, firmware only: `__LOCO_OPENOUT`, `__LOCO_CLOSEOUT`, `__LOCO_SAVE` (CAS OUT DIRECT), the device table of `#9` (`__LOCO_FPUT`, `__LOCO_FCOLW`, `__LOCO_FNL`); its own 2 KB buffer |
| `write.asm` | `__LOCO_WRITES`, `__LOCO_WRITEN`, `__LOCO_WRITEC` (WRITE on any stream) |
| `inputreal.asm` | `__LOCO_INREAL` (three jump entries: decimal text to REAL, REAL to INTEGER with rounding and overflow, INTEGER to REAL), linked only by an INPUT that has a number item |
| `vars.asm` | no code: the EQUs of L4's private-block slots, offsets &220-&2FF (`LOCO_ERRTRAP`, `LOCO_ERRPOS`, `LOCO_DEV`, and each L4 task's own; docs/ir.md "Private-block slots") |

How the code generator calls them (registers follow the IR type table):

- A PRINT statement is a sequence of item calls; the line end is `__LOCO_NL`, sent unless the
  statement ends in `;` or `,` (a trailing `,` is `__LOCO_COMMA`). `__LOCO_PRINTSTR` takes
  the string in HL and the free flag (non-zero for a temporary) in A, as `__PRINTSTR`.
- Numbers: INTEGER and UINTEGER in HL, LONG and ULONG in DEHL. A BYTE is widened to INTEGER
  (sign extension) and a UBYTE to UINTEGER (H = 0) by the lowering. A REAL is A E D C B = bytes 0..4 of
  Locomotive's layout (`__LOCO_PRINTF`, `__LOCO_STRF`); a FIXED prints as the REAL of the same value (the lowering
  converts it). `STR$` returns an owned heap string without the trailing space, 0 when the heap
  is full.
- String functions (`str.asm`, `strval.asm`): one string argument comes in HL with a free flag in A
  (non-zero for a temporary, which the routine frees); several arguments are pushed left to right
  and removed by the routine, a string among them always a temporary it consumes. Counts and
  positions are INTEGERs, 1-based; a negative count, a MID$/INSTR position of 0, a CHR$ code
  outside 0..255 and ASC (or STRING$) of the empty string raise error 5. Every result is a new heap string (0 when empty). The header of
  each file has the exact registers.
- REAL text (`real.asm`): the value is rounded to 9 significant digits and trailing zeros dropped;
  fixed notation below 1E+9 (and, below 1, while the zeros after the point plus the digits are at
  most 9: `0.000123456`, but `1.23457E-04` for `0.0001234567`), otherwise `d.ddddd E+xx` with at
  most 6 digits (a longer digit string is rounded to 6 and keeps its zeros, `1.00000E+10`).
  Measured on the interpreter; `-0.0001` prints `-0.0001 `, `1E9` prints ` 1E+09 `.
- Maths (`realfn.asm`): arguments and results in A E D C B, one value per call (`fparam`, `rtcall`),
  except MIN and MAX of reals (two `param` quads, the second on top), `^` (the imported CALLEE
  convention: the first value pushed, the second in the registers) and the FIXED INT and FIX
  (DEHL). DEG and RAD set a flag the trigonometric routines read (RAD at start-up).
- `__LOCO_LOCATE` takes H = column, L = row (1-based) and returns Carry set, moving nothing,
  when either is 0: the lowering raises Improper argument (error 5), also for a value above
  255 (`__LOCO_ARG255`). A row below the window's height is its last row and from 129 on its
  first; a column goes to the firmware as it is, which wraps it (W+1..W+128 to column 1 of the
  next row, W+129..255 to the last column of the previous one; measured). `__LOCO_BORDER`
  takes B and C, `BORDER c` passing the same colour in both.
- Wrap rule: an item (string, or number with its sign position and trailing space) that does
  not fit on the rest of the line moves whole to the next line, unless the cursor is at
  column 1. `,` sends spaces to the next zone start (zones `ZONE` wide, default 13) or CR LF
  when that zone would not fit whole. Measured on the real interpreter in mode 1; modes 0 and 2
  use the same rules with their line widths (20 and 80); a window, or the printer, uses its own
  width (`__LOCO_COLW`). `SPC(n)` sends n MOD the width spaces (measured: `SPC(40)` in mode 1 sends none).

Printer echo (`-D __CPC_PRINTER_ECHO__`, the test harness): every byte sent to the text screen
by `__LOCO_PUTC` also goes to the printer (MC PRINT CHAR through the gate; in bare mode the
Centronics port), with the filter the interpreted side applies: 13 becomes a line end (10),
10 and the other codes below 32 are dropped, the rest is sent as it is. The stock `print.asm`
echo (`__PRN_ECHO`) uses the same printer call and the same retry; `lib/loco` has its own copy
so the layer does not pull the Spectrum print routines in.

Bare mode: `txt.asm`, `print.asm`, `number.asm`, `inkey.asm` and `screen.asm` assemble with
`CPC_BAREMETAL` (output through the bare text renderer, the echo through the printer port;
`screen.asm`'s section for the bare renderer is described in its header: pens, MODE, BORDER).

## The REAL layout (FWM-LAYOUT)

A REAL is Locomotive's five bytes in memory, in DATA, as an immediate and on the stack: the
mantissa least significant byte first (bit 7 of byte 3 is the sign), then the exponent biased by
128; exponent byte 0 is zero. In the registers A E D C B hold bytes 0..4 in that order, so a REAL
loads with `ld a,(x) / ld de,(x+1) / ld bc,(x+3)` and `push bc / push de / push af` leaves it in
memory order (docs/ir.md has the contract). Every routine in this directory takes and gives that
form, always the full one. In firmware builds the arithmetic and the functions are the firmware's (`fwmath.asm`, and the
firmware bodies in `realfn.asm`); an exponent byte of 0 is zero whatever the other bytes hold (the firmware leaves junk there), so
nothing here tests more than the exponent byte. `fmathcalc.asm` is where the layout meets the imported
floating-point calculator, which bare builds use for everything and firmware builds not at all (the comparisons and INT and FIX of
firmware builds are routines on the five bytes, L5-HOT); it keeps the Spectrum's reversed byte order and may return the small-integer form:
`__LOCO_FREV` reverses the five registers (A with B, C with E), `__LOCO_FOUT` also normalises a
small integer, and the binary operations push b and then the stacked a on the calculator stack and
return through `__LOCO_FOUT2` / `__LOCO_FCMPOUT`, with the caller's return address parked in
`__LOCO_FRET` (not re-entrant: the maths never runs from an interrupt). A zero with a junk mantissa is pushed as the exact zero
(`__LOCO_FNZ`).

## Firmware maths and the bare differences (FWM-CORE)

Firmware builds give Locomotive's results bit for bit for `+ - * /`, `^`, the functions, RND (RANDOMIZE writes the firmware's seed
bytes: `07 6C 65 89` xor the first four bytes of n), VAL, ROUND and the number text (`tests/loco`, `real-exact` in
`compare.json`). Bare builds keep the calculator and agree to 8 significant digits; their differences: RND is the imported
xorshift generator (another sequence after the same RANDOMIZE), the number text can differ in the 9th digit near a rounding tie,
VAL and the constants follow the calculator, and ROUND(1.7E38,-38) stops with error 5 where the interpreter saturates. Bare SQR is
Newton's method on the calculator (about a fifth of the time of the imported route through LN and EXP).
