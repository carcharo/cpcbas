/**
 * L3-GOSUB: GOSUB, ON ... GOSUB and RETURN inside a SUB or FUNCTION, on the simulator. The expected
 * values are worked out by hand from the Locomotive manual (RETURN ends the GOSUB; RETURN with
 * nothing pending is error 3, "Unexpected RETURN"), not taken from the compiler's output.
 */
import { describe, expect, it } from 'vitest';
import { lowerSource, normalise, runSource } from './compile-helper.js';
import type { AssembledRun, RunOptions } from './z80sim/run.js';

function exec(source: string, options: RunOptions = {}): AssembledRun {
  const r = runSource(source, options);
  expect(r.built.problems).toEqual([]);
  expect(r.built.diagnostics.filter((d) => d.startsWith('E'))).toEqual([]);
  return r;
}
const run = (source: string): string => {
  const r = exec(source);
  expect(r.stopped).toBe('rst0');
  return normalise(r.printer) as string;
};
const word = (r: AssembledRun, a: number): number => (r.memory[a] as number) | ((r.memory[a + 1] as number) << 8);
/** Bytes free on the heap: the sum of the free list's blocks. */
function heapFree(r: AssembledRun): number {
  let total = 0;
  let p = word(r, r.image.addr('.core.ZXBASIC_MEM_HEAP') + 2);
  for (let guard = 0; p !== 0 && guard < 10000; guard++) {
    total += word(r, p);
    p = word(r, p + 2);
  }
  return total;
}

describe('GOSUB inside a procedure', () => {
  it('the subroutine reads and writes the procedure locals and parameters', () => {
    // x: 5 -> 5*2+1 = 11 -> 23; the parameter k is added once
    const src = [
      'SUB Work(k AS INTEGER)',
      '  DIM x AS INTEGER',
      '  x = 5',
      '  GOSUB Bump',
      '  GOSUB Bump',
      '  PRINT x; k',
      '  EXIT SUB',
      'Bump:',
      '  x = x * 2 + 1 + k',
      '  k = 0',
      '  RETURN',
      'END SUB',
      'Work(1)',
      'PRINT "end"',
    ].join('\n');
    // first Bump: 5*2+1+1 = 12, k = 0; second: 12*2+1+0 = 25
    expect(run(src)).toBe(' 25  0 \nend\n');
  });

  it('works with line numbers as targets and GOSUB after other statements', () => {
    const src = ['SUB Work()', '  DIM n AS INTEGER', '  n = 7', '  PRINT "a";', '  GOSUB 100', '  PRINT n', '  EXIT SUB', '100 n = n + 1', '  RETURN', 'END SUB', 'Work()'].join('\n');
    expect(run(src)).toBe('a 8 \n');
  });

  it('nested GOSUBs return in order', () => {
    const src = [
      'SUB T()',
      '  DIM n AS INTEGER',
      '  GOSUB A',
      '  PRINT n',
      '  EXIT SUB',
      'A:',
      '  n = n + 1',
      '  GOSUB B',
      '  n = n + 100',
      '  RETURN',
      'B:',
      '  n = n + 10',
      '  GOSUB C',
      '  RETURN',
      'C:',
      '  n = n + 1000',
      '  RETURN',
      'END SUB',
      'T()',
    ].join('\n');
    expect(run(src)).toBe(' 1111 \n');
  });

  it('ON ... GOSUB inside a procedure, with the selector out of range falling through', () => {
    const src = [
      'SUB T(sel AS INTEGER)',
      '  DIM n AS INTEGER',
      '  ON sel GOSUB One, Two',
      '  PRINT n',
      '  EXIT SUB',
      'One:',
      '  n = n + 1',
      '  RETURN',
      'Two:',
      '  n = n + 20',
      '  RETURN',
      'END SUB',
      'T(1): T(2): T(0): T(3)',
    ].join('\n');
    expect(run(src)).toBe(' 1 \n 20 \n 0 \n 0 \n');
  });

  it('a FASTCALL SUB without locals gets a frame when it has a GOSUB', () => {
    const src = ['SUB FASTCALL P()', '  GOSUB Go', '  PRINT "back"', '  EXIT SUB', 'Go:', '  PRINT "go";', '  RETURN', 'END SUB', 'P()', 'P()', 'PRINT "end"'].join('\n');
    expect(run(src)).toBe('goback\ngoback\nend\n');
  });

  it('a FUNCTION mixes GOSUB with RETURN value (the value tells the two apart)', () => {
    const src = [
      'FUNCTION F(n AS INTEGER) AS INTEGER',
      '  DIM r AS INTEGER',
      '  r = n',
      '  GOSUB Twice',
      '  GOSUB Twice',
      '  IF r > 100 THEN RETURN 0',
      '  RETURN r + 1',
      'Twice:',
      '  r = r * 2',
      '  RETURN',
      'END FUNCTION',
      'PRINT F(3); F(30)',
    ].join('\n');
    expect(run(src)).toBe(' 13  0 \n');
  });

  it('a FUNCTION with EXIT FUNCTION while a GOSUB is pending still returns its name value', () => {
    const src = [
      'FUNCTION F() AS INTEGER',
      '  F = 4',
      '  GOSUB Sub1',
      'Sub1:',
      '  F = F + 3',
      '  EXIT FUNCTION',
      'END FUNCTION',
      'PRINT F()',
    ].join('\n');
    expect(run(src)).toBe(' 7 \n');
  });

  it('recursion with a GOSUB in each level keeps one pending GOSUB per activation', () => {
    // Sum(n) = 2n + Sum(n-1), Sum(0) = 0: Sum(4) = 8 + 6 + 4 + 2 = 20
    const src = [
      'FUNCTION Sum(n AS INTEGER) AS INTEGER',
      '  DIM t AS INTEGER',
      '  IF n = 0 THEN RETURN 0',
      '  GOSUB Dbl',
      '  RETURN t + Sum(n - 1)',
      'Dbl:',
      '  t = n * 2',
      '  RETURN',
      'END FUNCTION',
      'PRINT Sum(4)',
    ].join('\n');
    expect(run(src)).toBe(' 20 \n');
  });

  it('a recursive call made from inside the subroutine (the outer GOSUB pending) returns correctly', () => {
    // R(n): GOSUB L; L: if n > 0 then R(n-1); RETURN. Prints the unwinding order.
    const src = [
      'SUB R(n AS INTEGER)',
      '  GOSUB L',
      '  PRINT n;',
      '  EXIT SUB',
      'L:',
      '  IF n > 0 THEN R(n - 1)',
      '  RETURN',
      'END SUB',
      'R(3)',
      'PRINT',
    ].join('\n');
    expect(run(src)).toBe(' 0  1  2  3 \n');
  });
});

describe('RETURN with no GOSUB pending in a procedure is error 3', () => {
  const failing = (body: string[], call = 'S()'): string => {
    const r = exec([...body, call, 'PRINT "not reached"'].join('\n'));
    expect(r.printer).not.toContain('not reached');
    return r.printer;
  };

  it('before any GOSUB ran', () => {
    expect(failing(['SUB S()', '  DIM k AS INTEGER', '  PRINT "in";', '  IF k = 1 THEN GOSUB Z', '  RETURN', 'Z:', '  RETURN', 'END SUB'])).toContain('Error 3');
  });

  it('after the GOSUB has returned (one RETURN too many)', () => {
    const out = failing(['SUB S()', '  GOSUB Z', '  PRINT "after";', '  RETURN', 'Z:', '  RETURN', 'END SUB']);
    expect(out).toContain('after');
    expect(out).toContain('Error 3');
  });

  it('in a recursive activation with nothing pending, although the caller has a GOSUB pending', () => {
    const out = failing(['SUB S(d AS INTEGER)', '  IF d = 0 THEN RETURN', '  GOSUB Z', '  EXIT SUB', 'Z:', '  S(d - 1)', '  PRINT "unwound";', '  RETURN', 'END SUB'], 'S(2)');
    expect(out).toContain('Error 3');
    expect(out).not.toContain('unwound');
  });

  it('in a FUNCTION', () => {
    const out = failing(['FUNCTION S() AS INTEGER', '  RETURN', 'Z:', '  RETURN', '  GOSUB Z', 'END FUNCTION'], 'PRINT S()');
    expect(out).toContain('Error 3');
  });

  it('does not fire when the RETURN is reached inside nested constructs with a GOSUB pending', () => {
    const src = [
      'SUB S()',
      '  DIM i AS INTEGER',
      '  GOSUB Z',
      '  EXIT SUB',
      'Z:',
      '  FOR i = 1 TO 3',
      '    SELECT CASE i',
      '    CASE 2',
      '      PRINT "two";',
      '      RETURN',
      '    END SELECT',
      '  NEXT',
      '  RETURN',
      'END SUB',
      'S()',
      'PRINT "ok"',
    ].join('\n');
    expect(run(src)).toBe('twook\n');
  });
});

describe('compile-time rules', () => {
  const errs = (src: string): string[] => lowerSource(src).diagnostics.filter((d) => d.startsWith('E'));

  it('RETURN alone in a procedure without a GOSUB is E251 with the EXIT SUB hint', () => {
    const r = lowerSource('SUB S()\n  RETURN\nEND SUB');
    expect(r.diagnostics.some((d) => d.startsWith('E251'))).toBe(true);
    expect(errs('SUB S()\n  RETURN\nEND SUB')).toHaveLength(1);
  });

  it('a GOSUB to a line or label outside the procedure is E207', () => {
    expect(errs('SUB S()\n  GOSUB 100\nEND SUB\nEND\n100 RETURN').some((d) => d.startsWith('E207'))).toBe(true);
    expect(errs('GOSUB Inner\nEND\nSUB S()\nInner:\n  RETURN\nEND SUB').some((d) => d.startsWith('E207'))).toBe(true);
  });
});

describe('stack and heap stay balanced', () => {
  const big = { maxTStates: 2_000_000_000 };
  const spy = [
    'FUNCTION GetSp() AS UINTEGER',
    '  ASM',
    '  ld hl, 0',
    '  add hl, sp',
    '  END ASM',
    'END FUNCTION',
  ];
  const program = (calls: number): string[] => [
    ...spy,
    'SUB W(n AS INTEGER)',
    '  DIM s AS STRING',
    '  DIM a(10) AS INTEGER',
    '  DIM b(3) AS STRING',
    '  s = "hello" + STR$(n)',
    '  b(2) = s + s',
    '  a(10) = n',
    '  GOSUB L',
    '  PRINT "never"',
    '  EXIT SUB',
    'L:',
    '  GOSUB M',
    '  PRINT "never"',
    '  RETURN',
    'M:',
    '  IF n >= 0 THEN EXIT SUB',
    '  RETURN',
    'END SUB',
    'DIM i AS INTEGER',
    'POKE &A000, 0',
    `FOR i = 1 TO ${calls}: W(i): NEXT`,
    'DIM sp AS UINTEGER',
    'sp = GetSp()',
    'POKE &A000, sp MOD 256',
    'POKE &A001, sp \\ 256',
    'PRINT "done"',
  ];

  it('EXIT SUB with two GOSUBs pending, 1000 calls: same stack pointer, same free heap as after 2 calls', () => {
    const many = exec(program(1000).join('\n'), big);
    const few = exec(program(2).join('\n'), big);
    expect(normalise(many.printer)).toBe('done\n');
    expect(heapFree(many)).toBe(heapFree(few));
    expect(many.memory[0xa000]).toBe(few.memory[0xa000]);
    expect(many.memory[0xa001]).toBe(few.memory[0xa001]);
    // the spy must have run: SP is below &B800
    expect((many.memory[0xa001] as number) > 0).toBe(true);
  });

  it('the same loop with the pending GOSUBs removed by RETURN (normal path) is balanced too', () => {
    const src = [
      'SUB W(n AS INTEGER)',
      '  DIM s AS STRING',
      '  s = "x" + STR$(n)',
      '  GOSUB L',
      '  GOSUB L',
      '  EXIT SUB',
      'L:',
      '  s = s + "y"',
      '  RETURN',
      'END SUB',
      'DIM i AS INTEGER',
      'FOR i = 1 TO 1000: W(i): NEXT',
      'PRINT "done"',
    ].join('\n');
    const few = exec(src.replace('1 TO 1000', '1 TO 2'), big);
    const many = exec(src, big);
    expect(heapFree(many)).toBe(heapFree(few));
  });
});
