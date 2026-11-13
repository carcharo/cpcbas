/**
 * The parse corpus through the lexer alone (until L1-WIRE runs the whole front end):
 * valid programs give no lexer diagnostic except the warnings their `.expect` lists, and
 * each lexer error case gives exactly its expected code at its expected position.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DiagnosticBag } from '../src/core/diagnostics.js';
import { SourceSet } from '../src/core/source.js';
import { lex } from '../src/lexer/index.js';

const ROOT = fileURLToPath(new URL('../../../tests/parse-corpus/', import.meta.url));

function lexFile(path: string): string[] {
  const sources = new SourceSet();
  const file = sources.add('t.bas', readFileSync(path, 'utf8'));
  const diag = new DiagnosticBag();
  lex(file, diag);
  return diag.all().map((d) => {
    const p = sources.position(file.id, d.span.start);
    return `${p.line}:${p.col} ${d.code}`;
  });
}

function expected(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => l.split(' ').slice(0, 2).join(' '));
}

describe('parse corpus through the lexer', () => {
  const valid = [
    ...readdirSync(join(ROOT, 'valid')).map((n) => join(ROOT, 'valid', n)),
    ...readdirSync(join(ROOT, 'valid/inc')).map((n) => join(ROOT, 'valid/inc', n)),
  ].filter((p) => p.endsWith('.bas'));

  it.each(valid.map((p) => [p.slice(ROOT.length), p]))('%s lexes with only its expected warnings', (_, path) => {
    expect(lexFile(path)).toEqual(expected(path.replace(/\.bas$/, '.expect')));
  });

  const lexCases = readdirSync(join(ROOT, 'errors')).filter((n) => n.startsWith('lex-') && n.endsWith('.bas'));
  it.each(lexCases)('errors/%s gives exactly its expected lexer diagnostic', (name) => {
    const path = join(ROOT, 'errors', name);
    expect(lexFile(path)).toEqual(expected(path.replace(/\.bas$/, '.expect')));
  });
});
