/**
 * The golden vectors of the CPC firmware maths (FWM-0), recorded on CPCEC through the real
 * Locomotive ROMs by tools/fwm-record.py: `tests/fixtures/fwmath-vectors.json`. `npm test` never runs
 * an emulator; this test checks that the file loads, is well formed, that the models' lists line up,
 * and that every arithmetic vector is within one unit in the last place of the exactly rounded result
 * (so a column mix-up or a wrong layout in the recording would show). FWM-SIM adds the test that the
 * TypeScript model reproduces every arithmetic vector bit for bit.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

interface OpData {
  fields: string[];
  inputs: string[];
  results: Record<string, string[] | string>;
}
interface Vectors {
  format: number;
  models: string[];
  ops: Record<string, OpData>;
  registers: Record<string, Record<string, unknown>>;
  rnd_from_boot: Record<string, string[] | string>;
  rnd_seeded: Record<string, unknown[] | string>;
}

const doc = JSON.parse(readFileSync(join(root, 'tests/fixtures/fwmath-vectors.json'), 'utf8')) as Vectors;

/** Results of one model, resolving the "=6128" shorthand. */
function results(op: string, model: string): string[] {
  const r = doc.ops[op]!.results[model];
  if (r === undefined) throw new Error(`${op}: no results for ${model}`);
  return typeof r === 'string' ? (doc.ops[op]!.results[r.slice(1)] as string[]) : r;
}

const hex = (s: string, n: number): boolean => new RegExp(`^[0-9A-F]{${n}}$`).test(s);

/** A Locomotive REAL (5 bytes as hex): the value is sign * mant * 2^(exp - 160); exp 0 is zero. */
function decode(h: string): { neg: boolean; mant: bigint; exp: number } {
  const b = [0, 1, 2, 3, 4].map((i) => parseInt(h.slice(2 * i, 2 * i + 2), 16));
  const exp = b[4]!;
  const mant = (BigInt((b[3]! & 0x7f) | 0x80) << 24n) | (BigInt(b[2]!) << 16n) | (BigInt(b[1]!) << 8n) | BigInt(b[0]!);
  return { neg: (b[3]! & 0x80) !== 0, mant: exp === 0 ? 0n : mant, exp };
}

/** An exact value num * 2^p. */
interface Exact {
  num: bigint;
  p: number;
}

const signed = (r: { neg: boolean; mant: bigint }): bigint => (r.neg ? -r.mant : r.mant);
const abs = (x: bigint): bigint => (x < 0n ? -x : x);

/** |x - y| <= tol, all three exact (tol is non-negative). */
function within(x: Exact, y: Exact, tol: Exact): boolean {
  const q = Math.min(x.p, y.p, tol.p);
  const at = (e: Exact): bigint => e.num << BigInt(e.p - q);
  return abs(at(x) - at(y)) <= at(tol);
}

describe('fwmath-vectors.json', () => {
  it('is format 1 with all four models', () => {
    expect(doc.format).toBe(1);
    expect(doc.models).toEqual(['464', '664', '6128', 'plus']);
  });

  const counts: Record<string, number> = {
    ADD: 2000, RSUB: 2000, MUL: 2000, DIV: 2000, CMP: 2000, SUB: 2000, POW: 500,
    SQR: 200, EXP: 200, LOG: 200, LOG10: 200, SIN: 200, COS: 200, TAN: 200, ATN: 200,
  };

  for (const [op, n] of Object.entries(counts)) {
    it(`${op}: ${n} vectors per model, well formed`, () => {
      const d = doc.ops[op]!;
      expect(d.inputs.length).toBe(n);
      const models = op === 'SUB' ? ['464'] : doc.models;
      for (const m of models) {
        const r = results(op, m);
        expect(r.length).toBe(n);
        expect(r).not.toContain('HANG');
        for (const [i, line] of r.entries()) {
          const f = line.split(' ');
          expect(f.length, `${op} ${m} #${i}`).toBe(d.fields.length);
          if (d.fields[0] === 'r') expect(hex(f[0]!, 10) && (f[1] === '0' || f[1] === '1')).toBe(true);
        }
      }
      for (const inp of d.inputs) {
        const ops = inp.split(' ');
        expect(ops.length).toBe(op === 'SQR' || op === 'EXP' || op === 'LOG' || op === 'LOG10' || op === 'SIN' || op === 'COS' || op === 'TAN' || op === 'ATN' ? 1 : 2);
        for (const o of ops) expect(hex(o, 10)).toBe(true);
      }
    });
  }

  it('the 664, 6128 and Plus agree on every vector (the 464 where it has the entry)', () => {
    // the shorthand "=6128" is only written where the lists are identical; the rest is listed in full
    const differing: string[] = [];
    for (const [op, d] of Object.entries(doc.ops)) {
      for (const m of doc.models) {
        const r = d.results[m];
        if (r !== undefined && typeof r !== 'string') differing.push(`${op}:${m}`);
      }
    }
    // 6128 is always a full list; any other full list is a difference worth knowing about
    const others = differing.filter((x) => !x.endsWith(':6128'));
    expect(others.filter((x) => x.endsWith(':664') || x.endsWith(':plus'))).toEqual([]);
  });

  describe('arithmetic results are within one ulp of the exactly rounded result', () => {
    type D = ReturnType<typeof decode>;
    const exactOf: Record<string, (a: D, b: D) => Exact> = {
      ADD: (a, b) => {
        const p = Math.min(a.exp, b.exp) - 160;
        return { num: (signed(a) << BigInt(a.exp - 160 - p)) + (signed(b) << BigInt(b.exp - 160 - p)), p };
      },
      SUB: (a, b) => {
        const p = Math.min(a.exp, b.exp) - 160;
        return { num: (signed(a) << BigInt(a.exp - 160 - p)) - (signed(b) << BigInt(b.exp - 160 - p)), p };
      },
      RSUB: (a, b) => {
        const p = Math.min(a.exp, b.exp) - 160;
        return { num: (signed(b) << BigInt(b.exp - 160 - p)) - (signed(a) << BigInt(a.exp - 160 - p)), p };
      },
      MUL: (a, b) => ({ num: signed(a) * signed(b), p: a.exp + b.exp - 320 }),
    };
    for (const op of [...Object.keys(exactOf), 'DIV']) {
      it(op, () => {
        const d = doc.ops[op]!;
        const r = results(op, op === 'SUB' ? '464' : '6128');
        let checked = 0;
        for (const [i, inp] of d.inputs.entries()) {
          const [ha, hb] = inp.split(' ') as [string, string];
          const [hr, carry] = r[i]!.split(' ') as [string, string];
          const out = decode(hr);
          if (out.exp === 0 || carry === '0') continue; // zero/underflow forms and saturated overflow: not checked here
          const a = decode(ha);
          const b = decode(hb);
          const f: Exact = { num: signed(out), p: out.exp - 160 };
          const ulp: Exact = { num: 1n, p: out.exp - 160 };
          let ok: boolean;
          if (op === 'DIV') {
            // |f*b - a| <= ulp * |b|
            const fb: Exact = { num: f.num * signed(b), p: f.p + b.exp - 160 };
            const av: Exact = { num: signed(a), p: a.exp - 160 };
            ok = within(fb, av, { num: b.mant, p: ulp.p + b.exp - 160 });
          } else {
            ok = within(f, exactOf[op]!(a, b), ulp);
          }
          expect(ok, `${op} #${i} ${inp} -> ${r[i]}`).toBe(true);
          checked++;
        }
        expect(checked).toBeGreaterThan(1500);
      });
    }
  });

  it('RND from boot: 1000 values, then the model lists line up', () => {
    const r = doc.rnd_from_boot['6128'] as string[];
    expect(r.length).toBeGreaterThanOrEqual(1000);
    expect(r[0]).toBe('50CE3B0B7F');
    for (const m of doc.models) {
      const x = doc.rnd_from_boot[m];
      expect(x === '=6128' || (Array.isArray(x) && x.length >= 1000)).toBe(true);
    }
  });

  it('RANDOMIZE n sets the seed bytes to 07 6C 65 89 xor the first four bytes of n; RND returns the seed as a fraction', () => {
    const rows = doc.rnd_seeded['6128'] as { arg: string; arg_bytes: string; seed: string; values: string[] }[];
    expect(rows.length).toBe(24);
    for (const r of rows) {
      const base = [0x07, 0x6c, 0x65, 0x89];
      const want = base.map((b, i) => b ^ parseInt(r.arg_bytes.slice(2 * i, 2 * i + 2), 16));
      expect(r.seed, r.arg).toBe(want.map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase());
      expect(r.values.length).toBe(50);
      for (const v of r.values) {
        expect(v).toMatch(/^[0-9A-F]{10}$/);
        // a positive fraction below 1: exponent byte at most 0x80, sign bit clear
        expect(parseInt(v.slice(8, 10), 16)).toBeLessThanOrEqual(0x80);
        expect(parseInt(v.slice(6, 8), 16) & 0x80).toBe(0);
      }
    }
  });

  it('register summaries exist for every recorded operation and model', () => {
    for (const op of Object.keys(doc.ops)) {
      expect(doc.registers[op], op).toBeDefined();
      // SUB and EXPADD exist on the 464 only
      expect(doc.registers[op]![op === 'SUB' || op === 'EXPADD' ? '464' : '6128'], op).toBeDefined();
    }
  });
});
