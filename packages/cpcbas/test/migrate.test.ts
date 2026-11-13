/**
 * `cpcbas migrate`, rule by rule (docs/migrate.md): each rewrite and flag with a positive case, a case inside
 * a string, inside a comment, inside ASM, at the end of a line and in other letter cases. The oracle test
 * (migrate-oracle.test.ts) runs the whole rule set over the reviewed translations.
 */
import { describe, expect, it } from 'vitest';
import { migrate, type MigrateDiagnostic, type MigrateOptions } from '../src/index.js';

interface Out {
  text: string;
  codes: string[];
  diags: MigrateDiagnostic[];
}

function mig(src: string, options: MigrateOptions = {}, extra: Record<string, string> = {}): Out {
  const files = new Map<string, string>([['a.bas', src], ...Object.entries(extra)]);
  const r = migrate(files, options);
  const diags = r.report.files.find((f) => f.path === 'a.bas')?.diagnostics ?? [];
  return { text: r.files.get('a.bas') as string, codes: diags.map((d) => d.code), diags };
}

describe('W700 number forms', () => {
  it.each([
    ['x = $FF', 'x = &FF'],
    ['x = 0FFh', 'x = &0FF'],
    ['x = 0ffH + 1', 'x = &0ff + 1'],
    ['x = %0101', 'x = &X0101'],
    ['x = 0101b', 'x = &X0101'],
    ['x = BIN 0101', 'x = &X0101'],
    ['x = bin 1', 'x = &X1'],
    ['#define SCR $C000', '#define SCR &C000'],
    ['#pragma org $4000', '#pragma org &4000'],
    ['POKE 1, $FF', 'POKE 1, &FF'],
  ])('%s', (src, want) => {
    const o = mig(src);
    expect(o.text).toBe(want);
    expect(o.codes).toContain('W700');
  });
  it('leaves strings, comments, ASM, suffixes and CPC forms alone', () => {
    const src = 'a$ = STR$(5) + "$FF 0FFh %01"\n\' $FF and 0FFh\nREM $FF\nx = &FF + &HFF + &X0101 + &0B\nASM\n ld a, $FF\n ld b, 0FFh\nEND ASM\n';
    const o = mig(src);
    expect(o.text).toBe(src);
    expect(o.codes).not.toContain('W700');
  });
  it('a block comment is not code', () => {
    const src = "/' $FF\n  0FFh '/\nx = 1\n";
    expect(mig(src).text).toBe(src);
  });
});

describe('W701 bAND, bOR, bXOR, bNOT', () => {
  it.each([
    ['x = a bAND b', 'x = a AND b'],
    ['x = a BOR b', 'x = a OR b'],
    ['x = a bxor b', 'x = a XOR b'],
    ['x = bNOT a', 'x = NOT a'],
    ['IF (a band 1) = 0 THEN b = 1', 'IF (a AND 1) = 0 THEN b = 1'],
  ])('%s', (src, want) => {
    const o = mig(src);
    expect(o.text).toBe(want);
    expect(o.codes).toContain('W701');
  });
  it('not in strings, comments or ASM', () => {
    const src = 'a$ = "a bAND b" \' bAND\nASM\n ; bAND\nEND ASM\n';
    expect(mig(src).text).toBe(src);
  });
  it('does not flag W729 for what was bitwise already', () => {
    expect(mig('x = a bAND b').codes).not.toContain('W729');
  });
});

describe('W702 reserved words used as names', () => {
  it('renames a declared name everywhere, and in ASM', () => {
    const src = 'DIM frame AS UBYTE\nframe = frame + 1\nASM\n ld a, (_frame)\n ld a, $FF\nEND ASM\nPRINT "frame"\n\' frame\n';
    const o = mig(src);
    expect(o.text).toBe('DIM frame_ AS UBYTE\nframe_ = frame_ + 1\nASM\n ld a, (_frame_)\n ld a, $FF\nEND ASM\nPRINT "frame"\n\' frame\n');
    expect(o.codes.filter((c) => c === 'W702')).toHaveLength(4);
  });
  it('declarations: SUB, FUNCTION, parameters, CONST, FOR, labels and assignments', () => {
    const src = 'SUB Go(line AS UBYTE, pen AS UBYTE)\nEND SUB\nCONST time = 5\nFOR key = 1 TO 2\nNEXT\nmask = 3\nspeed:\nGOTO speed\n';
    expect(mig(src).text).toBe('SUB Go(line_ AS UBYTE, pen_ AS UBYTE)\nEND SUB\nCONST time_ = 5\nFOR key_ = 1 TO 2\nNEXT\nmask_ = 3\nspeed:\nGOTO speed\n'.replace('speed:\nGOTO speed', 'speed:\nGOTO speed'));
  });
  it('a suffixed name keeps its suffix', () => {
    expect(mig('DIM key$ AS STRING\nkey$ = "a"').text).toBe('DIM key_$ AS STRING\nkey_$ = "a"');
  });
  it('the renames option chooses the new name (any case of the old one)', () => {
    const o = mig('FUNCTION Steps(n AS UBYTE, INP AS UBYTE) AS UBYTE\n  RETURN inp\nEND FUNCTION', { renames: { Inp: 'kin' } });
    expect(o.text).toBe('FUNCTION Steps(n AS UBYTE, kin AS UBYTE) AS UBYTE\n  RETURN kin\nEND FUNCTION');
  });
  it('a keyword the project does not declare stays (FRAME, MODE 1, CPC statements)', () => {
    const src = 'FRAME\nMODE 1\nPEN 1\nx = LEFT$(a$, 2)\n';
    expect(mig(src).text).toBe(src);
  });
  it('is by project: a name declared in one file is renamed in the others', () => {
    const r = migrate(new Map([['a.bas', 'DIM frame AS UBYTE'], ['b.bas', 'frame = 1']]));
    expect(r.files.get('b.bas')).toBe('frame_ = 1');
  });
  it('not a Boriel keyword, so a name of a Boriel word is not a W702 case', () => {
    const src = 'DIM code AS UBYTE\ncode = 1\n';
    expect(mig(src).text).toBe(src);
  });
  it('is left alone inside strings and comments', () => {
    const src = 'DIM line AS UBYTE\nPRINT "line"\n\' line\nREM line\n';
    expect(mig(src).text).toBe('DIM line_ AS UBYTE\nPRINT "line"\n\' line\nREM line\n');
  });
});

describe('W703 ASM references', () => {
  it('arrays, strings, integers and reals take the CPC BASIC labels; scalars and procedures stay', () => {
    const src = 'DIM a(5) AS UBYTE\nDIM n AS UBYTE\ns$ = "x"\ni% = 1\nr! = 1\nSUB P()\nEND SUB\nASM\n ld hl, _a.__DATA__\n ld hl, _a\n ld a, (_n)\n ld hl, _s\n ld hl, (_i)\n ld hl, (_r)\n call _P\n ; _a\n ld hl, "_a"\nEND ASM\n';
    const o = mig(src);
    expect(o.text).toBe(
      'DIM a(5) AS UBYTE\nDIM n AS UBYTE\ns$ = "x"\ni% = 1\nr! = 1\nSUB P()\nEND SUB\nASM\n ld hl, _a__a.__DATA__\n ld hl, _a__a\n ld a, (_n)\n ld hl, _s__s\n ld hl, (_i__i)\n ld hl, (_r__r)\n call _P\n ; _a\n ld hl, "_a"\nEND ASM\n',
    );
    expect(o.codes.filter((c) => c === 'W703')).toHaveLength(5);
  });
  it('is not applied to BASIC text', () => {
    const src = 'DIM a(5) AS UBYTE\nPRINT "_a"\n';
    expect(mig(src).text).toBe(src);
  });
  it('a file an ASM block includes is assembly: only its labels change, never a BASIC rule (R22)', () => {
    // Starfall's platform_plus_mux.inc, given by name, came back with `in a, (c)` as `inp(a), (c)`
    const inc = '; in the window\n    in a, (c)\n    ld hl, _a\n    ld de, $6050\n#include once "deeper.inc"\n';
    const deeper = '    in e, (c)   ; read in\n';
    const src = 'DIM a(5) AS UBYTE\nASM\n#include "x.inc"\nEND ASM\nx = $10\n';
    const r = migrate(new Map([['a.bas', src], ['x.inc', inc], ['deeper.inc', deeper]]), { from: 'boriel' });
    expect(r.files.get('x.inc')).toBe(inc.replace('_a\n', '_a__a\n'));
    expect(r.files.get('deeper.inc')).toBe(deeper);
    expect(r.files.get('a.bas')).toBe('DIM a(5) AS UBYTE\nASM\n#include "x.inc"\nEND ASM\nx = &10\n');
    const codes = r.report.files.flatMap((f) => f.diagnostics.map((d) => `${f.path}:${d.code}`));
    expect(codes).toContain('x.inc:W703');
    expect(codes.filter((c) => c.startsWith('x.inc:') || c.startsWith('deeper.inc:'))).toEqual(['x.inc:W703']);
  });
  it('a file included outside ASM stays BASIC whatever its name', () => {
    const r = migrate(new Map([['a.bas', '#include "b.inc"\n'], ['b.inc', 'x = $10\n']]), { from: 'boriel' });
    expect(r.files.get('b.inc')).toBe('x = &10\n');
  });
});

describe('W704 a bare RETURN in a SUB', () => {
  it('becomes EXIT SUB (and EXIT FUNCTION), in the case of the source', () => {
    const o = mig('SUB x()\n  IF a THEN RETURN\n  return\nEND SUB\nFUNCTION f() AS UBYTE\n  IF a THEN RETURN\n  RETURN 1\nEND FUNCTION\n');
    expect(o.text).toBe('SUB x()\n  IF a THEN EXIT SUB\n  exit sub\nEND SUB\nFUNCTION f() AS UBYTE\n  IF a THEN EXIT FUNCTION\n  RETURN 1\nEND FUNCTION\n');
  });
  it('not when the procedure has a GOSUB, and not outside a procedure', () => {
    const src = 'SUB y()\n GOSUB z\n RETURN\nz:\nRETURN\nEND SUB\nRETURN\n';
    expect(mig(src).text).toBe(src);
  });
  it('not in a string or a comment, a comment after it is kept', () => {
    const o = mig('SUB x()\n  PRINT "RETURN" \' RETURN\n  RETURN \' done\nEND SUB\n');
    expect(o.text).toBe('SUB x()\n  PRINT "RETURN" \' RETURN\n  EXIT SUB \' done\nEND SUB\n');
  });
});

describe('W705 ON n GOTO counts from 1 (a Boriel run only)', () => {
  it.each([
    ['ON n GOTO a, b', 'ON n + 1 GOTO a, b'],
    ['ON n GOSUB a, b', 'ON n + 1 GOSUB a, b'],
    ['on n go to a, b', 'on n + 1 go to a, b'],
    ['ON 1 GOTO a, b', 'ON 2 GOTO a, b'],
    ['ON (n) GOTO a, b', 'ON (n) + 1 GOTO a, b'],
    ['ON n + 2 GOTO a, b', 'ON (n + 2) + 1 GOTO a, b'],
    ['ON ERROR GOTO a', 'ON ERROR GOTO a'],
  ])('%s', (src, want) => {
    expect(mig(src, { from: 'boriel' }).text).toBe(want);
  });
  it('is left alone in an auto run with no Boriel-only form', () => {
    const src = 'ON n GOTO a, b';
    expect(mig(src).text).toBe(src);
  });
  it('is applied in an auto run when another rewrite fired, even in another file', () => {
    const r = migrate(new Map([['a.bas', 'ON n GOTO a, b'], ['b.bas', 'x = $10']]));
    expect(r.files.get('a.bas')).toBe('ON n + 1 GOTO a, b');
    expect(r.report.summary.dialect).toBe('boriel');
  });
  it('not in a string or a comment', () => {
    const src = 'PRINT "ON n GOTO a"\n\' ON n GOTO a\n';
    expect(mig(src, { from: 'boriel' }).text).toBe(src);
  });
});

describe('W706 string slices', () => {
  const decl = 'DIM h$ AS STRING\nDIM i, j AS UBYTE\n';
  it.each([
    ['h$(2 TO 4)', 'MID$(h$, 3, 3)'],
    ['h$(0 TO 0)', 'MID$(h$, 1, 1)'],
    ['h$(TO 3)', 'LEFT$(h$, 4)'],
    ['h$(5 TO)', 'MID$(h$, 6)'],
    ['h$(i TO j)', 'MID$(h$, i + 1, j - i + 1)'],
    ['h$(i)', 'MID$(h$, i + 1, 1)'],
    ['h$(3)', 'MID$(h$, 4, 1)'],
    ['h$(i TO i)', 'MID$(h$, i + 1, 1)'],
    ['h$(2 TO j)', 'MID$(h$, 3, j - 1)'],
    ['h$(i TO 5)', 'MID$(h$, i + 1, 6 - i)'],
    ['h$(i + 1 TO j * 2)', 'MID$(h$, (i + 1) + 1, j * 2 - (i + 1) + 1)'],
    ['h$( 2 TO 4 )', 'MID$(h$, 3, 3)'],
  ])('%s', (slice, want) => {
    expect(mig(`${decl}PRINT ${slice}`).text).toBe(`${decl}PRINT ${want}`);
  });
  it('a string declared AS STRING counts, with or without the $', () => {
    expect(mig('DIM s AS STRING\nPRINT s(1 TO 2)').text).toBe('DIM s AS STRING\nPRINT MID$(s, 2, 2)');
  });
  it('CODE(name(i TO i)) is ASC(MID$(name, i + 1, 1))', () => {
    expect(mig('x = CODE(name(i TO i))').text).toBe('x = ASC(MID$(name, i + 1, 1))');
    expect(mig('x = CODE name(i TO i)').text).toBe('x = ASC(MID$(name, i + 1, 1))');
  });
  it('an array element of a string array is not a slice', () => {
    const src = 'DIM sa$(4) AS STRING\nsa$(1) = "x"\nPRINT sa$(1)\n';
    expect(mig(src).text).toBe(src);
  });
  it('not in a string, a comment or ASM; a DIM bound is not a slice', () => {
    const src = 'PRINT "h$(2 TO 4)"\n\' h$(2 TO 4)\nASM\n ; h$(2 TO 4)\nEND ASM\nDIM a(5) AS UBYTE\n';
    expect(mig(src).text).toBe(src);
  });
  it('W723 for an assignment to a slice and for a name that may be an array', () => {
    expect(mig(`${decl}h$(1 TO 2) = "xy"`).codes).toContain('W723');
    expect(mig(`${decl}h$(1 TO 2) = "xy"`).text).toBe(`${decl}h$(1 TO 2) = "xy"`);
    const may = mig('PRINT q$(3)');
    expect(may.codes).toContain('W723');
    expect(may.text).toBe('PRINT q$(3)');
  });
});

describe('W707 and W708 function spellings and parentheses', () => {
  it.each([
    ['x = CODE a$', 'x = ASC(a$)', ['W707', 'W708']],
    ['x = code(a$)', 'x = asc(a$)', ['W707']],
    ['x = LN 2.5', 'x = LOG(2.5)', ['W707', 'W708']],
    ['x = IN 254', 'x = INP(254)', ['W707', 'W708']],
    ['x = a SHL 2', 'x = a << 2', ['W707']],
    ['x = a shr b', 'x = a >> b', ['W707']],
    ['x$ = CHR 65', 'x$ = CHR$(65)', ['W707', 'W708']],
    ['x$ = STR n', 'x$ = STR$(n)', ['W707', 'W708', 'W732']],
    ['PRINT CHR$ 13', 'PRINT CHR$(13)', ['W708']],
    ['x = PEEK 23560 + 1', 'x = PEEK(23560) + 1', ['W708']],
    ['x = LEN a$', 'x = LEN(a$)', ['W708']],
    ['x = SIN -x', 'x = SIN(-x)', ['W708']],
    ['x = PEEK a(i)', 'x = PEEK(a(i))', ['W708']],
    ['PRINT TAB 5; "x"', 'PRINT TAB(5); "x"', ['W708', 'W733']],
  ])('%s', (src, want, codes) => {
    const o = mig(src);
    expect(o.text).toBe(want);
    for (const c of codes) expect(o.codes).toContain(c);
  });
  it('a call with parentheses stays', () => {
    const src = 'x = LEN(a$) + CHR$(1) + PEEK(UINTEGER, 3)\n';
    expect(mig(src).text).toBe(src);
  });
  it('not in strings, comments or ASM; a project variable called code is not respelled', () => {
    const src = 'PRINT "CODE a$"\n\' CODE a$\nASM\n ; CODE a$\nEND ASM\nDIM code AS UBYTE\ncode = 1\n';
    expect(mig(src).text).toBe(src);
  });
});

describe('W709 ENDIF and END WHILE', () => {
  it('rewrites both, in the source case', () => {
    expect(mig('IF a THEN\nENDIF\nWHILE 1\nEND WHILE\nendif\nwhile 1\nend while').text).toBe('IF a THEN\nEND IF\nWHILE 1\nWEND\nend if\nwhile 1\nwend');
  });
  it('leaves END IF and WEND', () => {
    const src = 'IF a THEN\nEND IF\nWHILE 1\nWEND\n';
    expect(mig(src).text).toBe(src);
  });
});

describe('W710 case_insensitive pragmas', () => {
  it('removes the lines, keeps the other pragmas', () => {
    const src = '#pragma push(case_insensitive)\n#pragma case_insensitive = TRUE\n#pragma org 100\n#pragma pop(case_insensitive)\nx = 1\n';
    expect(mig(src).text).toBe('#pragma org 100\nx = 1\n');
  });
  it('a pragma at the end of the file', () => {
    expect(mig('x = 1\n#pragma pop(case_insensitive)').text).toBe('x = 1\n');
  });
});

describe('W711 INK n and W730', () => {
  it('INK n is PEN n, with the colour flag', () => {
    const o = mig('INK 3\nink 2');
    expect(o.text).toBe('PEN 3\npen 2');
    expect(o.codes).toContain('W730');
  });
  it('INK n, c (a palette entry) stays', () => {
    expect(mig('INK 1, 5').text).toBe('INK 1, 5');
  });
});

describe('W712 WaitVsync', () => {
  it.each([
    ['WaitVsync', 'FRAME'],
    ['WaitVsync()', 'FRAME'],
    ['IF a THEN WaitVsync', 'IF a THEN FRAME'],
    ['waitvsync', 'frame'],
  ])('%s', (src, want) => {
    expect(mig(src).text).toBe(want);
  });
  it('not when the project defines its own', () => {
    const src = 'SUB WaitVsync()\nEND SUB\nWaitVsync\n';
    expect(mig(src).text).toBe(src);
  });
});

describe('W713 UBOUND and LBOUND (a Boriel run only)', () => {
  it('gets dimension 0', () => {
    expect(mig('x = UBOUND(a) + LBOUND(a)', { from: 'boriel' }).text).toBe('x = UBOUND(a, 0) + LBOUND(a, 0)');
  });
  it('a dimension is kept; an auto run with no Boriel form leaves it', () => {
    expect(mig('x = UBOUND(a, 1)', { from: 'boriel' }).text).toBe('x = UBOUND(a, 1)');
    expect(mig('x = UBOUND(a)').text).toBe('x = UBOUND(a)');
  });
});

describe('W714 DIM bounds', () => {
  it('drops 0 TO from every dimension', () => {
    expect(mig('DIM a(0 TO 5, 0 TO n + 1) AS UBYTE').text).toBe('DIM a(5, n + 1) AS UBYTE');
  });
  it('another lower bound is W723', () => {
    const o = mig('DIM b(1 TO 5) AS UBYTE');
    expect(o.text).toBe('DIM b(1 TO 5) AS UBYTE');
    expect(o.codes).toContain('W723');
  });
});

describe('W715 DRAW dx, dy (a Boriel run only)', () => {
  it('becomes DRAWR, with the units flag', () => {
    const o = mig('DRAW 10, 5', { from: 'boriel' });
    expect(o.text).toBe('DRAWR 10, 5');
    expect(o.codes).toContain('W731');
  });
  it('three arguments stay; so does a CPC run', () => {
    expect(mig('DRAW 10, 5, 1', { from: 'boriel' }).text).toBe('DRAW 10, 5, 1');
    expect(mig('DRAW 10, 5').text).toBe('DRAW 10, 5');
  });
});

describe('W716 BRIGHT, FLASH, BOLD, ITALIC', () => {
  it('statements and PRINT items are removed', () => {
    expect(mig('BRIGHT 1\nFLASH 0\nx = 1\nBOLD 1 : y = 2\nz = 3 : ITALIC 0\nPRINT BRIGHT 1; "x"\nPRINT AT 1, 1; FLASH 1; "y"\n').text).toBe('x = 1\ny = 2\nz = 3\nPRINT "x"\nPRINT AT 1, 1; "y"\n');
  });
  it('not in a string or comment', () => {
    const src = 'PRINT "BRIGHT 1"\n\' BRIGHT 1\n';
    expect(mig(src).text).toBe(src);
  });
});

describe('W717 #include <point.bas>', () => {
  it('is removed', () => {
    expect(mig('#include <point.bas>\nx = 1\n').text).toBe('x = 1\n');
    expect(mig('x = 1\n#include <point.bas>').text).toBe('x = 1\n');
  });
});

describe('W718 CHR$ with several arguments', () => {
  it('becomes a concatenation', () => {
    expect(mig('x$ = CHR$(1, 2, 3)').text).toBe('x$ = CHR$(1) + CHR$(2) + CHR$(3)');
    expect(mig('x$ = CHR$(f(1, 2), 3)').text).toBe('x$ = CHR$(f(1, 2)) + CHR$(3)');
  });
  it('one argument stays', () => {
    expect(mig('x$ = CHR$(1)').text).toBe('x$ = CHR$(1)');
  });
});

describe('W719 typed POKE', () => {
  it('gets a comma after the type', () => {
    expect(mig('POKE UINTEGER a, 5').text).toBe('POKE UINTEGER, a, 5');
    expect(mig('POKE ubyte @t(0) + 1, 5').text).toBe('POKE ubyte, @t(0) + 1, 5');
  });
  it('the CPC form and the plain POKE stay', () => {
    expect(mig('POKE UINTEGER, a, 5').text).toBe('POKE UINTEGER, a, 5');
    expect(mig('POKE a, 5').text).toBe('POKE a, 5');
  });
});

describe('must-fix flags W720-W725', () => {
  const codesOf = (src: string, extra?: Record<string, string>): string[] => mig(src, {}, extra).codes;
  it('W720: an attribute item inside PRINT, PLOT, DRAW, CIRCLE', () => {
    for (const src of ['PRINT AT 2, 0; INK 3; "x"', 'PRINT PAPER 1; "x"', 'PLOT INK 2; 1, 2', 'DRAW OVER 1; 1, 2', 'CIRCLE INVERSE 1; 5, 5, 3']) {
      expect(codesOf(src)).toContain('W720');
    }
    expect(codesOf('PRINT "INK 3"')).not.toContain('W720');
  });
  it('W721: statements and functions CPC BASIC does not have', () => {
    for (const src of ['OVER 1', 'INVERSE 1', 'x = ATTR(1, 1)', 'x$ = SCREEN$(1, 1)', 'x = USR "a"', 'x = ACS 1', 'x = ASN 1', 'VERIFY "f"']) {
      expect(codesOf(src)).toContain('W721');
    }
    expect(codesOf('PRINT "USR"')).not.toContain('W721');
  });
  it('W722: Boriel library files, and files nobody has', () => {
    expect(codesOf('#include <pos.bas>\nx = pos(1)')).toEqual(expect.arrayContaining(['W722', 'W722']));
    expect(codesOf('#include <input.bas>\nx$ = input(5)')).toContain('W722');
    expect(codesOf('#include <zzz.bas>')).toContain('W722');
    expect(codesOf('#include <cpcbuild/display.bas>')).not.toContain('W722');
    expect(codesOf('#include "mine.bas"', { 'mine.bas': 'x = 1' })).not.toContain('W722');
    // Spectrum-only code is never compiled for the CPC
    expect(codesOf('#ifdef __ZX48K__\n#include <zxtest.bas>\n#endif')).not.toContain('W722');
  });
  it('the Boriel library functions are not renamed when their file is included', () => {
    const o = mig('#include <pos.bas>\nDIM pos AS UBYTE\n');
    expect(o.text).toBe('#include <pos.bas>\nDIM pos AS UBYTE\n');
  });
  it('W724: pragmas CPC BASIC does not have', () => {
    for (const p of ['array_base = 1', 'string_base = 1', 'zxnext = true']) expect(codesOf(`#pragma ${p}`)).toContain('W724');
    expect(codesOf('#pragma heap_size = 4096')).not.toContain('W724');
  });
});

describe('review flags W726-W737', () => {
  const codesOf = (src: string): string[] => mig(src).codes;
  it('W726: a local DIM with a constant initial value in a loop', () => {
    expect(codesOf('SUB f()\nFOR i = 1 TO 3\nDIM k AS UBYTE = 5\nNEXT\nEND SUB')).toContain('W726');
    expect(codesOf('SUB f()\nDIM k AS UBYTE = 5\nEND SUB')).not.toContain('W726');
    expect(codesOf('DIM k AS UBYTE = 5')).not.toContain('W726');
  });
  it('W728: a comparison used as a number', () => {
    for (const src of ['x = a > b', 'PRINT a = b', 'n = n + (k = 3)', 'f(a < b)', 'z = (a > b) AND (c < d)']) expect(codesOf(src)).toContain('W728');
    for (const src of ['IF a > b THEN', 'WHILE a < b', 'UNTIL a = b', 'IF a > b AND c < d THEN', 'ELSEIF a = 1 THEN']) expect(codesOf(src)).not.toContain('W728');
  });
  it('W729: AND, OR, XOR, NOT on values that are not comparisons', () => {
    for (const src of ['IF x AND y THEN', 'IF NOT done THEN', 'z = a OR b', 'IF a > b AND flag THEN']) expect(codesOf(src)).toContain('W729');
    for (const src of ['IF a > b AND c < d THEN', 'IF NOT (a > b) THEN', 'x = a bAND b']) expect(codesOf(src)).not.toContain('W729');
  });
  it('W730: PAPER, BORDER and PEN made from INK', () => {
    expect(codesOf('PAPER 1')).toContain('W730');
    expect(codesOf('BORDER 2')).toContain('W730');
    expect(codesOf('INK 3')).toContain('W730');
    expect(codesOf('PEN 3')).not.toContain('W730');
  });
  it('W731: PLOT, DRAW, DRAWR', () => {
    for (const src of ['PLOT 1, 2', 'DRAW 1, 2, 3', 'DRAWR 1, 2']) expect(codesOf(src)).toContain('W731');
    expect(codesOf('CIRCLE 1, 2, 3')).not.toContain('W731');
  });
  it('W732, W734: STR$ and INKEY$', () => {
    expect(codesOf('x$ = STR$(5)')).toContain('W732');
    expect(codesOf('k$ = INKEY$')).toContain('W734');
    expect(codesOf('PRINT "STR$ INKEY$"')).toEqual([]);
  });
  it('W733: PRINT of a number, a comma, TAB', () => {
    expect(codesOf('PRINT 5')).toContain('W733');
    expect(codesOf('PRINT a')).toContain('W733');
    expect(codesOf('PRINT "a", "b"')).toContain('W733');
    expect(codesOf('PRINT TAB(5); "x"')).toContain('W733');
    expect(codesOf('PRINT "a"; b$ + "c"')).not.toContain('W733');
    expect(codesOf('PRINT AT 1, 2; "x"')).not.toContain('W733');
    expect(codesOf('DIM s AS STRING\nPRINT s; CHR$(65)')).not.toContain('W733');
  });
  it('W735: MOD whose dividend is not a literal or unsigned', () => {
    expect(codesOf('w = x MOD 3')).toContain('W735');
    expect(codesOf('DIM s AS BYTE\nw = s MOD 3')).toContain('W735');
    expect(codesOf('w = 7 MOD 3')).not.toContain('W735');
    expect(codesOf('DIM u AS UBYTE\nw = u MOD 3')).not.toContain('W735');
    expect(codesOf('w = CAST(UBYTE, x) MOD 3')).not.toContain('W735');
  });
  it('W736: READ into a string when DATA has an unquoted number', () => {
    expect(codesOf('READ a$\nDATA 1, "x"')).toContain('W736');
    expect(codesOf('READ a$\nDATA "x", "y"')).not.toContain('W736');
    expect(codesOf('READ n\nDATA 1, 2')).not.toContain('W736');
  });
  it('W737: DIM without a type', () => {
    expect(codesOf('DIM a = 5')).toContain('W737');
    expect(codesOf('DIM a(5)')).toContain('W737');
    expect(codesOf('DIM a AS UBYTE')).not.toContain('W737');
    expect(codesOf('DIM a, b AS UBYTE')).not.toContain('W737');
  });
});

describe('W727 in a run read as CPC BASIC (follow-up 225)', () => {
  const forms = 'ON n GOTO a, b\nx = UBOUND(arr)\ny = LBOUND(arr)\nDRAW 10, 5\nDRAW 1, 2, 3\nDRAW 1, 2, 3, 4\n';
  it('flags ON n GOTO/GOSUB, UBOUND/LBOUND(a) and two-argument DRAW and changes nothing', () => {
    const o = mig(forms);
    expect(o.text).toBe(forms);
    expect(o.codes.filter((c) => c === 'W727')).toHaveLength(4);
    expect(o.diags.filter((d) => d.code === 'W727').map((d) => d.line)).toEqual([1, 2, 3, 4]);
    expect(o.codes).not.toContain('W705');
  });
  it('does not flag ON ERROR, UBOUND(a, 1) or DRAW with a pen', () => {
    expect(mig('ON ERROR GOTO a\nON BREAK GOSUB a\nx = UBOUND(arr, 1)\nDRAW 1, 2, 3\n').codes).not.toContain('W727');
  });
  it('a Boriel run rewrites them instead and raises no W727', () => {
    const o = mig(forms, { from: 'boriel' });
    expect(o.codes).not.toContain('W727');
    expect(o.codes).toContain('W705');
    expect(o.text).toContain('ON n + 1 GOTO');
  });
  it('an open must-fix flag does not make an auto run Boriel (a second run adds no second + 1)', () => {
    const src = 'ON n GOTO a, b\nPRINT AT 1, 0; INK 3; "x"\n';
    const first = migrate(new Map([['a.bas', src]]), { from: 'boriel' });
    expect(first.files.get('a.bas')).toContain('ON n + 1 GOTO');
    expect(first.report.files[0]?.diagnostics.map((d) => d.code)).toContain('W720');
    const second = migrate(first.files);
    expect(second.files.get('a.bas')).toBe(first.files.get('a.bas'));
    expect(second.report.summary.dialect).toBe('cpcbas');
    expect(second.report.files[0]?.diagnostics.map((d) => d.code)).toContain('W727');
    // and with no flag at all: auto reads a file with a W720 and an ON as CPC BASIC
    const auto = migrate(new Map([['a.bas', src]]));
    expect(auto.files.get('a.bas')).toBe(src);
    expect(auto.report.summary.dialect).toBe('cpcbas');
  });
  it('another rewrite still makes an auto run Boriel', () => {
    const o = mig('ON n GOTO a, b\nx = $10\n');
    expect(o.text).toBe('ON n + 1 GOTO a, b\nx = &10\n');
    expect(o.codes).not.toContain('W727');
  });
});

describe('W735 / and \\ by a power of two (follow-up 234)', () => {
  const has = (src: string): boolean => mig(src).codes.includes('W735');
  it('flags a dividend that is not a literal and not unsigned', () => {
    expect(has('w = x / 4')).toBe(true);
    expect(has('w = x \\ 8')).toBe(true);
    expect(has('w = x / $10')).toBe(true);
    expect(has('w = x / (2)')).toBe(true);
    expect(has('w = (a + b) / 2')).toBe(true);
    expect(has('DIM s AS BYTE\nw = s / 2')).toBe(true);
    expect(has('w = -7 / 2')).toBe(true);
    expect(has('w = CAST(INTEGER, y) / 8')).toBe(true);
  });
  it('does not flag other divisors, literals, unsigned or fractional dividends', () => {
    expect(has('w = x / 3')).toBe(false);
    expect(has('w = x / 1')).toBe(false);
    expect(has('w = x / y')).toBe(false);
    expect(has('w = 8 / 2')).toBe(false);
    expect(has('DIM u AS UBYTE\nw = u / 2')).toBe(false);
    expect(has('w = CAST(UINTEGER, x) \\ 4')).toBe(false);
    expect(has('DIM f AS FIXED\nw = f / 2')).toBe(false);
  });
  it('not in a string or a comment', () => {
    expect(has('PRINT "x / 4"\n\' x / 4\n')).toBe(false);
  });
  it('the message names the operator and the rounding', () => {
    const d = mig('w = x / 4').diags.find((x) => x.code === 'W735');
    expect(d?.message).toContain('/ by a power of two truncates');
    expect(d).toMatchObject({ line: 1, col: 7 });
  });
});

describe('W738 names that differ only in case (follow-up 234)', () => {
  const boriel = (src: string, extra: Record<string, string> = {}): MigrateDiagnostic[] =>
    migrate(new Map([['a.bas', src], ...Object.entries(extra)]), { from: 'boriel' }).report.files.flatMap((f) => f.diagnostics).filter((d) => d.code === 'W738');
  it('a declared name and the same name spelled otherwise: one finding per spelling', () => {
    const d = boriel('DIM score AS UBYTE\nScore = 2\nscore = 3\nSCORE = 4\n');
    expect(d.map((x) => `${x.line}:${x.col}`)).toEqual(['1:5', '2:1', '4:1']);
    expect(d[0]?.message).toContain("'score' differs only in case from 'Score', 'SCORE'");
  });
  it('across the files of a project', () => {
    const d = boriel('DIM Lives AS UBYTE\n', { 'b.bas': 'lives = 3\n' });
    expect(d.map((x) => `${x.file}:${x.line}`).sort()).toEqual(['a.bas:1', 'b.bas:1']);
  });
  it('suffixes are part of the name; keywords, strings, comments and ASM do not count', () => {
    expect(boriel('a$ = "x"\nA% = 1\nprint a$\nPRINT 1\nDim b As UByte\nDIM c AS UBYTE\n')).toEqual([]);
    expect(boriel("DIM score AS UBYTE\nPRINT \"Score\"\n' SCORE\nASM\n ld a, (_Score)\nEND ASM\n")).toEqual([]);
    expect(boriel('A$ = "x"\na$ = "y"\n').length).toBe(2);
  });
  it('words under #pragma case_insensitive do not count; after its pop they do', () => {
    const src = '#pragma push(case_insensitive)\n#pragma case_insensitive = TRUE\nDIM score AS UBYTE\nScore = 2\n#pragma pop(case_insensitive)\nSCORE = 3\n';
    expect(boriel(src)).toEqual([]);
    expect(boriel(`${src}score = 4\n`).map((d) => d.line)).toEqual([6, 7]);
  });
  it('is raised only in a run read as Boriel', () => {
    const src = 'DIM score AS UBYTE\nScore = 2\n';
    expect(mig(src).codes).not.toContain('W738');
    expect(mig(`${src}x = $10\n`).codes.filter((c) => c === 'W738')).toHaveLength(2);
  });
});

describe('W739 UINTEGER with INTEGER, and literals 256-65535 (follow-up 234; needs the compile check)', () => {
  const runtime = new Map([['cpcbuild.bas', 'REM lib\n']]);
  const w739 = (src: string, options: MigrateOptions = { from: 'boriel' }): MigrateDiagnostic[] => mig(src, { runtime, ...options }).diags.filter((d) => d.code === 'W739');
  const head = 'DIM u AS UINTEGER\nDIM i AS INTEGER\nDIM b AS UBYTE\nDIM l AS LONG\nDIM w AS UINTEGER\n';
  it('a UINTEGER compared with an INTEGER, either way round', () => {
    expect(w739(`${head}IF u > i THEN PRINT "x"\n`).map((d) => d.line)).toEqual([6]);
    expect(w739(`${head}IF i <= u THEN PRINT "x"\n`)).toHaveLength(1);
  });
  it('not for a constant, the same types or other pairs', () => {
    expect(w739(`${head}IF u > 100 THEN PRINT "x"\nIF u > u THEN PRINT "x"\nIF i > i THEN PRINT "x"\nIF b > i THEN PRINT "x"\n`)).toEqual([]);
  });
  it('a literal 256-65535 with an unsigned operand reaching a comparison, a division, PRINT, STR$ or a widening', () => {
    for (const stmt of ['IF 256 * b > 5 THEN PRINT "x"', 'x = 256 * b / 3', 'PRINT 256 * b', 'x$ = STR$(b * 256)', 'l = 256 * b', 'l = 1 + 4096 * b']) {
      expect(w739(`${head}${stmt}\n`).map((d) => d.code), stmt).toEqual(['W739']);
    }
  });
  it('not where the result stays 16 bits or the literal is small', () => {
    for (const stmt of ['w = 256 * b', 'i = 256 * b', 'PRINT 255 * b', 'PRINT 70000 * b', 'PRINT 256 * i', 'IF b * 2 > 5 THEN PRINT "x"']) {
      expect(w739(`${head}${stmt}\n`), stmt).toEqual([]);
    }
  });
  it('the position is the input\'s, after rewrites on the line', () => {
    const d = w739(`${head}x = (3 bAND 1) + 256 * b / 3\n`);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ line: 6, col: 18, endLine: 6, endCol: 25 });
  });
  it('only with the compile check, and only in a run read as Boriel', () => {
    const src = `${head}IF u > i THEN PRINT "x"\n`;
    expect(w739(src, { from: 'boriel', runtime: undefined })).toEqual([]);
    expect(w739(src, {})).toEqual([]);
  });
});

describe('a file that is not UTF-8 (follow-up 234)', () => {
  const latin1 = Uint8Array.from([...'x = $FF\nREM caf'].map((c) => c.charCodeAt(0)).concat([0xe9], [...'\nPRINT "m'].map((c) => c.charCodeAt(0)), [0xfc], [...'ller"\n'].map((c) => c.charCodeAt(0))));
  it('is left unchanged, with one W725 finding at the first bad byte', () => {
    const r = migrate(new Map<string, string | Uint8Array>([['a.bas', latin1], ['b.bas', 'y = $10\n']]));
    const f = r.report.files.find((x) => x.path === 'a.bas');
    expect(f?.changed).toBe(false);
    expect(f?.diagnostics).toHaveLength(1);
    expect(f?.diagnostics[0]).toMatchObject({ code: 'W725', message: 'not UTF-8: left unchanged', line: 2, col: 8, severity: 'warning' });
    expect(r.files.get('a.bas')).not.toContain('&FF');
    // the other file is translated as usual
    expect(r.files.get('b.bas')).toBe('y = &10\n');
  });
  it('valid UTF-8 (a multi-byte character, a BOM) is translated', () => {
    const utf8 = new TextEncoder().encode('﻿x = $FF\nPRINT "café €"\n');
    const r = migrate(new Map([['a.bas', utf8]]));
    expect(r.files.get('a.bas')).toBe('x = &FF\nPRINT "café €"\n');
    expect(r.report.files[0]?.diagnostics.map((d) => d.code)).not.toContain('W725');
  });
  it.each([
    [[0xc0, 0x80], 'an overlong form'],
    [[0xed, 0xa0, 0x80], 'a surrogate'],
    [[0xf4, 0x90, 0x80, 0x80], 'above U+10FFFF'],
    [[0xe2, 0x82], 'a cut sequence'],
    [[0x80], 'a stray continuation byte'],
  ])('%j (%s) is not UTF-8', (bytes) => {
    const r = migrate(new Map([['a.bas', Uint8Array.from([...Array.from('REM '), 0, ...bytes, 10].map((x) => (typeof x === 'string' ? x.charCodeAt(0) : x)))]]));
    expect(r.report.files[0]?.diagnostics.map((d) => d.message)).toEqual(['not UTF-8: left unchanged']);
  });
});

describe('the report', () => {
  it('has file, line, column, severity (note for a rewrite), code, message and a hint on flags', () => {
    const r = migrate(new Map([['dir/a.bas', 'x = 1\ny = $FF\nz = a > b\n']]));
    const f = r.report.files[0];
    expect(f?.path).toBe('dir/a.bas');
    expect(f?.changed).toBe(true);
    const w700 = f?.diagnostics.find((d) => d.code === 'W700');
    expect(w700).toMatchObject({ file: 'dir/a.bas', line: 2, col: 5, endLine: 2, endCol: 8, severity: 'note', message: 'Boriel number literal rewritten: $FF -> &FF' });
    expect(w700?.hint).toBeUndefined();
    const w728 = f?.diagnostics.find((d) => d.code === 'W728');
    expect(w728).toMatchObject({ line: 3, col: 5, severity: 'warning' });
    expect(w728?.hint).toContain('-(a > b)');
    expect(r.report.version).toBe(1);
    expect(r.report.summary).toEqual({ files: 1, changed: 1, counts: { W700: 1, W728: 1 }, dialect: 'boriel' });
  });
  it('line and column are those of the input when the output moved', () => {
    const r = migrate(new Map([['a.bas', '#pragma push(case_insensitive)\nx = $FF\nBRIGHT 1\ny = a > b\n']]));
    const d = r.report.files[0]?.diagnostics.find((x) => x.code === 'W728');
    expect(d).toMatchObject({ line: 4, col: 5 });
  });
  it('is deterministic, and an unchanged file is not changed', () => {
    const files = new Map([['b.bas', 'PRINT 1'], ['a.bas', 'x = $FF']]);
    const one = migrate(files);
    const two = migrate(new Map([...files].reverse()));
    expect(JSON.stringify(one.report)).toBe(JSON.stringify(two.report));
    expect(one.report.files.map((f) => f.path)).toEqual(['a.bas', 'b.bas']);
    expect(one.report.files.map((f) => f.changed)).toEqual([true, false]);
  });
});

describe('the compile check (with a runtime)', () => {
  const runtime = new Map([['cpcbuild.bas', 'REM lib\n']]);
  it('W725 carries the compiler error of the translated program', () => {
    const r = migrate(new Map([['main.bas', 'x = $FF\nPRINT AT 1, 1; INK 2; "x"\n']]), { runtime });
    const d = r.report.files[0]?.diagnostics.filter((x) => x.code === 'W725') ?? [];
    expect(d.length).toBeGreaterThan(0);
    expect(d[0]?.message).toMatch(/^E\d{3}:/);
  });
  it('W300 on the translated program is W737, at the input position', () => {
    const r = migrate(new Map([['main.bas', 'REM first\n#pragma push(case_insensitive)\nfoo = 5\n']]), { runtime });
    const d = r.report.files[0]?.diagnostics.find((x) => x.code === 'W737');
    expect(d).toMatchObject({ line: 3, col: 1 });
  });
  it('mains: every .bas no other file includes; or the ones named', () => {
    const files = new Map([
      ['main.bas', '#include "lib.bas"\nx = 1\n'],
      ['lib.bas', 'y = 2\n'],
    ]);
    const auto = migrate(files, { runtime });
    expect(auto.report.files.flatMap((f) => f.diagnostics).some((d) => d.code === 'W737' && d.file === 'lib.bas')).toBe(true);
    const none = migrate(files, { runtime, mains: [] });
    expect(none.report.files.flatMap((f) => f.diagnostics)).toEqual([]);
  });
  it('without a runtime neither W725 nor W737 is raised', () => {
    const r = migrate(new Map([['main.bas', 'foo = 5\nPRINT AT 1, 1; INK 2; "x"\n']]));
    const codes = r.report.files.flatMap((f) => f.diagnostics.map((d) => d.code));
    expect(codes).not.toContain('W725');
    expect(codes).not.toContain('W737');
  });
});

describe('idempotence', () => {
  const sources = [
    'DIM frame AS UBYTE\nframe = $FF bAND 3\nON frame GOTO a, b\na:\nb:\nDRAW 1, 2\nx = UBOUND(arr)\nSUB s()\n RETURN\nEND SUB\nPRINT CHR$ 13\nx = h$(1 TO 2)\n',
    '#pragma push(case_insensitive)\nBRIGHT 1\nINK 2\nPOKE UINTEGER a, 1\nASM\n ld a, (_frame)\nEND ASM\n',
  ];
  it.each(sources)('a second run changes nothing (%#)', (src) => {
    const one = migrate(new Map([['a.bas', src]]));
    const two = migrate(one.files);
    expect(two.files.get('a.bas')).toBe(one.files.get('a.bas'));
    expect(two.report.summary.changed).toBe(0);
  });
  it('CPC BASIC input is untouched', () => {
    const src = 'MODE 1\nFRAME\nON n GOTO a, b\nDRAW 10, 5\nx = UBOUND(a)\nDIM code AS UBYTE\ncode = &FF AND 3\nPEN 1\nMID$(a$, 1, 2) = "x"\na:\nb:\n';
    const o = mig(src);
    expect(o.text).toBe(src);
    expect(o.diags.filter((d) => d.severity === 'note')).toEqual([]);
  });
});
