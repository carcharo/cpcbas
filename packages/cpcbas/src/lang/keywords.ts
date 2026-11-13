/**
 * The keyword and built-in table: the single source of truth for reserved words,
 * statements, built-in functions, operators, type names and preprocessor directives.
 *
 * Readers: the lexer (which words are reserved), the parser (the argument shape of
 * the generic built-in statements and functions), and later the LSP (completion,
 * hover), the generated TextMate grammar and `language.json`. Keep it data: no
 * behaviour here beyond the derived lookups at the bottom.
 *
 * One entry per (name, kind): `MID$` is both a function and a statement, so it has
 * two entries. Multi-word statements (`LINE INPUT`, `GRAPHICS PEN`, `ON ERROR GOTO`)
 * are entries of their own; every word of a reserved entry's name is reserved.
 *
 * Status (from the language reference's catalogue):
 * - `compiled`  works in firmware and bare-metal mode;
 * - `firmware`  firmware mode only; bare mode refuses it at compile time, naming it;
 * - `library`   provided by a library include, not by the language;
 * - `later`     recognised, not in 1.0 (error with a hint);
 * - `alias`     a compatibility spelling of something else (`aliasOf`), kept working;
 * - `dropped`   recognised only to give an error with a hint (Sinclair/Boriel forms,
 *               interpreter commands).
 *
 * `reserved: false` marks soft words: they lex as identifiers (so `over`, `list` or
 * `bold` stay usable as names) and the parser or binder recognises them where they
 * would be meant as the dropped form.
 */

export type KeywordKind = 'statement' | 'function' | 'operator' | 'type' | 'clause' | 'preprocessor';

export type KeywordStatus = 'compiled' | 'firmware' | 'library' | 'later' | 'alias' | 'dropped';

/** Result type of a built-in function. `numeric` = the type of the (promoted) numeric argument. */
export type BuiltinReturn = 'UBYTE' | 'INTEGER' | 'UINTEGER' | 'ULONG' | 'REAL' | 'STRING' | 'numeric' | 'cast';

/**
 * How the parser builds the statement:
 * - `builtin`: the generic `Builtin` AST node from the comma-separated arguments
 *   described by `args`, `stream`, `typeArg` and `emptyArgs`;
 * - `special`: its own AST node (IF, FOR, PRINT, DIM, ...) or part of one.
 */
export type StatementForm = 'builtin' | 'special';

/**
 * What one argument of a built-in is:
 * - `int`: a number; a FIXED or REAL value is converted to INTEGER (truncating);
 * - `num`: a number, left as it is;
 * - `str`: a STRING;
 * - `strOrInt`: a STRING or a number (`STRING$(n, c | c$)`);
 * - `addr`: a number converted to UINTEGER (an address or port);
 * - `any`: an expression of any type (`CAST`, `FRE`, `SIZEOF`);
 * - `array`: the name of an array (`LBOUND`, `UBOUND`);
 * - `ident`: a bare word, not an expression (the file-type letter of `SAVE`).
 */
export type ArgKind = 'int' | 'num' | 'str' | 'strOrInt' | 'addr' | 'any' | 'array' | 'ident';

/** One argument of a built-in, in source order (after any `#stream` and type argument). */
export interface Param {
  readonly kind: ArgKind;
  /** Name for hover and signature help. */
  readonly name: string;
  /** May be omitted, or (for statements with `emptyArgs`) left empty. */
  readonly optional?: boolean;
  /** Only with `optional`: when present it comes first and the others keep their place (`INSTR([start,] a$, b$)`); it is present only when all params are given. */
  readonly leading?: boolean;
  /** Last param only: the argument may be given any number of times up to `args.max` (`MIN`, `SYMBOL`, `ENV`). */
  readonly repeat?: boolean;
}

export interface KeywordEntry {
  /** Canonical spelling: upper case, words separated by one space, `$` included (`STR$`, `LINE INPUT`); directives lower case with `#` (`#include`). */
  readonly name: string;
  readonly kind: KeywordKind;
  readonly status: KeywordStatus;
  /** Whether the words of `name` are reserved (cannot be identifiers). */
  readonly reserved: boolean;
  /** One-line syntax as in the reference (`LOCATE [#s,] x, y`). */
  readonly syntax: string;
  /** Statements only. */
  readonly form?: StatementForm;
  /** Number of comma-separated arguments (statements: after the keyword; functions: inside the parentheses), not counting `#stream` or a type argument. `max` may be Infinity. */
  readonly args?: { readonly min: number; readonly max: number };
  /** Accepts a leading `#stream` (`PEN #1, 2`, `POS(#0)`). For POS/VPOS/COPYCHR$ the stream is the whole argument. */
  readonly stream?: boolean;
  /** Accepts a leading type name: `PEEK(UINTEGER, a)`, `POKE UINTEGER, a, v`, `CAST(UBYTE, x)`, `SIZEOF(UBYTE)`. `required` for CAST. */
  readonly typeArg?: boolean | 'required';
  /** Arguments may be left empty (`SOUND 1, 200, , 15`, `GRAPHICS PEN , 1`). */
  readonly emptyArgs?: boolean;
  /** With `emptyArgs`: the first argument may be left empty when a later one is given (`PEN , 1`). */
  readonly optionalFirst?: boolean;
  /**
   * The kind of each argument, in order. Present on every built-in statement (`form: 'builtin'`)
   * and every function with `args`. Alternative forms are optional params (`MID$` 2 or 3
   * arguments, `PEN` with the ink left out), a leading optional param (`INSTR`) or a union
   * kind (`strOrInt` in `STRING$`). A count between `args.min` and `args.max` is always
   * covered; see docs/keywords.md.
   */
  readonly params?: readonly Param[];
  /** The checker constrains the argument kinds in `params` (others are typed generically until it is widened). */
  readonly checked?: boolean;
  /** Functions: whether the parentheses are required, optional (`RND`, `RND(1)`) or absent (`INKEY$`, `TIME`). */
  readonly parens?: 'required' | 'optional' | 'none';
  readonly returns?: BuiltinReturn;
  /** Functions that only exist inside PRINT (`TAB`, `SPC`). */
  readonly context?: 'print';
  /** For `alias`: the canonical form it stands for. */
  readonly aliasOf?: string;
  /** For `dropped`/`later`/`alias`: the hint text a diagnostic gives. */
  readonly hint?: string;
  /** Mode or behaviour note (bare-mode limits, Locomotive differences). */
  readonly note?: string;
  /** Section of the language reference that defines it. */
  readonly section: string;
}

type Opt = Omit<KeywordEntry, 'name' | 'kind' | 'status' | 'reserved' | 'syntax' | 'section'>;

const R = { min: 0, max: 0 };
const par = (kind: ArgKind) => (name: string): Param => ({ kind, name });
const int = par('int');
const num = par('num');
const str = par('str');
const strOrInt = par('strOrInt');
const addr = par('addr');
const any = par('any');
const array = par('array');
const ident = par('ident');
const opt = (p: Param): Param => ({ ...p, optional: true });
const lead = (p: Param): Param => ({ ...p, leading: true });
const rep = (p: Param): Param => ({ ...p, repeat: true });
const n = (min: number, max = min): { min: number; max: number } => ({ min, max });

function stmt(name: string, status: KeywordStatus, syntax: string, section: string, opt: Opt = {}): KeywordEntry {
  return { name, kind: 'statement', status, reserved: true, syntax, section, form: 'builtin', args: R, ...opt };
}
function special(name: string, status: KeywordStatus, syntax: string, section: string, opt: Opt = {}): KeywordEntry {
  return { name, kind: 'statement', status, reserved: true, syntax, section, form: 'special', ...opt };
}
function fn(name: string, status: KeywordStatus, syntax: string, section: string, returns: BuiltinReturn, opt: Opt = {}): KeywordEntry {
  return { name, kind: 'function', status, reserved: true, syntax, section, parens: 'required', args: n(1), returns, ...opt };
}
function clause(name: string, syntax: string, section: string, opt: Opt = {}): KeywordEntry {
  return { name, kind: 'clause', status: 'compiled', reserved: true, syntax, section, ...opt };
}
function soft(name: string, kind: KeywordKind, status: KeywordStatus, syntax: string, section: string, hint: string, opt: Opt = {}): KeywordEntry {
  return { name, kind, status, reserved: false, syntax, section, hint, ...opt };
}

const NOT_IN_COMPILER = 'An interpreter command: not applicable to a compiled program.';

export const KEYWORDS: readonly KeywordEntry[] = [
  // ---- Program structure, comments, assignment (3, 4) ----
  special('REM', 'compiled', 'REM text', '2', { note: 'Comment to the end of the line.' }),
  special('LET', 'compiled', '[LET] variable = expression', '4'),
  special('END', 'compiled', 'END', '3', { note: 'Firmware mode: waits for a key and resets; bare mode: resets. Also the first word of END IF/SUB/FUNCTION/SELECT/ASM.' }),
  special('STOP', 'compiled', 'STOP', '3', { note: 'END with a Break message.' }),
  special('DATA', 'compiled', 'DATA item [, item ...]', '3'),
  special('READ', 'compiled', 'READ variable [, variable ...]', '3'),
  special('RESTORE', 'compiled', 'RESTORE [line | label]', '3'),

  // ---- Declarations and types (4) ----
  special('DIM', 'compiled', 'DIM name [(bounds)] [AS type] [= value | => {...}] [AT address] [, ...]', '4'),
  special('CONST', 'compiled', 'CONST name [AS type] = constant-expression', '4'),
  special('DEFINT', 'compiled', 'DEFINT letter[-letter] [, ...]', '4'),
  special('DEFREAL', 'compiled', 'DEFREAL letter[-letter] [, ...]', '4'),
  special('DEFSTR', 'compiled', 'DEFSTR letter[-letter] [, ...]', '4'),
  special('OPTION', 'compiled', 'OPTION REAL', '4', { note: 'File-level: unsuffixed, undeclared variables default to REAL (Locomotive).' }),
  clause('AS', 'name AS type', '4'),
  clause('AT', 'DIM ... AT address; PRINT AT row, col', '4'),
  { name: 'UBYTE', kind: 'type', status: 'compiled', reserved: true, syntax: 'UBYTE', section: '4', note: '1 byte, 0..255' },
  { name: 'BYTE', kind: 'type', status: 'compiled', reserved: true, syntax: 'BYTE', section: '4', note: '1 byte, -128..127' },
  { name: 'UINTEGER', kind: 'type', status: 'compiled', reserved: true, syntax: 'UINTEGER', section: '4', note: '2 bytes, 0..65535' },
  { name: 'INTEGER', kind: 'type', status: 'compiled', reserved: true, syntax: 'INTEGER', section: '4', note: '2 bytes, -32768..32767; suffix %' },
  { name: 'ULONG', kind: 'type', status: 'compiled', reserved: true, syntax: 'ULONG', section: '4', note: '4 bytes, unsigned' },
  { name: 'LONG', kind: 'type', status: 'compiled', reserved: true, syntax: 'LONG', section: '4', note: '4 bytes, signed' },
  { name: 'FIXED', kind: 'type', status: 'compiled', reserved: true, syntax: 'FIXED', section: '4', note: '4 bytes, 16.16 fixed point' },
  { name: 'REAL', kind: 'type', status: 'compiled', reserved: true, syntax: 'REAL', section: '4', note: '5 bytes, ~8 significant digits; suffix !' },
  { name: 'FLOAT', kind: 'type', status: 'alias', reserved: true, syntax: 'FLOAT', section: '4', aliasOf: 'REAL' },
  { name: 'STRING', kind: 'type', status: 'compiled', reserved: true, syntax: 'STRING', section: '4', note: 'heap string; suffix $' },

  // ---- Operators (5) ----
  { name: 'MOD', kind: 'operator', status: 'compiled', reserved: true, syntax: 'a MOD b', section: '5', note: 'Integer remainder, sign of the dividend.' },
  { name: 'NOT', kind: 'operator', status: 'compiled', reserved: true, syntax: 'NOT a', section: '5', note: 'Bitwise.' },
  { name: 'AND', kind: 'operator', status: 'compiled', reserved: true, syntax: 'a AND b', section: '5', note: 'Bitwise; both operands always evaluated.' },
  { name: 'OR', kind: 'operator', status: 'compiled', reserved: true, syntax: 'a OR b', section: '5', note: 'Bitwise.' },
  { name: 'XOR', kind: 'operator', status: 'compiled', reserved: true, syntax: 'a XOR b', section: '5', note: 'Bitwise.' },
  soft('BAND', 'operator', 'dropped', 'a bAND b', '5', 'Use AND: it is already bitwise.', { aliasOf: 'AND' }),
  soft('BOR', 'operator', 'dropped', 'a bOR b', '5', 'Use OR: it is already bitwise.', { aliasOf: 'OR' }),
  soft('BXOR', 'operator', 'dropped', 'a bXOR b', '5', 'Use XOR: it is already bitwise.', { aliasOf: 'XOR' }),
  soft('BNOT', 'operator', 'dropped', 'bNOT a', '5', 'Use NOT: it is already bitwise.', { aliasOf: 'NOT' }),
  fn('CAST', 'compiled', 'CAST(type, expression)', '5', 'cast', { typeArg: 'required', params: [any('expression')] }),
  fn('SIZEOF', 'compiled', 'SIZEOF(type | variable)', '5', 'UINTEGER', { typeArg: true, args: n(0, 1), params: [opt(any('variable'))] }),
  fn('PEEK', 'compiled', 'PEEK([type,] address)', '5', 'UBYTE', { typeArg: true, note: 'With a type: that type.', params: [addr('address')] }),
  stmt('POKE', 'compiled', 'POKE [type,] address, value', '5', { args: n(2), typeArg: true, params: [addr('address'), num('value')] }),
  fn('INP', 'compiled', 'INP(port)', '5', 'UBYTE', { params: [addr('port')], checked: true }),
  stmt('OUT', 'compiled', 'OUT port, value', '5', { args: n(2), params: [addr('port'), int('value')], checked: true }),

  // ---- Control flow (6) ----
  special('IF', 'compiled', 'IF cond THEN stmts [ELSE stmts] | IF cond THEN ... [ELSEIF ...] [ELSE ...] END IF', '6'),
  clause('THEN', 'IF cond THEN ...', '6'),
  clause('ELSE', 'IF ... ELSE ...', '6'),
  clause('ELSEIF', 'ELSEIF cond THEN', '6'),
  special('FOR', 'compiled', 'FOR v = a TO b [STEP s]', '6', { note: 'Body runs zero times for an empty range (Locomotive runs it once).' }),
  clause('TO', 'FOR v = a TO b; CASE a TO b', '6'),
  clause('STEP', 'FOR ... STEP s', '6'),
  special('NEXT', 'compiled', 'NEXT [v [, w ...]]', '6'),
  special('WHILE', 'compiled', 'WHILE cond ... WEND; DO WHILE cond; LOOP WHILE cond', '6'),
  special('WEND', 'compiled', 'WEND', '6'),
  special('DO', 'compiled', 'DO [WHILE | UNTIL cond]', '6'),
  special('LOOP', 'compiled', 'LOOP [WHILE | UNTIL cond]', '6'),
  clause('UNTIL', 'DO UNTIL cond; LOOP UNTIL cond', '6'),
  special('EXIT', 'compiled', 'EXIT FOR | WHILE | DO | SUB | FUNCTION', '6'),
  special('CONTINUE', 'compiled', 'CONTINUE FOR | WHILE | DO', '6'),
  special('GOTO', 'compiled', 'GOTO line | label', '6'),
  special('GOSUB', 'compiled', 'GOSUB line | label', '6'),
  soft('GO', 'statement', 'alias', 'GO TO target; GO SUB target', '6', 'GO TO and GO SUB are accepted as GOTO and GOSUB.'),
  special('RETURN', 'compiled', 'RETURN [expression]', '6', { note: 'With a value: returns from a FUNCTION.' }),
  special('ON', 'compiled', 'ON expr GOTO t1, t2, ... | ON expr GOSUB t1, t2, ...', '6', { note: '1-based index (Boriel was 0-based).' }),
  special('SELECT', 'compiled', 'SELECT CASE expr', '6'),
  clause('CASE', 'CASE v, w | CASE a TO b | CASE IS > v | CASE ELSE', '6'),
  clause('IS', 'CASE IS op value', '6'),
  special('ON BREAK', 'compiled', 'ON BREAK STOP | CONT', '6', { note: 'CONT (default): ESC ignored; STOP: ESC checked at every line.' }),
  clause('BREAK', 'ON BREAK STOP | CONT', '6'),
  special('ON BREAK GOSUB', 'later', 'ON BREAK GOSUB target', '6', { hint: 'Break handlers are not in 1.0: use ON BREAK STOP, or test for ESC with INKEY(66) in the main loop.' }),
  special('ON SQ', 'later', 'ON SQ(channel) GOSUB target', '9', { hint: 'Sound-queue events are not in 1.0: poll SQ(channel) in the main loop.' }),
  special('ON ERROR GOTO', 'compiled', 'ON ERROR GOTO target', '6'),
  special('ERROR', 'compiled', 'ERROR n', '6'),
  fn('ERR', 'compiled', 'ERR', '6', 'INTEGER', { parens: 'none', args: R, params: [] }),
  fn('ERL', 'compiled', 'ERL', '6', 'UINTEGER', { parens: 'none', args: R, params: [] }),
  special('RESUME', 'compiled', 'RESUME [NEXT | line]', '16'),
  special('EVERY', 'compiled', 'EVERY n [, timer] GOSUB target', '6'),
  special('AFTER', 'compiled', 'AFTER n [, timer] GOSUB target', '6'),
  fn('REMAIN', 'compiled', 'REMAIN(timer)', '6', 'INTEGER', { params: [int('timer')] }),
  stmt('DI', 'compiled', 'DI', '6', { note: 'Disables EVERY/AFTER GOSUBs (not interrupts).', params: [] }),
  stmt('EI', 'compiled', 'EI', '6', { note: 'Enables EVERY/AFTER GOSUBs.', params: [] }),
  special('CALL', 'compiled', 'CALL address [, p1, p2, ...]', '18', { note: 'Firmware jumpblock addresses go through the firmware gate; bare mode refuses them.' }),
  stmt('WAIT', 'compiled', 'WAIT port, mask [, inv]', '6', { args: n(2, 3), params: [addr('port'), int('mask'), opt(int('inv'))] }),

  // ---- Procedures (7) ----
  special('SUB', 'compiled', 'SUB name([params]) ... END SUB', '7'),
  special('FUNCTION', 'compiled', 'FUNCTION name([params]) AS type ... END FUNCTION', '7'),
  clause('BYVAL', 'BYVAL name AS type', '7'),
  clause('BYREF', 'BYREF name AS type', '7'),
  clause('FASTCALL', 'SUB FASTCALL name(...)', '7', { note: 'First parameter in registers, no frame.' }),
  clause('STDCALL', 'SUB STDCALL name(...)', '7', { note: 'The default convention.' }),
  special('DECLARE', 'compiled', 'DECLARE SUB | FUNCTION name(...)', '7', { note: 'Accepted for compatibility; not needed.' }),
  special('DEF FN', 'compiled', 'DEF FN name(params) = expression', '7'),
  clause('DEF', 'DEF FN ...; KEY DEF ...', '7'),
  clause('FN', 'FN name(args)', '7'),
  soft('PRIVATE', 'clause', 'later', 'PRIVATE SUB ...', '16', 'PRIVATE is not in 1.0.'),
  soft('TYPE', 'statement', 'later', 'TYPE name ... END TYPE', '16', 'TYPE records are not in 1.0; use arrays.'),

  // ---- Arrays and strings (8) ----
  fn('LBOUND', 'compiled', 'LBOUND(array [, dim])', '8', 'UINTEGER', { args: n(1, 2), params: [array('array'), opt(int('dim'))] }),
  fn('UBOUND', 'compiled', 'UBOUND(array [, dim])', '8', 'UINTEGER', { args: n(1, 2), params: [array('array'), opt(int('dim'))] }),
  special('ERASE', 'later', 'ERASE array', '16', { hint: 'Arrays are static: reuse the array and reset its elements yourself.' }),
  fn('LEN', 'compiled', 'LEN(s$)', '8', 'UINTEGER', { params: [str('s')], checked: true }),
  fn('LEFT$', 'compiled', 'LEFT$(s$, n)', '8', 'STRING', { args: n(2), params: [str('s'), int('n')], checked: true }),
  fn('RIGHT$', 'compiled', 'RIGHT$(s$, n)', '8', 'STRING', { args: n(2), params: [str('s'), int('n')], checked: true }),
  fn('MID$', 'compiled', 'MID$(s$, p [, n])', '8', 'STRING', { args: n(2, 3), params: [str('s'), int('start'), opt(int('n'))], checked: true }),
  special('MID$', 'compiled', 'MID$(a$, p [, n]) = b$', '8'),
  fn('INSTR', 'compiled', 'INSTR([start,] a$, b$)', '8', 'UINTEGER', { args: n(2, 3), params: [lead(opt(int('start'))), str('a'), str('b')] }),
  fn('STRING$', 'compiled', 'STRING$(n, c | c$)', '8', 'STRING', { args: n(2), params: [int('n'), strOrInt('c')], checked: true }),
  fn('SPACE$', 'compiled', 'SPACE$(n)', '8', 'STRING', { params: [int('n')], checked: true }),
  fn('UPPER$', 'compiled', 'UPPER$(s$)', '8', 'STRING', { params: [str('s')], checked: true }),
  fn('LOWER$', 'compiled', 'LOWER$(s$)', '8', 'STRING', { params: [str('s')], checked: true }),
  fn('CHR$', 'compiled', 'CHR$(n)', '8', 'STRING', { params: [int('code')], checked: true }),
  fn('ASC', 'compiled', 'ASC(s$)', '8', 'UBYTE', { params: [str('s')], checked: true }),
  fn('VAL', 'compiled', 'VAL(s$)', '8', 'REAL', { note: 'Reads one numeric literal.', params: [str('s')], checked: true }),
  fn('STR$', 'compiled', 'STR$(n)', '8', 'STRING', { note: 'Locomotive text: STR$(5) is " 5".', params: [num('n')], checked: true }),
  fn('HEX$', 'compiled', 'HEX$(n [, width])', '8', 'STRING', { args: n(1, 2), params: [num('n'), opt(int('width'))] }),
  fn('BIN$', 'compiled', 'BIN$(n [, width])', '8', 'STRING', { args: n(1, 2), params: [num('n'), opt(int('width'))] }),
  fn('DEC$', 'compiled', 'DEC$(n, format$)', '8', 'STRING', { args: n(2), params: [num('n'), str('format')] }),

  // ---- Screen and text (9) ----
  stmt('MODE', 'compiled', 'MODE n', '9', { args: n(1), params: [int('mode')], checked: true }),
  stmt('INK', 'compiled', 'INK n, c1 [, c2]', '9', { args: n(2, 3), note: 'Flashing (c2) needs the firmware ticker; bare mode uses c1.', hint: "INK n without a colour is the Spectrum form; to set the text colour use PEN n.", params: [int('pen'), int('c1'), opt(int('c2'))], checked: true }),
  stmt('BORDER', 'compiled', 'BORDER c1 [, c2]', '9', { args: n(1, 2), note: 'Flashing (c2): firmware mode only.', params: [int('c1'), opt(int('c2'))], checked: true }),
  stmt('SPEED INK', 'firmware', 'SPEED INK a, b', '9', { args: n(2), params: [int('a'), int('b')], checked: true }),
  clause('SPEED', 'SPEED INK a, b; SPEED KEY a, b', '9'),
  stmt('SPEED WRITE', 'firmware', 'SPEED WRITE n', '9', { args: n(1), note: 'Cassette write speed: 0 (1000 baud) or 1 (2000 baud).', params: [int('speed')] }),
  stmt('PEN', 'compiled', 'PEN [#s,] [ink] [, mode]', '9', { args: n(1, 2), stream: true, emptyArgs: true, optionalFirst: true, note: 'BASIC 1.1: mode 0 draws the character background opaque, 1 transparent.', params: [opt(int('ink')), opt(int('mode'))], checked: true }),
  stmt('PAPER', 'compiled', 'PAPER [#s,] n', '9', { args: n(1), stream: true, params: [int('ink')], checked: true }),
  stmt('LOCATE', 'compiled', 'LOCATE [#s,] x, y', '9', { args: n(2), stream: true, note: '1-based, as Locomotive.', params: [int('x'), int('y')], checked: true }),
  stmt('CLS', 'compiled', 'CLS [#s]', '9', { stream: true, params: [], checked: true }),
  special('PRINT', 'compiled', 'PRINT [#s,] [AT row, col;] items  (also ?)', '9', { note: 'Items: expressions, ; , TAB(n) SPC(n) USING fmt$;' }),
  clause('USING', 'PRINT USING format$; items', '9'),
  fn('TAB', 'compiled', 'TAB(n)', '9', 'STRING', { context: 'print', params: [int('n')], checked: true }),
  fn('SPC', 'compiled', 'SPC(n)', '9', 'STRING', { context: 'print', params: [int('n')], checked: true }),
  stmt('ZONE', 'compiled', 'ZONE n', '9', { args: n(1), params: [int('width')], checked: true }),
  stmt('WINDOW', 'firmware', 'WINDOW [#s,] left, right, top, bottom', '9', { args: n(4), stream: true, params: [int('left'), int('right'), int('top'), int('bottom')] }),
  stmt('WINDOW SWAP', 'firmware', 'WINDOW SWAP a [, b]', '9', { args: n(1, 2), params: [int('a'), opt(int('b'))] }),
  clause('SWAP', 'WINDOW SWAP a, b', '9'),
  stmt('TAG', 'firmware', 'TAG [#s]', '9', { stream: true, params: [] }),
  stmt('TAGOFF', 'firmware', 'TAGOFF [#s]', '9', { stream: true, params: [] }),
  stmt('SYMBOL', 'compiled', 'SYMBOL c, r1 [, r2 ... r8]', '9', { args: n(2, 9), params: [int('char'), int('row1'), rep(opt(int('row')))] }),
  stmt('SYMBOL AFTER', 'compiled', 'SYMBOL AFTER n', '9', { args: n(1), note: 'A build-time constant.', params: [int('char')] }),
  fn('POS', 'compiled', 'POS(#s)', '9', 'UBYTE', { args: R, stream: true, params: [] }),
  fn('VPOS', 'compiled', 'VPOS(#s)', '9', 'UBYTE', { args: R, stream: true, params: [] }),
  fn('COPYCHR$', 'firmware', 'COPYCHR$(#s)', '9', 'STRING', { args: R, stream: true, params: [] }),
  special('CURSOR', 'later', 'CURSOR [system] [, user]', '16', { hint: 'Print your own cursor character instead.' }),

  // ---- Graphics (9) ----
  stmt('CLG', 'compiled', 'CLG [n]', '9', { args: n(0, 1), params: [opt(int('ink'))], checked: true }),
  stmt('ORIGIN', 'compiled', 'ORIGIN x, y [, left, right, top, bottom]', '9', { args: n(2, 6), note: 'The window part is firmware mode only.', params: [int('x'), int('y'), opt(int('left')), opt(int('right')), opt(int('top')), opt(int('bottom'))], checked: true }),
  stmt('GRAPHICS PEN', 'compiled', 'GRAPHICS PEN [n] [, mode]', '9', { args: n(0, 2), emptyArgs: true, note: 'The mode argument is firmware mode only.', params: [opt(int('ink')), opt(int('mode'))], checked: true }),
  stmt('GRAPHICS PAPER', 'compiled', 'GRAPHICS PAPER n', '9', { args: n(1), params: [int('ink')], checked: true }),
  clause('GRAPHICS', 'GRAPHICS PEN ...; GRAPHICS PAPER ...', '9'),
  stmt('PLOT', 'compiled', 'PLOT x, y [, pen [, mode]]', '9', { args: n(2, 4), emptyArgs: true, note: 'mode: firmware mode only in 1.0.', params: [int('x'), int('y'), opt(int('pen')), opt(int('mode'))], checked: true }),
  stmt('PLOTR', 'compiled', 'PLOTR dx, dy [, pen [, mode]]', '9', { args: n(2, 4), emptyArgs: true, params: [int('dx'), int('dy'), opt(int('pen')), opt(int('mode'))], checked: true }),
  stmt('MOVE', 'compiled', 'MOVE x, y [, pen [, mode]]', '9', { args: n(2, 4), emptyArgs: true, params: [int('x'), int('y'), opt(int('pen')), opt(int('mode'))], checked: true }),
  stmt('MOVER', 'compiled', 'MOVER dx, dy [, pen [, mode]]', '9', { args: n(2, 4), emptyArgs: true, params: [int('dx'), int('dy'), opt(int('pen')), opt(int('mode'))], checked: true }),
  stmt('DRAW', 'compiled', 'DRAW x, y [, pen [, mode]]', '9', { args: n(2, 4), emptyArgs: true, params: [int('x'), int('y'), opt(int('pen')), opt(int('mode'))], checked: true }),
  stmt('DRAWR', 'compiled', 'DRAWR dx, dy [, pen [, mode]]', '9', { args: n(2, 4), emptyArgs: true, params: [int('dx'), int('dy'), opt(int('pen')), opt(int('mode'))], checked: true }),
  fn('TEST', 'compiled', 'TEST(x, y)', '9', 'UBYTE', { args: n(2), params: [int('x'), int('y')], checked: true }),
  fn('TESTR', 'compiled', 'TESTR(dx, dy)', '9', 'UBYTE', { args: n(2), params: [int('dx'), int('dy')], checked: true }),
  fn('XPOS', 'compiled', 'XPOS', '9', 'INTEGER', { parens: 'none', args: R, params: [] }),
  fn('YPOS', 'compiled', 'YPOS', '9', 'INTEGER', { parens: 'none', args: R, params: [] }),
  stmt('MASK', 'firmware', 'MASK [n] [, first]', '9', { args: n(0, 2), emptyArgs: true, params: [opt(int('mask')), opt(int('first'))], checked: true }),
  stmt('WIDTH', 'firmware', 'WIDTH n', '9', { args: n(1), note: 'Printer line width.', params: [int('width')] }),
  stmt('FILL', 'firmware', 'FILL n', '9', { args: n(1), params: [int('ink')], checked: true }),

  // ---- Keyboard and joystick (9) ----
  fn('INKEY$', 'compiled', 'INKEY$', '9', 'STRING', { parens: 'none', args: R, note: 'Firmware key buffer; bare mode: the key held now.', params: [], checked: true }),
  fn('INKEY', 'compiled', 'INKEY(n)', '9', 'INTEGER', { note: '-1 not held, 0 held, 32 with shift, 128 with ctrl, 160 both.', params: [int('key')], checked: true }),
  fn('JOY', 'compiled', 'JOY(n)', '9', 'UBYTE', { params: [int('n')], checked: true }),
  special('INPUT', 'compiled', 'INPUT [#s,] ["prompt" ; | ,] variables', '9'),
  special('LINE INPUT', 'compiled', 'LINE INPUT [#s,] ["prompt" ; | ,] a$', '9'),
  clause('LINE', 'LINE INPUT ...', '9'),
  stmt('KEY', 'firmware', 'KEY n, text$', '9', { args: n(2), params: [int('n'), str('text')] }),
  stmt('KEY DEF', 'firmware', 'KEY DEF n, repeat [, normal [, shift [, ctrl]]]', '9', { args: n(2, 5), params: [int('key'), int('repeat'), opt(int('normal')), opt(int('shift')), opt(int('ctrl'))] }),
  stmt('SPEED KEY', 'firmware', 'SPEED KEY a, b', '9', { args: n(2), params: [int('delay'), int('repeat')] }),
  stmt('CLEAR INPUT', 'compiled', 'CLEAR INPUT', '9', { params: [] }),
  special('CLEAR', 'later', 'CLEAR', '16', { hint: 'Variables keep their values: use a SUB with local DIMs or reset them yourself (CLEAR INPUT is available).' }),

  // ---- Sound (9) ----
  stmt('SOUND', 'firmware', 'SOUND ch, period [, dur [, vol [, env [, ent [, noise]]]]]', '9', { args: n(2, 7), emptyArgs: true, note: 'Bare mode: not in 1.0 (use the music/sfx library).', params: [num('channel'), num('period'), opt(num('duration')), opt(num('volume')), opt(num('env')), opt(num('ent')), opt(num('noise'))], checked: true }),
  stmt('ENV', 'firmware', 'ENV n, section ...', '9', { args: n(1, 16), note: 'Bare mode: not in 1.0 (use the music/sfx library).', params: [num('n'), rep(opt(num('section')))], checked: true }),
  stmt('ENT', 'firmware', 'ENT n, section ...', '9', { args: n(1, 16), note: 'Bare mode: not in 1.0 (use the music/sfx library).', params: [num('n'), rep(opt(num('section')))], checked: true }),
  stmt('RELEASE', 'firmware', 'RELEASE channels', '9', { args: n(1), note: 'Bare mode: not in 1.0 (use the music/sfx library).', params: [num('channels')], checked: true }),
  fn('SQ', 'firmware', 'SQ(channel)', '9', 'UBYTE', { note: 'Bare mode: not in 1.0 (use the music/sfx library).', params: [num('channel')], checked: true }),
  fn('DERR', 'firmware', 'DERR', '9', 'INTEGER', { parens: 'none', args: R, note: 'Last disc error code.', params: [] }),

  // ---- Time and timers (9) ----
  fn('TIME', 'compiled', 'TIME', '9', 'ULONG', { parens: 'none', args: R, note: '300 Hz counter.', params: [] }),
  stmt('FRAME', 'compiled', 'FRAME', '9', { note: 'Waits for the frame flyback.', params: [] }),

  // ---- Numbers and maths (9) ----
  fn('ABS', 'compiled', 'ABS(x)', '9', 'numeric', { params: [num('x')], checked: true }),
  fn('INT', 'compiled', 'INT(x)', '9', 'numeric', { note: 'Floor.', params: [num('x')], checked: true }),
  fn('FIX', 'compiled', 'FIX(x)', '9', 'numeric', { note: 'Truncate towards zero.', params: [num('x')], checked: true }),
  fn('ROUND', 'compiled', 'ROUND(x [, n])', '9', 'REAL', { args: n(1, 2), params: [num('x'), opt(int('places'))] }),
  fn('SGN', 'compiled', 'SGN(x)', '9', 'INTEGER', { params: [num('x')], checked: true }),
  fn('SQR', 'compiled', 'SQR(x)', '9', 'REAL', { params: [num('x')] }),
  fn('SIN', 'compiled', 'SIN(x)', '9', 'REAL', { params: [num('x')] }),
  fn('COS', 'compiled', 'COS(x)', '9', 'REAL', { params: [num('x')] }),
  fn('TAN', 'compiled', 'TAN(x)', '9', 'REAL', { params: [num('x')] }),
  fn('ATN', 'compiled', 'ATN(x)', '9', 'REAL', { params: [num('x')] }),
  fn('EXP', 'compiled', 'EXP(x)', '9', 'REAL', { params: [num('x')] }),
  fn('LOG', 'compiled', 'LOG(x)', '9', 'REAL', { params: [num('x')] }),
  fn('LOG10', 'compiled', 'LOG10(x)', '9', 'REAL', { params: [num('x')] }),
  fn('PI', 'compiled', 'PI', '9', 'REAL', { parens: 'none', args: R, params: [] }),
  fn('MIN', 'compiled', 'MIN(a [, b ...])', '9', 'numeric', { args: n(1, Infinity), params: [rep(num('a'))], checked: true }),
  fn('MAX', 'compiled', 'MAX(a [, b ...])', '9', 'numeric', { args: n(1, Infinity), params: [rep(num('a'))], checked: true }),
  fn('CINT', 'compiled', 'CINT(x)', '9', 'INTEGER', { note: 'Rounds.', params: [num('x')], checked: true }),
  fn('CREAL', 'compiled', 'CREAL(x)', '9', 'REAL', { params: [num('x')], checked: true }),
  fn('UNT', 'compiled', 'UNT(n)', '9', 'INTEGER', { params: [num('n')], checked: true }),
  fn('RND', 'compiled', 'RND [(x)]', '9', 'REAL', { parens: 'optional', args: n(0, 1), params: [opt(num('x'))], checked: true }),
  stmt('RANDOMIZE', 'compiled', 'RANDOMIZE [n]', '9', { args: n(0, 1), note: 'No argument: seeds from TIME (never prompts).', params: [opt(num('seed'))] }),
  fn('RANDOM', 'compiled', 'RANDOM(n)', '9', 'UINTEGER', { note: 'Fast integer 0..n-1 (new).', params: [int('n')], checked: true }),
  stmt('DEG', 'compiled', 'DEG', '9', { params: [] }),
  stmt('RAD', 'compiled', 'RAD', '9', { params: [] }),

  // ---- Memory and machine (9) ----
  fn('HIMEM', 'compiled', 'HIMEM', '9', 'UINTEGER', { parens: 'none', args: R, params: [] }),
  stmt('MEMORY', 'compiled', 'MEMORY n', '9', { args: n(1), note: 'Adjusts the heap top at build time: a constant.', params: [addr('top')] }),
  fn('FRE', 'compiled', 'FRE(0) | FRE("")', '9', 'UINTEGER', { params: [any('x')] }),

  // ---- Files (9) ----
  stmt('LOAD', 'firmware', 'LOAD "name" [, address]', '9', { args: n(1, 2), params: [str('name'), opt(addr('address'))] }),
  stmt('SAVE', 'firmware', 'SAVE "name"[, A|P|B[, address, length [, entry]]]', '9', { args: n(1, 5), note: 'The file-type letter (A, P or B) is a bare name; A and P (BASIC text, protected BASIC) have no meaning for a compiled program.', params: [str('name'), opt(ident('type')), opt(addr('address')), opt(int('length')), opt(addr('entry'))] }),
  stmt('CAT', 'firmware', 'CAT', '9', { params: [] }),
  stmt('OPENIN', 'firmware', 'OPENIN "name"', '9', { args: n(1), params: [str('name')] }),
  stmt('CLOSEIN', 'firmware', 'CLOSEIN', '9', { params: [] }),
  fn('EOF', 'firmware', 'EOF', '9', 'INTEGER', { parens: 'none', args: R, params: [] }),
  stmt('OPENOUT', 'firmware', 'OPENOUT "name"', '9', { args: n(1), params: [str('name')] }),
  stmt('CLOSEOUT', 'firmware', 'CLOSEOUT', '9', { params: [] }),
  special('WRITE', 'firmware', 'WRITE [#s,] items', '9', { note: 'Strings are written in quotes, the items separated by commas; the stream is #9 (the file) or a screen stream.' }),
  special('CHAIN', 'firmware', 'CHAIN "name"', '9', { note: 'Loads another binary (its AMSDOS header gives the load and entry addresses) and starts it. CHAIN MERGE and BASIC programs are not supported.' }),
  special('MERGE', 'later', 'MERGE "name"', '16', { hint: 'Put the shared code in one program with #include.' }),
  special('RUN', 'later', 'RUN "name"', '16', { hint: 'RUN is not in 1.0: use GOTO to restart at a line, or LOAD and CALL to start another part.' }),

  // ---- Interpreter commands (accepted only to say why not) ----
  ...['AUTO', 'DELETE', 'EDIT', 'LIST', 'NEW', 'RENUM', 'CONT', 'TRON', 'TROFF'].map((w) =>
    soft(w, 'statement', 'dropped', w, '9', NOT_IN_COMPILER),
  ),

  // ---- Modern layer (10) ----
  special('ASM', 'compiled', 'ASM ... END ASM', '10', { note: 'Raw Z80 in the runtime dialect; #line keeps errors on the BASIC line.' }),

  // ---- Sinclair forms (11) ----
  soft('PRINT AT', 'statement', 'alias', 'PRINT AT row, col; items', '11', 'PRINT AT is 0-based, row first: LOCATE col+1, row+1.', { aliasOf: 'LOCATE' }),
  stmt('BEEP', 'alias', 'BEEP duration, pitch', '11', { args: n(2), aliasOf: 'SOUND', params: [num('duration'), num('pitch')], checked: true }),
  stmt('PAUSE', 'alias', 'PAUSE n', '11', { args: n(1), note: 'n frames.', params: [int('frames')] }),
  stmt('CIRCLE', 'alias', 'CIRCLE x, y, r', '11', { args: n(3), note: 'Not Locomotive; the runtime has it.', params: [int('x'), int('y'), int('r')], checked: true }),
  fn('POINT', 'alias', 'POINT(x, y)', '11', 'UBYTE', { args: n(2), aliasOf: 'TEST', params: [int('x'), int('y')], checked: true }),
  soft('ATTR', 'function', 'dropped', 'ATTR(r, c)', '11', 'The CPC has no attribute model.', { returns: 'UBYTE' }),
  soft('OVER', 'statement', 'dropped', 'OVER n', '11', 'For XOR drawing use GRAPHICS PEN n, 1.'),
  soft('INVERSE', 'statement', 'dropped', 'INVERSE n', '11', 'Swap PEN and PAPER instead.'),
  soft('FLASH', 'statement', 'dropped', 'FLASH n', '11', 'Use INK n, c1, c2 for flashing colours.'),
  soft('BRIGHT', 'statement', 'dropped', 'BRIGHT n', '11', 'The CPC has no BRIGHT; choose a brighter INK colour.'),
  soft('BOLD', 'statement', 'dropped', 'BOLD n', '11', 'Not available on the CPC.'),
  soft('ITALIC', 'statement', 'dropped', 'ITALIC n', '11', 'Not available on the CPC.'),
  soft('SCREEN$', 'function', 'dropped', 'SCREEN$(r, c)', '11', 'Use LOCATE then COPYCHR$(#0).', { returns: 'STRING' }),
  soft('USR', 'function', 'dropped', 'USR addr', '11', 'Use CALL addr, or a FUNCTION with an ASM body.', { returns: 'UINTEGER' }),

  // ---- Preprocessor (10) ----
  ...(
    [
      ['#include', '#include ["f" | <f>] | #include once ["f" | <f>]'],
      ['#define', '#define NAME [value] | #define NAME(a, b) body'],
      ['#undef', '#undef NAME'],
      ['#ifdef', '#ifdef NAME'],
      ['#ifndef', '#ifndef NAME'],
      ['#if', '#if expression'],
      ['#elif', '#elif expression'],
      ['#else', '#else'],
      ['#endif', '#endif'],
      ['#error', '#error "message"'],
      ['#warning', '#warning "message"'],
      ['#line', '#line n ["file"]'],
      ['#pragma', '#pragma name = value | #pragma push(name) | #pragma pop(name)'],
      ['#require', '#require "file.asm"'],
      ['#init', '#init label'],
    ] as const
  ).map(([name, syntax]): KeywordEntry => ({ name, kind: 'preprocessor', status: 'compiled', reserved: false, syntax, section: '10' })),
];

// ---------------------------------------------------------------------------
// Derived lookups
// ---------------------------------------------------------------------------

/** Every reserved word (upper case, `$` included), from the words of all reserved entries. */
export const RESERVED_WORDS: ReadonlySet<string> = new Set(
  KEYWORDS.filter((k) => k.reserved && k.kind !== 'preprocessor').flatMap((k) => k.name.split(' ')),
);

/** Upper-case words of the soft entries that are not reserved elsewhere (dropped/later/alias names that stay usable as identifiers). */
export const SOFT_WORDS: ReadonlySet<string> = new Set(
  KEYWORDS.filter((k) => !k.reserved && k.kind !== 'preprocessor')
    .flatMap((k) => k.name.split(' '))
    .filter((w) => !RESERVED_WORDS.has(w)),
);

const byName = new Map<string, KeywordEntry[]>();
for (const k of KEYWORDS) {
  const list = byName.get(k.name);
  if (list) list.push(k);
  else byName.set(k.name, [k]);
}

/** All entries with this canonical name (case-insensitive; multi-word names with single spaces). */
export function lookupKeyword(name: string): readonly KeywordEntry[] {
  return byName.get(name.toUpperCase().replace(/\s+/g, ' ')) ?? [];
}

/** The entry of `name` with `kind`, if any. */
export function keywordOf(name: string, kind: KeywordKind): KeywordEntry | undefined {
  return lookupKeyword(name).find((k) => k.kind === kind);
}

/** True when `word` (one word, any case) is reserved. */
export function isReserved(word: string): boolean {
  return RESERVED_WORDS.has(word.toUpperCase());
}
