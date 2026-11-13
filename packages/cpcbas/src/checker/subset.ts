/**
 * The L2 subset gate, in one place so L3 widens it by editing this file
 * (L2-CHECK). Anything outside the sets below is reported as E002 "X is not implemented yet"
 * at its keyword, so the lowering never sees it.
 */
import type { Stmt } from '../ast/ast.js';

/** Statement node kinds the lowering handles in L2 (arrays, MID$ assignment, INPUT, timers, errors and RSX are not). */
export const SUBSET_STMT_KINDS: ReadonlySet<Stmt['kind']> = new Set<Stmt['kind']>([
  'LineLabel',
  'Let',
  'Dim',
  'Const',
  'DefType',
  'Option',
  'If',
  'For',
  'While',
  'DoLoop',
  'SelectCase',
  'Exit',
  'Continue',
  'Goto',
  'Gosub',
  'Return',
  'OnGoto',
  'End',
  'Call',
  'SubCall',
  'Print',
  'Input', // L4-KEYS
  'Write', // L4-FILES
  'OnBreak',
  'Data',
  'Read',
  'Restore',
  'Procedure',
  'Declare',
  'DefFn',
  'Asm',
  'Pragma',
  'Require',
  'Init',
  'BadStmt',
  'MidAssign',
  'Stop',
  'EveryAfter', // L4-EVENTS
  // L4-ERR
  'OnError',
  'Resume',
  'Error',
]);

/**
 * Generic built-in statements (`Builtin` nodes) in the L2 subset. MEMORY is not in the brief's
 * list, but tests/loco/int-memory.bas (a milestone program) uses it; it is a build-time constant.
 */
export const SUBSET_BUILTIN_STMTS: ReadonlySet<string> = new Set([
  'LOCATE',
  'MODE',
  'PEN',
  'PAPER',
  'BORDER',
  'CLS',
  'POKE',
  'MEMORY',
  'DEG',
  'RAD',
  'RANDOMIZE',
  // L4-SMALL
  'PAUSE',
  'FRAME',
  'OUT',
  'WAIT',
  // L4-EVENTS
  'DI',
  'EI',
  // L4-TEXT
  'WINDOW',
  'WINDOW SWAP',
  'TAG',
  'TAGOFF',
  'SYMBOL',
  'SYMBOL AFTER',
  'ZONE',
  'WIDTH',
  // L4-SOUND (SOUND, ENV, ENT and RELEASE are firmware-only keywords: a bare build gets E270 before this gate)
  'SOUND',
  'ENV',
  'ENT',
  'RELEASE',
  'BEEP',
  // L4-GFX (the lowering is in ir/lower/builtins.ts)
  'CLG',
  'ORIGIN',
  'GRAPHICS PEN',
  'GRAPHICS PAPER',
  'PLOT',
  'PLOTR',
  'MOVE',
  'MOVER',
  'DRAW',
  'DRAWR',
  'INK',
  'SPEED INK',
  'MASK',
  'FILL',
  'CIRCLE',
  // L4-KEYS
  'KEY',
  'KEY DEF',
  'SPEED KEY',
  'CLEAR INPUT',
  // L4-FILES
  'OPENIN',
  'CLOSEIN',
  'OPENOUT',
  'CLOSEOUT',
  'LOAD',
  'SAVE',
  'CAT',
  'CHAIN',
]);

/**
 * Built-in functions in the L2 subset (TAB and SPC are PRINT items, not calls). VAL is lowered
 * but stays outside until L2-CG-REAL: its result is REAL, so every use would end in a template
 * E002 (`cast` on `f->i16`) instead of this gate's "VAL is not implemented yet" at the keyword.
 */
export const SUBSET_FUNCTIONS: ReadonlySet<string> = new Set([
  'PEEK',
  'LBOUND',
  'UBOUND',
  'INKEY$',
  'POS',
  'VPOS',
  'LEN',
  'LEFT$',
  'RIGHT$',
  'MID$',
  'CHR$',
  'ASC',
  'STR$',
  'VAL',
  'SPACE$',
  'STRING$',
  'UPPER$',
  'LOWER$',
  'INSTR',
  'ABS',
  'SGN',
  'MIN',
  'MAX',
  'CINT',
  'UNT',
  'CAST',
  'SIZEOF',
  'INT',
  'FIX',
  'CREAL',
  'SQR',
  'SIN',
  'COS',
  'TAN',
  'ATN',
  'EXP',
  'LOG',
  'LOG10',
  'PI',
  'RND',
  'ROUND',
  'HEX$',
  'BIN$',
  'DEC$',
  'INP',
  'FRE',
  'HIMEM',
  'RANDOM',
  'REMAIN', // L4-EVENTS
  'TIME',
  'COPYCHR$', // L4-TEXT
  // L4-ERR
  'ERR',
  'ERL',
  'SQ', // L4-SOUND
  // L4-GFX
  'TEST',
  'TESTR',
  'XPOS',
  'YPOS',
  'POINT',
  // L4-KEYS
  'INKEY',
  'JOY',
  // L4-FILES
  'EOF',
  'DERR',
]);

