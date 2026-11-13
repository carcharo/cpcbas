/**
 * L3-FIX: a local `DIM x AS T = <non-constant>` is evaluated at the DIM's place in the body
 * (before, the initialiser was dropped and the variable stayed 0 or empty).
 */
import { describe, expect, it } from 'vitest';
import { normalise, runSource } from './compile-helper.js';

const run = (source: string): string => {
  const r = runSource(source);
  expect(r.built.problems).toEqual([]);
  expect(r.built.diagnostics.filter((d) => d.startsWith('E'))).toEqual([]);
  expect(r.stopped).toBe('rst0');
  return normalise(r.printer) as string;
};

describe('local initialisers that are not constants', () => {
  it('a call: FUNCTION B2 returns G()', () => {
    expect(
      run(
        [
          'FUNCTION G() AS INTEGER',
          '  RETURN 7',
          'END FUNCTION',
          'FUNCTION B2() AS INTEGER',
          '  DIM m AS INTEGER = G()',
          '  RETURN m',
          'END FUNCTION',
          'PRINT B2()',
        ].join('\n'),
      ),
    ).toBe(' 7 \n');
  });

  it('an expression of a parameter: n + 1 with n = 4', () => {
    expect(
      run(['SUB S(n AS INTEGER)', '  DIM m AS INTEGER = n + 1', '  PRINT m', 'END SUB', 'S(4)'].join('\n')),
    ).toBe(' 5 \n');
  });

  it('a STRING, owned like any local: the heap is balanced over many calls', () => {
    expect(
      run(
        [
          'FUNCTION Greet(n AS STRING) AS STRING',
          '  DIM s AS STRING = "Hello, " + n',
          '  DIM t AS STRING = s + "!"',
          '  RETURN t',
          'END FUNCTION',
          'DIM i AS INTEGER',
          'DIM r AS STRING',
          'FOR i = 1 TO 300',
          '  r = Greet("Ann")',
          'NEXT',
          'PRINT r',
        ].join('\n'),
      ),
    ).toBe('Hello, Ann!\n');
  });

  it('a REAL', () => {
    expect(
      run(['SUB R(n AS INTEGER)', '  DIM x AS REAL = n * 1.5', '  PRINT x', 'END SUB', 'R(3)'].join('\n')),
    ).toBe(' 4.5 \n');
  });

  it('an initialiser that reads an earlier local (itself non-constant or constant)', () => {
    expect(
      run(
        [
          'SUB Chn(n AS INTEGER)',
          '  DIM a AS INTEGER = n + 1',
          '  DIM b AS INTEGER = a * 2',
          '  DIM c AS INTEGER = 10',
          '  DIM d AS INTEGER = b + c',
          '  PRINT a; b; c; d',
          'END SUB',
          'Chn(4)',
        ].join('\n'),
      ),
    ).toBe(' 5  10  10  20 \n');
  });

  it('evaluated again on each iteration of a loop that holds the DIM, and after an early EXIT SUB path', () => {
    expect(
      run(
        [
          'SUB Loop3(n AS INTEGER)',
          '  DIM i AS INTEGER',
          '  FOR i = 1 TO 3',
          '    DIM k AS INTEGER = n * i',
          '    PRINT k;',
          '  NEXT',
          '  PRINT',
          'END SUB',
          'SUB Early(n AS INTEGER)',
          '  IF n = 0 THEN EXIT SUB',
          '  DIM s AS STRING = STR$(n)',
          '  PRINT s',
          'END SUB',
          'Loop3(2)',
          'Early(0)',
          'Early(9)',
        ].join('\n'),
      ),
    ).toBe(' 2  4  6 \n 9\n');
  });
});
