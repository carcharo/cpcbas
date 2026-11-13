/**
 * The asm preprocessor (task L2-ASMPP): includes, object-like defines, conditionals,
 * `#init`, `#line` -> a flat list of attributed lines. Contract: asm/types.ts.
 *
 * Follows the reference (zxbpp in ASM mode): directives start with `#` in column 1
 * (spaces may follow the `#`), directive names are case-insensitive, macro names are
 * case-sensitive, `;` starts a comment that is never scanned, and strings and
 * character constants are never expanded.
 */

import type { DiagnosticCode } from '../core/diagnostics.js';
import type { FileId, SourceFile, Span } from '../core/source.js';
import type { AsmPreprocessFn, AsmPreprocessInput, AsmPreprocessResult, AsmSourceLine } from './types.js';

const MAX_INCLUDE_DEPTH = 64;
const MAX_EXPANSION_DEPTH = 32;

type Attribution = { path: string; line: number } | null;

interface Cond {
  /** Whether the enclosing region was active when this conditional opened. */
  readonly parentActive: boolean;
  /** Whether any branch of this conditional has been taken. */
  taken: boolean;
  active: boolean;
  sawElse: boolean;
  readonly span: Span;
}

const ID_RE = /^[_A-Za-z][_A-Za-z0-9]*/;
const NUMBER_RES: readonly RegExp[] = [
  /^[0-9][0-9a-fA-F]*[hH]/,
  /^\$[0-9a-fA-F]+/,
  /^%[01]+/,
  /^[01]+[bB]/,
  /^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:[eE][-+]?[0-9]+)?/,
];

/** Index of the `;` that starts a comment (outside strings and character constants), or -1. */
function commentStart(s: string): number {
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === ';') return i;
    if (c === '"') {
      i = skipString(s, i) - 1;
    } else if (c === "'") {
      const m = /^'(?:[^'\n]|'')'/.exec(s.slice(i));
      if (m) i += m[0].length - 1;
    }
  }
  return -1;
}

/** Index just past the string that starts at `i` (a doubled quote is an escaped quote). */
function skipString(s: string, i: number): number {
  let j = i + 1;
  while (j < s.length) {
    if (s[j] === '"') {
      if (s[j + 1] === '"') j += 2;
      else return j + 1;
    } else j++;
  }
  return s.length;
}

export const preprocessAsm: AsmPreprocessFn = (input: AsmPreprocessInput): AsmPreprocessResult => {
  const { sources, resolveInclude, diagnostics } = input;
  const lines: AsmSourceLine[] = [];
  const inits: Array<{ label: string; span: Span }> = [];
  const defines = new Map<string, string>(input.defines ?? []);
  const included = new Set<string>([input.entry.path]);
  const onceFiles = new Set<string>();

  const report = (code: DiagnosticCode, span: Span, message?: string, hint?: string): void =>
    diagnostics.report(code, span, message, hint);

  function expand(text: string, depth: number, active: ReadonlySet<string>): string {
    if (defines.size === 0) return text;
    let out = '';
    let i = 0;
    while (i < text.length) {
      const c = text[i] as string;
      if (c === ';') return out + text.slice(i);
      if (c === '"') {
        const j = skipString(text, i);
        out += text.slice(i, j);
        i = j;
        continue;
      }
      if (c === "'") {
        const m = /^'(?:[^'\n]|'')'/.exec(text.slice(i));
        if (m) {
          out += m[0];
          i += m[0].length;
          continue;
        }
      }
      const rest = text.slice(i);
      if (/[0-9$%.]/.test(c)) {
        let matched: string | undefined;
        for (const re of NUMBER_RES) {
          const m = re.exec(rest);
          if (m) {
            matched = m[0];
            break;
          }
        }
        if (matched) {
          out += matched;
          i += matched.length;
          continue;
        }
      }
      const id = ID_RE.exec(rest);
      if (id) {
        const name = id[0];
        const value = defines.get(name);
        if (value !== undefined && !active.has(name) && depth < MAX_EXPANSION_DEPTH) {
          out += expand(value, depth + 1, new Set([...active, name]));
        } else out += name;
        i += name.length;
        continue;
      }
      out += c;
      i++;
    }
    return out;
  }

  // ----- #if expressions -----
  function evalIf(expr: string, span: Span): boolean {
    const toks: string[] = [];
    const re = /\s*(defined|[_A-Za-z][_A-Za-z0-9]*|[0-9]+|&&|\|\||==|!=|<>|<=|>=|[-+*/%()!<>=]|\S)/gy;
    let m: RegExpExecArray | null;
    while ((m = re.exec(expr)) !== null) toks.push(m[1] as string);
    let pos = 0;
    let failed = false;
    const fail = (msg: string): number => {
      if (!failed) report('E569', span, `Bad #if expression: ${msg}`, 'Use integers, names, defined(NAME), ! && || == != < > <= >= + - * / % and parentheses.');
      failed = true;
      return 0;
    };
    const peek = (): string | undefined => toks[pos];
    const value = (name: string): number => {
      const v = defines.get(name);
      if (v === undefined) return 0;
      const t = v.trim();
      if (/^[0-9]+$/.test(t)) return Number(t);
      return 1; // defined with another value: truthy, like the reference's defined() test
    };
    const primary = (): number => {
      const t = toks[pos++];
      if (t === undefined) return fail('unexpected end');
      if (t === '(') {
        const v = or();
        if (toks[pos++] !== ')') return fail('missing )');
        return v;
      }
      if (t === '!') return primary() === 0 ? 1 : 0;
      if (t === '-') return -primary();
      if (t === '+') return primary();
      if (/^[0-9]+$/.test(t)) return Number(t);
      if (t === 'defined') {
        const paren = peek() === '(';
        if (paren) pos++;
        const name = toks[pos++];
        if (name === undefined || !ID_RE.test(name)) return fail('defined needs a name');
        if (paren && toks[pos++] !== ')') return fail('missing )');
        return defines.has(name) ? 1 : 0;
      }
      if (ID_RE.test(t)) return value(t);
      return fail(`unexpected '${t}'`);
    };
    const bin = (next: () => number, ops: readonly string[], f: (op: string, a: number, b: number) => number): (() => number) =>
      () => {
        let a = next();
        while (peek() !== undefined && ops.includes(peek() as string)) {
          const op = toks[pos++] as string;
          a = f(op, a, next());
        }
        return a;
      };
    const mul = bin(primary, ['*', '/', '%'], (op, a, b) => (op === '*' ? a * b : b === 0 ? fail('division by zero') : op === '/' ? Math.trunc(a / b) : a % b));
    const add = bin(mul, ['+', '-'], (op, a, b) => (op === '+' ? a + b : a - b));
    const rel = bin(add, ['<', '>', '<=', '>='], (op, a, b) => Number(op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b));
    const eq = bin(rel, ['==', '!=', '<>', '='], (op, a, b) => Number(op === '==' || op === '=' ? a === b : a !== b));
    const and = bin(eq, ['&&'], (_o, a, b) => Number(a !== 0 && b !== 0));
    const or: () => number = bin(and, ['||'], (_o, a, b) => Number(a !== 0 || b !== 0));
    const v = or();
    if (!failed && pos < toks.length) fail(`unexpected '${toks[pos] as string}'`);
    return v !== 0 && !failed;
  }

  function processFile(file: SourceFile, depth: number): void {
    const text = file.text;
    const conds: Cond[] = [];
    let attribution: Attribution = null;
    let active = true;

    // Split into physical lines with offsets.
    const re = /\r\n|\n|\r/g;
    let start = 0;
    const physical: Array<{ start: number; end: number }> = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      physical.push({ start, end: m.index });
      start = m.index + m[0].length;
    }
    if (start < text.length) physical.push({ start, end: text.length });

    for (const pl of physical) {
      const raw = text.slice(pl.start, pl.end);
      const span: Span = { file: file.id as FileId, start: pl.start, end: pl.end };
      const directive = /^#[ \t]*([A-Za-z_]+)(.*)$/.exec(raw);
      if (directive) {
        const name = (directive[1] as string).toLowerCase();
        const arg = directive[2] as string;
        const argNoComment = (): string => {
          const c = commentStart(arg);
          return (c < 0 ? arg : arg.slice(0, c)).trim();
        };
        const lineAttr = (): void => {
          if (attribution) attribution = { path: attribution.path, line: attribution.line + 1 };
        };
        switch (name) {
          case 'ifdef':
          case 'ifndef':
          case 'if': {
            let cond = false;
            if (active) {
              if (name === 'if') cond = evalIf(argNoComment(), span);
              else {
                const id = ID_RE.exec(argNoComment());
                if (!id || id[0] !== argNoComment()) report('E564', span, `#${name} needs one name`);
                else cond = name === 'ifdef' ? defines.has(id[0]) : !defines.has(id[0]);
              }
            }
            conds.push({ parentActive: active, taken: cond, active: active && cond, sawElse: false, span });
            active = active && cond;
            break;
          }
          case 'else': {
            const top = conds[conds.length - 1];
            if (!top || top.sawElse) report('E565', span, top ? '#else after #else' : '#else without #if');
            else {
              top.sawElse = true;
              top.active = top.parentActive && !top.taken;
              top.taken = true;
              active = top.active;
            }
            break;
          }
          case 'endif': {
            const top = conds.pop();
            if (!top) report('E565', span, '#endif without #if');
            else active = top.parentActive;
            break;
          }
          default:
            if (active) handleDirective(name, argNoComment(), arg, span, file, depth, {
              setAttribution: (a) => { attribution = a; },
              getAttribution: () => attribution,
            });
        }
        lineAttr();
        continue;
      }
      if (!active) {
        if (attribution) attribution = { path: attribution.path, line: attribution.line + 1 };
        continue;
      }
      lines.push({ text: expand(raw, 0, new Set()), span, attribution });
      if (attribution) attribution = { path: attribution.path, line: attribution.line + 1 };
    }
    for (const c of conds) report('E566', c.span);
  }

  interface AttrAccess {
    setAttribution(a: Attribution): void;
    getAttribution(): Attribution;
  }

  function handleDirective(name: string, arg: string, rawArg: string, span: Span, file: SourceFile, depth: number, attr: AttrAccess): void {
    switch (name) {
      case 'include': {
        const m = /^(once[ \t]+)?(?:<([^>]+)>|"((?:[^"]|"")*)")$/.exec(arg);
        if (!m) {
          report('E564', span, '#include needs <file> or "file"', 'Write #include <name>, #include "name" or #include once <name>.');
          return;
        }
        const once = m[1] !== undefined;
        const angle = m[2] !== undefined;
        const fname = angle ? (m[2] as string) : (m[3] as string).replace(/""/g, '"');
        if (depth >= MAX_INCLUDE_DEPTH) {
          report('E567', span);
          return;
        }
        const resolved = resolveInclude(fname, file.path, angle);
        if (!resolved) {
          report('E560', span, `Include file not found: ${fname}`);
          return;
        }
        const target = sources.add(resolved.path, resolved.text, angle ? 'runtime' : 'user');
        if (once && included.has(target.path)) return;
        if (onceFiles.has(target.path)) return;
        included.add(target.path);
        processFile(target, depth + 1);
        return;
      }
      case 'define': {
        const m = /^([_A-Za-z][_A-Za-z0-9]*)(\()?(.*)$/.exec(rawArg.trim());
        if (!m) {
          report('E564', span, '#define needs a name');
          return;
        }
        if (m[2] !== undefined) {
          report('E568', span);
          return;
        }
        const body = m[3] as string;
        const c = commentStart(body);
        defines.set(m[1] as string, (c < 0 ? body : body.slice(0, c)).trim());
        return;
      }
      case 'undef': {
        if (!/^[_A-Za-z][_A-Za-z0-9]*$/.test(arg)) report('E564', span, '#undef needs a name');
        else defines.delete(arg);
        return;
      }
      case 'error':
      case 'warning': {
        let msg = rawArg.trim();
        const q = /^"((?:[^"]|"")*)"$/.exec(msg);
        if (q) msg = (q[1] as string).replace(/""/g, '"');
        if (name === 'error') report('E561', span, msg === '' ? '#error directive reached' : msg);
        else report('W562', span, msg === '' ? '#warning directive reached' : msg);
        return;
      }
      case 'init': {
        const m = /^(?:"([^"]+)"|([._A-Za-z][._A-Za-z0-9]*))$/.exec(arg);
        if (!m) {
          report('E564', span, '#init needs a label', 'Write #init label or #init "label".');
          return;
        }
        inits.push({ label: (m[1] ?? m[2]) as string, span });
        return;
      }
      case 'line': {
        // A bare `#line` ends the attribution: the lines after it are the file's own again.
        if (arg === '') {
          attr.setAttribution(null);
          return;
        }
        const m = /^([0-9]+)(?:[ \t]+"((?:[^"]|"")*)")?$/.exec(arg);
        if (!m) {
          report('E564', span, '#line needs a number and an optional "file"', 'Write #line 10 "file.bas", or #line alone to end the attribution.');
          return;
        }
        const path = m[2] !== undefined ? m[2].replace(/""/g, '"') : (attr.getAttribution()?.path ?? file.path);
        // The directive's own line advances the counter afterwards, so set it one below.
        attr.setAttribution({ path, line: Number(m[1]) - 1 });
        return;
      }
      case 'pragma':
        if (/^once$/i.test(arg)) onceFiles.add(file.path);
        return;
      case 'require':
        return;
      default:
        report('E563', span, `Unknown preprocessor directive #${name}`);
    }
  }

  processFile(input.entry, 0);
  return { lines, inits };
};
