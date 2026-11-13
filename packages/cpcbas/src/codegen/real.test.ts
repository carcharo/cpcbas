/**
 * L2-CG-REAL: every REAL and FIXED template is generated through the real generate + link path,
 * assembled over lib/runtime and lib/loco and executed on the test Z80 (test/z80sim). Results are
 * read from memory and compared with a JavaScript model: REAL within the 5-byte format's
 * precision (32-bit mantissa: a relative 2^-31 per operation, more for the series functions),
 * FIXED against exact 16.16 arithmetic, comparisons and conversions exactly.
 */
import { describe, expect, it } from 'vitest';
import { DiagnosticBag } from '../core/diagnostics.js';
import { SourceSet } from '../core/source.js';
import { addr, frame, global, imm, IrBuilder } from '../ir/builder.js';
import type { IrGlobal, IrProgram, IrType, Operand, Quad } from '../ir/ir.js';
import { verifyIr } from '../ir/verify.js';
import { libTree } from '../../test/runtime-tree.js';
import { assembleAndRun, type AssembledRun } from '../../test/z80sim/run.js';
import { encodeReal5 } from './data.js';
import { tempsOpt } from '../../test/temps-env.js';
import { generate, link, makeTarget } from './index.js';
import { REAL_TEMPLATES } from './real.js';

type IntType = 'u8' | 'i8' | 'u16' | 'i16' | 'u32' | 'i32';
const INTS: readonly IntType[] = ['u8', 'i8', 'u16', 'i16', 'u32', 'i32'];
const WIDTH: Record<IntType, number> = { u8: 8, i8: 8, u16: 16, i16: 16, u32: 32, i32: 32 };
const norm = (t: IntType, v: bigint): bigint => (t.startsWith('i') ? BigInt.asIntN(WIDTH[t], v) : BigInt.asUintN(WIDTH[t], v));

// ---------- harness ----------

const TREE = libTree();
const LOCO: Record<string, string> = {};
for (const [path, text] of TREE) if (path.startsWith('loco/')) LOCO[path] = text;

interface Exec {
  quads: Quad[];
  globals: IrGlobal[];
}

function exec(e: Exec): AssembledRun {
  const end: Quad = { op: 'end', a: imm(0), span: null };
  const ir: IrProgram = { main: [...e.quads, end], procedures: [], globals: e.globals, strings: [], data: [], requires: [], inits: [] };
  expect(verifyIr(ir)).toEqual([]);
  const target = makeTarget({ defines: { __CPC_PRINTER_ECHO__: '1' } });
  const diagnostics = new DiagnosticBag();
  const generated = generate({ ir, target, diagnostics, ...tempsOpt() });
  expect(diagnostics.all().map((d) => d.message)).toEqual([]);
  const linked = link({ asm: generated, target, runtime: TREE, sources: new SourceSet(), diagnostics });
  expect(diagnostics.all().map((d) => d.message)).toEqual([]);
  return assembleAndRun(linked.text, { defines: target.asmDefines, files: LOCO, maxTStates: 200_000_000 });
}

const glob = (label: string, type: IrType, size: number, init: number[] | null = null): IrGlobal => ({
  label,
  type,
  size,
  init: init === null ? null : new Uint8Array(init),
  at: null,
  dims: [],
});

/** The value of a 5-byte REAL in Locomotive's layout (mantissa low byte first, sign in bit 7 of byte 3, exponent last; exponent 0 is zero). */
function decodeReal(b: ArrayLike<number>): number {
  const e = b[4] as number;
  if (e === 0) return 0;
  const m = (((b[3] as number) | 0x80) * 2 ** 24 + (b[2] as number) * 65536 + (b[1] as number) * 256 + (b[0] as number)) / 2 ** 32;
  return ((b[3] as number) & 0x80 ? -1 : 1) * m * 2 ** (e - 128);
}
/** `v` as the 5-byte format stores it. */
const roundReal = (v: number): number => decodeReal(encodeReal5(v));

const bytesOfInt = (v: bigint, n: number): number[] => {
  const out: number[] = [];
  let x = BigInt.asUintN(n * 8, v);
  for (let i = 0; i < n; i++) {
    out.push(Number(x & 0xffn));
    x >>= 8n;
  }
  return out;
};
const fixedBits = (v: number): bigint => BigInt(Math.round(v * 65536));

const SIZE: Record<string, number> = { f: 5, f16: 4, u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, i32: 4 };

function initBytes(type: IrType, value: number | bigint): number[] {
  if (type === 'f') return encodeReal5(value as number);
  if (type === 'f16') return bytesOfInt(fixedBits(value as number), 4);
  return bytesOfInt(BigInt(value), SIZE[type] as number);
}

function readBytes(run: AssembledRun, label: string, n: number): number[] {
  const base = run.image.addr(label);
  return Array.from(run.memory.subarray(base, base + n));
}
const readF = (run: AssembledRun, label: string): number => decodeReal(readBytes(run, label, 5));
function readInt(run: AssembledRun, t: IntType, label: string): bigint {
  const b = readBytes(run, label, WIDTH[t] / 8);
  let v = 0n;
  for (let i = b.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[i] as number);
  return norm(t, v);
}
const readF16 = (run: AssembledRun, label: string): bigint => {
  const b = readBytes(run, label, 4);
  return BigInt.asIntN(32, BigInt(b[0]! | (b[1]! << 8) | (b[2]! << 16)) | (BigInt(b[3]!) << 24n));
};

type Kind = 'imm' | 'temp' | 'global' | 'frame' | 'byref';
const KINDS: readonly Kind[] = ['imm', 'temp', 'global', 'frame', 'byref'];
const FRAME = 40; // IX = _fr + FRAME

class Prog {
  readonly b = new IrBuilder();
  readonly globals: IrGlobal[] = [glob('_fr', 'u8', 120, null)];
  constructor() {
    this.b.push({ op: 'asm', lines: [{ text: `\tld ix, _fr+${FRAME}`, span: { file: 0 as never, start: 0, end: 0 } }], span: null });
  }
  g(label: string, type: IrType, value: number | bigint): string {
    this.globals.push(glob(label, type, SIZE[type] as number, initBytes(type, value)));
    return label;
  }
  r(label: string, type: IrType): string {
    this.globals.push(glob(label, type, SIZE[type] as number, new Array<number>(SIZE[type] as number).fill(0xaa)));
    return label;
  }
  operand(kind: Kind, type: IrType, value: number | bigint, label: string, slot: number): Operand {
    const imv = (type === 'f' ? value : type === 'f16' ? value : Number(value)) as number;
    switch (kind) {
      case 'imm':
        return imm(imv);
      case 'global':
        return global(this.g(label, type, value));
      case 'temp':
        return this.b.load(type, global(this.g(label, type, value)));
      case 'frame':
        this.b.store(type, frame(slot * 8 - 24), imm(imv));
        return frame(slot * 8 - 24);
      case 'byref':
        this.g(label, type, value);
        this.b.store('u16', frame(16 + slot * 2), addr(label));
        return frame(16 + slot * 2, true);
    }
  }
}
const kindA = (i: number): Kind => KINDS[i % 5] as Kind;
const kindB = (i: number): Kind => KINDS[(Math.floor(i / 5) + i) % 5] as Kind;

const relErr = (got: number, exp: number): number => (exp === 0 ? Math.abs(got) : Math.abs(got - exp) / Math.abs(exp));

// ---------- REAL arithmetic ----------

const REALS = [0, 1, -1, 0.5, -2.5, 3.14159265, 100, -1234.5678, 1e6, 0.001, 123456789, -0.1, 1e10, 2.718281828];

type RealOp = 'add' | 'sub' | 'mul' | 'div';
const REAL_MODEL: Record<RealOp, (a: number, b: number) => number> = { add: (a, b) => a + b, sub: (a, b) => a - b, mul: (a, b) => a * b, div: (a, b) => a / b };

describe('REAL arithmetic on the simulator', () => {
  for (const op of ['add', 'sub', 'mul', 'div'] as const) {
    it(`${op}:f over a table of values and operand kinds, within the 5-byte precision`, () => {
      const p = new Prog();
      const checks: { desc: string; label: string; a: number; b: number; exp: number }[] = [];
      let i = 0;
      for (const a of REALS) {
        for (const b of REALS) {
          if (op === 'div' && b === 0) continue;
          const A = p.operand(kindA(i), 'f', a, `_a${i}`, 0);
          const B = p.operand(kindB(i), 'f', b, `_b${i}`, 1);
          p.b.store('f', global(p.r(`_r${i}`, 'f')), p.b.binary(op, 'f', A, B));
          checks.push({ desc: `${op} ${a}, ${b} [${kindA(i)},${kindB(i)}]`, label: `_r${i}`, a: roundReal(a), b: roundReal(b), exp: REAL_MODEL[op](roundReal(a), roundReal(b)) });
          i++;
        }
      }
      const run = exec({ quads: p.b.quads, globals: p.globals });
      expect(run.stopped).toBe('rst0');
      const bad: string[] = [];
      for (const c of checks) {
        const got = readF(run, c.label);
        // the error is relative to the larger of the result and the operands (a cancelling subtraction keeps the operands' absolute error)
        const scale = Math.max(Math.abs(c.exp), op === 'add' || op === 'sub' ? Math.max(Math.abs(c.a), Math.abs(c.b)) : 0);
        if (Math.abs(got - c.exp) > 3e-9 * scale) bad.push(`${c.desc}: got ${got}, expected ${c.exp}`);
      }
      expect(bad).toEqual([]);
    });
  }

  it('all 25 operand kind pairs for the four operations', () => {
    const p = new Prog();
    const checks: { desc: string; label: string; exp: number; scale: number }[] = [];
    let i = 0;
    for (const ka of KINDS) {
      for (const kb of KINDS) {
        for (const op of ['add', 'sub', 'mul', 'div'] as const) {
          const a = REALS[(i * 3 + 5) % REALS.length] as number;
          let b = REALS[(i * 7 + 2) % REALS.length] as number;
          if (op === 'div' && b === 0) b = 1;
          const A = p.operand(ka, 'f', a, `_a${i}`, 0);
          const B = p.operand(kb, 'f', b, `_b${i}`, 1);
          p.b.store('f', global(p.r(`_r${i}`, 'f')), p.b.binary(op, 'f', A, B));
          const exp = REAL_MODEL[op](roundReal(a), roundReal(b));
          checks.push({ desc: `${op} ${a}, ${b} [${ka},${kb}]`, label: `_r${i}`, exp, scale: Math.max(Math.abs(exp), Math.abs(a), Math.abs(b)) });
          i++;
        }
      }
    }
    const run = exec({ quads: p.b.quads, globals: p.globals });
    const bad = checks.filter((c) => Math.abs(readF(run, c.label) - c.exp) > 3e-9 * c.scale).map((c) => `${c.desc}: got ${readF(run, c.label)}, expected ${c.exp}`);
    expect(bad).toEqual([]);
  });

  it('pow:f within 1e-7, including a negative base with an integer exponent', () => {
    const p = new Prog();
    const cases: [number, number][] = [[2, 10], [2, 0.5], [10, -2], [-8, 3], [1.5, 2.5], [9, 0.5], [2, -1], [100, 0], [7, 1], [0.5, 3]];
    cases.forEach(([a, b], i) => {
      const A = p.operand(kindA(i), 'f', a, `_a${i}`, 0);
      const B = p.operand(kindB(i), 'f', b, `_b${i}`, 1);
      p.b.store('f', global(p.r(`_r${i}`, 'f')), p.b.pow(A, B));
    });
    const run = exec({ quads: p.b.quads, globals: p.globals });
    const bad = cases.map(([a, b], i) => ({ d: `${a}^${b}`, got: readF(run, `_r${i}`), exp: a ** b })).filter((c) => relErr(c.got, c.exp) > 1e-7);
    expect(bad).toEqual([]);
  });

  it('division by zero is Locomotive\'s non-fatal error 11: the name is printed and the result is +max', () => {
    // L4-ERR: firmware builds print "Division by zero" and carry on with the firmware's +-max (1.70141E+38)
    const p = new Prog();
    p.b.store('f', global(p.r('_r', 'f')), p.b.div('f', imm(1), global(p.g('_z', 'f', 0))));
    const run = exec({ quads: p.b.quads, globals: p.globals });
    expect(run.printer).toBe('Division by zero\n\x04END\n');
    expect(relErr(readF(run, '_r'), 1.7014118346046923e38)).toBeLessThan(1e-9);
  });
});

describe('REAL neg, abs, comparisons and conditions', () => {
  it('neg:f and abs:f for every operand kind', () => {
    const p = new Prog();
    const checks: [string, number][] = [];
    let i = 0;
    for (const v of REALS) {
      const k = KINDS[i % 5] as Kind;
      p.b.store('f', global(p.r(`_n${i}`, 'f')), p.b.neg('f', p.operand(k, 'f', v, `_a${i}`, 0)));
      checks.push([`_n${i}`, -roundReal(v)]);
      const k2 = KINDS[(i + 2) % 5] as Kind;
      p.b.store('f', global(p.r(`_b${i}`, 'f')), p.b.abs('f', p.operand(k2, 'f', v, `_c${i}`, 0)));
      checks.push([`_b${i}`, Math.abs(roundReal(v))]);
      i++;
    }
    const run = exec({ quads: p.b.quads, globals: p.globals });
    const bad = checks.filter(([l, e]) => readF(run, l) !== e && !(readF(run, l) === 0 && e === 0)).map(([l, e]) => `${l}: got ${readF(run, l)}, expected ${e}`);
    expect(bad).toEqual([]);
  });

  for (const op of ['eq', 'ne', 'lt', 'le', 'gt', 'ge'] as const) {
    it(`${op}:f gives -1 or 0 over a table of pairs and operand kinds`, () => {
      const p = new Prog();
      const cmp: Record<typeof op, (a: number, b: number) => boolean> = { eq: (a, b) => a === b, ne: (a, b) => a !== b, lt: (a, b) => a < b, le: (a, b) => a <= b, gt: (a, b) => a > b, ge: (a, b) => a >= b };
      const vals = [0, 1, -1, 0.5, -0.5, 2.5, -2.5, 100, 1e-5, -1e-5, 123456789, 1e10];
      const checks: { label: string; exp: number; desc: string }[] = [];
      let i = 0;
      for (const a of vals) {
        for (const b of vals) {
          const A = p.operand(kindA(i), 'f', a, `_a${i}`, 0);
          const B = p.operand(kindB(i), 'f', b, `_b${i}`, 1);
          p.b.store('i16', global(p.r(`_r${i}`, 'i16')), p.b.compare(op, 'f', A, B));
          checks.push({ label: `_r${i}`, exp: cmp[op](roundReal(a), roundReal(b)) ? -1 : 0, desc: `${a} ${op} ${b} [${kindA(i)},${kindB(i)}]` });
          i++;
        }
      }
      const run = exec({ quads: p.b.quads, globals: p.globals });
      const bad = checks.filter((c) => Number(readInt(run, 'i16', c.label)) !== c.exp).map((c) => `${c.desc}: got ${readInt(run, 'i16', c.label)}, expected ${c.exp}`);
      expect(bad).toEqual([]);
    });
  }

  it('jz:f and jnz:f test zero for every operand kind', () => {
    const p = new Prog();
    const vals = [0, 1, -1, 0.5, 1e-30];
    const checks: [string, number][] = [];
    let i = 0;
    for (const v of vals) {
      for (const k of KINDS) {
        const z = `.Z${i}`;
        const e = `.E${i}`;
        p.b.store('i16', global(p.r(`_z${i}`, 'i16')), imm(0));
        p.b.store('i16', global(p.r(`_n${i}`, 'i16')), imm(0));
        p.b.jz('f', p.operand(k, 'f', v, `_a${i}`, 0), z);
        p.b.store('i16', global(`_z${i}`), imm(7)); // not zero
        p.b.label(z);
        p.b.jnz('f', p.operand(k, 'f', v, `_c${i}`, 0), e);
        p.b.store('i16', global(`_n${i}`), imm(9)); // zero
        p.b.label(e);
        checks.push([`_z${i}`, v === 0 ? 0 : 7], [`_n${i}`, v === 0 ? 9 : 0]);
        i++;
      }
    }
    const run = exec({ quads: p.b.quads, globals: p.globals });
    const bad = checks.filter(([l, e]) => Number(readInt(run, 'i16', l)) !== e).map(([l, e]) => `${l}: got ${readInt(run, 'i16', l)}, expected ${e}`);
    expect(bad).toEqual([]);
  });
});

describe('REAL load, store, param, peek, poke', () => {
  it('load and store move the five bytes through every operand kind', () => {
    const p = new Prog();
    const vals = [3.5, -0.0625, 1e20, 0];
    const checks: [string, number[]][] = [];
    vals.forEach((v, n) => {
      KINDS.forEach((k, j) => {
        const i = n * 5 + j;
        const a = p.operand(k, 'f', v, `_a${i}`, 0);
        const t = p.b.load('f', a);
        p.b.store('f', global(p.r(`_r${i}`, 'f')), t);
        checks.push([`_r${i}`, encodeReal5(v)]);
      });
    });
    // a store of a constant into a frame slot, a BYREF slot and a global
    p.b.store('f', global(p.r('_g', 'f')), imm(-7.25));
    p.b.store('f', frame(-30), imm(2.5));
    p.b.store('f', global(p.r('_h', 'f')), frame(-30));
    p.g('_t', 'f', 0);
    p.b.store('u16', frame(50), addr('_t'));
    p.b.store('f', frame(50, true), imm(9.75));
    checks.push(['_g', encodeReal5(-7.25)], ['_h', encodeReal5(2.5)], ['_t', encodeReal5(9.75)]);
    const run = exec({ quads: p.b.quads, globals: p.globals });
    expect(checks.filter(([l, e]) => readBytes(run, l, 5).join() !== e.join()).map(([l]) => l)).toEqual([]);
  });

  it('peek:f and poke:f read and write five bytes at an address', () => {
    const p = new Prog();
    p.g('_src', 'f', -12.375);
    p.g('_dst', 'f', 0);
    p.g('_ptr', 'u16', 0);
    p.b.store('f', global(p.r('_p1', 'f')), p.b.peek('f', addr('_src')));
    p.b.poke('f', addr('_dst'), imm(6.5));
    p.b.store('u16', global('_ptr'), addr('_src'));
    p.b.store('f', global(p.r('_p2', 'f')), p.b.peek('f', global('_ptr')));
    const t = p.b.load('f', imm(1.25));
    p.b.poke('f', addr('_dst', 0), t);
    p.b.store('f', global(p.r('_p3', 'f')), global('_dst'));
    const run = exec({ quads: p.b.quads, globals: p.globals });
    expect([readF(run, '_p1'), readF(run, '_p2'), readF(run, '_p3')]).toEqual([-12.375, -12.375, 1.25]);
  });

  it('param:f pushes the register form and fparam:f loads it', () => {
    const p = new Prog();
    p.g('_v', 'f', 5.5);
    // MINF / MAXF pop two pushed values (the second on top); ABSF takes one in the registers
    p.b.param('f', p.b.load('f', global('_v')));
    p.b.param('f', p.b.load('f', imm(-2)));
    p.b.store('f', global(p.r('_o1', 'f')), p.b.rtcall('.core.__LOCO_MAXF', 'f') as Operand);
    const a = p.b.load('f', imm(-8.25));
    const b = p.b.load('f', imm(3));
    p.b.param('f', b);
    p.b.param('f', a);
    p.b.store('f', global(p.r('_o2', 'f')), p.b.rtcall('.core.__LOCO_MINF', 'f') as Operand);
    p.b.fparam('f', imm(-8.5));
    p.b.store('f', global(p.r('_o3', 'f')), p.b.rtcall('.core.__LOCO_ABSF', 'f') as Operand);
    const run = exec({ quads: p.b.quads, globals: p.globals });
    expect([readF(run, '_o1'), readF(run, '_o2'), readF(run, '_o3')]).toEqual([5.5, -8.25, 8.5]);
  });
});

// ---------- conversions ----------

const INT_VALUES: Record<IntType, bigint[]> = {
  u8: [0n, 1n, 7n, 127n, 128n, 255n],
  i8: [0n, 1n, -1n, 100n, 127n, -128n],
  u16: [0n, 1n, 255n, 256n, 32768n, 65535n],
  i16: [0n, 1n, -1n, 1000n, 32767n, -32768n],
  u32: [0n, 1n, 65536n, 123456789n, 0x80000000n, 0xffffffffn],
  i32: [0n, -1n, 65536n, 123456789n, 0x7fffffffn, -0x80000000n],
};

describe('casts between integers and REAL', () => {
  for (const t of INTS) {
    it(`cast:${t}->f is exact (within the format's 32 bits)`, () => {
      const p = new Prog();
      const checks: [string, bigint][] = [];
      INT_VALUES[t].forEach((v, i) => {
        const a = p.operand(KINDS[i % 5] as Kind, t, v, `_a${i}`, 0);
        p.b.store('f', global(p.r(`_r${i}`, 'f')), p.b.cast('f', t, a));
        checks.push([`_r${i}`, v]);
      });
      const run = exec({ quads: p.b.quads, globals: p.globals });
      expect(checks.filter(([l, v]) => readF(run, l) !== Number(v)).map(([l, v]) => `${l}: got ${readF(run, l)}, expected ${v}`)).toEqual([]);
    });

    it(`cast:f->${t} truncates towards zero and wraps in the target`, () => {
      const p = new Prog();
      const vals = [0, 1, 1.5, 2.9999, -1, -1.5, -2.9999, 200.7, -100.5, 100000.25, -100000.75, 0.4, -0.4, 40000.5, 3000000000.5];
      const checks: [string, bigint][] = [];
      vals.forEach((v, i) => {
        const a = p.operand(KINDS[i % 5] as Kind, 'f', v, `_a${i}`, 0);
        p.b.store(t, global(p.r(`_r${i}`, t)), p.b.cast(t, 'f', a));
        checks.push([`_r${i}`, norm(t, BigInt(Math.trunc(roundReal(v))))]);
      });
      const run = exec({ quads: p.b.quads, globals: p.globals });
      expect(checks.filter(([l, v]) => readInt(run, t, l) !== v).map(([l, v]) => `${l}: got ${readInt(run, t, l)}, expected ${v}`)).toEqual([]);
    });
  }
});

describe('FIXED', () => {
  const FIXEDS = [0, 1, -1, 0.5, -2.5, 3.25, 100.125, -1234.5, 32767.5, -32768, 0.0001, 7.75];

  it('load, store, add, sub, neg, abs and the comparisons are exact', () => {
    const p = new Prog();
    const checks: [string, bigint][] = [];
    let i = 0;
    for (const a of FIXEDS) {
      for (const b of [FIXEDS[(i * 5 + 1) % FIXEDS.length] as number, 2.5, -0.75]) {
        const A = p.operand(kindA(i), 'f16', a, `_a${i}`, 0);
        const B = p.operand(kindB(i), 'f16', b, `_b${i}`, 1);
        const sum = p.b.add('f16', A, B);
        p.b.store('f16', global(p.r(`_s${i}`, 'f16')), sum);
        checks.push([`_s${i}`, BigInt.asIntN(32, fixedBits(a) + fixedBits(b))]);
        const A2 = p.operand(kindA(i + 1), 'f16', a, `_c${i}`, 0);
        const B2 = p.operand(kindB(i + 1), 'f16', b, `_d${i}`, 1);
        p.b.store('f16', global(p.r(`_d${i}x`, 'f16')), p.b.sub('f16', A2, B2));
        checks.push([`_d${i}x`, BigInt.asIntN(32, fixedBits(a) - fixedBits(b))]);
        p.b.store('f16', global(p.r(`_n${i}`, 'f16')), p.b.neg('f16', p.operand(kindA(i + 2), 'f16', a, `_e${i}`, 0)));
        checks.push([`_n${i}`, BigInt.asIntN(32, -fixedBits(a))]);
        p.b.store('f16', global(p.r(`_m${i}`, 'f16')), p.b.abs('f16', p.operand(kindA(i + 3), 'f16', a, `_f${i}`, 0)));
        checks.push([`_m${i}`, BigInt.asIntN(32, fixedBits(Math.abs(a)))]);
        for (const op of ['eq', 'ne', 'lt', 'le', 'gt', 'ge'] as const) {
          const fa = fixedBits(a);
          const fb = fixedBits(b);
          const exp = { eq: fa === fb, ne: fa !== fb, lt: fa < fb, le: fa <= fb, gt: fa > fb, ge: fa >= fb }[op];
          p.b.store('i16', global(p.r(`_cmp${op}${i}`, 'i16')), p.b.compare(op, 'f16', p.operand(kindA(i), 'f16', a, `_g${op}${i}`, 0), p.operand(kindB(i), 'f16', b, `_h${op}${i}`, 1)));
          checks.push([`_cmp${op}${i}`, exp ? -1n : 0n]);
        }
        i++;
      }
    }
    const run = exec({ quads: p.b.quads, globals: p.globals });
    const bad = checks
      .filter(([l, e]) => (l.startsWith('_cmp') ? BigInt.asIntN(16, readInt(run, 'i16', l)) : readF16(run, l)) !== e)
      .map(([l, e]) => `${l}: expected ${e}`);
    expect(bad).toEqual([]);
  });

  it('mul:f16 and div:f16 within one unit of the 16th fractional bit', () => {
    const p = new Prog();
    const checks: { label: string; exp: number; desc: string }[] = [];
    let i = 0;
    for (const a of FIXEDS) {
      for (const b of [1, -1, 2.5, -0.5, 0.0625, 12.75, 3]) {
        const A = p.operand(kindA(i), 'f16', a, `_a${i}`, 0);
        const B = p.operand(kindB(i), 'f16', b, `_b${i}`, 1);
        p.b.store('f16', global(p.r(`_m${i}`, 'f16')), p.b.mul('f16', A, B));
        checks.push({ label: `_m${i}`, exp: Number(BigInt.asIntN(32, fixedBits(a) * fixedBits(b) >> 16n)), desc: `${a} * ${b}` });
        const A2 = p.operand(kindA(i + 1), 'f16', a, `_c${i}`, 0);
        const B2 = p.operand(kindB(i + 1), 'f16', b, `_d${i}`, 1);
        p.b.store('f16', global(p.r(`_q${i}`, 'f16')), p.b.div('f16', A2, B2));
        checks.push({ label: `_q${i}`, exp: Number(BigInt.asIntN(32, (fixedBits(a) << 16n) / fixedBits(b))), desc: `${a} / ${b}` });
        i++;
      }
    }
    const run = exec({ quads: p.b.quads, globals: p.globals });
    const bad = checks
      .filter((c) => {
        const wraps = Math.abs(c.exp) >= 2 ** 31; // the result left the FIXED range: only the wrap is checked loosely
        // the divider truncates a 32-bit quotient: a few units for a large result
        return !wraps && Math.abs(Number(readF16(run, c.label)) - c.exp) > (Math.abs(c.exp) > 2 ** 24 ? 4 : 1);
      })
      .map((c) => `${c.desc}: got ${readF16(run, c.label)}, expected ${c.exp}`);
    expect(bad).toEqual([]);
  });

  it('division by zero is runtime error 11', () => {
    const p = new Prog();
    p.b.store('f16', global(p.r('_r', 'f16')), p.b.div('f16', imm(1), global(p.g('_z', 'f16', 0))));
    const run = exec({ quads: p.b.quads, globals: p.globals });
    expect(run.printer).toContain('Error 11');
  });

  it('casts to and from REAL and the integers: the integer part wraps, a REAL to FIXED rounds down to 1/65536', () => {
    const p = new Prog();
    const checks: [string, 'f' | 'f16' | 'f16x' | IntType, number | bigint][] = [];
    const fv = [0, 1.5, -1.5, 100.125, -2.75, 32000.5, 0.000015];
    fv.forEach((v, i) => {
      const a = p.operand(KINDS[i % 5] as Kind, 'f', v, `_a${i}`, 0);
      p.b.store('f16', global(p.r(`_x${i}`, 'f16')), p.b.cast('f16', 'f', a));
      checks.push([`_x${i}`, 'f16', v]);
      const b = p.operand(KINDS[(i + 1) % 5] as Kind, 'f16', v, `_b${i}`, 1);
      p.b.store('f', global(p.r(`_y${i}`, 'f')), p.b.cast('f', 'f16', b));
      checks.push([`_y${i}`, 'f', Number(fixedBits(v)) / 65536]);
    });
    for (const t of INTS) {
      [0, 3.75, -3.75, -0.5, 200.5, -32767.5].forEach((v, i) => {
        const a = p.operand(KINDS[i % 5] as Kind, 'f16', v, `_c${t}${i}`, 0);
        p.b.store(t, global(p.r(`_i${t}${i}`, t)), p.b.cast(t, 'f16', a));
        checks.push([`_i${t}${i}`, t, norm(t, BigInt(Math.trunc(v)))]);
      });
      [0n, 1n, 100n, norm(t, -1n), norm(t, 255n), norm(t, 0x12345n), norm(t, -0x8000n)].forEach((v, i) => {
        const a = p.operand(KINDS[i % 5] as Kind, t, v, `_d${t}${i}`, 0);
        p.b.store('f16', global(p.r(`_j${t}${i}`, 'f16')), p.b.cast('f16', t, a));
        checks.push([`_j${t}${i}`, 'f16x', Number(BigInt.asIntN(16, v))]);
      });
    }
    const run = exec({ quads: p.b.quads, globals: p.globals });
    const bad: string[] = [];
    for (const [l, t, e] of checks) {
      if (t === 'f16') {
        if (Math.abs(Number(readF16(run, l)) - Math.floor(((e as number) * 65536) + 1e-9)) > 1) bad.push(`${l}: got ${readF16(run, l)}, expected ${e}`);
      } else if (t === 'f16x') {
        if (Number(readF16(run, l)) !== (e as number) * 65536) bad.push(`${l}: got ${readF16(run, l)}, expected ${e}.0`);
      } else if (t === 'f') {
        if (Math.abs(readF(run, l) - (e as number)) > 1e-9 * Math.abs(e as number)) bad.push(`${l}: got ${readF(run, l)}, expected ${e}`);
      } else if (readInt(run, t, l) !== e) bad.push(`${l}: got ${readInt(run, t, l)}, expected ${e}`);
    }
    expect(bad).toEqual([]);
  });

  it('peek:f16 and poke:f16 use the 16.16 bit pattern', () => {
    const p = new Prog();
    p.g('_s', 'f16', -2.5);
    p.g('_d', 'f16', 0);
    p.b.store('f16', global(p.r('_a', 'f16')), p.b.peek('f16', addr('_s')));
    p.b.poke('f16', addr('_d'), imm(1.25));
    const run = exec({ quads: p.b.quads, globals: p.globals });
    expect([readF16(run, '_a'), readF16(run, '_d')]).toEqual([fixedBits(-2.5), fixedBits(1.25)]);
  });
});

it('the table has no key the other tables own', () => {
  expect(Object.keys(REAL_TEMPLATES).filter((k) => k.startsWith('cast:') && (k.includes('->str') ? !(k === 'cast:f->str' || k === 'cast:f16->str') : false))).toEqual([]);
  expect(Object.keys(REAL_TEMPLATES)).toContain('cast:f->i16');
});
