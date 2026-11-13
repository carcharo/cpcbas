/**
 * L3-ARR-CG: `aaddr`, `aload`, `astore` and the memory-operand `load`/`store` of a constant-index
 * array element, generated through the real generate + link path from hand-built IR, assembled
 * over lib/runtime and executed on the test Z80 (test/z80sim). Expected bytes come from
 * `ir/arrays.ts` (`arrayLayout`, `elementOffset`) and from each type's memory format, not from the
 * generated code.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DiagnosticBag } from '../core/diagnostics.js';
import { SourceSet } from '../core/source.js';
import { addr, frame, frameaddr, global, imm, IrBuilder, strconst } from '../ir/builder.js';
import { arrayLabels, arrayLayout, elementOffset } from '../ir/arrays.js';
import type { IrGlobal, IrProgram, IrString, IrType, Operand, Quad } from '../ir/ir.js';
import { irSize } from '../sem/types.js';
import { verifyIr } from '../ir/verify.js';
import { assembleAndRun, type AssembledRun } from '../../test/z80sim/run.js';
import { encodeReal5 } from './data.js';
import { tempsForms, tempsOpt } from '../../test/temps-env.js';
import { generateWith } from './generate.js';
import { link, makeTarget, TEMPLATES } from './index.js';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));

function walk(dir: string, prefix: string, into: Map<string, string>): void {
  for (const name of readdirSync(dir).sort()) {
    const full = `${dir}/${name}`;
    if (statSync(full).isDirectory()) walk(full, `${prefix}${name}/`, into);
    else if (name.endsWith('.asm')) into.set(`${prefix}${name}`, readFileSync(full, 'latin1'));
  }
}
const TREE = new Map<string, string>();
walk(`${REPO}lib/runtime`, 'runtime/', TREE);
walk(`${REPO}lib/loco`, 'loco/', TREE);
const LOCO_FILES: Record<string, string> = {};
for (const [k, v] of TREE) if (k.startsWith('loco/')) LOCO_FILES[k] = v;

interface Exec {
  quads: Quad[];
  globals: IrGlobal[];
  strings?: IrString[];
}

function build(e: Exec): { text: string; heap: boolean; run: () => AssembledRun } {
  const end: Quad = { op: 'end', a: imm(0), span: null };
  const ir: IrProgram = { main: [...e.quads, end], procedures: [], globals: e.globals, strings: e.strings ?? [], data: [], requires: [], inits: [] };
  expect(verifyIr(ir)).toEqual([]);
  const target = makeTarget({});
  const diagnostics = new DiagnosticBag();
  const generated = generateWith({ ir, target, diagnostics, ...tempsOpt() }, TEMPLATES, ...tempsForms());
  expect(diagnostics.all().map((d) => d.message)).toEqual([]);
  const linked = link({ asm: generated, target, runtime: TREE, sources: new SourceSet(), diagnostics });
  expect(diagnostics.all().map((d) => d.message)).toEqual([]);
  const defines = { ...Object.fromEntries(target.asmDefines), __CPC_PRINTER_ECHO__: '1' };
  return { text: linked.text, heap: linked.heapInUse, run: () => assembleAndRun(linked.text, { defines, files: LOCO_FILES, maxTStates: 400_000_000 }) };
}
const exec = (e: Exec): AssembledRun => build(e).run();

const word = (run: AssembledRun, a: number): number => run.memory[a] | (run.memory[a + 1] << 8);
const FRAME: IrGlobal = { label: '_fr', type: 'u8', size: 288, init: null, at: null, dims: [] };

function heapFree(run: AssembledRun): number {
  const heap = run.image.addr('.core.ZXBASIC_MEM_HEAP');
  let total = 0;
  let p = word(run, heap + 2);
  let guard = 0;
  while (p !== 0 && guard++ < 10000) {
    total += word(run, p);
    p = word(run, p + 2);
  }
  return total;
}

function arrayGlobal(label: string, type: IrType, uppers: readonly number[], extra: Partial<IrGlobal> = {}): IrGlobal {
  const layout = arrayLayout(uppers, type);
  return { label, type, size: 8 + layout.dataBytes, init: null, at: null, dims: layout.counts, ...extra };
}

// ---------- values of each type ----------

const NUMERIC: readonly IrType[] = ['u8', 'i8', 'u16', 'i16', 'u32', 'i32', 'f16', 'f'];

/** A value for element number `n` of type `t`: the JS number the IR holds, and its memory bytes. */
function sample(t: IrType, n: number): { value: number; bytes: number[] } {
  const le = (v: bigint, size: number): number[] => Array.from({ length: size }, (_, i) => Number((v >> BigInt(8 * i)) & 0xffn));
  switch (t) {
    case 'u8':
      return { value: (n * 37 + 11) & 0xff, bytes: [(n * 37 + 11) & 0xff] };
    case 'i8': {
      const v = ((n * 37 + 11) & 0xff) - 128;
      return { value: v, bytes: le(BigInt(v), 1) };
    }
    case 'u16': {
      const v = (n * 4099 + 777) & 0xffff;
      return { value: v, bytes: le(BigInt(v), 2) };
    }
    case 'i16': {
      const v = ((n * 4099 + 777) & 0xffff) - 32768;
      return { value: v, bytes: le(BigInt(v), 2) };
    }
    case 'u32': {
      const v = (n * 268435399 + 12345) >>> 0;
      return { value: v, bytes: le(BigInt(v), 4) };
    }
    case 'i32': {
      const v = ((n * 268435399 + 12345) | 0) - 7;
      return { value: v, bytes: le(BigInt(v), 4) };
    }
    case 'f16': {
      const v = n * 3 - 20 + 0.25;
      return { value: v, bytes: le(BigInt(Math.round(v * 65536)), 4) };
    }
    case 'f': {
      const v = (n - 9) * 1.5 + 0.125;
      return { value: v, bytes: encodeReal5(v) };
    }
    default:
      throw new Error(`no sample for ${t}`);
  }
}

/** Every index tuple of an array with these upper bounds, in row-major order. */
function tuples(uppers: readonly number[]): number[][] {
  let out: number[][] = [[]];
  for (const u of uppers) out = out.flatMap((t) => Array.from({ length: u + 1 }, (_, i) => [...t, i]));
  return out;
}

const SHAPES: readonly (readonly number[])[] = [[6], [2, 3], [1, 2, 1], [1, 1, 1, 2]];

describe('aaddr + astore + aload, every numeric type and dimension count', () => {
  for (const t of NUMERIC) {
    for (const uppers of SHAPES) {
      it(`${t} array with upper bounds (${uppers.join(', ')})`, () => {
        const L = arrayLabels('_a');
        const layout = arrayLayout(uppers, t);
        const all = tuples(uppers);
        const size = irSize(t);
        const b = new IrBuilder();
        // write: odd elements through an immediate operand, even ones through a temp (the value on top of the address)
        all.forEach((idx, n) => {
          const { value } = sample(t, n);
          for (const i of idx) b.load('u16', imm(i));
          const a = b.aaddr(t, addr('_a'), idx.length);
          b.astore(t, a, n % 2 === 1 ? imm(value) : b.load(t, imm(value)));
        });
        // read back through computed indexes (from a variable) into a plain buffer
        all.forEach((idx, n) => {
          for (const i of idx) b.load('u16', global('_ix' + i));
          const a = b.aaddr(t, addr('_a'), idx.length);
          const v = b.aload(t, a);
          b.store(t, addr('_res', n * size), v);
        });
        const globals: IrGlobal[] = [
          arrayGlobal('_a', t, uppers),
          { label: '_res', type: 'u8', size: all.length * size, init: null, at: null, dims: [] },
        ];
        // the read-back loop above loads the index from `_ix<i>` globals holding the literal i
        const maxIndex = Math.max(...uppers);
        for (let i = 0; i <= maxIndex; i++) globals.push({ label: `_ix${i}`, type: 'u16', size: 2, init: Uint8Array.from([i, 0]), at: null, dims: [] });
        const run = exec({ quads: b.take(), globals });
        const data = run.image.addr(L.data);
        all.forEach((idx, n) => {
          const off = elementOffset(layout, idx);
          expect(off, `offset of (${idx.join(', ')})`).not.toBeNull();
          const want = sample(t, n).bytes;
          expect([...run.memory.subarray(data + (off as number), data + (off as number) + size)], `element (${idx.join(', ')}) in memory`).toEqual(want);
          const res = run.image.addr('_res') + n * size;
          expect([...run.memory.subarray(res, res + size)], `element (${idx.join(', ')}) read back`).toEqual(want);
        });
      });
    }
  }
});

describe('the three descriptor operand kinds give the same element', () => {
  it('addr, frameaddr and a frame slot holding the descriptor address', () => {
    const uppers = [2, 3];
    const L = arrayLabels('_a');
    const b = new IrBuilder();
    b.push({ op: 'asm', lines: [{ text: '\tld ix, _fr+128', span: { file: 0 as never, start: 0, end: 0 } }], span: null });
    // a descriptor of the same array in the frame (as a local array has) and a slot that points at the global's
    b.store('u16', frame(-40), addr(L.dims));
    b.store('u16', frame(-38), addr(L.data));
    b.store('u16', frame(-36), imm(0));
    b.store('u16', frame(-34), addr(L.ubound));
    b.store('u16', frame(-20), addr('_a'));
    const operands: [string, Operand][] = [
      ['addr', addr('_a')],
      ['frameaddr', frameaddr(-40)],
      ['frame', frame(-20)],
    ];
    operands.forEach(([, array], k) => {
      b.load('u16', imm(2));
      b.load('u16', imm(1));
      const a = b.aaddr('i16', array, 2);
      b.store('u16', global(`_p${k}`), a);
      // and a write through it, read back through the global's own constant-index form
      b.load('u16', imm(k));
      b.load('u16', imm(k + 1));
      const w = b.aaddr('i16', array, 2);
      b.astore('i16', w, imm(1000 + k));
    });
    const globals: IrGlobal[] = [FRAME, arrayGlobal('_a', 'i16', uppers)];
    for (let k = 0; k < 3; k++) globals.push({ label: `_p${k}`, type: 'u16', size: 2, init: null, at: null, dims: [] });
    const run = exec({ quads: b.take(), globals });
    const layout = arrayLayout(uppers, 'i16');
    const want = run.image.addr(L.data) + (elementOffset(layout, [2, 1]) as number);
    expect([word(run, run.image.addr('_p0')), word(run, run.image.addr('_p1')), word(run, run.image.addr('_p2'))]).toEqual([want, want, want]);
    for (let k = 0; k < 3; k++) {
      expect(word(run, run.image.addr(L.data) + (elementOffset(layout, [k, k + 1]) as number))).toBe(1000 + k);
    }
  });
});

describe('string elements', () => {
  const S = (n: number): IrString[] =>
    ['alpha', 'be', '', 'a longer string value'].slice(0, n).map((t, id) => ({ id, label: `.S.${id}`, bytes: Uint8Array.from([...t].map((c) => c.charCodeAt(0))) }));
  const text = (run: AssembledRun, ptr: number): string => {
    if (ptr === 0) return '';
    let s = '';
    for (let i = 0; i < word(run, ptr); i++) s += String.fromCharCode(run.memory[ptr + 2 + i]);
    return s;
  };

  it('stores and reads back strings in a 2-dimension array (constants, variables, temps)', () => {
    const L = arrayLabels('_n');
    const b = new IrBuilder();
    const all = tuples([1, 2]);
    // element n gets constant 0 (n%3==0), a variable copy (n%3==1) or a concatenation temp (n%3==2)
    all.forEach((idx, n) => {
      for (const i of idx) b.load('u16', imm(i));
      const a = b.aaddr('str', addr('_n'), 2);
      if (n % 3 === 0) b.astore('str', a, strconst(0));
      else if (n % 3 === 1) b.astore('str', a, global('_sv'));
      else b.astore('str', a, b.concat(strconst(1), strconst(3)));
    });
    all.forEach((idx, n) => {
      for (const i of idx) b.load('u16', imm(i));
      const a = b.aaddr('str', addr('_n'), 2);
      b.store('str', global(`_r${n}`), b.aload('str', a));
    });
    const globals: IrGlobal[] = [arrayGlobal('_n', 'str', [1, 2]), { label: '_sv', type: 'str', size: 2, init: null, at: null, dims: [] }];
    all.forEach((_, n) => globals.push({ label: `_r${n}`, type: 'str', size: 2, init: null, at: null, dims: [] }));
    const quads = [
      { op: 'store', type: 'str', dst: global('_sv'), a: strconst(1), span: null } as Quad,
      ...b.take(),
    ];
    const run = exec({ quads, globals, strings: S(4) });
    const layout = arrayLayout([1, 2], 'str');
    all.forEach((idx, n) => {
      const want = n % 3 === 0 ? 'alpha' : n % 3 === 1 ? 'be' : 'bea longer string value';
      const el = run.image.addr(L.data) + (elementOffset(layout, idx) as number);
      expect(text(run, word(run, el)), `element (${idx.join(', ')})`).toBe(want);
      expect(text(run, word(run, run.image.addr(`_r${n}`)))).toBe(want);
    });
  });

  it('assigning an element twice frees the first string, with a temp or a constant, and never leaks in a loop', () => {
    const free = (n: number, temp: boolean): number => {
      const b = new IrBuilder();
      for (let k = 0; k < n; k++) {
        b.load('u16', imm(1));
        const a = b.aaddr('str', addr('_n'), 1);
        b.astore('str', a, temp ? b.concat(strconst(0), strconst(1)) : strconst(0));
      }
      return heapFree(exec({ quads: b.take(), globals: [arrayGlobal('_n', 'str', [3])], strings: S(2) }));
    };
    for (const temp of [false, true]) {
      expect(free(300, temp), `temp=${temp}`).toBe(free(2, temp));
      expect(free(1, temp)).toBe(free(2, temp));
    }
    // assigning the empty string frees the old text too
    const emptied = (first: boolean): AssembledRun => {
      const b = new IrBuilder();
      if (first) {
        b.load('u16', imm(0));
        b.astore('str', b.aaddr('str', addr('_n'), 1), strconst(0));
      }
      b.load('u16', imm(0));
      b.astore('str', b.aaddr('str', addr('_n'), 1), imm(0));
      return exec({ quads: b.take(), globals: [arrayGlobal('_n', 'str', [3])], strings: S(2) });
    };
    const run = emptied(true);
    expect(text(run, word(run, run.image.addr('_n.__DATA__')))).toBe('');
    expect(heapFree(run)).toBe(heapFree(emptied(false)));
  });

  it('aload copies: the loaded string is owned and freed by its consumer', () => {
    const free = (n: number): number => {
      const b = new IrBuilder();
      b.load('u16', imm(2));
      b.astore('str', b.aaddr('str', addr('_n'), 1), strconst(0));
      for (let k = 0; k < n; k++) {
        b.load('u16', imm(2));
        const v = b.aload('str', b.aaddr('str', addr('_n'), 1));
        b.store('str', global('_x'), v);
      }
      const globals: IrGlobal[] = [arrayGlobal('_n', 'str', [3]), { label: '_x', type: 'str', size: 2, init: null, at: null, dims: [] }];
      const run = exec({ quads: b.take(), globals, strings: S(1) });
      expect(text(run, word(run, run.image.addr('_x')))).toBe(n > 0 ? 'alpha' : '');
      return heapFree(run);
    };
    expect(free(200)).toBe(free(2));
  });
});

describe('load and store with an addr memory operand (constant-index elements)', () => {
  const read = (run: AssembledRun, label: string, size: number): number[] => [...run.memory.subarray(run.image.addr(label), run.image.addr(label) + size)];

  for (const t of NUMERIC) {
    it(`${t}: store to <label>.__DATA__+offset, load it back`, () => {
      const layout = arrayLayout([4], t);
      const size = irSize(t);
      const b = new IrBuilder();
      const idxs = [0, 3, 4];
      idxs.forEach((i, k) => {
        const off = elementOffset(layout, [i]) as number;
        const { value } = sample(t, k + 2);
        // a store of an immediate, then of a loaded temp, then back out through load
        if (k === 1) b.store(t, addr('_a.__DATA__', off), b.load(t, imm(value)));
        else b.store(t, addr('_a.__DATA__', off), imm(value));
        if (t === 'u16') b.store(t, global(`_r${k}`), b.peek('u16', addr('_a.__DATA__', off)));
        else b.store(t, global(`_r${k}`), b.load(t, addr('_a.__DATA__', off)));
      });
      const globals: IrGlobal[] = [arrayGlobal('_a', t, [4])];
      idxs.forEach((_, k) => globals.push({ label: `_r${k}`, type: t, size, init: null, at: null, dims: [] }));
      const run = exec({ quads: b.take(), globals });
      idxs.forEach((i, k) => {
        const want = sample(t, k + 2).bytes;
        const el = run.image.addr('_a.__DATA__') + (elementOffset(layout, [i]) as number);
        expect([...run.memory.subarray(el, el + size)]).toEqual(want);
        expect(read(run, `_r${k}`, size)).toEqual(want);
      });
      // the untouched elements are still zero
      const untouched = run.image.addr('_a.__DATA__') + size;
      expect([...run.memory.subarray(untouched, untouched + size)]).toEqual(new Array(size).fill(0));
    });
  }

  it('str: store and load through an addr operand', () => {
    const b = new IrBuilder();
    b.store('str', addr('_n.__DATA__', 2), strconst(0));
    b.store('str', addr('_n.__DATA__', 4), b.load('str', addr('_n.__DATA__', 2)));
    b.store('str', addr('_n.__DATA__', 2), strconst(1));
    const strings: IrString[] = ['one', 'two'].map((t, id) => ({ id, label: `.S.${id}`, bytes: Uint8Array.from([...t].map((c) => c.charCodeAt(0))) }));
    const run = exec({ quads: b.take(), globals: [arrayGlobal('_n', 'str', [3])], strings });
    const text = (ptr: number): string => String.fromCharCode(...run.memory.subarray(ptr + 2, ptr + 2 + word(run, ptr)));
    const base = run.image.addr('_n.__DATA__');
    expect(text(word(run, base + 2))).toBe('two');
    expect(text(word(run, base + 4))).toBe('one');
  });

  it('an addr source of a u16 load is still an immediate address (@x)', () => {
    const b = new IrBuilder();
    b.store('u16', global('_p'), addr('_a.__DATA__', 2));
    const run = exec({ quads: b.take(), globals: [arrayGlobal('_a', 'u8', [4]), { label: '_p', type: 'u16', size: 2, init: null, at: null, dims: [] }] });
    expect(word(run, run.image.addr('_p'))).toBe(run.image.addr('_a.__DATA__') + 2);
  });
});

describe('code shape', () => {
  it('a constant-index element needs no __ARRAY', () => {
    const b = new IrBuilder();
    b.store('u8', addr('_a.__DATA__', 1), imm(5));
    const { text } = build({ quads: b.take(), globals: [arrayGlobal('_a', 'u8', [4])] });
    expect(text).not.toContain('__ARRAY');
  });

  it('aaddr links array/array.asm and reverses two indexes for it', () => {
    const b = new IrBuilder();
    b.load('u16', imm(1));
    b.load('u16', imm(2));
    const a = b.aaddr('u8', addr('_a'), 2);
    b.astore('u8', a, imm(1));
    const { text } = build({ quads: b.take(), globals: [arrayGlobal('_a', 'u8', [3, 3])] });
    expect(text).toContain('#include once <array/array.asm>');
    expect(text).toMatch(/pop hl\n\tpop de\n\tpush hl\n\tpush de\n\tld hl, _a\n\tcall \.core\.__ARRAY/);
  });
});
