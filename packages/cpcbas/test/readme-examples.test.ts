/**
 * Every ```basic block of README.md compiles, for the default build, -D CPC464, -D PLUS and -D CPC_BAREMETAL.
 * A block preceded by the line `<!-- example: firmware -->` is compiled only for the three firmware builds
 * (the statement it shows is firmware-only; docs/keywords.md "Bare-metal builds" says which).
 * `npm test` runs no emulator: this checks that the examples compile, not what they print.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile, formatDiagnostic } from '../src/index.js';
import { loadLibTree, repoRoot } from './readme-helper.js';

interface Example {
  readonly title: string;
  readonly text: string;
  readonly firmwareOnly: boolean;
}

function examplesOf(markdown: string): Example[] {
  const out: Example[] = [];
  const lines = markdown.split(/\r?\n/);
  let heading = '';
  let marker = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (/^#{1,4} /.test(line)) heading = line.replace(/^#+ /, '');
    if (line.startsWith('<!-- example:')) marker = line;
    if (line.trim() === '```basic') {
      const body: string[] = [];
      for (i++; i < lines.length && lines[i]!.trim() !== '```'; i++) body.push(lines[i] as string);
      out.push({ title: `${heading} #${out.length + 1}`, text: body.join('\n') + '\n', firmwareOnly: marker.includes('firmware') });
      marker = '';
    }
  }
  return out;
}

const examples = examplesOf(readFileSync(join(repoRoot, 'README.md'), 'utf8'));
const lib = loadLibTree();

const BUILDS: readonly { name: string; defines: Record<string, string>; bare: boolean }[] = [
  { name: 'default', defines: {}, bare: false },
  { name: 'CPC464', defines: { CPC464: '' }, bare: false },
  { name: 'PLUS', defines: { PLUS: '' }, bare: false },
  { name: 'CPC_BAREMETAL', defines: { CPC_BAREMETAL: '' }, bare: true },
];

describe('README examples compile', () => {
  it('finds the examples', () => {
    expect(examples.length).toBeGreaterThan(10);
  });
  for (const ex of examples) {
    for (const b of BUILDS) {
      if (b.bare && ex.firmwareOnly) continue;
      it(`${ex.title} (${b.name})`, () => {
        const r = compile({ files: new Map([['main.bas', ex.text]]), main: 'main.bas', defines: b.defines, runtime: lib, options: { format: 'bin' } });
        expect(r.diagnostics.filter((d) => d.severity === 'error').map((d) => formatDiagnostic(d, r.sources))).toEqual([]);
      });
    }
  }
});
