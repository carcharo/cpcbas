/**
 * The token cursor of the parser: lookahead, matching, the error helpers and
 * resynchronisation. Everything here works on the preprocessed token stream
 * (comments dropped, one EOF last).
 *
 * Error policy (decisions from the wave-1 review):
 * - one diagnostic per bad statement: after the first {@link Cursor.error} in a statement,
 *   further errors are swallowed until the next statement starts (the statement loop
 *   saves and restores `errored` around each statement);
 * - after an error the statement loop calls {@link Cursor.resync}, which skips to the next
 *   `:`, Newline, EOF or block terminator;
 * - an `Invalid` token has already been reported by the lexer: meeting one marks the
 *   statement as failed without a second diagnostic.
 */

import type { DiagnosticBag, DiagnosticCode, RelatedInfo } from '../core/diagnostics.js';
import { asFileId, joinSpans } from '../core/source.js';
import type { SourceSet, Span } from '../core/source.js';
import type { Token, TokenKind } from '../core/tokens.js';

/** A block terminator: keywords that must follow each other, such as `['END', 'IF']` or `['NEXT']`. */
export type Terminator = readonly string[];

/** Deepest nesting of expressions and statements the parser follows before it reports an error. */
export const MAX_DEPTH = 150;

export class Cursor {
  private readonly toks: Token[];
  private pos = 0;
  private lastConsumed: Token | null = null;
  /** Stack of the terminator lists of the blocks being parsed (innermost last). */
  private readonly active: Array<readonly Terminator[]> = [];
  /** True once the current statement has produced its diagnostic (or met an Invalid token). */
  errored = false;
  /** Current nesting depth (expressions and statements); see {@link MAX_DEPTH}. */
  depth = 0;

  constructor(
    tokens: readonly Token[],
    readonly diag: DiagnosticBag,
    readonly sources: SourceSet,
  ) {
    const list = tokens.filter((t) => t.kind !== 'Comment');
    const last = list[list.length - 1];
    if (!last || last.kind !== 'EOF') {
      const at = last ? last.span.end : 0;
      const file = last ? last.span.file : asFileId(0);
      list.push({ kind: 'EOF', span: { file, start: at, end: at }, text: '', spaceBefore: false, lineStart: false });
    }
    this.toks = list;
  }

  // ---- lookahead ----------------------------------------------------------

  /** The token `n` places ahead (0 = current); past the end it is the EOF token. */
  peek(n = 0): Token {
    return this.toks[Math.min(this.pos + n, this.toks.length - 1)] as Token;
  }

  /** Consumes and returns the current token (EOF is never consumed). */
  next(): Token {
    const t = this.peek();
    if (t.kind !== 'EOF') {
      this.pos++;
      this.lastConsumed = t;
    }
    return t;
  }

  /** A position that {@link reset} can return to (for backtracking). */
  mark(): number {
    return this.pos;
  }

  reset(mark: number): void {
    this.pos = mark;
    this.lastConsumed = mark > 0 ? (this.toks[mark - 1] ?? null) : null;
  }

  /** Span of the last consumed token, or an empty span at the current token. */
  get prevSpan(): Span {
    return this.lastConsumed ? this.lastConsumed.span : { ...this.peek().span, end: this.peek().span.start };
  }

  /** Span from `start` to the end of the last consumed token. */
  spanFrom(start: Span): Span {
    return joinSpans(start, this.prevSpan);
  }

  // ---- matching -----------------------------------------------------------

  at(kind: TokenKind, n = 0): boolean {
    return this.peek(n).kind === kind;
  }

  atKw(word: string, n = 0): boolean {
    const t = this.peek(n);
    return t.kind === 'Keyword' && t.keyword === word;
  }

  /** True when the next tokens are these keywords in a row. */
  atSeq(words: readonly string[], n = 0): boolean {
    return words.length > 0 && words.every((w, i) => this.atKw(w, n + i));
  }

  accept(kind: TokenKind): Token | null {
    return this.at(kind) ? this.next() : null;
  }

  acceptKw(word: string): Token | null {
    return this.atKw(word) ? this.next() : null;
  }

  /** Consumes `kind` or reports E141 "Expected what, found ..." at the current token. */
  expect(kind: TokenKind, what: string = `'${kind}'`): Token | null {
    if (this.at(kind)) return this.next();
    this.unexpected(what);
    return null;
  }

  expectKw(word: string, what: string = word): Token | null {
    if (this.atKw(word)) return this.next();
    this.unexpected(what);
    return null;
  }

  // ---- statement ends and terminators --------------------------------------

  /** `:`, Newline or EOF. */
  atSeparator(): boolean {
    const k = this.peek().kind;
    return k === ':' || k === 'Newline' || k === 'EOF';
  }

  /** The index of the first of `list` that starts at the cursor, or -1. */
  matchTerminator(list: readonly Terminator[], n = 0): number {
    return list.findIndex((t) => this.atSeq(t, n));
  }

  /** True when the cursor is at the start of a terminator of any block being parsed. */
  atAnyTerminator(): boolean {
    return this.active.some((list) => this.matchTerminator(list) >= 0);
  }

  /** True at a separator or at a block terminator: the place where a statement may end. */
  atStatementEnd(): boolean {
    return this.atSeparator() || this.atAnyTerminator();
  }

  /** How many blocks are being parsed: 1 at the top level of the program, more inside IF, FOR, SUB and the rest. */
  get blockDepth(): number {
    return this.active.length;
  }

  pushTerminators(list: readonly Terminator[]): void {
    this.active.push(list);
  }

  popTerminators(): void {
    this.active.pop();
  }

  // ---- errors -------------------------------------------------------------

  /** How a token reads in a message: `'x'`, `end of line` or `end of file`. */
  describe(t: Token = this.peek()): string {
    if (t.kind === 'Newline') return 'end of line';
    if (t.kind === 'EOF') return 'end of file';
    const text = t.text.length > 24 ? `${t.text.slice(0, 24)}...` : t.text;
    return `'${text}'`;
  }

  /**
   * Reports an error unless this statement already has one. A lexer-reported `Invalid`
   * token as the culprit is not reported again. Always marks the statement as failed.
   */
  error(code: DiagnosticCode, span: Span, message?: string, hint?: string, related?: readonly RelatedInfo[]): void {
    if (this.errored) return;
    this.errored = true;
    this.diag.report(code, span, message, hint, related);
  }

  /** Reports an error at the current token; silent when that token is an `Invalid` one (the lexer reported it). */
  errorHere(code: DiagnosticCode, message?: string, hint?: string): void {
    const t = this.peek();
    if (t.kind === 'Invalid') {
      this.errored = true;
      return;
    }
    this.error(code, t.span, message, hint);
  }

  /** E141 "Expected X, found Y" at the current token. */
  unexpected(expected: string, hint?: string): void {
    this.errorHere('E141', `Expected ${expected}, found ${this.describe()}`, hint);
  }

  /** Skips to the next `:`, Newline, EOF or block terminator, without consuming it. */
  resync(): void {
    while (!this.atStatementEnd()) this.next();
  }
}
