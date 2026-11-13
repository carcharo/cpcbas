/**
 * L5-HOT (follow-up 59): the firmware builds compare, INT and FIX on the five bytes of Locomotive's layout
 * and link no calculator (lib/loco/fmathcmp.asm, realfn.asm). The expected values are the firmware's own,
 * recorded on CPCEC through the Locomotive ROMs (tests/fixtures/fwmath-vectors.json: CMP, INT, FIX), and the
 * calculator of the bare builds is the second oracle: both bodies run on the same values and must agree.
 * Every operand is given as bytes; no expected value is made by the code under test.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { libTree } from './runtime-tree.js';
import { buildSource } from './compile-helper.js';
import { assembleText, repoRoot, runProgram } from './z80sim/run.js';

const files: Record<string, string> = {};
for (const [path, text] of libTree()) if (path.startsWith('loco/')) files[path] = text;

interface OpData {
  inputs: string[];
  results: Record<string, string[] | string>;
}
const doc = JSON.parse(readFileSync(join(repoRoot, 'tests/fixtures/fwmath-vectors.json'), 'utf8')) as { ops: Record<string, OpData> };
const bytes = (h: string): number[] => (h.match(/../g) ?? []).map((x) => parseInt(x, 16));

type Real = readonly number[];

const LABELS = { eq: '__LOCO_FEQ', ne: '__LOCO_FNE', lt: '__LOCO_FLT', le: '__LOCO_FLE', gt: '__LOCO_FGT', ge: '__LOCO_FGE' } as const;
const COMPARES = Object.keys(LABELS) as (keyof typeof LABELS)[];

/** A program that applies every comparison to every pair of the table; returns A per pair and entry, and the stack check. */
function compareAll(pairs: readonly (readonly [Real, Real])[], bare: boolean): { out: number[][]; sp0: number; sp1: number; ix: number; iy: number } {
  const n = pairs.length;
  const calls = COMPARES.map(
    (c, k) =>
      ` ld a,(ix+0)\n ld e,(ix+1)\n ld d,(ix+2)\n ld c,(ix+3)\n ld b,(ix+4)\n push bc\n push de\n push af\n` +
      ` ld a,(ix+5)\n ld e,(ix+6)\n ld d,(ix+7)\n ld c,(ix+8)\n ld b,(ix+9)\n call .core.${LABELS[c]}\n ld (iy+${k}),a\n`,
  ).join('');
  const body =
    `${bare ? ' call .core.CPC_INIT_FP_CALC\n' : ''} ld (sp0),sp\n ld ix,tbl\n ld iy,outv\n ld hl,${n}\n ld (cnt),hl\nnext:\n${calls}` +
    ` ld de,10\n add ix,de\n ld de,6\n add iy,de\n ld hl,(cnt)\n dec hl\n ld (cnt),hl\n ld a,h\n or l\n jp nz,next\n ld (sp1),sp\n ld (ixs),ix\n ld (iys),iy`;
  const table = pairs.map(([a, b]) => ` DEFB ${[...a, ...b].join(',')}`).join('\n');
  const r = runProgram(
    {
      body,
      data: `cnt: DEFW 0\nsp0: DEFW 0\nsp1: DEFW 0\nixs: DEFW 0\niys: DEFW 0\ntbl:\n${table}\noutv: DEFS ${6 * n + 6}`,
      include: ['loco/fmath.asm', 'loco/fmathcmp.asm', ...(bare ? ['loco/fmathcalc.asm'] : [])],
      heap: true,
    },
    { files, defines: bare ? { __CPC_PRINTER_ECHO__: '1', CPC_BAREMETAL: '1' } : { __CPC_PRINTER_ECHO__: '1' }, maxTStates: 2_000_000_000 } as never,
  );
  expect(r.stopped).toBe('rst0');
  const at = r.image.addr('outv');
  const tbl = r.image.addr('tbl');
  return {
    out: pairs.map((_, i) => Array.from(r.memory.subarray(at + 6 * i, at + 6 * i + 6))),
    sp0: r.wordAt('sp0'),
    sp1: r.wordAt('sp1'),
    ix: r.wordAt('ixs') - tbl - 10 * n,
    iy: r.wordAt('iys') - at - 6 * n,
  };
}

/** Which truth values the three-way result t (1: a > b, 0: equal, -1: a < b) gives the six comparisons. */
const truth = (t: number): number[] => [t === 0, t !== 0, t < 0, t <= 0, t > 0, t >= 0].map(Number);

describe('REAL comparisons without the calculator (firmware builds)', () => {
  const v = doc.ops.CMP!;
  const res = v.results['6128'] as string[];
  const pairs = v.inputs.map((s): readonly [Real, Real] => {
    const [a, b] = s.split(' ').map(bytes);
    return [a!, b!];
  });
  const want = res.map((r) => {
    const a = parseInt(r.split(' ')[0]!, 16);
    return a === 0xff ? -1 : a;
  });

  it('gives all six comparisons for the 2000 pairs the firmware compared (its CMP is the order of the values)', () => {
    const r = compareAll(pairs, false);
    const bad = r.out.findIndex((o, i) => truth(want[i]!).some((x, k) => x !== o[k]));
    expect(bad, bad < 0 ? '' : `pair ${v.inputs[bad]}: want ${truth(want[bad]!)} got ${r.out[bad]}`).toBe(-1);
    expect(r.sp1).toBe(r.sp0);
    expect(r.ix).toBe(0);
    expect(r.iy).toBe(0);
  });

  it('is what the calculator of a bare build says on the same pairs', () => {
    const fw = compareAll(pairs, false).out;
    const bare = compareAll(pairs, true).out;
    const bad = fw.findIndex((o, i) => o.slice(0, 6).join() !== bare[i]!.slice(0, 6).join());
    expect(bad, bad < 0 ? '' : `pair ${v.inputs[bad]}: firmware ${fw[bad]} bare ${bare[bad]}`).toBe(-1);
  });

  it('treats a zero with junk mantissa bytes, and either sign of zero, as the zero', () => {
    const z1: Real = [0x12, 0x34, 0x56, 0x78, 0];
    const z2: Real = [0, 0, 0, 0x80, 0]; // the firmware's NEG(0)
    const one: Real = [0, 0, 0, 0, 0x81];
    const minusOne: Real = [0, 0, 0, 0x80, 0x81];
    const r = compareAll(
      [
        [z1, z2],
        [z2, z1],
        [z1, one],
        [one, z2],
        [z2, minusOne],
        [minusOne, z1],
      ],
      false,
    ).out;
    expect(r.map((o) => o.slice(0, 6))).toEqual([0, 0, -1, 1, 1, -1].map((t) => truth(t)));
  });
});

// ---- INT and FIX ----

/** The REAL bytes of a signed integer magnitude (a BigInt below 2^32), by the layout of docs/ir.md. */
function realOf(mag: bigint, neg: boolean): number[] {
  if (mag === 0n) return [0, 0, 0, 0, 0];
  const len = mag.toString(2).length;
  const m = mag << BigInt(32 - len);
  return [Number(m & 0xffn), Number((m >> 8n) & 0xffn), Number((m >> 16n) & 0xffn), Number((m >> 24n) & 0x7fn) | (neg ? 0x80 : 0), 128 + len];
}

function convert(label: string, values: readonly Real[], bare: boolean): number[][] {
  const n = values.length;
  const body =
    `${bare ? ' call .core.CPC_INIT_FP_CALC\n' : ''} ld ix,tbl\n ld iy,outv\n ld hl,${n}\n ld (cnt),hl\nnext:\n` +
    ` ld a,(ix+0)\n ld e,(ix+1)\n ld d,(ix+2)\n ld c,(ix+3)\n ld b,(ix+4)\n call .core.${label}\n` +
    ` ld (iy+0),a\n ld (iy+1),e\n ld (iy+2),d\n ld (iy+3),c\n ld (iy+4),b\n` +
    ` ld de,5\n add ix,de\n add iy,de\n ld hl,(cnt)\n dec hl\n ld (cnt),hl\n ld a,h\n or l\n jp nz,next`;
  const r = runProgram(
    {
      body,
      data: `cnt: DEFW 0\ntbl:\n${values.map((x) => ` DEFB ${x.join(',')}`).join('\n')}\noutv: DEFS ${5 * n + 5}`,
      include: ['loco/realfn.asm'],
      heap: true,
    },
    { files, defines: bare ? { __CPC_PRINTER_ECHO__: '1', CPC_BAREMETAL: '1' } : { __CPC_PRINTER_ECHO__: '1' }, maxTStates: 2_000_000_000 } as never,
  );
  expect(r.stopped).toBe('rst0');
  const at = r.image.addr('outv');
  return values.map((_, i) => Array.from(r.memory.subarray(at + 5 * i, at + 5 * i + 5)));
}

describe.each([
  ['__LOCO_INT', 'INT'],
  ['__LOCO_FIX', 'FIX'],
])('%s without the calculator (firmware and bare builds)', (label, op) => {
  const v = doc.ops[op]!;
  const res = v.results['6128'] as string[];
  const inputs = v.inputs.map((s) => bytes(s));

  it.each([false, true])(`gives the integer the firmware's ${op} gives for the ${inputs.length} recorded values (and an integer REAL for a value of 2^32 or more, unchanged), bare %s`, (bare) => {
    const got = convert(label, inputs, bare);
    inputs.forEach((x, i) => {
      const [r4, b, f] = res[i]!.split(' ');
      const carry = (parseInt(f!, 16) & 1) !== 0;
      let want: number[];
      if (carry) {
        const k = bytes(r4!);
        const mag = BigInt(k[0]! | (k[1]! << 8) | (k[2]! << 16)) | (BigInt(k[3]!) << 24n);
        want = realOf(mag, (parseInt(b!, 16) & 0x80) !== 0 && mag !== 0n);
      } else want = x; // 2^32 or more: the REAL is its own integer part
      const same = want[4] === 0 ? got[i]![4] === 0 : got[i]!.every((y, j) => y === want[j]);
      expect(same, `${op} ${v.inputs[i]}: want ${want} got ${got[i]}`).toBe(true);
    });
  });

  it.each([false, true])('is the exact floor / truncation for every exponent from 2^-9 to 2^33, both signs, many mantissas, -65536 and the value above it included, bare %s', (bare) => {
    const vals: Real[] = [];
    let seed = 12345;
    const rnd = (): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed >>> 8;
    };
    for (let e = 0x78; e <= 0xa3; e++) {
      for (const sign of [0, 0x80]) {
        for (let k = 0; k < 7; k++) {
          const m = [rnd() & 255, rnd() & 255, rnd() & 255, rnd() & 0x7f];
          if (k === 0) m.fill(0); // exact powers of two
          if (k === 1) m.splice(0, 4, 255, 255, 255, 0x7f); // the largest mantissa
          if (k === 2) m[0] = m[1] = 0; // few bits
          vals.push([m[0]!, m[1]!, m[2]!, m[3]! | sign, e]);
        }
      }
    }
    vals.push([9, 8, 7, 6, 0], [0, 0, 0, 0x80, 0], [0, 0, 0, 0, 0]); // zeros: junk mantissa, the NEG zero, plain
    // follow-up 199: -65536 and the value just above it, which the calculator's small-integer form got wrong
    vals.push([0, 0, 0, 0x80, 0x91], [255, 255, 255, 0xff, 0x90]);
    // the oracle: (2^31 + f) * 2^(e - 160), the integer part of its magnitude, one more for INT of a negative with a fraction
    const exact = (x: Real): Real => {
      if (x[4] === 0) return [0, 0, 0, 0, 0];
      const e = x[4];
      if (e >= 160) return x;
      const neg = (x[3] & 0x80) !== 0;
      const num = (1n << 31n) | BigInt(x[0] | (x[1] << 8) | (x[2] << 16)) | (BigInt(x[3] & 0x7f) << 24n);
      const s = BigInt(160 - e);
      let mag = num >> s;
      if (op === 'INT' && neg && (num & ((1n << s) - 1n)) !== 0n) mag += 1n;
      return mag === 0n ? [0, 0, 0, 0, 0] : realOf(mag, neg);
    };
    const got = convert(label, vals, bare);
    const bad = vals.findIndex((x, i) => {
      const want = exact(x);
      return want[4] === 0 ? got[i]![4] !== 0 : got[i]!.join() !== want.join();
    });
    expect(bad, bad < 0 ? '' : `${vals[bad]}: want ${exact(vals[bad]!)} got ${got[bad]}`).toBe(-1);
  });
});

describe('INT and FIX on values the calculator got wrong (follow-up 199; firmware and bare builds)', () => {
  it.each([false, true])('INT(-65535.99999) is -65536 and INT(-65536), FIX(-65536) are themselves; -1.5 is -2 and -0.5 is -1, bare %s', (bare) => {
    const minus65536: Real = [0, 0, 0, 0x80, 0x91];
    const justAbove: Real = [255, 255, 255, 0xff, 0x90];
    const m15: Real = [0, 0, 0, 0xc0, 0x81];
    const m05: Real = [0, 0, 0, 0x80, 0x80];
    expect(convert('__LOCO_INT', [minus65536, justAbove, m15, m05], bare)).toEqual([minus65536, minus65536, [0, 0, 0, 0x80, 0x82], [0, 0, 0, 0x80, 0x81]]);
    expect(convert('__LOCO_FIX', [minus65536, justAbove, m15, m05], bare)).toEqual([minus65536, [0, 0, 255, 0xff, 0x90], [0, 0, 0, 0x80, 0x81], [0, 0, 0, 0, 0]]);
  });
});

// ---- follow-up 186: the glyph renderer and its font are linked by what prints ----

describe('the glyph renderer and __CPC_FONT in a bare build (follow-up 186)', () => {
  const linked = (src: string, label: string): boolean => {
    const built = buildSource(src, { CPC_BAREMETAL: '1', CPC_OWNFONT: '1' });
    expect(built.diagnostics.filter((d) => d.startsWith('E'))).toEqual([]);
    const syms = assembleText(built.asm, { defines: built.defines, files }).symbols;
    return [...syms.keys()].some((k) => k === label || k.endsWith(`.${label}`));
  };

  it('a program that clears the screen, moves the cursor and reads POS and VPOS links neither', () => {
    const src = 'DIM a AS INTEGER\nMODE 1\nCLS\nLOCATE 3, 4\na = POS(#0) + VPOS(#0)\n';
    expect(linked(src, '__LOCO_CLS')).toBe(true);
    expect(linked(src, '__LOCO_CURSOR')).toBe(true);
    expect(linked(src, '__CPC_FONT')).toBe(false);
    expect(linked(src, '__BT_PUTC')).toBe(false);
    expect(linked(src, 'CPC_INIT_11_GLYPHS')).toBe(false);
  });

  it.each([
    ['PRINT', 'PRINT "hi"'],
    ['PRINT of a number', 'PRINT 42'],
    ['INPUT', 'DIM a AS INTEGER\nINPUT a'],
    ['PRINT USING', 'PRINT USING "##"; 5'],
  ])('%s links the renderer and the font', (_n, src) => {
    expect(linked(src, '__CPC_FONT')).toBe(true);
    expect(linked(src, '__BT_PUTC')).toBe(true);
    expect(linked(src, 'CPC_INIT_11_GLYPHS')).toBe(true);
  });
});
