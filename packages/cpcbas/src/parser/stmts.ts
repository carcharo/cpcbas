/**
 * Statement table of L1-PSTMT: PRINT, INPUT and LINE INPUT, DATA/READ/RESTORE, the MID$
 * statement, CALL and RSX bar commands, the table-driven built-in statements
 * (`form: 'builtin'` in lang/keywords.ts), ASM blocks, the directives that reach the
 * parser (`#pragma`, `#require`, `#init`; the statement loop drops `#line`) and the compatibility diagnostics:
 * dropped Sinclair statements (E900/E901), interpreter commands (E980) and statements
 * that are not in 1.0 (E981).
 *
 * The built-in tables are derived from `KEYWORDS`, so a new entry there needs no code here.
 * RESUME belongs to the control-flow task.
 */

import type { Expr, LValue, PrintItem, Stmt, StringLit, TypeRef } from '../ast/ast.js';
import type { Span } from '../core/source.js';
import { KEYWORDS, keywordOf } from '../lang/keywords.js';
import type { KeywordEntry } from '../lang/keywords.js';
import type { Token } from '../core/tokens.js';
import { isFunctionKeyword, isTypeToken } from './expr.js';
import type { ParserContext, StatementParser, StatementParsers } from './types.js';

/** Largest number of parameters of CALL and of an RSX command (spec section 18). */
const MAX_CALL_PARAMS = 32;

// ---- PRINT --------------------------------------------------------------------

/** True when the token can begin a PRINT item: an expression, TAB, SPC, AT or USING. */
function startsPrintItem(t: Token): boolean {
  switch (t.kind) {
    case 'Number':
    case 'String':
    case 'Identifier':
    case '(':
    case '@':
    case '-':
    case '+':
      return true;
    case 'Keyword':
      return t.keyword === 'NOT' || t.keyword === 'FN' || t.keyword === 'AT' || t.keyword === 'USING' || t.keyword === 'TAB' || t.keyword === 'SPC' || isFunctionKeyword(t.keyword);
    default:
      return false;
  }
}

function parsePrint(ctx: ParserContext): Stmt {
  const c = ctx.cursor;
  const kw = c.next();
  let stream: Expr | null = null;
  if (c.at('#')) {
    c.next();
    stream = ctx.parseExpr();
    if (!c.errored && !c.accept(',') && !c.atStatementEnd()) c.unexpected("',' after the stream number");
  }
  const items: PrintItem[] = [];
  // True after an item and before a separator.
  let afterItem = false;
  while (!c.errored && !c.atStatementEnd()) {
    const t = c.peek();
    if (t.kind === ';' || t.kind === ',') {
      c.next();
      items.push({ kind: 'PrintSep', span: t.span, sep: t.kind });
      afterItem = false;
      continue;
    }
    // Items with no separator between them print adjacent (Locomotive); a token that cannot
    // start an item is left for the statement loop to report as E144.
    if (afterItem && !startsPrintItem(t)) break;
    afterItem = true;
    if (t.kind === 'Keyword' && t.keyword === 'AT') {
      c.next();
      const row = ctx.parseExpr();
      if (c.errored || !c.expect(',', "',' between the row and the column")) break;
      const col = ctx.parseExpr();
      items.push({ kind: 'PrintAt', span: c.spanFrom(t.span), row, col });
    } else if (t.kind === 'Keyword' && t.keyword === 'USING') {
      c.next();
      const format = ctx.parseExpr();
      items.push({ kind: 'PrintUsing', span: c.spanFrom(t.span), format });
    } else if (t.kind === 'Keyword' && (t.keyword === 'TAB' || t.keyword === 'SPC')) {
      c.next();
      const open = c.expect('(', `'(' after ${t.keyword}`);
      if (!open) break;
      const arg = ctx.parseExpr();
      if (!c.errored && !c.accept(')')) ctx.error('E143', open.span, 'Missing closing parenthesis for this (', "Add the missing ')'.");
      const span = c.spanFrom(t.span);
      items.push(t.keyword === 'TAB' ? { kind: 'PrintTab', span, column: arg } : { kind: 'PrintSpc', span, count: arg });
    } else {
      const expr = ctx.parseExpr();
      items.push({ kind: 'PrintExpr', span: expr.span, expr });
    }
  }
  if (c.errored) return ctx.badStmt(kw.span);
  return { kind: 'Print', span: c.spanFrom(kw.span), stream, items };
}

// ---- INPUT, DATA, READ, RESTORE ---------------------------------------------------

/** One or more comma-separated variables; null after a diagnostic. */
function parseTargets(ctx: ParserContext): LValue[] | null {
  const targets: LValue[] = [];
  for (;;) {
    const target = ctx.parseLValue();
    if (!target) return null;
    targets.push(target);
    if (!ctx.cursor.accept(',')) return targets;
  }
}

function parseInput(ctx: ParserContext): Stmt {
  const c = ctx.cursor;
  const kw = c.next();
  const line = kw.kind === 'Keyword' && kw.keyword === 'LINE';
  if (line && !c.expectKw('INPUT')) return ctx.badStmt(kw.span);
  let stream: Expr | null = null;
  if (c.at('#')) {
    c.next();
    stream = ctx.parseExpr();
    if (c.errored || !c.expect(',', "',' after the stream number")) return ctx.badStmt(kw.span);
  }
  const keepCursor = c.accept(';') !== null;
  let prompt: StringLit | null = null;
  let promptSep: ';' | ',' | null = null;
  const p = c.peek();
  if (p.kind === 'String' && (c.at(';', 1) || c.at(',', 1))) {
    c.next();
    prompt = { kind: 'StringLit', span: p.span, value: p.value };
    promptSep = c.next().kind === ';' ? ';' : ',';
  }
  const targets = parseTargets(ctx);
  if (!targets) return ctx.badStmt(kw.span);
  const extra = targets[1];
  if (line && extra) {
    ctx.error('E190', extra.span);
    return ctx.badStmt(kw.span);
  }
  return { kind: 'Input', span: c.spanFrom(kw.span), line, stream, prompt, promptSep, keepCursor, targets };
}

/** `WRITE [#s,] expr, expr ...` (L4-FILES): the stream and the items are all optional. */
function parseWrite(ctx: ParserContext): Stmt {
  const c = ctx.cursor;
  const kw = c.next();
  let stream: Expr | null = null;
  if (c.at('#')) {
    c.next();
    stream = ctx.parseExpr();
    if (!c.errored && !c.accept(',') && !c.atStatementEnd()) c.unexpected("',' after the stream number", 'Syntax: WRITE [#s,] items');
  }
  const items: Expr[] = [];
  if (!c.errored && !c.atStatementEnd()) {
    for (;;) {
      items.push(ctx.parseExpr());
      if (c.errored) break;
      const sep = c.peek();
      if (!c.accept(',') && !c.accept(';')) break;
      // `;` separates items as `,` does (measured on the interpreter); a separator with nothing after it is Operand missing
      if (c.atStatementEnd()) {
        ctx.error('E191', sep.span);
        return ctx.badStmt(kw.span);
      }
    }
  }
  if (c.errored) return ctx.badStmt(kw.span);
  return { kind: 'Write', span: c.spanFrom(kw.span), stream, items };
}

function parseData(ctx: ParserContext): Stmt {
  const c = ctx.cursor;
  const kw = c.next();
  const values = [];
  for (let t = c.peek(); t.kind === 'DataItem'; t = c.peek()) {
    c.next();
    values.push({ kind: 'DataValue' as const, span: t.span, raw: t.raw, quoted: t.quoted });
  }
  return { kind: 'Data', span: c.spanFrom(kw.span), values };
}

function parseRead(ctx: ParserContext): Stmt {
  const kw = ctx.cursor.next();
  const targets = parseTargets(ctx);
  if (!targets) return ctx.badStmt(kw.span);
  return { kind: 'Read', span: ctx.cursor.spanFrom(kw.span), targets };
}

function parseRestore(ctx: ParserContext): Stmt {
  const c = ctx.cursor;
  const kw = c.next();
  if (c.atStatementEnd()) return { kind: 'Restore', span: kw.span, target: null };
  const target = ctx.parseJumpTarget();
  if (!target) return ctx.badStmt(kw.span);
  return { kind: 'Restore', span: c.spanFrom(kw.span), target };
}

// ---- MID$, CALL, RSX ---------------------------------------------------------------

/** The MID$ function entry with the statement's syntax, so E147 shows `MID$(a$, p [, n]) = b$`. */
const MID_ENTRY: KeywordEntry | null = (() => {
  const fn = keywordOf('MID$', 'function');
  const st = keywordOf('MID$', 'statement');
  return fn && st ? { ...fn, syntax: st.syntax } : null;
})();

function parseMidAssign(ctx: ParserContext): Stmt {
  const c = ctx.cursor;
  const kw = c.next();
  const open = c.expect('(', "'(' after MID$");
  if (!open) return ctx.badStmt(kw.span);
  const target = ctx.parseLValue();
  if (!target) return ctx.badStmt(kw.span);
  const rest: Expr[] = [];
  while (!c.errored && c.accept(',')) rest.push(ctx.parseExpr());
  if (c.errored) return ctx.badStmt(kw.span);
  if (MID_ENTRY) ctx.checkArity(MID_ENTRY, kw.span, rest.length + 1);
  if (!c.errored && !c.accept(')')) ctx.error('E143', open.span, 'Missing closing parenthesis for this (', "Add the missing ')'.");
  if (!c.errored) c.expect('=', "'=' after MID$(...)");
  const start = rest[0];
  if (c.errored || !start) return ctx.badStmt(kw.span);
  const value = ctx.parseExpr();
  if (c.errored) return ctx.badStmt(kw.span);
  return { kind: 'MidAssign', span: c.spanFrom(kw.span), target, start, length: rest[1] ?? null, value };
}

function parseCall(ctx: ParserContext): Stmt {
  const c = ctx.cursor;
  const kw = c.next();
  const address = ctx.parseExpr();
  const args: Expr[] = [];
  while (!c.errored && c.accept(',')) args.push(ctx.parseExpr());
  if (!c.errored && args.length > MAX_CALL_PARAMS) {
    ctx.error('E185', kw.span, `CALL passes at most ${MAX_CALL_PARAMS} parameters, ${args.length} given`);
  }
  if (c.errored) return ctx.badStmt(kw.span);
  return { kind: 'Call', span: c.spanFrom(kw.span), address, args };
}

function parseRsx(ctx: ParserContext): Stmt {
  const c = ctx.cursor;
  const kw = c.next();
  if (kw.kind !== 'Rsx') return ctx.badStmt(kw.span);
  const args: Expr[] = [];
  if (c.accept(',')) {
    do args.push(ctx.parseExpr());
    while (!c.errored && c.accept(','));
  }
  if (!c.errored && args.length > MAX_CALL_PARAMS) {
    ctx.error('E185', kw.span, `|${kw.name} passes at most ${MAX_CALL_PARAMS} parameters, ${args.length} given`);
  }
  if (c.errored) return ctx.badStmt(kw.span);
  return { kind: 'Rsx', span: c.spanFrom(kw.span), name: kw.name, args };
}

// ---- the table-driven built-in statements -------------------------------------------

interface Slot {
  readonly expr: Expr | null;
  /** Where the slot starts (the comma or the end of the statement, for an empty one). */
  readonly at: Span;
}

/** Comma-separated argument slots; an empty slot has `expr: null`. */
function parseSlots(ctx: ParserContext): Slot[] {
  const c = ctx.cursor;
  const slots: Slot[] = [];
  for (;;) {
    const at = c.peek().span;
    slots.push({ expr: c.at(',') || c.atStatementEnd() ? null : ctx.parseExpr(), at });
    if (c.errored || !c.accept(',')) return slots;
  }
}

/** Parses a built-in statement whose head (`words` keywords) is at the cursor. */
function parseBuiltinStmt(ctx: ParserContext, entry: KeywordEntry, words: number): Stmt {
  const c = ctx.cursor;
  const kw = c.next();
  for (let i = 1; i < words; i++) c.next();
  let typeArg: TypeRef | null = null;
  let stream: Expr | null = null;
  // Whether arguments may follow: after a type or a stream they need the comma.
  let more = true;
  let started = false;
  if (entry.typeArg && isTypeToken(c.peek())) {
    typeArg = ctx.parseTypeRef();
    started = true;
    more = c.accept(',') !== null;
    if (!more && !c.atStatementEnd()) c.unexpected("',' after the type", `Syntax: ${entry.syntax}`);
  }
  if (entry.stream && more && c.at('#')) {
    c.next();
    stream = ctx.parseExpr();
    started = true;
    more = !c.errored && c.accept(',') !== null;
    if (!c.errored && !more && !c.atStatementEnd()) c.unexpected("',' after the stream number", `Syntax: ${entry.syntax}`);
  }
  const min = entry.args?.min ?? 0;
  let args: Array<Expr | null> = [];
  let hardwareAt: number[] | undefined;
  if (!c.errored && more) {
    if (entry.name === 'ENV' || entry.name === 'ENT') {
      // Software sections mixed with hardware sections: `ENV 1, 10, 1, 5, =10, 300`.
      // A `=` starts a hardware section; its index in `args` is recorded.
      if (!c.atStatementEnd()) {
        for (;;) {
          if (args.length > 0 && c.accept('=')) (hardwareAt ??= []).push(args.length);
          args.push(ctx.parseExpr());
          if (c.errored || !c.accept(',')) break;
        }
      }
    } else if (entry.emptyArgs) {
      // With no type or stream, nothing at all is no arguments rather than one empty slot.
      if (started || !c.atStatementEnd()) {
        const slots = parseSlots(ctx);
        args = slots.map((s) => s.expr);
        const hole = slots.findIndex((s, i) => i < min && s.expr === null && !(i === 0 && entry.optionalFirst === true && slots.length >= min));
        const slot = slots[hole];
        if (!c.errored && slot) {
          ctx.error('E142', slot.at, `Expected an expression for argument ${hole + 1} of ${entry.name}`, `Syntax: ${entry.syntax}`);
        }
      }
    } else if (!c.atStatementEnd()) {
      do args.push(ctx.parseExpr());
      while (!c.errored && c.accept(','));
    }
  }
  if (!c.errored && entry.name === 'INK' && args.length === 1) ctx.error('E901', kw.span, undefined, entry.hint);
  if (!c.errored) ctx.checkArity(entry, kw.span, args.length);
  if (c.errored) return ctx.badStmt(kw.span);
  return { kind: 'Builtin', span: c.spanFrom(kw.span), keyword: entry.name, stream, typeArg, args, ...(hardwareAt ? { hardwareAt } : null) };
}

/**
 * `CHAIN "name"` (L4-FILES): the file name only. CHAIN MERGE and a start line (`CHAIN "name", 200`) are Locomotive's BASIC
 * chaining, which a compiled program does not have (E981, as before).
 */
function parseChain(ctx: ParserContext): Stmt {
  const c = ctx.cursor;
  if (c.atKw('MERGE', 1)) {
    const kw = c.next();
    ctx.error('E981', kw.span, 'CHAIN MERGE is not in 1.0', 'Put the shared code in one program with #include.');
    return ctx.badStmt(kw.span);
  }
  const kw = c.next();
  const name = ctx.parseExpr();
  if (c.errored) return ctx.badStmt(kw.span);
  if (c.at(',')) {
    ctx.error('E981', kw.span, 'CHAIN with a start line is not in 1.0', 'CHAIN "name" loads another program and starts it at its entry address.');
    return ctx.badStmt(kw.span);
  }
  return { kind: 'Builtin', span: c.spanFrom(kw.span), keyword: 'CHAIN', stream: null, typeArg: null, args: [name] };
}

/** The parser of a first word shared by several entries: the longest name that matches wins. */
function headParser(head: string, entries: readonly KeywordEntry[], later: KeywordEntry | undefined): StatementParser {
  const variants = [...entries].sort((a, b) => b.name.split(' ').length - a.name.split(' ').length);
  return (ctx) => {
    const c = ctx.cursor;
    for (const entry of variants) {
      const words = entry.name.split(' ');
      if (c.atSeq(words)) return parseBuiltinStmt(ctx, entry, words.length);
    }
    if (later) return notInOnePointZero(later)(ctx);
    const kw = c.next();
    const second = variants.map((e) => e.name.split(' ')[1]).filter((w): w is string => w !== undefined);
    c.unexpected(second.join(' or '), `Write ${second.map((w) => `${head} ${w}`).join(' or ')}.`);
    return ctx.badStmt(kw.span);
  };
}

// ---- compatibility diagnostics ---------------------------------------------------------

function notInOnePointZero(entry: KeywordEntry): StatementParser {
  // A hint that only restates "X is not in 1.0" becomes the message, so the message is not said twice.
  const restates = entry.hint !== undefined && /\bis not in 1\.0\b/.test(entry.hint) && entry.hint.toUpperCase().startsWith(entry.name);
  const message = restates ? (entry.hint as string).replace(/\.$/, '') : `${entry.name} is not in 1.0`;
  const hint = restates ? undefined : entry.hint;
  return (ctx) => {
    const kw = ctx.cursor.next();
    ctx.error('E981', kw.span, message, hint);
    return ctx.badStmt(kw.span);
  };
}

function droppedStatement(entry: KeywordEntry): StatementParser {
  const interpreter = entry.section === '9';
  return (ctx) => {
    const kw = ctx.cursor.next();
    if (interpreter) {
      ctx.error('E980', kw.span, `${entry.name} is an interpreter command: not applicable in a compiled program`, `Remove it: ${entry.name} works in the interpreter only and has no meaning in a compiled program.`);
    }
    else ctx.error('E900', kw.span, `${entry.name} is dropped: it is a Sinclair form`, entry.hint);
    return ctx.badStmt(kw.span);
  };
}

// ---- ASM blocks and directives -----------------------------------------------------------

function parseAsm(ctx: ParserContext): Stmt {
  const c = ctx.cursor;
  const kw = c.next();
  const lines = [];
  for (;;) {
    const t = c.peek();
    if (t.kind === 'AsmLine') {
      c.next();
      lines.push({ kind: 'AsmLine' as const, span: t.span, text: t.text });
    } else if (t.kind === 'Directive') {
      c.next();
      // `#pragma`, `#require` and `#init` belong outside the block;
      // `#line` only matters to the assembler and is dropped here.
      if (t.name !== 'line') ctx.error('E186', t.span, `#${t.name} inside an ASM block is not supported`);
    } else if (t.kind === 'Newline') {
      c.next();
    } else if (c.atKw('END') && c.atKw('ASM', 1)) {
      c.next();
      c.next();
      break;
    } else if (t.kind === 'EOF' || t.kind === 'Keyword') {
      // An unclosed block: the lexer has reported E106 at the ASM keyword.
      break;
    } else {
      c.next();
    }
  }
  return { kind: 'Asm', span: c.spanFrom(kw.span), lines };
}

/** The text of a directive's `rest` without `_` continuations and without a trailing `'` comment. */
function directiveText(rest: string): string {
  const joined = rest.replace(/[ \t]*_[ \t]*(?:\r\n|\n|\r)[ \t]*/g, ' ');
  let out = '';
  let inString = false;
  for (const ch of joined) {
    if (ch === '"') inString = !inString;
    if (ch === "'" && !inString) break;
    out += ch;
  }
  return out.trim();
}

function parsePragma(ctx: ParserContext): Stmt {
  const t = ctx.cursor.next();
  if (t.kind !== 'Directive') return ctx.badStmt(t.span);
  const text = directiveText(t.rest);
  let stmt: Stmt;
  let m: RegExpExecArray | null;
  if ((m = /^(push|pop)\s*\(\s*([A-Za-z_]\w*)\s*\)$/i.exec(text))) {
    const op = (m[1] as string).toLowerCase() === 'push' ? 'push' : 'pop';
    stmt = { kind: 'Pragma', span: t.span, op, name: (m[2] as string).toLowerCase(), value: null };
  } else if ((m = /^([A-Za-z_]\w*)\s*=\s*(\S.*)$/.exec(text))) {
    stmt = { kind: 'Pragma', span: t.span, op: 'set', name: (m[1] as string).toLowerCase(), value: (m[2] as string).trim() };
  } else if ((m = /^([A-Za-z_]\w*)$/.exec(text))) {
    stmt = { kind: 'Pragma', span: t.span, op: 'flag', name: (m[1] as string).toLowerCase(), value: null };
  } else {
    ctx.error('E187', t.span, 'Malformed #pragma', 'Write #pragma name, #pragma name = value, #pragma push(name) or #pragma pop(name).');
    return ctx.badStmt(t.span);
  }
  if (stmt.kind === 'Pragma' && stmt.name === 'zxnext') {
    ctx.error('E188', t.span);
    return ctx.badStmt(t.span);
  }
  return stmt;
}

function parseRequire(ctx: ParserContext): Stmt {
  const t = ctx.cursor.next();
  if (t.kind !== 'Directive') return ctx.badStmt(t.span);
  const m = /^"([^"]+)"$/.exec(directiveText(t.rest));
  if (!m) {
    ctx.error('E187', t.span, '#require needs a quoted file name', 'Write #require "file.asm".');
    return ctx.badStmt(t.span);
  }
  return { kind: 'Require', span: t.span, path: m[1] as string };
}

function parseInit(ctx: ParserContext): Stmt {
  const t = ctx.cursor.next();
  if (t.kind !== 'Directive') return ctx.badStmt(t.span);
  const label = directiveText(t.rest);
  if (!/^[A-Za-z_.][\w.]*$/.test(label)) {
    ctx.error('E187', t.span, '#init needs a label', 'Write #init label.');
    return ctx.badStmt(t.span);
  }
  return { kind: 'Init', span: t.span, label };
}

// ---- the table ----------------------------------------------------------------------------

function buildTable(): StatementParsers {
  const table: Record<string, StatementParser> = {
    PRINT: parsePrint,
    INPUT: parseInput,
    WRITE: parseWrite,
    CHAIN: parseChain,
    LINE: parseInput,
    DATA: parseData,
    READ: parseRead,
    RESTORE: parseRestore,
    'MID$': parseMidAssign,
    CALL: parseCall,
    '|': parseRsx,
    ASM: parseAsm,
    '#pragma': parsePragma,
    '#require': parseRequire,
    '#init': parseInit,
  };

  const heads = new Map<string, KeywordEntry[]>();
  for (const e of KEYWORDS) {
    if (e.kind !== 'statement' || e.form !== 'builtin') continue;
    const head = e.name.split(' ')[0] as string;
    const list = heads.get(head);
    if (list) list.push(e);
    else heads.set(head, [e]);
  }

  for (const e of KEYWORDS) {
    if (e.kind !== 'statement' || e.name.includes(' ')) continue;
    if (e.status === 'later' && e.name !== 'RESUME' && e.name !== 'TYPE' && e.name !== 'PRIVATE') {
      // RESUME is the control-flow task's; TYPE and PRIVATE are the declarations task's (E971, E972).
      // A later word that also heads a built-in (CLEAR / CLEAR INPUT) needs both.
      const entries = heads.get(e.name);
      table[e.name] = entries ? headParser(e.name, entries, e) : notInOnePointZero(e);
    } else if (e.status === 'dropped' && !e.reserved) {
      table[e.name] = droppedStatement(e);
    }
  }
  for (const [head, entries] of heads) {
    if (!Object.prototype.hasOwnProperty.call(table, head)) table[head] = headParser(head, entries, undefined);
  }
  return table;
}

export const statementParsers: StatementParsers = buildTable();
