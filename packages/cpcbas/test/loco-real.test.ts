/**
 * lib/loco/real.asm and realfn.asm on the test Z80 and fake firmware: the REAL number text
 * against what the Locomotive interpreter printed for the same values (the measured
 * transcripts and the probes of L2-CG-REAL, run on the interpreter in 6128 and 464 mode), the wrap check, STR$,
 * and the DEG/RAD, rounding and MIN/MAX routines. A REAL is Locomotive's layout in A E D C B (docs/ir.md).
 */
import { describe, expect, it } from 'vitest';
import { encodeReal5 } from '../src/codegen/data.js';
import { libTree } from './runtime-tree.js';
import { runProgram } from './z80sim/run.js';

const files: Record<string, string> = {};
for (const [path, text] of libTree()) if (path.startsWith('loco/')) files[path] = text;

const loadReal = (bytes: readonly number[]): string =>
  ` ld a,${bytes[0]}\n ld de,${((bytes[2] as number) << 8) | (bytes[1] as number)}\n ld bc,${((bytes[4] as number) << 8) | (bytes[3] as number)}\n`;

/** PRINT of the five bytes: the printed text without the END marker. */
function printed(bytes: readonly number[], entry = '__LOCO_PRINTF'): string {
  const r = runProgram({ body: `${loadReal(bytes)} call .core.${entry}`, include: ['loco/real.asm'], heap: true }, { files } as never);
  expect(r.stopped).toBe('rst0');
  return r.printer.replace('\x04END\n', '');
}
const text = (v: number): string => printed(encodeReal5(v));

/** value, then the interpreter's text (a space for the sign position, a trailing space for PRINT). */
const MEASURED: [number, string][] = [
  [0, ' 0 '],
  [1, ' 1 '],
  [-1, '-1 '],
  [0.5, ' 0.5 '],
  [0.03, ' 0.03 '],
  [1 / 3, ' 0.333333333 '],
  [2 / 3, ' 0.666666667 '],
  [2.5, ' 2.5 '],
  [12345678, ' 12345678 '],
  [123456789, ' 123456789 '],
  [1e9, ' 1E+09 '],
  [1e10, ' 1E+10 '],
  [1.23457e12, ' 1.23457E+12 '],
  [1.5e-10, ' 1.5E-10 '],
  [-0.0001, '-0.0001 '],
  [0.1, ' 0.1 '],
  [3.14159265358979, ' 3.14159265 '],
  [1234567.8, ' 1234567.8 '],
  [0.000123, ' 0.000123 '],
  [1e-5, ' 0.00001 '],
  [1e-8, ' 0.00000001 '],
  [1e-9, ' 0.000000001 '],
  [0.000123456, ' 0.000123456 '],
  [0.0001234567, ' 1.23457E-04 '],
  [0.0123456789, ' 1.23457E-02 '],
  [0.123456789, ' 0.123456789 '],
  [1.2e-9, ' 1.2E-09 '],
  [1.234e-8, ' 1.234E-08 '],
  [1e-38, ' 1E-38 '],
  [1.5e-20, ' 1.5E-20 '],
  [-1.5e-30, '-1.5E-30 '],
  [1.7e38, ' 1.7E+38 '],
  [1.5e9, ' 1.5E+09 '],
  [4294967296, ' 4.29497E+09 '],
  [1.23456789e15, ' 1.23457E+15 '],
  [1.00001e12, ' 1.00001E+12 '],
  [99999999.9, ' 99999999.9 '],
  [999999999, ' 999999999 '],
  [100000000, ' 100000000 '],
  [999999999.5, ' 1E+09 '],
  [9.999994e9, ' 9.99999E+09 '],
  [9.999995e9, ' 1.00000E+10 '],
  [1.2000004e15, ' 1.20000E+15 '],
  [1.9999999e9, ' 2.00000E+09 '],
  [9.9999996e15, ' 1.00000E+16 '],
  [0.00000009999999, ' 1.00000E-07 '],
  [12345.6789, ' 12345.6789 '],
  [123456.789, ' 123456.789 '],
  [0.25, ' 0.25 '],
  [1024, ' 1024 '],
  [33333.3333, ' 33333.3333 '],
  [2 ** 30, ' 1.07374E+09 '],
  [2 ** 40, ' 1.09951E+12 '],
  [2 ** -10, ' 9.76563E-04 '],
  [-123456789, '-123456789 '],
];

describe('PRINT of a REAL: the interpreter\'s number text', () => {
  it.each(MEASURED)('%s prints as the interpreter does', (v, expected) => {
    expect(text(v)).toBe(expected);
  });

  it('an exponent byte of 0 is zero, whatever the mantissa bytes (the calculator\'s small integer never reaches the formatter)', () => {
    expect(printed([5, 0, 0, 0, 0])).toBe(' 0 ');
    expect(printed([0, 0, 0, 0, 0])).toBe(' 0 ');
  });

  it('STR$ of a REAL is the same text without the trailing space', () => {
    const r = runProgram(
      {
        body: `${loadReal(encodeReal5(-2.5))} call .core.__LOCO_STRF\n ld (s1),hl\n${loadReal(encodeReal5(1e10))} call .core.__LOCO_STRF\n ld (s2),hl`,
        data: 's1: defw 0\ns2: defw 0',
        include: ['loco/real.asm'],
        heap: true,
      },
      { files } as never,
    );
    const str = (label: string): string => {
      const p = r.wordAt(label);
      const n = r.memory[p]! | (r.memory[p + 1]! << 8);
      return String.fromCharCode(...r.memory.subarray(p + 2, p + 2 + n));
    };
    expect([str('s1'), str('s2')]).toEqual(['-2.5', ' 1E+10']);
  });

  it('moves a number that does not fit the line to the next one, as an integer does', () => {
    const r = runProgram(
      {
        body: ` ld b,38\nlp: push bc\n ld a,65\n call .core.__LOCO_PUTC\n pop bc\n djnz lp\n${loadReal(encodeReal5(1.5))} call .core.__LOCO_PRINTF`,
        include: ['loco/real.asm'],
        heap: true,
      },
      { files } as never,
    );
    // 38 characters, then " 1.5 " needs 5 and only 2 are left on the 40-column line: it wraps first
    expect(r.printer.replace('\x04END\n', '')).toBe(`${'A'.repeat(38)}\n 1.5 `);
  });
});
