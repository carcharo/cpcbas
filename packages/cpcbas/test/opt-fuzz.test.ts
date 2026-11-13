/**
 * L5-DIFF layer 2: tests of the generator, the shrinker, and the proof that a wrong pass is caught (see opt-fuzz.shared.ts for the
 * fuzzer itself, split over opt-fuzz-1..4.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { generate, render } from './fuzz/gen.js';
import { OPT_LEVELS, asmAt, dropFirstStore, withAsmHook } from './opt-harness.js';
import { findFailure } from './opt-fuzz.shared.js';

describe('the generator', () => {
  it('is deterministic', () => {
    expect(render(generate(42))).toBe(render(generate(42)));
    expect(render(generate(42))).not.toBe(render(generate(43)));
  });

  it('covers the constructs of the correctness guard over the fixed seeds', () => {
    const all = Array.from({ length: 200 }, (_, i) => render(generate(i + 1))).join('\n');
    const want: Record<string, RegExp> = {
      'every integer type': /AS BYTE[\s\S]*AS UBYTE[\s\S]*AS INTEGER[\s\S]*AS UINTEGER[\s\S]*AS LONG[\s\S]*AS ULONG/,
      MOD: / MOD /,
      'integer division': / \\ /,
      shifts: / (<<|>>) /,
      'NOT and AND/OR': /NOT [\s\S]*\) AND \(/,
      'a FOR with a negative step': /STEP -\d/,
      'a FOR with a variable step': /STEP (p?sv\d)/,
      WHILE: /WHILE /,
      GOSUB: /GOSUB G\d/,
      SUB: /^SUB Sb\d\(/m,
      FUNCTION: /^FUNCTION Fn\d\(.*\) AS /m,
      'a parameter': /Sb\d\(a0 AS /,
      'a local': /^ {2}DIM v0 AS /m,
      'an integer array': /ia\(\(/,
      'a string array': /sa\(/,
      strings: /LEFT\$\(/,
      'a store through a variable pointer (bug 1)': /pp = @[a-z]\w*\n.*\nPOKE (UINTEGER, )?pp, /,
      'a pointer into a buffer': /pp = @buf\(0\) \+ /,
      'a word written over bytes (bug 4)': /POKE UINTEGER, @m0 \+ /,
      'a byte written into a word (bug 4)': /POKE @n0 \+ /,
      'x = c - x then c - x (bug 4)': /^(\w+) = (-?\d+) - \1\n\w+ = \2 - \1$/m,
      'a byte of a word, the word, the byte again (bug 4)': /^POKE @(n\d) \+ (\d), \d+\n\1 = -?\d+\n\w+ = PEEK\(@\1 \+ \2\)$/m,
      'a constant address that leaves its variable (L5-IR, follow-up 174)': /^n(\d) = -?\d+\nPOKE @n\d \+ [23], \d+\n\w+ = n\1 \+ 1\nPRINT n\1$/m,
      EXIT: /EXIT (FOR|WHILE)/,
    };
    const missing = Object.entries(want).filter(([, re]) => !re.test(all)).map(([k]) => k);
    expect(missing).toEqual([]);
  });

  it('writes programs that stay in the layout the pointer tests assume: the byte block, then the word block, are adjacent', () => {
    const text = render(generate(1));
    const order = [...text.matchAll(/^DIM (m\d|n\d) AS/gm)].map((m) => m[1]);
    expect(order).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'n0', 'n1', 'n2', 'n3']);
  });
});

describe('a deliberately wrong pass is caught by the fuzzer, shrunk, and printed with its seed', () => {
  it('finds and shrinks a failure of dropFirstStore', () => {
    let seed = 1;
    let report: string | null = null;
    // not every program has a store whose loss shows: take the first seed that does
    for (; seed <= 20 && report === null; seed++) report = withAsmHook(dropFirstStore, () => findFailure(seed, [2]));
    seed--;
    expect(report).not.toBeNull();
    expect(report).toMatch(new RegExp(`^seed ${seed}: fail: -O2: `));
    expect(report).toMatch(/shrunk to \d+ lines/);
    expect(report).toMatch(new RegExp(`repeat: npm run fuzz:opt -- 1 ${seed}`));
    const lines = Number(/shrunk to (\d+) lines/.exec(report as string)![1]);
    expect(lines).toBeLessThan(render(generate(seed)).split('\n').length / 2);
    if (process.env['CPCBAS_FUZZ_SHOW'] !== undefined) console.log(report);
    // 15 to 35 s depending on the load; the 60 s limit failed under machine load (R19)
  }, 180_000);

  it('the wrong pass changes the asm of the optimised levels and not -O0', () => {
    const src = { name: 'p', files: 'DIM a AS INTEGER\na = 1\nPRINT a' };
    withAsmHook(dropFirstStore, () => {
      expect(asmAt(src, 0).asm).not.toBe(asmAt(src, 2).asm);
      expect(OPT_LEVELS).toContain('s');
    });
  });
});
