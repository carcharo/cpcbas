/**
 * The fake firmware's maths block (FWM-SIM): every recorded vector through the fake's entries (CALL
 * from Z80 code), the three address tables, the register contract, the error protocol, the lower-ROM
 * check, KL PROBE ROM, the RND replay and the approximation rule.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Cpc, FirmwareContractError, UnhandledFirmwareError } from './cpc.js';
import type { CpcModel } from './cpc.js';
import { FwMathError, mathsEntry, prepExact, PROBE_H, RND_SEED_ADDRESS } from './fwmaths.js';
import { realToNumber } from '../../src/core/locoreal.js';
import { runCpc } from './run.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const vec = JSON.parse(readFileSync(join(root, 'tests/fixtures/fwmath-vectors.json'), 'utf8')) as {
  ops: Record<string, { inputs: string[]; results: Record<string, string[] | string> }>;
  rnd_from_boot: Record<string, string[]>;
  rnd_seeded: Record<string, { arg: string; seed: string; values: string[] }[]>;
};
const bytes = (h: string): number[] => (h.match(/../g) ?? []).map((x) => parseInt(x, 16));
const hex = (b: readonly number[]): string => b.map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join('');
const results = (op: string): string[] => vec.ops[op]!.results['6128'] as string[];

/**
 * Locomotive's PRINT text of a REAL from PREP's output: n (9 digits, 100000000..999999999), e (decimal exponent
 * of the last digit), neg (sign byte B = &FF), zero (exponent byte 0).
 */
function prepText(zero: boolean, neg: boolean, n: number, e: number): string {
  if (zero) return ' 0 ';
  const s = String(n).replace(/0+$/, '');
  const k = s.length;
  let x = e + 8; // decimal exponent of the leading digit
  let body: string;
  if ((x >= 0 && x <= 8) || (x < 0 && -x - 1 + k <= 9)) {
    body = x >= 0 ? s.slice(0, x + 1).padEnd(x + 1, '0') + (k > x + 1 ? '.' + s.slice(x + 1) : '') : '0.' + '0'.repeat(-x - 1) + s;
  } else {
    let m = s;
    if (k > 6) {
      let r = Math.floor((n + 500) / 1000);
      if (r >= 1000000) {
        r = 100000;
        x++;
      }
      m = String(r);
    }
    body = m[0] + (m.length > 1 ? '.' + m.slice(1) : '') + 'E' + (x >= 0 ? '+' : '-') + String(Math.abs(x)).padStart(2, '0');
  }
  return (neg ? '-' : ' ') + body + ' ';
}

const A = 0x8100; // first operand
const B = 0x8108; // second operand

interface Regs {
  a?: number;
  bc?: number;
  de?: number;
  hl?: number;
  ix?: number;
  iy?: number;
}
interface After {
  cpc: Cpc;
  a: number;
  f: number;
  bc: number;
  de: number;
  hl: number;
  ix: number;
  iy: number;
  mem: Uint8Array;
  iff1: boolean;
}

/** CALL addr from Z80 code at &9000 with the given registers; runs to the RST 0 behind it. */
function call(cpc: Cpc, addr: number, regs: Regs, mem: Record<number, number[]> = {}): After {
  const cpu = cpc.cpu;
  for (const [at, b] of Object.entries(mem)) b.forEach((v, k) => (cpu.mem[Number(at) + k] = v));
  cpu.load(Uint8Array.from([0xcd, addr & 255, addr >> 8, 0xc7]), 0x9000);
  cpu.pc = 0x9000;
  cpu.sp = 0xa400;
  cpu.a = regs.a ?? 0;
  cpu.f = 0;
  cpu.bc = regs.bc ?? 0x1234;
  cpu.de = regs.de ?? B;
  cpu.hl = regs.hl ?? A;
  cpu.ix = regs.ix ?? 0x5678;
  cpu.iy = regs.iy ?? 0x9abc;
  cpu.iff1 = false;
  cpu.iff2 = false;
  const r = runCpc(cpc, { maxTStates: 200_000 });
  expect(r.stopped).toBe('rst0');
  return { cpc, a: cpu.a, f: cpu.f, bc: cpu.bc, de: cpu.de, hl: cpu.hl, ix: cpu.ix, iy: cpu.iy, mem: cpu.mem, iff1: cpu.iff1 };
}
const at = (r: After, ptr: number): string => hex(Array.from(r.mem.slice(ptr, ptr + 5)));

const newCpc = (model: CpcModel = '6128', extra: { fwmStrict?: boolean } = {}): Cpc => new Cpc({ irqInterval: 0, model, ...extra });

/** Same comparison as the model test: exponent byte 0 is zero. */
function sameReal(got: string, want: string): boolean {
  return bytes(want)[4] === 0 ? bytes(got)[4] === 0 : got === want;
}

describe('fake firmware maths: every recorded vector through the entries (6128)', () => {
  const twoOperand = ['ADD', 'RSUB', 'MUL', 'DIV', 'POW'];
  for (const op of twoOperand) {
    it(`${op}: all vectors, result and carry`, () => {
      const cpc = newCpc();
      const inputs = vec.ops[op]!.inputs;
      const res = results(op);
      const bad: string[] = [];
      inputs.forEach((inp, i) => {
        const [a, b] = inp.split(' ');
        const r = call(cpc, mathsEntry('6128', op)!, {}, { [A]: bytes(a!), [B]: bytes(b!) });
        const [wh, wc] = res[i]!.split(' ');
        if (!sameReal(at(r, A), wh!) || (r.f & 1) !== Number(wc) || at(r, B) !== b) bad.push(`${inp} -> ${res[i]}, got ${at(r, A)} f=${r.f}`);
      });
      expect(bad).toEqual([]);
      expect(cpc.approximations).toEqual([]);
    });
  }
  it('SUB: the 464 table, all vectors', () => {
    const cpc = newCpc('464');
    const res = vec.ops.SUB!.results['464'] as string[];
    vec.ops.SUB!.inputs.forEach((inp, i) => {
      const [a, b] = inp.split(' ');
      const r = call(cpc, mathsEntry('464', 'SUB')!, {}, { [A]: bytes(a!), [B]: bytes(b!) });
      const [wh, wc] = res[i]!.split(' ');
      expect(sameReal(at(r, A), wh!), inp).toBe(true);
      expect(r.f & 1, inp).toBe(Number(wc));
    });
  });
  for (const op of ['SQR', 'EXP', 'LOG', 'LOG10', 'SIN', 'COS', 'TAN', 'ATN']) {
    it(`${op}: the recorded results are replayed exactly (strict, no approximation)`, () => {
      const cpc = newCpc('6128', { fwmStrict: true });
      const res = results(op);
      vec.ops[op]!.inputs.forEach((inp, i) => {
        const r = call(cpc, mathsEntry('6128', op)!, {}, { [A]: bytes(inp) });
        const [wh, wc] = res[i]!.split(' ');
        expect(sameReal(at(r, A), wh!), inp).toBe(true);
        expect(r.f & 1, inp).toBe(Number(wc));
      });
    });
  }
  it('MUL10A: the recorded results are replayed exactly', () => {
    const cpc = newCpc('6128', { fwmStrict: true });
    const res = results('MUL10A');
    vec.ops.MUL10A!.inputs.forEach((inp, i) => {
      const [x, n] = inp.split('|');
      const r = call(cpc, mathsEntry('6128', 'MUL10A')!, { a: Number(n) & 255 }, { [A]: bytes(x!) });
      const [wh, wc] = res[i]!.split(' ');
      expect(sameReal(at(r, A), wh!), inp).toBe(true);
      expect(r.f & 1, inp).toBe(Number(wc));
    });
  });
  it('CMP, NEG, SGN: result registers and flags', () => {
    const cpc = newCpc();
    vec.ops.CMP!.inputs.slice(0, 400).forEach((inp, i) => {
      const [a, b] = inp.split(' ');
      const r = call(cpc, mathsEntry('6128', 'CMP')!, {}, { [A]: bytes(a!), [B]: bytes(b!) });
      const [wa, wf] = results('CMP')[i]!.split(' ');
      expect(r.a, inp).toBe(parseInt(wa!, 16));
      expect(r.f & 0xc1, inp).toBe(parseInt(wf!, 16));
    });
    vec.ops.NEG!.inputs.forEach((inp, i) => {
      const r = call(cpc, mathsEntry('6128', 'NEG')!, {}, { [A]: bytes(inp) });
      expect(at(r, A), inp).toBe(results('NEG')[i]!.split(' ')[0]);
    });
    vec.ops.SGN!.inputs.forEach((inp, i) => {
      const r = call(cpc, mathsEntry('6128', 'SGN')!, {}, { [A]: bytes(inp) });
      const [wa, wf] = results('SGN')[i]!.split(' ');
      expect(r.a, inp).toBe(parseInt(wa!, 16));
      expect(r.f & 0xc1, inp).toBe(parseInt(wf!, 16));
    });
  });
  it('REAL2INT, REAL2BIN, FIX, INT, INT2REAL, BIN2REAL', () => {
    const cpc = newCpc();
    vec.ops.REAL2INT!.inputs.forEach((inp, i) => {
      const r = call(cpc, mathsEntry('6128', 'REAL2INT')!, {}, { [A]: bytes(inp) });
      const [wh, wf] = results('REAL2INT')[i]!.split(' ');
      const f = parseInt(wf!, 16);
      expect(r.f & 1, inp).toBe(f & 1);
      if (f & 1) {
        expect(hex([r.hl >> 8, r.hl & 255]), inp).toBe(wh);
        expect(r.f & 0x80, inp).toBe(f & 0x80);
      } else expect(hex([r.hl >> 8, r.hl & 255]), inp).toBe(wh);
    });
    for (const op of ['REAL2BIN', 'FIX', 'INT']) {
      vec.ops[op]!.inputs.forEach((inp, i) => {
        const r = call(cpc, mathsEntry('6128', op)!, {}, { [A]: bytes(inp) });
        const [w4, wb, wf] = results(op)[i]!.split(' ');
        expect(hex(Array.from(r.mem.slice(A, A + 4))), `${op} ${inp}`).toBe(w4);
        expect(r.bc >> 8, `${op} ${inp}`).toBe(parseInt(wb!, 16) === 0x12 ? 0x12 : parseInt(wb!, 16));
        expect(r.f & 1, `${op} ${inp}`).toBe(parseInt(wf!, 16) & 1);
      });
    }
    vec.ops.INT2REAL!.inputs.forEach((inp, i) => {
      const [hl, a] = inp.split('|');
      const r = call(cpc, mathsEntry('6128', 'INT2REAL')!, { hl: parseInt(hl!, 16), de: B, a: Number(a) });
      expect(at(r, B), inp).toBe(results('INT2REAL')[i]);
    });
    vec.ops.BIN2REAL!.inputs.forEach((inp, i) => {
      const [b, a] = inp.split('|');
      const r = call(cpc, mathsEntry('6128', 'BIN2REAL')!, { a: Number(a) }, { [A]: bytes(b!) });
      expect(at(r, A), inp).toBe(results('BIN2REAL')[i]!.split(' ')[0]);
    });
  });
});

describe('fake firmware maths: the other models', () => {
  for (const model of ['464', '664', 'plus'] as const) {
    it(`${model}: a sample of every shared entry gives the 6128 results`, () => {
      const cpc = newCpc(model, { fwmStrict: true });
      for (const op of ['ADD', 'RSUB', 'MUL', 'DIV', 'POW']) {
        vec.ops[op]!.inputs.filter((_, i) => i % 40 === 0).forEach((inp) => {
          const i = vec.ops[op]!.inputs.indexOf(inp);
          const [a, b] = inp.split(' ');
          const r = call(cpc, mathsEntry(model, op)!, {}, { [A]: bytes(a!), [B]: bytes(b!) });
          expect(sameReal(at(r, A), results(op)[i]!.split(' ')[0]!), `${op} ${inp}`).toBe(true);
        });
      }
      for (const op of ['SQR', 'LOG', 'SIN']) {
        const inp = vec.ops[op]!.inputs[7]!;
        const r = call(cpc, mathsEntry(model, op)!, {}, { [A]: bytes(inp) });
        expect(at(r, A)).toBe(results(op)[7]!.split(' ')[0]);
      }
    });
  }
  it('the three tables differ as measured: ADD is at BD58 / BD79 / BD7C, SUB exists on the 464 only', () => {
    expect(['464', '664', '6128', 'plus'].map((m) => mathsEntry(m as CpcModel, 'ADD'))).toEqual([0xbd58, 0xbd79, 0xbd7c, 0xbd7c]);
    expect(mathsEntry('664', 'SUB')).toBeUndefined();
    expect(mathsEntry('6128', 'SUB')).toBeUndefined();
    expect(mathsEntry('464', 'SUB')).toBe(0xbd5b);
    expect(mathsEntry('464', 'EXPADD')).toBe(0xbd67);
    expect(mathsEntry('6128', 'EXPADD')).toBeUndefined();
  });
  it('the wrong model\'s address fails the run (the 6128 has no SUB at the 464 address &BD5B)', () => {
    const cpc = newCpc('6128');
    expect(() => call(cpc, 0xbd5b, {})).toThrow(UnhandledFirmwareError);
    expect(() => call(newCpc('6128'), 0xbd58, {})).toThrow(UnhandledFirmwareError); // 464 ADD
  });
  it('an address from another model\'s table runs a different entry (6128 BD58 is not ADD)', () => {
    // &BD7C is ADD on the 6128 but RND on the 664 and POW on the 464 (the point of the probe)
    const c664 = newCpc('664');
    c664.cpu.mem.set([0x07, 0x6c, 0x65, 0x89], RND_SEED_ADDRESS['664']);
    const r = call(c664, 0xbd7c, {});
    expect(at(r, A)).toBe('50CE3B0B7F');
  });
  it('the 464 EXPADD: exponent plus a signed A', () => {
    const cpc = newCpc('464');
    const resv = vec.ops.EXPADD!.results['464'] as string[];
    vec.ops.EXPADD!.inputs.forEach((inp, i) => {
      const [x, n] = inp.split('|');
      const r = call(cpc, mathsEntry('464', 'EXPADD')!, { a: Number(n) & 255 }, { [A]: bytes(x!) });
      const [wh, wc] = resv[i]!.split(' ');
      expect(sameReal(at(r, A), wh!), inp).toBe(true);
      expect(r.f & 1, inp).toBe(Number(wc));
    });
  });
});

describe('fake firmware maths: KL PROBE ROM', () => {
  for (const model of ['464', '664', '6128', 'plus'] as const) {
    it(`${model}: H = ${PROBE_H[model]}, L = 1`, () => {
      const r = call(newCpc(model), 0xb915, { bc: 0x0000 });
      expect(r.hl).toBe((PROBE_H[model] << 8) | 1);
    });
  }
  it('only C = 0 is measured', () => {
    expect(() => call(newCpc(), 0xb915, { bc: 0x0003 })).toThrow(FirmwareContractError);
  });
});

describe('fake firmware maths: register contract and protocol', () => {
  it('ADD destroys BC, DE, IX (= HL) and IY, keeps HL, sets carry, enables interrupts', () => {
    const r = call(newCpc(), mathsEntry('6128', 'ADD')!, {}, { [A]: bytes('0000004081'), [B]: bytes('0000001082') });
    expect(r.hl).toBe(A);
    expect(r.ix).toBe(A);
    expect(r.iy).not.toBe(0x9abc);
    expect(r.bc).not.toBe(0x1234);
    expect(r.de).not.toBe(B);
    expect(r.f & 1).toBe(1);
    expect(r.iff1).toBe(true);
    expect(at(r, A)).toBe('0000007082'); // 1.5 + 2.25 = 3.75
  });
  it('CMP keeps BC, DE and HL and destroys IX and IY; NEG and SGN keep IY', () => {
    const r = call(newCpc(), mathsEntry('6128', 'CMP')!, {}, { [A]: bytes('0000004081'), [B]: bytes('0000001082') });
    expect([r.bc, r.de, r.hl]).toEqual([0x1234, B, A]);
    expect(r.ix).not.toBe(0x5678);
    expect(r.iy).not.toBe(0x9abc);
    const n = call(newCpc(), mathsEntry('6128', 'NEG')!, {}, { [A]: bytes('0000004081') });
    expect(n.iy).toBe(0x9abc);
    expect(n.ix).not.toBe(0x5678);
  });
  it('MOVE, ANGLE and INT2REAL keep IX and IY; PI corrupts DE only', () => {
    for (const [op, regs] of [['MOVE', {}], ['ANGLE', { a: 1 }], ['INT2REAL', { hl: 5 }], ['PI', {}]] as const) {
      const r = call(newCpc(), mathsEntry('6128', op)!, regs);
      expect(r.ix, op).toBe(0x5678);
      expect(r.iy, op).toBe(0x9abc);
    }
    const p = call(newCpc(), mathsEntry('6128', 'PI')!, { a: 9 });
    expect([p.bc, p.hl, p.a]).toEqual([0x1234, A, 9]);
    expect(p.de).not.toBe(B);
    expect(at(p, A)).toBe('A2DA0F4982');
  });
  it('overflow: +-max and carry clear (the 464 also loses HL); underflow: exponent 0, carry set; x/0', () => {
    const big = { [A]: bytes('FFFFFF7FFF'), [B]: bytes('FFFFFF7FFF') };
    const r6 = call(newCpc('6128'), mathsEntry('6128', 'ADD')!, {}, big);
    expect(at(r6, A)).toBe('FFFFFF7FFF');
    expect(r6.f & 1).toBe(0);
    expect(r6.hl).toBe(A);
    const r4 = call(newCpc('464'), mathsEntry('464', 'ADD')!, {}, big);
    expect(r4.f & 1).toBe(0);
    expect(r4.hl).toBe(0xffff);
    const neg = call(newCpc(), mathsEntry('6128', 'MUL')!, {}, { [A]: bytes('FFFFFFFFFF'), [B]: bytes('0000004081') });
    expect(at(neg, A)).toBe('FFFFFFFFFF'); // -max * 1.5 overflows negative
    expect(neg.f & 1).toBe(0);
    const mul = call(newCpc(), mathsEntry('6128', 'MUL')!, {}, { [A]: bytes('FFFFFF7FFF'), [B]: bytes('0000004082') });
    expect(at(mul, A)).toBe('FFFFFF7FFF');
    expect(mul.f & 1).toBe(0);
    const under = call(newCpc(), mathsEntry('6128', 'MUL')!, {}, { [A]: bytes('0000000001'), [B]: bytes('0000000001') });
    expect(bytes(at(under, A))[4]).toBe(0);
    expect(under.f & 1).toBe(1);
    const dz = call(newCpc(), mathsEntry('6128', 'DIV')!, {}, { [A]: bytes('0000004081'), [B]: bytes('0000000000') });
    expect(at(dz, A)).toBe('FFFFFF7FFF');
    expect(dz.f & 1).toBe(0);
  });
  it('REAL2INT: HL = the magnitude, S = negative, carry = fits, HL kept when it does not fit', () => {
    const r = call(newCpc(), mathsEntry('6128', 'REAL2INT')!, {}, { [A]: bytes('0000008081') });
    expect(r.hl).toBe(1);
    expect(r.f & 0x80).toBe(0x80);
    const big = call(newCpc(), mathsEntry('6128', 'REAL2INT')!, {}, { [A]: bytes('0000000091') });
    expect(big.hl).toBe(A);
    expect(big.f & 1).toBe(0);
  });
  it('ANGLE stores the byte; SIN in DEG mode is approximated (and listed)', () => {
    const cpc = newCpc();
    call(cpc, mathsEntry('6128', 'ANGLE')!, { a: 0xff });
    expect(cpc.cpu.mem[0xb113]).toBe(0xff);
    const r = call(cpc, mathsEntry('6128', 'SIN')!, {}, { [A]: bytes('0000007085') }); // 30 as a REAL
    expect(cpc.approximations.length).toBe(1);
    const v = bytes(at(r, A));
    // 30 degrees: 0.5 = 00 00 00 00 80
    expect(v[4]).toBe(0x80);
    expect(v[3]).toBe(0);
  });
});

describe('fake firmware maths: data pointers and approximation', () => {
  it('a pointer below &4000 fails the run with the lower-ROM message', () => {
    for (const hl of [0x0000, 0x2000, 0x3ffb]) {
      expect(() => call(newCpc(), mathsEntry('6128', 'ADD')!, { hl }), `HL=${hl}`).toThrow(/lower ROM enabled \(SOFT968 section 2\.4 b\)/);
    }
    expect(() => call(newCpc(), mathsEntry('6128', 'MUL')!, { de: 0x1000 })).toThrow(FwMathError);
    expect(() => call(newCpc(), mathsEntry('6128', 'INT2REAL')!, { de: 0x0100 })).toThrow(FwMathError);
    // 4000 is the first good address
    expect(() => call(newCpc(), mathsEntry('6128', 'NEG')!, { hl: 0x4000 })).not.toThrow();
  });
  it('an unrecorded function input is approximated with Math and listed; fwmStrict fails instead', () => {
    const x = '7B14AE4781'; // not one of the recorded inputs
    expect(vec.ops.SQR!.inputs).not.toContain(x);
    const cpc = newCpc();
    const r = call(cpc, mathsEntry('6128', 'SQR')!, {}, { [A]: bytes(x) });
    expect(cpc.approximations).toEqual([`SQR(${x})`]);
    expect(r.f & 1).toBe(1);
    const got = realToNumber(bytes(at(r, A)));
    const want = Math.sqrt(realToNumber(bytes(x)));
    expect(Math.abs(got - want) / want).toBeLessThan(1e-9);
    expect(() => call(newCpc('6128', { fwmStrict: true }), mathsEntry('6128', 'SQR')!, {}, { [A]: bytes(x) })).toThrow(FwMathError);
  });
  it('domain errors follow the measured protocol (SQR of a negative, LOG of 0 and of a negative)', () => {
    const sq = call(newCpc(), mathsEntry('6128', 'SQR')!, {}, { [A]: bytes('0000008084') }); // -8? sign set
    expect(sq.f & 1).toBe(0);
    const lg = call(newCpc(), mathsEntry('6128', 'LOG')!, {}, { [A]: bytes('0000000000') });
    expect(lg.f & 1).toBe(0);
    expect(lg.a).toBe(0xff);
    const ln = call(newCpc(), mathsEntry('6128', 'LOG')!, {}, { [A]: bytes('0000008081') });
    expect(ln.a).toBe(0xfe);
    expect(at(ln, A)).toBe('0000008081');
  });
  // PREP (FWM-PREP): fwmath-prep.json holds the recorded entry (bytes written, BC DE HL F A IX IY) per input
  const prepDoc = JSON.parse(readFileSync(join(root, 'tests/fixtures/fwmath-prep.json'), 'utf8')) as {
    inputs: string[];
    results: Record<string, string[]>;
  };
  const textDoc = JSON.parse(readFileSync(join(root, 'tests/fixtures/fwmath-text.json'), 'utf8')) as { patterns: string[]; text: Record<string, string[]> };
  /** The recorded PREP entry for the k-th input of a model ("=" = the 6128's). */
  const prepWant = (model: string, k: number): string => {
    const v = prepDoc.results[model]![model === '464' || model === '6128' ? k : k / 10]!;
    return v === '=' ? prepDoc.results['6128']![k]! : v;
  };
  for (const model of ['6128', '464', '664', 'plus'] as const) {
    it(`PREP on the ${model}: every recorded input, bytes written and all registers (strict)`, () => {
      const cpc = newCpc(model, { fwmStrict: true });
      const stride = model === '464' || model === '6128' ? 1 : 10;
      const bad: string[] = [];
      for (let k = 0; k < prepDoc.inputs.length; k += stride) {
        const inp = prepDoc.inputs[k]!;
        const r = call(cpc, mathsEntry(model, 'PREP')!, {}, { [A]: bytes(inp), [A + 5]: [0, 0, 0] });
        const [wb, wr] = prepWant(model, k).split(' ');
        const got =
          hex(Array.from(r.mem.slice(A, A + 5))) +
          ` ${r.bc.toString(16).padStart(4, '0')}${r.de.toString(16).padStart(4, '0')}${r.hl.toString(16).padStart(4, '0')}${r.f.toString(16).padStart(2, '0')}${r.a.toString(16).padStart(2, '0')}${r.ix.toString(16).padStart(4, '0')}${r.iy.toString(16).padStart(4, '0')}`.toUpperCase();
        // the zero input keeps IY (the test's &9ABC); the recording's stub used the same
        if (got !== `${wb} ${wr}` || hex(Array.from(r.mem.slice(A + 5, A + 8))) !== '000000') bad.push(`${inp}: want ${wb} ${wr}, got ${got}`);
      }
      expect(bad).toEqual([]);
      expect(cpc.approximations).toEqual([]);
    });
  }
  it('PREP: an unrecorded input is computed by the exact rule and listed; fwmStrict fails instead', () => {
    const x = '0000006082'; // 3.5, not among the recorded inputs
    expect(prepDoc.inputs).not.toContain(x);
    const cpc = newCpc();
    const r = call(cpc, mathsEntry('6128', 'PREP')!, {}, { [A]: bytes(x) });
    expect(at(r, A)).toBe('8093DC149D'); // 350000000 at 10^-8
    expect(r.de & 255).toBe(0xf8);
    expect(cpc.approximations).toEqual([`PREP(${x})`]);
    expect(() => call(newCpc('6128', { fwmStrict: true }), mathsEntry('6128', 'PREP')!, {}, { [A]: bytes(x) })).toThrow(FwMathError);
  });
  it('PREP: the exact rule agrees with the firmware on at least 2000 of the 2167 recorded inputs', () => {
    let same = 0;
    let total = 0;
    prepDoc.inputs.forEach((inp, k) => {
      const x = bytes(inp);
      if (x[4] === 0) return;
      const p = prepExact(x);
      const [wb, wr] = prepDoc.results['6128']![k]!.split(' ');
      total++;
      if (hex([p.n & 255, (p.n >>> 8) & 255, (p.n >>> 16) & 255, p.n >>> 24]) === wb!.slice(0, 8) && (p.e & 255) === parseInt(wr!.slice(6, 8), 16)) same++;
    });
    expect(total).toBe(2167);
    expect(same).toBe(2019);
  });
  it('PREP digits + the text rule reproduce all 2000 recorded Locomotive number texts (6128 recordings)', () => {
    const want = textDoc.text['6128']!;
    const bad: string[] = [];
    textDoc.patterns.forEach((pat, i) => {
      const k = prepDoc.inputs.indexOf(pat);
      const [wb, wr] = prepDoc.results['6128']![k]!.split(' ');
      const n = parseInt(wb!.slice(6, 8) + wb!.slice(4, 6) + wb!.slice(2, 4) + wb!.slice(0, 2), 16);
      const e = (parseInt(wr!.slice(6, 8), 16) << 24) >> 24;
      const got = prepText(bytes(pat)[4] === 0, parseInt(wr!.slice(0, 2), 16) === 0xff, n, e);
      if (got !== want[i]) bad.push(`${pat}: ${JSON.stringify(got)} want ${JSON.stringify(want[i])}`);
    });
    expect(bad).toEqual([]);
  });
});

describe('fake firmware maths: RND', () => {
  it('replays the boot sequence from the boot seed, RND0 repeats the last value', () => {
    const cpc = newCpc();
    const boot = vec.rnd_from_boot['6128']!;
    for (let k = 0; k < 20; k++) {
      const r = call(cpc, mathsEntry('6128', 'RND')!, {});
      expect(at(r, A), `value ${k}`).toBe(boot[k]);
    }
    const z = call(cpc, mathsEntry('6128', 'RND0')!, {});
    expect(at(z, A)).toBe(boot[19]);
    const same = call(newCpc('464'), mathsEntry('464', 'RND')!, {});
    expect(at(same, A)).toBe(boot[0]);
  });
  it('a RANDOMIZE (a write of the seed bytes) selects the recorded stream of that seed', () => {
    const seeded = vec.rnd_seeded['6128']!;
    for (const s of seeded.slice(0, 24)) {
      const cpc = newCpc();
      cpc.cpu.mem.set(bytes(s.seed), RND_SEED_ADDRESS['6128']);
      for (let k = 0; k < 5; k++) expect(at(call(cpc, mathsEntry('6128', 'RND')!, {}), A), `seed ${s.seed} #${k}`).toBe(s.values[k]);
    }
  });
  it('an unrecorded seed, RND(0) before any RND and running past the recording fail the run', () => {
    const cpc = newCpc();
    cpc.cpu.mem.set([1, 2, 3, 4], RND_SEED_ADDRESS['6128']);
    expect(() => call(cpc, mathsEntry('6128', 'RND')!, {})).toThrow(/no recorded sequence for the seed 01020304/);
    expect(() => call(newCpc(), mathsEntry('6128', 'RND0')!, {})).toThrow(FwMathError);
    const s = newCpc();
    cpc.cpu.mem.set([0x07, 0x6c, 0x65, 0xc9], RND_SEED_ADDRESS['6128']);
    s.cpu.mem.set([0x07, 0x6c, 0x65, 0xc9], RND_SEED_ADDRESS['6128']);
    for (let k = 0; k < 50; k++) call(s, mathsEntry('6128', 'RND')!, {});
    expect(() => call(s, mathsEntry('6128', 'RND')!, {})).toThrow(/only 50 values/);
  });
});
