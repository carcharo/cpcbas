/**
 * The token dump: the `--stage tokens` format.
 *
 * One token per line: `line:col Kind text payload`.
 * - `line:col` is the start of the token's span (1-based).
 * - `Kind` is the token kind; punctuation shows its own text (`(`, `<=`).
 * - `text` is the token's source text as a JSON string (so a newline reads `"\n"`).
 * - `payload` is the kind's extra fields as `name=value` pairs (strings in double
 *   quotes, `-` for null), then `fromMacro` for a token that came from a macro body.
 *   Kinds with nothing extra have no payload.
 */

import type { SourceSet } from './source.js';
import type { Token } from './tokens.js';

function v(x: unknown): string {
  if (x === null) return '-';
  if (typeof x === 'string') return JSON.stringify(x);
  return String(x);
}

function payload(t: Token): string[] {
  switch (t.kind) {
    case 'Number':
      return [`value=${v(t.value)}`, `radix=${t.radix}`, `real=${t.isReal}`, `suffix=${v(t.suffix)}`];
    case 'String':
      return [`value=${v(t.value)}`, `closed=${t.closed}`];
    case 'Identifier':
      return [`name=${v(t.name)}`, `suffix=${v(t.suffix)}`, `key=${v(t.key)}`];
    case 'Keyword':
      return [`keyword=${v(t.keyword)}`];
    case 'LineNumber':
      return [`value=${t.value}`];
    case 'Label':
      return [`name=${v(t.name)}`, `key=${v(t.key)}`];
    case 'Rsx':
      return [`name=${v(t.name)}`];
    case 'DataItem':
      return [`raw=${v(t.raw)}`, `quoted=${t.quoted}`];
    case 'AsmLine':
      return [];
    case 'Directive':
      return [`name=${v(t.name)}`, `rest=${v(t.rest)}`];
    case 'Comment':
      return [`style=${t.style}`, `body=${v(t.body)}`];
    case 'Newline':
    case 'EOF':
    case 'Invalid':
      return [];
    default:
      // punctuation and operators: the kind is the text
      return [];
  }
}

/** One line per token, each ending with a newline. */
export function printTokens(tokens: readonly Token[], sources: SourceSet): string {
  let out = '';
  for (const t of tokens) {
    const pos = sources.position(t.span.file, t.span.start);
    const parts = [`${pos.line}:${pos.col}`, t.kind, JSON.stringify(t.text), ...payload(t)];
    if (t.fromMacro) parts.push('fromMacro');
    out += `${parts.join(' ')}\n`;
  }
  return out;
}
