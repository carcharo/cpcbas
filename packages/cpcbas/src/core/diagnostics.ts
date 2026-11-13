/**
 * Diagnostics: every error and warning the compiler reports, in one shape.
 *
 * A diagnostic has a code (`E151`, `W301`), a severity, a span, a one-line message
 * and, where the fix is known, a hint that names it. User errors are never thrown:
 * a stage reports into a {@link DiagnosticBag} and carries on (or stops cleanly).
 * Only a bug in the compiler throws ({@link InternalError}); `compile()` turns
 * that into `E001`.
 *
 * Codes: a letter (`E` error, `W` warning) and three digits. The number alone is
 * unique (there is never both an `E123` and a `W123`), so `-W 123` and `-W W123`
 * mean the same. Ranges, from the language reference's diagnostics section plus
 * the ranges it leaves open:
 *
 * | Range   | Area                                                    | Code table file           |
 * |---------|---------------------------------------------------------|---------------------------|
 * | 001-099 | compiler, pipeline, host (internal error, not implemented, file not found, options) | codes/core.ts |
 * | 100-119 | lexer                                                   | codes/lexer.ts            |
 * | 120-139 | preprocessor                                            | codes/preprocessor.ts     |
 * | 140-159 | parser core and expressions                             | codes/parser-core.ts      |
 * | 160-169 | parser: declarations and procedures                     | codes/parser-decl.ts      |
 * | 170-184 | parser: control flow                                    | codes/parser-control.ts   |
 * | 185-199 | parser: other statements, ASM blocks, directives        | codes/parser-stmt.ts      |
 * | 200-229 | binder: names, declarations, labels                     | codes/binder.ts           |
 * | 230-299 | checker: types, conversions, procedures, bare mode      | codes/checker.ts          |
 * | 300-319 | binder: unused, implicit declarations                   | codes/binder.ts           |
 * | 320-349 | checker: unreachable, unused results                    | codes/checker.ts          |
 * | 350-399 | free                                                    |                           |
 * | 400-419 | memory and layout                                       | codes/layout.ts           |
 * | 420-449 | code generation and linking                             | codes/codegen.ts          |
 * | 450-499 | free                                                    |                           |
 * | 500-519 | assembler: instruction encoding                         | codes/asm-encode.ts       |
 * | 520-569 | assembler: source, directives, symbols, preprocessor    | codes/asm.ts              |
 * | 570-579 | the optimiser (L5): options, rule files, passes         | codes/codegen.ts          |
 * | 580-599 | assembler (continued)                                   | codes/asm.ts              |
 * | 600-699 | output writers (AMSDOS, DSK, CPR)                       | codes/pack.ts             |
 * | 700-749 | `cpcbas migrate` (Boriel BASIC translator); 740-749 kept for the Studio | codes/migrate.ts |
 * | 900-949 | compatibility: Sinclair forms                           | codes/parser-stmt.ts      |
 * | 950-959 | compatibility: Boriel lexical forms                     | codes/lexer.ts            |
 * | 960-969 | compatibility: Boriel operators and expressions         | codes/parser-core.ts      |
 * | 970-979 | compatibility: Boriel statements and declarations       | codes/parser-decl.ts      |
 * | 980-999 | compatibility: Locomotive forms not in a compiler or not in 1.0 | codes/parser-stmt.ts |
 *
 * Each code table is owned by one task; add codes only in your range.
 * `diagnostics.test.ts` checks ranges, letters and uniqueness.
 */

import type { SourceSet, Span } from './source.js';
import { CORE_CODES } from './codes/core.js';
import { LEXER_CODES } from './codes/lexer.js';
import { PREPROCESSOR_CODES } from './codes/preprocessor.js';
import { PARSER_CORE_CODES } from './codes/parser-core.js';
import { PARSER_DECL_CODES } from './codes/parser-decl.js';
import { PARSER_CONTROL_CODES } from './codes/parser-control.js';
import { PARSER_STMT_CODES } from './codes/parser-stmt.js';
import { BINDER_CODES } from './codes/binder.js';
import { CHECKER_CODES } from './codes/checker.js';
import { CODEGEN_CODES } from './codes/codegen.js';
import { LAYOUT_CODES } from './codes/layout.js';
import { ASM_ENCODE_CODES } from './codes/asm-encode.js';
import { ASM_CODES } from './codes/asm.js';
import { PACK_CODES } from './codes/pack.js';
import { MIGRATE_CODES } from './codes/migrate.js';

export type Severity = 'error' | 'warning' | 'note';

/** One entry of a code table: default severity, a short title (for `cpcbas explain`), and a default hint. */
export interface CodeInfo {
  readonly severity: 'error' | 'warning';
  readonly title: string;
  readonly hint?: string;
}

/** A code table: `{ E101: {...}, W102: {...} }`. Keys are `E`/`W` plus three digits. */
export type CodeTable = Readonly<Record<string, CodeInfo>>;

/** Every registered code, merged from the per-area tables. */
export const CODES = {
  ...CORE_CODES,
  ...LEXER_CODES,
  ...PREPROCESSOR_CODES,
  ...PARSER_CORE_CODES,
  ...PARSER_DECL_CODES,
  ...PARSER_CONTROL_CODES,
  ...PARSER_STMT_CODES,
  ...BINDER_CODES,
  ...CHECKER_CODES,
  ...CODEGEN_CODES,
  ...LAYOUT_CODES,
  ...ASM_ENCODE_CODES,
  ...ASM_CODES,
  ...PACK_CODES,
  ...MIGRATE_CODES,
} as const satisfies CodeTable;

/** A registered diagnostic code. Using an unregistered code is a type error: add it to your table first. */
export type DiagnosticCode = keyof typeof CODES;

/** The per-area tables with their number ranges (inclusive), for the range test and for docs. */
export const CODE_RANGES: ReadonlyArray<{ name: string; table: CodeTable; ranges: ReadonlyArray<readonly [number, number]> }> = [
  { name: 'core', table: CORE_CODES, ranges: [[1, 99]] },
  { name: 'lexer', table: LEXER_CODES, ranges: [[100, 119], [950, 959]] },
  { name: 'preprocessor', table: PREPROCESSOR_CODES, ranges: [[120, 139]] },
  { name: 'parser-core', table: PARSER_CORE_CODES, ranges: [[140, 159], [960, 969]] },
  { name: 'parser-decl', table: PARSER_DECL_CODES, ranges: [[160, 169], [970, 979]] },
  { name: 'parser-control', table: PARSER_CONTROL_CODES, ranges: [[170, 184]] },
  { name: 'parser-stmt', table: PARSER_STMT_CODES, ranges: [[185, 199], [900, 949], [980, 999]] },
  { name: 'binder', table: BINDER_CODES, ranges: [[200, 229], [300, 319]] },
  { name: 'checker', table: CHECKER_CODES, ranges: [[230, 299], [320, 349]] },
  { name: 'layout', table: LAYOUT_CODES, ranges: [[400, 419]] },
  { name: 'codegen', table: CODEGEN_CODES, ranges: [[420, 449], [570, 579]] },
  { name: 'asm-encode', table: ASM_ENCODE_CODES, ranges: [[500, 519]] },
  { name: 'asm', table: ASM_CODES, ranges: [[520, 569], [580, 599]] },
  { name: 'pack', table: PACK_CODES, ranges: [[600, 699]] },
  { name: 'migrate', table: MIGRATE_CODES, ranges: [[700, 749]] },
];

/** A secondary location attached to a diagnostic ("first defined here", "this #if"). */
export interface RelatedInfo {
  readonly span: Span;
  readonly message: string;
}

/** One reported problem. `severity` is the effective one (a warning under -Werror is an error, code unchanged). */
export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly severity: Severity;
  readonly span: Span;
  readonly message: string;
  readonly hint?: string;
  readonly related?: readonly RelatedInfo[];
}

/** The `--diagnostics json` shape (one object per diagnostic; the CLI prints a JSON array). Lines and columns are 1-based; `endCol` is exclusive. */
export interface DiagnosticJson {
  file: string;
  line: number;
  col: number;
  endLine: number;
  endCol: number;
  severity: Severity;
  code: string;
  message: string;
  hint?: string;
  related?: Array<{ file: string; line: number; col: number; message: string }>;
}

/** Thrown only for compiler bugs (a broken invariant), never for user errors. `compile()` reports it as E001. */
export class InternalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InternalError';
  }
}

/** The number part of a code (`'W301'` -> 301), or NaN. */
export function codeNumber(code: string): number {
  const m = /^[EW]?(\d{3})$/i.exec(code.trim());
  return m ? Number(m[1]) : NaN;
}

export interface DiagnosticOptions {
  /** Warning numbers or codes to drop (`-W 301` / `-W W301`). Errors cannot be disabled. */
  readonly disabled?: Iterable<string | number>;
  /** `-Werror`: report warnings as errors. */
  readonly warningsAsErrors?: boolean;
  /** Stop collecting after this many errors (later reports are dropped; `limitReached` turns true). Default: no limit. */
  readonly errorLimit?: number;
}

/**
 * The collector every stage reports into. Order of `all()` is deterministic:
 * by file id, start offset, end offset, code, then insertion order.
 */
export class DiagnosticBag {
  private readonly items: Diagnostic[] = [];
  private readonly disabled = new Set<number>();
  private readonly werror: boolean;
  private readonly errorLimit: number;
  private errorCount = 0;
  limitReached = false;

  constructor(options: DiagnosticOptions = {}) {
    for (const c of options.disabled ?? []) this.disabled.add(typeof c === 'number' ? c : codeNumber(c));
    this.werror = options.warningsAsErrors ?? false;
    this.errorLimit = options.errorLimit ?? Infinity;
  }

  /** Reports `code` at `span`. Message and hint default from the code table's title and hint. */
  report(code: DiagnosticCode, span: Span, message?: string, hint?: string, related?: readonly RelatedInfo[]): void {
    const info: CodeInfo = CODES[code];
    let severity: Severity = info.severity;
    if (severity === 'warning') {
      if (this.disabled.has(codeNumber(code))) return;
      if (this.werror) severity = 'error';
    }
    if (severity === 'error') {
      if (this.errorCount >= this.errorLimit) {
        this.limitReached = true;
        return;
      }
      this.errorCount++;
    }
    const h = hint ?? info.hint;
    this.items.push({
      code,
      severity,
      span,
      message: message ?? info.title,
      ...(h !== undefined ? { hint: h } : {}),
      ...(related && related.length > 0 ? { related } : {}),
    });
  }

  /** Adds an already-built diagnostic (e.g. from the assembler's result) through the same filters. */
  add(d: Diagnostic): void {
    this.report(d.code, d.span, d.message, d.hint, d.related);
  }

  get hasErrors(): boolean {
    return this.errorCount > 0;
  }

  get size(): number {
    return this.items.length;
  }

  /** All diagnostics, sorted deterministically. */
  all(): Diagnostic[] {
    return this.items
      .map((d, i) => ({ d, i }))
      .sort(
        (a, b) =>
          a.d.span.file - b.d.span.file ||
          a.d.span.start - b.d.span.start ||
          a.d.span.end - b.d.span.end ||
          (a.d.code < b.d.code ? -1 : a.d.code > b.d.code ? 1 : 0) ||
          a.i - b.i,
      )
      .map((x) => x.d);
  }
}

/** `file:line:col: error E151: message` plus, when there is a hint, a second line `  hint: ...`. */
export function formatDiagnostic(d: Diagnostic, sources: SourceSet): string {
  const file = sources.get(d.span.file);
  const pos = sources.position(d.span.file, d.span.start);
  const head = `${file.path}:${pos.line}:${pos.col}: ${d.severity} ${d.code}: ${d.message}`;
  return d.hint ? `${head}\n  hint: ${d.hint}` : head;
}

/** The JSON form of one diagnostic. */
export function diagnosticToJson(d: Diagnostic, sources: SourceSet): DiagnosticJson {
  const { start, end } = sources.range(d.span);
  const json: DiagnosticJson = {
    file: sources.get(d.span.file).path,
    line: start.line,
    col: start.col,
    endLine: end.line,
    endCol: end.col,
    severity: d.severity,
    code: d.code,
    message: d.message,
  };
  if (d.hint !== undefined) json.hint = d.hint;
  if (d.related) {
    json.related = d.related.map((r) => {
      const p = sources.position(r.span.file, r.span.start);
      return { file: sources.get(r.span.file).path, line: p.line, col: p.col, message: r.message };
    });
  }
  return json;
}
