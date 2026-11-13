/**
 * L5-CG: a condition whose operands cannot be branched (a division here, a FUNCTION call in Lamplighter's PlatInput) is evaluated
 * as 8-bit booleans at the optimised styles: every operand runs, each comparison leaves 0 or -1 in A, a left operand waits as
 * `push af`, `and`/`or` pop it into B, `jz`/`jnz` is `or a / jp`. Every shape of tree, both roots, four comparison kinds and
 * four types run on the simulator against a model; the base style is the control.
 */
import { describe, expect, it } from 'vitest';
import { DiagnosticBag } from '../core/diagnostics.js';
import { SourceSet } from '../core/source.js';
import { global, imm, IrBuilder } from '../ir/builder.js';
import type { CompareOp, IrGlobal, IrProcedure, IrProgram, IrType, Operand, Quad } from '../ir/ir.js';
import { verifyIr } from '../ir/verify.js';
import { libTree } from '../../test/runtime-tree.js';
import { assembleAndRun } from '../../test/z80sim/run.js';
import { generate, link, makeTarget, type AsmProgram, type CodegenOptions } from './index.js';

const TREE = libTree();
const SIZE: Record<string, number> = { u8: 1, i8: 1, u16: 2, i16: 2 };
const OPT = (style: 'base' | 'fast' | 'short'): CodegenOptions => ({ registerTemps: true, style, enabled: () => true, runCodePasses: (u) => u });

type Tree = { readonly k: 'leaf'; readonly i: number } | { readonly k: 'not'; readonly a: Tree } | { readonly k: 'and' | 'or'; readonly a: Tree; readonly b: Tree };
const L = (i: number): Tree => ({ k: 'leaf', i });
const SHAPES: ReadonlyArray<readonly [string, Tree, number]> = [
  ['l0 OR l1', { k: 'or', a: L(0), b: L(1) }, 2],
  ['(l0 OR l1) OR l2', { k: 'or', a: { k: 'or', a: L(0), b: L(1) }, b: L(2) }, 3],
  ['l0 OR (l1 OR l2)', { k: 'or', a: L(0), b: { k: 'or', a: L(1), b: L(2) } }, 3],
  ['l0 AND l1', { k: 'and', a: L(0), b: L(1) }, 2],
  ['(l0 OR l1) AND l2', { k: 'and', a: { k: 'or', a: L(0), b: L(1) }, b: L(2) }, 3],
  ['(l0 AND l1) OR NOT l2', { k: 'or', a: { k: 'and', a: L(0), b: L(1) }, b: { k: 'not', a: L(2) } }, 3],
  ['NOT (l0 OR l1)', { k: 'not', a: { k: 'or', a: L(0), b: L(1) } }, 2],
  ['NOT l0 OR l1', { k: 'or', a: { k: 'not', a: L(0) }, b: L(1) }, 2],
];

type LeafKind = 'ne0' | 'eq0' | 'lt5' | 'gt5';
const KINDS: readonly LeafKind[] = ['ne0', 'eq0', 'lt5', 'gt5'];
const LEAF_OP: Record<LeafKind, CompareOp> = { ne0: 'ne', eq0: 'eq', lt5: 'lt', gt5: 'gt' };
const leafValue = (kind: LeafKind, v: number): boolean => (kind === 'ne0' ? v !== 0 : kind === 'eq0' ? v === 0 : kind === 'lt5' ? v < 5 : v > 5);
const evalTree = (t: Tree, vals: readonly boolean[]): boolean => (t.k === 'leaf' ? (vals[t.i] as boolean) : t.k === 'not' ? !evalTree(t.a, vals) : t.k === 'and' ? evalTree(t.a, vals) && evalTree(t.b, vals) : evalTree(t.a, vals) || evalTree(t.b, vals));

function program(type: IrType, shape: Tree, nLeaves: number, kinds: readonly LeafKind[], values: readonly number[][], root: 'jz' | 'jnz'): { ir: IrProgram; results: string[] } {
  const b = new IrBuilder();
  const globals: IrGlobal[] = [{ label: '_one', type, size: SIZE[type] as number, init: new Uint8Array(SIZE[type] === 2 ? [1, 0] : [1]), at: null, dims: [] }];
  const results: string[] = [];
  const bytes = (v: number): Uint8Array => new Uint8Array(SIZE[type] === 2 ? [v & 255, (v >> 8) & 255] : [v & 255]);
  values.forEach((vs, c) => {
    const leaf = (i: number): Operand => {
      const label = `_v${c}_${i}`;
      globals.push({ label, type, size: SIZE[type] as number, init: bytes(vs[i] as number), at: null, dims: [] });
      // the division makes the operand impure: nothing may be skipped, so the tree is not branched
      const q = b.div(type, global(label), global('_one'));
      return b.compare(LEAF_OP[kinds[i] as LeafKind], type, q, imm(kinds[i] === 'ne0' || kinds[i] === 'eq0' ? 0 : 5));
    };
    const build = (t: Tree): Operand => {
      if (t.k === 'leaf') return leaf(t.i);
      if (t.k === 'not') return b.not('i16', build(t.a));
      const l = build(t.a);
      const r = build(t.b);
      return t.k === 'and' ? b.and('i16', l, r) : b.or('i16', l, r);
    };
    const t = build(shape);
    const skip = b.newLabel();
    const label = `_r${c}`;
    globals.push({ label, type: 'u8', size: 1, init: new Uint8Array([0]), at: null, dims: [] });
    results.push(label);
    if (root === 'jz') b.jz('i16', t, skip);
    else b.jnz('i16', t, skip);
    b.store('u8', global(label), imm(1)); // reached when the jump is not taken
    b.label(skip);
  });
  void nLeaves;
  const end: Quad = { op: 'end', a: imm(0), span: null };
  return { ir: { main: [...b.quads, end], procedures: [], globals, strings: [], data: [], requires: [], inits: [] }, results };
}

function run(ir: IrProgram, opt: CodegenOptions): { asm: AsmProgram; memory: (label: string) => number } {
  expect(verifyIr(ir)).toEqual([]);
  const target = makeTarget({ defines: { __CPC_PRINTER_ECHO__: '1' } });
  const diagnostics = new DiagnosticBag();
  const asm = generate({ ir, target, diagnostics, opt });
  expect(diagnostics.all().map((d) => d.message)).toEqual([]);
  const linked = link({ asm, target, runtime: TREE, sources: new SourceSet(), diagnostics });
  const r = assembleAndRun(linked.text, { defines: target.asmDefines, maxTStates: 50_000_000 });
  expect(r.stopped).toBe('rst0');
  return { asm, memory: (label) => r.memory[r.image.addr(label)] as number };
}

const VALUES: Record<string, readonly number[]> = { u8: [0, 3, 9, 200], i8: [0, 3, 9, -3], u16: [0, 3, 9, 300], i16: [0, 3, 9, -300] };

describe('conditions with an operand that cannot be branched are 8-bit booleans (L5-CG)', () => {
  for (const type of ['u8', 'i8', 'u16', 'i16'] as const) {
    for (const [name, shape, n] of SHAPES) {
      for (const root of ['jz', 'jnz'] as const) {
        it(`${type}: ${name} behind ${root}, every combination of operand values`, () => {
          const kindSets: LeafKind[][] = [KINDS.slice(0, 3), ['ne0', 'ne0', 'ne0'], ['eq0', 'gt5', 'ne0'], ['lt5', 'ne0', 'eq0']].map((k) => k.slice(0, n) as LeafKind[]);
          for (const kinds of kindSets) {
            const combos: number[][] = [];
            const vals = VALUES[type] as readonly number[];
            for (let c = 0; c < vals.length ** n; c++) combos.push(Array.from({ length: n }, (_, i) => vals[Math.floor(c / vals.length ** i) % vals.length] as number));
            const { ir, results } = program(type, shape, n, kinds, combos, root);
            for (const style of ['base', 'fast', 'short'] as const) {
              const { asm, memory } = run(ir, OPT(style));
              combos.forEach((vs, c) => {
                const truth = evalTree(shape, vs.map((v, i) => leafValue(kinds[i] as LeafKind, v)));
                // the store runs when the jump is not taken: jz falls through on true, jnz on false
                const expected = root === 'jz' ? truth : !truth;
                expect(memory(results[c] as string), `${style} ${kinds.join(',')} values ${vs.join(',')}`).toBe(expected ? 1 : 0);
              });
              const text = asm.main.join('\n');
              if (style === 'base') expect(text).not.toContain('\tpush af\n\tld a, '); // the 16-bit booleans' form is unchanged
              else {
                expect(text.match(/\tld h, a\n\tld l, a/g) ?? []).toEqual([]); // no 16-bit boolean is made
                if (name !== 'NOT l0 OR l1' && n > 1) expect(text).toMatch(/\tpop bc\n\t(and|or) b\n/);
              }
            }
          }
        });
      }
    }
  }

  it('an OR chain of `<> 0` tests ORs the raw values: no -1/0 is made per term, one `or a` before the jump', () => {
    const { ir } = program('u8', SHAPES[1]?.[1] as Tree, 3, ['ne0', 'ne0', 'ne0'], [[0, 3, 0]], 'jz');
    const text = run(ir, OPT('fast')).asm.main.join('\n');
    expect(text).not.toContain('sbc a, a');
    expect(text.match(/\tor b\n/g)).toHaveLength(2);
  });

  it('Lamplighter\'s shape: FUNCTION calls with arguments under an OR chain are all called, and the chain is 8-bit', () => {
    // _K(k) AS UBYTE: counts its calls and returns k
    const pb = new IrBuilder();
    pb.label('_K');
    pb.enter(0);
    pb.store('u16', global('_calls'), pb.add('u16', global('_calls'), imm(1)));
    pb.ret('u8', pb.load('u8', { k: 'frame', offset: 5 } as Operand), '_K__leave');
    pb.label('_K__leave');
    pb.push({ op: 'leave', argBytes: 2, convention: 'STDCALL', span: null });
    const k: IrProcedure = { label: '_K', convention: 'STDCALL', params: [{ type: 'u8', offset: 5, byref: false }], ret: 'u8', body: pb.take() };
    const results: string[] = [];
    const globals: IrGlobal[] = [{ label: '_calls', type: 'u16', size: 2, init: new Uint8Array([0, 0]), at: null, dims: [] }];
    const b = new IrBuilder();
    const inputs = [[0, 0, 0], [0, 7, 0], [4, 0, 0], [0, 0, 1], [1, 2, 3]];
    inputs.forEach((vs, c) => {
      const term = (v: number): Operand => {
        b.param('u8', imm(v));
        return b.compare('ne', 'u8', b.call('_K', 2, 'u8') as Operand, imm(0));
      };
      const first = term(vs[0] as number);
      const second = term(vs[1] as number);
      const t01 = b.or('i16', first, second);
      const t = b.or('i16', t01, term(vs[2] as number));
      const skip = b.newLabel();
      globals.push({ label: `_r${c}`, type: 'u8', size: 1, init: new Uint8Array([0]), at: null, dims: [] });
      results.push(`_r${c}`);
      b.jz('i16', t, skip);
      b.store('u8', global(`_r${c}`), imm(1));
      b.label(skip);
    });
    const end: Quad = { op: 'end', a: imm(0), span: null };
    const ir: IrProgram = { main: [...b.quads, end], procedures: [k], globals, strings: [], data: [], requires: [], inits: [] };
    const sizes: Record<string, number> = {};
    for (const style of ['base', 'fast', 'short'] as const) {
      const { asm, memory } = run(ir, OPT(style));
      results.forEach((r, c) => expect(memory(r), `${style} input ${c}`).toBe(inputs[c]?.some((v) => v !== 0) ? 1 : 0));
      expect(memory('_calls')).toBe(3 * inputs.length);
      sizes[style] = asm.main.length;
    }
    expect(sizes['fast']).toBeLessThan((sizes['base'] as number) * 0.7);
  });
});
