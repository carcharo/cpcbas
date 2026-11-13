/**
 * The literal corpus and the number-text corpus of FWM-0 (tests/fixtures/fwmath-literals.json and
 * fwmath-text.json), recorded on CPCEC through the real Locomotive interpreter by
 * tools/fwm-record.py. `npm test` runs no emulator: this checks the files, and pins how today's
 * `encodeReal5` differs from Locomotive's tokeniser on the literals (FWM-CORE routes encodeReal5 through the REAL model).
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { encodeReal5 } from '../src/codegen/data.js';
import { realFromNumber } from '../src/core/locoreal.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const load = <T>(f: string): T => JSON.parse(readFileSync(join(root, 'tests/fixtures', f), 'utf8')) as T;

interface Literals {
  models: string[];
  sources: string[];
  rejected: string[];
  mul10a_matches: number;
  parts: [number, number, number][];
  bytes: Record<string, string[] | string>;
}
interface Text {
  models: string[];
  patterns: string[];
  text: Record<string, string[] | string>;
}

const lit = load<Literals>('fwmath-literals.json');
const txt = load<Text>('fwmath-text.json');

const list = <T>(r: Record<string, T[] | string>, m: string): T[] => {
  const v = r[m];
  return typeof v === 'string' ? (r[v.slice(1)] as T[]) : (v as T[]);
};

/** Locomotive's bytes (mantissa first, exponent last) as hex; encodeReal5 returns them in that order
 * since FWM-LAYOUT. */
const ours = (src: string): string =>
  encodeReal5(Number(src))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();

const hexOf = (b: readonly number[]): string => b.map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();

describe('literal corpus', () => {
  it('has 299 literals, five bytes each, for all four models, and records the one the tokeniser rejects', () => {
    expect(lit.sources.length).toBe(299);
    expect(lit.rejected).toEqual(['3.4028235E38']);
    for (const m of lit.models) {
      const b = list(lit.bytes, m);
      expect(b.length).toBe(299);
      for (const x of b) expect(x).toMatch(/^[0-9A-F]{10}$/);
    }
  });

  it('is the same on every model', () => {
    for (const m of ['464', '664', 'plus']) expect(list(lit.bytes, m)).toEqual(list(lit.bytes, '6128'));
  });

  it('every literal is REAL(digits as an integer) x 10^E through the firmware REAL*10^A entry (recorded on CPCEC)', () => {
    expect(lit.mul10a_matches).toBe(299);
    for (const [i, src] of lit.sources.entries()) {
      const [d, e, neg] = lit.parts[i]!;
      expect(Number(`${neg ? '-' : ''}${d}e${e}`), src).toBe(Number(src));
    }
  });

  it('the correctly rounded conversion (encodeReal5 before FWM-CORE) differs on 34 of the 299 literals, by at most 2 units in the last place', () => {
    const b = list(lit.bytes, '6128');
    let exact = 0;
    let worst = 0n;
    for (const [i, src] of lit.sources.entries()) {
      const want = b[i]!;
      const got = hexOf(realFromNumber(Number(src)).bytes);
      if (got === want) {
        exact++;
        continue;
      }
      // compare as 40-bit integers (exponent byte most significant)
      const toInt = (h: string): bigint => BigInt('0x' + h.slice(8, 10) + h.slice(6, 8) + h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2));
      let d = toInt(got) - toInt(want);
      if (d < 0n) d = -d;
      if (d > worst) worst = d;
    }
    expect(exact).toBe(265);
    expect(worst).toBe(2n);
  });

  it('encodeReal5 (FWM-CORE: REAL of the shortest digits x 10^E through the model of the firmware entry) matches 270 of the 299, at most 2 units away', () => {
    const b = list(lit.bytes, '6128');
    let exact = 0;
    let worst = 0n;
    for (const [i, src] of lit.sources.entries()) {
      const want = b[i]!;
      const got = ours(src);
      if (got === want) {
        exact++;
        continue;
      }
      const toInt = (h: string): bigint => BigInt('0x' + h.slice(8, 10) + h.slice(6, 8) + h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2));
      let d = toInt(got) - toInt(want);
      if (d < 0n) d = -d;
      if (d > worst) worst = d;
    }
    // the 272 of locoreal.test.ts is the same rule on the source text's digits (trailing zeros kept); 265 before FWM-CORE
    expect(exact).toBe(270);
    expect(worst).toBeLessThanOrEqual(2n);
  });
});

describe('number-text corpus', () => {
  it('has 2000 patterns with a text each, for all four models', () => {
    expect(txt.patterns.length).toBe(2000);
    for (const m of txt.models) {
      const t = list(txt.text, m);
      expect(t.length).toBe(2000);
      for (const x of t) expect(x).toMatch(/^[ -][0-9.]+(E[+-][0-9]{2})? $/);
    }
  });

  it('is the same on every model', () => {
    for (const m of ['464', '664', 'plus']) expect(list(txt.text, m)).toEqual(list(txt.text, '6128'));
  });
});
