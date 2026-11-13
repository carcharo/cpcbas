/**
 * L3-FIX: only reachable procedures are emitted.
 * A SUB, FUNCTION or DEF FN is compiled when the main program reaches it through a call, `@name` or its
 * label as a word of an ASM block; every procedure is still bound and checked; an unused procedure of the
 * program's own files gets W306, a library one is dropped silently.
 */
import { describe, expect, it } from 'vitest';
import { compile, formatDiagnostic } from '../src/index.js';
import { libTree } from './runtime-tree.js';

function build(main: string, files: Record<string, string> = {}, library: Record<string, string> = {}) {
  const runtime = new Map(libTree());
  for (const [k, v] of Object.entries(library)) runtime.set(k, v);
  const r = compile({
    files: new Map([['main.bas', main], ...Object.entries(files)]),
    main: 'main.bas',
    runtime,
    options: { format: 'bin', asm: true },
  });
  const d = r.diagnostics.map((x) => `${x.code} ${formatDiagnostic(x, r.sources)}`);
  return { r, asm: r.asm ?? '', diag: d, codes: r.diagnostics.map((x) => x.code) };
}

const has = (asm: string, label: string): boolean => new RegExp(`^${label}:`, 'm').test(asm);

describe('reachable procedures', () => {
  it('keeps a call chain A -> B -> C and drops an unused D, which gets W306', () => {
    const b = build(
      [
        'SUB A()',
        '  B()',
        'END SUB',
        'SUB B()',
        '  C()',
        'END SUB',
        'SUB C()',
        '  PRINT 1',
        'END SUB',
        'SUB D()',
        '  PRINT 2',
        'END SUB',
        'A()',
      ].join('\n'),
    );
    expect(b.r.ok).toBe(true);
    for (const l of ['_A', '_B', '_C']) expect(has(b.asm, l)).toBe(true);
    expect(has(b.asm, '_D')).toBe(false);
    expect(b.diag.filter((x) => x.startsWith('W306'))).toHaveLength(1);
    expect(b.diag.join('\n')).toContain("'D' is never called; it is not compiled");
  });

  it('keeps functions called inside expressions and DEF FN uses', () => {
    const b = build(
      [
        'FUNCTION F(x AS INTEGER) AS INTEGER',
        '  RETURN G(x) + 1',
        'END FUNCTION',
        'FUNCTION G(x AS INTEGER) AS INTEGER',
        '  RETURN x * 2',
        'END FUNCTION',
        'DEF FNH(x%) = x% + 1',
        'DEF FNUNUSED(x%) = x% + 2',
        'PRINT F(3) + FNH(1)',
      ].join('\n'),
    );
    expect(b.r.ok).toBe(true);
    for (const l of ['_F', '_G']) expect(has(b.asm, l)).toBe(true);
    expect(b.asm).not.toMatch(/FNUNUSED/i);
    expect(b.codes.filter((c) => c === 'W306')).toHaveLength(1);
  });

  it('keeps a procedure whose address is taken with @name', () => {
    const b = build(['SUB D()', '  PRINT 2', 'END SUB', 'DIM a AS UINTEGER', 'a = @D', 'PRINT a'].join('\n'));
    expect(b.r.ok).toBe(true);
    expect(has(b.asm, '_D')).toBe(true);
    expect(b.codes).not.toContain('W306');
  });

  it('keeps a procedure whose label is a word of an ASM block (main program, or a reachable procedure)', () => {
    const b = build(
      [
        'SUB D()',
        '  PRINT 2',
        'END SUB',
        'SUB E()',
        '  PRINT 3',
        'END SUB',
        'SUB Viaasm()',
        '  ASM',
        '    call _E',
        '  END ASM',
        'END SUB',
        'SUB Never()',
        '  PRINT 4',
        'END SUB',
        'ASM',
        '  call _D ; and a comment naming _Never',
        'END ASM',
        'Viaasm()',
      ].join('\n'),
    );
    expect(b.r.ok).toBe(true);
    for (const l of ['_D', '_E', '_Viaasm']) expect(has(b.asm, l)).toBe(true);
    expect(has(b.asm, '_Never')).toBe(false);
    expect(b.diag.join('\n')).toContain("'Never' is never called");
  });

  it('handles recursion and mutual recursion (an unreached cycle is dropped whole)', () => {
    const b = build(
      [
        'FUNCTION Fact(n AS INTEGER) AS INTEGER',
        '  IF n < 2 THEN RETURN 1',
        '  RETURN n * Fact(n - 1)',
        'END FUNCTION',
        'SUB Ping(n AS INTEGER)',
        '  IF n > 0 THEN Pong(n - 1)',
        'END SUB',
        'SUB Pong(n AS INTEGER)',
        '  IF n > 0 THEN Ping(n - 1)',
        'END SUB',
        'SUB Loop1()',
        '  Loop2()',
        'END SUB',
        'SUB Loop2()',
        '  Loop1()',
        'END SUB',
        'PRINT Fact(5)',
        'Ping(3)',
      ].join('\n'),
    );
    expect(b.r.ok).toBe(true);
    for (const l of ['_Fact', '_Ping', '_Pong']) expect(has(b.asm, l)).toBe(true);
    for (const l of ['_Loop1', '_Loop2']) expect(has(b.asm, l)).toBe(false);
    expect(b.codes.filter((c) => c === 'W306')).toHaveLength(2);
  });

  it('still reports errors in an unused procedure', () => {
    const b = build(['SUB Bad()', '  x = NOSUCH(1)', 'END SUB', 'PRINT 1'].join('\n'));
    expect(b.r.ok).toBe(false);
  });

  it('drops the strings of an unused procedure', () => {
    const b = build(['SUB Unused()', '  PRINT "ZQXJ-only-here"', 'END SUB', 'PRINT 1'].join('\n'));
    expect(b.r.ok).toBe(true);
    expect(b.asm).not.toContain('ZQXJ');
  });

  it('a library include with ten SUBs and one used links one, with no warning', () => {
    const lib = Array.from({ length: 10 }, (_, i) => `SUB Lib${i}()\n  PRINT ${i}\nEND SUB`).join('\n');
    const b = build('#include <mylib/ten.bas>\nLib3()\n', {}, { 'mylib/ten.bas': lib + '\n' });
    expect(b.r.ok).toBe(true);
    expect(has(b.asm, '_Lib3')).toBe(true);
    for (let i = 0; i < 10; i++) if (i !== 3) expect(has(b.asm, `_Lib${i}`)).toBe(false);
    expect(b.codes).not.toContain('W306');
  });

  it('an unused procedure in a quoted include is warned about (own code)', () => {
    const b = build('#include "other.bas"\nPRINT 1\n', { 'other.bas': 'SUB Mine()\n  PRINT 9\nEND SUB\n' });
    expect(b.r.ok).toBe(true);
    expect(b.codes).toContain('W306');
  });

  it('a #require inside an unused procedure links nothing', () => {
    const lib = { 'mylib/x.asm': 'ZQX_MARK:\n\tnop\n' };
    const unused = build(['SUB Unused()', '  #require "mylib/x.asm"', 'END SUB', 'PRINT 1'].join('\n'), {}, lib);
    expect(unused.r.ok).toBe(true);
    expect(unused.asm).not.toContain('mylib/x.asm');
    const used = build(['SUB Used()', '  #require "mylib/x.asm"', 'END SUB', 'Used()'].join('\n'), {}, lib);
    expect(used.diag).toEqual([]);
    expect(used.asm).toContain('mylib/x.asm');
  });
});
