/**
 * L3-ARR-PROC: local arrays, array parameters, array elements as BYREF arguments, UBOUND of a
 * parameter, nested-list shape checks, the frame range check. Simulator runs through the real pipeline.
 */
import { describe, expect, it } from 'vitest';
import { lowerSource, normalise, runSource } from './compile-helper.js';

const run = (source: string): string => {
  const r = runSource(source);
  expect(r.built.problems).toEqual([]);
  expect(r.built.diagnostics.filter((d) => d.startsWith('E'))).toEqual([]);
  expect(r.stopped).toBe('rst0');
  return normalise(r.printer) as string;
};
const errs = (src: string): string[] => lowerSource(src).diagnostics.filter((d) => d.startsWith('E'));

describe('local arrays', () => {
  it('a local array is zeroed, indexed and read back', () => {
    expect(
      run(
        [
          'FUNCTION SumSq(n AS INTEGER) AS INTEGER',
          '  DIM t(9) AS INTEGER',
          '  DIM i AS INTEGER',
          '  DIM s AS INTEGER',
          '  FOR i = 0 TO n - 1: t(i) = i * i: NEXT',
          '  FOR i = 0 TO n - 1: s = s + t(i): NEXT',
          '  RETURN s + t(9)',
          'END FUNCTION',
          'PRINT SumSq(5)',
        ].join('\n'),
      ),
    ).toBe(' 30 \n');
  });

  it('50 calls of a SUB with a local array leave the heap as it was (the 4 KB heap could not hold 50)', () => {
    expect(
      run(
        [
          'SUB Work()',
          '  DIM b(100) AS INTEGER',
          '  b(100) = 7',
          '  b(0) = b(100) + 1',
          'END SUB',
          'SUB WorkStr()',
          '  DIM s(20) AS STRING',
          '  s(20) = "abcdefghijklmnopqrstuvwxyz"',
          '  s(3) = s(20) + s(20)',
          'END SUB',
          'DIM i AS INTEGER',
          'FOR i = 1 TO 50: Work(): WorkStr(): NEXT',
          'PRINT "ok"',
        ].join('\n'),
      ),
    ).toBe('ok\n');
  });

  it('a heap that cannot hold the array raises Memory full (error 7)', () => {
    const r = runSource(['SUB Work()', '  DIM b(3000) AS INTEGER', 'END SUB', 'Work()', 'PRINT "not reached"'].join('\n'));
    expect(r.printer).toContain('Error 7');
    expect(r.printer).not.toContain('not reached');
  });

  it('#pragma heap_size sets the heap: 3000 INTEGERs fit in 8000 bytes, not in the default 4768 (R11)', () => {
    const src = ['SUB Work()', '  DIM b(3000) AS INTEGER', '  b(3000) = 3', '  PRINT b(3000)', 'END SUB', 'Work()'];
    expect(run(['#pragma heap_size = 8000', ...src].join('\n'))).toBe(' 3 \n');
    expect(runSource(src.join('\n')).printer).toContain('Error 7');
  });

  it('a 2-dimensional local array of REAL, and UBOUND folded', () => {
    expect(
      run(
        [
          'SUB Go()',
          '  DIM m(2, 3) AS REAL',
          '  m(2, 3) = 1.5',
          '  m(1, 1) = m(2, 3) * 2',
          '  PRINT m(1, 1); m(0, 0); UBOUND(m, 1); UBOUND(m, 2)',
          'END SUB',
          'Go()',
        ].join('\n'),
      ),
    ).toBe(' 3  0  2  3 \n');
  });

  it('a recursive FUNCTION with a local string array', () => {
    expect(
      run(
        [
          'FUNCTION Build(n AS INTEGER) AS STRING',
          '  DIM w(2) AS STRING',
          '  w(0) = "a" + STR$(n)',
          '  IF n > 0 THEN w(1) = Build(n - 1)',
          '  RETURN w(0) + w(1)',
          'END FUNCTION',
          'PRINT Build(3)',
        ].join('\n'),
      ),
    ).toBe('a 3a 2a 1a 0\n');
  });

  it('a string array with an initial list is stored on every entry and freed on exit', () => {
    expect(
      run(
        [
          'SUB Show()',
          '  DIM n(2) AS STRING => {"x", "", "zz"}',
          '  PRINT n(0); n(1); n(2)',
          '  n(0) = n(0) + "!"',
          'END SUB',
          'Show()',
          'Show()',
        ].join('\n'),
      ),
    ).toBe('xzz\nxzz\n');
  });

  it('a numeric initial list is copied on entry', () => {
    expect(
      run(
        [
          'SUB Show()',
          '  DIM v(3) AS UBYTE => {5, 6, 7}',
          '  PRINT v(0); v(1); v(2); v(3)',
          '  v(0) = 99',
          'END SUB',
          'Show()',
          'Show()',
        ].join('\n'),
      ),
    ).toBe(' 5  6  7  0 \n 5  6  7  0 \n');
  });

  it('EXIT SUB frees the array too', () => {
    expect(
      run(
        [
          'SUB Early(n AS INTEGER)',
          '  DIM s(3) AS STRING',
          '  s(1) = "hello"',
          '  IF n = 1 THEN EXIT SUB',
          '  PRINT s(1)',
          'END SUB',
          'Early(1)',
          'Early(0)',
        ].join('\n'),
      ),
    ).toBe('hello\n');
  });

  it('READ into an element of a local array', () => {
    expect(
      run(['SUB Rd()', '  DIM a(2) AS INTEGER', '  READ a(0), a(1), a(2)', '  PRINT a(2) + a(0)', 'END SUB', 'Rd()', 'DATA 4, 5, 6'].join('\n')),
    ).toBe(' 10 \n');
  });
});

describe('array parameters', () => {
  it('Sum(v() AS UBYTE) over a global and a local array', () => {
    expect(
      run(
        [
          'FUNCTION Sum(v() AS UBYTE, n AS INTEGER) AS INTEGER',
          '  DIM i AS INTEGER',
          '  DIM s AS INTEGER',
          '  FOR i = 0 TO n - 1: s = s + v(i): NEXT',
          '  RETURN s',
          'END FUNCTION',
          'DIM g(4) AS UBYTE => {1, 2, 3, 4, 5}',
          'SUB Local()',
          '  DIM l(2) AS UBYTE => {10, 20, 30}',
          '  PRINT Sum(l, 3)',
          'END SUB',
          'PRINT Sum(g, 5)',
          'Local()',
        ].join('\n'),
      ),
    ).toBe(' 15 \n 60 \n');
  });

  it('UBOUND and LBOUND of a parameter, a parameter passed on, a write through it', () => {
    expect(
      run(
        [
          'SUB Filler(a() AS INTEGER)',
          '  DIM i AS INTEGER',
          '  FOR i = LBOUND(a, 1) TO UBOUND(a, 1): a(i) = i * 10: NEXT',
          'END SUB',
          'SUB Outer(a() AS INTEGER)',
          '  Filler(a)',
          '  PRINT UBOUND(a, 1); UBOUND(a, 0); UBOUND(a)',
          'END SUB',
          'DIM g(3) AS INTEGER',
          'DIM m(2, 5) AS INTEGER',
          'Outer(g)',
          'PRINT g(0); g(3)',
          'SUB Two(a() AS INTEGER)',
          '  PRINT UBOUND(a, 1); UBOUND(a, 2); UBOUND(a, 0)',
          'END SUB',
          'Two(m)',
        ].join('\n'),
      ),
    ).toBe(' 3  1  3 \n 0  30 \n 2  5  2 \n');
  });

  it('a 2-dimensional parameter indexes through the runtime', () => {
    expect(
      run(
        [
          'FUNCTION Elt(m() AS INTEGER, i AS INTEGER, j AS INTEGER) AS INTEGER',
          '  RETURN m(i, j)',
          'END FUNCTION',
          'DIM g(2, 2) AS INTEGER',
          'g(1, 2) = 12',
          'g(2, 0) = 20',
          'PRINT Elt(g, 1, 2); Elt(g, 2, 0)',
        ].join('\n'),
      ),
    ).toBe(' 12  20 \n');
  });

  it('a string array parameter', () => {
    expect(
      run(
        [
          'SUB Set(s() AS STRING)',
          '  s(1) = "hi"',
          'END SUB',
          'DIM g(2) AS STRING',
          'Set(g)',
          'PRINT g(1)',
        ].join('\n'),
      ),
    ).toBe('hi\n');
  });

  it('@a of a parameter and of a local array is its first element', () => {
    expect(
      run(
        [
          'SUB P(a() AS UBYTE)',
          '  POKE @a, 77',
          'END SUB',
          'SUB Q()',
          '  DIM l(1) AS UBYTE',
          '  POKE @l, 5',
          '  PRINT l(0); PEEK(@l)',
          'END SUB',
          'DIM g(1) AS UBYTE',
          'P(g)',
          'PRINT g(0)',
          'Q()',
        ].join('\n'),
      ),
    ).toBe(' 77 \n 5  5 \n');
  });
});

describe('array elements as BYREF arguments', () => {
  it('an element of a global, local and parameter array', () => {
    expect(
      run(
        [
          'SUB Inc(BYREF x AS INTEGER)',
          '  x = x + 1',
          'END SUB',
          'SUB Via(a() AS INTEGER)',
          '  Inc(a(2))',
          'END SUB',
          'SUB Loc()',
          '  DIM l(3) AS INTEGER',
          '  DIM i AS INTEGER',
          '  i = 1',
          '  Inc(l(i))',
          '  Inc(l(i))',
          '  PRINT l(1)',
          'END SUB',
          'DIM g(3) AS INTEGER',
          'Inc(g(0))',
          'Via(g)',
          'Via(g)',
          'PRINT g(0); g(2)',
          'Loc()',
        ].join('\n'),
      ),
    ).toBe(' 1  2 \n 2 \n');
  });

  it('a string element by reference', () => {
    expect(
      run(
        [
          'SUB Bang(BYREF s AS STRING)',
          '  s = s + "!"',
          'END SUB',
          'DIM g(1) AS STRING',
          'g(1) = "x"',
          'Bang(g(1))',
          'PRINT g(1)',
        ].join('\n'),
      ),
    ).toBe('x!\n');
  });
});

describe('shape of nested initial lists (follow-up 45)', () => {
  it('a ragged list is an error with the expected and found counts', () => {
    const e = errs('DIM a(1, 1) AS INTEGER => {{1, 2}, {3}}');
    expect(e.length).toBe(1);
    expect(e[0]).toMatch(/E246/);
    expect(e[0]).toMatch(/2/);
    expect(e[0]).toMatch(/1/);
  });
  it('a ragged list in a local array too', () => {
    const e = errs('SUB S()\n  DIM a(1, 2) AS INTEGER => {{1, 2, 3}, {4, 5}}\nEND SUB');
    expect(e.some((d) => d.includes('E246'))).toBe(true);
  });
  it('a regular nested list and a flat list pass', () => {
    expect(errs('DIM a(1, 1) AS INTEGER => {{1, 2}, {3, 4}}\nDIM b(1, 1) AS INTEGER => {1, 2, 3, 4}\nDIM c(3) AS INTEGER => {1}')).toEqual([]);
  });
  it('nesting deeper than the dimensions is an error', () => {
    expect(errs('DIM a(2) AS INTEGER => {{1}, {2}}').some((d) => d.includes('E246'))).toBe(true);
  });
});

describe('frame range', () => {
  it('a frame past 128 bytes is E002 at the procedure, not an assembler error', () => {
    const decl = Array.from({ length: 65 }, (_, i) => `  DIM v${i} AS INTEGER`).join('\n');
    const e = errs(`SUB Big()\n${decl}\nEND SUB\nBig()`);
    expect(e.length).toBeGreaterThan(0);
    expect(e.every((d) => d.includes('E002'))).toBe(true);
  });
  it('a local array does not count against the frame beyond its 8-byte descriptor', () => {
    expect(errs('SUB Big()\n  DIM a(5000) AS INTEGER\n  a(1) = 1\nEND SUB\nBig()')).toEqual([]);
  });
});
