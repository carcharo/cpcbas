/**
 * Follow-up 64 (review R12): a program that uses FIXED and no REAL arithmetic must not link the
 * floating-point calculator. STR$ of a FIXED converts it to a REAL (`__LOCO_FF16`, fmathcv.asm) and
 * prints that; fmathcv.asm took the byte-order swap from fmathcalc.asm, which includes fp_calc.asm, so
 * every such program carried the calculator (about 2.3 KB, its init and its stack). The swap is in
 * fmathrev.asm now. Expected texts are Locomotive's number text of exact 16.16 values (worked by hand).
 */
import { describe, expect, it } from 'vitest';
import { buildSource, normalise, runSource } from './compile-helper.js';
import { libTree } from './runtime-tree.js';
import { assembleText } from './z80sim/run.js';

const loco: Record<string, string> = {};
for (const [path, text] of libTree()) if (path.startsWith('loco/')) loco[path] = text;

/** The labels of the assembled image (every file the program links, transitively). */
function symbols(src: string, defines: Record<string, string>): ReadonlyMap<string, unknown> {
  const built = buildSource(src, defines);
  expect(built.diagnostics.filter((d) => d.startsWith('E'))).toEqual([]);
  return assembleText(built.asm, { defines: built.defines, files: loco }).symbols;
}
const has = (syms: ReadonlyMap<string, unknown>, label: string): boolean => [...syms.keys()].some((k) => k === label || k.endsWith(`.${label}`));

const SRC = [
  'DIM a AS FIXED',
  'DIM b AS FIXED',
  'a = 1.5',
  'b = 2.25',
  'PRINT STR$(a + b); STR$(a - b); STR$(a * 2)',
  'IF a < b THEN PRINT "lt"',
].join('\n');

// labels that only the calculator defines: one of fp_calc.asm's chunks (named in follow-up 64) and stackf.asm's push
const CALCULATOR = ['L32D7', '__FPSTACK_PUSH'];

describe('a FIXED-only program does not link the calculator (follow-up 64)', () => {
  for (const [mode, defines] of [
    ['firmware', {}],
    ['bare', { CPC_BAREMETAL: '1' }],
  ] as const) {
    it(`${mode}: no calculator label in the image`, () => {
      const syms = symbols(SRC, defines);
      expect(has(syms, '__LOCO_FF16')).toBe(true);
      for (const label of CALCULATOR) expect(has(syms, label), label).toBe(false);
    });
  }

  it('still prints the values', () => {
    const r = runSource(SRC);
    expect(normalise(r.printer)).toBe(' 3.75-0.75 3\nlt\n');
  });

  it('a REAL comparison in a bare build still links it (so the check above can fail)', () => {
    const syms = symbols('DIM f AS REAL\nf = 0.7\nIF f < 1 THEN PRINT "y"', { CPC_BAREMETAL: '1' });
    for (const label of CALCULATOR) expect(has(syms, label), label).toBe(true);
  });

  // L5-HOT (follow-up 59): in a firmware build REAL comparisons, INT, FIX, CINT, the integer conversions and the
  // arithmetic go to the firmware or to routines of their own; nothing links the calculator
  it('a firmware build with REAL comparisons, + - * /, INT, FIX, CINT, VAL and STR$ links no calculator', () => {
    const src = [
      'DIM f AS REAL',
      'DIM g AS REAL',
      'DIM n AS INTEGER',
      'f = 0.7',
      'g = f * 3 + 1 / f',
      'IF f < g THEN PRINT "lt"',
      'IF f = g OR f >= g OR f <> g OR f > g OR f <= g THEN PRINT "other"',
      'n = CINT(g) + INT(g) + FIX(g)',
      'PRINT n; STR$(g); VAL("2.5") + g',
    ].join('\n');
    const syms = symbols(src, {});
    expect(has(syms, '__LOCO_FLT')).toBe(true);
    for (const label of CALCULATOR) expect(has(syms, label), label).toBe(false);
  });
});
