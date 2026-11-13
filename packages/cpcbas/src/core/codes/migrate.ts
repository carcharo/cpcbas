/**
 * Codes 700-739: `cpcbas migrate`, the Boriel BASIC to CPC BASIC translator (docs/migrate.md has the
 * rule list with examples; this table is its index). 740-749 are kept free for CPC Game Studio.
 *
 * - W700-W719 **rewrites**: the translator changes the text. Reported with severity `note` (one per
 *   change), so a report reads as a list of what was done.
 * - W720-W725 **must-fix flags**: the input holds something CPC BASIC does not have, or that the
 *   translator could not rewrite; the file will not build, or will build wrongly, until a person changes it.
 *   `migrate --check` fails on them.
 * - W726-W739 **review flags**: valid CPC BASIC whose meaning differs from what the Boriel program
 *   meant (number text, truth values, colours, coordinates ...). Reported on a migration run only:
 *   `migrate --check` neither reports them nor fails on them, because they fire on CPC BASIC as well.
 *
 * Every entry is a warning (`W`): migrate never reports an error code of its own (a file it cannot read is
 * the CLI's usage error). W725 carries the compiler's own error code in its message.
 */
import type { CodeTable } from '../diagnostics.js';

export const MIGRATE_CODES = {
  // ---- rewrites (W700-W719)
  W700: {
    severity: 'warning',
    title: 'Boriel number literal rewritten',
    hint: 'Hex is &FF (or &HFF, 0xFF) and binary &X0101 in CPC BASIC; $FF, 0FFh, %0101, 0101b and BIN 0101 are Boriel forms.',
  },
  W701: { severity: 'warning', title: 'bAND, bOR, bXOR or bNOT rewritten', hint: 'AND, OR, XOR and NOT are bitwise in CPC BASIC.' },
  W702: {
    severity: 'warning',
    title: 'A name that is now a reserved word was renamed',
    hint: 'Every keyword of CPC BASIC is reserved, the Locomotive BASIC ones included; the name was renamed everywhere it is used, ASM blocks included.',
  },
  W703: {
    severity: 'warning',
    title: 'An ASM reference to a BASIC variable now uses the CPC BASIC label',
    hint: 'Arrays are _name__a (elements _name__a.__DATA__), and suffixed variables _name__s ($), _name__i (%) and _name__r (!).',
  },
  W704: {
    severity: 'warning',
    title: 'A bare RETURN in a SUB or FUNCTION became EXIT SUB or EXIT FUNCTION',
    hint: 'A RETURN alone ends a GOSUB in CPC BASIC; a procedure is left with EXIT SUB or EXIT FUNCTION.',
  },
  W705: {
    severity: 'warning',
    title: 'ON ... GOTO or ON ... GOSUB now counts from 1',
    hint: 'Boriel counted the targets from 0, CPC BASIC (as Locomotive BASIC) from 1, so the index gained + 1.',
  },
  W706: {
    severity: 'warning',
    title: 'A string slice became MID$, LEFT$ or ASC(MID$(...))',
    hint: 'Slices counted from 0; MID$ counts from 1, so a$(2 TO 4) is MID$(a$, 3, 3).',
  },
  W707: {
    severity: 'warning',
    title: 'A Boriel function or operator spelling rewritten',
    hint: 'CODE is ASC, LN is LOG, IN is INP, CHR and STR are CHR$ and STR$, SHL and SHR are << and >>.',
  },
  W708: {
    severity: 'warning',
    title: 'Parentheses added to a function call',
    hint: 'A built-in function takes its argument in parentheses: CHR$(13), PEEK(23560), LEN(a$).',
  },
  W709: { severity: 'warning', title: 'ENDIF or END WHILE rewritten', hint: 'CPC BASIC writes END IF and WEND.' },
  W710: {
    severity: 'warning',
    title: 'A case_insensitive pragma was removed',
    hint: 'CPC BASIC is always case-insensitive, so #pragma push/pop(case_insensitive) and #pragma case_insensitive have no use.',
  },
  W711: {
    severity: 'warning',
    title: 'INK n (the text colour) became PEN n',
    hint: "INK n, c sets a palette colour in CPC BASIC; the text colour is PEN n. Check the number too (W730).",
  },
  W712: { severity: 'warning', title: 'WaitVsync became FRAME', hint: 'FRAME waits for the frame flyback.' },
  W713: {
    severity: 'warning',
    title: 'UBOUND or LBOUND without a dimension got dimension 0',
    hint: 'Without a dimension, Boriel returned the number of dimensions, which is dimension 0; CPC BASIC returns the bound of dimension 1.',
  },
  W714: {
    severity: 'warning',
    title: 'DIM a(0 TO n) became DIM a(n)',
    hint: 'Arrays always start at 0 in CPC BASIC; write the highest index.',
  },
  W715: {
    severity: 'warning',
    title: 'DRAW dx, dy (relative) became DRAWR dx, dy',
    hint: "Boriel's DRAW moved by an offset; CPC BASIC's DRAW goes to a point, DRAWR moves by an offset. Check the units too (W731).",
  },
  W716: {
    severity: 'warning',
    title: 'BRIGHT, FLASH, BOLD or ITALIC was removed',
    hint: 'They had no effect on the CPC and CPC BASIC does not have them.',
  },
  W717: {
    severity: 'warning',
    title: '#include <point.bas> was removed',
    hint: 'POINT(x, y) is built into CPC BASIC with the same meaning (the pen of a pixel, in the mode\'s pixels).',
  },
  W718: {
    severity: 'warning',
    title: 'CHR$ with several arguments became a concatenation',
    hint: 'CHR$ takes one argument: CHR$(a, b) is CHR$(a) + CHR$(b).',
  },
  W719: {
    severity: 'warning',
    title: 'A typed POKE got a comma after the type',
    hint: 'CPC BASIC writes POKE type, address, value (POKE UINTEGER, a, v); Boriel wrote POKE type address, value.',
  },

  // ---- must-fix flags (W720-W725): migrate --check fails on them
  W720: {
    severity: 'warning',
    title: 'A Spectrum attribute inside a statement',
    hint: 'CPC BASIC has no temporary INK, PAPER, INVERSE, OVER, BRIGHT or FLASH items: set PEN and PAPER before the PRINT, give PLOT and DRAW the pen as their third argument, and restore them afterwards.',
  },
  W721: {
    severity: 'warning',
    title: 'A Sinclair statement or function that CPC BASIC does not have',
    hint: 'OVER: the ink mode of PLOT and DRAW (GRAPHICS PEN n, 1); INVERSE: swap PEN and PAPER; ATTR: none; SCREEN$: LOCATE, then COPYCHR$(#0); USR "a": SYMBOL; USR address: CALL; ACS, ASN and VERIFY: none.',
  },
  W722: {
    severity: 'warning',
    title: 'A Boriel library file or function that CPC BASIC does not have',
    hint: 'The message names the replacement: POS and VPOS for pos and csrlin, LINE INPUT for input(n), INKEY(n) and the KEY_ constants for keys.bas, SYMBOL and SYMBOL AFTER for font.bas.',
  },
  W723: {
    severity: 'warning',
    title: 'A string slice or array bound the translator cannot rewrite',
    hint: 'Assignments to a slice, a single-index slice of a name that may be an array, and DIM bounds that do not start at 0 need a person: MID$ (statement or function) and 0-based indices.',
  },
  W724: {
    severity: 'warning',
    title: 'A #pragma that CPC BASIC does not have',
    hint: 'array_base, string_base and zxnext have no CPC BASIC meaning: arrays and strings start at 0 (MID$ at 1), and the target is the CPC.',
  },
  W725: {
    severity: 'warning',
    title: 'The translated program does not compile yet',
    hint: 'The message carries the compiler\'s error; fix it by hand (cpcbas --parse-only checks again).',
  },

  // ---- review flags (W726-W739): reported on a migration run, never by --check
  W726: {
    severity: 'warning',
    title: 'A local DIM with a constant initial value inside a loop',
    hint: 'CPC BASIC assigns the value each time the DIM is reached; Boriel assigned a constant once on entry to the procedure. Move the DIM before the loop if the old behaviour was meant.',
  },
  W727: {
    severity: 'warning',
    title: 'A form whose meaning differs in Boriel BASIC, in a file read as CPC BASIC',
    hint: 'ON n GOTO counts from 1, UBOUND(a) and LBOUND(a) are the bounds of dimension 1, and DRAW x, y goes to a point in CPC BASIC; Boriel counted from 0, returned the number of dimensions and moved by an offset. If this file is Boriel BASIC, run again with --from boriel.',
  },
  W728: {
    severity: 'warning',
    title: 'A comparison used as a number is -1 when true',
    hint: 'Boriel gave 1, CPC BASIC (as Locomotive BASIC) gives -1. Use -(a > b) or ABS(a > b) where 1 is needed.',
  },
  W729: {
    severity: 'warning',
    title: 'AND, OR, XOR or NOT on a value that is not a comparison',
    hint: 'Boriel\'s AND, OR and NOT were logical (any non-zero value is true); in CPC BASIC they are bitwise, so 1 AND 2 is 0 and NOT 5 is -6. Compare explicitly: (x <> 0) AND (y <> 0).',
  },
  W730: {
    severity: 'warning',
    title: 'A colour number in INK, PEN, PAPER or BORDER',
    hint: 'CPCBuild 0.1.x mapped the Spectrum colours 0-7 to pens of the mode; now PEN and PAPER take pen numbers and BORDER a firmware colour 0-26.',
  },
  W731: {
    severity: 'warning',
    title: 'PLOT and DRAW coordinates are Locomotive units',
    hint: 'PLOT, DRAW and DRAWR take 640 x 400 units in every mode (a mode 1 pixel x, y is 2x, 2y); CIRCLE and POINT keep the mode\'s pixels. DRAW x, y, n has a pen as its third argument, not an arc angle.',
  },
  W732: {
    severity: 'warning',
    title: 'STR$ has a leading space for numbers that are not negative',
    hint: 'STR$(5) is " 5" (Locomotive BASIC); Boriel gave "5". Where the space matters, drop it: MID$(STR$(n), 2) for n >= 0.',
  },
  W733: {
    severity: 'warning',
    title: 'PRINT lays out numbers, commas and TAB as Locomotive BASIC does',
    hint: 'A number prints with a sign position and a trailing space, a comma moves to the next 13-column zone (ZONE), and TAB counts columns from 1.',
  },
  W734: {
    severity: 'warning',
    title: 'INKEY$ reads the key buffer',
    hint: 'Boriel\'s INKEY$ returned the key held now; CPC BASIC\'s returns the next typed key. For "is this key down" use INKEY(n) or the library\'s KeyDown.',
  },
  W735: {
    severity: 'warning',
    title: 'MOD, / and \\ by a power of two take the dividend\'s sign and truncate',
    hint: '-7 MOD 3 is -1 in CPC BASIC (Boriel gave 1), and -7 / 2 is -3 (Boriel shifted: -4). Only a negative dividend is affected.',
  },
  W736: {
    severity: 'warning',
    title: 'READ of an unquoted number into a string gives its text',
    hint: 'READ a$ of the DATA item -30 gives "-30" in CPC BASIC (Boriel gave ""). Quote the item, or read it into a number.',
  },
  W737: {
    severity: 'warning',
    title: 'A variable without a suffix or a type is an INTEGER',
    hint: 'Boriel guessed its type from its first use (UBYTE for 1 TO 10, FIXED for 3.5, FLOAT for PI or DIM a = 5); CPC BASIC makes it INTEGER, so 1.5 is stored as 1. DIM it AS the type it needs, give it a ! suffix, or use DEFREAL.',
  },
  W738: {
    severity: 'warning',
    title: 'Names that differ only in letter case are one name in CPC BASIC',
    hint: 'Boriel BASIC told score from Score (unless #pragma case_insensitive); CPC BASIC does not. Two variables that Boriel kept apart now share one, or clash. Rename one of them.',
  },
  W739: {
    severity: 'warning',
    title: 'Unsigned and signed 16-bit values meet in a comparison or an arithmetic result',
    hint: 'Boriel converted a UINTEGER compared with an INTEGER to signed (40000 > 100 was false); CPC BASIC compares the values. A literal from 256 to 65535 was UINTEGER in Boriel and is INTEGER now, so 256 * PEEK(a) of 32768 or more is negative when it is compared, divided, printed or widened. Widen first: CAST(UINTEGER, PEEK(a)) * 256.',
  },
  // 740-749: kept for CPC Game Studio (the Convert Project command)
} as const satisfies CodeTable;
