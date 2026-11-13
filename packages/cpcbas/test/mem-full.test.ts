/**
 * Follow-up 50 (L3-FIX): a string allocation that fails raises Memory full (Locomotive error 7). Before, the
 * allocator returned 0 and the string routines carried on with an empty or truncated result.
 */
import { describe, expect, it } from 'vitest';
import { runSource } from './compile-helper.js';

function memoryFull(body: string): void {
  const r = runSource(['DIM s AS STRING', 'DIM t AS STRING', 'DIM i AS INTEGER', ...body.split('\n'), 'PRINT "not reached"'].join('\n'));
  expect(r.printer).toContain('Error 7');
  expect(r.printer).not.toContain('Error 3');
  expect(r.printer).not.toContain('not reached');
}

describe('a failed string allocation is error 7', () => {
  it('s$ = s$ + STRING$(200, "x") in a loop (strcat, STRING$)', () => {
    memoryFull('FOR i = 1 TO 100: s = s + STRING$(200, "x"): NEXT i');
  });
  it('doubling a long string (strcat of a string and itself)', () => {
    memoryFull('s = STRING$(255, "y")\nFOR i = 1 TO 100: s = s + s: NEXT i');
  });
  it('building with CHR$ and a long copy (CHR$, string load)', () => {
    memoryFull('t = STRING$(255, "z")\nFOR i = 1 TO 100: s = s + CHR$(65) + t: NEXT i');
  });
  it('slices of a long string (MID$, LEFT$, RIGHT$)', () => {
    memoryFull('t = STRING$(255, "q")\ns = t\nFOR i = 1 TO 100: s = s + LEFT$(t, 200) + MID$(t, 5, 100) + RIGHT$(t, 50): NEXT i');
  });
  it('a program that stays inside the heap is unaffected', () => {
    const r = runSource(['DIM s AS STRING', 'DIM i AS INTEGER', 'FOR i = 1 TO 50: s = STRING$(200, "x"): NEXT i', 'PRINT LEN(s)'].join('\n'));
    expect(r.printer).not.toContain('Error');
    expect(r.printer).toContain('200');
  });
});
