# Migrating from Boriel BASIC: the `cpcbas migrate` rules

CPCBuild 0.1.x compiled programs with a fork of Boriel BASIC. CPC BASIC keeps most of that dialect
(`SUB`, `FUNCTION`, `DIM ... AS UBYTE`, `=> {}` tables, `ASM` blocks, `#include`, `FASTCALL`, `@`,
`CAST`, `PRINT AT`) and changes the rest towards Locomotive BASIC. `cpcbas migrate` turns a Boriel
BASIC project into CPC BASIC: it **rewrites** what can be rewritten without changing the program's
meaning, and **flags** everything else with the file, line, column, the reason and what to do.

This page is the rule list. Every rule has a code: W700-W719 are rewrites, W720-W725 are must-fix
flags, W726-W739 are review flags (`packages/cpcbas/src/core/codes/migrate.ts` holds the same table).

## Using it

    cpcbas migrate [--check] [--from auto|boriel] [--report text|json] [-o DIR | --in-place] [--rename OLD=NEW]...
                   [-D NAME[=VALUE]]... [--runtime DIR] [--main FILE]... [--no-compile] PATH...

- `PATH` is a `.bas` file or a folder (every `.bas` file below it). The files are migrated together
  as one project, so a name renamed in one file is renamed in every file that uses it. Give it one
  program at a time: a folder of unrelated programs is one project, and a name one program declares
  is then renamed in the others (a procedure's own parameters and locals are renamed only inside it).
- Without `-o` or `--in-place` nothing is written: the report says what would change.
- `--check` writes nothing and exits 1 when a file would change or a must-fix flag (W720-W725) is
  raised. Review flags are not reported under `--check`: they describe differences in meaning that a
  person has to look at once, and CPC BASIC code raises them too.
- The compile check (W725, W737) compiles each main file of the translated project: every `.bas` no
  other file includes, or the files given with `--main`. `-D` passes the compiler's defines
  (`-D CPC464`), `--runtime DIR` the runtime library (default: the repo's `lib/`), `--no-compile` skips
  the check. A program that builds only for one configuration (a bare-metal helper) needs its define.
- In CPC Game Studio, "Convert Project to CPC BASIC" runs the same translator over the project and
  shows the report before it writes anything.
- From a program: `migrate(files, options)` in `@cpcbuild/cpcbas` takes a map of path to text and
  returns the new texts and the report. It reads no files itself, so it also runs in a browser.

Running it twice changes nothing the second time. A file that is not UTF-8 is left as it is, with a W725 finding ("not UTF-8: left unchanged"): a string or comment with a Latin-1 byte would otherwise be written back with U+FFFD.

### Boriel or CPC BASIC?

Most rules match only Boriel syntax that CPC BASIC rejects (`$FF`, `bAND`, `ENDIF`, `CHR$ 13`, slices), so they never fire
on CPC BASIC. Three rewrites change code that is valid in both dialects and means something else in each: W705
(`ON n GOTO`), W713 (`UBOUND(a)`) and W715 (`DRAW dx, dy`). They apply only to a run that is Boriel BASIC:

- `--from boriel` (the Studio's Convert command passes it on the first conversion of a project): always.
- `--from auto` (the default): when any other rewrite applied in any file of the run. A rewrite never survives into the
  output, so a second run over the output finds no Boriel syntax and reads it as CPC BASIC. Must-fix flags do not count: the
  construct they name is still in the output. A Boriel project with none of the Boriel-only forms needs `--from boriel`.
- In a run read as CPC BASIC, each of those three forms (`ON n GOTO`, `UBOUND(a)`, `DRAW dx, dy`) gets the review flag W727
  instead of a rewrite, and the report's summary says to run again with `--from boriel` if the file is Boriel BASIC. Run `--from
  boriel` once on the original files; to check later, use `--check`, which never rewrites. The summary line says which way the run
  was read.
- W738 and W739 (case, mixed signs) are raised only in a run read as Boriel.

Names follow the same idea: a reserved word is renamed (W702) only when the project declares it as a name of its own, and
`CODE`, `LN`, `IN`, `CHR`, `STR` or `WaitVsync` are respelled (W707, W712) only when it does not.

## What it never does

- It never edits a string literal or a comment, and never inserts a comment of its own (no
  `' MIGRATE:` markers): the report is the list of things to look at.
- Inside `ASM ... END ASM` it changes only references to BASIC names (W702, W703); the assembler
  dialect is unchanged, so `$FF` and `ld a, (ix+4)` stay as they are. A file of the run that an `ASM` block
  includes (`#include "mux.inc"` between `ASM` and `END ASM`, and the files it includes) is read the same way,
  whatever its name: `in a, (c)` stays.
- It never guesses: where a rewrite would depend on a value it cannot know (a colour that depends on the
  screen mode, a coordinate, the sign of a dividend) it flags instead.

## The report

Text, one line per finding, as the compiler prints diagnostics. Line and column are those of the
input file (W725: of the translated file). Rewrites are notes, flags are warnings:

    game.bas:12:7: note W700: Boriel number literal rewritten: $C000 -> &C000
    game.bas:40:3: warning W728: A comparison used as a number is -1 when true
      hint: Boriel gave 1, CPC BASIC (as Locomotive BASIC) gives -1. Use -(a > b) or ABS(a > b) where 1 is needed.

followed by a summary: files read, files changed, and a count per code. `--report json` prints one
object: `{ "version": 1, "files": [{ "path", "changed", "diagnostics": [...] }], "summary": {...} }`,
each diagnostic in the compiler's `--diagnostics json` shape (`file`, `line`, `col`, `endLine`,
`endCol`, `severity` (`note` or `warning`), `code`, `message`, `hint`).

## Rewrites (W700-W719)

| Code | Boriel | CPC BASIC |
|---|---|---|
| W700 | `$FF`, `0FFh`; `%0101`, `0101b`, `BIN 0101` | `&FF`; `&X0101`. Not after a letter, digit, `_` or `$` (so `STR$` and `a$` stay); in `#pragma` and `#define` lines too; never inside `ASM`. `&FF`, `&HFF`, `&X0101` and `0xFF` are CPC BASIC and stay |
| W701 | `bAND`, `bOR`, `bXOR`, `bNOT` | `AND`, `OR`, `XOR`, `NOT` (both bitwise, so the meaning is the same) |
| W702 | a variable, array, constant, label, parameter, SUB or FUNCTION named with a word that is a keyword now (`frame`, `inp`, `line`, `time`, `pen` ...): the project declares it (`DIM`, `CONST`, `SUB`, `FUNCTION`, a parameter, a `FOR` variable, a label, the target of an assignment) | renamed to the word followed by `_` (`frame_`), or to the name the caller chose (`renames` option); every use in every file of the run, and `_name` inside `ASM` blocks. A parameter or a local is renamed only inside its procedure, so `Mode 1` outside it stays the statement. A keyword the project does not declare (`FRAME`, `MODE 1`) is the statement and stays. A label named with a keyword (`frame:`) is not seen as a declaration. The list of words is below |
| W703 | in `ASM`: `_arr`, `_arr.__DATA__` (an array), `_s` (the string `s$`), `_n` (`n%`), `_r` (`r!`) | `_arr__a`, `_arr__a.__DATA__`, `_s__s`, `_n__i`, `_r__r`: the labels CPC BASIC gives those variables. Scalars without a suffix, SUBs and FUNCTIONs keep `_name` |
| W704 | a `RETURN` with no value in a `SUB` (or `FUNCTION`) that has no `GOSUB` | `EXIT SUB` (`EXIT FUNCTION`), in the case of the `RETURN` it replaces. A procedure with a `GOSUB` is left alone: a bare `RETURN` there may end the GOSUB |
| W705 | `ON n GOTO a, b, c` (and `GOSUB`), counted from 0; a Boriel run only | `ON n + 1 GOTO a, b, c` (`ON (expr) + 1 ...` when the index is not a single name; a whole parenthesised index keeps its parentheses; a literal is added up: `ON 1 GOSUB ...` is `ON 2 GOSUB ...`). `ON ERROR` and `ON BREAK` are not touched |
| W706 | `a$(2 TO 4)`, `a$(TO 3)`, `a$(5 TO)`, `a$(i)` of a string that is not an array, `CODE(name(i TO i))` | `MID$(a$, 3, 3)`, `LEFT$(a$, 4)`, `MID$(a$, 6)`, `MID$(a$, i + 1, 1)`, `ASC(MID$(name, i + 1, 1))`. Literal positions are added up; otherwise `a$(i TO j)` is `MID$(a$, i + 1, j - i + 1)`. Any name declared `AS STRING` counts, with or without `$`. A string array is told from a string by the file's own declarations first, then the project's |
| W707 | `CODE`, `LN`, `IN`, `CHR`, `STR` used as functions, `SHL`, `SHR` as operators (and not declared by the project as names) | `ASC`, `LOG`, `INP`, `CHR$`, `STR$`, `<<`, `>>` |
| W708 | a built-in function without parentheses: `CHR$ 13`, `PEEK 23560`, `LEN a$`, `CODE k$`, `SIN x`, and `TAB 5` in a `PRINT` | `CHR$(13)`, `PEEK(23560)`, `LEN(a$)`, `ASC(k$)`, `SIN(x)`, `TAB(5)`. The argument is one operand (a number, a name with its subscripts, a parenthesised expression, with a leading minus), as Boriel read it; anything longer is flagged W725 by the compile check |
| W709 | `ENDIF`, `END WHILE` | `END IF`, `WEND` |
| W710 | `#pragma push(case_insensitive)`, `#pragma pop(case_insensitive)`, `#pragma case_insensitive = TRUE` | the line is removed (CPC BASIC is always case-insensitive). Other pragmas (`org`, `heap_size`, `hidata`, `explicit`) are kept |
| W711 | `INK n` with one argument (the text colour) | `PEN n`, and W730 asks to check the number |
| W712 | `WaitVsync` or `WaitVsync()`, when the project does not define a `WaitVsync` of its own | `FRAME` |
| W713 | `UBOUND(a)`, `LBOUND(a)`; a Boriel run only | `UBOUND(a, 0)`, `LBOUND(a, 0)`: without a dimension Boriel returned the number of dimensions, CPC BASIC returns the bound of dimension 1 |
| W714 | `DIM a(0 TO n)` (each dimension) | `DIM a(n)`. Another lower bound is W723 |
| W715 | `DRAW dx, dy` (two arguments: an offset); a Boriel run only | `DRAWR dx, dy`, and W731 asks to check the units |
| W716 | `BRIGHT n`, `FLASH n`, `BOLD n`, `ITALIC n` (statements, or items in a `PRINT`, `PLOT`, `DRAW` or `CIRCLE`) | removed: they had no effect in CPCBuild 0.1.x |
| W717 | `#include <point.bas>` | removed: `POINT(x, y)` is built in, with the same meaning |
| W718 | `CHR$(a, b, c)` | `CHR$(a) + CHR$(b) + CHR$(c)` |
| W719 | `POKE UINTEGER a, v` (a typed `POKE` with no comma after the type) | `POKE UINTEGER, a, v`. The compiler reports E141 on the Boriel form |

### Words that are reserved now (W702)

A Boriel program may use these as names; in CPC BASIC they are keywords (the compiler reports E152
for them). The translator computes the list from the language's keyword table (the reserved words
that were not keywords in Boriel BASIC), so it follows the compiler's version. Today it is:

`AFTER ASC BIN$ BREAK CALL CASE CAT CHAIN CINT CLEAR CLG CLOSEIN CLOSEOUT COPYCHR$ CREAL CURSOR DEC$
DEF DEFINT DEFREAL DEFSTR DEG DERR DI DRAWR EI ENT ENV EOF ERASE ERL ERR EVERY FILL FIX FN FRAME FRE
GRAPHICS HEX$ HIMEM INP INPUT INSTR IS JOY KEY LEFT$ LINE LOCATE LOG LOG10 LOWER$ MASK MAX MEMORY
MERGE MID$ MIN MODE MOVE MOVER OPENIN OPENOUT OPTION ORIGIN PEN PLOTR POINT POS RAD RANDOM REAL
RELEASE REM REMAIN RESUME RIGHT$ ROUND RUN SELECT SOUND SPACE$ SPC SPEED SQ STRING$ SWAP SYMBOL TAG
TAGOFF TEST TESTR TIME UNT UPPER$ USING VPOS WAIT WIDTH WINDOW WRITE XPOS YPOS ZONE` (105 words; `REM`
is a comment in both dialects, so it is never a name).

Not renamed, because the Boriel program did not name something of its own with them:

- `Mode n` and `Mode(n)` as a statement: the library's `Mode` is the `MODE` statement now, which does
  the same (switch the mode and clear the screen). A SUB or variable the program itself calls `Mode`
  is renamed.
- `point(x, y)` when the program includes `<point.bas>` (W717 removes the include).
- `pos`, `input`, `csrlin`: when the program includes the Boriel library file that defines them,
  they are flagged (W722), not renamed.

### The library's own renames

The BASIC library (`#include <cpcbuild.bas>` and the files below it) kept its SUBs and FUNCTIONs,
with these changes:

| Boriel library | CPC BASIC | What the translator does |
|---|---|---|
| `Mode n` (`<cpc.bas>`) | the statement `MODE n` | nothing (see above) |
| `WaitVsync` | the statement `FRAME` | W712 |
| parameter `pen` of `PenByte`, `FillRect`, `ClearScreen`, `SetPalette12`, `SetInk` | `penNo` | nothing: calls are positional |
| parameter `key` of `KeyDown` | `keyNo` | nothing |
| parameter `line` of `SplitScreen`, `SplitScreenCrtc`, `RasterIntAt`, `RasterIntOff` | `scanLine` | nothing |

`GetMode`, `SetInk`, `SetBorder`, `AyWrite`, `AyRead`, `SoundQueue`, `SoundFree`, `SoundBusy`,
`SoundEnvelope` and `SoundStop` (`<cpc.bas>`) and `<framehook.bas>` are unchanged.

## Must-fix flags (W720-W725)

The file does not build, or builds wrongly, until a person changes these. `--check` fails on them.

| Code | Raised on | What to do |
|---|---|---|
| W720 | `INK`, `PAPER`, `INVERSE` or `OVER` as an item inside `PRINT`, `PLOT`, `DRAW` or `CIRCLE` (`PRINT AT 2, 0; INK 3; "x"`). `BRIGHT` and `FLASH` items are removed by W716 | set `PEN`/`PAPER` before the statement and restore them after it; `PLOT x, y, pen` takes the pen as its third argument. (`PRINT OVER 1; ...` would otherwise compile as a variable called `OVER`.) |
| W721 | the statements `OVER n`, `INVERSE n`; the functions `ATTR`, `SCREEN$`, `USR`, `ACS`, `ASN`; `VERIFY` | `OVER 1`: the ink mode of `PLOT`/`DRAW` (`GRAPHICS PEN n, 1`, firmware builds only); `INVERSE`: swap `PEN` and `PAPER`; `SCREEN$(r, c)`: `LOCATE c + 1, r + 1` then `COPYCHR$(#0)`; `USR "a"`: `SYMBOL`; `USR addr`: `CALL addr`; `ACS`, `ASN`: no built-in, write them with `ATN` |
| W722 | `#include` of a Boriel library file that CPC BASIC does not have, and the functions it defined (below). An include inside `#ifdef __ZX48K__` (code the CPC never builds) is not flagged | the replacement in the table below |
| W723 | an assignment to a slice (`a$(2 TO 4) = "xy"`), `a$(i)` where `a$` may be an array, `DIM a(1 TO n)` | the `MID$` statement or function with 1-based positions; arrays start at 0, so shift the indices |
| W724 | `#pragma array_base`, `#pragma string_base`, `#pragma zxnext` | remove; arrays start at 0 and `MID$` counts from 1 |
| W725 | an error the compiler reports on the translated program (a compile of each main with the runtime, `-D` defines and the include path of the run): the message names the error code, such as E152 for a reserved word used in a way the translator did not see, E141 for a form Boriel wrote differently, or E239 for a `FUNCTION` called as a statement (Boriel allows it; assign the result). Line and column are those of the translated file | fix by hand and run `cpcbas --parse-only` again |

Boriel library files (W722):

| `#include` | CPC BASIC |
|---|---|
| `<pos.bas>` (`pos()`), `<csrlin.bas>` (`csrlin()`) | `POS(#0)` and `VPOS(#0)`, which count from 1 (the Boriel functions counted from 0) |
| `<input.bas>` (`input(n)`) | `LINE INPUT a$` (no length limit) or `INPUT` |
| `<keys.bas>` (`GetKey`, `MultiKeys`, `GetKeyScanCode`) | `INKEY$` (a typed key), `INKEY(n)` with the `KEY_` constants, or the library's `KeyDown(keyNo)` |
| `<screen.bas>` (`screen(r, c)`) | `LOCATE c + 1, r + 1` then `COPYCHR$(#0)` |
| `<font.bas>` (`SetFont`) | `SYMBOL AFTER 32` and `SYMBOL` |
| `<attr.bas>` | none: the CPC has no attributes |
| `<alloc.bas>`, `<play.bas>`, `<print42.bas>`, `<print64.bas>`, `<sinclair.bas>` and any other file that neither the project nor the CPC BASIC library has | none in CPC BASIC; the program's own copy of the code, or the library's music player for `PLAY` |

## Review flags (W726-W739)

Valid CPC BASIC whose meaning differs from what the Boriel program meant. Each is raised where the
difference can matter; read the line and decide. They are reported by a migration run, not by
`--check`.

| Code | Raised on | The difference |
|---|---|---|
| W726 | a `DIM` with a constant initial value inside a loop in a procedure | assigned each time the `DIM` is reached; Boriel assigned it once on entry |
| W727 | in a run read as CPC BASIC: `ON n GOTO` and `GOSUB`, `UBOUND(a)` and `LBOUND(a)` with no dimension, `DRAW x, y` (two arguments) | counts from 1 (Boriel from 0); the bound of dimension 1 (Boriel: the number of dimensions); goes to the point (Boriel: moved by an offset, which is `DRAWR`). A Boriel run rewrites them (W705, W713, W715) instead |
| W728 | a comparison anywhere but the condition of `IF`, `ELSEIF`, `WHILE`, `UNTIL`, `DO`/`LOOP` or a `CASE` (`x = a > b`, `PRINT a = b`, `n = n + (k = 3)`) | true is -1, not 1 |
| W729 | `AND`, `OR`, `XOR` or `NOT` with an operand that is not a comparison (`IF x AND y`, `IF NOT done`, `z = a OR b`). Not raised for `bAND`, `bOR`, `bXOR`, `bNOT`, which were bitwise already | Boriel's were logical (1 AND 2 is true); CPC BASIC's are bitwise (1 AND 2 is 0, NOT 5 is -6). Between comparisons nothing changes |
| W730 | `PEN` (from W711), `PAPER` and `BORDER` statements | 0.1.x took the Spectrum colours 0-7 and mapped them to the pen of the mode whose default colour was nearest; `PEN` and `PAPER` take pens, `BORDER` a firmware colour (0-26). In mode 1, Spectrum colours 0 and 1 were pen 0, 2 and 3 pen 3, 4 and 5 pen 2, 6 and 7 pen 1 |
| W731 | `PLOT`, `DRAW`, `DRAWR` | 640 x 400 units in every mode, not the mode's pixels: a mode 1 pixel (x, y) is (2x, 2y), mode 0 (4x, 2y), mode 2 (x, 2y). `DRAW x, y, n` (an arc in Boriel) draws a line in pen `n`. `CIRCLE` and `POINT` keep the mode's pixels |
| W732 | `STR$` | a number that is not negative gets a leading space (`" 5"`) |
| W733 | `PRINT` of a number, `PRINT` with `,`, `TAB` (one finding per statement) | a number prints with a sign position and a trailing space; a comma moves to the next 13-column zone (not half the screen); `TAB(n)` counts from column 1 |
| W734 | `INKEY$` | it returns the next key from the key buffer, not the key held now: use `INKEY(n)` or `KeyDown` for "is it down" |
| W735 | `MOD`, or `/` and `\` by a literal power of two (2, 4, 8 ...), whose dividend is not a literal and not declared (or cast) `UBYTE`, `UINTEGER` or `ULONG`. `/` is not flagged for a `FIXED` or `FLOAT` dividend | `MOD` takes the dividend's sign: `-7 MOD 3` is -1. Boriel shifted for `/` by a power of two (`-7 / 2` was -4, rounded down); CPC BASIC divides and truncates (-3) |
| W736 | `READ` into a string when an unquoted number is among the program's `DATA` items | the string gets the item's text (`"-30"`); Boriel gave `""` |
| W737 | each variable without a suffix that is used without a `DIM` (the compiler's W300 on the translated program, found by compiling to the IR: the binder runs there, not in `--parse-only`), or DIMmed without `AS type` (`DIM a = 5`) | it is an `INTEGER`. Boriel guessed the type from the first use: `UBYTE` for `FOR b = 1 TO 10`, `BYTE` for `FOR a = -1 TO 10`, `FIXED` for `a = 3.5`, `FLOAT` for `a = PI` or `DIM a = 5`. So `a = 3.5` now stores 3, and `a = PI` stores 3. (`/` between two integers divides integers in both dialects; what changes is the type of the variable that receives the result.) |
| W738 | in a run read as Boriel: names of the project (variables, arrays, SUBs, FUNCTIONs, parameters, labels) that differ only in letter case (`DIM eX(3)` and `ex`); one finding at the first use of each spelling. Words between `#pragma case_insensitive = TRUE` and its `pop` (or `= FALSE`, or the end of the file) do not count | Boriel told `score` from `Score`; CPC BASIC does not. Two names that clash are also W725 (E202); a declared name and an undeclared one silently become one variable. Rename one of them |
| W739 | in a run read as Boriel, found from the checked translated program (so only with the compile check): a comparison of a `UINTEGER` with an `INTEGER` (neither a constant); an `INTEGER` `+`, `-` or `*` with a literal from 256 to 65535 and an unsigned (`UBYTE` or `UINTEGER`) operand, whose result reaches a comparison, a division, a `PRINT` or `STR$`, or is widened to `LONG`, `ULONG`, `FIXED` or `REAL` (`256 * PEEK(a)`, `n * 256 + k`) | Boriel cast a `UINTEGER` met with an `INTEGER` to signed (`40000 > 100` was false); CPC BASIC compares the values (true). Boriel typed a literal 256-65535 `UINTEGER`, CPC BASIC types it `INTEGER`, so `256 * PEEK(a)` is negative from 32768 up. Stored straight into a `UINTEGER` it keeps its bits. Widen first: `CAST(UINTEGER, PEEK(a)) * 256` |

## Differences not flagged yet

What the translator still does not see (the review flags above are a net, not a proof):

- **W739 follows the value only through one expression.** An `INTEGER` product stored in a variable and compared, printed or
  widened later is not found. Other pairs of types (a `UBYTE` and a `BYTE`) are not compared.
- **W735's dividend** is known unsigned only for a name declared `UBYTE`, `UINTEGER` or `ULONG`, a `CAST` to one of them or a
  literal. A function result or an expression of unsigned names is flagged as signed (a false alarm where the values never go
  negative).
- **W738 does not see ASM and preprocessor lines:** a macro or an ASM label that differs only in case is not reported.

## Unchanged

These need nothing: `PRINT AT y, x` (0-based, row first), `CLS`, `BEEP`, `PAUSE n` (and `PAUSE 0`, which still waits for a key), `CIRCLE`,
`POINT`, `RANDOMIZE`, `RND`, `GO TO` and `GO SUB` (accepted), line numbers and labels, `DIM ... AS type`,
`DIM ... => {...}`, `DIM ... AT`, `CONST`, `SUB`, `FUNCTION` (with or without parentheses), `FASTCALL`,
`BYREF`/`BYVAL`, `EXIT`/`CONTINUE`, `DO ... LOOP`, `WHILE ... WEND`, `SELECT CASE`, `@name`, `CAST`, typed
`PEEK(UINTEGER, a)` and `POKE(UINTEGER, a, v)` (a `POKE UINTEGER a, v` is W719), block comments, `_` line continuation, `#include` of the project's own files and of the
CPC BASIC library, `#define`, `#ifdef`, `#require`, `#init`, and the `ASM` dialect.

Code under `#ifdef __ZX48K__` (the Spectrum builds) is translated like the rest but never compiled:
remove it when the project no longer builds for the Spectrum.
