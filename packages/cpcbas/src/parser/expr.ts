/**
 * The expression grammar (spec §5), by precedence climbing, plus the small pieces
 * statements share: names, types, l-values, jump targets and argument lists.
 *
 * Levels, lowest first: XOR, OR, AND, NOT (prefix), comparisons, shifts, + -,
 * MOD, \, * /, unary + -, ^ (Locomotive's table: `*` and `/` bind tighter than `\`,
 * which binds tighter than MOD, so `7 MOD 4 \ 2` is `7 MOD (4 \ 2)`). `^` is left-associative and binds tighter than unary
 * minus (`-2^2` is -4); its right operand may carry a sign (`2^-1`).
 *
 * Errors: a bad expression becomes a `BadExpr` and the statement loop resynchronises;
 * the cursor allows one diagnostic per statement.
 */

import type {
  BinaryOp,
  BuiltinCall,
  Expr,
  JumpTarget,
  LValue,
  Name,
  TypeName,
  TypeRef,
} from '../ast/ast.js';
import { joinSpans } from '../core/source.js';
import type { Span } from '../core/source.js';
import type { IdentifierToken, KeywordToken, Token } from '../core/tokens.js';
import { keywordOf, lookupKeyword } from '../lang/keywords.js';
import type { KeywordEntry } from '../lang/keywords.js';
import { MAX_DEPTH } from './cursor.js';
import type { Cursor } from './cursor.js';

// ---- precedence ------------------------------------------------------------

const PREC_XOR = 1;
const PREC_OR = 2;
const PREC_AND = 3;
const PREC_CMP = 5;
const PREC_SHIFT = 6;
const PREC_ADD = 7;
const PREC_MOD = 8;
const PREC_IDIV = 9;
const PREC_MUL = 10;

interface BinInfo {
  readonly op: BinaryOp;
  readonly prec: number;
  /** For bAND, bOR, bXOR: the Boriel spelling (E960 is reported). */
  readonly soft: string | null;
}

const PUNCT_OPS: Readonly<Record<string, BinInfo>> = {
  '=': { op: '=', prec: PREC_CMP, soft: null },
  '<>': { op: '<>', prec: PREC_CMP, soft: null },
  '<': { op: '<', prec: PREC_CMP, soft: null },
  '>': { op: '>', prec: PREC_CMP, soft: null },
  '<=': { op: '<=', prec: PREC_CMP, soft: null },
  '>=': { op: '>=', prec: PREC_CMP, soft: null },
  '=<': { op: '<=', prec: PREC_CMP, soft: null },
  '=>': { op: '>=', prec: PREC_CMP, soft: null },
  '<<': { op: '<<', prec: PREC_SHIFT, soft: null },
  '>>': { op: '>>', prec: PREC_SHIFT, soft: null },
  '+': { op: '+', prec: PREC_ADD, soft: null },
  '-': { op: '-', prec: PREC_ADD, soft: null },
  '*': { op: '*', prec: PREC_MUL, soft: null },
  '/': { op: '/', prec: PREC_MUL, soft: null },
  '\\': { op: '\\', prec: PREC_IDIV, soft: null },
};

const KEYWORD_OPS: Readonly<Record<string, BinInfo>> = {
  XOR: { op: 'XOR', prec: PREC_XOR, soft: null },
  OR: { op: 'OR', prec: PREC_OR, soft: null },
  AND: { op: 'AND', prec: PREC_AND, soft: null },
  MOD: { op: 'MOD', prec: PREC_MOD, soft: null },
};

const SOFT_OPS: Readonly<Record<string, BinInfo>> = {
  BAND: { op: 'AND', prec: PREC_AND, soft: 'bAND' },
  BOR: { op: 'OR', prec: PREC_OR, soft: 'bOR' },
  BXOR: { op: 'XOR', prec: PREC_XOR, soft: 'bXOR' },
};

function has(table: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(table, key);
}

function binaryInfo(t: Token): BinInfo | null {
  if (t.kind === 'Keyword') return has(KEYWORD_OPS, t.keyword) ? (KEYWORD_OPS[t.keyword] as BinInfo) : null;
  if (t.kind === 'Identifier' && t.suffix === null) {
    const up = t.name.toUpperCase();
    return has(SOFT_OPS, up) ? (SOFT_OPS[up] as BinInfo) : null;
  }
  return has(PUNCT_OPS, t.kind) ? (PUNCT_OPS[t.kind] as BinInfo) : null;
}

// ---- small pieces ----------------------------------------------------------

export function nameOf(t: IdentifierToken): Name {
  return { kind: 'Name', span: t.span, text: t.name, base: t.name.toLowerCase(), suffix: t.suffix };
}

const TYPE_NAMES: ReadonlySet<string> = new Set(['UBYTE', 'BYTE', 'UINTEGER', 'INTEGER', 'ULONG', 'LONG', 'FIXED', 'REAL', 'STRING']);

/** True when the token is a type name (UBYTE ... STRING, FLOAT). */
export function isTypeToken(t: Token): t is KeywordToken {
  return t.kind === 'Keyword' && (TYPE_NAMES.has(t.keyword) || t.keyword === 'FLOAT');
}

/** Consumes a type name into a TypeRef (FLOAT becomes REAL); E149 when there is none. */
export function parseTypeRef(c: Cursor): TypeRef | null {
  const t = c.peek();
  if (!isTypeToken(t)) {
    c.errorHere('E149', `Expected a type name, found ${c.describe(t)}`);
    return null;
  }
  c.next();
  const name = (t.keyword === 'FLOAT' ? 'REAL' : t.keyword) as TypeName;
  return { kind: 'TypeRef', span: t.span, name, text: t.text };
}

/** The `(`...`)` of a call or an index: `{args, span}` of the whole parenthesis. The cursor is at `(`. */
export function parseParenArgs(c: Cursor): { args: Expr[]; span: Span } {
  const open = c.next();
  const args: Expr[] = [];
  if (!c.at(')')) {
    for (;;) {
      if (c.atKw('TO')) args.push(slicing(c));
      else {
        args.push(parseExpr(c));
        if (c.atKw('TO')) args[args.length - 1] = slicing(c);
      }
      if (!c.accept(',')) break;
    }
  }
  if (!c.accept(')')) {
    c.error('E143', open.span, 'Missing closing parenthesis for this (', "Add the missing ')'.");
  }
  return { args, span: c.spanFrom(open.span) };
}

/**
 * The cursor is at a `TO` inside a subscript or call: the Sinclair/Boriel slice `a$(2 TO 4)`.
 * Reports E962 at the TO, reads the end of the slice, and gives a BadExpr for the argument.
 */
function slicing(c: Cursor): Expr {
  const to = c.next();
  c.error('E962', to.span, 'String slicing (start TO end) is not CPC BASIC');
  if (!c.at(')') && !c.at(',')) parseExpr(c);
  return bad(c.spanFrom(to.span));
}

/**
 * A reserved word where a name belongs (`SUB Pause()`, `DIM line`, `FOR test = ...`): E152 with
 * a hint, instead of the generic "unexpected" error. True when it reported.
 */
export function reservedAsName(c: Cursor, t: Token = c.peek()): boolean {
  if (t.kind !== 'Keyword') return false;
  c.error(
    'E152',
    t.span,
    `${t.keyword} is a reserved word and cannot be used as a name`,
    `Choose another name, for example my${t.text === '?' ? 'Print' : t.text}. Every keyword of the language is reserved, the Locomotive BASIC ones included.`,
  );
  return true;
}

/** A comma-separated list of one or more expressions (no parentheses). */
export function parseExprList(c: Cursor): Expr[] {
  const out: Expr[] = [];
  for (;;) {
    out.push(parseExpr(c));
    if (!c.accept(',')) break;
  }
  return out;
}

/** A comma-separated list in which an argument may be empty (`1, , 3`); empty slots are null. Stops at the end of the statement. */
export function parseArgSlots(c: Cursor): Array<Expr | null> {
  const out: Array<Expr | null> = [];
  for (;;) {
    if (c.at(',') || c.atStatementEnd()) out.push(null);
    else out.push(parseExpr(c));
    if (!c.accept(',')) break;
  }
  return out;
}

/** A variable or an element: `a`, `a$`, `a(i, j)`. E150 (and null) when the next token is not a name. */
export function parseLValue(c: Cursor): LValue | null {
  const t = c.peek();
  if (t.kind !== 'Identifier') {
    if (!reservedAsName(c, t)) c.errorHere('E150', `Expected a variable, found ${c.describe(t)}`);
    return null;
  }
  c.next();
  const name = nameOf(t);
  if (!c.at('(')) return name;
  const { args, span } = parseParenArgs(c);
  return { kind: 'CallOrIndex', span: joinSpans(t.span, span), callee: name, args };
}

/** A jump target: a whole line number or a label name. E148 (and null) otherwise. */
export function parseJumpTarget(c: Cursor): JumpTarget | null {
  const t = c.peek();
  if (t.kind === 'Number' && !t.isReal && t.suffix === null) {
    c.next();
    return { kind: 'LineTarget', span: t.span, number: t.value };
  }
  if (t.kind === 'LineNumber') {
    c.next();
    return { kind: 'LineTarget', span: t.span, number: t.value };
  }
  if (t.kind === 'Identifier' && t.suffix === null) {
    c.next();
    return { kind: 'LabelTarget', span: t.span, name: t.name, key: t.key };
  }
  c.errorHere('E148', `Expected a line number or a label, found ${c.describe(t)}`);
  return null;
}

// ---- expressions -------------------------------------------------------------

function bad(span: Span): Expr {
  return { kind: 'BadExpr', span };
}

/** An empty span at the start of the current token, for a BadExpr that consumed nothing. */
function here(c: Cursor): Span {
  const s = c.peek().span;
  return { file: s.file, start: s.start, end: s.start };
}

/** Parses one expression. On error it reports (once per statement) and returns a BadExpr. */
export function parseExpr(c: Cursor): Expr {
  if (c.depth >= MAX_DEPTH) {
    c.errorHere('E151', 'Expression is nested too deeply');
    return bad(here(c));
  }
  c.depth++;
  try {
    return parseBinary(c, PREC_XOR);
  } finally {
    c.depth--;
  }
}

function parseBinary(c: Cursor, min: number): Expr {
  let left = parseUnary(c);
  for (;;) {
    const t = c.peek();
    const info = binaryInfo(t);
    if (!info || info.prec < min) return left;
    c.next();
    if (info.soft !== null) softOperator(c, t, info.soft, info.op);
    const right = parseBinary(c, info.prec + 1);
    left = { kind: 'Binary', span: joinSpans(left.span, right.span), op: info.op, left, right };
  }
}

function softOperator(c: Cursor, t: Token, written: string, use: string): void {
  c.diag.report('E960', t.span, `${written} is not CPC BASIC: use ${use}`, `${use} is already bitwise.`);
}

/** Tokens that begin an operand, for telling `bNOT a` from a variable called bnot. */
function startsOperand(t: Token): boolean {
  switch (t.kind) {
    case 'Number':
    case 'String':
    case 'Identifier':
    case '(':
    case '@':
      return true;
    case 'Keyword':
      return !has(KEYWORD_OPS, t.keyword) && t.keyword !== 'THEN' && t.keyword !== 'ELSE' && t.keyword !== 'TO' && t.keyword !== 'STEP';
    default:
      return false;
  }
}

function parseUnary(c: Cursor): Expr {
  const t = c.peek();
  if (t.kind === '-' || t.kind === '+') {
    c.next();
    if (c.depth >= MAX_DEPTH) {
      c.errorHere('E151', 'Expression is nested too deeply');
      return bad(here(c));
    }
    c.depth++;
    try {
      const operand = parseUnary(c);
      return { kind: 'Unary', span: joinSpans(t.span, operand.span), op: t.kind, operand };
    } finally {
      c.depth--;
    }
  }
  const isNot = t.kind === 'Keyword' && t.keyword === 'NOT';
  const isSoftNot = t.kind === 'Identifier' && t.suffix === null && t.name.toUpperCase() === 'BNOT' && startsOperand(c.peek(1));
  if (isNot || isSoftNot) {
    c.next();
    if (isSoftNot) softOperator(c, t, 'bNOT', 'NOT');
    if (c.depth >= MAX_DEPTH) {
      c.errorHere('E151', 'Expression is nested too deeply');
      return bad(here(c));
    }
    c.depth++;
    try {
      // NOT sits below the comparisons: `NOT a = b` is NOT (a = b).
      const operand = parseBinary(c, PREC_CMP);
      return { kind: 'Unary', span: joinSpans(t.span, operand.span), op: 'NOT', operand };
    } finally {
      c.depth--;
    }
  }
  return parsePower(c);
}

function parsePower(c: Cursor): Expr {
  let base = parsePrimary(c);
  while (c.at('^')) {
    c.next();
    const right = parsePowerOperand(c);
    base = { kind: 'Binary', span: joinSpans(base.span, right.span), op: '^', left: base, right };
  }
  return base;
}

function parsePowerOperand(c: Cursor): Expr {
  const t = c.peek();
  if (t.kind === '-' || t.kind === '+') {
    c.next();
    if (c.depth >= MAX_DEPTH) {
      c.errorHere('E151', 'Expression is nested too deeply');
      return bad(here(c));
    }
    c.depth++;
    try {
      const operand = parsePowerOperand(c);
      return { kind: 'Unary', span: joinSpans(t.span, operand.span), op: t.kind, operand };
    } finally {
      c.depth--;
    }
  }
  return parsePrimary(c);
}

function parsePrimary(c: Cursor): Expr {
  const t = c.peek();
  switch (t.kind) {
    case 'Number':
      c.next();
      return { kind: 'NumberLit', span: t.span, value: t.value, text: t.text, radix: t.radix, isReal: t.isReal, suffix: t.suffix };
    case 'String':
      c.next();
      return { kind: 'StringLit', span: t.span, value: t.value };
    case '(': {
      c.next();
      const inner = parseExpr(c);
      if (!c.accept(')')) c.error('E143', t.span, 'Missing closing parenthesis for this (', "Add the missing ')'.");
      return inner;
    }
    case '@': {
      c.next();
      const target = c.peek();
      if (target.kind !== 'Identifier') {
        const hint = target.kind === 'Number' ? 'A line number has no address: put a label on the line (name:) and write @name.' : undefined;
        c.errorHere('E141', `Expected a name after '@', found ${c.describe(target)}`, hint);
        return bad(c.spanFrom(t.span));
      }
      c.next();
      if (c.at('(')) {
        const { args, span } = parseParenArgs(c);
        return { kind: 'AddressOf', span: joinSpans(t.span, span), target: nameOf(target), index: args };
      }
      return { kind: 'AddressOf', span: joinSpans(t.span, target.span), target: nameOf(target) };
    }
    case 'LineNumber':
      // Only inside an expression that runs across lines (a DIM initialiser in braces): a
      // decimal integer that starts a physical line lexes as a line number.
      c.next();
      return { kind: 'NumberLit', span: t.span, value: t.value, text: t.text, radix: 10, isReal: false, suffix: null };
    case 'Identifier': {
      const dropped = droppedFunction(c, t);
      if (dropped) return dropped;
      c.next();
      const name = nameOf(t);
      if (!c.at('(')) return name;
      const { args, span } = parseParenArgs(c);
      return { kind: 'CallOrIndex', span: joinSpans(t.span, span), callee: name, args };
    }
    case 'Keyword':
      return parseKeywordExpr(c, t);
    case 'Invalid':
      c.next();
      c.errored = true;
      return bad(t.span);
    default:
      c.errorHere('E142', `Expected an expression, found ${c.describe(t)}`);
      return bad(here(c));
  }
}

/**
 * The dropped Sinclair functions (soft words of kind function, status dropped: ATTR, SCREEN$,
 * USR) used as one: `ATTR(1, 1)`, `SCREEN$(r, c)`, `USR 32768`. E961 at the name with the
 * entry's hint; the use is read and becomes a BadExpr. The word alone stays a variable.
 */
function droppedFunction(c: Cursor, t: IdentifierToken): Expr | null {
  const entry = lookupKeyword(t.name + (t.suffix ?? '')).find((k) => k.kind === 'function' && k.status === 'dropped');
  if (!entry) return null;
  const after = c.peek(1);
  const call = after.kind === '(';
  // USR takes its operand without parentheses: `USR 32768`, `USR @code`.
  const bare = !call && entry.name === 'USR' && (after.kind === 'Number' || after.kind === 'Identifier' || after.kind === '@');
  if (!call && !bare) return null;
  c.next();
  c.error('E961', t.span, `${entry.name} is a Sinclair function that CPC BASIC does not have`, entry.hint);
  if (call) parseParenArgs(c);
  else parsePowerOperand(c);
  return bad(c.spanFrom(t.span));
}

function parseKeywordExpr(c: Cursor, t: KeywordToken): Expr {
  if (t.keyword === 'FN') return parseFnCall(c, t);
  const entry = keywordOf(t.keyword, 'function');
  if (entry) return parseBuiltin(c, t, entry);
  c.errorHere('E142', `Expected an expression, found ${c.describe(t)}`);
  return bad(here(c));
}

function parseFnCall(c: Cursor, kw: KeywordToken): Expr {
  c.next();
  const id = c.peek();
  if (id.kind !== 'Identifier') {
    c.errorHere('E141', `Expected a function name after FN, found ${c.describe(id)}`);
    return bad(kw.span);
  }
  c.next();
  let args: Expr[] = [];
  let end = id.span;
  if (c.at('(')) {
    const p = parseParenArgs(c);
    args = p.args;
    end = p.span;
  }
  return { kind: 'FnCall', span: joinSpans(kw.span, end), name: nameOf(id), args };
}

function arityText(n: number): string {
  return `${n} argument${n === 1 ? '' : 's'}`;
}

function arityWords(min: number, max: number): string {
  if (min === max) return arityText(min);
  if (max === Infinity) return `at least ${arityText(min)}`;
  return `${min} to ${max} arguments`;
}

/** Arity check shared by functions and (via {@link checkArity}) the generic statements: E147 at `at`, with the syntax as the hint. */
export function checkArity(c: Cursor, entry: KeywordEntry, at: Span, count: number): void {
  const a = entry.args ?? { min: 0, max: Infinity };
  if (count >= a.min && count <= a.max) return;
  c.error('E147', at, `${entry.name} takes ${arityWords(a.min, a.max)}, ${count} given`, `Syntax: ${entry.syntax}`);
}

function parseBuiltin(c: Cursor, kw: KeywordToken, entry: KeywordEntry): Expr {
  c.next();
  if (entry.context === 'print') {
    c.error('E146', kw.span, `${entry.name} only works inside PRINT`);
  }
  const mode = entry.parens ?? 'required';
  const make = (end: Span, args: Expr[], stream: Expr | null, typeArg: TypeRef | null, parens: boolean): BuiltinCall => ({
    kind: 'BuiltinCall',
    span: joinSpans(kw.span, end),
    keyword: entry.name,
    args,
    stream,
    typeArg,
    parens,
  });
  if (mode === 'none' || (mode === 'optional' && !c.at('('))) {
    checkArity(c, entry, kw.span, 0);
    return make(kw.span, [], null, null, false);
  }
  if (!c.at('(')) {
    c.unexpected(`'(' after ${entry.name}`, `Syntax: ${entry.syntax}`);
    return make(kw.span, [], null, null, false);
  }
  const open = c.next();
  let typeArg: TypeRef | null = null;
  let stream: Expr | null = null;
  const args: Expr[] = [];
  let first = true;
  if (entry.typeArg && isTypeToken(c.peek())) {
    typeArg = parseTypeRef(c);
    first = c.accept(',') !== null;
    if (!first && !c.at(')')) c.unexpected("',' or ')'", `Syntax: ${entry.syntax}`);
  } else if (entry.typeArg === 'required') {
    c.errorHere('E149', `${entry.name} needs a type as its first argument`, `Syntax: ${entry.syntax}`);
  }
  if (entry.stream && first && c.at('#')) {
    c.next();
    stream = parseExpr(c);
    first = c.accept(',') !== null;
    if (!first && !c.at(')')) c.unexpected("',' or ')'", `Syntax: ${entry.syntax}`);
  } else if (entry.stream && first && entry.args?.max === 0) {
    c.unexpected(`'#' and a stream number`, `Syntax: ${entry.syntax}`);
  }
  if (first && !c.at(')')) {
    for (;;) {
      args.push(parseExpr(c));
      if (!c.accept(',')) break;
    }
  }
  checkArity(c, entry, kw.span, args.length);
  if (!c.accept(')')) c.error('E143', open.span, 'Missing closing parenthesis for this (', "Add the missing ')'.");
  return make(c.prevSpan, args, stream, typeArg, true);
}

/** True when a keyword is a function name in lang/keywords.ts (used by statements to tell a call from a statement word). */
export function isFunctionKeyword(word: string): boolean {
  return lookupKeyword(word).some((k) => k.kind === 'function');
}
