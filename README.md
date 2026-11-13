# cpcbas: CPC BASIC for the Amstrad CPC

A compiler for CPC BASIC: Locomotive BASIC 1.1 as you know it, with typed
SUBs and FUNCTIONs, arrays, inline Z80, includes and the other features that make
compiled games fast. It targets the Amstrad CPC 464, 664, 6128 and the Plus
range, in firmware mode or bare-metal mode, and produces `.bin`, `.dsk` and
`.cpr` files.

Written in TypeScript as a pure library: the same code runs as a command-line
tool (`cpcbas`), inside CPC Game Studio (VS Code) and in the browser.

Status: under construction. The language core, arrays, strings, the `@`
forms, the game library (`lib/`) and the Locomotive statements for timers,
error handling, graphics and colour, text and windows, the keyboard, sound,
the machine and files compile and run on emulated CPCs.

Part of [CPCBuild](https://github.com/carcharo/cpcbuild).

Licences: compiler AGPL-3.0-or-later (LICENSE), runtime library MIT
(lib/LICENSE). See NOTICE.

## Quick start

Build the compiler once, then compile a program:

```
npm install
npm run build
node packages/cpcbas/dist/bin/cpcbas.js -D CPC6128 -o hello.dsk hello.bas
```

Put this in `hello.bas`:

```basic
DIM names$(2) => {"Ann", "Bob", "Cy"}
DIM score(2) AS INTEGER => {120, 95, 210}

FUNCTION Best() AS INTEGER
    DIM i AS INTEGER, top AS INTEGER
    FOR i = 1 TO UBOUND(score)
        IF score(i) > score(top) THEN top = i
    NEXT i
    RETURN top
END FUNCTION

MODE 1
PRINT AT 2, 4; "Best: "; names$(Best()); " with "; score(Best())
PRINT AT 4, 4; "Hex "; HEX$(score(Best()), 4)
```

On a CPC (or an emulator) it prints `Best: Cy with  210` on row 3 and
`Hex 00D2` on row 5 (`PRINT` puts a space before a positive number).

The output format follows the extension of `-o`: `.bin`, `.dsk` or `.cpr`
(or give `-f bin|dsk|cpr`). `-D CPC464`, `-D CPC6128` or `-D PLUS` picks the
machine the library should build for, and `-D CPC_BAREMETAL` builds a
program that does not use the firmware. `cpcbas --help` lists every option.

## Options

`cpcbas --help` lists every option. These are the main ones.

| Option | What it does |
|---|---|
| `-o FILE` | Output file (`.bin`, `.dsk` or `.cpr`). |
| `-f bin\|dsk\|cpr` | Output format, if the extension of `-o` does not say. |
| `-D NAME[=VALUE]` | Define a name, for example `-D CPC6128` or `-D CPC_BAREMETAL`. Repeat it for more. |
| `-I DIR` | Add an include directory. Repeat it for more. |
| `-O0` `-O1` `-O2` `-O3` `-Os` | Optimisation level. The default is `-O2`; `-Os` makes the smallest programs. |
| `--opt-disable NAME[,NAME]` | Turn off optimiser passes, rules or features, to narrow down a suspected optimiser bug. |
| `--opt-trace` | Mark in the `--asm` output what the optimiser changed. |
| `-M FILE` | Write the memory map. |
| `--asm FILE` | Write the generated assembly. |
| `-W CODE`, `-Werror` | Disable a warning; report warnings as errors. |

What each level does, what never changes at any level and how to report an
optimiser bug are in [docs/optimisation.md](docs/optimisation.md).

## What compiles now

| Area | What works |
|---|---|
| Types | `UBYTE`, `BYTE`, `UINTEGER`, `INTEGER`, `ULONG`, `LONG`, `FIXED`, `REAL`, `STRING`; `DEFINT`, `DEFREAL`, `DEFSTR`; `OPTION REAL`; `CONST` |
| Control flow | `IF`, `FOR`, `WHILE`, `DO ... LOOP`, `SELECT CASE` (numbers and strings), `EXIT`, `CONTINUE`, `GOTO`, `GOSUB`, `ON ... GOTO`, `ON ... GOSUB`, `END` |
| Procedures | `SUB`, `FUNCTION`, `DECLARE`, `DEF FN`, `BYVAL`, `BYREF`, `FASTCALL`, recursion, array parameters |
| Arrays | `DIM` with one or more dimensions, of any type, global or local, with `=> { ... }` initialisers, `AT address` (global arrays, without an initialiser), `#pragma hidata` (places the elements of initialised global arrays at an address); `LBOUND`, `UBOUND` |
| Strings | concatenation, comparison, `LEN`, `LEFT$`, `RIGHT$`, `MID$` (function and statement), `INSTR`, `STRING$`, `SPACE$`, `UPPER$`, `LOWER$`, `CHR$`, `ASC`, `STR$`, `VAL`, `HEX$`, `BIN$`, `DEC$` |
| Numbers | integer, `FIXED` and `REAL` arithmetic; `ABS`, `SGN`, `INT`, `FIX`, `CINT`, `CREAL`, `ROUND`, `MIN`, `MAX`, `SQR`, `SIN`, `COS`, `TAN`, `ATN`, `EXP`, `LOG`, `LOG10`, `PI`, `RND`, `RANDOMIZE`, `DEG`, `RAD`, `CAST`, `SIZEOF` |
| Screen and memory | `MODE`, `CLS`, `LOCATE`, `PRINT` (with `TAB`, `SPC`, `AT`, `USING`, `#s`), `PEN`, `PAPER`, `BORDER`, `POS`, `VPOS`, `INKEY$`, `PEEK`, `POKE`, `MEMORY` |
| Timers | `EVERY`, `AFTER`, `REMAIN`, `DI`, `EI`, `TIME` |
| Errors | `ON ERROR GOTO`, `RESUME`, `ERR`, `ERL`, `ERROR`, the non-fatal Overflow and Division by zero |
| Graphics and colour | `INK`, `SPEED INK`, `CLG`, `ORIGIN`, `PLOT`, `PLOTR`, `MOVE`, `MOVER`, `DRAW`, `DRAWR`, `TEST`, `TESTR`, `XPOS`, `YPOS`, `GRAPHICS PEN`, `GRAPHICS PAPER`, `MASK`, `FILL`, `CIRCLE`, `POINT` |
| Text | `WINDOW`, `WINDOW SWAP`, `TAG`, `TAGOFF`, `WIDTH`, `SYMBOL`, `SYMBOL AFTER`, `ZONE`, `PRINT USING`, `COPYCHR$`, `LOCATE` past the width, streams `#0` to `#8` |
| Keyboard | `INKEY(n)`, `JOY`, `KEY`, `KEY DEF`, `SPEED KEY`, `CLEAR INPUT`, `INPUT`, `LINE INPUT`, `ON BREAK STOP`, `ON BREAK CONT` |
| Sound | `SOUND`, `ENV`, `ENT`, `RELEASE`, `SQ`, `BEEP` |
| Files | `OPENIN`, `OPENOUT`, `CLOSEIN`, `CLOSEOUT`, `#9`, `WRITE`, `EOF`, `DERR`, `LOAD`, `SAVE`, `CAT`, `CHAIN "name"` |
| Machine | `INP`, `OUT`, `WAIT`, `FRAME`, `PAUSE`, `STOP`, `FRE`, `HIMEM`, `RANDOM` |
| Data | `DATA`, `READ`, `RESTORE` |
| Machine code | `ASM ... END ASM`, `CALL` (with number and string arguments), `@` of variables, arrays, elements, locals, parameters, procedures and labels, `#require`, `#init` |
| Preprocessor | `#include` (also `#include <file>` from the bundled library), `#define`, `#if` and friends, `#pragma` (`org`, `heap_size`, `heap_address`, `hidata`, `explicit`) |

The lists come from the compiler's own gate, `packages/cpcbas/src/checker/subset.ts`.

### Arrays

Arrays start at index 0: `DIM a(5)` has the elements 0 to 5. A range such as
`DIM a(1 TO 5)` is an error (E970). A constant index outside the bounds is a
compile-time error, and there is no run-time bounds check. `UBOUND(a)` and
`LBOUND(a)` without a dimension mean dimension 1; `UBOUND(a, 0)` is the number
of dimensions. `@a` is the address of the first element and `@a(i)` the
address of element `i`. Arrays are passed to a SUB or FUNCTION by name, always
by reference. Local arrays live on the heap and are freed when the procedure
ends.

```basic
DIM g(2, 3) AS INTEGER => {{1, 2, 3, 4}, {5, 6, 7, 8}, {9, 10, 11, 12}}
DIM t(7) AS UBYTE

FUNCTION Sum(v() AS UBYTE) AS INTEGER
    DIM i AS INTEGER, s AS INTEGER
    FOR i = 0 TO UBOUND(v)
        s = s + v(i)
    NEXT i
    RETURN s
END FUNCTION

SUB Bump(BYREF x AS UBYTE)
    x = x + 5
END SUB

Bump(t(2))
Bump(t(2))
PRINT g(1, 2), Sum(t)       ' prints 7 and 10
```

### Strings

```basic
PRINT HEX$(255, 4); " "; BIN$(5, 8)      ' 00FF 00000101
PRINT DEC$(1234.5678, "####.##")         ' 1234.57
a$ = "HELLO"
MID$(a$, 2, 2) = "XYZ"                   ' the length of a$ never changes
PRINT a$                                 ' HXYLO
SELECT CASE a$
CASE "HXYLO": PRINT "match"
CASE ELSE: PRINT "no match"
END SELECT
```

`HEX$(n)` and `BIN$(n)` take a second argument, the minimum number of digits.
A negative number prints as its 16-bit two's complement (`HEX$(-1)` is `FFFF`).
`DEC$(n, format$)` formats like `PRINT USING`. The `MID$` statement replaces
characters in place and never changes the length of the string.

### PRINT AT and the `@` forms

`PRINT AT row, column; items` counts from 0 with the row first, and is the
same as `LOCATE column + 1, row + 1` followed by the items.

`@` gives an address. It works on global and local variables, parameters, string
variables (the address of the variable's own two-byte slot), arrays and array
elements, SUBs and FUNCTIONs, and line labels. `CALL` takes a string
expression as an argument: the routine receives the address of a three-byte
descriptor (the length, then the address of the text), and the string is freed
after the call returns.

```basic
DIM routine AS UINTEGER = &A000      ' the address of your machine-code routine
msg$ = "hello"
CALL routine, msg$ + " world"        ' the routine receives a descriptor's address

SUB Greet(n AS INTEGER)
    PRINT "Hello"; n
END SUB
CALL @Greet, 3                       ' a SUB called through its address
```

### RND, RANDOMIZE and ROUND

- `RND` gives the next number between 0 and 1. `RND(0)` gives the last number
  again, `RND(-n)` restarts the sequence from `|n|`, and `RND(n)` with `n` above 0
  is the next number.
- `RANDOMIZE n` restarts the sequence from `n`: the same `n` always gives the same
  sequence, and `RANDOMIZE 7` and `RND(-7)` begin the same one. In a firmware build
  `RANDOMIZE -7` starts a different sequence from `RANDOMIZE 7`, as in Locomotive; a
  bare-metal build seeds from `|n|`. `RANDOMIZE` with no number seeds from the time
  and never asks you for one. All three forms (`RANDOMIZE n`, `RANDOMIZE`, `RND(-n)`) seed
  `RANDOM(n)` too (below).
- In a firmware build the numbers are Locomotive's own: `RANDOMIZE n` and
  `RND(-n)` give the same sequence as the interpreter. A bare-metal build has its
  own generator, so a program there can rely on the rules above but not on the
  values.
- `ROUND(x [, n])` rounds half away from zero to `n` decimal places (a
  negative `n` rounds to tens, hundreds and so on) and always gives a `REAL`.

### `^` and constants

`^` always gives a `REAL`, as in Locomotive: `PRINT 2^30` prints
` 1.07374E+09 `. Constant expressions are folded at compile time, including
`ABS`, `SGN`, `MIN`, `MAX`, `CINT`, `UNT`, `LEN`, `ASC`, `CHR$`, `LEFT$`,
`RIGHT$`, `MID$`, `SPACE$` and `STRING$`, so `CONST k = ABS(-3)` and
`DIM t(2^3)` work.

### REAL speed and program size

In a firmware build, REAL `+ - * /`, `^` and the functions (`SQR`, `EXP`, `LOG`,
`LOG10`, `SIN`, `COS`, `TAN`, `ATN`) use the CPC firmware's own maths, whichever
of the 464, 664, 6128 and 6128 Plus the program runs on, so results match
Locomotive bit for bit and are faster than the interpreter. On an emulated 6128,
`a+b` takes 0.59 ms against the interpreter's 0.93 ms and `SIN(a)` takes 13.59 ms
against 13.72 ms; a whole float benchmark runs in 8.98 s against Locomotive's
9.57 s. A bare-metal build has no firmware and uses a software calculator (8
significant digits, its own `RND`, and a Newton-method `SQR` that takes 21.46 ms
against the firmware's 26.56 ms). It is slower for the other functions: `SIN(a)`
takes 40.98 ms, and the same benchmark takes 14.36 s. `STR$`, `VAL`, `INT`, `RND`
and comparisons of REALs are currently slower than the interpreter (`STR$` 11.03
ms against 5.95 ms, `VAL` 8.70 ms against 3.65 ms); an improvement is planned.
Programs are on the whole smaller than the frozen Boriel fork's: over 41
library and conformance programs the firmware images total 382 896 bytes against
445 527 (14.1 % smaller). REAL-heavy programs are the exception: the `floats` test
program is 9 741 bytes against the fork's 7 497. In game loops, prefer `INTEGER`
or `FIXED` to `REAL`. The figures are CPCEC timings of emulated machines.

### GOSUB, RETURN and procedures

`GOSUB` and `ON ... GOSUB` can be used inside a SUB or FUNCTION. The target is
a line or label in the same procedure. A bare `RETURN` there returns from the
`GOSUB`; if none is pending it stops with error 3, "Unexpected RETURN". A
bare `RETURN` in a procedure that has no `GOSUB` at all is compile error E251. To
leave a procedure, use `EXIT SUB`, `EXIT FUNCTION` or `END SUB`. In a
`FUNCTION`, `RETURN value` still returns the result.

### Procedures that are never called

A SUB or FUNCTION that nothing calls is not compiled. Nothing reaches it when
no call, no `@name` and no ASM block of the main program or of a reachable
procedure mentions it. The compiler still checks an unused procedure and
reports its errors. For a procedure in your own file it also warns W306
("never called; it is not compiled"). Procedures of the bundled library
(`#include <...>`) are dropped without a warning, so you can include the
whole library and pay only for what you call.

## The Locomotive statements

These are Locomotive BASIC 1.1's statements and functions, compiled, with a few of the dialect's own
(`RANDOM`, and `PAUSE`, `BEEP`, `CIRCLE` and `POINT`, which other BASICs' programs use). Each group below has one
short example; [docs/keywords.md](docs/keywords.md) lists every keyword with its ranges and its
rules. A statement that needs the firmware is marked, and "Bare-metal builds" below says what a
`-D CPC_BAREMETAL` build does about each. The examples are compiled by a test for the default build,
`-D CPC464`, `-D PLUS` and, where the group works without the firmware, `-D CPC_BAREMETAL`.

### Timers: EVERY, AFTER, REMAIN, DI, EI, TIME

There are four timers, 0 to 3, and timer 3 has the highest priority. `EVERY n, t GOSUB target`
runs the handler every `n` fiftieths of a second, `AFTER` once; `t` defaults to 0. A handler runs at the next
statement boundary, never between two parts of one statement, so a single long statement delays it. A handler is interrupted only by a higher timer, and its `RETURN`
lets lower ones run again. The handler's target is a line or label of the main program (error E214
otherwise), even when the `EVERY` stands in a SUB. `REMAIN(t)` gives what is left of timer `t` and
stops it. `DI` and `EI` hold back and release the handlers (they do not touch the Z80's interrupts).
`TIME` counts in 1/300 s.

```basic
DIM ticks AS INTEGER, t0 AS ULONG

ticks = 0
EVERY 50, 1 GOSUB onSecond      ' timer 1, every 50/50 s
AFTER 500, 2 GOSUB onTimeout    ' timer 2, once, after 10 s
t0 = TIME
WHILE ticks < 3
    LOCATE 1, 1: PRINT "Seconds:"; ticks; "  left:"; REMAIN(2) \ 50; " "
WEND
DI                              ' handlers wait until EI; due events are remembered
CLS
EI
PRINT "Elapsed 1/300 s:"; TIME - t0
END

onSecond:
    ticks = ticks + 1
    RETURN

onTimeout:
    PRINT "Timeout"
    RETURN
```

A program that uses `EVERY` or `AFTER` pays for the check at each statement: 3 bytes and about
45 T-states a statement in firmware builds, about 110 T-states in bare builds. A program without
them pays nothing. A firmware build started with `RUN"` should wait about a second before its first
`EVERY` or `AFTER`: a timer set in the first 0.6 s counts nothing until then (a known issue, not fixed yet). A bare build has no such delay.

### Errors: ON ERROR GOTO, RESUME, ERR, ERL, ERROR

`ON ERROR GOTO target` sends every run-time error to a handler in the main program; `ON ERROR GOTO 0`
turns the handler off. In the handler, `ERR` is the error's number and `ERL` the line it happened in.
`RESUME` runs the statement again, `RESUME NEXT` goes on after it, and `RESUME target` goes to a line or
label. `ERROR n` raises error `n` (1 to 255) yourself. See "Errors" below for the numbers.

```basic
DIM d AS INTEGER, q AS INTEGER

ON ERROR GOTO oops
d = 0
q = 100 \ d                     ' error 11, Division by zero
PRINT "Went on with q ="; q
ERROR 33                        ' your own error number, 1 to 255
PRINT "Done"
END

oops:
    PRINT "Error"; ERR; "in line"; ERL
    RESUME NEXT                 ' carry on after the statement that failed
```

A program with a handler pays 7 bytes and about 110 T-states for every statement of the main program, plus a
small routine; a program without one pays nothing.

### Graphics and colour

Coordinates are Locomotive's: 640 x 400 units in every mode, the origin at the bottom left unless `ORIGIN`
moves it. `PLOT`, `MOVE` and `DRAW` (and the relative `PLOTR`, `MOVER`, `DRAWR`) take an optional pen and an ink mode
(0 normal, 1 XOR, 2 AND, 3 OR) after the coordinates. `TEST(x, y)` gives the pen of a pixel, `XPOS` and `YPOS` the cursor.
`INK pen, c1 [, c2]` sets a pen's colour. `CIRCLE x, y, r` and `POINT(x, y)` count in the current mode's pixels, not in
Locomotive units.

```basic
MODE 1
INK 0, 1: INK 1, 24: INK 2, 20: INK 3, 6
BORDER 1
ORIGIN 0, 0
GRAPHICS PEN 1
MOVE 100, 100
DRAW 500, 100
DRAW 500, 300
DRAW 100, 300
DRAW 100, 100
PLOT 300, 200, 3
IF TEST(300, 200) = 3 THEN PRINT "Pen 3 at 300,200"
CIRCLE 80, 100, 20
PRINT XPOS; YPOS
```

These four need the firmware: the ink mode, `MASK`, `FILL` and `SPEED INK`.

<!-- example: firmware -->
```basic
MODE 1
GRAPHICS PEN 1
PLOT 100, 100, 1, 1             ' pen 1, XOR ink mode: plot it twice and it is gone
PLOT 100, 100, 1, 1
MASK 15                         ' a dashed line
MOVE 0, 0: DRAW 639, 399
MASK 255
FILL 2
SPEED INK 25, 25
INK 1, 2, 24                    ' pen 1 flashes between colours 2 and 24
```

`FILL` uses a 512-byte buffer inside the program. A bare build shows only the first colour of `INK`.

### Text: windows, streams, SYMBOL, ZONE, PRINT USING

`PRINT`, `LOCATE`, `CLS`, `PEN`, `PAPER`, `POS`, `VPOS` and `COPYCHR$` take a stream, `#0` to `#7` for the
text windows that `WINDOW` makes and `#8` for the printer (`PRINT` and `POS` only). `SYMBOL c, rows...`
redefines a character at or above the `SYMBOL AFTER` limit (240 unless you move it), `ZONE` sets the
width of the comma's columns, and `PRINT USING` formats numbers and strings. `LOCATE` past the width or
the height wraps as the firmware's does.

```basic
MODE 1
SYMBOL AFTER 240
SYMBOL 240, &18, &3C, &7E, &FF, &FF, &7E, &3C, &18
ZONE 12
PRINT "A"; CHR$(240), "B"
LOCATE 1, 5
PRINT USING "###.## points"; 12.5
PRINT USING "!"; "Hello"
PRINT USING "\  \"; "Hello"
```

`SYMBOL`, `SYMBOL AFTER`, `ZONE` and `PRINT USING` also work in bare builds. Windows, the other streams, `TAG`
and the printer need the firmware.

<!-- example: firmware -->
```basic
MODE 1
WINDOW #1, 5, 35, 5, 10
PAPER #1, 3: PEN #1, 0
CLS #1
PRINT #1, "In the window"
LOCATE #1, 2, 3
PRINT #1, "Row 3"
GRAPHICS PEN 1
MOVE 100, 100
TAG
PRINT "At the graphics cursor";
TAGOFF
PRINT #8, "To the printer"
WIDTH 80
```

The printer's line width defaults to 132 (`WIDTH n` changes it, 1 to 255).

### Keyboard: INPUT, LINE INPUT, INKEY(n), JOY, KEY

`INPUT` and `LINE INPUT` read a line from the keyboard (stream `#0`). `INKEY(n)` reads the key with
Locomotive's number `n` (0 to 79) and gives -1 while it is up; `JOY(0)` and `JOY(1)` read the joysticks and
give 0 when nothing moves. `CLEAR INPUT` throws away the keys typed ahead. `ON BREAK CONT` makes ESC do nothing.

```basic
DIM name$ AS STRING, n AS INTEGER

ON BREAK CONT
CLEAR INPUT
INPUT "Your name"; name$
LINE INPUT "A line: ", name$
PRINT "Hello, "; name$
IF INKEY(47) <> -1 THEN PRINT "Key 47 is down"
IF JOY(0) <> 0 THEN PRINT "Joystick 0 is moved"
INPUT "How many"; n
PRINT n * 2
```

`KEY`, `KEY DEF`, `SPEED KEY` and `ON BREAK STOP` need the firmware.

<!-- example: firmware -->
```basic
KEY 1, "RUN" + CHR$(13)        ' expansion string 1 types RUN and RETURN
KEY DEF 69, 1, 98              ' key 69 (the A key) types b, and repeats
SPEED KEY 20, 5
ON BREAK STOP
PRINT "Press ESC to stop"
WHILE 1: WEND
```

### Sound: SOUND, ENV, ENT, RELEASE, SQ, BEEP

`SOUND` queues a note with the firmware's sound manager and waits while the queue is full. `ENV` and
`ENT` define volume and tone envelopes, `RELEASE` frees held channels and `SQ(channel)` gives a channel's
status byte (bits 0 to 2 are the free queue entries). `BEEP duration, pitch` is the Sinclair beep, in both
kinds of build.

```basic
BEEP 0.5, 12
```

<!-- example: firmware -->
```basic
ENV 1, 15, -1, 3, 1, 0, 100     ' volume envelope 1: ramp down
ENT 1, 5, 4, 1                  ' tone envelope 1
SOUND 1, 478, 100, 12, 1, 1     ' channel A, period 478
WHILE (SQ(1) AND 7) < 4: WEND   ' wait for a free queue entry
SOUND 1 + 16, 253, 100          ' channel A, rendezvous with B
SOUND 2 + 8, 239, 100           ' channel B, rendezvous with A
RELEASE 3
```

### Machine statements: INP, OUT, WAIT, FRAME, PAUSE, STOP, FRE, HIMEM, RANDOM

`INP(port)` and `OUT port, value` use the whole 16-bit port, as on the machine. `FRAME` waits for the frame
flyback, `PAUSE n` waits `n` frames or until a key is pressed, and `STOP` ends the program after printing
`Break in n`. `FRE(0)` is the number of bytes the heap can still hand out, `HIMEM` the address of its last byte
(&9DFF with the default heap and no file statements), and `RANDOM(n)` a whole number from 0 to n-1. `RANDOM` is seeded from
the clock at its first call (the firmware's time, or the frame count in a bare-metal build), so it differs from run to run
(in a bare-metal build only when something the player does, such as waiting for a key, came before the first call: the frame
count of a program that never waits is the same every run);
`RANDOMIZE n` (also `RANDOMIZE` and `RND(-n)`) seeds it too, so a program that starts with `RANDOMIZE 7` gets the same
`RANDOM` numbers every run.

```basic
DIM k AS INTEGER, sum AS INTEGER

RANDOMIZE 7
sum = RANDOM(6) + 1             ' 1 to 6
PRINT "Dice:"; sum
PRINT "Free:"; FRE(0); "top:"; HIMEM
FRAME                           ' wait for the frame flyback
OUT &7F00, &10                  ' gate array: select the border
OUT &7F00, &54                  ' and give it hardware colour 20 (&14)
PAUSE 25                        ' half a second, or until a key
k = INP(&F500) AND 1            ' the PPI's port B, bit 0: the frame flyback
PRINT k
STOP
```

### Files: OPENIN, OPENOUT, #9, WRITE, EOF, DERR, LOAD, SAVE, CAT, CHAIN

Files are firmware only: they go through AMSDOS, so a bare build refuses them. `OPENIN "name"` opens the input
file and `OPENOUT "name"` the output file; one of each can be open at once. Stream `#9` is the file: `PRINT #9`
and `WRITE #9` write to the output file, `INPUT #9` and `LINE INPUT #9` read from the input file, and `EOF` is -1
at the end of the file (and when no input file is open). `CLOSEOUT` writes the last block, so close the output file
yourself. A file operation that fails raises error 24 (end of file), 27 (a file is open already), 31 (no file open)
or 32 (AMSDOS refused, and `DERR` has its error code: 146 for a file that is not found). Error 27 is for `OPENIN` or
`OPENOUT` while that stream is open; `LOAD`, `SAVE`, `CAT` and `CHAIN` abandon an open file instead (see "`LOAD`, `SAVE`, `CAT` and `CHAIN` with a file open" below).

<!-- example: firmware -->
```basic
DIM a$ AS STRING, n AS INTEGER

OPENOUT "DATA.TXT"
PRINT #9, "first line"
WRITE #9, "Ann", 42
CLOSEOUT                        ' always close an output file

OPENIN "DATA.TXT"
LINE INPUT #9, a$
PRINT a$
INPUT #9, a$, n
PRINT a$; n
PRINT EOF
CLOSEIN
PRINT DERR
```

`LOAD "name" [, address]` loads a binary file at the address you give (or the one in its AMSDOS header) and
`SAVE "name", B, address, length [, entry]` saves memory as a binary file; `SAVE "name"` and the types `A` and `P`
are error E279, because a compiled program has no BASIC text. `CAT` prints the disc's catalogue.
`CHAIN "name"` loads another binary over the running program and starts it at its entry address, as `RUN"` does;
`CHAIN MERGE` and `CHAIN "name", line` are error E981. `INPUT` and `LINE INPUT` also work on the text streams
`#1` to `#7` (firmware builds).

**Memory.** AMSDOS needs a 2 KB buffer for each stream that is open, and the program gives it directly under the
private block at &9E00: the input stream's (`OPENIN`, `LOAD`, `CAT`, `CHAIN`) at &9600-&9DFF, the output stream's
(`OPENOUT`, `SAVE`) at &8E00-&95FF (at &9600-&9DFF when the program uses no input stream).
A program that uses one of the two pays 2 KB, one that uses both 4 KB, and one that uses no file statement pays nothing.
The default heap ends below the buffers; if your code, data or `--heap-address` runs into them the compiler stops with
E405 or E406. The memory map is in [lib/README.md](lib/README.md).

**What happens to an open file when the program ends** (as Locomotive BASIC does, measured on the interpreter). `END`, and a program
that runs off its last line, close both files: the output file's last block is written, so a file you forgot to `CLOSEOUT` is
still on the disc. `STOP`, `ON BREAK STOP` and an error that nothing traps do not close anything, so an output file that is
still open then is never written (Locomotive leaves it open for `CONT` or a typed `CLOSEOUT`; a compiled program resets the machine,
which drops it). Close the file yourself before a `STOP` you mean to keep the data from.

**`LOAD`, `SAVE`, `CAT` and `CHAIN` with a file open** are not errors: they abandon the open files (the input file and the output file,
which is not written) and go on, as Locomotive does. The next `INPUT #9` or `PRINT #9` is then error 31.

## Bare-metal builds

A `-D CPC_BAREMETAL` build does not use the firmware, the ROMs or AMSDOS: it has its own text renderer,
graphics routines and 300 Hz handler. It does not do these things, and the compiler says so with error
E270 ("... needs the firmware and is not available in bare mode", the statement named) instead of building
a program that would fail. The one exception is the second colour of `INK` and `BORDER`: it compiles, and
the first colour is shown.

| Not in bare builds | What to use instead |
|---|---|
| Sound: `SOUND`, `ENV`, `ENT`, `RELEASE`, `SQ` | the music and sound-effects library, `#include <music/music.bas>` (`MusicInit`, `SfxPlay`, ...); `AyWrite` in `stdlib/cpc.bas` for the chip's registers. `BEEP` works. |
| Files: `OPENIN`, `OPENOUT`, `CLOSEIN`, `CLOSEOUT`, `#9`, `WRITE`, `EOF`, `DERR`, `LOAD`, `SAVE`, `CAT`, `CHAIN`, and `INPUT` or `LINE INPUT` on `#1` to `#7` | no AMSDOS in a bare build, so no replacement for a disc file: put the data in the program (`DATA`, initialised arrays, `#pragma hidata`) |
| Windows and streams: `WINDOW`, `WINDOW SWAP`, `TAG`, `TAGOFF`, `WIDTH`, `COPYCHR$`, and `#1` to `#8` on `PRINT`, `LOCATE`, `CLS`, `PEN`, `PAPER`, `POS`, `VPOS` | the one text window `#0`; for text at any position and in any font, the cpcbuild text library (`#include <cpcbuild/text.bas>`: `TextFont`, `TextPen`, `TextAt`) |
| `KEY`, `KEY DEF`, `SPEED KEY` | `INKEY(n)` and the keyboard scan of `cpcbuild/keyboard.bas` (`ScanKeys`, `KeyDown`) |
| Flashing inks: `SPEED INK`, and the second colour of `INK` | `INK n, c` shows the first colour only; change the colour yourself with `SetInk` (`stdlib/cpc.bas`) from the frame hook (`FrameHook`) |
| `ON BREAK STOP` | `ON BREAK CONT` compiles (it has nothing to do); test for ESC with `INKEY(66)` |
| `MASK`, `FILL`, the ink mode of `PLOT` and `DRAW`, the window of `ORIGIN`, the second argument of `GRAPHICS PEN` | no direct replacement; `FillRect` and `PutSprite` of the game library draw without the firmware |

Everything else in the groups above compiles in a bare build too, with these differences:

- `TIME` has a resolution of 1/50 s (the frame counter x 6).
- `INPUT` and `LINE INPUT` have a minimal line editor (characters, DEL, RETURN; no cursor keys, COPY or CLR).
- `CLEAR INPUT` has no key buffer to clear: a key held down at that moment counts as used.
- `SYMBOL AFTER` only moves the limit for `SYMBOL`.
- `LOCATE` past the width does not roll the screen when it wraps back from row 1.
- Overflow and Division by zero in REAL arithmetic stop the program (or are trapped); a firmware build prints the
  name and goes on (see "Errors").

[docs/keywords.md](docs/keywords.md) has the full table, one row for each statement.

## Errors

A run-time error without `ON ERROR GOTO` prints `Error n` (Locomotive's number, no name, no line) and stops. These
are the errors compiled code raises, with Locomotive's numbers:

| n | Name | Raised by |
|---:|---|---|
| 2 | Syntax error | `READ` of a non-number into a numeric variable; `MASK`, `FILL` and `GRAPHICS PEN ,m` on a CPC464 |
| 3 | Unexpected RETURN | `RETURN` with no `GOSUB` pending |
| 4 | DATA exhausted | `READ` past the last `DATA` |
| 5 | Improper argument | an argument out of range (`LOCATE 0, 1`, `ASC("")`, `ON -1 GOTO`, a stream the statement does not take) |
| 6 | Overflow | a REAL result too large, `CINT` of a value outside -32768..32767, `HEX$(65536)` |
| 7 | Memory full | a string that cannot be allocated; the table of `SYMBOL` |
| 11 | Division by zero | `/`, `\` or `MOD` by zero |
| 13 | Type mismatch | a `PRINT USING` field of the wrong type; a lone sign read as a number by `INPUT #9` |
| 15 | String too long | an `INPUT #9` item longer than 255 characters |
| 20 | Unexpected RESUME | `RESUME` outside an error handler |
| 1 to 255 | (yours) | `ERROR n` |

`ERROR` with any number outside 1 to 255 is error 5. The file statements raise 24 (EOF met), 27 (File already
open), 31 (File not open) and 32 (the disc refused: the code is in `DERR`); see "Files" above.

**Non-fatal errors.** In a firmware build, Overflow and Division by zero in REAL arithmetic (and in the functions)
without a handler print their name on the current line and the program goes on with plus or minus the largest REAL
(the argument itself for `LOG`), as Locomotive does. With `ON ERROR GOTO` the error is raised instead. Integer `\` and `MOD` by zero
and `CINT` outside its range are always fatal (or trapped). Bare builds raise all of them.

**`RESUME NEXT` after an error in the header of a compound statement** (the condition of `IF`, `WHILE`
or `DO`, the range of `FOR`, the subject of `SELECT`, the selector of `ON`) continues after the whole statement.
The interpreter continues inside it.

## Differences from the Locomotive interpreter

These are decisions, not bugs. Most are measured against the interpreter.

- **Number conversion.** Storing a REAL in an INTEGER wraps; there is no range check on each store. `i% = 40000.5`, a REAL stored under `DEFINT`, `40000 AND 255` and
  `CHR$(40000.5)` all wrap, where the interpreter stops with Overflow. `CINT` does raise Overflow outside -32768..32767.
- **`ERL`** is 0 for a statement on an unnumbered line. A `READ` of a non-number reports the line of the `READ`,
  where the interpreter gives the line of the `DATA`: the `READ` is the line to fix.
- **An untrapped error** prints `Error n`. **`ON BREAK STOP`** prints what `STOP` prints: a line end unless the cursor is at the left edge,
  then `Break in n` (`Break` on an unnumbered line) and a line end, and the program ends as `STOP` does (open files are left open, see "What happens to an open file").
- **`RANDOM`** is seeded from the clock at its first call, so it differs from run to run; `RANDOMIZE n` (and `RANDOMIZE` and `RND(-n)`) seed it
  too, so `RANDOMIZE 7` first makes it repeatable. `RANDOM` is the dialect's own: the interpreter has no `RANDOM`.
- **`VAL`** reads decimal numbers only for now: `VAL("&FF")` is 0 where the interpreter gives 255, and `VAL("-")` is 0 where it raises
  Type mismatch; `INPUT #9` reads its numbers the same way (a known issue, not fixed yet). `INPUT` from the keyboard does read `&`, `&H` and `&X` numbers.
- **`INPUT`** does not send the characters you type to the printer; the prompt, the `? ` and the line end go there.
- **`LINE INPUT`** prints its `? ` as the 6128 does, on both models (the 464's BASIC prints none for `LINE INPUT`
  without a prompt).
- **A handler that leaves with `GOTO`** (an `EVERY` or `AFTER` handler, or an `ON ERROR` handler) never reaches its
  `RETURN`, so the timer's priority stays in force and timers of lower or equal priority stop. Locomotive does the same.
- **On a CPC464**, a compiled program runs some statements its own BASIC lacks: the ink mode of `PLOT` and
  `DRAW`, `FRAME` and `CLEAR INPUT`. `MASK`, `FILL` and the second argument of `GRAPHICS PEN` are the exceptions: they raise error 2 there.

## Not yet compiled

These give an error today (E002 "is not implemented yet", or E981 "is not in 1.0"):

- `SPEED WRITE`
- the second argument of `PEN`
- `|` calls (RSX)
- `CHAIN MERGE`, `CHAIN "name", line`, `RUN "name"`, `MERGE`, `ON BREAK GOSUB`, `ON SQ GOSUB`, `CURSOR`, `CLEAR`
  and `ERASE` (error E981, "is not in 1.0")

The game library covers some of this in assembly: `SetInk`, `SetBorder`,
`SoundQueue`, `WaitRetrace` and the keyboard scan (see `lib/README.md`).

## The library

`lib/` holds the runtime and a ready-made game library: fast sprites, tiles,
fill, double buffering, keyboard scan, palettes, text, extra RAM banks, the
Plus hardware sprites and the Arkos Tracker 3 music player. A program uses it
with one line:

```basic
#include <cpcbuild.bas>
```

See [lib/README.md](lib/README.md) for what each file offers.

## Migrating from Boriel BASIC

`cpcbas migrate` turns a Boriel BASIC project (the dialect CPCBuild 0.1.x compiled) into CPC BASIC. It
rewrites what can be rewritten without changing a program's meaning (`$FF` to `&FF`, `bAND` to `AND`,
`ENDIF` to `END IF`, slices to `MID$`, names that are keywords now to `name_`) and reports everything else
with the file, line, column and what to do. It never edits a string or a comment.

```
node packages/cpcbas/dist/bin/cpcbas.js migrate game/                 # report only
node packages/cpcbas/dist/bin/cpcbas.js migrate -o game-cpc/ game/    # write the translated copy
node packages/cpcbas/dist/bin/cpcbas.js migrate --check game-cpc/     # exit 1 if anything is left to do
```

Migrate one program at a time (the files of a folder are one project). Flags W720-W725 must be fixed by
hand before the program builds; W726-W739 are places where valid CPC BASIC means something different
from what the Boriel program meant. [docs/migrate.md](docs/migrate.md) has every rule, the report format
and the library renames. The same translator is the library call `migrate(files, options)`.

## Conformance programs

`tests/conformance/` holds self-checking programs that run on an emulated CPC;
see [tests/conformance/README.md](tests/conformance/README.md).

## Development

Node 22 or later. From the repository root:

```
npm install
npm test            # vitest
npm run typecheck   # the library alone (no Node types) and everything
npm run lint
npm run build       # packages/cpcbas/dist
```

Plans, task lists and the decisions the language reference leaves open are kept
in the maintainers' private notes.
