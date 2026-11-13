/**
 * The preprocessor. Contract: core/tokens.ts (`PreprocessFn`). Spec: modern layer, preprocessor;
 *
 * Each file is lexed with `lex`; definition, include and conditional directives are consumed here, the
 * rest (`#pragma`, `#require`, `#init`, `#line`) pass through. Errors sit at the directive, except
 * include errors (at the file name) and macro argument errors (at the macro name).
 */
import { DiagnosticBag } from '../core/diagnostics.js';
import { decodeText, dirname, joinPath, normalizePath, SourceSet, type SourceFile, type SourceOrigin, type Span } from '../core/source.js';
import { LIBRARY_PREFIX, type DirectiveToken, type IncludeRecord, type MacroDef, type PreprocessFn, type PreprocessInput, type PreprocessResult, type Token } from '../core/tokens.js';
import { lex } from '../lexer/index.js';
import { evalIfExpression } from './expr.js';
import { expandAsmLine, expandAt, isBuiltin, type ExpandContext } from './macros.js';

export const IMPLEMENTED = true;

export interface PredefinedOptions {
  /** `YYYY-MM-DD`, from the host (the library never reads a clock). */
  readonly buildDate: string;
  /** Compiler version; default `0.1.0`. */
  readonly version?: string;
}

/**
 * `__CPC__`, `__CPCBAS__`, `__VERSION__` and `__DATE__` as `-D`-style text, for L1-WIRE to merge with
 * the user's `-D` names. `__FILE__` and `__LINE__` are built in and not listed.
 */
export function predefinedMacros(options: PredefinedOptions): Map<string, string> {
  const m = new Map<string, string>();
  m.set('__CPC__', '1');
  m.set('__CPCBAS__', '1');
  m.set('__VERSION__', `"${options.version ?? '0.1.0'}"`);
  m.set('__DATE__', `"${options.buildDate}"`);
  return m;
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface Frame {
  readonly span: Span;
  readonly parentActive: boolean;
  /** Some branch of this #if has been (or will not need to be) taken. */
  taken: boolean;
  active: boolean;
  sawElse: boolean;
}

class Run {
  readonly macros = new Map<string, MacroDef>();
  /** Macros from `-D` that are still as the command line gave them. */
  readonly fromCommandLine = new Map<string, string>();
  readonly includes: IncludeRecord[] = [];
  readonly included = new Set<string>();
  readonly stack: string[] = [];
  readonly ctx: ExpandContext;
  private readonly diag: DiagnosticBag;
  private readonly sources: SourceSet;

  constructor(readonly input: PreprocessInput) {
    this.diag = input.diagnostics;
    this.sources = input.sources;
    this.ctx = { macros: this.macros, sources: this.sources, diagnostics: this.diag };
  }

  /** Builds the `-D` macros. They are lexed in a scratch file set so that file ids stay "first met". */
  defineFromCommandLine(): void {
    const scratch = new SourceSet();
    const sink = new DiagnosticBag();
    const names = [...this.input.defines.keys()].sort();
    for (const name of names) {
      const value = (this.input.defines.get(name) as string).trim();
      const file = scratch.add(`<command line>/${name}`, value);
      const body = lex(file, sink, { range: { start: 0, end: value.length } }).filter((t) => t.kind !== 'EOF' && t.kind !== 'Newline');
      const span = { file: file.id, start: 0, end: value.length };
      this.macros.set(name, { name, params: null, body, bodyText: value, span });
      this.fromCommandLine.set(name, value);
    }
  }

  /** Registers the `<command line>` file now (last, so ids stay in first-met order) and re-lexes the surviving `-D` macros in it. */
  finishCommandLine(): void {
    const keep = [...this.fromCommandLine.entries()].filter(([n, v]) => this.macros.get(n)?.bodyText === v);
    if (keep.length === 0) return;
    let text = '';
    const sink = new DiagnosticBag();
    const ranges: Array<{ name: string; start: number; end: number; value: string }> = [];
    for (const [name, value] of keep) {
      const start = text.length + name.length + 1;
      text += `${name}=${value}\n`;
      ranges.push({ name, start, end: start + value.length, value });
    }
    const file = this.sources.add('<command line>', text, 'generated');
    for (const r of ranges) {
      const body = lex(file, sink, { range: { start: r.start, end: r.end } }).filter((t) => t.kind !== 'EOF' && t.kind !== 'Newline');
      this.macros.set(r.name, { name: r.name, params: null, body, bodyText: r.value, span: { file: file.id, start: r.start, end: r.end } });
    }
  }

  // ------------------------------------------------------------------ files

  /** Processes one file's tokens into `out`. Returns the file's EOF token. */
  processFile(file: SourceFile, out: Token[], asmBody = false): Token {
    this.stack.push(file.path);
    this.included.add(file.path);
    const toks = lex(file, this.diag, asmBody ? { ...this.input.lexOptions, asmBody: true } : this.input.lexOptions);
    const frames: Frame[] = [];
    const active = (): boolean => frames.length === 0 || (frames[frames.length - 1] as Frame).active;
    let eof = toks[toks.length - 1] as Token;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i] as Token;
      if (t.kind === 'EOF') {
        eof = t;
        break;
      }
      if (t.kind === 'Directive') {
        this.directive(t, file, frames, out, active());
        continue;
      }
      if (!active()) continue;
      if (t.kind === 'Identifier') {
        const r = expandAt(this.ctx, toks, i, new Set());
        if (r) {
          out.push(...r.out);
          i = r.next - 1;
          continue;
        }
      } else if (t.kind === 'AsmLine') {
        out.push(expandAsmLine(this.ctx, t));
        continue;
      }
      out.push(t);
    }
    for (const f of frames) this.diag.report('E124', f.span, 'This #if has no #endif', 'Add #endif at the end of the conditional.');
    this.stack.pop();
    return eof;
  }

  // ------------------------------------------------------------- directives

  private directive(d: DirectiveToken, file: SourceFile, frames: Frame[], out: Token[], isActive: boolean): void {
    const name = d.name;
    switch (name) {
      case 'if':
      case 'ifdef':
      case 'ifndef': {
        if (!isActive) {
          frames.push({ span: d.span, parentActive: false, taken: true, active: false, sawElse: false });
          return;
        }
        const v = name === 'if' ? this.condition(d) : this.defCondition(d, name === 'ifndef');
        frames.push({ span: d.span, parentActive: true, taken: v, active: v, sawElse: false });
        return;
      }
      case 'elif': {
        const f = frames[frames.length - 1];
        if (!f) return void this.diag.report('E123', d.span, '#elif without #if');
        if (f.sawElse) return void this.diag.report('E123', d.span, '#elif after #else');
        if (f.parentActive && !f.taken) {
          const v = this.condition(d);
          f.active = v;
          f.taken = v;
        } else f.active = false;
        return;
      }
      case 'else': {
        const f = frames[frames.length - 1];
        if (!f) return void this.diag.report('E123', d.span, '#else without #if');
        if (f.sawElse) return void this.diag.report('E123', d.span, 'A second #else for the same #if');
        f.sawElse = true;
        f.active = f.parentActive && !f.taken;
        f.taken = true;
        return;
      }
      case 'endif': {
        if (frames.length === 0) return void this.diag.report('E123', d.span, '#endif without #if');
        frames.pop();
        return;
      }
      default:
    }
    if (!isActive) return;
    switch (name) {
      case 'include':
        return this.include(d, file, out);
      case 'define':
        return this.define(d, file);
      case 'undef': {
        const n = d.rest.replace(/'.*$/, '').trim();
        if (!IDENT.test(n)) return void this.diag.report('E130', d.span, '#undef needs one macro name');
        this.macros.delete(n);
        this.fromCommandLine.delete(n);
        return;
      }
      case 'error':
      case 'warning': {
        const msg = messageText(d.rest);
        if (name === 'error') this.diag.report('E127', d.span, msg === '' ? undefined : msg);
        else this.diag.report('W128', d.span, msg === '' ? undefined : msg);
        return;
      }
      case 'pragma':
        if (!wellFormedPragma(d.rest)) this.diag.report('E130', d.span, 'Malformed #pragma', 'Write #pragma name, #pragma name = value, #pragma push(name) or #pragma pop(name).');
        else out.push(d);
        return;
      case 'require':
        if (!/^\s*"[^"]+"\s*(?:'.*)?$/.test(d.rest)) this.diag.report('E130', d.span, '#require needs a quoted file name', 'Write #require "file.asm".');
        else out.push(d);
        return;
      case 'init':
        if (!/^[A-Za-z_.][\w.]*$/.test(d.rest.replace(/'.*$/, '').trim())) this.diag.report('E130', d.span, '#init needs a label', 'Write #init label.');
        else out.push(d);
        return;
      case 'line':
        out.push(d);
        return;
      default:
        this.diag.report('E122', d.span, `Unknown preprocessor directive '#${d.name}'`, 'The directives are include, define, undef, ifdef, ifndef, if, elif, else, endif, error, warning, pragma, require, init and line.');
    }
  }

  private defCondition(d: DirectiveToken, negate: boolean): boolean {
    const n = d.rest.replace(/'.*$/, '').trim();
    if (!IDENT.test(n)) {
      this.diag.report('E130', d.span, `#${d.name} needs one macro name`);
      return false;
    }
    const defined = this.macros.has(n) || isBuiltin(n);
    return negate ? !defined : defined;
  }

  private condition(d: DirectiveToken): boolean {
    const r = evalIfExpression(d.rest, {
      lookup: (n) => {
        const m = this.macros.get(n);
        if (m) return { params: m.params, text: m.bodyText };
        if (n === '__LINE__') return { params: null, text: String(this.sources.position(d.span.file, d.span.start).line) };
        if (n === '__FILE__') return { params: null, text: '""' };
        return undefined;
      },
    });
    if (!r.ok) {
      this.diag.report('E125', d.span, `Invalid #${d.name} expression: ${r.message}`);
      return false;
    }
    return r.value !== 0;
  }

  // ----------------------------------------------------------------- define

  private define(d: DirectiveToken, file: SourceFile): void {
    const m = /^([ \t]*)([A-Za-z_][A-Za-z0-9_]*)/.exec(d.rest);
    if (!m) return void this.diag.report('E130', d.span, '#define needs a macro name', 'Write #define NAME value.');
    const name = m[2] as string;
    let idx = m[0].length;
    let params: string[] | null = null;
    if (d.rest[idx] === '(') {
      const close = d.rest.indexOf(')', idx);
      if (close < 0) return void this.diag.report('E130', d.span, `The parameter list of macro '${name}' is not closed`);
      const inner = d.rest.slice(idx + 1, close).trim();
      params = inner === '' ? [] : inner.split(',').map((s) => s.trim());
      if (params.some((p) => !IDENT.test(p)) || new Set(params).size !== params.length) {
        return void this.diag.report('E130', d.span, `Bad parameter list for macro '${name}'`, 'Parameters are distinct names separated by commas.');
      }
      idx = close + 1;
    }
    const bodyStart = d.restSpan.start + idx;
    const bodyEnd = d.restSpan.end;
    const body =
      bodyEnd > bodyStart
        ? lex(file, this.diag, { range: { start: bodyStart, end: bodyEnd } }).filter((t) => t.kind !== 'EOF' && t.kind !== 'Newline' && t.kind !== 'Comment')
        : [];
    const first = body[0];
    const last = body[body.length - 1];
    const bodyText = first && last ? file.text.slice(first.span.start, last.span.end).replace(/[ \t]_(?:\r\n|\r|\n)[ \t]*/g, ' ') : '';
    const def: MacroDef = { name, params, body, bodyText, span: d.span };
    const old = this.macros.get(name);
    if (old && !sameBody(old, def)) {
      const related = this.fromCommandLine.has(name) ? undefined : [{ span: old.span, message: 'first defined here' }];
      this.diag.report('W129', d.span, `Macro '${name}' is redefined with a different body`, undefined, related);
    }
    this.macros.set(name, def);
    this.fromCommandLine.delete(name);
  }

  // ---------------------------------------------------------------- include

  private include(d: DirectiveToken, file: SourceFile, out: Token[]): void {
    const m = /^([ \t]*)(?:(once)(?=[ \t"<]))?([ \t]*)(?:"([^"\r\n]*)"|<([^>\r\n]*)>)[ \t]*(?:'.*)?$/i.exec(d.rest.replace(/[ \t]_(?:\r\n|\r|\n)[ \t]*/g, ' '));
    if (!m || (m[4] ?? m[5] ?? '') === '') {
      return void this.diag.report('E130', d.span, 'Malformed #include', 'Write #include "file", #include <file> or #include once "file".');
    }
    const once = m[2] !== undefined;
    const angle = m[5] !== undefined;
    const requested = (angle ? m[5] : m[4]) as string;
    // The span of the file name, with its delimiters (only exact when no continuation was joined).
    const q = d.rest.indexOf(angle ? '<' : '"', (m[1] as string).length + (once ? 4 : 0));
    const nameStart = d.restSpan.start + (q >= 0 ? q : 0);
    const nameSpan: Span = { file: d.span.file, start: nameStart, end: nameStart + requested.length + 2 };
    const display = angle ? `<${requested}>` : `"${requested}"`;

    const found = this.resolve(requested, angle, file);
    if (!found) {
      this.diag.report('E120', nameSpan, `Cannot find include file ${display}`, angle ? 'Check the include paths (-I).' : "Looked in the including file's directory and the include paths (-I).");
      this.includes.push({ span: d.span, requested: display, angle, once, file: null, skipped: false });
      return;
    }
    const origin: SourceOrigin = found.viaIncludePath || found.fromLibrary || file.origin === 'library' ? 'library' : 'user';
    const content = found.fromLibrary
      ? this.input.library?.get(found.path.slice(LIBRARY_PREFIX.length))
      : this.input.tree.get(found.path);
    const target = this.sources.add(found.path, decodeText(content as NonNullable<typeof content>), origin);
    if (this.stack.includes(target.path)) {
      if (once) {
        this.includes.push({ span: d.span, requested: display, angle, once, file: target.id, skipped: true });
        return;
      }
      this.diag.report('E121', nameSpan, `Include cycle: ${[...this.stack, target.path].join(' -> ')}`, 'Use #include once, or break the cycle.');
      this.includes.push({ span: d.span, requested: display, angle, once, file: target.id, skipped: true });
      return;
    }
    if (once && this.included.has(target.path)) {
      this.includes.push({ span: d.span, requested: display, angle, once, file: target.id, skipped: true });
      return;
    }
    this.includes.push({ span: d.span, requested: display, angle, once, file: target.id, skipped: false });
    const before = out.length;
    // Inside an ASM block the file's lines are ASM lines (Boriel's textual include).
    const eof = this.processFile(target, out, d.inAsm === true);
    const last = out[out.length - 1];
    if (out.length > before && last && last.kind !== 'Newline') {
      out.push({ kind: 'Newline', span: { file: target.id, start: eof.span.start, end: eof.span.start }, text: '', spaceBefore: false, lineStart: false });
    }
  }

  /**
   * Where an include is: the including file's directory (quoted form; inside the library for a
   * library file), then the include paths, then the bundled library (`f`, then `stdlib/f`).
   */
  private resolve(name: string, angle: boolean, from: SourceFile): { path: string; viaIncludePath: boolean; fromLibrary: boolean } | null {
    const tree = this.input.tree;
    const lib = this.input.library;
    const inLib = (p: string): boolean => lib !== undefined && !p.startsWith('../') && p !== '..' && lib.has(p);
    if (!angle) {
      if (from.path.startsWith(LIBRARY_PREFIX)) {
        const p = joinPath(dirname(from.path.slice(LIBRARY_PREFIX.length)), name);
        if (inLib(p)) return { path: LIBRARY_PREFIX + p, viaIncludePath: false, fromLibrary: true };
      } else {
        const p = joinPath(dirname(from.path), name);
        if (tree.has(p)) return { path: p, viaIncludePath: false, fromLibrary: false };
      }
    }
    for (const ip of this.input.includePaths) {
      const p = joinPath(ip, name);
      if (tree.has(p)) return { path: p, viaIncludePath: true, fromLibrary: false };
    }
    for (const p of [normalizePath(name), joinPath('stdlib', name)]) {
      if (inLib(p)) return { path: LIBRARY_PREFIX + p, viaIncludePath: false, fromLibrary: true };
    }
    return null;
  }
}

function sameBody(a: MacroDef, b: MacroDef): boolean {
  if ((a.params?.join(',') ?? null) !== (b.params?.join(',') ?? null)) return false;
  return a.body.length === b.body.length && a.body.every((t, i) => t.text === (b.body[i] as Token).text);
}

/** The text of `#error`/`#warning`: a string literal's value, or the raw text. */
function messageText(rest: string): string {
  const t = rest.trim();
  const m = /^"((?:[^"]|"")*)"/.exec(t);
  return m ? (m[1] as string).replace(/""/g, '"') : t;
}

function wellFormedPragma(rest: string): boolean {
  const r = rest.replace(/[ \t]_(?:\r\n|\r|\n)[ \t]*/g, ' ').replace(/'.*$/, '').trim();
  if (/^(?:push|pop)\s*\(\s*[A-Za-z_][A-Za-z0-9_]*\s*\)$/i.test(r)) return true;
  return /^[A-Za-z_][A-Za-z0-9_]*(?:\s*=\s*\S.*)?$/.test(r);
}

export const preprocess: PreprocessFn = (input: PreprocessInput): PreprocessResult => {
  const content = input.tree.get(input.main);
  if (content === undefined) {
    const missing = input.sources.add(input.main, '', 'user');
    const span = { file: missing.id, start: 0, end: 0 };
    input.diagnostics.report('E003', span, `Cannot find the main file '${input.main}'`);
    return {
      tokens: [{ kind: 'EOF', span, text: '', spaceBefore: false, lineStart: false }],
      includes: [],
      macros: new Map(),
      mainFile: null,
    };
  }
  const main = input.sources.add(input.main, decodeText(content), 'user');
  const run = new Run(input);
  run.defineFromCommandLine();
  const tokens: Token[] = [];
  const eof = run.processFile(main, tokens);
  tokens.push(eof);
  run.finishCommandLine();
  return { tokens, includes: run.includes, macros: run.macros, mainFile: main.id };
};
