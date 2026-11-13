/**
 * L5-TEMPS: the register forms and compare-and-branch (codegen/types.ts, docs/ir.md "The template-operand protocol").
 *
 * Every program is generated twice from the same IR, with the stack forms (`-O0`) and with register temps on, assembled over
 * lib/ and run on the test Z80; both must give the value of a model, and the register build must be the one the protocol
 * describes (fewer pushes, no boolean where a comparison feeds a jump). The template suites (int, real, array, str) run once
 * more with `CPCBAS_TEMPS=1` (vitest.config.ts, the `temps` project), so their operand-kind and value tables test the register
 * forms of every key against the same models. This file adds what those do not reach: the fused compare-and-branch, `jz`/`jnz`,
 * `call`/`ret` and `fparam`, `peek` of a REAL, the driver's decisions, and `--opt-disable cmpjump`.
 */
import { describe, expect, it } from 'vitest';
import { DiagnosticBag } from '../core/diagnostics.js';
import { SourceSet } from '../core/source.js';
import { addr, frame, global, imm, IrBuilder, strconst } from '../ir/builder.js';
import type { IrGlobal, IrProcedure, IrProgram, IrType, Operand, Quad } from '../ir/ir.js';
import { verifyIr } from '../ir/verify.js';
import { libTree } from '../../test/runtime-tree.js';
import { assembleAndRun, type AssembledRun } from '../../test/z80sim/run.js';
import { TEMPS_OPTIONS } from '../../test/temps-env.js';
import { encodeReal5 } from './data.js';
import { generate, link, makeTarget, type AsmProgram, type CodegenOptions } from './index.js';

const SIZE: Record<string, number> = { f: 5, f16: 4, u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, i32: 4, str: 2 };

const TREE = libTree();
const LOCO: Record<string, string> = {};
for (const [path, text] of TREE) if (path.startsWith('loco/')) LOCO[path] = text;

const NO_CMPJUMP: CodegenOptions = { ...TEMPS_OPTIONS, enabled: (name) => name !== 'cmpjump' };

interface Built {
  readonly asm: AsmProgram;
  run(): AssembledRun;
}

function build(ir: IrProgram, opt: CodegenOptions | undefined): Built {
  expect(verifyIr(ir)).toEqual([]);
  const target = makeTarget({ defines: { __CPC_PRINTER_ECHO__: '1' } });
  const diagnostics = new DiagnosticBag();
  const asm = generate({ ir, target, diagnostics, ...(opt !== undefined ? { opt } : {}) });
  expect(diagnostics.all().map((d) => d.message)).toEqual([]);
  const linked = link({ asm, target, runtime: TREE, sources: new SourceSet(), diagnostics });
  expect(diagnostics.all().map((d) => d.message)).toEqual([]);
  return { asm, run: () => assembleAndRun(linked.text, { defines: target.asmDefines, files: LOCO, maxTStates: 100_000_000 }) };
}

const SPAN = { file: 0 as never, start: 0, end: 0 };
const glob = (label: string, type: IrType, init: number[] | null = null): IrGlobal => ({
  label,
  type,
  size: SIZE[type] as number,
  init: init === null ? null : new Uint8Array(init),
  at: null,
  dims: [],
});

function bytesOf(type: IrType, value: number | bigint): number[] {
  if (type === 'f') return encodeReal5(value as number);
  const v = type === 'f16' ? BigInt(Math.round((value as number) * 65536)) : BigInt(value);
  const out: number[] = [];
  let x = BigInt.asUintN((SIZE[type] as number) * 8, v);
  for (let i = 0; i < (SIZE[type] as number); i++) {
    out.push(Number(x & 0xffn));
    x >>= 8n;
  }
  return out;
}

function readBytes(run: AssembledRun, label: string, n: number): number[] {
  const base = run.image.addr(label);
  return Array.from(run.memory.subarray(base, base + n));
}

/** The raw bytes of every result label, for comparing two builds byte for byte. */
const dump = (run: AssembledRun, labels: readonly [string, IrType][]): string => labels.map(([l, t]) => `${l}=${readBytes(run, l, SIZE[t] as number).join(',')}`).join(' ');

type Kind = 'imm' | 'temp' | 'global' | 'frame' | 'byref';
const KINDS: readonly Kind[] = ['imm', 'temp', 'global', 'frame', 'byref'];
const FRAME = 40; // IX = _fr + FRAME

class Prog {
  readonly b = new IrBuilder();
  readonly globals: IrGlobal[] = [glob('_fr', 'u8')];
  readonly results: [string, IrType][] = [];
  constructor() {
    this.globals[0] = { ...glob('_fr', 'u8'), size: 120 };
    this.b.push({ op: 'asm', lines: [{ text: `\tld ix, _fr+${FRAME}`, span: SPAN }], span: null });
  }
  g(label: string, type: IrType, value: number | bigint): string {
    this.globals.push(glob(label, type, bytesOf(type, value)));
    return label;
  }
  /** A result global, filled with 0xAA so a store that did not happen shows. */
  r(label: string, type: IrType): string {
    this.globals.push(glob(label, type, new Array<number>(SIZE[type] as number).fill(0xaa)));
    this.results.push([label, type]);
    return label;
  }
  operand(kind: Kind, type: IrType, value: number | bigint, label: string, slot: number): Operand {
    const v = Number(value);
    switch (kind) {
      case 'imm':
        return imm(v);
      case 'global':
        return global(this.g(label, type, value));
      case 'temp':
        return this.b.load(type, global(this.g(label, type, value)));
      case 'frame':
        this.b.store(type, frame(slot * 8 - 24), imm(v));
        return frame(slot * 8 - 24);
      case 'byref':
        this.g(label, type, value);
        this.b.store('u16', frame(16 + slot * 2), addr(label));
        return frame(16 + slot * 2, true);
    }
  }
  /**
   * Operands of a binary quad: the one the quad pops first (`b` when it is a temp, else `a`) is made last, so that it is the quad
   * right before the consumer and the protocol can hand it over in the registers.
   */
  pair(ka: Kind, kb: Kind, type: IrType, a: number | bigint, b: number | bigint, tag: string): [Operand, Operand] {
    if (kb === 'temp') {
      const A = this.operand(ka, type, a, `_a${tag}`, 0);
      return [A, this.operand(kb, type, b, `_b${tag}`, 1)];
    }
    const B = this.operand(kb, type, b, `_b${tag}`, 1);
    return [this.operand(ka, type, a, `_a${tag}`, 0), B];
  }
  program(procedures: IrProcedure[] = [], strings: readonly string[] = []): IrProgram {
    const end: Quad = { op: 'end', a: imm(0), span: null };
    const table = strings.map((text, id) => ({ id, label: `.S.${id}`, bytes: Uint8Array.from(text, (c) => c.charCodeAt(0)) }));
    return { main: [...this.b.quads, end], procedures, globals: this.globals, strings: table, data: [], requires: [], inits: [] };
  }
}

const COUNT = (text: readonly string[], re: RegExp): number => text.filter((l) => re.test(l)).length;

// ---------------------------------------------------------------------------
// compare-and-branch
// ---------------------------------------------------------------------------

type Cmp = 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge';
const CMPS: readonly Cmp[] = ['eq', 'ne', 'lt', 'le', 'gt', 'ge'];
const CMP: Record<Cmp, (a: bigint, b: bigint) => boolean> = {
  eq: (a, b) => a === b,
  ne: (a, b) => a !== b,
  lt: (a, b) => a < b,
  le: (a, b) => a <= b,
  gt: (a, b) => a > b,
  ge: (a, b) => a >= b,
};
type Num = bigint | number;
const GRID: readonly (readonly [IrType, readonly Cmp[], readonly Num[]])[] = [
  ['u8', CMPS, [0n, 1n, 127n, 128n, 254n, 255n]],
  ['i8', CMPS, [0n, 1n, -1n, 127n, -127n, -128n]],
  ['u16', CMPS, [0n, 1n, 255n, 256n, 32767n, 32768n, 65535n]],
  ['i16', CMPS, [0n, 1n, -1n, 255n, 32767n, -32767n, -32768n]],
  ['u32', ['eq', 'ne', 'lt', 'ge'], [0n, 1n, 65535n, 65536n, 0x7fffffffn, 0x80000000n, 0xffffffffn]],
  ['i32', ['eq', 'ne', 'lt', 'ge'], [0n, 1n, -1n, 65536n, -65536n, 0x7fffffffn, -0x80000000n]],
  ['f', CMPS, [-2.5, 0, 1.5, 100, -100]],
  ['f16', ['eq', 'ne', 'lt', 'ge'], [-2.5, 0, 1.5, 100.25, -100.5]],
];
const holds = (op: Cmp, a: Num, b: Num): boolean => CMP[op](a as bigint, b as bigint);

describe('compare-and-branch', () => {
  for (const [t, ops, values] of GRID) {
    for (const op of ops) {
      it(`${op}:${t} then jz / jnz, every operand kind, against a model, no boolean made`, () => {
        const p = new Prog();
        const expected: [string, bigint][] = [];
        let i = 0;
        for (const a of values) {
          for (const b of values) {
            for (const jump of ['jz', 'jnz'] as const) {
              const ka = KINDS[i % 5] as Kind;
              const kb = KINDS[(Math.floor(i / 5) + i) % 5] as Kind;
              const [A, B] = p.pair(ka, kb, t, a, b, String(i));
              const c = p.b.compare(op, t, A, B);
              const skip = p.b.newLabel();
              const done = p.b.newLabel();
              p.b[jump]('i16', c, skip);
              p.b.store('u8', global(p.r(`_r${i}`, 'u8')), imm(1));
              p.b.jump(done);
              p.b.label(skip);
              p.b.store('u8', global(`_r${i}`), imm(2));
              p.b.label(done);
              const truth = holds(op, a, b);
              expected.push([`_r${i}`, jump === 'jz' ? (truth ? 1n : 2n) : truth ? 2n : 1n]);
              i++;
            }
          }
        }
        const ir = p.program();
        const fused = build(ir, TEMPS_OPTIONS);
        const run = fused.run();
        expect(run.stopped).toBe('rst0');
        expect(expected.filter(([l, v]) => BigInt(readBytes(run, l, 1)[0] as number) !== v).map(([l]) => l)).toEqual([]);
        expect(dump(run, p.results)).toBe(dump(build(ir, undefined).run(), p.results));
        // no boolean: the comparisons' `sbc a, a` / `ld h, a` tail is gone
        expect(COUNT(fused.asm.main, /\tld h, a$/)).toBe(0);
      });
    }
  }

  it('str: every comparison, owned copies and constants, jz and jnz, against a model', () => {
    const words = ['abc', 'abd', 'ab', '', 'b'];
    const p = new Prog();
    const expected: [string, bigint][] = [];
    let i = 0;
    words.forEach((x, xi) => {
      words.forEach((y, yi) => {
        for (const op of CMPS) {
          for (const jump of ['jz', 'jnz'] as const) {
            const form = i % 3; // two owned copies, a copy against a constant, a constant against a copy
            const a = form === 2 ? strconst(xi) : p.b.load('str', strconst(xi));
            const b = form === 1 ? strconst(yi) : p.b.load('str', strconst(yi));
            const c = p.b.compare(op, 'str', a, b);
            const skip = p.b.newLabel();
            const done = p.b.newLabel();
            p.b[jump]('i16', c, skip);
            p.b.store('u8', global(p.r(`_r${i}`, 'u8')), imm(1));
            p.b.jump(done);
            p.b.label(skip);
            p.b.store('u8', global(`_r${i}`), imm(2));
            p.b.label(done);
            const truth = CMP[op](BigInt(x < y ? -1 : x > y ? 1 : 0), 0n);
            expected.push([`_r${i}`, jump === 'jz' ? (truth ? 1n : 2n) : truth ? 2n : 1n]);
            i++;
          }
        }
      });
    });
    const ir = p.program([], words);
    const fused = build(ir, TEMPS_OPTIONS);
    const run = fused.run();
    expect(run.stopped).toBe('rst0');
    expect(expected.filter(([l, v]) => BigInt(readBytes(run, l, 1)[0] as number) !== v).map(([l]) => l)).toEqual([]);
    expect(dump(run, p.results)).toBe(dump(build(ir, undefined).run(), p.results));
    expect(COUNT(fused.asm.main, /\tadd a, 255$/)).toBe(0);
  });

  it('is not fused with --opt-disable cmpjump: the boolean is made, and the results are the same', () => {
    const p = new Prog();
    const [A, B] = p.pair('global', 'temp', 'i16', -5n, 3n, '0');
    const c = p.b.compare('lt', 'i16', A, B);
    const skip = p.b.newLabel();
    p.b.jz('i16', c, skip);
    p.b.store('u8', global(p.r('_r', 'u8')), imm(7));
    p.b.label(skip);
    const ir = p.program();
    const plain = build(ir, NO_CMPJUMP);
    expect(COUNT(plain.asm.main, /\tld h, a$/)).toBe(1);
    expect(readBytes(plain.run(), '_r', 1)).toEqual([7]);
    expect(COUNT(build(ir, TEMPS_OPTIONS).asm.main, /\tld h, a$/)).toBe(0);
  });

  it('keeps the stack form at -O0 (no opt options)', () => {
    const p = new Prog();
    const [A, B] = p.pair('global', 'temp', 'u16', 5n, 9n, '0');
    const c = p.b.compare('lt', 'u16', A, B);
    const skip = p.b.newLabel();
    p.b.jz('i16', c, skip);
    p.b.label(skip);
    const stack = build(p.program(), undefined).asm.main;
    expect(COUNT(stack, /\tpush hl$/)).toBe(2);
    expect(COUNT(stack, /\tld h, a$/)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// conditions: AND, OR and NOT of comparisons behind a jz / jnz
// ---------------------------------------------------------------------------

type Tree = 'L' | readonly ['not', Tree] | readonly ['and' | 'or', Tree, Tree];
const TREES: readonly Tree[] = [
  'L',
  ['not', 'L'],
  ['and', 'L', 'L'],
  ['or', 'L', 'L'],
  ['not', ['and', 'L', 'L']],
  ['not', ['or', 'L', 'L']],
  ['and', ['or', 'L', 'L'], 'L'],
  ['or', ['and', 'L', 'L'], 'L'],
  ['and', 'L', ['or', 'L', 'L']],
  ['or', 'L', ['and', 'L', ['not', 'L']]],
  ['and', ['and', 'L', 'L'], 'L'],
  ['or', ['or', 'L', 'L'], ['and', 'L', 'L']],
];
const leaves = (t: Tree): number => (t === 'L' ? 1 : t[0] === 'not' ? leaves(t[1]) : leaves(t[1]) + leaves(t[2]));
function truth(t: Tree, v: boolean[]): boolean {
  let i = 0;
  const go = (n: Tree): boolean => {
    if (n === 'L') return v[i++] as boolean;
    if (n[0] === 'not') return !go(n[1]);
    const l = go(n[1]);
    const r = go(n[2]);
    return n[0] === 'and' ? l && r : l || r;
  };
  return go(t);
}

describe('conditions are branches, not booleans', () => {
  it('every shape, every truth assignment, jz and jnz: the model, the stack form, and no boolean made', () => {
    const p = new Prog();
    p.globals.push({ label: '_arr', type: 'i16', size: 8 + 2 * 8, init: null, at: null, dims: [7] });
    const expected: [string, bigint][] = [];
    let n = 0;
    for (const tree of TREES) {
      const count = leaves(tree);
      for (let mask = 0; mask < 1 << count; mask++) {
        const values = Array.from({ length: count }, (_, k) => ((mask >> k) & 1) === 1);
        for (const jump of ['jz', 'jnz'] as const) {
          const tag = String(n);
          const kinds = values.map((_, k) => (k + n) % 3); // a global, a u8 temp, an array element
          // an array element is written before the expression (a statement), then read inside it
          kinds.forEach((kind, k) => {
            if (kind === 2) {
              p.b.load('u16', imm(k));
              p.b.astore('i16', p.b.aaddr('i16', addr('_arr'), 1), imm(values[k] ? 2 : 9));
            }
          });
          let leaf = 0;
          const make = (node: Tree): Operand => {
            if (node === 'L') {
              const k = leaf++;
              const v = values[k] ? 2 : 9;
              if (kinds[k] === 0) return p.b.compare('lt', 'i16', global(p.g(`_g${tag}_${k}`, 'i16', v)), imm(5));
              if (kinds[k] === 1) return p.b.compare('lt', 'u8', p.b.load('u8', global(p.g(`_u${tag}_${k}`, 'u8', v))), imm(5));
              p.b.load('u16', imm(k));
              return p.b.compare('lt', 'i16', p.b.aload('i16', p.b.aaddr('i16', addr('_arr'), 1)), imm(5));
            }
            if (node[0] === 'not') return p.b.not('i16', make(node[1]));
            const l = make(node[1]);
            const r = make(node[2]);
            return node[0] === 'and' ? p.b.and('i16', l, r) : p.b.or('i16', l, r);
          };
          const c = make(tree);
          const skip = p.b.newLabel();
          const done = p.b.newLabel();
          p.b[jump]('i16', c, skip);
          p.b.store('u8', global(p.r(`_r${tag}`, 'u8')), imm(1));
          p.b.jump(done);
          p.b.label(skip);
          p.b.store('u8', global(`_r${tag}`), imm(2));
          p.b.label(done);
          const t = truth(tree, values);
          expected.push([`_r${tag}`, jump === 'jz' ? (t ? 1n : 2n) : t ? 2n : 1n]);
          n++;
        }
      }
    }
    const ir = p.program();
    const reg = build(ir, TEMPS_OPTIONS);
    const run = reg.run();
    expect(run.stopped).toBe('rst0');
    expect(expected.filter(([l, v]) => BigInt(readBytes(run, l, 1)[0] as number) !== v).map(([l]) => l)).toEqual([]);
    expect(dump(run, p.results)).toBe(dump(build(ir, undefined).run(), p.results));
    // no comparison made a boolean, and `and` / `or` / `not` of them made none
    expect(COUNT(reg.asm.main, /\tld h, a$/)).toBe(0);
    expect(COUNT(reg.asm.main, /\tcpl$/)).toBe(0);
  });

  it('an operand with a side effect or an error keeps the plain form: a call, a division, a REAL', () => {
    const f = proc('_F', 'FASTCALL', [], 'i16', (() => {
      const pb = new IrBuilder();
      pb.label('_F');
      pb.enter(0);
      // counts its calls, so a skipped call would show
      pb.store('u16', global('_calls'), pb.add('u16', global('_calls'), imm(1)));
      pb.ret('i16', imm(3), '_F__leave');
      pb.label('_F__leave');
      pb.push({ op: 'leave', argBytes: 0, convention: 'FASTCALL', span: null });
      return pb.take();
    })());
    const run = (first: number): { calls: number; taken: number } => {
      const p = new Prog();
      p.g('_calls', 'u16', 0);
      p.g('_one', 'i16', first);
      // IF one < 5 OR F() < 5 THEN ... : the call is the second operand and must run even when the first is true
      const l = p.b.compare('lt', 'i16', global('_one'), imm(5));
      const r = p.b.compare('lt', 'i16', p.b.call('_F', 0, 'i16') as Operand, imm(5));
      const skip = p.b.newLabel();
      p.b.jz('i16', p.b.or('i16', l, r), skip);
      p.b.store('u8', global(p.r('_taken', 'u8')), imm(1));
      p.b.label(skip);
      const ir = p.program([f]);
      const reg = build(ir, TEMPS_OPTIONS);
      const out = reg.run();
      expect(dump(out, p.results)).toBe(dump(build(ir, undefined).run(), p.results));
      // not fused: two booleans and the `or` that combines them (16-bit at the base style; the optimised styles combine 8-bit ones: no `ld h, a`)
      expect(COUNT(reg.asm.main, /\tld h, a$/)).toBe(TEMPS_OPTIONS.style === 'base' ? 3 : 0);
      expect(COUNT(reg.asm.main, /\tor b$/)).toBe(TEMPS_OPTIONS.style === 'base' ? 0 : 1);
      return { calls: readBytes(out, '_calls', 2)[0] as number, taken: readBytes(out, '_taken', 1)[0] as number };
    };
    expect(run(1)).toEqual({ calls: 1, taken: 1 });
    expect(run(9)).toEqual({ calls: 1, taken: 1 });
  });

  it('a division in the second operand (error 11 when it is zero) is never skipped', () => {
    const p = new Prog();
    p.g('_z', 'i16', 0);
    const l = p.b.compare('lt', 'i16', global(p.g('_x', 'i16', 1)), imm(5));
    const r = p.b.compare('lt', 'i16', p.b.div('i16', imm(10), global('_z')), imm(5));
    const skip = p.b.newLabel();
    p.b.jz('i16', p.b.or('i16', l, r), skip);
    p.b.label(skip);
    const reg = build(p.program(), TEMPS_OPTIONS);
    expect(reg.run().printer).toContain('Error 11');
    expect(COUNT(reg.asm.main, /\tld h, a$/)).toBe(TEMPS_OPTIONS.style === 'base' ? 3 : 0);
  });

  it('a REAL comparison is not a branch (no compare-and-branch for it yet) and the tree stays plain', () => {
    const p = new Prog();
    const l = p.b.compare('lt', 'i16', global(p.g('_x', 'i16', 1)), imm(5));
    const r = p.b.compare('lt', 'f', global(p.g('_y', 'f', 2.5)), imm(5));
    const skip = p.b.newLabel();
    p.b.jz('i16', p.b.and('i16', l, r), skip);
    p.b.store('u8', global(p.r('_taken', 'u8')), imm(1));
    p.b.label(skip);
    const ir = p.program();
    const out = build(ir, TEMPS_OPTIONS).run();
    expect(readBytes(out, '_taken', 1)).toEqual([1]);
  });
});

// ---------------------------------------------------------------------------
// jz, jnz on a value in the registers
// ---------------------------------------------------------------------------

describe('jz and jnz take the value from the result registers', () => {
  const VALS: Record<string, (number | bigint)[]> = {
    u8: [0, 1, 128, 255],
    i8: [0, 1, -1, -128],
    u16: [0, 1, 256, 65535],
    i16: [0, 1, -1, 32767],
    u32: [0, 1, 65536, 0x80000000, 0xffffffff],
    i32: [0, 1, -1, 65536, -0x80000000],
    f: [0, 1, -2.5, 0.001],
    f16: [0, 1, -2.5, 0.5],
  };
  for (const [t, values] of Object.entries(VALS)) {
    it(`${t}: a loaded value tested by jz and by jnz`, () => {
      const p = new Prog();
      const expected: [string, number][] = [];
      let i = 0;
      for (const v of values) {
        for (const jump of ['jz', 'jnz'] as const) {
          const x = p.b.load(t as IrType, global(p.g(`_v${i}`, t as IrType, v)));
          const skip = p.b.newLabel();
          p.b[jump](t as IrType, x, skip);
          p.b.store('u8', global(p.r(`_r${i}`, 'u8')), imm(1));
          p.b.label(skip);
          const zero = Number(v) === 0;
          expected.push([`_r${i}`, (jump === 'jz') === zero ? 0xaa : 1]);
          i++;
        }
      }
      const ir = p.program();
      const reg = build(ir, TEMPS_OPTIONS);
      const run = reg.run();
      expect(run.stopped).toBe('rst0');
      expect(expected.filter(([l, v]) => readBytes(run, l, 1)[0] !== v).map(([l]) => l)).toEqual([]);
      // each value is loaded straight into the registers the test reads: no push, no pop
      expect(COUNT(reg.asm.main, /\t(push|pop) (hl|af|de|bc)$/)).toBe(0);
    });
  }

  it('a comparison feeding a jump with cmpjump off: the i16 boolean is tested from HL', () => {
    const p = new Prog();
    const A = p.b.load('u8', global(p.g('_a', 'u8', 200)));
    const c = p.b.compare('gt', 'u8', A, imm(100));
    const skip = p.b.newLabel();
    p.b.jnz('i16', c, skip);
    p.b.store('u8', global(p.r('_bad', 'u8')), imm(1));
    p.b.label(skip);
    const built = build(p.program(), NO_CMPJUMP);
    const run = built.run();
    expect(readBytes(run, '_bad', 1)).toEqual([0xaa]);
    expect(COUNT(built.asm.main, /\tpush hl$/)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// call, ret, fparam
// ---------------------------------------------------------------------------

function proc(label: string, convention: 'STDCALL' | 'FASTCALL', params: IrProcedure['params'], ret: IrType | null, body: Quad[]): IrProcedure {
  return { label, convention, params, ret, body };
}

describe('call, ret and fparam', () => {
  const VAL: Record<string, number | bigint> = { u8: 200, i8: -100, u16: 54321, i16: -12345, u32: 0xdeadbeef, i32: -123456789, f: -123.5, f16: 12.25 };
  for (const [t, v] of Object.entries(VAL)) {
    for (const convention of ['FASTCALL', 'STDCALL'] as const) {
      it(`a ${convention} function returning ${t}: the value stays in the result registers from ret to the caller's store`, () => {
        const type = t as IrType;
        const pb = new IrBuilder();
        pb.label('_F');
        pb.enter(0);
        // the result is a computation, so `ret` takes it from the registers
        const x = pb.load(type, global('_in'));
        pb.ret(type, x, '_F__leave');
        pb.label('_F__leave');
        pb.push({ op: 'leave', argBytes: 0, convention, span: null });
        const f = proc('_F', convention, [], type, pb.take());
        const p = new Prog();
        p.g('_in', type, v);
        const r = p.b.call('_F', 0, type) as Operand;
        p.b.store(type, global(p.r('_out', type)), r);
        const ir = p.program([f]);
        const reg = build(ir, TEMPS_OPTIONS);
        const run = reg.run();
        expect(run.stopped).toBe('rst0');
        expect(readBytes(run, '_out', SIZE[t] as number)).toEqual(bytesOf(type, v));
        expect(dump(run, p.results)).toBe(dump(build(ir, undefined).run(), p.results));
        // the caller's `call` is followed by the store, with no push between; the callee loads and returns without one
        expect(COUNT(reg.asm.main, /\tpush /)).toBe(0);
        expect(COUNT(reg.asm.procedures, /\tpush (hl|af|de|bc)$/)).toBe(0);
      });
    }
  }

  const ABS: [string, string, (number | bigint)[]][] = [
    ['u8', '.core.__ABS8', [0, 7, 100]],
    ['i8', '.core.__ABS8', [-5, 5, -127]],
    ['u16', '.core.__ABS16', [0, 1234, 30000]],
    ['i16', '.core.__ABS16', [-1234, 1234, -32767]],
    ['u32', '.core.__ABS32', [0, 70000, 0x7fffffff]],
    ['i32', '.core.__ABS32', [-70000, 70000, -0x7fffffff]],
    ['f', '.core.__LOCO_ABSF', [-2.5, 2.5, 100]],
    ['f16', '.core.__ABS32', [-2.5, 2.5, 100]],
  ];
  for (const [t, routine, values] of ABS) {
    it(`fparam:${t} hands a loaded value to ${routine} in the registers`, () => {
      const type = t as IrType;
      const p = new Prog();
      values.forEach((v, i) => {
        p.b.fparam(type, p.b.load(type, global(p.g(`_v${i}`, type, v))));
        const r = p.b.rtcall(routine, type) as Operand;
        p.b.store(type, global(p.r(`_r${i}`, type)), r);
      });
      const ir = p.program();
      const reg = build(ir, TEMPS_OPTIONS);
      const run = reg.run();
      expect(run.stopped).toBe('rst0');
      expect(dump(run, p.results)).toBe(dump(build(ir, undefined).run(), p.results));
      values.forEach((v, i) => {
        const want = type === 'f' || type === 'f16' ? Math.abs(v as number) : BigInt(v) < 0n ? -BigInt(v) : BigInt(v);
        expect(readBytes(run, `_r${i}`, SIZE[t] as number)).toEqual(bytesOf(type, want));
      });
      expect(COUNT(reg.asm.main, /\t(push|pop) /)).toBe(0);
    });
  }

  it('PEEK of a REAL and of a FIXED through an address in HL', () => {
    const p = new Prog();
    p.g('_f', 'f', -7.25);
    p.g('_x', 'f16', 3.75);
    const pf = p.b.peek('f', p.b.load('u16', addr('_f')));
    p.b.store('f', global(p.r('_rf', 'f')), pf);
    const px = p.b.peek('f16', p.b.load('u16', addr('_x')));
    p.b.store('f16', global(p.r('_rx', 'f16')), px);
    const reg = build(p.program(), TEMPS_OPTIONS);
    const run = reg.run();
    expect(readBytes(run, '_rf', 5)).toEqual(bytesOf('f', -7.25));
    expect(readBytes(run, '_rx', 4)).toEqual(bytesOf('f16', 3.75));
    expect(COUNT(reg.asm.main, /\t(push|pop) /)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// strings
// ---------------------------------------------------------------------------

describe('strings stay in HL between their producer and consumer', () => {
  const STRINGS = ['abc', 'abd', 'ab', '', 'abcabd', 'b'];
  const CMPOPS = ['eq', 'ne', 'lt', 'le', 'gt', 'ge'] as const;
  const MODEL: Record<(typeof CMPOPS)[number], (x: string, y: string) => boolean> = {
    eq: (x, y) => x === y,
    ne: (x, y) => x !== y,
    lt: (x, y) => x < y,
    le: (x, y) => x <= y,
    gt: (x, y) => x > y,
    ge: (x, y) => x >= y,
  };

  it('compare, concat and store of owned temps and constants, every operand order, against a model', () => {
    const p = new Prog();
    p.globals.push(glob('_s', 'str'));
    const expected: [string, bigint][] = [];
    let n = 0;
    STRINGS.forEach((x, i) => {
      STRINGS.forEach((y, j) => {
        for (const op of CMPOPS) {
          // 0: two owned copies (the second adjacent); 1: owned copy against a constant; 2: a constant against an owned copy
          const form = n % 3;
          const a = form === 2 ? strconst(i) : p.b.load('str', strconst(i));
          const b = form === 1 ? strconst(j) : p.b.load('str', strconst(j));
          p.b.store('i16', global(p.r(`_c${n}`, 'i16')), p.b.compare(op, 'str', a, b));
          expected.push([`_c${n}`, MODEL[op](x, y) ? -1n : 0n]);
          n++;
        }
        // concat, then compare the result (an owned temp in HL) with the constant of the same text
        const joined = p.b.concat(p.b.load('str', strconst(i)), p.b.load('str', strconst(j)));
        const k = STRINGS.indexOf(x + y);
        if (k >= 0) {
          p.b.store('i16', global(p.r(`_j${n}`, 'i16')), p.b.compare('eq', 'str', joined, strconst(k)));
          expected.push([`_j${n}`, -1n]);
        } else {
          p.b.store('str', global('_s'), joined);
        }
        n++;
      });
    });
    const ir = p.program([], STRINGS);
    const reg = build(ir, TEMPS_OPTIONS);
    const run = reg.run();
    expect(run.stopped).toBe('rst0');
    expect(expected.filter(([l, v]) => BigInt.asIntN(16, BigInt(readBytes(run, l, 2)[0] as number | 0) | (BigInt(readBytes(run, l, 2)[1] as number) << 8n)) !== v).map(([l]) => l)).toEqual([]);
    const stack = build(ir, undefined);
    expect(dump(run, p.results)).toBe(dump(stack.run(), p.results));
    expect(COUNT(reg.asm.main, /\t(push|pop) hl$/)).toBeLessThan(COUNT(stack.asm.main, /\t(push|pop) hl$/));
  });
});

describe('ON ... GOTO takes its index from HL', () => {
  it('selects by the loaded index, and falls through when out of range', () => {
    const p = new Prog();
    const expected: [string, number][] = [];
    [0, 1, 2, 3, 65535].forEach((idx, i) => {
      const l1 = p.b.newLabel();
      const l2 = p.b.newLabel();
      const end = p.b.newLabel();
      p.b.jtable(p.b.load('u16', global(p.g(`_i${i}`, 'u16', idx))), [l1, l2]);
      p.b.store('u8', global(p.r(`_r${i}`, 'u8')), imm(1));
      p.b.jump(end);
      p.b.label(l1);
      p.b.store('u8', global(`_r${i}`), imm(11));
      p.b.jump(end);
      p.b.label(l2);
      p.b.store('u8', global(`_r${i}`), imm(22));
      p.b.label(end);
      expected.push([`_r${i}`, idx === 1 ? 11 : idx === 2 ? 22 : 1]);
    });
    const reg = build(p.program(), TEMPS_OPTIONS);
    const run = reg.run();
    expect(expected.filter(([l, v]) => readBytes(run, l, 1)[0] !== v).map(([l]) => l)).toEqual([]);
    // the index is not pushed and popped: the one `push hl` of each ON is the table address __ON_GOTO takes
    expect(COUNT(reg.asm.main, /\t(push|pop) hl$/)).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// the driver's decisions
// ---------------------------------------------------------------------------

describe('which quads hand their temp over', () => {
  it('only the quad right before the consumer, and only for the operand the consumer pops first', () => {
    const p = new Prog();
    // a = load x; b = load y; add a, b: b is adjacent (in HL), a is on the stack
    const a = p.b.load('u16', global(p.g('_x', 'u16', 1000)));
    const b = p.b.load('u16', global(p.g('_y', 'u16', 234)));
    p.b.store('u16', global(p.r('_s', 'u16')), p.b.add('u16', a, b));
    const reg = build(p.program(), TEMPS_OPTIONS);
    const body = reg.asm.main.slice(reg.asm.main.indexOf('\tld hl, (_x)'));
    expect(body.slice(0, 6)).toEqual(['\tld hl, (_x)', '\tpush hl', '\tld hl, (_y)', '\tex de, hl', '\tpop hl', '\tadd hl, de']);
    expect(body[6]).toBe('\tld (_s), hl');
    expect(readBytes(reg.run(), '_s', 2)).toEqual([0xd2, 0x04]);
  });

  it('a comment between the two quads keeps the stack form', () => {
    const p = new Prog();
    const x = p.b.load('u16', global(p.g('_x', 'u16', 5)));
    p.b.push({ op: 'comment', text: 'between', span: null });
    p.b.store('u16', global(p.r('_s', 'u16')), x);
    const reg = build(p.program(), TEMPS_OPTIONS);
    expect(COUNT(reg.asm.main, /\tpush hl$/)).toBe(1);
    expect(readBytes(reg.run(), '_s', 2)).toEqual([5, 0]);
  });

  it('--opt-disable temps (registerTemps off) emits the stack form', () => {
    const p = new Prog();
    const x = p.b.load('u16', global(p.g('_x', 'u16', 5)));
    p.b.store('u16', global(p.r('_s', 'u16')), x);
    const off = build(p.program(), { ...TEMPS_OPTIONS, registerTemps: false });
    expect(COUNT(off.asm.main, /\tpush hl$/)).toBe(1);
  });
});
