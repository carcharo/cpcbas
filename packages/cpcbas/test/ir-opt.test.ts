/**
 * L5-IR: the IR passes (src/ir/opt) on the test Z80. Each program is built at -O0 and at every optimised level, run, and
 * compared (opt-harness.ts `compareLevels`); a program must also be one that the passes change (`--stage ir-opt` differs from
 * `--stage ir`), or the test shows nothing. Expected values are the transcript of -O0, never a recorded one.
 */
import { describe, expect, it } from 'vitest';
import { compile } from '../src/index.js';
import { libTree } from './runtime-tree.js';
import { compareLevels, type Program } from './opt-harness.js';

const prog = (name: string, files: string): Program => ({ name, files });

/** The IR before and after the IR stage, at -O2. */
function irStages(source: string, trace = false): { before: string; after: string } {
  const r = compile({
    files: new Map([['t.bas', source]]),
    main: 't.bas',
    defines: {},
    runtime: libTree(),
    options: { format: 'none', dump: ['ir', 'ir-opt'], optimize: 2, ...(trace ? { optTrace: true } : {}) },
  } as unknown as Parameters<typeof compile>[0]);
  return { before: r.stages?.ir ?? '', after: r.stages?.['ir-opt'] ?? '' };
}

const PROGRAMS: Program[] = [
  prog(
    'ir/arith-pow2',
    [
      'DIM u AS UINTEGER, s AS INTEGER, b AS UBYTE, v AS UINTEGER, i AS INTEGER',
      'FOR i = 0 TO 40',
      '  u = i * 1637 + 65000: s = i * 811 - 20000: b = i * 7',
      '  PRINT u \\ 2; u MOD 8; u * 2; u * 16; u / 4;',
      '  PRINT s \\ 2; s MOD 2; s * 4; s \\ 8; s MOD 8;',
      '  PRINT b \\ 2; b MOD 16; b * 8; b * 2; b / 128;',
      '  v = u * 1: v = v + 0: v = v OR 0: v = v AND 65535: PRINT v;',
      '  PRINT (u + 4) - 5; (s - 7) + 7; (b + 250) - 3; (u - 3) - 3',
      'NEXT i',
    ].join('\n') + '\n',
  ),
  prog(
    'ir/compare-zero',
    [
      'DIM x AS INTEGER, y AS UINTEGER, p AS UBYTE, n AS LONG, i AS INTEGER',
      'FOR i = -2 TO 2',
      '  x = i: y = i: p = i: n = i * 70000',
      '  IF x = 0 THEN PRINT "x0";',
      '  IF x <> 0 THEN PRINT "x!";',
      '  IF y = 0 THEN PRINT "y0";',
      '  IF y > 0 THEN PRINT "y+";',
      '  IF 0 < p THEN PRINT "p+";',
      '  IF p <= 0 THEN PRINT "p0";',
      '  IF n = 0 THEN PRINT "n0";',
      '  IF n <> 0 THEN PRINT "n!";',
      '  IF x > 0 THEN PRINT "xg";',
      '  IF x < 0 THEN PRINT "xl";',
      '  PRINT',
      'NEXT i',
    ].join('\n') + '\n',
  ),
  prog(
    'ir/if-goto',
    [
      'DIM i AS INTEGER, t AS INTEGER',
      '10 FOR i = 1 TO 6',
      '20 IF i MOD 2 = 0 THEN GOTO 60',
      '30 t = t + i',
      '40 IF t > 6 THEN 70',
      '50 PRINT "odd"; i: GOTO 80',
      '60 PRINT "even"; i',
      '70 PRINT "t"; t',
      '80 NEXT',
      '90 IF t THEN GOTO 110',
      '100 PRINT "no"',
      '110 PRINT "end"',
    ].join('\n') + '\n',
  ),
  prog(
    'ir/dead-code',
    [
      'DIM x AS INTEGER',
      '10 x = 1',
      '20 GOTO 50',
      '30 x = 99: PRINT "dead"',
      '40 GOSUB 100',
      '50 PRINT x',
      '60 GOSUB 100',
      '70 IF 0 THEN PRINT "never"',
      '75 IF 1 THEN PRINT "always"',
      '80 END',
      '90 PRINT "after end"',
      '100 PRINT "sub": RETURN',
      '110 PRINT "after return"',
    ].join('\n') + '\n',
  ),
  prog(
    'ir/constants',
    [
      'DIM a AS INTEGER, b AS UBYTE, c AS UINTEGER, d AS LONG',
      'a = 3: b = 200: c = 65535: d = 100000',
      'PRINT a + 4 * 5; b + 100; c + 1; d * 3; (a + 2) * (a + 3)',
      'a = 5: PRINT a + 1; a * 2',
      'POKE @c + 1, 3: PRINT c',
    ].join('\n') + '\n',
  ),
  // follow-up 74: the RESUME NEXT label `.T.b` follows an unconditional jump; it must survive the dead-code pass
  prog(
    'ir/resume-next-after-goto',
    [
      '10 ON ERROR GOTO 900',
      '20 a = ASC(""): GOTO 40',
      '30 PRINT "skipped"',
      '40 PRINT "b"',
      '50 x = ASC(""): GOSUB 200',
      '60 PRINT "c"',
      '70 END',
      '200 PRINT "sub": RETURN',
      '900 PRINT "ERR"; ERR; "ERL"; ERL: RESUME NEXT',
    ].join('\n') + '\n',
  ),
  prog(
    'ir/array-and-params',
    [
      'DIM a(10) AS INTEGER, i AS INTEGER',
      'FOR i = 0 TO 10: a(i) = i * 3: NEXT',
      'FOR i = 0 TO 10: a(i) = a(i) + 1: a(10 - i) = a(10 - i) * 2: NEXT',
      'FOR i = 0 TO 10: PRINT a(i); : NEXT',
      'PRINT',
      'MOVE 100, 120, 2, 0: DRAWR 0, 10, 1, 1: DRAWR -10, 0, 3, 2: PRINT XPOS; YPOS',
    ].join('\n') + '\n',
  ),
];

describe('L5-IR: the IR passes keep every program\'s behaviour at every level', () => {
  it.each(PROGRAMS.map((p) => [p.name, p] as const))('%s', (_name, p) => {
    const v = compareLevels(p, [1, 2, 3, 's']);
    expect(v.kind, `${p.name}: ${v.detail}`).toBe('ok');
  });
});

describe('L5-IR: the passes fire on the programs above', () => {
  it.each([
    ['ir/arith-pow2', /ir-strength: (mul|div|mod)\.[a-z0-9]+ .* -> (shl|shr|and)\./],
    ['ir/arith-pow2', /ir-strength: sub\.[a-z0-9]+ t\d+, t\d+, #5 -> merged/],
    ['ir/compare-zero', /ir-strength: jz\.i16 t\d+, \S+ -> j(n?z)\.[a-z0-9]+ .* \(the comparison with 0 goes\)/],
    ['ir/if-goto', /ir-strength: .*\(the jump over jump \S+ goes\)/],
    ['ir/dead-code', /ir-const: (jz|jnz)\.i16 .* -> (jump|nothing)/],
    ['ir/dead-code', /ir-dead: dead: /],
    ['ir/constants', /ir-const: constant into /],
    ['ir/constants', /ir-const: fold /],
  ])('%s: %s', (name, re) => {
    const p = PROGRAMS.find((x) => x.name === name) as Program;
    const { before, after } = irStages(p.files as string, true);
    expect(after).not.toBe(before);
    expect(after).toMatch(re);
  });

  it('a param whose temp has other params after it keeps its push order (the argument order of MOVE x, y)', () => {
    const { after } = irStages('MOVE 100, 120\n');
    expect(after).toMatch(/load\.i16 t\d+, #100\n\s+param\.i16 #120\n\s+param\.i16 t\d+/);
  });

  it('the ir stage is the same at every level, and -O0 runs no IR pass', () => {
    const src = 'DIM x AS UINTEGER\nx = 6\nPRINT x / 2\n';
    const at = (level: number): { ir: string; opt: string } => {
      const r = compile({
        files: new Map([['t.bas', src]]),
        main: 't.bas',
        defines: {},
        runtime: libTree(),
        options: { format: 'none', dump: ['ir', 'ir-opt'], optimize: level },
      } as unknown as Parameters<typeof compile>[0]);
      return { ir: r.stages?.ir ?? '', opt: r.stages?.['ir-opt'] ?? '' };
    };
    expect(at(0).ir).toBe(at(2).ir);
    expect(at(0).opt).toBe(at(0).ir);
    expect(at(2).opt).not.toBe(at(2).ir);
    expect(at(2).opt).toContain('shr.u16');
  });

  it('--opt-disable turns each pass off by its name', () => {
    const src = 'DIM x AS UINTEGER\nx = 6\nPRINT x / 2\n';
    const r = compile({
      files: new Map([['t.bas', src]]),
      main: 't.bas',
      defines: {},
      runtime: libTree(),
      options: { format: 'none', dump: ['ir', 'ir-opt'], optimize: 2, optDisable: ['ir-strength'] },
    } as unknown as Parameters<typeof compile>[0]);
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(r.stages?.['ir-opt']).not.toContain('shr.u16');
  });
});
