# The keyword table

`packages/cpcbas/src/lang/keywords.ts` exports `KEYWORDS`, one `KeywordEntry` per
(name, kind). The lexer, parser, checker and (later) the language server and the
machine-readable language description all read it. Look entries up with `lookupKeyword(name)`
or `keywordOf(name, kind)`; `RESERVED_WORDS` and `SOFT_WORDS` are derived sets.

## Status is the language's, not the compiler's

The `status` of an entry says what the keyword is in the language (`compiled`: works in
firmware and bare-metal mode; `firmware`: firmware mode only; and so on). It does not say
whether the compiler has reached it yet. Until a keyword is implemented the compiler reports
E002, "X is not implemented yet", at its first word. The gate is in
`packages/cpcbas/src/checker/subset.ts`; the sets in it, not the `status` field, say what
compiles today.

### What compiles today

Statements and constructs: `LET`, `DIM`, `CONST`, `DEFINT` and the other `DEF` type
statements, `OPTION`, `IF`, `FOR`, `WHILE`, `DO ... LOOP`, `SELECT CASE`, `EXIT`, `CONTINUE`,
`GOTO`, `GOSUB`, `RETURN`, `ON ... GOTO`, `ON ... GOSUB`, `END`, `CALL`, `PRINT`, `DATA`,
`READ`, `RESTORE`, `SUB`, `FUNCTION`, `DECLARE`, `DEF FN`, `ASM`, `#pragma`, `#require`,
`#init`, the `MID$` statement, and the built-in statements `LOCATE`, `MODE`, `PEN`, `PAPER`,
`BORDER`, `CLS`, `POKE`, `MEMORY`, `DEG`, `RAD` and `RANDOMIZE`; L4-KEYS adds `INPUT`, `LINE INPUT`
(keyboard, stream `#0`), `ON BREAK STOP` and `CONT`, `CLEAR INPUT`, `KEY`, `KEY DEF` and `SPEED KEY`; the other
statements L4 adds are in the sections below.

Built-in functions (and `TAB` and `SPC` inside `PRINT`): `PEEK`, `LBOUND`, `UBOUND`,
`INKEY$`, `INKEY(n)`, `JOY(n)`, `POS`, `VPOS`, `LEN`, `LEFT$`, `RIGHT$`, `MID$`, `CHR$`, `ASC`, `STR$`, `VAL`,
`SPACE$`, `STRING$`, `UPPER$`, `LOWER$`, `INSTR`, `ABS`, `SGN`, `MIN`, `MAX`, `CINT`, `UNT`,
`CAST`, `SIZEOF`, `INT`, `FIX`, `CREAL`, `SQR`, `SIN`, `COS`, `TAN`, `ATN`, `EXP`, `LOG`,
`LOG10`, `PI`, `RND`, `ROUND`, `HEX$`, `BIN$` and `DEC$`, and the functions of the L4 sections below.

L4 wave 1 added the timers, graphics and colour, windows, streams and the printer, sound, the keyboard, error handling
and the machine statements: each has its section below. L4-FILES adds the files (`OPENIN`, `CLOSEIN`, `OPENOUT`, `CLOSEOUT`,
`INPUT #9`, `LINE INPUT #9`, `PRINT #9`, `WRITE`, `EOF`, `DERR`, `LOAD`, `SAVE`, `CAT`, `CHAIN "name"`) and `INPUT` and `LINE INPUT`
on the text streams `#1`-`#7`. Still E002: the second argument of `PEN`, `SPEED WRITE` and the `|` (RSX) calls. A word with status `later` or `dropped` gives its own error and hint (for example
E981, "is not in 1.0").

### Keywords added in L3

| Keyword | Table status | What it does in the compiler |
|---|---|---|
| `DIM a(n, ...) [AS type] [=> { ... }] [AT address]` | `compiled` | Arrays of one or more dimensions, indexes from 0 (`DIM a(1 TO 5)` is E970), global or local. `=> { ... }` lists the elements, nested one level per dimension (E246 when a nested list does not match); a flat numeric list may be shorter than the array and is padded with zeros. `AT` is for a global array and cannot have an initialiser (E247). A constant index outside the bounds is E248. There is no run-time bounds check |
| `#pragma hidata = address` | (a `#pragma` name) | The elements of the initialised global arrays declared after it are placed at `address`, one after the other; `#pragma hidata = 0` ends it. An array that would end past &FFFF is E249 |
| `LBOUND(a [, d])`, `UBOUND(a [, d])` | `compiled` | Without `d`, dimension 1; `d` = 0 gives the number of dimensions. A constant for a `DIM`med array, a run-time lookup for an array parameter |
| `HEX$(n [, width])`, `BIN$(n [, width])` | `compiled` | Upper-case digits, at least one, `width` (0 to 16) is a minimum. A negative number prints as 16-bit two's complement. A width above 16 or below 0 is error 5 |
| `DEC$(n, format$)` | `compiled` | The `PRINT USING` numeric format. The text is as wide as the format; a number that does not fit is `%` followed by the number |
| `MID$(a$, p [, n]) = b$` | `compiled` | Replaces characters of `a$` in place; the length of `a$` never changes. Also works on an array element. A start past the end of `a$` is not an error (as on the 6128) |
| `SELECT CASE` on a STRING | `compiled` | `CASE "a", "b"` compares strings |
| `PRINT AT row, col; items` | `alias` of `LOCATE` | 0-based, row first: `LOCATE col + 1, row + 1`, then the items. Past the screen it follows `LOCATE` |
| `@` forms | (not a table entry) | `@` of a local, a parameter, a SUB or FUNCTION, a line label, a string variable (its own two-byte slot), an array (first element) and an array element |
| `CALL address, args` | `compiled` | An argument may be a string expression: the routine gets the address of a three-byte descriptor, freed after the call. The address is worked out after the arguments |
| `RND [(x)]` | `compiled` | `RND(0)` repeats the last value, `RND(-n)` reseeds from `\|n\|`, `RND(n)` with n above 0 is the next value. Firmware builds use the firmware's generator, so the sequence is Locomotive's; bare builds have their own |
| `RANDOMIZE [n]` | `compiled` | Reseeds from `n` as Locomotive does (firmware builds: `n` and `-n` give different sequences; bare builds seed from `\|n\|`); with no number from the time, never prompts. All forms also seed `RANDOM(n)` |
| `ROUND(x [, n])` | `compiled` | Rounds half away from zero to `n` places; the result is always REAL |
| `^` | (not a table entry) | Always REAL, folded to a REAL constant when both sides are constants |

### Keywords added in L4: sound (L4-SOUND)

| Keyword | Table status | What it does in the compiler |
|---|---|---|
| `SOUND ch, period [, dur [, vol [, env [, ent [, noise]]]]]` | `firmware` | Queues a note with the firmware's sound manager (waits while the queue is full, as BASIC does). Ranges as Locomotive: channel 0 to 255 (bits 1-4: channels, 8-32: rendezvous with A, B, C, 64: hold, 128: flush), period 0 to 4095, duration -32768 to 32767 (negative: repeat count of the envelope, 0: its length; default 20), volume 0 to 15 (default 12), envelopes 0 to 15, noise 0 to 31; anything else is error 5 at run time. A REAL argument is rounded. An empty argument takes its default, which Locomotive refuses (`SOUND 1, 200, , 15` is a syntax error there). A constant that does not fit 16 bits is E274 |
| `ENV n, steps, size, pause, ...` and `ENV n, ..., =register, period` | `firmware` | A volume envelope, n 1 to 15, up to 5 sections (steps 0 to 127, size -128 to 127, pause 0 to 255; a hardware section is `=register` 0 to 15 and a 16-bit period). The shape is checked at compile time (E273) |
| `ENT n, steps, size, pause, ...` and `ENT n, ..., =period, pause` | `firmware` | A tone envelope, n -15 to -1 (repeat) or 1 to 15, up to 5 sections (steps 0 to 239; a hardware section is `=period` 0 to 4095 and a pause) |
| `RELEASE channels` | `firmware` | Releases held channels; 0 to 7, else error 5 |
| `SQ(channel)` | `firmware` | The status byte of the channel 1, 2 or 4 (other values are error 5): bits 0-2 free queue entries, 3-5 rendezvous, 6 held, 7 playing. A UBYTE |
| `BEEP duration, pitch` | `alias` | The Sinclair BEEP, in firmware and bare builds (bare: through the AY, blocking). Duration 0 to 10 seconds, pitch -60 to 127 semitones from middle C; a constant outside that is E275. Run-time values are held to the same ranges (a negative duration plays nothing). One note on channel A at full volume, the reference compiler's numbers |

Constant folding in `CONST` and array bounds covers `ABS`, `SGN`, `MIN`, `MAX`, `CINT`, `UNT`,
`LEN`, `ASC`, `CHR$`, `LEFT$`, `RIGHT$`, `MID$`, `SPACE$` and `STRING$` of constants.
`STR$` of a non-integer is not folded (E243 inside a `CONST`).

### Keywords added in L4-EVENTS

| Keyword | Table status | What it does in the compiler |
|---|---|---|
| `EVERY n [, t] GOSUB label`, `AFTER n [, t] GOSUB label` | `compiled` | Four timers 0-3 (timer 3 first); n in 1/50 s, t defaults to 0. A handler runs at the next statement boundary (and at the back edge of a loop with an empty body), never between two parts of one statement; a handler is interrupted by a higher timer only; its RETURN re-enables. `n = 0` stops the timer; n < 0 and t outside 0-3 are error 5. Firmware builds use the firmware's ticker, bare builds count the frame counter in the poll. Only programs that use EVERY or AFTER pay for the poll (3 bytes and about 45 T-states a statement in firmware builds, about 110 in bare builds). Allowed in a SUB or FUNCTION; the handler is a main-program line or label (E214 otherwise). Firmware builds: a timer set in the first 0.6 s after `RUN"` counts nothing until then (follow-up 87) |
| `REMAIN(t)` | `compiled` | What is left of timer t in 1/50 s, 0 when it is not running; stops the timer and drops its pending events. t outside 0-3 is error 5 |
| `DI`, `EI` | `compiled` | Stop and restart the running of EVERY/AFTER handlers (not the Z80's interrupts); timers keep counting and the events that came due are remembered (at most 127 per timer) |
| `TIME` | `compiled` | ULONG, 1/300 s. Firmware builds: KL TIME PLEASE. Bare builds: the frame counter x 6, so the resolution is 1/50 s |

### Keywords added in L4: graphics and colour (L4-GFX)

Coordinates are Locomotive's: 640 x 400 units in every mode, origin at the bottom left, moved by `ORIGIN`; a REAL argument is
rounded half away from zero (as the interpreter does). Arguments that are left out (`PLOT 1, 2, , 1`) keep what is set.

| Keyword | Table status | What it does in the compiler |
|---|---|---|
| `PLOT x, y [, pen [, mode]]`, `MOVE`, `DRAW` | `compiled` | Absolute position, point or line from the cursor. `pen` sets the graphics pen first (a pen above the mode's range is masked, as the firmware does); `mode` is the ink mode: 0 normal, 1 XOR, 2 AND, 3 OR (error 5 otherwise), and it stays until changed. The 4th argument is BASIC 1.1's (the 464's own BASIC refuses it); a compiled program runs it on a 464 too |
| `PLOTR`, `MOVER`, `DRAWR dx, dy [, pen [, mode]]` | `compiled` | The same, relative to the graphics cursor |
| `TEST(x, y)`, `TESTR(dx, dy)` | `compiled` | The pen of the pixel (the graphics paper outside the screen and the window); the cursor moves there |
| `XPOS`, `YPOS` | `compiled` | The cursor, relative to the origin |
| `ORIGIN x, y [, left, right, top, bottom]` | `compiled` | Moves the origin; the cursor goes to it. The window edges are absolute screen coordinates (firmware builds only). `MODE` resets the origin, the window and the cursor |
| `CLG [n]` | `compiled` | Clears the graphics window to the graphics paper (`n` sets it first, 0-15) and sends the graphics cursor to the origin. The text cursor does not move |
| `GRAPHICS PEN [n] [, m]`, `GRAPHICS PAPER n` | `compiled` | Pen and paper 0-15 (error 5 otherwise). `m`: 0 opaque, 1 transparent background of lines and text (firmware builds, CPC664/6128 BASIC) |
| `MASK [n] [, first]` | `firmware` | The line mask (0-255; its first bit is the first pixel of a line) and whether a line's first point is drawn (0 no, 1 yes). A 464 raises error 2 (its BASIC has no `MASK`) |
| `FILL n` | `firmware` | Fills the area round the graphics cursor with pen `n` up to the graphics pen (a 512-byte buffer in the program). A 464 raises error 2 |
| `INK n, c1 [, c2]` | `compiled` | Pen `n` (0-15) shows colour `c1` (0-31), alternating with `c2` at the `SPEED INK` rates. Bare builds show `c1` only |
| `SPEED INK a, b` | `firmware` | The flash periods, 1-255 in 1/50 s |
| `CIRCLE x, y, r` | `alias` | The fork's circle: in the **current mode's pixels** (not Locomotive units), every pixel once, in the graphics pen. `r` below 0 draws nothing |
| `POINT(x, y)` | `alias` | The pen of the pixel at mode pixels `x, y`; the cursor does not move |

### Keywords added in L4-TEXT

Streams: `PRINT #s`, `LOCATE #s`, `CLS #s`, `PEN #s`, `PAPER #s`, `WINDOW #s`, `TAG #s`, `TAGOFF #s` and `POS(#s)`, `VPOS(#s)`,
`COPYCHR$(#s)`. A constant stream outside what the statement takes is E262 (`#0`-`#7`; `PRINT` and `POS` also `#8`, the
printer); `#9` (the file) is E002 until L4-FILES. A stream that is not a constant is checked when it runs (error 5 above 9 or
above what the statement takes).

| Keyword | Table status | What it does in the compiler |
|---|---|---|
| `WINDOW [#s,] l, r, t, b` | `firmware` | Each value is 1-255 (error 5 otherwise); the firmware cuts the window to the screen. The cursor goes to the window's corner and nothing is cleared |
| `WINDOW SWAP a [, b]` | `firmware` | Streams 0-7; with one stream the other is 0 (measured) |
| `TAG [#s]`, `TAGOFF [#s]` | `firmware` | Text at the graphics cursor on and off |
| `COPYCHR$(#s)` | `firmware` | The character at the cursor, or the empty string when the firmware does not recognise one; the 464 has no `COPYCHR$` (BASIC 1.1) |
| `PRINT #8` | `firmware` | The printer: the bytes go to MC PRINT CHAR as they are, `POS(#8)` counts the column, lines wrap at `WIDTH` (default 132; 255 never wraps) |
| `WIDTH n` | `firmware` | The printer's line width, 1-255 |
| `SYMBOL c, r1 [, ... r8]` | `compiled` | Redefines character `c` (at or above the `SYMBOL AFTER` limit, 240 unless moved; else error 5); a missing row is 0. Firmware builds keep the matrices in a table taken from the heap at the first `SYMBOL` |
| `SYMBOL AFTER n` | `compiled` | `n` is a constant 0-256 (E263), one value for the whole program (E264). The first redefinable character; keeps what was defined |
| `ZONE n` | `compiled` | The width of the comma's zones, 1-255 (error 5 otherwise) |
| `PRINT USING f$; items` | `compiled` | Numeric fields as `DEC$`, string fields `!`, `&` and `\ \`, `_` for a literal character; the format starts again for each item; text before the field goes out before a wrong-type error. At least one value (E265) |
| `LOCATE` past the width and the height | `compiled` | A column W+1..W+128 is column 1 of the next row (the window rolls on its last row), W+129..255 the last column of the previous row; a row above the window's height is its last row and from 129 on its first. `POS` and `VPOS` report where the next character goes |

### Keywords added in L4-ERR

| Keyword | Table status | What it does in the compiler |
|---|---|---|
| `ON ERROR GOTO target`, `ON ERROR GOTO 0` | `compiled` | Sets or clears the handler. The target is a line or label of the main program (E214 otherwise); the statement itself may stand in a procedure. A program with a handler pays 7 bytes and about 110 T-states per main-program statement (the error mark) and, once, the 17-byte mark routine with the trap and RESUME code (a minimal program with a handler and `RESUME NEXT` is about 350 bytes larger than one without; docs/ir.md "Errors"); a program without one pays nothing |
| `ERR`, `ERL` | `compiled` | The number and the line of the last trapped error; `ERR` is reset to 0 by `RESUME`, `ERL` stays (as on the interpreter). `ERL` is the line of the main-program statement that was running, also for an error inside a SUB or FUNCTION it called; 0 for a statement on a line with no number (also after numbered lines). Both are 0 in a program without `ON ERROR GOTO` |
| `RESUME`, `RESUME NEXT`, `RESUME target` | `compiled` | Runs the statement again, goes on after it, or goes to a main-program line or label. Outside a handler: error 20. After an error in the header of a compound statement (IF condition, FOR range, WHILE or DO condition, SELECT subject, ON selector) `RESUME NEXT` continues after the whole statement; the interpreter continues inside it (documented dialect change) |
| `ERROR n` | `compiled` | Raises error `n`; 1 to 255 as given, anything else is error 5. An untrapped error prints `Error n` with Locomotive's number |
| main-program `RETURN` | `compiled` | Error 3 (Unexpected RETURN) when no `GOSUB` is pending. Costs 3 bytes a `RETURN` and 20 bytes once |
| Overflow, Division by zero | (behaviour) | Firmware builds: without a handler the name is printed on the current line and the program goes on with +-max (or the argument for `LOG`), as Locomotive does; with a handler the error is raised. `CINT` outside -32768..32767 is a fatal Overflow. Bare builds raise them (fatal, or trapped). Integer `\` and `MOD` by zero are fatal Division by zero |

### GOSUB and RETURN in a procedure

`GOSUB` and `ON ... GOSUB` are allowed inside a SUB or FUNCTION; the target is a line or label
in the same procedure. A bare `RETURN` there returns from the `GOSUB` (error 3, "Unexpected
RETURN", if none is pending; compile error E251 when the procedure has no GOSUB). A procedure is left with `EXIT SUB`, `EXIT FUNCTION` or
`END SUB`; in a FUNCTION `RETURN value` still returns the result.

### Procedures that are never called

A SUB, FUNCTION or DEF FN that is not reachable from the main program (through calls, `@name`
or its label as a word in an ASM block) is not compiled. It is still checked. In your own file
it gets warning W306; library procedures (`#include <...>`) are dropped without a warning.

### Keywords added in L4-SMALL

| Keyword | Table status | What it does in the compiler |
|---|---|---|
| `INP(port)`, `OUT port, value` | `compiled` | The whole 16-bit port goes in BC, as on the machine. `INP` is a UBYTE |
| `WAIT port, mask [, inversion]` | `compiled` | Reads the port until `(value XOR inversion) AND mask` is not zero. The three arguments are evaluated once. (The Locomotive interpreter hangs on every three-argument WAIT tried; the two-argument form is the measured one) |
| `FRAME` | `compiled` | Waits for the frame flyback: MC WAIT FLYBACK in firmware builds, the PPI's port B bit 0 in bare builds. Returns when the flyback is on, so two FRAMEs in a row can return within one flyback, as on the machine |
| `PAUSE n` | `alias` | Waits n frames (1/50 s) or until a key is pressed; `PAUSE 0` waits for a key only (the imported runtime's `__PAUSE`; bare builds end early only on a new key press) |
| `STOP` | `compiled` | On a fresh line prints `Break in <line>` (the number of the line it stands on; `Break` on a line with no number), a line end (the first only when the cursor is not at the left edge), and ends the program without closing the open files (`END` closes them). `ON BREAK STOP` prints the same text when ESC is pressed and ends the same way |
| `FRE(0)`, `FRE("")` | `compiled` | The bytes the heap can still allocate: the sum of (block size - 2) over its free blocks, a total that fragmentation lowers by 2 per extra block. `FRE("")` is the same (the heap has no collection). The argument is not evaluated. A UINTEGER |
| `HIMEM` | `compiled` | The address of the last heap byte: a constant of the build (&9DFF with the default heap and no file statements; &95FF with one file stream, &8DFF with both). A UINTEGER |
| `RANDOM(n)` | `compiled` | An integer 0 to n-1 (0 for n = 0), n taken as unsigned, from a 16-bit xorshift scaled by n/65536. Seeded at its first call from the clock (firmware KL TIME PLEASE; bare builds the frame count), so it differs from run to run; `RANDOMIZE n`, `RANDOMIZE` and `RND(-n)` seed it too, so `RANDOMIZE 7` first makes it repeatable |
| local `DIM x = value` | (not a table entry) | The initial value is assigned each time the DIM is reached, constant or not (follow-up 66); a constant is also stored on entry to the procedure, which is the zero fill |

### Keywords added in L4-FILES

Firmware only: a bare build refuses each with E270. AMSDOS (the disc) is used through the firmware's CAS entries; a program
that uses files gives AMSDOS its 2 KB buffers under the private block (`lib/README.md`, "Files and the AMSDOS buffers"), and the
default heap ends below them (E405 and E406 when a program or a heap address does not leave the room).

| Keyword | Table status | What it does in the compiler |
|---|---|---|
| `OPENIN "name"`, `CLOSEIN`, `EOF` | `firmware` | Opens the input file (error 27 when one is open; error 32 with the AMSDOS code in `DERR` when AMSDOS cannot, after printing its own message). `CLOSEIN` with nothing open is nothing. `EOF` is -1 at the end of the file and with no input file, else 0 |
| `INPUT #9, items`, `LINE INPUT #9, a$` | `firmware` | The items of Locomotive's file rules (measured): blanks before an item skipped, a `,` or CR ends it, a string item starting with `"` ends at the next `"` (a CR may be inside), a number is read as `VAL` reads it, LF is never part of an item. The prompt, if any, is not shown. Error 24 at the end of the file, 31 with no file open. `LINE INPUT #9` reads to the CR |
| `OPENOUT "name"`, `CLOSEOUT`, `PRINT #9, ...` | `firmware` | The output file. `PRINT #9` is `PRINT` with the file as the device: zones, `TAB`, `SPC`, `USING` and the number text as on the screen, a line end of CR LF, a line broken after 255 characters, `POS(#9)` counting from 1. Error 31 with no output file; error 27 when one is open. A file nothing was written to is not created (AMSDOS). Close it with `CLOSEOUT`: the last block is written then |
| `WRITE [#s,] items` | `firmware` | A string in quotes, a number as text without the leading space, the items separated by commas (`;` also separates in the source), a line end after the last. `#9`, a screen stream or the printer. A separator with nothing after it is E191 |
| `LOAD "name" [, address]`, `SAVE "name", B, address, length [, entry]` | `firmware` | Binary files only: `LOAD` puts the file at the address given or the one in its AMSDOS header, `SAVE` writes the memory as a type 2 file with that entry address. `SAVE "name"` and the types `A` and `P` are E279 (a compiled program has no BASIC text to save). A constant outside 16 bits is E280. An open file of either stream is abandoned first (not an error; the output file is not written), as `CAT` and `CHAIN` do |
| `CAT` | `firmware` | AMSDOS prints the catalogue; an open input or output file is abandoned first (no error) |
| `CHAIN "name"` | `firmware` | Loads another binary over the running program and starts it at its entry address, as `RUN"` does (MC BOOT PROGRAM). `CHAIN MERGE`, `CHAIN "name", line` and BASIC programs are E981. Error 32 when the file cannot be opened. An open file of either stream is abandoned first, even when the `CHAIN` fails |
| `DERR` | `firmware` | The last AMSDOS error code (146 for a file not found), 0 before the first |
| `INPUT #1`-`#7`, `LINE INPUT #1`-`#7` | `compiled` | The text stream is selected for the statement; the typed characters echo in its window. `INPUT #8` is E262 |
| `EOF`, `DERR` as expressions | | INTEGERs |

An empty file name is E281 (AMSDOS answers "Bad command").

## Entry fields

| Field | Meaning |
|---|---|
| `name` | Canonical spelling: upper case, single spaces (`LINE INPUT`, `STR$`); directives lower case (`#include`). |
| `kind` | `statement`, `function`, `operator`, `type`, `clause` or `preprocessor`. `MID$` has a function and a statement entry. |
| `status` | `compiled`, `firmware` (firmware mode only), `library`, `later`, `alias` (see `aliasOf`) or `dropped`. `later` and `dropped` carry a `hint`. |
| `reserved` | Whether the words of `name` are reserved. Soft words lex as identifiers. |
| `syntax`, `section`, `note` | Reference text: one-line syntax, the language-reference section, remarks. |
| `form` | Statements: `builtin` (generic AST node built from the table) or `special` (own parser). |
| `args` | `{ min, max }`: how many comma-separated arguments, not counting `#stream` or a type argument. `max` may be `Infinity`. |
| `stream` | Accepts a leading `#stream`. For `POS`, `VPOS` and `COPYCHR$` the stream is the whole argument. |
| `typeArg` | Accepts (or, for `CAST`, requires) a leading type name. |
| `emptyArgs`, `optionalFirst` | Arguments may be left empty (`SOUND 1, 200, , 15`); with `optionalFirst`, also the first (`PEN , 1`). |
| `parens` | Functions: `required`, `optional` (`RND`) or `none` (`INKEY$`, `TIME`). |
| `returns` | Result type of a function; `numeric` is the promoted argument type, `cast` the named type. |
| `context` | `print`: only inside PRINT (`TAB`, `SPC`). |
| `params` | The kind of each argument (below). |
| `checked` | The checker constrains the kinds in `params`. Without it the arguments are typed but not constrained. |

## Argument kinds: `params`

Every built-in statement (`form: 'builtin'`) and every function with `args` has `params`,
a list of `{ kind, name, optional?, leading?, repeat? }` in source order, after any
`#stream` and type argument. A statement without arguments has an empty list.

Kinds:

- `int`: a number; a FIXED or REAL value is converted to INTEGER (truncating).
- `num`: a number, left as it is.
- `str`: a STRING.
- `strOrInt`: a STRING or a number (`STRING$(n, c)` or `STRING$(n, c$)`).
- `addr`: a number converted to UINTEGER (addresses and ports).
- `any`: an expression of any type (`CAST`, `FRE`, `SIZEOF`).
- `array`: the name of an array (`LBOUND`, `UBOUND`).
- `ident`: a bare word, not an expression (the file-type letter of `SAVE`).

Alternative forms:

- `optional`: the argument may be left off, or empty where `emptyArgs` allows it. Optional
  params that are not leading form the tail: `MID$(s$, p [, n])`, `PLOT x, y [, pen [, mode]]`.
  `PEN [ink] [, mode]` has two optional params while `args.min` is 1 (at least one slot).
- `leading`: an optional param that comes first and is present only when all params are
  given: `INSTR([start,] a$, b$)` takes 2 or 3 arguments.
- `repeat`: on the last param only; it may be given again, up to `args.max`
  (`MIN`, `MAX`, `SYMBOL`, `ENV`, `ENT`).

Invariants (tested): the required params number at most `args.min`; `args.min` is at most
the number of params; without `repeat` the number of params equals `args.max`; with it,
`args.max` is at least that number (infinite for `MIN` and `MAX`).

The checker's signature tables (`STMT_SIGS`, `FN_SIGS` in `src/checker/builtins.ts`) are
derived from the entries marked `checked`.

## Bare-metal builds

A bare-metal build (`-D CPC_BAREMETAL`) has no firmware, ROM or AMSDOS: it uses the runtime's own text renderer,
graphics routines and 300 Hz handler. The table gives each statement and function that L4 adds as FB (compiled in
firmware and bare builds: `yes` in both columns), F (firmware only: the Bare column says `E270`, the refusal that names
the statement) or FB\* (both, with a difference: `yes*` in the Bare column and the difference in the last one).

What a bare build does not do, with what to use instead (the same list as the README's "Bare-metal builds"):

- **Sound statements** (`SOUND`, `ENV`, `ENT`, `RELEASE`, `SQ`): use the music and sound-effects library
  (`#include <music/music.bas>`: `MusicInit`, `SfxPlay`, ...) or `AyWrite` (`stdlib/cpc.bas`). `BEEP` works.
- **Files** (`OPENIN`, `OPENOUT`, `CLOSEIN`, `CLOSEOUT`, `#9`, `WRITE`, `EOF`, `DERR`, `LOAD`, `SAVE`, `CAT`, `CHAIN`, and `INPUT` and `LINE INPUT` on `#1` to `#7`): no AMSDOS in a bare build, so there is no replacement for a disc file; put the data in the program itself (`DATA`, initialised arrays, `#pragma hidata`).
- **Windows and streams** (`WINDOW`, `WINDOW SWAP`, `TAG`, `TAGOFF`, `WIDTH`, `COPYCHR$`, `#1` to `#8`): a bare build has
  the one text window `#0`; for text anywhere and in any font use the cpcbuild text library
  (`#include <cpcbuild/text.bas>`).
- **`KEY`, `KEY DEF`, `SPEED KEY`**: use `INKEY(n)` or the keyboard scan of `cpcbuild/keyboard.bas`.
- **Flashing inks** (`SPEED INK`, the second colour of `INK`): `INK` shows its first colour only.
- **`ON BREAK STOP`**: `ON BREAK CONT` compiles; test ESC with `INKEY(66)`.
- **`MASK`, `FILL`**, the ink mode of `PLOT` and `DRAW`, the window of `ORIGIN` and the second argument of `GRAPHICS PEN`.

| Statement or function | Firmware | Bare | In bare builds |
|---|---|---|---|
| INP | yes | yes |  |
| OUT | yes | yes |  |
| WAIT | yes | yes |  |
| FRAME | yes | yes |  |
| PAUSE | yes | yes |  |
| STOP | yes | yes |  |
| FRE | yes | yes |  |
| HIMEM | yes | yes |  |
| RANDOM | yes | yes |  |
| `EVERY`, `AFTER`, `REMAIN`, `DI`, `EI` | yes | yes |  |
| `TIME` | yes | yes* | 1/50 s resolution (the frame counter x 6) |
| SOUND | yes | E270 |  |
| ENV | yes | E270 |  |
| ENT | yes | E270 |  |
| RELEASE | yes | E270 |  |
| SQ | yes | E270 |  |
| BEEP | yes | yes |  |
| PLOT | yes | yes* | the ink mode argument (XOR, AND, OR) is E270; a literal 0 is accepted. Drawn pixel for pixel as the firmware does |
| PLOTR | yes | yes* | the ink mode argument (XOR, AND, OR) is E270; a literal 0 is accepted. Drawn pixel for pixel as the firmware does |
| MOVE | yes | yes* | the ink mode argument (XOR, AND, OR) is E270; a literal 0 is accepted. Drawn pixel for pixel as the firmware does |
| MOVER | yes | yes* | the ink mode argument (XOR, AND, OR) is E270; a literal 0 is accepted. Drawn pixel for pixel as the firmware does |
| DRAW | yes | yes* | the ink mode argument (XOR, AND, OR) is E270; a literal 0 is accepted. Drawn pixel for pixel as the firmware does |
| DRAWR | yes | yes* | the ink mode argument (XOR, AND, OR) is E270; a literal 0 is accepted. Drawn pixel for pixel as the firmware does |
| TEST | yes | yes |  |
| TESTR | yes | yes |  |
| XPOS | yes | yes |  |
| YPOS | yes | yes |  |
| CLG | yes | yes |  |
| GRAPHICS PAPER | yes | yes |  |
| CIRCLE | yes | yes |  |
| POINT | yes | yes |  |
| ORIGIN | yes | yes* | the window part (left, right, top, bottom) is E270 |
| GRAPHICS PEN | yes | yes* | the second argument (the transparent background mode) is E270 |
| INK | yes | yes* | the first colour only, no flashing |
| SPEED INK | yes | E270 |  |
| MASK | yes | E270 |  |
| FILL | yes | E270 |  |
| WINDOW | yes | E270 |  |
| WINDOW SWAP | yes | E270 |  |
| TAG, TAGOFF | yes | E270 |  |
| COPYCHR$ | yes | E270 |  |
| `#s` of PRINT, LOCATE, CLS, PEN, PAPER, POS, VPOS (s = 1-7, 8) | yes | E270 | the one text window `#0` |
| WIDTH | yes | E270 | no printer port driver |
| ZONE | yes | yes |  |
| SYMBOL | yes | yes | writes the runtime's glyph table |
| SYMBOL AFTER | yes | yes* | only moves the limit for `SYMBOL` (the glyph table is always whole) |
| PRINT USING | yes | yes |  |
| LOCATE past the width | yes | yes* | a column that wraps back from row 1 does not roll the screen down |
| ON ERROR | yes | yes |  |
| RESUME | yes | yes |  |
| ERROR | yes | yes |  |
| ERR | yes | yes |  |
| ERL | yes | yes |  |
| Overflow, Division by zero (non-fatal in firmware builds) | yes | yes* | raised (fatal, or trapped by `ON ERROR`): the build does not carry on with +-max |
| INKEY(n) | yes | yes |  |
| JOY(n) | yes | yes |  |
| CLEAR INPUT | yes | yes* | there is no key buffer: a key held down now is taken as used |
| INPUT, LINE INPUT | yes | yes* | the minimal line editor: characters, DEL (not back over the start of a screen row), RETURN; no cursor keys, COPY or CLR; keys repeat as in `INKEY$`. Firmware builds have the same editor, with the firmware's key buffer |
| KEY | yes | E270 |  |
| KEY DEF | yes | E270 |  |
| SPEED KEY | yes | E270 |  |
| ON BREAK CONT | yes | yes | nothing to ignore: no code |
| ON BREAK STOP | yes | E270 |  |
| `#s` of INPUT and LINE INPUT (s = 1-7) | yes | E270 | the one text window `#0` |
| OPENIN, CLOSEIN, EOF | yes | E270 | no AMSDOS |
| OPENOUT, CLOSEOUT | yes | E270 | no AMSDOS |
| INPUT #9, LINE INPUT #9, PRINT #9, WRITE | yes | E270 | the stream is the file (`WRITE` on a screen stream needs the firmware too) |
| LOAD, SAVE, CAT | yes | E270 | no AMSDOS |
| CHAIN | yes | E270 | no AMSDOS |
| DERR | yes | E270 | no AMSDOS |
