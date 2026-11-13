/**
 * locoreal.ts against the golden vectors the real firmware produced (FWM-0, tests/fixtures/fwmath-*.json):
 * every `+ - * /`, compare, negate, sign and conversion vector must come out bit for bit.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  binToReal,
  decodeReal,
  int16ToReal,
  realAdd,
  realCmp,
  realDiv,
  realExpAdd,
  realFromNumber,
  realMul,
  realMul10,
  realNeg,
  realSgn,
  realSub,
  realToBin,
  realToInt16,
  realToNumber,
} from './locoreal.js';
import type { Real5, RealResult } from './locoreal.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const fixture = (name: string): never => JSON.parse(readFileSync(join(root, 'tests/fixtures', name), 'utf8')) as never;

interface OpData {
  inputs: string[];
  results: Record<string, string[] | string>;
}
const doc: { models: string[]; ops: Record<string, OpData> } = fixture('fwmath-vectors.json');

function results(op: string, model: string): string[] {
  const r = doc.ops[op]!.results[model]!;
  return typeof r === 'string' ? (doc.ops[op]!.results[r.slice(1)] as string[]) : r;
}
const bytes = (h: string): number[] => (h.match(/../g) ?? []).map((x) => parseInt(x, 16));
const hex = (b: readonly number[]): string => b.map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join('');

/** The two operands of a recorded two-operand vector (HL first, DE second). */
function operands(input: string): [number[], number[]] {
  const [a, b] = input.split(' ');
  return [bytes(a!), bytes(b!)];
}

/** Compares a model result with a recorded one: exponent byte 0 is zero, whatever the other bytes hold. */
function sameResult(got: RealResult, recorded: string): boolean {
  const [h, c] = recorded.split(' ');
  const want = bytes(h!);
  if (want[4] === 0) return got.bytes[4] === 0 && got.ok === (c === '1');
  return hex(got.bytes) === h && got.ok === (c === '1');
}

const arithmetic: [string, string, (a: Real5, b: Real5) => RealResult][] = [
  ['ADD', '6128', (a, b) => realAdd(a, b)],
  ['SUB', '464', (a, b) => realSub(a, b)],
  ['RSUB', '6128', (a, b) => realSub(b, a)],
  ['MUL', '6128', (a, b) => realMul(a, b)],
  ['DIV', '6128', (a, b) => realDiv(a, b)],
];

describe('locoreal: + - * / reproduce the recorded vectors exactly', () => {
  for (const [op, model, f] of arithmetic) {
    it(`${op}: all 2000 vectors (${model})`, () => {
      const inputs = doc.ops[op]!.inputs;
      const res = results(op, model);
      expect(inputs.length).toBe(2000);
      const bad: string[] = [];
      inputs.forEach((inp, i) => {
        const [a, b] = operands(inp);
        if (!sameResult(f(a!, b!), res[i]!)) bad.push(`${inp} -> ${res[i]} but ${hex(f(a!, b!).bytes)}`);
      });
      expect(bad).toEqual([]);
    });
  }

  it('the edge cases (overflow, divide by zero, zero operands) agree', () => {
    const edges = (fixture('fwmath-entries.json') as { edges: unknown }).edges as { op: string; a: string; b?: string; out: Record<string, { R: string; F: string }> }[];
    const fns = new Map<string, (a: Real5, b: Real5) => RealResult>([
      ['ADD', (a, b) => realAdd(a, b)],
      ['SUB', (a, b) => realSub(a, b)],
      ['RSUB', (a, b) => realSub(b, a)],
      ['MUL', (a, b) => realMul(a, b)],
      ['DIV', (a, b) => realDiv(a, b)],
    ]);
    let n = 0;
    for (const e of edges) {
      const f = fns.get(e.op);
      if (f === undefined) continue;
      const o = e.out['6128'] ?? e.out['464'];
      const got = f(bytes(e.a), bytes(e.b!));
      const want = hex(bytes(o.R).slice(0, 5));
      const carry = (parseInt(o.F, 16) & 1) === 1;
      expect(got.ok, `${e.op} ${e.a} ${e.b}`).toBe(carry);
      if (bytes(want)[4] !== 0) expect(hex(got.bytes), `${e.op} ${e.a} ${e.b}`).toBe(want);
      else expect(got.bytes[4]).toBe(0);
      n++;
    }
    expect(n).toBeGreaterThan(50);
  });

  it('all four models gave the same results (the lists are shared or equal)', () => {
    for (const [op] of arithmetic) {
      if (op === 'SUB') continue;
      const ref = results(op, '6128');
      for (const m of ['464', '664', 'plus']) expect(results(op, m)).toEqual(ref);
    }
  });
});

describe('locoreal: compare, negate, sign', () => {
  it('CMP: A and the S/Z/C flags of all 2000 vectors', () => {
    const inputs = doc.ops.CMP!.inputs;
    const res = results('CMP', '6128');
    inputs.forEach((inp, i) => {
      const [a, b] = operands(inp);
      const c = realCmp(a!, b!);
      const [wa, wf] = res[i]!.split(' ');
      expect(c === 0 ? 0 : c < 0 ? 0xff : 1, inp).toBe(parseInt(wa!, 16));
      const flags = c === 0 ? 0x40 : c < 0 ? 0x81 : 0;
      expect(flags, inp).toBe(parseInt(wf!, 16));
    });
  });
  it('NEG: byte exact, 200 vectors', () => {
    doc.ops.NEG!.inputs.forEach((inp, i) => {
      expect(hex(realNeg(bytes(inp))), inp).toBe(results('NEG', '6128')[i]!.split(' ')[0]);
    });
  });
  it('SGN: A and flags, 200 vectors', () => {
    doc.ops.SGN!.inputs.forEach((inp, i) => {
      const s = realSgn(bytes(inp));
      const [wa, wf] = results('SGN', '6128')[i]!.split(' ');
      expect(s === 0 ? 0 : s < 0 ? 0xff : 1, inp).toBe(parseInt(wa!, 16));
      expect(s === 0 ? 0x40 : s < 0 ? 0x81 : 0, inp).toBe(parseInt(wf!, 16));
    });
  });
});

describe('locoreal: conversions', () => {
  it('REAL2INT: HL, S and carry, 500 vectors', () => {
    const res = results('REAL2INT', '6128');
    doc.ops.REAL2INT!.inputs.forEach((inp, i) => {
      const r = realToInt16(bytes(inp));
      const [whl, wf] = res[i]!.split(' ');
      const f = parseInt(wf!, 16);
      expect(r.ok, inp).toBe((f & 1) === 1);
      if (r.ok) {
        expect(r.value, inp).toBe(parseInt(whl!, 16));
        expect(r.negative, inp).toBe((f & 0x80) !== 0);
      } else if (r.onFail === 'zero') expect(whl, inp).toBe('0000');
      else expect(r.onFail, inp).toBe('unchanged');
    });
  });
  for (const [op, mode] of [['REAL2BIN', 'round'], ['FIX', 'trunc'], ['INT', 'floor']] as const) {
    it(`${op}: 4-byte binary, B and carry, 200 vectors`, () => {
      const res = results(op, '6128');
      doc.ops[op]!.inputs.forEach((inp, i) => {
        const r = realToBin(bytes(inp), mode);
        const [w4, wb, wf] = res[i]!.split(' ');
        expect(r.ok, inp).toBe((parseInt(wf!, 16) & 1) === 1);
        if (r.ok) {
          const v = r.value!;
          expect(hex([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]), inp).toBe(w4);
          expect(r.neg ? 0x80 : 0, inp).toBe(parseInt(wb!, 16));
        } else expect(w4, inp).toBe(hex(bytes(inp).slice(0, 4)));
      });
    });
  }
  it('INT2REAL: 200 vectors', () => {
    doc.ops.INT2REAL!.inputs.forEach((inp, i) => {
      const [hl, a] = inp.split('|');
      expect(hex(int16ToReal(parseInt(hl!, 16), (parseInt(a!, 10) & 0x80) !== 0)), inp).toBe(results('INT2REAL', '6128')[i]);
    });
  });
  it('BIN2REAL: 200 vectors', () => {
    doc.ops.BIN2REAL!.inputs.forEach((inp, i) => {
      const [bin, a] = inp.split('|');
      const b = bytes(bin!);
      const v = (b[0]! | (b[1]! << 8) | (b[2]! << 16) | (b[3]! << 24)) >>> 0;
      const want = results('BIN2REAL', '6128')[i]!.split(' ')[0];
      expect(hex(binToReal(v, (parseInt(a!, 10) & 0x80) !== 0)), inp).toBe(want);
    });
  });
  it('EXPADD (464 only): 200 vectors', () => {
    doc.ops.EXPADD!.inputs.forEach((inp, i) => {
      const [x, n] = inp.split('|');
      expect(sameResult(realExpAdd(bytes(x!), parseInt(n!, 10)), results('EXPADD', '464')[i]!), inp).toBe(true);
    });
  });
});

describe('locoreal: REAL x 10^A is an approximation', () => {
  it('agrees with the firmware on at least 170 of 200 recorded vectors (the rest by one unit in the last place)', () => {
    let exact = 0;
    doc.ops.MUL10A!.inputs.forEach((inp, i) => {
      const [x, a] = inp.split('|');
      const got = realMul10(bytes(x!), parseInt(a!, 10));
      const rec = results('MUL10A', '6128')[i]!;
      if (sameResult(got, rec)) exact++;
      else {
        const w = bytes(rec.split(' ')[0]!);
        // never further than one unit in the last place
        const d = Math.abs(Number(decodeReal(got.bytes).mant) - Number(decodeReal(w).mant));
        expect(d, inp).toBeLessThanOrEqual(1);
      }
    });
    expect(exact).toBe(170);
  });
  it('as a literal rule (REAL(D) x 10^E) gives 272 of the 299 recorded literals', () => {
    const lit: { parts: [number, number, number][]; bytes: Record<string, string[]> } = fixture('fwmath-literals.json');
    let same = 0;
    lit.parts.forEach(([d, e, neg], i) => {
      const dReal = realFromNumber(d).bytes;
      let r = realMul10(dReal, e);
      if (neg !== 0) r = { bytes: realNeg(r.bytes), ok: r.ok };
      if (sameResult(r, lit.bytes['6128']![i]! + ' 1')) same++;
    });
    // 272 of 299 (a correctly rounded encodeReal5 gives 265); the other 27 need the firmware's MUL10A
    expect(same).toBe(272);
  });
});

describe('locoreal: JS numbers', () => {
  it('round-trips representable values and rounds halves away from zero', () => {
    for (const x of [1, -1, 0.5, 3.25, 1e10, -123456, 2 ** 31, 2 ** -20]) expect(realToNumber(realFromNumber(x).bytes)).toBe(x);
    expect(hex(realFromNumber(0).bytes)).toBe('0000000000');
    expect(realFromNumber(1e39).ok).toBe(false);
    expect(realFromNumber(1e-300).bytes[4]).toBe(0);
  });
});
