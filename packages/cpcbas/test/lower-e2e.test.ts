/**
 * L2-LOWER, the behaviour: the conformance programs of tests/loco, compiled from source
 * through bind, check, lower, generate, link and assemble, run on the test Z80 with the
 * printer echo on; the printer transcript, normalised as tools/loco-diff.py does, equals the
 * blessed transcript of the real Locomotive interpreter.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSource, normalise, runSource } from './compile-helper.js';
import { repoRoot } from './z80sim/run.js';

const loco = join(repoRoot, 'tests/loco');
const read = (name: string): string => readFileSync(join(loco, name), 'latin1');

function transcript(source: string): string | null {
  const r = runSource(source);
  expect(r.built.problems).toEqual([]);
  expect(r.stopped).toBe('rst0');
  return normalise(r.printer);
}

describe('tests/loco programs on the simulator', () => {
  it.each(['hello', 'int-compare', 'int-flow', 'int-print'])('%s prints the blessed transcript', (name) => {
    expect(transcript(read(`${name}.bas`))).toBe(read(`${name}.expected`));
  });

  it('data prints the blessed transcript', () => {
    expect(transcript(read('data.bas'))).toBe(read('data.expected'));
  });

  it('int-compare-rev prints the 6128 transcript', () => {
    expect(transcript(read('int-compare-rev.bas'))).toBe(read('int-compare-rev.6128.expected'));
  });

  // Line 110 checks Locomotive's precedence: `*` `/` bind tighter than `\`, which binds
  // tighter than MOD.
  it('int-arith prints the blessed transcript', () => {
    expect(transcript(read('int-arith.bas'))).toBe(read('int-arith.expected'));
  });

  describe('int-memory', () => {
    const source = read('int-memory.bas');

    it('READs its machine code from DATA and prints the blessed transcript', () => {
      expect(transcript(source)).toBe(read('int-memory.expected'));
    });

    // The same program with the machine code POKEd directly instead of READ from DATA.
    const bytes = [0xdd, 0x6e, 0x02, 0xdd, 0x66, 0x03, 0xdd, 0x5e, 0x00, 0xdd, 0x56, 0x01, 0x19, 0x22, 0xf0, 0xc7, 0x32, 0xf2, 0xc7, 0xc9, 0, 0];
    const pokes = bytes.map((b, i) => `POKE &C7D0+${i},${b}`).join(':');
    const variant = source
      .split('\n')
      .filter((l) => !/^1[67]0 DATA/.test(l) && !l.startsWith('160 ') && !l.startsWith('170 '))
      .map((l) => (l.startsWith('70 ') ? `70 ${pokes}` : l))
      .join('\n');

    it('with the bytes POKEd instead of READ, prints the blessed transcript', () => {
      expect(variant).not.toContain('DATA');
      expect(transcript(variant)).toBe(read('int-memory.expected'));
    });
  });

  it('builds and links every program that needs nothing from later tasks', () => {
    for (const name of ['hello', 'int-compare', 'int-flow', 'int-print', 'int-arith']) {
      const built = buildSource(read(`${name}.bas`));
      expect(built.diagnostics, name).toEqual([]);
      expect(built.problems, name).toEqual([]);
    }
  });
});
