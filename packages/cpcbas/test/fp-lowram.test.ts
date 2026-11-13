/**
 * Follow-up 43 (L3-FIX): the floating-point calculator must not write to &0000-&0004.
 *
 * Cause: the Spectrum ROM's SKIP-CONS ($33F7) calls STK-CONST with DE = 0, a write into the ROM that the
 * Spectrum ignores. fp_calc.asm kept `ld de, 0`, and on the CPC the lower ROM is paged out while the program
 * runs, so &0000-&0004 is RAM: five bytes of every SKIP-CONS (series evaluation: SQR, SIN, COS, TAN, ATN, LN,
 * EXP, powers) were zeroed. &0000 holds the firmware's RST 0 routine (01 89 7F ED 49 ...), so a program that
 * ended by RST 0 on hardware jumped into a zeroed reset routine. The simulator keeps the lower 16K as RAM too,
 * so the write shows here: the test pokes a pattern into &0000-&0004 first.
 */
import { describe, expect, it } from 'vitest';
import { normalise, runSource } from './compile-helper.js';

const PATTERN = [1, 137, 127, 237, 73]; // the first bytes of the firmware's RST 0 routine in low RAM (measured, chipsrun)

function bytesAfter(statement: string): string {
  const src = [
    'DIM f AS REAL',
    'DIM i AS INTEGER',
    ...PATTERN.map((v, i) => `POKE ${i}, ${v}`),
    'f = 0.7',
    statement,
    'FOR i = 0 TO 4: PRINT PEEK(i);: NEXT i',
    'PRINT',
  ].join('\n');
  const r = runSource(src);
  expect(r.stopped).toBe('rst0');
  return normalise(r.printer) as string;
}

describe('the FP calculator leaves &0000-&0004 alone', () => {
  const want = ' 1  137  127  237  73 \n';
  for (const stmt of ['f = SQR(16)', 'f = SIN(f)', 'f = COS(f)', 'f = TAN(f)', 'f = ATN(f)', 'f = LOG(f)', 'f = EXP(f)', 'f = f ^ 2.5', 'f = LOG10(f)']) {
    it(stmt, () => {
      expect(bytesAfter(stmt)).toBe(want);
    });
  }
});
