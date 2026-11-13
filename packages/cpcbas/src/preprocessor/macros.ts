/**
 * Macro definitions and expansion; names are case-sensitive.
 *
 * Expansion works on token lists. An identifier whose `name` (no type suffix) is a macro is replaced by
 * the macro's body; every produced token carries the span of the use and `fromMacro: true`. A macro is
 * not expanded again inside its own expansion (the hide set). Function-like macros read parenthesised
 * arguments from the same line; arguments are expanded first, then substituted, then the result is
 * rescanned.
 */
import type { DiagnosticBag } from '../core/diagnostics.js';
import { joinSpans, type SourceSet, type Span } from '../core/source.js';
import type { AsmLineToken, MacroDef, NumberToken, StringToken, Token } from '../core/tokens.js';

const MAX_DEPTH = 64;

export interface ExpandContext {
  readonly macros: ReadonlyMap<string, MacroDef>;
  readonly sources: SourceSet;
  readonly diagnostics: DiagnosticBag;
}

/** True for names the preprocessor itself provides. */
export function isBuiltin(name: string): boolean {
  return name === '__FILE__' || name === '__LINE__';
}

function useToken(t: Token, span: Span, first: boolean, use: Token): Token {
  return {
    ...t,
    span,
    fromMacro: true,
    lineStart: first ? use.lineStart : false,
    spaceBefore: first ? use.spaceBefore : t.spaceBefore,
  } as Token;
}

function builtinTokens(ctx: ExpandContext, name: string, use: Token): Token[] {
  const span = use.span;
  if (name === '__FILE__') {
    const path = ctx.sources.get(span.file).path;
    const t: StringToken = {
      kind: 'String',
      span,
      text: `"${path.replace(/"/g, '""')}"`,
      spaceBefore: use.spaceBefore,
      lineStart: use.lineStart,
      fromMacro: true,
      value: path,
      closed: true,
    };
    return [t];
  }
  const line = ctx.sources.position(span.file, span.start).line;
  const t: NumberToken = {
    kind: 'Number',
    span,
    text: String(line),
    spaceBefore: use.spaceBefore,
    lineStart: use.lineStart,
    fromMacro: true,
    value: line,
    radix: 10,
    isReal: false,
    suffix: null,
  };
  return [t];
}

/**
 * Tries to expand the identifier at `toks[i]`. Returns the replacement and the index after what was
 * consumed, or null when it is not a macro use (or the use is wrong; E126 has then been reported and
 * the identifier is left as written).
 */
export function expandAt(ctx: ExpandContext, toks: readonly Token[], i: number, hide: ReadonlySet<string>, depth = 0): { out: Token[]; next: number } | null {
  const t = toks[i];
  if (!t || t.kind !== 'Identifier' || t.suffix !== null) return null;
  const name = t.name;
  if (hide.has(name) || depth > MAX_DEPTH) return null;
  const def = ctx.macros.get(name);
  if (!def) {
    if (isBuiltin(name)) return { out: builtinTokens(ctx, name, t), next: i + 1 };
    return null;
  }
  let useSpan = t.span;
  let next = i + 1;
  let args: Token[][] = [];
  if (def.params) {
    const open = toks[next];
    if (!open || open.kind !== '(') return null;
    const got = collectArgs(toks, next);
    if (!got) {
      ctx.diagnostics.report('E126', t.span, `The arguments of macro '${name}' are not closed with ')'`, 'Close the argument list on the same line.');
      return null;
    }
    args = got.args;
    next = got.next;
    useSpan = joinSpans(t.span, (toks[next - 1] as Token).span);
    const want = def.params.length;
    const have = want === 0 && args.length === 1 && args[0]?.length === 0 ? 0 : args.length;
    if (have !== want) {
      ctx.diagnostics.report('E126', t.span, `Macro '${name}' takes ${want} argument${want === 1 ? '' : 's'}, but ${have} ${have === 1 ? 'was' : 'were'} given`);
      return null;
    }
  }
  const inner = new Set(hide);
  inner.add(name);
  const params = def.params ?? [];
  const expandedArgs = args.map((a) => expandList(ctx, a, hide, depth + 1));
  const body: Token[] = [];
  let first = true;
  for (const b of def.body) {
    const pi = b.kind === 'Identifier' && b.suffix === null ? params.indexOf(b.name) : -1;
    if (pi >= 0) {
      for (const a of expandedArgs[pi] ?? []) {
        body.push(useToken(a, useSpan, first, t));
        first = false;
      }
    } else {
      body.push(useToken(b, useSpan, first, t));
      first = false;
    }
  }
  return { out: expandList(ctx, body, inner, depth + 1), next };
}

/** Expands every macro use in a token list. */
export function expandList(ctx: ExpandContext, toks: readonly Token[], hide: ReadonlySet<string>, depth = 0): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < toks.length; ) {
    const r = expandAt(ctx, toks, i, hide, depth);
    if (r) {
      out.push(...r.out);
      i = r.next;
    } else {
      out.push(toks[i] as Token);
      i++;
    }
  }
  return out;
}

/** Reads `( a, b(c), d )` starting at the `(` at `open`. Null when the line ends first. */
function collectArgs(toks: readonly Token[], open: number): { args: Token[][]; next: number } | null {
  const args: Token[][] = [[]];
  let depthP = 0;
  for (let i = open; i < toks.length; i++) {
    const t = toks[i] as Token;
    if (t.kind === 'Newline' || t.kind === 'EOF') return null;
    if (t.kind === '(') {
      depthP++;
      if (depthP === 1) continue;
    } else if (t.kind === ')') {
      depthP--;
      if (depthP === 0) return { args, next: i + 1 };
    } else if (t.kind === ',' && depthP === 1) {
      args.push([]);
      continue;
    }
    (args[args.length - 1] as Token[]).push(t);
  }
  return null;
}

// ---------------------------------------------------------------------------
// ASM text
// ---------------------------------------------------------------------------

const WORD = /[A-Za-z0-9_]/;

/** Expands macro names in the raw text of one ASM line by whole-word substitution. */
export function expandAsmText(ctx: ExpandContext, text: string, use: Span, hide: ReadonlySet<string>, depth = 0): string {
  if (depth > MAX_DEPTH) return text;
  let res = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i] as string;
    if (c === ';') {
      res += text.slice(i);
      break;
    }
    if (!WORD.test(c)) {
      res += c;
      i++;
      continue;
    }
    let j = i;
    while (j < text.length && WORD.test(text[j] as string)) j++;
    const word = text.slice(i, j);
    const prev = i > 0 ? (text[i - 1] as string) : '';
    if (/[0-9]/.test(word[0] as string) || prev === '$' || prev === '.' || hide.has(word)) {
      res += word;
      i = j;
      continue;
    }
    const def = ctx.macros.get(word);
    if (!def) {
      if (isBuiltin(word)) {
        res += word === '__LINE__' ? String(ctx.sources.position(use.file, use.start).line) : `"${ctx.sources.get(use.file).path}"`;
      } else res += word;
      i = j;
      continue;
    }
    const inner = new Set(hide);
    inner.add(word);
    let args: string[] = [];
    let end = j;
    if (def.params) {
      let k = j;
      while (text[k] === ' ' || text[k] === '\t') k++;
      if (text[k] !== '(') {
        res += word;
        i = j;
        continue;
      }
      const got = collectTextArgs(text, k);
      if (!got) {
        ctx.diagnostics.report('E126', use, `The arguments of macro '${word}' are not closed with ')'`);
        res += word;
        i = j;
        continue;
      }
      args = got.args;
      end = got.end;
      const want = def.params.length;
      const have = want === 0 && args.length === 1 && (args[0] as string).trim() === '' ? 0 : args.length;
      if (have !== want) {
        ctx.diagnostics.report('E126', use, `Macro '${word}' takes ${want} argument${want === 1 ? '' : 's'}, but ${have} ${have === 1 ? 'was' : 'were'} given`);
        res += word;
        i = j;
        continue;
      }
    }
    const params = def.params ?? [];
    const expArgs = args.map((a) => expandAsmText(ctx, a.trim(), use, hide, depth + 1));
    const body = def.bodyText.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (w, off: number, whole: string) => {
      const p = off > 0 ? whole[off - 1] : '';
      const pi = p === '$' || p === '.' ? -1 : params.indexOf(w);
      return pi >= 0 ? (expArgs[pi] as string) : w;
    });
    res += expandAsmText(ctx, body, use, inner, depth + 1);
    i = end;
  }
  return res;
}

function collectTextArgs(text: string, open: number): { args: string[]; end: number } | null {
  const args: string[] = [];
  let cur = '';
  let depth = 0;
  let quote = '';
  for (let i = open; i < text.length; i++) {
    const c = text[i] as string;
    if (quote) {
      cur += c;
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      cur += c;
    } else if (c === '(') {
      depth++;
      if (depth > 1) cur += c;
    } else if (c === ')') {
      depth--;
      if (depth === 0) {
        args.push(cur);
        return { args, end: i + 1 };
      }
      cur += c;
    } else if (c === ',' && depth === 1) {
      args.push(cur);
      cur = '';
    } else cur += c;
  }
  return null;
}

/** An AsmLine token with its macro names expanded (the span still covers the original line). */
export function expandAsmLine(ctx: ExpandContext, t: AsmLineToken): AsmLineToken {
  const text = expandAsmText(ctx, t.text, t.span, new Set());
  return text === t.text ? t : { ...t, text };
}
