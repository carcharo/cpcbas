/**
 * L3-MATH on the test Z80: RND(0), RND(-n), a computed RND argument, RANDOMIZE and ROUND(x [, n]).
 * ROUND's expected values are the Locomotive interpreter's (tests/loco/probes/p-round.bas and
 * p-round2.bas, measured 2026-11-08 on the 464 and the 6128).
 * RND's random values are not Locomotive's; the tests check the rules (last value, same seed
 * same sequence), not the numbers.
 */
import { describe, expect, it } from 'vitest';
import { normalise, runSource } from './compile-helper.js';

const run = (source: string): string => {
  const r = runSource(source);
  expect(r.built.problems).toEqual([]);
  expect(r.stopped).toBe('rst0');
  return normalise(r.printer) as string;
};

/** ROUND results one per line, as the interpreter printed them (PRINT separates numbers with spaces). */
const rounds = (exprs: string[]): string[] => run(exprs.map((x) => `PRINT ROUND(${x})`).join('\n')).split('\n').filter((l) => l !== '').map((l) => l.trim());

describe('RND', () => {
  it('RND(0) gives the last value again, twice', () => {
    expect(run('a! = RND\nb! = RND(0)\nc! = RND(0)\nd! = RND\nPRINT a! = b!; b! = c!; d! <> a!')).toBe('-1 -1 -1 \n');
  });
  it('the same negative seed gives the same sequence; another seed another one', () => {
    const src = 'a! = RND(-3)\nb! = RND\nc! = RND\nx! = RND(-3)\ny! = RND\nz! = RND\nw! = RND(-10)\nPRINT a! = x!; b! = y!; c! = z!; a! <> w!; a! <> b!';
    expect(run(src)).toBe('-1 -1 -1 -1 -1 \n');
  });
  it('a computed argument decides its sign at run time: 0 last value, negative reseed, positive next', () => {
    const src = [
      'DIM n AS INTEGER',
      'n = -3',
      'a! = RND(n)',
      'n = 0',
      'b! = RND(n)',
      'n = 2',
      'c! = RND(n)',
      'n = -3',
      'd! = RND(n)',
      'n = 0',
      'e! = RND(n)',
      'PRINT a! = b!; c! <> b!; d! = a!; e! = d!',
    ].join('\n');
    expect(run(src)).toBe('-1 -1 -1 -1 \n');
  });
  it('a computed REAL argument works as well; every value is in [0, 1)', () => {
    expect(run('r! = -0.5\na! = RND(r!)\nr! = 1.5\nb! = RND(r!)\nPRINT a! >= 0 AND a! < 1; b! >= 0 AND b! < 1; a! <> b!')).toBe('-1 -1 -1 \n');
  });
});

describe('RANDOMIZE', () => {
  it('RANDOMIZE n is RND(-|n|): the same sequence again', () => {
    expect(run('RANDOMIZE 7\na! = RND\nb! = RND\nRANDOMIZE 7\nc! = RND\nd! = RND\nRANDOMIZE 1000\ne! = RND\nPRINT a! = c!; b! = d!; a! <> e!')).toBe('-1 -1 -1 \n');
  });
  it('RANDOMIZE with a computed seed; RANDOMIZE 0 is allowed and repeatable', () => {
    expect(run('s% = 100\nRANDOMIZE s%\na! = RND\nRANDOMIZE s%\nb! = RND\nRANDOMIZE 0\nc! = RND\nRANDOMIZE 0\nd! = RND\nPRINT a! = b!; c! = d!; a! <> c!')).toBe('-1 -1 -1 \n');
  });
  it('RANDOMIZE with no number seeds from the time and does not prompt', () => {
    // (the time is not a recorded seed, so the fake firmware could not answer a RND after it)
    expect(run('RANDOMIZE\nPRINT "done"')).toBe('done\n');
  });
});

describe('ROUND (values measured on the interpreter)', () => {
  it('half away from zero at n places, n = 0 when omitted', () => {
    expect(rounds(['2.567,2', '2.5', '-2.5', '2.5,0', '0.5', '-0.5', '0.49'])).toEqual(['2.57', '3', '-3', '3', '1', '-1', '0']);
  });
  it('a negative n rounds to tens, hundreds', () => {
    expect(rounds(['1234.5678,-2', '1250,-2', '-1250,-2', '1234.5678,-1', '1249,-2', '5,-1', '4,-1', '15,-1', '25,-1', '-15,-1', '7,-1'])).toEqual([
      '1200',
      '1300',
      '-1300',
      '1230',
      '1200',
      '10',
      '0',
      '20',
      '30',
      '-20',
      '10',
    ]);
  });
  it('decimal ties come out as a decimal would (binary 2.675 is just below)', () => {
    expect(rounds(['2.675,2', '1.005,2', '0.285,2', '1.45,1', '1.55,1', '-2.675,2', '0.15,1', '0.25,1', '0.35,1', '8.345,2', '4.35,1', '10.075,2'])).toEqual([
      '2.68',
      '1.01',
      '0.29',
      '1.5',
      '1.6',
      '-2.68',
      '0.2',
      '0.3',
      '0.4',
      '8.35',
      '4.4',
      '10.08',
    ]);
  });
  it('values near the 9-digit limit', () => {
    expect(rounds(['123456789.5', '123456789.4', '12345678.55,1', '123456789,-1', '123456789,-8', '123456789,-9', '123456789.123,3'])).toEqual([
      '123456790',
      '123456789',
      '12345678.6',
      '123456790',
      '100000000',
      '0',
      '123456789',
    ]);
    expect(rounds(['0.123456789,8', '0.123456789,9', '0.123456789,10', '1E-5,3', '0.0005,3', '99999.9999,2', '12345.6789,4', '12345.6789,5'])).toEqual([
      '0.12345679',
      '0.123456789',
      '0.123456789',
      '0',
      '0.001',
      '100000',
      '12345.6789',
      '12345.6789',
    ]);
  });
  it('a REAL n is rounded first (the interpreter: ROUND(2.567, 1.6) is 2.57, n = 0.4 gives 3)', () => {
    expect(rounds(['2.567,1.6', '2.567,0.4', '1234.5,-1.6'])).toEqual(['2.57', '3', '1200']);
  });
  it('large values, zero and the limits of n', () => {
    expect(rounds(['1,38', '1,39', '1E38,-38', '1.5E38,-37', '1.7E38,0', '1.7E38,2', '1.7E37,2', '1E-38,5', '1E30,-30', '0,3', '0,-3', '1,-38', '1,-39'])).toEqual([
      '1',
      '1',
      '1E+38',
      '1.5E+38',
      '1.7E+38',
      '1.7E+38',
      '1.7E+37',
      '0',
      '1E+30',
      '0',
      '0',
      '0',
      '0',
    ]);
    expect(rounds(['32767.5', '32768.4', '-32768.5', '2147483647.5'])).toEqual(['32768', '32768', '-32769', '2.14748E+09']);
  });
  it('n outside -39..39 is error 5 (Improper argument)', () => {
    for (const n of ['40', '41', '-40', '-45', '200', '-200']) {
      const r = runSource(`PRINT ROUND(1, ${n})`);
      expect(r.printer, n).toContain('Error 5');
    }
  });
  it('variables, integer arguments, a FIXED value, and a result that is a REAL', () => {
    expect(run('x! = 2.567\nn% = 2\nPRINT ROUND(x!, n%); ROUND(7, -1); ROUND(x!)\nDIM f AS FIXED = 1.25\nPRINT ROUND(f, 1)\nr! = ROUND(1234, -2) * 2\nPRINT r!')).toBe(' 2.57  10  3 \n 1.3 \n 2400 \n');
  });
  it('nested calls, a call in the places argument, and a negative value that rounds to zero prints 0', () => {
    expect(run('PRINT ROUND(ROUND(2.567, 2) * 10, ROUND(0.4)); ROUND(-0.4); ROUND(-0.004, 2); ROUND(1234.5678, ABS(-2))')).toBe(' 26  0  0  1234.57 \n');
  });
  it('ROUND(32767, -1) does not overflow: the result is a REAL', () => {
    expect(run('PRINT ROUND(32767, -1)')).toBe(' 32770 \n');
  });
});
