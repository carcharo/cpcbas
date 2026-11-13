/**
 * Statement table of L1-PCTRL: IF, FOR/NEXT, WHILE/WEND, DO/LOOP, SELECT CASE, EXIT,
 * CONTINUE, GOTO, GOSUB (and GO TO / GO SUB), RETURN, ON ..., ERROR, RESUME, END, STOP,
 * EVERY and AFTER, plus the closing words met without their opener (NEXT, WEND, LOOP,
 * ELSE, ELSEIF, CASE, END IF, ...), which report one error each.
 *
 * Blocks use `ctx.parseBlock`; an unclosed block is reported at its opening keyword.
 * `NEXT j, i` is read by the innermost FOR, which hands the rest of the clause to the
 * enclosing FOR by moving the cursor back to the NEXT (see {@link closeNext}).
 */
import type {
  CaseClause,
  CaseTest,
  ComparisonOp,
  Expr,
  GotoStmt,
  JumpTarget,
  Name,
  Stmt,
} from '../ast/ast.js';
import { joinSpans } from '../core/source.js';
import type { Span } from '../core/source.js';
import type { Cursor } from './cursor.js';
import { keywordOf } from '../lang/keywords.js';
import { nameOf } from './expr.js';
import type { ParserContext, StatementParser, StatementParsers } from './types.js';

// ---- local helpers (not part of the ParserContext contract) -----------------

/** The clause `NEXT a, b, c` as scanned by the first FOR that reaches it. */
interface NextClause {
  /** Cursor position of the NEXT keyword. */
  readonly pos: number;
  readonly names: Name[];
  /** Tokens after NEXT that belong to the clause. */
  readonly count: number;
  /** `NEXT` to the last name: the span every FOR closed by this clause shares. */
  readonly span: Span;
  /** Names already taken by inner loops. */
  used: number;
}

interface LoopState {
  /** FOR loops whose body is being parsed right now. */
  open: number;
  shared: NextClause | null;
}

const states = new WeakMap<Cursor, LoopState>();

function stateOf(ctx: ParserContext): LoopState {
  let s = states.get(ctx.cursor);
  if (!s) {
    s = { open: 0, shared: null };
    states.set(ctx.cursor, s);
  }
  return s;
}

function lastSpan(body: readonly Stmt[], fallback: Span): Span {
  const last = body[body.length - 1];
  return last ? last.span : fallback;
}

function isWord(t: { kind: string; name?: string; suffix?: unknown }, word: string): boolean {
  return t.kind === 'Identifier' && t.suffix === null && (t.name ?? '').toUpperCase() === word;
}

/** Accepts GOTO / GOSUB, or the soft-word form GO TO / GO SUB; returns the span consumed. */
function acceptJumpWord(c: Cursor, word: 'GOTO' | 'GOSUB'): Span | null {
  if (c.atKw(word)) return c.next().span;
  const second = word === 'GOTO' ? 'TO' : 'SUB';
  if (isWord(c.peek(), 'GO') && c.atKw(second, 1)) {
    const first = c.next().span;
    c.next();
    return c.spanFrom(first);
  }
  return null;
}

function unclosed(ctx: ParserContext, at: Span, what: string, expected: string, hint: string): void {
  ctx.error('E171', at, `${what} never closed (expected ${expected})`, hint);
}

/** Skips the rest of the physical line (used after an error that must not leave statements behind). */
function skipLine(c: Cursor): void {
  while (!c.at('Newline') && !c.at('EOF')) c.next();
}

// ---- IF ---------------------------------------------------------------------

type Branch = { cond: Expr; body: Stmt[]; span: Span };

/**
 * One branch of a one-line IF. `THEN 100` is an implicit GOTO. A NEXT, WEND or LOOP
 * that would close a loop outside the IF is an error (loops are structured).
 * Returns the body and whether an ELSE of this IF follows (already consumed).
 */
function lineBranch(ctx: ParserContext, ownElse: boolean): { body: Stmt[]; hasElse: boolean } {
  const c = ctx.cursor;
  if (c.at('Number')) {
    const target = ctx.parseJumpTarget();
    const body: Stmt[] = target ? [implicitGoto(target)] : [];
    return { body, hasElse: ownElse && c.acceptKw('ELSE') !== null };
  }
  const terms = ownElse ? [['ELSE']] : [];
  const r = ctx.parseBlock(terms, { line: true });
  if (r.matched === 0) {
    ctx.takeTerminator(terms, r);
    return { body: r.body, hasElse: true };
  }
  const t = c.peek();
  if (t.kind === 'Keyword' && (t.keyword === 'NEXT' || t.keyword === 'WEND' || t.keyword === 'LOOP')) {
    ctx.error('E174', t.span, `${t.keyword} inside a one-line IF cannot close a loop outside it`);
    skipLine(c);
  }
  return { body: r.body, hasElse: false };
}

function implicitGoto(target: JumpTarget): GotoStmt {
  return { kind: 'Goto', span: target.span, target, implicit: true };
}

const parseIf: StatementParser = (ctx) => {
  const c = ctx.cursor;
  const kw = c.next().span;
  const cond = ctx.parseExpr();
  const thenTok = c.peek();
  const goSpan = c.atKw('GOTO') || (isWord(c.peek(), 'GO') && c.atKw('TO', 1)) ? c.peek().span : null;
  if (goSpan) {
    // `IF cond GOTO target [ELSE ...]`: THEN left out; the GOTO is the branch (Locomotive).
    acceptJumpWord(c, 'GOTO');
    const target = ctx.parseJumpTarget();
    if (!target) return ctx.badStmt(kw);
    const body = [implicitGoto(target)];
    const branches: Branch[] = [{ cond, body, span: joinSpans(kw, target.span) }];
    let elseBody: Stmt[] | null = null;
    if (c.acceptKw('ELSE')) elseBody = lineBranch(ctx, false).body;
    return { kind: 'If', span: c.spanFrom(kw), form: 'line', branches, elseBody };
  }
  if (!c.acceptKw('THEN')) {
    c.errorHere('E170', `Expected THEN, found ${c.describe()}`);
    return ctx.badStmt(kw);
  }
  const after = c.peek();
  if (after.kind !== 'Newline' && after.kind !== 'EOF') {
    const then = lineBranch(ctx, true);
    const branches: Branch[] = [{ cond, body: then.body, span: joinSpans(kw, lastSpan(then.body, thenTok.span)) }];
    let elseBody: Stmt[] | null = null;
    if (then.hasElse) elseBody = lineBranch(ctx, false).body;
    return { kind: 'If', span: c.spanFrom(kw), form: 'line', branches, elseBody };
  }

  // Block form.
  const terms = [['ELSEIF'], ['ELSE'], ['END', 'IF']];
  const branches: Branch[] = [];
  let elseBody: Stmt[] | null = null;
  let branchStart = kw;
  let branchCond = cond;
  let condEnd: Span = thenTok.span;
  let r = ctx.parseBlock(terms);
  for (;;) {
    branches.push({ cond: branchCond, body: r.body, span: joinSpans(branchStart, lastSpan(r.body, condEnd)) });
    if (r.matched !== 0) break;
    branchStart = ctx.takeTerminator(terms, r);
    branchCond = ctx.parseExpr();
    condEnd = c.prevSpan;
    if (!c.acceptKw('THEN')) {
      c.errorHere('E170', `Expected THEN, found ${c.describe()}`);
      c.resync();
    } else condEnd = c.prevSpan;
    r = ctx.parseBlock(terms);
  }
  let endTerms = terms;
  let endIdx = 2;
  let elseIf = false;
  if (r.matched === 1) {
    ctx.takeTerminator(terms, r);
    elseIf = c.atKw('IF');
    endTerms = [['END', 'IF']];
    endIdx = 0;
    r = ctx.parseBlock(endTerms);
    elseBody = r.body;
  }
  if (r.matched === endIdx) {
    const end = ctx.takeTerminator(endTerms, r);
    return { kind: 'If', span: joinSpans(kw, end), form: 'block', branches, elseBody };
  }
  const nested = elseIf && elseBody?.[0]?.kind === 'If' && elseBody[0].form === 'block';
  const hint = nested
    ? 'Write ELSEIF as one word.'
    : after.commentBefore === true
      ? 'A comment after THEN opens a block IF; put the comment before the IF, or write a statement after THEN.'
      : 'Add END IF after the last statement of the block.';
  unclosed(ctx, kw, 'IF block', 'END IF', hint);
  return { kind: 'If', span: c.spanFrom(kw), form: 'block', branches, elseBody };
};

// ---- FOR / NEXT -------------------------------------------------------------

function scanNext(c: Cursor): NextClause {
  const nextTok = c.peek();
  const names: Name[] = [];
  let count = 0;
  for (let n = 1; ; n += 2) {
    const t = c.peek(n);
    if (t.kind !== 'Identifier') break;
    names.push(nameOf(t));
    count = n;
    if (!c.at(',', n + 1)) break;
  }
  const span = count > 0 ? joinSpans(nextTok.span, c.peek(count).span) : nextTok.span;
  return { pos: c.mark(), names, count, span, used: 0 };
}

function sameVariable(a: Name, b: Name): boolean {
  return a.base === b.base && (a.suffix === null || b.suffix === null || a.suffix === b.suffix);
}

/**
 * The cursor is at the NEXT that ends this FOR's body. Reads this loop's name, checks it, and
 * either consumes the whole clause or, when more names follow and enclosing loops are open,
 * moves back to the NEXT so the enclosing FOR's block ends there and takes the next name.
 */
function closeNext(ctx: ParserContext, st: LoopState, variable: Name): { name: Name | null; span: Span } {
  const c = ctx.cursor;
  const pos = c.mark();
  const clause = st.shared !== null && st.shared.pos === pos ? st.shared : scanNext(c);
  c.next();
  const mine = clause.names[clause.used] ?? null;
  if (mine && !sameVariable(mine, variable)) {
    ctx.error('E173', mine.span, `NEXT variable ${mine.text} does not match FOR variable ${variable.text}`);
  }
  const remaining = clause.names.length - clause.used - 1;
  const enclosing = st.open - 1;
  if (remaining > 0 && remaining <= enclosing) {
    clause.used++;
    st.shared = clause;
    c.reset(pos);
    return { name: mine, span: clause.span };
  }
  for (let i = 0; i < clause.count; i++) c.next();
  if (remaining > enclosing) {
    const extra = clause.names[clause.used + 1 + enclosing];
    if (extra) ctx.error('E176', extra.span, `NEXT names ${extra.text} but no loop is open for it`);
  }
  st.shared = null;
  return { name: mine, span: clause.span };
}

const parseFor: StatementParser = (ctx) => {
  const c = ctx.cursor;
  const st = stateOf(ctx);
  const kw = c.next().span;
  const variable = ctx.parseName();
  let from: Expr = { kind: 'BadExpr', span: kw };
  let to: Expr = from;
  let step: Expr | null = null;
  if (variable && c.expect('=', "'='")) {
    from = ctx.parseExpr();
    if (c.expectKw('TO')) {
      to = ctx.parseExpr();
      if (c.acceptKw('STEP')) step = ctx.parseExpr();
    }
  }
  if (c.errored) c.resync();
  st.open++;
  let r;
  try {
    r = ctx.parseBlock([['NEXT']]);
  } finally {
    st.open--;
  }
  // closeNext counts this loop among the open ones.
  st.open++;
  let result: { name: Name | null; span: Span } | null = null;
  try {
    if (r.matched === 0 && variable) result = closeNext(ctx, st, variable);
    else if (r.matched === 0) {
      c.next();
      skipClause(c);
    }
  } finally {
    st.open--;
  }
  if (r.matched !== 0) unclosed(ctx, kw, 'FOR loop', 'NEXT', 'Add NEXT after the last statement of the loop.');
  if (!variable) return ctx.badStmt(kw);
  const span = result ? joinSpans(kw, result.span) : c.spanFrom(kw);
  return {
    kind: 'For',
    span,
    variable,
    from,
    to,
    step,
    body: r.body,
    nextName: result ? result.name : null,
    nextSpan: result ? result.span : c.prevSpan,
  };
};

/** After a NEXT whose FOR header was bad: drop its names. */
function skipClause(c: Cursor): void {
  while (c.at('Identifier') || c.at(',')) c.next();
}

// ---- WHILE, DO --------------------------------------------------------------

const parseWhile: StatementParser = (ctx) => {
  const c = ctx.cursor;
  const kw = c.next().span;
  const cond = ctx.parseExpr();
  if (c.errored) c.resync();
  const terms = [['WEND']];
  const r = ctx.parseBlock(terms);
  if (r.matched === 0) {
    const end = ctx.takeTerminator(terms, r);
    return { kind: 'While', span: joinSpans(kw, end), cond, body: r.body };
  }
  unclosed(ctx, kw, 'WHILE loop', 'WEND', 'Add WEND after the last statement of the loop.');
  return { kind: 'While', span: c.spanFrom(kw), cond, body: r.body };
};

function loopCond(ctx: ParserContext): { until: boolean; expr: Expr; span: Span } | null {
  const c = ctx.cursor;
  const t = c.peek();
  if (t.kind !== 'Keyword' || (t.keyword !== 'WHILE' && t.keyword !== 'UNTIL')) return null;
  c.next();
  const expr = ctx.parseExpr();
  return { until: t.keyword === 'UNTIL', expr, span: joinSpans(t.span, expr.span) };
}

const parseDo: StatementParser = (ctx) => {
  const c = ctx.cursor;
  const kw = c.next().span;
  const pre = loopCond(ctx);
  if (c.errored) c.resync();
  const terms = [['LOOP']];
  const r = ctx.parseBlock(terms);
  if (r.matched === 0) {
    const end = ctx.takeTerminator(terms, r);
    const post = loopCond(ctx);
    return { kind: 'DoLoop', span: joinSpans(kw, post ? post.span : end), pre, post, body: r.body };
  }
  unclosed(ctx, kw, 'DO loop', 'LOOP', 'Add LOOP after the last statement of the loop.');
  return { kind: 'DoLoop', span: c.spanFrom(kw), pre, post: null, body: r.body };
};

// ---- SELECT CASE ------------------------------------------------------------

const COMPARISONS: Readonly<Record<string, ComparisonOp>> = {
  '=': '=',
  '<>': '<>',
  '<': '<',
  '>': '>',
  '<=': '<=',
  '>=': '>=',
  '=<': '<=',
  '=>': '>=',
};

function parseCaseTests(ctx: ParserContext): CaseTest[] {
  const c = ctx.cursor;
  const tests: CaseTest[] = [];
  for (;;) {
    const start = c.peek().span;
    if (c.acceptKw('IS')) {
      const opTok = c.peek();
      const op = Object.prototype.hasOwnProperty.call(COMPARISONS, opTok.kind) ? COMPARISONS[opTok.kind] : undefined;
      if (!op) {
        c.unexpected('a comparison (=, <>, <, >, <=, >=) after IS');
        break;
      }
      c.next();
      const value = ctx.parseExpr();
      tests.push({ kind: 'CaseIs', span: joinSpans(start, value.span), op, value });
    } else {
      const value = ctx.parseExpr();
      if (c.acceptKw('TO')) {
        const to = ctx.parseExpr();
        tests.push({ kind: 'CaseRange', span: joinSpans(start, to.span), from: value, to });
      } else tests.push({ kind: 'CaseValue', span: value.span, value });
    }
    if (c.errored || !c.accept(',')) break;
  }
  return tests;
}

const parseSelect: StatementParser = (ctx) => {
  const c = ctx.cursor;
  const kw = c.next().span;
  if (!c.acceptKw('CASE')) c.errorHere('E178', `Expected CASE after SELECT, found ${c.describe()}`, 'Write SELECT CASE expression.');
  const subject = ctx.parseExpr();
  if (c.errored) c.resync();
  const terms = [['CASE'], ['END', 'SELECT']];
  let r = ctx.parseBlock(terms);
  const labels = r.body.filter((s) => s.kind === 'LineLabel');
  const stray = r.body.find((s) => s.kind !== 'LineLabel');
  if (stray) ctx.error('E178', stray.span, 'A statement before the first CASE', 'Every statement in a SELECT CASE belongs under a CASE.');
  const cases: CaseClause[] = [];
  let elseBody: Stmt[] | null = null;
  let elseSeen = false;
  while (r.matched === 0) {
    const caseSpan = ctx.takeTerminator(terms, r);
    if (elseSeen) ctx.error('E178', caseSpan, 'CASE after CASE ELSE', 'CASE ELSE must be the last clause of the SELECT CASE.');
    if (c.atKw('ELSE')) {
      c.next();
      if (!c.atStatementEnd()) c.unexpected('end of line after CASE ELSE');
      r = ctx.parseBlock(terms);
      if (!elseSeen) elseBody = [...(cases.length === 0 ? labels : []), ...r.body];
      elseSeen = true;
    } else {
      const tests = parseCaseTests(ctx);
      if (!c.errored && !c.atStatementEnd()) c.unexpected("',' or end of line after the CASE values");
      if (c.errored) c.resync();
      r = ctx.parseBlock(terms);
      const body = [...(cases.length === 0 ? labels : []), ...r.body];
      const header = tests.length > 0 ? (tests[tests.length - 1] as CaseTest).span : caseSpan;
      cases.push({ kind: 'CaseClause', span: joinSpans(caseSpan, lastSpan(r.body, header)), tests, body });
    }
  }
  if (r.matched === 1) {
    const end = ctx.takeTerminator(terms, r);
    return { kind: 'SelectCase', span: joinSpans(kw, end), subject, cases, elseBody };
  }
  unclosed(ctx, kw, 'SELECT CASE', 'END SELECT', 'Add END SELECT after the last CASE.');
  return { kind: 'SelectCase', span: c.spanFrom(kw), subject, cases, elseBody };
};

// ---- EXIT, CONTINUE, jumps --------------------------------------------------

function parseExitLike(word: 'EXIT' | 'CONTINUE', allowed: readonly string[]): StatementParser {
  return (ctx) => {
    const c = ctx.cursor;
    const kw = c.next().span;
    const t = c.peek();
    if (t.kind === 'Keyword' && allowed.includes(t.keyword)) {
      c.next();
      const span = c.spanFrom(kw);
      return word === 'EXIT'
        ? { kind: 'Exit', span, target: t.keyword as 'FOR' | 'WHILE' | 'DO' | 'SUB' | 'FUNCTION' }
        : { kind: 'Continue', span, target: t.keyword as 'FOR' | 'WHILE' | 'DO' };
    }
    c.errorHere('E177', `${word} needs ${allowed.slice(0, -1).join(', ')} or ${allowed[allowed.length - 1]}, found ${c.describe()}`);
    return ctx.badStmt(kw);
  };
}

function jump(ctx: ParserContext, start: Span, gosub: boolean): Stmt {
  const target = ctx.parseJumpTarget();
  if (!target) return ctx.badStmt(start);
  const span = ctx.cursor.spanFrom(start);
  return gosub ? { kind: 'Gosub', span, target } : { kind: 'Goto', span, target, implicit: false };
}

const parseGoto: StatementParser = (ctx) => {
  const kw = ctx.cursor.next().span;
  return jump(ctx, kw, false);
};

const parseGosub: StatementParser = (ctx) => {
  const kw = ctx.cursor.next().span;
  return jump(ctx, kw, true);
};

/** `GO TO` / `GO SUB`; declines (null) for any other use of the word GO. */
const parseGo: StatementParser = (ctx) => {
  const c = ctx.cursor;
  const sub = c.atKw('SUB', 1);
  if (!sub && !c.atKw('TO', 1)) return null;
  const span = acceptJumpWord(c, sub ? 'GOSUB' : 'GOTO');
  return span ? jump(ctx, span, sub) : null;
};

const parseReturn: StatementParser = (ctx) => {
  const c = ctx.cursor;
  const kw = c.next().span;
  const value = c.atStatementEnd() ? null : ctx.parseExpr();
  return { kind: 'Return', span: c.spanFrom(kw), value };
};

// ---- ON, ERROR, RESUME, END, STOP, EVERY, AFTER -----------------------------

/** A form recognised and refused: E981 with the table's hint, after its target has been read. */
function notInOne(ctx: ParserContext, name: string, at: Span): Stmt {
  const entry = keywordOf(name, 'statement');
  ctx.error('E981', at, `${name} is not in 1.0`, entry?.hint);
  return ctx.badStmt(at);
}

const parseOn: StatementParser = (ctx) => {
  const c = ctx.cursor;
  const kw = c.next().span;
  if (c.acceptKw('BREAK')) {
    const t = c.peek();
    if (t.kind === 'Keyword' && t.keyword === 'STOP') {
      c.next();
      return { kind: 'OnBreak', span: c.spanFrom(kw), action: 'STOP' };
    }
    if (isWord(t, 'CONT')) {
      c.next();
      return { kind: 'OnBreak', span: c.spanFrom(kw), action: 'CONT' };
    }
    if (acceptJumpWord(c, 'GOSUB')) {
      ctx.parseJumpTarget();
      return notInOne(ctx, 'ON BREAK GOSUB', kw);
    }
    c.errorHere('E181', `ON BREAK needs STOP or CONT, found ${c.describe()}`);
    return ctx.badStmt(kw);
  }
  if (c.atKw('SQ') && c.at('(', 1)) {
    const sq = c.mark();
    c.next();
    c.next();
    ctx.parseExpr();
    if (!c.errored && c.accept(')') && acceptJumpWord(c, 'GOSUB')) {
      ctx.parseJumpTarget();
      return notInOne(ctx, 'ON SQ', kw);
    }
    // Not the event form (`ON SQ(1) + 1 GOTO ...`): parse as an ordinary ON.
    c.errored = false;
    c.reset(sq);
  }
  if (c.acceptKw('ERROR')) {
    if (!acceptJumpWord(c, 'GOTO')) {
      c.errorHere('E180', `Expected GOTO after ON ERROR, found ${c.describe()}`, 'Write ON ERROR GOTO label; ON ERROR GOTO 0 turns the handler off.');
      return ctx.badStmt(kw);
    }
    const target = ctx.parseJumpTarget();
    if (!target) return ctx.badStmt(kw);
    const off = target.kind === 'LineTarget' && target.number === 0;
    return { kind: 'OnError', span: c.spanFrom(kw), target: off ? null : target };
  }
  const selector = ctx.parseExpr();
  const gosub = acceptJumpWord(c, 'GOSUB') !== null;
  if (!gosub && !acceptJumpWord(c, 'GOTO')) {
    c.errorHere('E180', `Expected GOTO or GOSUB after the ON expression, found ${c.describe()}`, 'Write ON expression GOTO line1, line2, ...');
    return ctx.badStmt(kw);
  }
  const targets: JumpTarget[] = [];
  for (;;) {
    const t = ctx.parseJumpTarget();
    if (!t) return ctx.badStmt(kw);
    targets.push(t);
    if (!c.accept(',')) break;
  }
  return { kind: 'OnGoto', span: c.spanFrom(kw), selector, targets, gosub };
};

const parseError: StatementParser = (ctx) => {
  const kw = ctx.cursor.next().span;
  const code = ctx.parseExpr();
  return { kind: 'Error', span: ctx.cursor.spanFrom(kw), code };
};

/** `RESUME`, `RESUME NEXT`, `RESUME line-or-label` (L4-ERR). */
const parseResume: StatementParser = (ctx) => {
  const c = ctx.cursor;
  const kw = c.next().span;
  if (c.acceptKw('NEXT')) return { kind: 'Resume', span: c.spanFrom(kw), mode: 'next', target: null };
  if (c.atStatementEnd()) return { kind: 'Resume', span: c.spanFrom(kw), mode: 'same', target: null };
  if (!c.at('Number') && !c.at('LineNumber') && !c.at('Identifier')) {
    c.errorHere('E182', `Expected NEXT, a line number or a label after RESUME, found ${c.describe()}`, 'Write RESUME, RESUME NEXT or RESUME line.');
    return ctx.badStmt(kw);
  }
  const target = ctx.parseJumpTarget();
  if (!target) return ctx.badStmt(kw);
  return { kind: 'Resume', span: c.spanFrom(kw), mode: 'target', target };
};

const STRAY_END: Readonly<Record<string, string>> = {
  IF: 'END IF without IF',
  SELECT: 'END SELECT without SELECT CASE',
  SUB: 'END SUB without SUB',
  FUNCTION: 'END FUNCTION without FUNCTION',
  ASM: 'END ASM without ASM',
};

const parseEnd: StatementParser = (ctx) => {
  const c = ctx.cursor;
  const kw = c.next().span;
  const t = c.peek();
  if (t.kind === 'Keyword' && Object.prototype.hasOwnProperty.call(STRAY_END, t.keyword)) {
    c.next();
    ctx.error('E175', kw, STRAY_END[t.keyword], 'Remove it, or add the statement that opens the block above.');
    return ctx.badStmt(kw);
  }
  return { kind: 'End', span: kw };
};

const parseStop: StatementParser = (ctx) => ({ kind: 'Stop', span: ctx.cursor.next().span });

function parseEveryAfter(every: boolean): StatementParser {
  return (ctx) => {
    const c = ctx.cursor;
    const kw = c.next().span;
    const interval = ctx.parseExpr();
    const timer = c.accept(',') ? ctx.parseExpr() : null;
    if (!acceptJumpWord(c, 'GOSUB')) {
      c.errorHere('E180', `Expected GOSUB, found ${c.describe()}`, `Write ${every ? 'EVERY' : 'AFTER'} interval [, timer] GOSUB label.`);
      return ctx.badStmt(kw);
    }
    const target = ctx.parseJumpTarget();
    if (!target) return ctx.badStmt(kw);
    return { kind: 'EveryAfter', span: c.spanFrom(kw), every, interval, timer, target };
  };
}

// ---- closing words without their opener -------------------------------------

function stray(code: 'E172' | 'E175', message: string, hint: string): StatementParser {
  return (ctx) => {
    const kw = ctx.cursor.next().span;
    ctx.error(code, kw, message, hint);
    return ctx.badStmt(kw);
  };
}

export const controlParsers: StatementParsers = {
  IF: parseIf,
  FOR: parseFor,
  NEXT: stray('E172', 'NEXT without FOR', 'Every NEXT closes a FOR in the same block.'),
  WHILE: parseWhile,
  WEND: stray('E172', 'WEND without WHILE', 'Every WEND closes a WHILE in the same block.'),
  DO: parseDo,
  LOOP: stray('E172', 'LOOP without DO', 'Every LOOP closes a DO in the same block.'),
  SELECT: parseSelect,
  CASE: stray('E175', 'CASE without SELECT CASE', 'CASE belongs inside SELECT CASE ... END SELECT.'),
  ELSE: stray('E175', 'ELSE without IF', 'An IF has at most one ELSE, after every ELSEIF.'),
  ELSEIF: stray('E175', 'ELSEIF without a block IF', 'ELSEIF belongs inside IF cond THEN ... END IF.'),
  EXIT: parseExitLike('EXIT', ['FOR', 'WHILE', 'DO', 'SUB', 'FUNCTION']),
  CONTINUE: parseExitLike('CONTINUE', ['FOR', 'WHILE', 'DO']),
  GOTO: parseGoto,
  GOSUB: parseGosub,
  GO: parseGo,
  RETURN: parseReturn,
  ON: parseOn,
  ERROR: parseError,
  RESUME: parseResume,
  END: parseEnd,
  STOP: parseStop,
  EVERY: parseEveryAfter(true),
  AFTER: parseEveryAfter(false),
};
