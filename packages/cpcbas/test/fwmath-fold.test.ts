/**
 * FWM-CORE: REAL `+ - * /` of constants fold through src/core/locoreal.ts, so a folded constant is the REAL the
 * firmware computes (the recorded vectors of tests/fixtures/fwmath-vectors.json, never the code's own output),
 * and the same program prints the same with a constant expression and with variables.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { foldBinary } from '../src/checker/fold.js';
import { realToNumber } from '../src/core/locoreal.js';
import { normalise, runSource } from './compile-helper.js';
import { repoRoot } from './z80sim/run.js';

const doc = JSON.parse(readFileSync(join(repoRoot, 'tests/fixtures/fwmath-vectors.json'), 'utf8')) as { ops: Record<string, { inputs: string[]; results: Record<string, string[] | string> }> };
const bytes = (h: string): number[] => (h.match(/../g) ?? []).map((x) => parseInt(x, 16));

describe('constant folding of REAL + - * /', () => {
  for (const [op, name] of [
    ['+', 'ADD'],
    ['*', 'MUL'],
    ['/', 'DIV'],
  ] as const) {
    it(`${op} gives the recorded firmware result for 300 vectors`, () => {
      const d = doc.ops[name]!;
      const res = d.results['6128'] as string[];
      let n = 0;
      d.inputs.forEach((inp, i) => {
        if (i % 6 !== 0) return;
        const [h, c] = res[i]!.split(' ');
        const [a, b] = inp.split(' ').map(bytes) as [number[], number[]];
        const folded = foldBinary(op, { type: 'REAL', value: realToNumber(a) }, { type: 'REAL', value: realToNumber(b) }, 'REAL');
        if (c !== '1') {
          expect(folded === null || folded === 'div0', `${op} ${inp}`).toBe(true); // overflow and x/0 are not folded
          return;
        }
        n++;
        expect(folded, `${op} ${inp}`).toEqual({ type: 'REAL', value: realToNumber(bytes(h!)) });
      });
      expect(n).toBeGreaterThan(250);
    });
  }

  it('rounds after every operation, as the firmware does: 0.1 + 0.2 and 2/3*3 are the run-time values', () => {
    const folded = run('PRINT 0.1 + 0.2; 2.0 / 3.0 * 3.0; 1.0 / 3.0 * 3.0; 10.0 / 4.0 - 0.1 * 3.0');
    const live = run('a! = 0.1\nb! = 0.2\nc! = 2\nd! = 3\ne! = 1\nf! = 10\ng! = 4\nPRINT a! + b!; c! / d! * d!; e! / d! * d!; f! / g! - a! * d!');
    expect(folded).toBe(live);
  });

  it('^ folds a whole base to a whole power whose value is exact, and leaves the rest to the firmware', () => {
    expect(foldBinary('^', { type: 'REAL', value: 2 }, { type: 'REAL', value: 10 }, 'REAL')).toEqual({ type: 'REAL', value: 1024 });
    expect(foldBinary('^', { type: 'REAL', value: -2 }, { type: 'REAL', value: 3 }, 'REAL')).toEqual({ type: 'REAL', value: -8 });
    expect(foldBinary('^', { type: 'REAL', value: 2 }, { type: 'REAL', value: -2 }, 'REAL')).toEqual({ type: 'REAL', value: 0.25 });
    expect(foldBinary('^', { type: 'REAL', value: 3 }, { type: 'REAL', value: -1 }, 'REAL')).toBeNull();
    // review R12: the power-of-two test must not truncate to 32 bits (3 x 2^32 is not a power of two; 2^40 is)
    expect(foldBinary('^', { type: 'REAL', value: 3 * 2 ** 32 }, { type: 'REAL', value: -1 }, 'REAL')).toBeNull();
    expect(foldBinary('^', { type: 'REAL', value: 2 ** 40 }, { type: 'REAL', value: -1 }, 'REAL')).toEqual({ type: 'REAL', value: 2 ** -40 });
    expect(foldBinary('^', { type: 'REAL', value: 2 }, { type: 'REAL', value: 0.5 }, 'REAL')).toBeNull();
    expect(foldBinary('^', { type: 'REAL', value: 3 }, { type: 'REAL', value: 25 }, 'REAL')).toBeNull(); // 3^25 needs 40 bits
  });
});

function run(src: string): string {
  const r = runSource(src);
  expect(r.built.problems).toEqual([]);
  expect(r.stopped).toBe('rst0');
  return normalise(r.printer) as string;
}
