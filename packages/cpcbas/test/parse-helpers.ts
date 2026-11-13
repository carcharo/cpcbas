/**
 * Test helpers for the parser: run the real front end (lex, preprocess, parse) over a string
 * and read the result back as diagnostics, S-expressions or source.
 */

import type { Expr, Program, Stmt } from '../src/ast/ast.js';
import { DiagnosticBag } from '../src/core/diagnostics.js';
import { SourceSet } from '../src/core/source.js';
import type { PreprocessResult } from '../src/core/tokens.js';
import { lex } from '../src/lexer/index.js';
import { parse } from '../src/parser/index.js';
import { runFrontEnd } from '../src/pipeline.js';

export interface ParsedSource {
  readonly program: Program;
  readonly diag: DiagnosticBag;
  readonly sources: SourceSet;
  /** `line:col CODE` of every diagnostic, in report order of `diag.all()`. */
  readonly where: string[];
  readonly codes: string[];
}

export function parseSource(text: string): ParsedSource {
  const sources = new SourceSet();
  const diag = new DiagnosticBag();
  const { program } = runFrontEnd({ files: new Map([['t.bas', text]]), main: 't.bas' }, sources, diag);
  const all = diag.all();
  const where = all.map((d) => {
    const p = sources.position(d.span.file, d.span.start);
    return `${p.line}:${p.col} ${d.code}`;
  });
  return { program, diag, sources, where, codes: all.map((d) => d.code) };
}

/**
 * Lex and parse without the preprocessor, for tests of checks the parser makes on directive
 * tokens that the real pipeline's preprocessor would already have reported (E130 before E187).
 */
export function parseSourceRaw(text: string): ParsedSource {
  const sources = new SourceSet();
  const file = sources.add('t.bas', text);
  const diag = new DiagnosticBag();
  const tokens = lex(file, diag, {});
  const pp: PreprocessResult = { tokens, includes: [], macros: new Map(), mainFile: file.id };
  const program = parse({ pp, sources, diagnostics: diag });
  const all = diag.all();
  const where = all.map((d) => {
    const p = sources.position(d.span.file, d.span.start);
    return `${p.line}:${p.col} ${d.code}`;
  });
  return { program, diag, sources, where, codes: all.map((d) => d.code) };
}

/** An expression as a fully parenthesised S-expression: `(+ 1 (* 2 3))`. */
export function sexp(e: Expr): string {
  switch (e.kind) {
    case 'NumberLit':
      return e.text;
    case 'StringLit':
      return JSON.stringify(e.value);
    case 'Name':
      return e.text + (e.suffix ?? '');
    case 'Unary':
      return `(${e.op === 'NOT' ? 'NOT' : `u${e.op}`} ${sexp(e.operand)})`;
    case 'Binary':
      return `(${e.op} ${sexp(e.left)} ${sexp(e.right)})`;
    case 'AddressOf':
      return `(@ ${sexp(e.target)}${(e.index ?? []).map((a) => ` ${sexp(a)}`).join('')})`;
    case 'CallOrIndex':
      return `(call ${sexp(e.callee)}${e.args.map((a) => ` ${sexp(a)}`).join('')})`;
    case 'BuiltinCall': {
      const parts: string[] = [];
      if (e.typeArg) parts.push(e.typeArg.name);
      if (e.stream) parts.push(`#${sexp(e.stream)}`);
      for (const a of e.args) parts.push(sexp(a));
      return `(${e.keyword}${parts.map((p) => ` ${p}`).join('')})`;
    }
    case 'FnCall':
      return `(FN ${sexp(e.name)}${e.args.map((a) => ` ${sexp(a)}`).join('')})`;
    case 'BadExpr':
      return '<bad>';
  }
}

/** Parses `x = <expr>` and returns the S-expression of the expression (diagnostics ignored). */
export function exprOf(text: string): string {
  const { program } = parseSource(`x = ${text}`);
  const s = program.body[0];
  if (s?.kind !== 'Let') throw new Error(`not a Let: ${s?.kind}`);
  return sexp(s.value);
}

/** The statements of a program without the LineLabels. */
export function stmtsOf(text: string): Stmt[] {
  return parseSource(text).program.body.filter((s) => s.kind !== 'LineLabel');
}
