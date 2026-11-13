/**
 * L2-CG-STR: every string template and built-in is generated through the real generate + link
 * path, assembled over lib/runtime and lib/loco and executed on the test Z80 (test/z80sim).
 * Results are read from memory and compared with a JavaScript model; ownership is checked by
 * walking the heap's free list after loops of many operations.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DiagnosticBag, InternalError } from '../core/diagnostics.js';
import { SourceSet } from '../core/source.js';
import { addr, frame, global, imm, IrBuilder, strconst } from '../ir/builder.js';
import type { IrGlobal, IrProcedure, IrProgram, IrString, IrType, Operand, Quad } from '../ir/ir.js';
import { lowerStringBuiltin } from '../ir/lower/strings.js';
import { verifyIr } from '../ir/verify.js';
import { assembleAndRun, type AssembledRun } from '../../test/z80sim/run.js';
import type { RunOptions } from '../../test/z80sim/run.js';
import { tempsForms, tempsOpt } from '../../test/temps-env.js';
import { generateWith } from './generate.js';
import { link, makeTarget, TEMPLATES } from './index.js';
import { STR_TEMPLATES } from './str.js';

// ---------- harness ----------

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));

function walk(dir: string, prefix: string, into: Map<string, string>): void {
  for (const name of readdirSync(dir).sort()) {
    const full = `${dir}/${name}`;
    if (statSync(full).isDirectory()) walk(full, `${prefix}${name}/`, into);
    else if (name.endsWith('.asm')) into.set(`${prefix}${name}`, readFileSync(full, 'latin1'));
  }
}
/** The link step's runtime tree: `runtime/<name>` for the imported files, `loco/<name>` for ours. */
const TREE = new Map<string, string>();
walk(`${REPO}lib/runtime`, 'runtime/', TREE);
walk(`${REPO}lib/loco`, 'loco/', TREE);
/** The same loco files for the assembler's include lookup. */
const LOCO_FILES: Record<string, string> = {};
for (const [k, v] of TREE) if (k.startsWith('loco/')) LOCO_FILES[k] = v;

interface Exec {
  quads: Quad[];
  globals: IrGlobal[];
  strings: IrString[];
  procedures?: IrProcedure[];
  requires?: string[];
  verify?: boolean;
  run?: RunOptions;
}

function exec(e: Exec): AssembledRun {
  const end: Quad = { op: 'end', a: imm(0), span: null };
  const ir: IrProgram = {
    main: [...e.quads, end],
    procedures: e.procedures ?? [],
    globals: e.globals,
    strings: e.strings,
    data: [],
    requires: e.requires ?? [],
    inits: [],
  };
  if (e.verify !== false) expect(verifyIr(ir)).toEqual([]);
  const target = makeTarget({});
  const diagnostics = new DiagnosticBag();
  const generated = generateWith({ ir, target, diagnostics, ...tempsOpt() }, TEMPLATES, ...tempsForms());
  expect(diagnostics.all().map((d) => d.message)).toEqual([]);
  const linked = link({ asm: generated, target, runtime: TREE, sources: new SourceSet(), diagnostics });
  expect(diagnostics.all().map((d) => d.message)).toEqual([]);
  expect(linked.heapInUse).toBe(true);
  const defines = { ...Object.fromEntries(target.asmDefines), __CPC_PRINTER_ECHO__: '1' };
  return assembleAndRun(linked.text, { defines, files: LOCO_FILES, maxTStates: 400_000_000, ...e.run });
}

const word = (run: AssembledRun, a: number): number => run.memory[a] | (run.memory[a + 1] << 8);

/** The text of the string at `ptr` (0 is the empty string). */
function readStr(run: AssembledRun, ptr: number): string {
  if (ptr === 0) return '';
  const n = word(run, ptr);
  let s = '';
  for (let i = 0; i < n; i++) s += String.fromCharCode(run.memory[ptr + 2 + i]);
  return s;
}
const strAt = (run: AssembledRun, label: string): string => readStr(run, run.wordAt(label));

/** Bytes free on the heap: the sum of the free list's blocks (header at the heap start, then size/next pairs). */
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

/** A program under construction. Slots: IX = _fr + 128; frame strings live at ix-24.., BYREF pointers at ix+16... */
class P {
  readonly b = new IrBuilder();
  readonly globals: IrGlobal[] = [{ label: '_fr', type: 'u8', size: 288, init: null, at: null, dims: [] }];
  readonly strings: IrString[] = [];
  private n = 0;
  private slot = 0;
  constructor() {
    this.b.push({ op: 'asm', lines: [{ text: '\tld ix, _fr+128', span: { file: 0 as never, start: 0, end: 0 } }], span: null });
  }
  private fresh(prefix: string): string {
    return `${prefix}${this.n++}`;
  }
  /** A string constant operand. */
  const(text: string): Operand {
    const id = this.strings.length;
    this.strings.push({ id, label: `.S.${id}`, bytes: Uint8Array.from([...text].map((c) => c.charCodeAt(0))) });
    return strconst(id);
  }
  /** A global string variable, 0 (empty) until stored. */
  svar(): string {
    const label = this.fresh('_s');
    this.globals.push({ label, type: 'str', size: 2, init: null, at: null, dims: [] });
    return label;
  }
  /** A global of `type` with the little-endian `bytes` as its initial value. */
  gvar(type: IrType, bytes: number[]): Operand {
    const label = this.fresh('_g');
    this.globals.push({ label, type, size: bytes.length, init: Uint8Array.from(bytes), at: null, dims: [] });
    return global(label);
  }
  /** An INTEGER global holding `v`. */
  ivar(v: number, type: IrType = 'i16'): Operand {
    const label = this.fresh('_i');
    this.globals.push({ label, type, size: 2, init: Uint8Array.from([v & 0xff, (v >> 8) & 0xff]), at: null, dims: [] });
    return global(label);
  }
  /** A string operand of `kind` holding `text`. */
  str(kind: SKind, text: string): Operand {
    switch (kind) {
      case 'const':
        return this.const(text);
      case 'global': {
        const g = this.svar();
        this.b.store('str', global(g), this.const(text));
        return global(g);
      }
      case 'frame': {
        const off = -8 - 2 * this.slot++;
        this.b.store('str', frame(off), this.const(text));
        return frame(off);
      }
      case 'byref': {
        const g = this.svar();
        this.b.store('str', global(g), this.const(text));
        const off = 16 + 2 * this.slot++;
        this.b.store('u16', frame(off), addr(g));
        return frame(off, true);
      }
      case 'temp':
        return this.b.load('str', this.const(text));
    }
  }
  /** An INTEGER operand of `kind` holding `v`. */
  int(kind: 'imm' | 'global' | 'temp', v: number): Operand {
    if (kind === 'imm') return imm(v);
    const g = this.ivar(v);
    return kind === 'global' ? g : this.b.load('i16', g);
  }
  /** Stores the string temp `t` in a new global (taking it) and returns the label. */
  keep(t: Operand): string {
    const g = this.svar();
    this.b.store('str', global(g), t);
    return g;
  }
  /** Stores a numeric temp in a new global of `type` and returns the label. */
  keepNum(t: Operand, type: IrType): string {
    const label = this.fresh('_n');
    this.globals.push({ label, type, size: 4, init: null, at: null, dims: [] });
    this.b.store(type, global(label), t);
    return label;
  }
  builtin(name: Parameters<typeof lowerStringBuiltin>[1], args: Operand[]): Operand {
    return lowerStringBuiltin(this.b, name, args);
  }
  exec(extra: Partial<Exec> = {}): AssembledRun {
    return exec({ quads: this.b.quads, globals: this.globals, strings: this.strings, ...extra });
  }
}

type SKind = 'const' | 'global' | 'frame' | 'byref' | 'temp';
const SKINDS: readonly SKind[] = ['const', 'global', 'frame', 'byref', 'temp'];

/** Runs `cases` in batches (the heap is small); each case builds quads and returns how to read its result. */
interface Case {
  desc: string;
  /** Appends the quads; returns the label of the global holding the result and its kind. */
  build: (p: P) => { label: string; num?: IrType };
  expect: string | number;
}

function runCases(cases: Case[], batch = 30): void {
  for (let from = 0; from < cases.length; from += batch) {
    const part = cases.slice(from, from + batch);
    const p = new P();
    const outs = part.map((c) => c.build(p));
    const run = p.exec();
    expect(run.stopped).toBe('rst0');
    const bad: string[] = [];
    part.forEach((c, i) => {
      const o = outs[i];
      const got: string | number = o.num === undefined ? strAt(run, o.label) : readNum(run, o.num, o.label);
      if (got !== c.expect) bad.push(`${c.desc}: got ${JSON.stringify(got).slice(0, 60)}, expected ${JSON.stringify(c.expect)}`);
    });
    expect(bad).toEqual([]);
  }
}

function readNum(run: AssembledRun, t: IrType, label: string): number {
  const a = run.image.addr(label);
  const size = t === 'u8' || t === 'i8' ? 1 : t === 'u16' || t === 'i16' ? 2 : 4;
  let v = 0;
  for (let i = size - 1; i >= 0; i--) v = v * 256 + run.memory[a + i];
  if (t === 'i8' && v > 127) v -= 256;
  if (t === 'i16' && v > 32767) v -= 65536;
  if (t === 'i32' && v > 2147483647) v -= 4294967296;
  return v;
}

// ---------- the models (Locomotive semantics) ----------

const LEFT = (s: string, n: number): string => s.slice(0, n);
const RIGHT = (s: string, n: number): string => (n === 0 ? '' : s.slice(Math.max(0, s.length - n)));
const MID = (s: string, p: number, n?: number): string => (n === undefined ? s.slice(p - 1) : s.slice(p - 1, p - 1 + n));
// Measured (loco-measured.md 2026-11-08): an empty needle is found only while start <= LEN(a$), so INSTR("","") is 0.
const INSTR = (start: number, a: string, b: string): number => (start > a.length ? 0 : a.indexOf(b, start - 1) + 1);

const STRINGS = ['', 'a', 'Hello', 'Hello World'];
const INT_KINDS = ['imm', 'global', 'temp'] as const;

// ---------- load, store, concat ----------

describe('concat on the simulator', () => {
  const texts: [string, string][] = [['', ''], ['ab', ''], ['', 'cd'], ['abc', 'de']];
  it('every pair of operand kinds, with empty operands', () => {
    const cases: Case[] = [];
    for (const ka of SKINDS) {
      for (const kb of SKINDS) {
        for (const [a, b] of texts) {
          cases.push({
            desc: `${JSON.stringify(a)}[${ka}] + ${JSON.stringify(b)}[${kb}]`,
            build: (p) => {
              const A = p.str(ka, a);
              const B = p.str(kb, b);
              return { label: p.keep(p.b.concat(A, B)) };
            },
            expect: a + b,
          });
        }
      }
    }
    runCases(cases, 25);
  });

  it('a chain of concatenations frees every temp and leaves the variables intact', () => {
    const p = new P();
    const a = p.str('global', 'Hello');
    const b = p.str('global', 'World');
    const t1 = p.b.concat(a, p.const(' '));
    const t2 = p.b.concat(t1, b);
    const t3 = p.b.concat(t2, p.b.concat(p.const('!'), p.const('?')));
    const r = p.keep(t3);
    const run = p.exec();
    expect(strAt(run, r)).toBe('Hello World!?');
    expect(strAt(run, (a as { label: string }).label)).toBe('Hello');
    expect(strAt(run, (b as { label: string }).label)).toBe('World');
  });
});

describe('store on the simulator', () => {
  it('copies a borrowed string (no aliasing) and takes an owned temp', () => {
    const p = new P();
    const src = p.str('global', 'Hello');
    const copy = p.svar();
    p.b.store('str', global(copy), src); // copy
    const taken = p.svar();
    const t = p.b.load('str', src);
    p.b.store('str', global(taken), t); // take
    const fromConst = p.svar();
    p.b.store('str', global(fromConst), p.const('const'));
    const run = p.exec();
    const srcPtr = run.wordAt((src as { label: string }).label);
    expect(strAt(run, copy)).toBe('Hello');
    expect(strAt(run, taken)).toBe('Hello');
    expect(strAt(run, fromConst)).toBe('const');
    expect(run.wordAt(copy)).not.toBe(srcPtr);
    expect(run.wordAt(taken)).not.toBe(srcPtr);
    expect(run.wordAt(taken)).not.toBe(run.wordAt(copy));
  });

  it('replaces and frees the old value, into a global, a frame slot and a BYREF slot', () => {
    const p = new P();
    const g = p.svar();
    const byrefTarget = p.svar();
    p.b.store('u16', frame(16), addr(byrefTarget));
    for (const text of ['first value here', 'second', '', 'a much longer third value than before']) {
      p.b.store('str', global(g), p.const(text));
      p.b.store('str', frame(-8), p.b.load('str', p.const(text)));
      p.b.store('str', frame(16, true), p.const(text));
    }
    p.b.store('str', global(g), global(g)); // a$ = a$
    const out = p.svar();
    p.b.store('str', global(out), frame(-8));
    const run = p.exec();
    const last = 'a much longer third value than before';
    expect(strAt(run, g)).toBe(last);
    expect(strAt(run, out)).toBe(last);
    expect(strAt(run, byrefTarget)).toBe(last);
  });

  it('assigning to the same variable repeatedly does not leak', () => {
    const free = (n: number): number => {
      const p = new P();
      const g = p.svar();
      loop(p, n, () => {
        p.b.store('str', global(g), p.b.concat(p.const('abc'), p.const('defgh')));
        p.b.store('str', global(g), p.const('xy'));
      });
      return heapFree(p.exec());
    };
    expect(free(300)).toBe(free(2));
  });
});

describe('aload, astore, param and ret on strings', () => {
  it('astore takes a temp or copies; aload copies', () => {
    const p = new P();
    p.globals.push({ label: '_arr', type: 'str', size: 6, init: null, at: null, dims: [] });
    const src = p.str('global', 'borrowed');
    const a0 = p.b.load('u16', addr('_arr'));
    p.b.astore('str', a0, p.b.load('str', p.const('owned')));
    const a1 = p.b.load('u16', addr('_arr', 2));
    p.b.astore('str', a1, src);
    const a2 = p.b.load('u16', addr('_arr'));
    const l0 = p.keep(p.b.aload('str', a2));
    const a3 = p.b.load('u16', addr('_arr', 2));
    const l1 = p.keep(p.b.aload('str', a3));
    const run = p.exec();
    expect(strAt(run, l0)).toBe('owned');
    expect(strAt(run, l1)).toBe('borrowed');
    expect(run.wordAt('_arr', 0)).not.toBe(run.wordAt(l0));
    expect(run.wordAt('_arr', 2)).not.toBe(run.wordAt((src as { label: string }).label));
  });

  it('param copies a borrowed string and passes a temp as it is', () => {
    const p = new P();
    const src = p.str('global', 'Hello');
    p.b.param('str', src); // copied
    p.b.param('i16', imm(2));
    const left = p.b.rtcall('.core.__LOCO_LEFT', 'str') as Operand;
    const r = p.keep(left);
    const run = p.exec();
    expect(strAt(run, r)).toBe('He');
    expect(strAt(run, (src as { label: string }).label)).toBe('Hello');
  });

  it('ret returns a copy of a borrowed string and the temp itself', () => {
    const p = new P();
    const g = p.str('global', 'kept');
    const c = p.const('from temp');
    const proc = (label: string, body: (b: IrBuilder) => void): IrProcedure => {
      const b = new IrBuilder();
      b.label(label).enter(0);
      body(b);
      b.label(`${label}__leave`).leave(0);
      return { label, convention: 'STDCALL', params: [], ret: 'str', body: b.quads };
    };
    const procs = [
      proc('_fa', (b) => b.ret('str', g, '_fa__leave')),
      proc('_fb', (b) => b.ret('str', b.load('str', c), '_fb__leave')),
    ];
    const la = p.keep(p.b.call('_fa', 0, 'str') as Operand);
    const lb = p.keep(p.b.call('_fb', 0, 'str') as Operand);
    const run = p.exec({ procedures: procs });
    expect(strAt(run, la)).toBe('kept');
    expect(run.wordAt(la)).not.toBe(run.wordAt((g as { label: string }).label));
    expect(strAt(run, lb)).toBe('from temp');
  });
});

// ---------- comparisons ----------

describe('string comparisons on the simulator', () => {
  const PAIRS: [string, string][] = [
    ['', ''],
    ['', 'a'],
    ['a', ''],
    ['a', 'a'],
    ['ab', 'abc'], // equal prefix, shorter is less
    ['abc', 'ab'],
    ['abc', 'abd'],
    ['abd', 'abc'],
    ['b', 'abc'],
    ['Z', 'a'],
    ['10', '9'],
    ['A', 'a'],
    ['\xff', 'a'], // codes are unsigned
    ['a\x00b', 'a\x00c'],
  ];
  const OPS = ['eq', 'ne', 'lt', 'le', 'gt', 'ge'] as const;
  const MODEL: Record<(typeof OPS)[number], (c: number) => boolean> = {
    eq: (c) => c === 0,
    ne: (c) => c !== 0,
    lt: (c) => c < 0,
    le: (c) => c <= 0,
    gt: (c) => c > 0,
    ge: (c) => c >= 0,
  };
  const cmp = (a: string, b: string): number => (a === b ? 0 : a < b ? -1 : 1); // JS compares UTF-16 code units, same as bytes here

  for (const op of OPS) {
    it(`${op}:str over pairs with equal prefixes, empty operands and every operand kind`, () => {
      const cases: Case[] = [];
      let i = 0;
      for (const [a, b] of PAIRS) {
        for (const ka of SKINDS) {
          const kb = SKINDS[(i * 3 + 1) % SKINDS.length];
          i++;
          cases.push({
            desc: `${JSON.stringify(a)}[${ka}] ${op} ${JSON.stringify(b)}[${kb}]`,
            build: (p) => {
              const A = p.str(ka, a);
              const B = p.str(kb, b);
              const t = p.b.compare(op, 'str', A, B);
              return { label: p.keepNum(t, 'i16'), num: 'i16' };
            },
            expect: MODEL[op](cmp(a, b)) ? -1 : 0,
          });
        }
      }
      runCases(cases, 40);
    });
  }

  it('frees temp operands (no leak over 1000 comparisons) and leaves variables intact', () => {
    const free = (n: number): number => {
      const p = new P();
      const x = p.str('global', 'abc');
      const flag = p.keepNum(p.b.compare('eq', 'str', p.const(''), p.const('')), 'i16');
      loop(p, n, () => {
        const t = p.b.compare('lt', 'str', p.b.concat(x, p.const('d')), p.b.concat(p.const('ab'), p.const('c')));
        p.b.store('i16', global(flag), t);
        p.b.store('i16', global(flag), p.b.compare('ge', 'str', x, p.b.load('str', p.const('abc'))));
        p.b.store('i16', global(flag), p.b.compare('ne', 'str', p.b.load('str', p.const('q')), x));
      });
      const run = p.exec();
      expect(strAt(run, (x as { label: string }).label)).toBe('abc');
      return heapFree(run);
    };
    expect(free(1000)).toBe(free(2));
  });

  it('jz and jnz on a string are unreachable', () => {
    for (const op of ['jz', 'jnz'] as const) {
      const ir: IrProgram = {
        main: [{ op, type: 'str', a: global('_s'), label: '.T.0', span: null }, { op: 'label', label: '.T.0', span: null }, { op: 'end', a: imm(0), span: null }],
        procedures: [],
        globals: [],
        strings: [],
        data: [],
        requires: [],
        inits: [],
      };
      expect(() => generateWith({ ir, target: makeTarget({}), diagnostics: new DiagnosticBag() }, TEMPLATES)).toThrow(InternalError);
    }
  });
});

// ---------- ownership over loops ----------

/** Appends `for n times: body()` (an INTEGER counter in a new global). */
function loop(p: P, n: number, body: () => void): void {
  const counter = p.ivar(n);
  const top = '.T.9000';
  const done = '.T.9001';
  p.b.label(top);
  p.b.jz('i16', p.b.load('i16', counter), done);
  body();
  p.b.store('i16', counter, p.b.sub('i16', p.b.load('i16', counter), imm(1)));
  p.b.jump(top);
  p.b.label(done);
}

describe('ownership: no leaks over 1000 iterations', () => {
  const scenarios: Record<string, (p: P) => void> = {
    'r$ = a$ + b$ (constants)': (p) => {
      const r = p.svar();
      p.b.store('str', global(r), p.b.concat(p.const('abc'), p.const('defg')));
    },
    'r$ = a$ + b$ + c$ (variables, temps in a chain)': (p) => {
      const a = p.str('global', 'one');
      const b = p.str('global', 'two');
      const r = p.svar();
      p.b.store('str', global(r), p.b.concat(p.b.concat(a, b), p.b.concat(b, a)));
    },
    'a$ + b$ + c$ with one temp operand on either side': (p) => {
      const a = p.str('global', 'left');
      const r = p.svar();
      p.b.store('str', global(r), p.b.concat(p.b.concat(a, a), p.const('!')));
      p.b.store('str', global(r), p.b.concat(p.const('!'), p.b.concat(a, a)));
      p.b.store('str', global(r), p.b.concat(p.b.concat(a, a), a));
      p.b.store('str', global(r), p.b.concat(a, p.b.concat(a, a)));
    },
    'LEN, ASC of temps and variables': (p) => {
      const a = p.str('global', 'xyz');
      const n = p.keepNum(p.builtin('LEN', [a]), 'u16');
      p.b.store('u16', global(n), p.builtin('LEN', [p.b.concat(a, a)]));
      const c = p.keepNum(p.builtin('ASC', [p.b.concat(a, p.const('q'))]), 'u8');
      p.b.store('u8', global(c), p.builtin('ASC', [a]));
    },
    'LEFT$ RIGHT$ MID$ of temps and variables': (p) => {
      const a = p.str('global', 'Hello World');
      const r = p.svar();
      p.b.store('str', global(r), p.builtin('LEFT$', [p.b.load('str', a), imm(4)]));
      p.b.store('str', global(r), p.builtin('RIGHT$', [a, imm(4)]));
      p.b.store('str', global(r), p.builtin('MID$', [p.b.concat(a, a), imm(3), imm(5)]));
      p.b.store('str', global(r), p.builtin('MID$', [a, imm(30)]));
      p.b.store('str', global(r), p.builtin('LEFT$', [p.const(''), imm(2)]));
    },
    'CHR$ SPACE$ STRING$ UPPER$ LOWER$': (p) => {
      const r = p.svar();
      p.b.store('str', global(r), p.builtin('CHR$', [imm(65)]));
      p.b.store('str', global(r), p.builtin('SPACE$', [imm(7)]));
      p.b.store('str', global(r), p.builtin('STRING$', [imm(5), imm(42)]));
      p.b.store('str', global(r), p.builtin('UPPER$', [p.const('mixed Case')]));
      p.b.store('str', global(r), p.builtin('LOWER$', [p.b.concat(p.const('MIXED'), p.const(' Case'))]));
      p.b.store('str', global(r), p.builtin('SPACE$', [imm(0)]));
    },
    'INSTR of temps and variables': (p) => {
      const a = p.str('global', 'abcabc');
      const n = p.keepNum(p.builtin('INSTR', [a, p.const('ca')]), 'u16');
      p.b.store('u16', global(n), p.builtin('INSTR', [p.int('temp', 3), p.b.load('str', a), p.b.load('str', p.const('b'))]));
      p.b.store('u16', global(n), p.builtin('INSTR', [p.b.concat(a, a), p.b.concat(p.const('c'), p.const('z'))]));
    },
    'STR$': (p) => {
      const r = p.svar();
      p.b.store('str', global(r), p.b.cast('str', 'i16', p.b.load('i16', p.ivar(-123))));
      p.b.store('str', global(r), p.b.cast('str', 'u32', imm(70000)));
    },
    'PRINT of temps and variables': (p) => {
      const a = p.str('global', 'p');
      p.b.fparam('str', p.b.concat(a, a));
      p.b.rtcall('.core.__LOCO_PRINTSTR');
      p.b.fparam('str', a);
      p.b.rtcall('.core.__LOCO_PRINTSTR');
    },
    'copying store r$ = a$': (p) => {
      const a = p.str('global', 'copy me please');
      const r = p.svar();
      p.b.store('str', global(r), a);
      p.b.store('str', global(r), p.const('short'));
      p.b.store('str', global(r), a);
    },
  };

  for (const [name, body] of Object.entries(scenarios)) {
    it(name, () => {
      const free = (n: number): number => {
        const p = new P();
        loop(p, n, () => body(p));
        const run = p.exec();
        expect(run.stopped).toBe('rst0');
        return heapFree(run);
      };
      expect(free(1000)).toBe(free(2));
    });
  }

  it('the check itself detects a leak', () => {
    const free = (n: number): number => {
      const p = new P();
      loop(p, n, () => {
        p.b.push({ op: 'asm', lines: [{ text: '\tld bc, 10', span: { file: 0 as never, start: 0, end: 0 } }, { text: '\tcall .core.__MEM_ALLOC', span: { file: 0 as never, start: 0, end: 0 } }], span: null });
      });
      return heapFree(p.exec({ requires: ['mem/alloc.asm'] }));
    };
    expect(free(20)).toBeLessThan(free(2));
  });
});

// ---------- built-ins ----------

describe('LEN, ASC, CHR$, SPACE$, STRING$, UPPER$, LOWER$ on the simulator', () => {
  it('LEN of every operand kind', () => {
    const cases: Case[] = [];
    for (const k of SKINDS) {
      for (const s of ['', 'a', 'Hello World', 'x'.repeat(300)]) {
        cases.push({
          desc: `LEN(${JSON.stringify(s.length > 20 ? `${s.slice(0, 5)}...` : s)}[${k}])`,
          build: (p) => ({ label: p.keepNum(p.builtin('LEN', [p.str(k, s)]), 'u16'), num: 'u16' }),
          expect: s.length,
        });
      }
    }
    runCases(cases);
  });

  it('ASC: the first code of every operand kind (the empty string is error 5, below)', () => {
    const cases: Case[] = [];
    for (const k of SKINDS) {
      for (const s of ['A', 'abc', '\xff', '\x00z']) {
        cases.push({
          desc: `ASC(${JSON.stringify(s)}[${k}])`,
          build: (p) => ({ label: p.keepNum(p.builtin('ASC', [p.str(k, s)]), 'u8'), num: 'u8' }),
          expect: s.charCodeAt(0),
        });
      }
    }
    runCases(cases);
  });

  it('CHR$ over the whole range of codes', () => {
    const cases: Case[] = [];
    for (const n of [0, 1, 7, 32, 65, 97, 127, 128, 200, 254, 255]) {
      for (const k of INT_KINDS) {
        cases.push({ desc: `CHR$(${n})[${k}]`, build: (p) => ({ label: p.keep(p.builtin('CHR$', [p.int(k, n)])) }), expect: String.fromCharCode(n) });
      }
    }
    runCases(cases);
  });

  it('SPACE$ and STRING$', () => {
    const cases: Case[] = [];
    for (const n of [0, 1, 3, 40, 255, 300]) {
      for (const k of INT_KINDS) {
        cases.push({ desc: `SPACE$(${n})[${k}]`, build: (p) => ({ label: p.keep(p.builtin('SPACE$', [p.int(k, n)])) }), expect: ' '.repeat(n) });
      }
    }
    for (const [n, c] of [[0, 65], [1, 65], [4, 120], [3, 0], [5, 255], [70, 33]] as const) {
      for (const k of INT_KINDS) {
        cases.push({
          desc: `STRING$(${n}, ${c})[${k}]`,
          build: (p) => ({ label: p.keep(p.builtin('STRING$', [p.int(k, n), p.int(k, c)])) }),
          expect: String.fromCharCode(c).repeat(n),
        });
      }
    }
    runCases(cases, 20);
  });

  it('UPPER$ and LOWER$ map letters only, copy a variable and leave it unchanged', () => {
    const texts = ['', 'abc', 'ABC', 'Hello, World 123 [\\]^_`{|}~', '@AZ[`az{'];
    const cases: Case[] = [];
    const up = (s: string): string => s.replace(/[a-z]/g, (c) => c.toUpperCase());
    const low = (s: string): string => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
    for (const k of SKINDS) {
      for (const s of texts) {
        cases.push({ desc: `UPPER$(${JSON.stringify(s)})[${k}]`, build: (p) => ({ label: p.keep(p.builtin('UPPER$', [p.str(k, s)])) }), expect: up(s) });
        cases.push({ desc: `LOWER$(${JSON.stringify(s)})[${k}]`, build: (p) => ({ label: p.keep(p.builtin('LOWER$', [p.str(k, s)])) }), expect: low(s) });
      }
    }
    runCases(cases, 25);
    const p = new P();
    const v = p.str('global', 'MiXed');
    const r = p.keep(p.builtin('UPPER$', [v]));
    const run = p.exec();
    expect(strAt(run, (v as { label: string }).label)).toBe('MiXed');
    expect(strAt(run, r)).toBe('MIXED');
  });
});

describe('LEFT$, RIGHT$, MID$ on the simulator (1-based, edges)', () => {
  it('LEFT$ and RIGHT$ for n = 0, inside, at and past the end', () => {
    const cases: Case[] = [];
    let i = 0;
    for (const s of STRINGS) {
      for (const n of [0, 1, 2, 4, 5, 6, 11, 12, 100]) {
        const kn = INT_KINDS[i++ % 3];
        const ks: SKind = kn === 'temp' ? 'temp' : (['const', 'global', 'temp'] as const)[i % 3];
        cases.push({ desc: `LEFT$(${JSON.stringify(s)}[${ks}], ${n}[${kn}])`, build: (p) => ({ label: p.keep(p.builtin('LEFT$', [p.str(ks, s), p.int(kn, n)])) }), expect: LEFT(s, n) });
        cases.push({ desc: `RIGHT$(${JSON.stringify(s)}[${ks}], ${n}[${kn}])`, build: (p) => ({ label: p.keep(p.builtin('RIGHT$', [p.str(ks, s), p.int(kn, n)])) }), expect: RIGHT(s, n) });
      }
    }
    runCases(cases);
  });

  it('MID$ with and without a length: start 1, inside, at the end, past the end', () => {
    const cases: Case[] = [];
    let i = 0;
    for (const s of STRINGS) {
      for (const pos of [1, 2, 5, 6, 7, 12, 13, 20, 1000]) {
        const kp = INT_KINDS[i++ % 3];
        const ks: SKind = kp === 'temp' ? 'temp' : (['const', 'global', 'temp'] as const)[i % 3];
        cases.push({ desc: `MID$(${JSON.stringify(s)}[${ks}], ${pos}[${kp}])`, build: (p) => ({ label: p.keep(p.builtin('MID$', [p.str(ks, s), p.int(kp, pos)])) }), expect: MID(s, pos) });
        for (const n of [0, 1, 3, 5, 100]) {
          cases.push({
            desc: `MID$(${JSON.stringify(s)}[${ks}], ${pos}[${kp}], ${n})`,
            build: (p) => ({ label: p.keep(p.builtin('MID$', [p.str(ks, s), p.int(kp, pos), imm(n)])) }),
            expect: MID(s, pos, n),
          });
        }
      }
    }
    runCases(cases);
  });

  it('the examples of tests/loco/str-basic.bas', () => {
    const cases: Case[] = [
      ['LEFT$(a$,2)', (p: P) => p.builtin('LEFT$', [p.str('global', 'Hello'), imm(2)]), 'He'],
      ['RIGHT$(a$,2)', (p: P) => p.builtin('RIGHT$', [p.str('global', 'Hello'), imm(2)]), 'lo'],
      ['MID$(a$,2,3)', (p: P) => p.builtin('MID$', [p.str('global', 'Hello'), imm(2), imm(3)]), 'ell'],
      ['MID$(a$,4)', (p: P) => p.builtin('MID$', [p.str('global', 'Hello'), imm(4)]), 'lo'],
      ['LEFT$(a$,0)', (p: P) => p.builtin('LEFT$', [p.str('global', 'Hello'), imm(0)]), ''],
      ['LEFT$(a$,9)', (p: P) => p.builtin('LEFT$', [p.str('global', 'Hello'), imm(9)]), 'Hello'],
    ].map(([desc, f, expected]) => ({
      desc: desc as string,
      build: (p: P) => ({ label: p.keep((f as (p: P) => Operand)(p)) }),
      expect: expected as string,
    }));
    runCases(cases);
  });

  it('negative counts, MID$ position 0 and CHR$ out of range are runtime error 5', () => {
    const attempts: [string, (p: P) => Operand][] = [
      ['LEFT$(s, -1)', (p) => p.builtin('LEFT$', [p.str('const', 'abc'), imm(-1)])],
      ['RIGHT$(s, -1)', (p) => p.builtin('RIGHT$', [p.str('const', 'abc'), imm(-1)])],
      ['MID$(s, 0)', (p) => p.builtin('MID$', [p.str('const', 'abc'), imm(0)])],
      ['MID$(s, 0, 1)', (p) => p.builtin('MID$', [p.str('const', 'abc'), imm(0), imm(1)])],
      ['MID$(s, 1, -1)', (p) => p.builtin('MID$', [p.str('const', 'abc'), imm(1), imm(-1)])],
      ['CHR$(256)', (p) => p.builtin('CHR$', [imm(256)])],
      ['CHR$(-1)', (p) => p.builtin('CHR$', [imm(-1)])],
      ['SPACE$(-1)', (p) => p.builtin('SPACE$', [imm(-1)])],
      ['STRING$(2, 256)', (p) => p.builtin('STRING$', [imm(2), imm(256)])],
      ['INSTR(0, a, b)', (p) => p.builtin('INSTR', [imm(0), p.str('const', 'abc'), p.str('const', 'b')]) as Operand],
      ...SKINDS.map((k): [string, (p: P) => Operand] => [`ASC(""[${k}])`, (p) => p.builtin('ASC', [p.str(k, '')])]),
    ];
    for (const [desc, f] of attempts) {
      const p = new P();
      const t = f(p);
      const lastRet = (p.b.quads[p.b.quads.length - 1] as { op: string; ret?: IrType } | undefined);
      if (lastRet?.op === 'rtcall' && (lastRet.ret === 'u16' || lastRet.ret === 'u8')) p.keepNum(t, lastRet.ret);
      else p.keep(t);
      const run = p.exec();
      expect(run.stopped, desc).toBe('rst0');
      expect(run.printer, desc).toContain('Error 5');
    }
  });
});

describe('INSTR on the simulator', () => {
  it('two and three argument forms against a model', () => {
    const cases: Case[] = [];
    const subjects = ['', 'abc', 'abcabc', 'Hello World', 'aaa'];
    const needles = ['', 'a', 'b', 'abc', 'ca', 'o W', 'World!', 'aa', 'z'];
    let i = 0;
    for (const a of subjects) {
      for (const b of needles) {
        // a borrowed argument may not come before a temp (evaluation order), so a temp b needs a temp a
        const [sa, sb] = ([['const', 'global'], ['global', 'const'], ['temp', 'temp'], ['temp', 'const'], ['const', 'const'], ['global', 'global']] as [SKind, SKind][])[i % 6];
        i++;
        cases.push({
          desc: `INSTR(${JSON.stringify(a)}[${sa}], ${JSON.stringify(b)}[${sb}])`,
          build: (p) => {
            const A = p.str(sa, a);
            const B = p.str(sb, b);
            return { label: p.keepNum(p.builtin('INSTR', [A, B]), 'u16'), num: 'u16' };
          },
          expect: INSTR(1, a, b),
        });
        for (const start of [1, 2, 4, 7, 12, 40]) {
          cases.push({
            desc: `INSTR(${start}, ${JSON.stringify(a)}[${sa}], ${JSON.stringify(b)}[${sb}])`,
            build: (p) => {
              // arguments in evaluation order: a non-temp may not come before a temp
              const S = sa === 'temp' || sb === 'temp' ? p.int('temp', start) : imm(start);
              const A = p.str(sa, a);
              const B = p.str(sb, b);
              return { label: p.keepNum(p.builtin('INSTR', [S, A, B]), 'u16'), num: 'u16' };
            },
            expect: INSTR(start, a, b),
          });
        }
      }
    }
    runCases(cases, 20);
  });
});

// ---------- STR$ and VAL ----------

describe('STR$ (cast to str) on the simulator', () => {
  const text = (v: number): string => (v < 0 ? `${v}` : ` ${v}`);

  it('INTEGER: -5, 0, 32767, -32768 and neighbours, every operand kind', () => {
    const cases: Case[] = [];
    for (const v of [-5, 0, 5, 32767, -32768, -1, 100, -32767, 9, 10, 99, 1234]) {
      cases.push({ desc: `STR$(${v}) imm`, build: (p) => ({ label: p.keep(p.b.cast('str', 'i16', imm(v))) }), expect: text(v) });
      cases.push({ desc: `STR$(${v}) global`, build: (p) => ({ label: p.keep(p.b.cast('str', 'i16', p.ivar(v))) }), expect: text(v) });
      cases.push({ desc: `STR$(${v}) temp`, build: (p) => ({ label: p.keep(p.b.cast('str', 'i16', p.b.load('i16', p.ivar(v)))) }), expect: text(v) });
    }
    runCases(cases);
  });

  it('agrees with the print routine: the PRINT text of n is STR$(n) plus a space', () => {
    const p = new P();
    for (const v of [-5, 0, 32767, -32768]) {
      p.b.fparam('i16', imm(v));
      p.b.rtcall('.core.__LOCO_PRINTI16');
      p.b.fparam('str', p.b.cast('str', 'i16', imm(v)));
      p.b.rtcall('.core.__LOCO_PRINTSTR');
    }
    const run = p.exec();
    expect(run.stopped).toBe('rst0');
    const printed = run.printer.replace(/\n/g, '').replace('\x04END', '');
    expect(printed).toBe([-5, 0, 32767, -32768].map((v) => `${text(v)} ${text(v)}`).join(''));
  });

  it('the other integer types', () => {
    const cases: Case[] = [];
    const per: [IrType, number[]][] = [
      ['u8', [0, 1, 255, 128]],
      ['i8', [0, -1, 127, -128, 5]],
      ['u16', [0, 65535, 32768, 10]],
      ['u32', [0, 65536, 4294967295, 70000]],
      ['i32', [0, -1, 2147483647, -2147483648, 100000, -100000]],
    ];
    for (const [t, values] of per) {
      for (const v of values) {
        for (const kind of ['imm', 'temp'] as const) {
          cases.push({
            desc: `STR$(${v}) as ${t} ${kind}`,
            build: (p) => {
              const g: Operand = imm(v);
              let src: Operand = g;
              if (kind === 'temp') {
                const size = t === 'u8' || t === 'i8' ? 1 : t === 'u16' ? 2 : 4;
                const bytes = Array.from({ length: size }, (_, k) => Number((BigInt(v) >> BigInt(8 * k)) & 0xffn));
                src = p.b.load(t, p.gvar(t, bytes));
              }
              return { label: p.keep(p.b.cast('str', t, src)) };
            },
            expect: text(v),
          });
        }
      }
    }
    runCases(cases);
  });

  it('REAL and FIXED text is the REAL table\'s (cast:f->str, cast:f16->str, L2-CG-REAL), not this one', () => {
    for (const from of ['f', 'f16'] as const) {
      expect(Object.keys(STR_TEMPLATES)).not.toContain(`cast:${from}->str`);
      expect(TEMPLATES.some((t) => `cast:${from}->str` in t)).toBe(true);
    }
  });
});

describe('VAL (cast str to REAL) on the simulator', () => {
  /** Locomotive's layout: the 32-bit mantissa low byte first with the sign in its top bit, then the exponent + 128 (0 is zero). */
  function decode(b: number[]): number {
    if (b[4] === 0) return 0;
    const mant = ((b[3] | 0x80) * 2 ** 24 + b[2] * 2 ** 16 + b[1] * 2 ** 8 + b[0]) / 2 ** 32;
    return (b[3] & 0x80 ? -1 : 1) * mant * 2 ** (b[4] - 128);
  }

  function val(text: string, kind: SKind = 'const'): number[] {
    const p = new P();
    p.globals.push({ label: '_out', type: 'f', size: 5, init: null, at: null, dims: [] });
    const t = p.b.cast('f', 'str', p.str(kind, text));
    // no REAL template here (L2-CG-REAL): pop the result registers by hand
    p.b.push({
      op: 'asm',
      lines: ['\tpop af', '\tld (_out), a', '\tpop de', '\tld (_out+1), de', '\tpop bc', '\tld (_out+3), bc'].map((x) => ({ text: x, span: { file: 0 as never, start: 0, end: 0 } })),
      span: null,
    });
    void t;
    const run = p.exec({ verify: false });
    expect(run.stopped).toBe('rst0');
    return Array.from(run.memory.slice(run.image.addr('_out'), run.image.addr('_out') + 5));
  }

  const CASES: [string, number][] = [
    ['12', 12],
    [' 12', 12],
    ['   7', 7],
    ['+5', 5],
    [' +5', 5],
    ['-12', -12],
    ['1E3', 1000],
    ['1e3', 1000],
    ['2.5', 2.5],
    ['abc', 0],
    ['', 0],
    ['   ', 0],
    ['12abc', 12],
    ['0', 0],
    ['100', 100],
    ['.5', 0.5],
  ];
  for (const [text, expected] of CASES) {
    for (const kind of ['const', 'temp'] as SKind[]) {
      it(`VAL(${JSON.stringify(text)}) [${kind}] = ${expected}`, () => {
        expect(decode(val(text, kind))).toBe(expected);
      });
    }
  }

  it('frees a temp argument and leaves a variable intact', () => {
    const free = (n: number): number => {
      const p = new P();
      p.globals.push({ label: '_out', type: 'f', size: 5, init: null, at: null, dims: [] });
      const v = p.str('global', ' 42');
      loop(p, n, () => {
        for (const src of [() => p.b.load('str', p.const('  3')), () => v, () => p.b.load('str', p.const('7'))]) {
          p.b.cast('f', 'str', src());
          p.b.push({ op: 'asm', lines: [{ text: '\tpop af\n\tpop de\n\tpop bc', span: { file: 0 as never, start: 0, end: 0 } }], span: null });
        }
      });
      const run = p.exec({ verify: false });
      expect(strAt(run, (v as { label: string }).label)).toBe(' 42');
      return heapFree(run);
    };
    expect(free(200)).toBe(free(2));
  });
});

// ---------- PRINT of temporaries ----------

describe('PRINT of strings', () => {
  it('prints constants, variables and temps, and frees the temps', () => {
    const p = new P();
    const a = p.str('global', 'Hello');
    for (const x of [a, p.b.concat(a, p.const(' there')), p.const('!')]) {
      p.b.fparam('str', x);
      p.b.rtcall('.core.__LOCO_PRINTSTR');
    }
    const run = p.exec();
    expect(run.printer.replace(/\n/g, '').replace('\x04END', '')).toBe('HelloHello there!');
  });
});

describe('fparam:str of a constant', () => {
  it('sets A = 0 and links no heap; a temp sets A = 1 and does', () => {
    const gen = (quads: Quad[]): { readonly main: readonly string[]; readonly requires: readonly string[] } => {
      const ir: IrProgram = { main: quads, procedures: [], globals: [], strings: [{ id: 0, label: '.S.0', bytes: Uint8Array.from([104, 105]) }], data: [], requires: [], inits: [] };
      return generateWith({ ir, target: makeTarget({}), diagnostics: new DiagnosticBag() }, TEMPLATES);
    };
    const c = gen([
      { op: 'fparam', type: 'str', a: strconst(0), span: null },
      { op: 'rtcall', label: '.core.__LOCO_PRINTSTR', ret: null, dst: null, span: null },
      { op: 'end', a: imm(0), span: null },
    ]);
    expect(c.main.slice(0, 2)).toEqual(['\tld hl, .S.0', '\txor a']);
    expect(c.requires).not.toContain('mem/alloc.asm');
    const t = gen([
      { op: 'load', type: 'str', dst: { k: 'temp', id: 0 }, a: strconst(0), span: null },
      { op: 'fparam', type: 'str', a: { k: 'temp', id: 0 }, span: null },
      { op: 'rtcall', label: '.core.__LOCO_PRINTSTR', ret: null, dst: null, span: null },
      { op: 'end', a: imm(0), span: null },
    ]);
    expect(t.main).toContain('\tld a, 1');
    expect(t.requires).toContain('mem/alloc.asm');
  });
});
