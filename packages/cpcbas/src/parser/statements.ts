/**
 * The statement loop: blocks, line labels, dispatch to the statement tables of the
 * wave-3 tasks, and the statements the core owns itself: `LineLabel`, `Let` (with and
 * without LET), `SubCall` (both forms) and `BadStmt`.
 */

import type { BadStmt, LetStmt, LineLabel, LValue, Stmt, SubCallStmt } from '../ast/ast.js';
import type { DiagnosticBag, DiagnosticCode, RelatedInfo } from '../core/diagnostics.js';
import { joinSpans } from '../core/source.js';
import type { SourceSet, Span } from '../core/source.js';
import type { LabelToken, LineNumberToken, Token } from '../core/tokens.js';
import { checkArity, isFunctionKeyword, nameOf, reservedAsName, parseArgSlots, parseExpr, parseExprList, parseJumpTarget, parseLValue, parseParenArgs, parseTypeRef } from './expr.js';
import { Cursor, MAX_DEPTH } from './cursor.js';
import type { Terminator } from './cursor.js';
import { controlParsers } from './control.js';
import { declarationParsers } from './declarations.js';
import { statementParsers } from './stmts.js';
import { keywordOf } from '../lang/keywords.js';
import type { BlockOptions, BlockResult, ParserContext, StatementParser, StatementParsers } from './types.js';

const TABLES: readonly StatementParsers[] = [declarationParsers, controlParsers, statementParsers];

function lookup(key: string): StatementParser | null {
  for (const table of TABLES) {
    if (Object.prototype.hasOwnProperty.call(table, key)) return table[key] ?? null;
  }
  return null;
}

/** Tokens that can begin the first argument of `Foo 1, 2` (a SUB call without parentheses). */
function startsArgument(t: Token, next: Token): boolean {
  switch (t.kind) {
    case 'Number':
    case 'String':
    case 'Identifier':
    case '(':
    case '@':
      return true;
    case '-':
    case '+':
      // `Foo -1` is a call, `a - 1` is not a statement: tell them apart by the spacing.
      return t.spaceBefore && !next.spaceBefore;
    case 'Keyword':
      return t.keyword === 'NOT' || t.keyword === 'FN' || isFunctionKeyword(t.keyword);
    default:
      return false;
  }
}

export function createContext(tokens: readonly Token[], diagnostics: DiagnosticBag, sources: SourceSet): ParserContext {
  const cur = new Cursor(tokens, diagnostics, sources);
  const lineNumbers = new Map<number, Span>();

  const badStmt = (start: Span): BadStmt => {
    cur.resync();
    const prev = cur.prevSpan;
    const end = prev.file === start.file && prev.end > start.start ? Math.max(start.end, prev.end) : start.end;
    return { kind: 'BadStmt', span: { file: start.file, start: start.start, end } };
  };

  const lineLabel = (t: LineNumberToken | LabelToken): LineLabel => {
    if (t.kind === 'LineNumber') {
      const first = lineNumbers.get(t.value);
      if (first) {
        diagnostics.report('E145', t.span, `Duplicate line number ${t.value}`, 'Line numbers must be unique in the program.', [
          { span: first, message: `Line ${t.value} is first used here` },
        ]);
      } else lineNumbers.set(t.value, t.span);
      return { kind: 'LineLabel', span: t.span, number: t.value, name: null, key: null };
    }
    return { kind: 'LineLabel', span: t.span, number: null, name: t.name, key: t.key };
  };

  const parseLet = (explicit: boolean, start: Span, target: LValue | null): Stmt => {
    if (!target) return badStmt(start);
    if (!cur.expect('=', "'='")) return badStmt(start);
    const value = parseExpr(cur);
    const node: LetStmt = { kind: 'Let', span: cur.spanFrom(start), target, value, explicitLet: explicit };
    return node;
  };

  const subCall = (start: Span, args: SubCallStmt['args'], parens: boolean, name: SubCallStmt['name']): SubCallStmt => ({
    kind: 'SubCall',
    span: cur.spanFrom(start),
    name,
    args,
    parens,
  });

  /** A statement that starts with an identifier: assignment, element assignment or SUB call. */
  const parseIdentifierStatement = (): Stmt => {
    const id = cur.next();
    if (id.kind !== 'Identifier') return badStmt(id.span);
    const name = nameOf(id);
    if (cur.at('=')) return parseLet(false, id.span, name);
    if (cur.at('(')) {
      const afterName = cur.mark();
      const { args, span } = parseParenArgs(cur);
      if (cur.at('=')) {
        const target: LValue = { kind: 'CallOrIndex', span: joinSpans(id.span, span), callee: name, args };
        return parseLet(false, id.span, target);
      }
      if (cur.atStatementEnd() || cur.errored) return subCall(id.span, args, true, name);
      // `Foo (1 + 2) * 3, 4`: the parenthesis was the start of the first argument.
      cur.reset(afterName);
      return subCall(id.span, parseExprList(cur), false, name);
    }
    if (cur.atStatementEnd()) return subCall(id.span, [], false, name);
    if (startsArgument(cur.peek(), cur.peek(1))) return subCall(id.span, parseExprList(cur), false, name);
    cur.unexpected("'=' or the arguments of a SUB call", `To assign, write ${id.text} = value; to call a SUB, write ${id.text} arg1, arg2.`);
    return badStmt(id.span);
  };

  const unexpectedStatement = (t: Token): Stmt => {
    let hint: string | undefined;
    if (t.kind === 'Keyword' && isFunctionKeyword(t.keyword)) hint = `${t.keyword} is a function: use it inside an expression, for example x = ${t.keyword}(...).`;
    cur.errorHere('E141', `Unexpected ${cur.describe(t)} at the start of a statement`, hint);
    return badStmt(t.span);
  };

  /** True when the name at the cursor is followed by `(...)` and then `=`: an element assignment. */
  const elementAssigned = (): boolean => {
    if (!cur.at('(', 1)) return false;
    let depth = 0;
    for (let n = 1; !cur.at('Newline', n) && !cur.at('EOF', n); n++) {
      if (cur.at('(', n)) depth++;
      else if (cur.at(')', n) && --depth === 0) return cur.at('=', n + 1);
    }
    return false;
  };

  const dispatch = (): Stmt => {
    const t = cur.peek();
    switch (t.kind) {
      case 'Keyword': {
        if (t.keyword === 'LET') {
          cur.next();
          return parseLet(true, t.span, parseLValue(cur));
        }
        // `fill = 3`, `test = 1`: no statement starts with a keyword and `=`, so this is a
        // reserved word used as a variable. The structured statements (`CONST = 5`) keep
        // their own "expected a name" error.
        if (cur.at('=', 1) && keywordOf(t.keyword, 'statement')?.form !== 'special' && reservedAsName(cur, t)) return badStmt(t.span);
        const p = lookup(t.keyword);
        const stmt = p ? p(ctx) : null;
        return stmt ?? unexpectedStatement(t);
      }
      case 'Rsx': {
        const p = lookup('|');
        return (p ? p(ctx) : null) ?? unexpectedStatement(t);
      }
      case 'Directive': {
        const p = lookup(`#${t.name}`);
        return (p ? p(ctx) : null) ?? unexpectedStatement(t);
      }
      case 'Identifier': {
        if (t.suffix === null && !cur.at('=', 1) && !elementAssigned()) {
          const p = lookup(t.name.toUpperCase());
          const stmt = p ? p(ctx) : null;
          if (stmt) return stmt;
        }
        return parseIdentifierStatement();
      }
      case 'Invalid':
        cur.next();
        cur.errored = true;
        return badStmt(t.span);
      default:
        return unexpectedStatement(t);
    }
  };

  const parseStatement = (): Stmt => {
    const saved = cur.errored;
    cur.errored = false;
    const start = cur.peek().span;
    let stmt: Stmt;
    if (cur.depth >= MAX_DEPTH) {
      cur.errorHere('E151', 'Statements are nested too deeply');
      cur.next();
      stmt = badStmt(start);
    } else {
      cur.depth++;
      try {
        stmt = dispatch();
      } finally {
        cur.depth--;
      }
    }
    if (!cur.atStatementEnd()) {
      cur.errorHere('E144', `Expected end of statement, found ${cur.describe()}`);
      cur.resync();
    }
    cur.errored = saved;
    return stmt;
  };

  const parseBlock = (terminators: readonly Terminator[], options: BlockOptions = {}): BlockResult => {
    const line = options.line === true;
    const body: Stmt[] = [];
    let matched = -1;
    cur.pushTerminators(terminators);
    try {
      for (;;) {
        let fresh = false;
        while (cur.at(':') || (!line && cur.at('Newline'))) {
          if (cur.peek().lineStart) fresh = true;
          cur.next();
        }
        const t = cur.peek();
        if (t.kind === 'EOF' || (line && t.kind === 'Newline')) break;
        // Follow-up 80: the first item of a line without a line number, once some line has one.
        const unnumbered = (fresh || t.lineStart) && t.kind !== 'LineNumber' && lineNumbers.size > 0;
        if (t.kind === 'LineNumber' || t.kind === 'Label') {
          const label = lineLabel(t);
          body.push(unnumbered ? { ...label, unnumberedLine: true } : label);
          cur.next();
          continue;
        }
        if (t.kind === 'Directive' && t.name === 'line') {
          // `#line` in BASIC source has no effect: a warning and no node.
          diagnostics.report('W189', t.span);
          cur.next();
          continue;
        }
        const m = cur.matchTerminator(terminators);
        if (m >= 0) {
          matched = m;
          break;
        }
        if (cur.atAnyTerminator()) break;
        const before = cur.mark();
        const parsed = parseStatement();
        body.push(unnumbered ? { ...parsed, unnumberedLine: true } : parsed);
        if (cur.mark() === before) cur.next();
      }
    } finally {
      cur.popTerminators();
    }
    return { body, matched };
  };

  const ctx: ParserContext = {
    cursor: cur,
    diagnostics,
    sources,
    error: (code: DiagnosticCode, span: Span, message?: string, hint?: string, related?: readonly RelatedInfo[]) =>
      cur.error(code, span, message, hint, related),
    report: (code: DiagnosticCode, span: Span, message?: string, hint?: string, related?: readonly RelatedInfo[]) =>
      diagnostics.report(code, span, message, hint, related),
    badStmt,
    parseExpr: () => parseExpr(cur),
    parseLValue: () => parseLValue(cur),
    parseJumpTarget: () => parseJumpTarget(cur),
    parseArgs: () => parseParenArgs(cur).args,
    parseExprList: () => parseExprList(cur),
    parseArgSlots: () => parseArgSlots(cur),
    parseName: () => {
      const t = cur.peek();
      if (t.kind !== 'Identifier') {
        if (!reservedAsName(cur, t)) cur.unexpected('a name');
        return null;
      }
      cur.next();
      return nameOf(t);
    },
    parseTypeRef: () => parseTypeRef(cur),
    checkArity: (entry, at, count) => checkArity(cur, entry, at, count),
    parseBlock,
    takeTerminator: (terminators, result) => {
      const words = terminators[result.matched] ?? [];
      const first = cur.peek().span;
      for (let i = 0; i < words.length; i++) cur.next();
      return cur.spanFrom(first);
    },
    parseStatement,
  };
  return ctx;
}
