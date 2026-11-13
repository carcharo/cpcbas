/**
 * L2-CG-INT: every integer template is generated through the real generate + link path,
 * assembled over lib/runtime and executed on the test Z80 (test/z80sim); results are read
 * from memory and compared with a BigInt model of the operation (two's-complement wrap in
 * the quad's type, as sem/types.ts `wrap`).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DiagnosticBag } from '../core/diagnostics.js';
import { SourceSet } from '../core/source.js';
import { addr, frame, global, imm, IrBuilder } from '../ir/builder.js';
import type { IrGlobal, IrProgram, IrType, Operand, Quad } from '../ir/ir.js';
import { verifyIr } from '../ir/verify.js';
import { wrap, type TypeName } from '../sem/types.js';
import { assembleAndRun, type AssembledRun } from '../../test/z80sim/run.js';
import type { RunOptions } from '../../test/z80sim/run.js';
import { tempsForms, tempsOpt } from '../../test/temps-env.js';
import { generateWith } from './generate.js';
import { INT_TEMPLATES, withFrameCheck } from './int.js';
import { link, makeTarget, type EmitContext, type Template, type TemplateTable, type TempForm } from './index.js';

type IntType = 'u8' | 'i8' | 'u16' | 'i16' | 'u32' | 'i32';
const TYPES: readonly IntType[] = ['u8', 'i8', 'u16', 'i16', 'u32', 'i32'];
const WIDTH: Record<IntType, number> = { u8: 8, i8: 8, u16: 16, i16: 16, u32: 32, i32: 32 };
const SIGNED = (t: IntType): boolean => t.startsWith('i');
const TYPE_NAME: Record<IntType, TypeName> = { u8: 'UBYTE', i8: 'BYTE', u16: 'UINTEGER', i16: 'INTEGER', u32: 'ULONG', i32: 'LONG' };

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
function loadTree(): Map<string, string> {
  const tree = new Map<string, string>();
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = `${dir}/${name}`;
      if (statSync(full).isDirectory()) walk(full, `${prefix}${name}/`);
      else if (name.endsWith('.asm')) tree.set(`${prefix}${name}`, readFileSync(full, 'latin1'));
    }
  };
  walk(`${REPO}lib/runtime`, 'runtime/');
  return tree;
}
const TREE = loadTree();

// ---------- harness ----------

const SPAN = { file: 0 as never, start: 0, end: 0 };
/** Test-only templates for the control quads owned by L2-CG-FLOW. */
const TEST_TEMPLATES: TemplateTable = {
  end: () => ['\tld hl, 0', '\tld b, h', '\tld c, l', '.core.__END_PROGRAM:', '\tjp .core.__CPC_END'],
  label: (q) => [`${(q as Extract<Quad, { op: 'label' }>).label}:`],
};

const norm = (t: IntType, v: bigint): bigint => (SIGNED(t) ? BigInt.asIntN(WIDTH[t], v) : BigInt.asUintN(WIDTH[t], v));

function bytesOf(v: bigint, n: number): number[] {
  const out: number[] = [];
  let x = BigInt.asUintN(n * 8, v);
  for (let i = 0; i < n; i++) {
    out.push(Number(x & 0xffn));
    x >>= 8n;
  }
  return out;
}

const glob = (label: string, type: IrType, size: number, init: number[] | null = null, at: number | null = null): IrGlobal => ({
  label,
  type,
  size,
  init: init === null ? null : new Uint8Array(init),
  at,
  dims: [],
});

interface Exec {
  quads: Quad[];
  globals: IrGlobal[];
  verify?: boolean;
  run?: RunOptions;
}

function exec(e: Exec): AssembledRun {
  const end: Quad = { op: 'end', a: imm(0), span: null };
  const ir: IrProgram = { main: [...e.quads, end], procedures: [], globals: e.globals, strings: [], data: [], requires: [], inits: [] };
  if (e.verify !== false) expect(verifyIr(ir)).toEqual([]);
  const target = makeTarget({});
  const diagnostics = new DiagnosticBag();
  const sources = new SourceSet();
  const generated = generateWith({ ir, target, diagnostics, templates: [INT_TEMPLATES, TEST_TEMPLATES], ...tempsOpt() }, [], ...tempsForms());
  expect(diagnostics.all().map((d) => d.message)).toEqual([]);
  const linked = link({ asm: generated, target, runtime: TREE, sources, diagnostics });
  expect(diagnostics.all().map((d) => d.message)).toEqual([]);
  const defines = { ...Object.fromEntries(target.asmDefines), __CPC_PRINTER_ECHO__: '1' };
  return assembleAndRun(linked.text, { defines, ...e.run });
}

function readValue(run: AssembledRun, t: IntType, label: string, offset = 0): bigint {
  const n = WIDTH[t] / 8;
  const base = run.image.addr(label) + offset;
  let v = 0n;
  for (let i = n - 1; i >= 0; i--) v = (v << 8n) | BigInt(run.memory[base + i]);
  return norm(t, v);
}

// ---------- operand kinds ----------

type Kind = 'imm' | 'temp' | 'global' | 'frame' | 'byref';
const KINDS: readonly Kind[] = ['imm', 'temp', 'global', 'frame', 'byref'];
const FRAME = 32; // IX = _fr + FRAME

/** A program under construction: globals, the IX set-up, and per-case operand set-up. */
class Prog {
  readonly b = new IrBuilder();
  readonly globals: IrGlobal[] = [glob('_fr', 'u8', 96, null)];
  constructor() {
    this.b.push({ op: 'asm', lines: [{ text: `\tld ix, _fr+${FRAME}`, span: SPAN }], span: null });
  }
  g(label: string, type: IntType | 'u8', value: bigint): string {
    const t = type as IntType;
    this.globals.push(glob(label, t, WIDTH[t] / 8, bytesOf(value, WIDTH[t] / 8)));
    return label;
  }
  r(label: string, type: IntType): string {
    this.globals.push(glob(label, type, WIDTH[type] / 8, new Array<number>(WIDTH[type] / 8).fill(0xaa)));
    return label;
  }
  /** An operand of `kind` holding `value` of type `t`; `slot` picks distinct frame slots for a and b. */
  operand(kind: Kind, t: IntType, value: bigint, label: string, slot: number): Operand {
    const v = Number(norm(t, value));
    switch (kind) {
      case 'imm':
        return imm(v);
      case 'global':
        return global(this.g(label, t, value));
      case 'temp':
        return this.b.load(t, global(this.g(label, t, value)));
      case 'frame':
        this.b.store(t, frame(slot * 8), imm(v));
        return frame(slot * 8);
      case 'byref':
        this.g(label, t, value);
        this.b.store('u16', frame(16 + slot * 2), addr(label));
        return frame(16 + slot * 2, true);
    }
  }
}

const kindA = (i: number): Kind => KINDS[i % 5];
const kindB = (i: number): Kind => KINDS[(Math.floor(i / 5) + i) % 5];

const VALUES: Record<IntType, bigint[]> = {
  u8: [0n, 1n, 2n, 7n, 100n, 127n, 128n, 129n, 254n, 255n],
  i8: [0n, 1n, 2n, -1n, -2n, 7n, 100n, 127n, -127n, -128n],
  u16: [0n, 1n, 2n, 255n, 256n, 1000n, 32767n, 32768n, 65534n, 65535n],
  i16: [0n, 1n, 2n, -1n, -2n, 255n, -256n, 32767n, -32767n, -32768n],
  u32: [0n, 1n, 2n, 65535n, 65536n, 0x12345678n, 0x7fffffffn, 0x80000000n, 0xfffffffen, 0xffffffffn],
  i32: [0n, 1n, -1n, 2n, 65535n, -65536n, 0x12345678n, 0x7fffffffn, -0x7fffffffn, -0x80000000n],
};

interface Check {
  desc: string;
  label: string;
  type: IntType;
  expected: bigint;
}

function verifyChecks(run: AssembledRun, checks: Check[]): void {
  const bad: string[] = [];
  for (const c of checks) {
    const got = readValue(run, c.type, c.label);
    if (got !== c.expected) bad.push(`${c.desc}: got ${got}, expected ${c.expected}`);
  }
  expect(run.stopped).toBe('rst0');
  expect(bad).toEqual([]);
}

// ---------- the models ----------

type BinOp = 'add' | 'sub' | 'mul' | 'div' | 'mod' | 'and' | 'or' | 'xor';
const MODEL: Record<BinOp, (a: bigint, b: bigint) => bigint> = {
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  mul: (a, b) => a * b,
  div: (a, b) => a / b,
  mod: (a, b) => a % b,
  and: (a, b) => a & b,
  or: (a, b) => a | b,
  xor: (a, b) => a ^ b,
};
type CmpOp = 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge';
const CMP: Record<CmpOp, (a: bigint, b: bigint) => boolean> = {
  eq: (a, b) => a === b,
  ne: (a, b) => a !== b,
  lt: (a, b) => a < b,
  le: (a, b) => a <= b,
  gt: (a, b) => a > b,
  ge: (a, b) => a >= b,
};

describe('model', () => {
  it('agrees with sem/types wrap', () => {
    for (const t of TYPES) {
      for (const a of VALUES[t]) {
        for (const b of VALUES[t]) {
          const v = a * b + a;
          if (v > 2n ** 52n || v < -(2n ** 52n)) continue;
          expect(norm(t, v)).toBe(BigInt(wrap(Number(v), TYPE_NAME[t])));
        }
      }
    }
  });
});

// ---------- binary operations ----------

describe('arithmetic and bitwise on the simulator', () => {
  for (const t of TYPES) {
    for (const op of ['add', 'sub', 'mul', 'div', 'mod', 'and', 'or', 'xor'] as const) {
      it(`${op}:${t} over a table of operand values and kinds`, () => {
        const p = new Prog();
        const checks: Check[] = [];
        let i = 0;
        for (const a of VALUES[t]) {
          for (const b of VALUES[t]) {
            if ((op === 'div' || op === 'mod') && b === 0n) continue;
            const A = p.operand(kindA(i), t, a, `_a${i}`, 0);
            const B = p.operand(kindB(i), t, b, `_b${i}`, 1);
            const d = p.b.binary(op, t, A, B);
            p.b.store(t, global(p.r(`_r${i}`, t)), d);
            checks.push({ desc: `${op}.${t} ${a}, ${b} [${kindA(i)},${kindB(i)}]`, label: `_r${i}`, type: t, expected: norm(t, MODEL[op](a, b)) });
            i++;
          }
        }
        verifyChecks(exec({ quads: p.b.quads, globals: p.globals }), checks);
      });
    }
  }
});

describe('operand kinds', () => {
  const OPS: BinOp[] = ['add', 'sub', 'mul', 'div'];
  for (const t of TYPES) {
    it(`all 25 operand kind pairs, ${t}`, () => {
      const p = new Prog();
      const checks: Check[] = [];
      const vals = VALUES[t];
      let i = 0;
      for (const ka of KINDS) {
        for (const kb of KINDS) {
          for (const op of OPS) {
            const a = vals[(i * 3 + 5) % vals.length];
            let b = vals[(i * 7 + 2) % vals.length];
            if (op === 'div' && b === 0n) b = 1n;
            const A = p.operand(ka, t, a, `_a${i}`, 0);
            const B = p.operand(kb, t, b, `_b${i}`, 1);
            const d = p.b.binary(op, t, A, B);
            p.b.store(t, global(p.r(`_r${i}`, t)), d);
            checks.push({ desc: `${op}.${t} ${a}, ${b} [${ka},${kb}]`, label: `_r${i}`, type: t, expected: norm(t, MODEL[op](a, b)) });
            i++;
          }
        }
      }
      verifyChecks(exec({ quads: p.b.quads, globals: p.globals }), checks);
    });
  }
});

describe('division and MOD sign combinations', () => {
  const PAIRS: [bigint, bigint][] = [
    [7n, 2n],
    [-7n, 2n],
    [7n, -2n],
    [-7n, -2n],
    [100n, 7n],
    [-100n, 7n],
    [1n, 3n],
    [-1n, 3n],
    [0n, -3n],
  ];
  for (const t of TYPES.filter((x) => SIGNED(x))) {
    for (const op of ['div', 'mod'] as const) {
      it(`${op}:${t}: truncates toward zero, MOD takes the dividend's sign`, () => {
        const p = new Prog();
        const checks: Check[] = [];
        PAIRS.forEach(([a, b], i) => {
          const d = p.b.binary(op, t, imm(Number(a)), imm(Number(b)));
          p.b.store(t, global(p.r(`_r${i}`, t)), d);
          checks.push({ desc: `${a} ${op} ${b}`, label: `_r${i}`, type: t, expected: norm(t, MODEL[op](a, b)) });
        });
        // the language's own examples, as numbers
        expect(MODEL.mod(-7n, 3n)).toBe(-1n);
        expect(MODEL.div(-7n, 2n)).toBe(-3n);
        verifyChecks(exec({ quads: p.b.quads, globals: p.globals }), checks);
      });
    }
  }
  it('i32 division and MOD at the extremes', () => {
    const t: IntType = 'i32';
    const cases: [bigint, bigint][] = [
      [-0x80000000n, -1n],
      [-0x80000000n, 1n],
      [-0x80000000n, 3n],
      [0x7fffffffn, -0x80000000n],
      [-0x80000000n, -0x80000000n],
    ];
    for (const op of ['div', 'mod'] as const) {
      const p = new Prog();
      const checks: Check[] = [];
      cases.forEach(([a, b], i) => {
        const d = p.b.binary(op, t, imm(Number(a)), imm(Number(b)));
        p.b.store(t, global(p.r(`_r${i}`, t)), d);
        checks.push({ desc: `${a} ${op} ${b}`, label: `_r${i}`, type: t, expected: norm(t, MODEL[op](a, b)) });
      });
      verifyChecks(exec({ quads: p.b.quads, globals: p.globals }), checks);
    }
  });
});

describe('division by zero is runtime error 11', () => {
  for (const t of TYPES) {
    for (const op of ['div', 'mod'] as const) {
      for (const bk of ['imm', 'global'] as const) {
        it(`${op}:${t} by ${bk} zero`, () => {
          const p = new Prog();
          const B = p.operand(bk, t, 0n, '_z', 1);
          const d = p.b.binary(op, t, imm(5), B);
          p.b.store(t, global(p.r('_r0', t)), d);
          const run = exec({ quads: p.b.quads, globals: p.globals });
          expect(run.stopped).toBe('rst0');
          expect(run.printer).toContain('Error 11');
          expect(readValue(run, t, '_r0')).toBe(norm(t, bytesOfAA(t)));
        });
      }
    }
  }
  it('a nonzero divisor right after a zero one still divides', () => {
    const p = new Prog();
    const d = p.b.binary('div', 'u16', imm(100), imm(7));
    p.b.store('u16', global(p.r('_r0', 'u16')), d);
    verifyChecks(exec({ quads: p.b.quads, globals: p.globals }), [{ desc: '100/7', label: '_r0', type: 'u16', expected: 14n }]);
  });
});

function bytesOfAA(t: IntType): bigint {
  let v = 0n;
  for (let i = 0; i < WIDTH[t] / 8; i++) v = (v << 8n) | 0xaan;
  return v;
}

// ---------- comparisons ----------

describe('comparisons give -1 or 0', () => {
  for (const t of TYPES) {
    for (const op of ['eq', 'ne', 'lt', 'le', 'gt', 'ge'] as const) {
      it(`${op}:${t}`, () => {
        const p = new Prog();
        const checks: Check[] = [];
        let i = 0;
        for (const a of VALUES[t]) {
          for (const b of VALUES[t]) {
            const A = p.operand(kindA(i), t, a, `_a${i}`, 0);
            const B = p.operand(kindB(i), t, b, `_b${i}`, 1);
            const d = p.b.compare(op, t, A, B);
            p.b.store('i16', global(p.r(`_r${i}`, 'i16')), d);
            checks.push({ desc: `${op}.${t} ${a}, ${b} [${kindA(i)},${kindB(i)}]`, label: `_r${i}`, type: 'i16', expected: CMP[op](a, b) ? -1n : 0n });
            i++;
          }
        }
        verifyChecks(exec({ quads: p.b.quads, globals: p.globals }), checks);
      });
    }
  }
  it('near the sign boundary: u16 32768 > 1, i16 -32768 < 1, u8 200 > 100, i8 -100 < 100, u32 2^31 > 1, i32 -2^31 < 1', () => {
    const p = new Prog();
    const cases: [IntType, CmpOp, bigint, bigint, bigint][] = [
      ['u16', 'gt', 32768n, 1n, -1n],
      ['i16', 'lt', -32768n, 1n, -1n],
      ['u8', 'gt', 200n, 100n, -1n],
      ['i8', 'lt', -100n, 100n, -1n],
      ['i8', 'lt', -128n, 127n, -1n],
      ['i8', 'gt', 127n, -128n, -1n],
      ['u32', 'gt', 0x80000000n, 1n, -1n],
      ['i32', 'lt', -0x80000000n, 1n, -1n],
      ['i32', 'gt', 0x7fffffffn, -0x80000000n, -1n],
      ['i16', 'gt', 32767n, -32768n, -1n],
      ['i16', 'ge', -32768n, 32767n, 0n],
      ['u16', 'lt', 32768n, 1n, 0n],
    ];
    const checks: Check[] = [];
    cases.forEach(([t, op, a, b, exp], i) => {
      const d = p.b.compare(op, t, imm(Number(a)), imm(Number(b)));
      p.b.store('i16', global(p.r(`_r${i}`, 'i16')), d);
      checks.push({ desc: `${op}.${t} ${a} ${b}`, label: `_r${i}`, type: 'i16', expected: exp });
    });
    verifyChecks(exec({ quads: p.b.quads, globals: p.globals }), checks);
  });
});

// ---------- unary ----------

describe('neg, not, abs', () => {
  for (const t of TYPES) {
    for (const op of ['neg', 'not', 'abs'] as const) {
      it(`${op}:${t}`, () => {
        const p = new Prog();
        const checks: Check[] = [];
        VALUES[t].forEach((a, i) => {
          const A = p.operand(KINDS[i % 5], t, a, `_a${i}`, 0);
          const d = p.b.unary(op, t, A);
          p.b.store(t, global(p.r(`_r${i}`, t)), d);
          const m = op === 'neg' ? -a : op === 'not' ? ~a : SIGNED(t) && a < 0n ? -a : a;
          checks.push({ desc: `${op}.${t} ${a}`, label: `_r${i}`, type: t, expected: norm(t, m) });
        });
        verifyChecks(exec({ quads: p.b.quads, globals: p.globals }), checks);
      });
    }
  }
});

// ---------- shifts ----------

describe('shl and shr', () => {
  const COUNTS = [0n, 1n, 2n, 3n, 4n, 5n, 7n, 8n, 9n, 15n, 16n, 17n, 31n, 32n, 33n, 255n];
  for (const t of TYPES) {
    for (const op of ['shl', 'shr'] as const) {
      it(`${op}:${t}, counts 0..255 (constant and variable)`, () => {
        const p = new Prog();
        const checks: Check[] = [];
        let i = 0;
        for (const a of [VALUES[t][1], VALUES[t][4], VALUES[t][6], VALUES[t][8], VALUES[t][9]]) {
          for (const n of COUNTS) {
            const A = p.operand(kindA(i), t, a, `_a${i}`, 0);
            const B = p.operand(kindB(i), 'u8', n, `_b${i}`, 1);
            const d = p.b.binary(op, t, A, B);
            p.b.store(t, global(p.r(`_r${i}`, t)), d);
            const m = op === 'shl' ? a << n : a >> n;
            checks.push({ desc: `${op}.${t} ${a}, ${n} [${kindA(i)},${kindB(i)}]`, label: `_r${i}`, type: t, expected: norm(t, m) });
            i++;
          }
        }
        verifyChecks(exec({ quads: p.b.quads, globals: p.globals }), checks);
      });
    }
  }
});

describe('constant shifts, every count (L5-CG: whole-byte moves, rotate-and-mask, unrolled and looped steps)', () => {
  for (const t of TYPES) {
    for (const op of ['shl', 'shr'] as const) {
      it(`${op}:${t} by the constants 0..${WIDTH[t] + 2}, a table of values, the operand in a register or not`, () => {
        const p = new Prog();
        const checks: Check[] = [];
        let i = 0;
        const values = VALUES[t].filter((_, k) => k % 2 === 0 || k < 6);
        for (const a of values) {
          for (let n = 0; n <= WIDTH[t] + 2; n++) {
            const A = p.operand(i % 3 === 0 ? 'temp' : kindA(i), t, a, `_a${i}`, 0);
            const d = p.b.binary(op, t, A, imm(n));
            p.b.store(t, global(p.r(`_r${i}`, t)), d);
            const m = op === 'shl' ? a << BigInt(n) : a >> BigInt(n);
            checks.push({ desc: `${op}.${t} ${a}, ${n} [${i % 3 === 0 ? 'temp' : kindA(i)}]`, label: `_r${i}`, type: t, expected: norm(t, m) });
            i++;
          }
        }
        verifyChecks(exec({ quads: p.b.quads, globals: p.globals }), checks);
      });
    }
  }
});

// ---------- casts ----------

describe('casts between integer types', () => {
  for (const from of TYPES) {
    for (const to of TYPES) {
      it(`cast ${to} <- ${from}`, () => {
        const p = new Prog();
        const checks: Check[] = [];
        VALUES[from].forEach((a, i) => {
          const A = p.operand(KINDS[i % 5], from, a, `_a${i}`, 0);
          const d = p.b.cast(to, from, A);
          p.b.store(to, global(p.r(`_r${i}`, to)), d);
          checks.push({ desc: `cast ${from}->${to} ${a}`, label: `_r${i}`, type: to, expected: norm(to, a) });
        });
        verifyChecks(exec({ quads: p.b.quads, globals: p.globals }), checks);
      });
    }
  }
});

// ---------- load and store ----------

describe('load and store', () => {
  for (const t of TYPES) {
    it(`store:${t} into a global, a frame slot and a BYREF slot, from every source kind`, () => {
      const p = new Prog();
      const checks: Check[] = [];
      VALUES[t].forEach((a, i) => {
        const src = p.operand(KINDS[i % 5], t, a, `_a${i}`, 0);
        const dstKind = i % 3;
        if (dstKind === 0) {
          p.b.store(t, global(p.r(`_r${i}`, t)), src);
          checks.push({ desc: `store ${a} -> global`, label: `_r${i}`, type: t, expected: norm(t, a) });
        } else if (dstKind === 1) {
          p.b.store(t, frame(40), src);
          p.b.store(t, global(p.r(`_r${i}`, t)), p.b.load(t, frame(40)));
          checks.push({ desc: `store ${a} -> frame, load back`, label: `_r${i}`, type: t, expected: norm(t, a) });
        } else {
          p.r(`_r${i}`, t);
          p.b.store('u16', frame(60), addr(`_r${i}`));
          p.b.store(t, frame(60, true), src);
          checks.push({ desc: `store ${a} -> byref`, label: `_r${i}`, type: t, expected: norm(t, a) });
        }
      });
      verifyChecks(exec({ quads: p.b.quads, globals: p.globals }), checks);
    });
    it(`load:${t} of an immediate does not disturb a neighbour`, () => {
      const p = new Prog();
      p.globals.push(glob('_n', t, WIDTH[t] / 8 + 2, new Array<number>(WIDTH[t] / 8 + 2).fill(0x55)));
      const v = VALUES[t][VALUES[t].length - 1];
      p.b.store(t, global('_n'), p.b.load(t, imm(Number(v))));
      const run = exec({ quads: p.b.quads, globals: p.globals });
      expect(readValue(run, t, '_n')).toBe(norm(t, v));
      expect(run.byteAt('_n', WIDTH[t] / 8)).toBe(0x55);
      expect(run.byteAt('_n', WIDTH[t] / 8 + 1)).toBe(0x55);
    });
  }
});

// ---------- jz, jnz ----------

describe('jz and jnz', () => {
  for (const t of TYPES) {
    for (const op of ['jz', 'jnz'] as const) {
      it(`${op}:${t}`, () => {
        const p = new Prog();
        const checks: Check[] = [];
        const vals = [...VALUES[t], 256n, 65536n, 0x01000000n, 0x80n].map((v) => norm(t, v));
        vals.forEach((a, i) => {
          const A = p.operand(KINDS[i % 5], t, a, `_a${i}`, 0);
          const out = global(p.r(`_r${i}`, 'u8'));
          const skip = p.b.newLabel();
          p.b.store('u8', out, imm(1));
          p.b.push({ op, type: t, a: A, label: skip, span: null });
          p.b.store('u8', out, imm(2));
          p.b.push({ op: 'label', label: skip, span: null });
          const taken = op === 'jz' ? a === 0n : a !== 0n;
          checks.push({ desc: `${op}.${t} ${a}`, label: `_r${i}`, type: 'u8', expected: taken ? 1n : 2n });
        });
        verifyChecks(exec({ quads: p.b.quads, globals: p.globals }), checks);
      });
    }
  }
});

// ---------- param, fparam ----------

describe('param and fparam', () => {
  const regs = (t: IntType, label: string): string =>
    WIDTH[t] === 8 ? `\tld (${label}), a` : WIDTH[t] === 16 ? `\tld (${label}), hl` : `\tld (${label}), hl\n\tld (${label}+2), de`;
  const unpush = (t: IntType, label: string): string =>
    WIDTH[t] === 8 ? `\tpop af\n\tld (${label}), a` : WIDTH[t] === 16 ? `\tpop hl\n\tld (${label}), hl` : `\tpop hl\n\tpop de\n\tld (${label}), hl\n\tld (${label}+2), de`;
  const asmQuad = (text: string): Quad => ({ op: 'asm', lines: text.split('\n').map((l) => ({ text: l, span: SPAN })), span: null });
  for (const t of TYPES) {
    it(`param:${t} pushes the value (u8/i8 as the high byte of a word) and fparam:${t} fills the result registers`, () => {
      const p = new Prog();
      const checks: Check[] = [];
      VALUES[t].forEach((a, i) => {
        const A = p.operand(KINDS[i % 5], t, a, `_a${i}`, 0);
        p.b.push({ op: 'param', type: t, a: A, span: null });
        p.r(`_p${i}`, t);
        p.b.push(asmQuad(unpush(t, `_p${i}`)));
        checks.push({ desc: `param ${a}`, label: `_p${i}`, type: t, expected: norm(t, a) });
        const B = p.operand(KINDS[(i + 2) % 5], t, a, `_c${i}`, 1);
        p.b.push({ op: 'fparam', type: t, a: B, span: null });
        p.r(`_f${i}`, t);
        p.b.push(asmQuad(regs(t, `_f${i}`)));
        checks.push({ desc: `fparam ${a}`, label: `_f${i}`, type: t, expected: norm(t, a) });
      });
      verifyChecks(exec({ quads: p.b.quads, globals: p.globals, verify: false }), checks);
    });
  }
  it('a u8 param takes two bytes on the stack, the value in the high byte', () => {
    const p = new Prog();
    p.globals.push(glob('_sp0', 'u16', 2, [0, 0]), glob('_sp1', 'u16', 2, [0, 0]), glob('_w', 'u16', 2, [0, 0]));
    p.b.push(asmQuad('\tld (_sp0), sp'));
    p.b.push({ op: 'param', type: 'u8', a: imm(0xab), span: null });
    p.b.push(asmQuad('\tld (_sp1), sp\n\tpop hl\n\tld (_w), hl'));
    const run = exec({ quads: p.b.quads, globals: p.globals, verify: false });
    expect(run.wordAt('_sp0') - run.wordAt('_sp1')).toBe(2);
    expect(run.wordAt('_w') >> 8).toBe(0xab);
  });
});

// ---------- peek, poke, in, out ----------

describe('peek, poke, in and out', () => {
  const BASE = 0x9100;
  for (const t of TYPES) {
    it(`poke:${t} writes little-endian at the address and nothing else`, () => {
      const p = new Prog();
      const w = WIDTH[t] / 8;
      p.globals.push(glob('_m', 'u8', 16 * 8, null, BASE));
      const checks: { addr: number; bytes: number[]; desc: string }[] = [];
      VALUES[t].forEach((a, i) => {
        const ad = BASE + 8 * i + 1;
        const k = KINDS[i % 5];
        let A: Operand;
        if (k === 'imm') A = imm(ad);
        else if (k === 'temp') A = p.b.load('u16', addr('_m', 8 * i + 1));
        else if (k === 'global') A = global(p.g(`_pa${i}`, 'u16', BigInt(ad)));
        else if (k === 'frame') {
          p.b.store('u16', frame(48), imm(ad));
          A = frame(48);
        } else {
          p.g(`_pa${i}`, 'u16', BigInt(ad));
          p.b.store('u16', frame(52), addr(`_pa${i}`));
          A = frame(52, true);
        }
        const V = p.operand(KINDS[(i + 1) % 5], t, a, `_v${i}`, 1);
        p.b.poke(t, A, V);
        checks.push({ addr: ad, bytes: bytesOf(a, w), desc: `poke.${t} ${a} [${k},${KINDS[(i + 1) % 5]}]` });
      });
      const run = exec({ quads: p.b.quads, globals: p.globals });
      expect(run.stopped).toBe('rst0');
      const bad: string[] = [];
      VALUES[t].forEach((_, i) => {
        const base = BASE + 8 * i;
        const c = checks[i];
        const expectBytes = [0, ...c.bytes, ...new Array<number>(7 - w).fill(0)];
        const got = Array.from(run.memory.slice(base, base + 8));
        if (got.join() !== expectBytes.join()) bad.push(`${c.desc}: got ${got.join(',')} expected ${expectBytes.join(',')}`);
      });
      expect(bad).toEqual([]);
    });
    it(`peek:${t} reads little-endian from the address`, () => {
      const p = new Prog();
      const w = WIDTH[t] / 8;
      p.globals.push(glob('_m', 'u8', 16 * 8, null, BASE));
      const checks: Check[] = [];
      const mem: [number, number[]][] = [];
      VALUES[t].forEach((a, i) => {
        const ad = BASE + 8 * i + 1;
        mem.push([ad, bytesOf(a, w)]);
        const k = KINDS[i % 5];
        let A: Operand;
        if (k === 'imm') A = imm(ad);
        else if (k === 'temp') A = p.b.load('u16', addr('_m', 8 * i + 1));
        else if (k === 'global') A = global(p.g(`_pa${i}`, 'u16', BigInt(ad)));
        else if (k === 'frame') {
          p.b.store('u16', frame(48), imm(ad));
          A = frame(48);
        } else {
          p.g(`_pa${i}`, 'u16', BigInt(ad));
          p.b.store('u16', frame(52), addr(`_pa${i}`));
          A = frame(52, true);
        }
        const d = p.b.peek(t, A);
        p.b.store(t, global(p.r(`_r${i}`, t)), d);
        checks.push({ desc: `peek.${t} ${a} [${k}]`, label: `_r${i}`, type: t, expected: norm(t, a) });
      });
      const run = exec({
        quads: p.b.quads,
        globals: p.globals,
        run: {
          setup: (cpc) => {
            for (const [ad, bytes] of mem) bytes.forEach((b, j) => (cpc.cpu.mem[ad + j] = b));
          },
        },
      });
      verifyChecks(run, checks);
    });
  }

  it('out and in use the full 16-bit port in BC', () => {
    const p = new Prog();
    const events: [number, number][] = [];
    const ports: number[] = [];
    const checks: Check[] = [];
    for (let i = 0; i < 10; i++) {
      const port = 0x2300 + i * 0x0101;
      ports.push(port);
      const k = KINDS[i % 5];
      const pv = p.operand(k, 'u16', BigInt(port), `_pt${i}`, 0);
      const vv = p.operand(KINDS[(i + 2) % 5], 'u8', BigInt(i * 25 + 1), `_vv${i}`, 1);
      p.b.out(pv, vv);
      const pi = p.operand(k, 'u16', BigInt(port), `_pi${i}`, 0);
      const d = p.b.in(pi);
      p.b.store('u8', global(p.r(`_r${i}`, 'u8')), d);
      checks.push({ desc: `in ${port.toString(16)}`, label: `_r${i}`, type: 'u8', expected: BigInt((port * 3 + 1) & 255) });
    }
    const run = exec({
      quads: p.b.quads,
      globals: p.globals,
      run: {
        setup: (cpc) => {
          const oldIn = cpc.cpu.onIn;
          const oldOut = cpc.cpu.onOut;
          cpc.cpu.onOut = (port, v) => {
            if (ports.includes(port)) events.push([port, v]);
            else oldOut(port, v);
          };
          cpc.cpu.onIn = (port) => (ports.includes(port) ? (port * 3 + 1) & 255 : oldIn(port));
        },
      },
    });
    verifyChecks(run, checks);
    expect(events).toEqual(ports.map((port, i) => [port, i * 25 + 1]));
  });
});

// ---------- the table ----------

describe('INT_TEMPLATES', () => {
  it('covers every op for every integer type, keyed op:type', () => {
    const ops = ['load', 'store', 'param', 'fparam', 'add', 'sub', 'mul', 'div', 'mod', 'neg', 'abs', 'and', 'or', 'xor', 'not', 'shl', 'shr', 'eq', 'ne', 'lt', 'le', 'gt', 'ge', 'jz', 'jnz', 'peek', 'poke'];
    for (const t of TYPES) for (const op of ops) expect(INT_TEMPLATES[`${op}:${t}`], `${op}:${t}`).toBeTypeOf('function');
    // casts are keyed cast:<from>-><to>; the integer table owns the 36 integer-to-integer keys
    for (const f of TYPES) for (const t of TYPES) expect(INT_TEMPLATES[`cast:${f}->${t}`], `cast:${f}->${t}`).toBeTypeOf('function');
    expect(INT_TEMPLATES['in:u8']).toBeTypeOf('function');
    expect(INT_TEMPLATES['out:u8']).toBeTypeOf('function');
  });
  it('a cast from a non-integer type is reported, not generated', () => {
    const diagnostics = new DiagnosticBag();
    const target = makeTarget({});
    const ir: IrProgram = {
      main: [{ op: 'cast', type: 'i16', from: 'f', dst: { k: 'temp', id: 0 }, a: imm(1), span: SPAN }],
      procedures: [],
      globals: [],
      strings: [],
      data: [],
      requires: [],
      inits: [],
    };
    generateWith({ ir, target, diagnostics, templates: [INT_TEMPLATES] }, []);
    expect(diagnostics.all().map((d) => d.code)).toEqual(['E002']);
  });
});

// ---------- the template-operand protocol (L5-TEMPS) reaches the wrapped templates ----------

describe('the frame-check wrapper (R17)', () => {
  it('passes the template-operand form through to the template it wraps', () => {
    const seen: (TempForm | undefined)[] = [];
    const inner: Template = (_q, _ctx, form) => {
      seen.push(form);
      return ['\tnop'];
    };
    const q = { op: 'load', type: 'i16', dst: { k: 'temp', id: 0, type: 'i16' }, a: imm(1) } as unknown as Quad;
    const ctx = { diagnostics: new DiagnosticBag() } as unknown as EmitContext;
    const form: TempForm = { inRegs: null, resultInRegs: true };
    expect(withFrameCheck(inner)(q, ctx, form)).toEqual(['\tnop']);
    expect(withFrameCheck(inner)(q, ctx)).toEqual(['\tnop']);
    expect(seen).toEqual([form, undefined]);
  });

  it('still emits nothing (and reports E002) for a frame operand out of IX range', () => {
    const inner: Template = () => ['\tnop'];
    const q = { op: 'load', type: 'i16', dst: { k: 'temp', id: 0, type: 'i16' }, a: frame(200) } as unknown as Quad;
    const bag = new DiagnosticBag();
    expect(withFrameCheck(inner)(q, { diagnostics: bag } as unknown as EmitContext, { inRegs: null, resultInRegs: true })).toEqual([]);
    expect(bag.all().map((d) => d.code)).toEqual(['E002']);
  });
});
