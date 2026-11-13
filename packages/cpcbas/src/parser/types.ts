/**
 * The contract between the parser core and the statement parsers of the wave-3 tasks
 * (declarations.ts, control.ts, stmts.ts).
 *
 * A statement parser is called with the cursor ON the statement's first token (the
 * keyword, the RSX token, the directive, or the soft-word identifier); it consumes the
 * statement and returns the node. It does not consume the `:` or Newline after it: the
 * statement loop checks that. To fail, report once with `ctx.error` (further errors in
 * the same statement are dropped) and return `ctx.badStmt(start)`, which skips to the
 * next `:` / Newline / block terminator.
 *
 * Dispatch keys (the three tables are looked up in the order declarations, control, stmts):
 * - a Keyword token: its canonical word (`'IF'`, `'DIM'`, `'GRAPHICS'`); multi-word
 *   statements are keyed by their first word and the parser peeks at the rest;
 * - an Rsx token: `'|'`;
 * - a Directive token reaching the parser (`#pragma`, `#require`, `#init`, `#line`):
 *   `'#pragma'`, `'#require'`, ...;
 * - an Identifier that is a soft word at the start of a statement (`LIST`, `OVER`, `GO`,
 *   `PRINT AT` is not one): the upper-case name. It is consulted only when the next
 *   token is not `=`, so `list = 3` still assigns. A parser may return `null` to decline
 *   (before consuming anything); the statement is then read as an assignment or SUB call.
 * A Keyword with no parser is reported as unexpected (E141).
 */

import type { DiagnosticBag, DiagnosticCode, RelatedInfo } from '../core/diagnostics.js';
import type { Expr, JumpTarget, LValue, Name, Stmt, TypeRef, BadStmt } from '../ast/ast.js';
import type { SourceSet, Span } from '../core/source.js';
import type { KeywordEntry } from '../lang/keywords.js';
import type { Cursor, Terminator } from './cursor.js';

export interface BlockOptions {
  /**
   * Single-line mode (the body of a one-line `IF ... THEN stmts ELSE stmts`): the block
   * ends at the Newline or EOF as well as at a terminator, and does not consume the Newline.
   */
  readonly line?: boolean;
}

export interface BlockResult {
  /** The statements read, with LineLabel nodes where lines were numbered or labelled. */
  readonly body: Stmt[];
  /**
   * Index into the `terminators` passed in of the one the block stopped at, or -1 when it
   * stopped at the end of the file, at the end of the line (single-line mode), or at a
   * terminator of an enclosing block (an unclosed block: report it at the opening keyword).
   * The cursor is left AT the terminator (use {@link ParserContext.takeTerminator}).
   */
  readonly matched: number;
}

export interface ParserContext {
  /** The token cursor: `peek`, `next`, `accept`, `acceptKw`, `atKw`, `atSeq`, `expect`, `spanFrom`, ... */
  readonly cursor: Cursor;
  readonly diagnostics: DiagnosticBag;
  readonly sources: SourceSet;

  /** Reports an error unless this statement already has one; marks the statement as failed. */
  error(code: DiagnosticCode, span: Span, message?: string, hint?: string, related?: readonly RelatedInfo[]): void;
  /** Reports without the one-per-statement limit and without marking failure (warnings, E960-style notes). */
  report(code: DiagnosticCode, span: Span, message?: string, hint?: string, related?: readonly RelatedInfo[]): void;
  /** Skips to the next `:` / Newline / terminator and returns a BadStmt covering `start` to there. */
  badStmt(start: Span): BadStmt;

  /** One expression; a BadExpr (after one diagnostic) on error. */
  parseExpr(): Expr;
  /** `a`, `a$` or `a(i, j)`; null after E150. */
  parseLValue(): LValue | null;
  /** A line number or label; null after E148. */
  parseJumpTarget(): JumpTarget | null;
  /** The cursor is at `(`: `(a, b)` or `()`. Unclosed `(` gives E143 at the `(`. */
  parseArgs(): Expr[];
  /** One or more comma-separated expressions, no parentheses. */
  parseExprList(): Expr[];
  /** Comma-separated expressions where an empty slot is allowed (null); stops at the end of the statement. */
  parseArgSlots(): Array<Expr | null>;
  /** An identifier as a Name; null (after E141) if the next token is not one. */
  parseName(): Name | null;
  /** A type name (FLOAT becomes REAL); null after E149. */
  parseTypeRef(): TypeRef | null;
  /** Checks a built-in's argument count against `lang/keywords.ts`; E147 at `at` with the syntax as hint. */
  checkArity(entry: KeywordEntry, at: Span, count: number): void;

  /**
   * Parses statements until one of `terminators` (keyword sequences such as `['END','IF']`,
   * `['NEXT']`, `['ELSE']`) starts a statement, or the file ends. `:` and Newline separate
   * statements; `CASE` may follow `:`. List longer sequences before their prefixes.
   * A terminator of any enclosing block also ends it (so an unclosed FOR does not eat the
   * END IF of the IF around it); `matched` is then -1.
   */
  parseBlock(terminators: readonly Terminator[], options?: BlockOptions): BlockResult;
  /** Consumes the keywords of `terminators[result.matched]` and returns their span. Call only when `matched >= 0`. */
  takeTerminator(terminators: readonly Terminator[], result: BlockResult): Span;
  /** Parses one statement (with its line label/number, if any, not included) through the dispatch tables. */
  parseStatement(): Stmt;
}

/** A statement parser: see the header comment. */
export type StatementParser = (ctx: ParserContext) => Stmt | null;

/** Keyword (or other dispatch key) to parser. One table per wave-3 task. */
export type StatementParsers = Readonly<Record<string, StatementParser>>;
