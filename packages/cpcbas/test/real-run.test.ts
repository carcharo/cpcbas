/**
 * L2-CG-REAL end to end: BASIC source through the whole library pipeline (check, lower, generate,
 * link, assemble) and onto the test Z80 with the printer echo on, for the REAL and FIXED features
 * the integer and string programs do not reach. `real-basic.bas` (tests/loco) is also compared
 * with the transcript the Locomotive interpreter printed for it (tests/loco/real-basic.expected,
 * blessed on the 464 and the 6128).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalise, runSource, transcriptsMatch } from './compile-helper.js';
import { repoRoot } from './z80sim/run.js';

const run = (source: string): string => {
  const r = runSource(source);
  expect(r.built.problems).toEqual([]);
  expect(r.stopped).toBe('rst0');
  return normalise(r.printer) as string;
};

describe('tests/loco/real-basic.bas', () => {
  it('compiles and prints what the interpreter printed', () => {
    // Blessed on the interpreter (464 and 6128 agree). Numbers are compared with the real rule, as the harness does.
    const expected = readFileSync(join(repoRoot, 'tests/loco/real-basic.expected'), 'latin1');
    const got = run(readFileSync(join(repoRoot, 'tests/loco/real-basic.bas'), 'latin1'));
    expect(transcriptsMatch(expected, got, 'real')).toBe(true);
  });
});

describe('REAL values', () => {
  it('arithmetic, comparisons and the number text', () => {
    expect(run('a! = 1.5\nb! = 2.25\nPRINT a! + b!; a! - b!; a! * b!; a! / b!\nPRINT -a!; ABS(-b!)\nPRINT a! < b!; a! >= b!; a! = 1.5; a! <> 1.5')).toBe(
      ' 3.75 -0.75  3.375  0.666666667 \n-1.5  2.25 \n-1  0 -1  0 \n',
    );
  });
  it('integers and reals mix: the integer is converted', () => {
    expect(run('i% = 3\nDIM l AS LONG = 100000\nr! = i% * 2.5\nPRINT r!; i% + 0.5; 10 / 4.0; l / 8.0; l * 1.5')).toBe(' 7.5  3.5  2.5  12500  150000 \n');
  });
  it('assigning a REAL to an integer truncates; CINT rounds half away from zero; INT floors; FIX truncates', () => {
    expect(run('r! = -2.5\ni% = r!\nPRINT i%; CINT(r!); CINT(2.5); CINT(-3.5); INT(r!); FIX(r!); INT(2.9); FIX(-0.5); CINT(0.49999); CINT(32767.4)')).toBe('-2 -3  3 -4 -3 -2  2  0  0  32767 \n');
  });
  it('SGN, MIN and MAX of reals, and PI', () => {
    expect(run('a! = 2.5\nb! = -1.5\nPRINT SGN(a!); SGN(b!); SGN(a! - 2.5); MIN(a!, b!); MAX(a!, b!); MIN(3, a!, b!); MAX(1.5, 2.5, 0.5)\nPRINT PI')).toBe(
      ' 1 -1  0 -1.5  2.5 -1.5  2.5 \n 3.14159265 \n',
    );
  });
  it('MIN and MAX keep the running value across a procedure call', () => {
    expect(run('FUNCTION f(x AS REAL) AS REAL\n  RETURN x * 2\nEND FUNCTION\nPRINT MAX(1.5, f(2.25), f(0.5))')).toBe(' 4.5 \n');
  });
  it('maths functions, with DEG and RAD', () => {
    expect(run('PRINT SQR(2); SQR(16); EXP(0); LOG(1); 2 ^ 0.5; 5 ^ 2\nPRINT (-8) ^ 3; 2 ^ -2\nDEG\nPRINT SIN(30); COS(60); TAN(45); ATN(1)\nRAD\nPRINT ATN(1); COS(0)')).toBe(
      ' 1.41421356  4  1  0  1.41421356  25 \n-512  0.25 \n 0.5  0.5  1  45 \n 0.785398163  1 \n',
    );
  });
  it('powers of a variable with a negative base: odd and even integer exponents', () => {
    expect(run('b! = -2\nPRINT b! ^ 3; b! ^ 2; b! ^ 0; b! ^ -1')).toBe('-8  4  1 -0.5 \n');
  });
  it('a negative base with a fractional exponent is error 5; division by zero prints its name and carries on (L4-ERR)', () => {
    const r = runSource('b! = -2\ne! = 0.5\nPRINT b! ^ e!');
    expect(r.printer).toContain('Error 5');
    // measured on the interpreter (loco-measured.md "REAL errors"): the name, a newline, then +max
    expect(run('a! = 0\nPRINT 1 / a!')).toBe('Division by zero\n 1.70141E+38 \n');
  });
  it('VAL gives a REAL, STR$ prints it without the trailing space', () => {
    expect(run('PRINT VAL("1.5") * 2; VAL("-2.5E3"); VAL("abc"); VAL(" 12")\nPRINT STR$(0.1); "|"; STR$(-2.5); "|"; STR$(1E10); "|"; LEN(STR$(1/3.0))')).toBe(' 3 -2500  0  12 \n 0.1|-2.5| 1E+10| 12 \n');
  });
  it('REAL conditions, FOR loops with a REAL step and WHILE', () => {
    expect(run('FOR x! = 0 TO 1 STEP 0.25\nPRINT x!;\nNEXT\nPRINT\nFOR x! = 1 TO 0 STEP -0.5\nPRINT x!;\nNEXT\nPRINT\nn! = 2.5\nIF n! THEN PRINT "t"\nn! = 0\nIF n! THEN PRINT "t2" ELSE PRINT "f2"\nWHILE n! < 2\nn! = n! + 0.75\nWEND\nPRINT n!')).toBe(
      ' 0  0.25  0.5  0.75  1 \n 1  0.5  0 \nt\nf2\n 2.25 \n',
    );
  });
  it('REAL parameters, BYREF and results of procedures', () => {
    expect(
      run(
        'FUNCTION half(x AS REAL) AS REAL\n  RETURN x / 2\nEND FUNCTION\nSUB show(v AS REAL, BYREF w AS REAL)\n  PRINT v; w\n  w = w * 2\nEND SUB\nDIM q AS REAL = 3\nPRINT half(5)\nshow(1.25, q)\nPRINT q',
      ),
    ).toBe(' 2.5 \n 1.25  3 \n 6 \n');
  });
  it('RND is in [0, 1) and changes', () => {
    expect(run('a! = RND\nb! = RND(1)\nPRINT a! >= 0 AND a! < 1; b! >= 0 AND b! < 1; a! <> b!')).toBe('-1 -1 -1 \n');
  });
  it('DATA with REAL items and READ into REAL variables (integer items convert)', () => {
    expect(run('DATA 1.5, 2, -3.25E2, 70000, 0.1\nREAD a!, b!, c!, d!, e!\nPRINT a!; b!; c!; d!; e!\nRESTORE\nREAD x!\nPRINT x!')).toBe(' 1.5  2 -325  70000  0.1 \n 1.5 \n');
  });
  it('a REAL item read into an integer variable is rounded (measured: Locomotive gives 2 for 1.5; was error 2 before L3-LOCOFIX)', () => {
    expect(normalise(runSource('DATA 1.5\nREAD a%\nPRINT a%').printer)).toBe(' 2 \n');
  });
});

describe('FIXED values', () => {
  it('arithmetic, comparisons and the number text of a FIXED variable', () => {
    expect(
      run('DIM f AS FIXED = 1.5\nDIM g AS FIXED\ng = f * 2.5 + 0.25\nPRINT f; g; -g; ABS(-g); g / 8\nPRINT f < g; f = 1.5; g <> f\nPRINT STR$(g); "|"; STR$(-f)'),
    ).toBe(' 1.5  4 -4  4  0.5 \n-1 -1 -1 \n 4|-1.5\n');
  });
  it('INT, FIX and CINT of a FIXED; conversions to integers and REAL', () => {
    expect(run('DIM g AS FIXED = -2.5\nPRINT INT(g); FIX(g); CINT(g); CINT(2.5)\ni% = g\nr! = g\nPRINT i%; r! * 2\nDIM h AS FIXED\nh = 1.3\nPRINT h')).toBe('-3 -2 -3  3 \n-2 -5 \n 1.30000305 \n');
  });
  it('MIN and MAX of FIXED values (through the REAL routines; review R9)', () => {
    expect(run('DIM a AS FIXED = 1.5\nDIM b AS FIXED = -2.25\nDIM m AS FIXED\nm = MIN(a, b)\nPRINT m; MAX(a, b); MIN(a, b, 0.5); MAX(b, 3)')).toBe('-2.25  1.5 -2.25  3 \n');
  });
  it('div:f16 divides the first operand by the second (divf16.asm\'s header comment says the reverse)', () => {
    expect(run('DIM a AS FIXED = 1\nDIM b AS FIXED = 4\nPRINT a / b; b / a; a / 8; 2 / b')).toBe(' 0.25  4  0.125  0.5 \n');
  });
  it('FIXED division by zero is error 11', () => {
    expect(runSource('DIM g AS FIXED = 1\nDIM z AS FIXED\nPRINT g / z').printer).toContain('Error 11');
  });
});
