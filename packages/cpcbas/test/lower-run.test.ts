/**
 * L2-LOWER on the simulator: small programs for each construct the conformance programs do
 * not reach (typed variables, DO and SELECT, EXIT and CONTINUE, dynamic FOR steps, shifts,
 * MIN and MAX, @, PEEK types, the screen statements with computed arguments, CALL with a
 * computed address). Each prints a transcript compared with hand-computed Locomotive output.
 */
import { describe, expect, it } from 'vitest';
import { normalise, runSource } from './compile-helper.js';

const run = (source: string): string => {
  const r = runSource(source);
  expect(r.built.problems).toEqual([]);
  expect(r.stopped).toBe('rst0');
  return normalise(r.printer) as string;
};

describe('control flow', () => {
  it('DO with CONTINUE and EXIT', () => {
    expect(run('i=0\nDO\ni=i+1\nIF i=2 THEN CONTINUE DO\nIF i>4 THEN EXIT DO\nPRINT i;\nLOOP\nPRINT')).toBe(' 1  3  4 \n');
  });
  it('DO ... LOOP UNTIL and DO WHILE ... LOOP', () => {
    expect(run('n=0\nDO\nn=n+1\nLOOP UNTIL n>=3\nPRINT n\nDO WHILE n<6\nn=n+2\nLOOP\nPRINT n\nn=9\nDO UNTIL n>5\nPRINT "never"\nLOOP\nDO\nn=n-1\nLOOP WHILE n>7\nPRINT n')).toBe(' 3 \n 7 \n 7 \n');
  });
  it('EXIT FOR and CONTINUE FOR act on the innermost FOR', () => {
    expect(
      run('FOR i=1 TO 3\nFOR j=1 TO 3\nIF j=2 THEN CONTINUE FOR\nIF i=2 THEN EXIT FOR\nPRINT i*10+j;\nNEXT j\nNEXT i\nPRINT'),
    ).toBe(' 11  13  31  33 \n');
  });
  it('EXIT WHILE', () => {
    expect(run('n=0\nWHILE -1\nn=n+1\nIF n=3 THEN EXIT WHILE\nWEND\nPRINT n')).toBe(' 3 \n');
  });
  it('SELECT CASE with values, a range, IS and ELSE', () => {
    expect(
      run('FOR n=0 TO 6\nSELECT CASE n\nCASE 1, 2\nPRINT "a";\nCASE 3 TO 4\nPRINT "b";\nCASE IS >= 6\nPRINT "c";\nCASE ELSE\nPRINT "e";\nEND SELECT\nNEXT\nPRINT'),
    ).toBe('eaabbec\n');
  });
  it('SELECT CASE evaluates its subject once', () => {
    expect(run('n=0\nSELECT CASE n+1\nCASE 0\nPRINT "zero"\nCASE 1\nPRINT "one"\nEND SELECT')).toBe('one\n');
  });
  it('FOR with a step in a variable (sign decided at run time) and an empty range', () => {
    expect(run('s=-1\nFOR i=3 TO 1 STEP s\nPRINT i;\nNEXT\ns=2\nFOR i=1 TO 6 STEP s\nPRINT i;\nNEXT\nPRINT\nFOR i=5 TO 1\nPRINT "never";\nNEXT\nPRINT i')).toBe(
      ' 3  2  1  1  3  5 \n 5 \n',
    );
  });
  it('a FOR whose increment would wrap past the limit stops at the limit', () => {
    expect(
      run(
        'DIM b AS UBYTE\nn = 0\nFOR b = 250 TO 255\nn = n + 1\nNEXT\nPRINT n; b\nFOR b = 3 TO 0 STEP -1\nPRINT b;\nNEXT\nPRINT b\nm% = 32767\nn = 0\nFOR i% = 32765 TO m%\nn = n + 1\nNEXT\nPRINT n; i%\nm% = -32768\nFOR i% = -32766 TO m% STEP -1\nPRINT i%;\nNEXT\nPRINT',
      ),
    ).toBe(' 6  0 \n 3  2  1  0  255 \n 3 -32768 \n-32766 -32767 -32768 \n');
  });
  it('a FOR with a larger step ends at the limit instead of wrapping past it (the variable keeps the narrowed sum)', () => {
    expect(run('DIM b AS UBYTE\nn = 0\nFOR b = 0 TO 255 STEP 5\nn = n + 1\nNEXT\nPRINT n; b')).toBe(' 52  4 \n');
    expect(run('DIM b AS UBYTE\nFOR b = 9 TO 0 STEP -3\nPRINT b;\nNEXT\nPRINT b')).toBe(' 9  6  3  0  253 \n');
    expect(run('DIM b AS UBYTE\nn = 250\nFOR b = 200 TO n STEP 20\nPRINT b;\nNEXT\nPRINT b')).toBe(' 200  220  240  4 \n');
  });
  it('the wider-sum FOR also works in a SUB', () => {
    expect(run('SUB t()\nDIM b AS UBYTE\nn = 0\nFOR b = 0 TO 255 STEP 5\nn = n + 1\nNEXT\nPRINT n\nEND SUB\nt()')).toBe(' 52 \n');
  });
  it('a FOR with a step in an INTEGER variable ends at 32767 and at -32768', () => {
    expect(run('m% = 32767\ns% = 100\nn = 0\nFOR i% = 32500 TO m% STEP s%\nn = n + 1\nNEXT\nPRINT n; i%')).toBe(' 3 -32736 \n');
    expect(run('m% = -32768\ns% = -100\nn = 0\nFOR i% = -32500 TO m% STEP s%\nn = n + 1\nNEXT\nPRINT n; i%')).toBe(' 3  32736 \n');
    expect(run('m% = 32767\nFOR i% = 32000 TO m% STEP 400\nPRINT i%;\nNEXT\nPRINT')).toBe(' 32000  32400 \n');
  });
  it('a step of 1 with a variable limit ends one past the limit, honours a change in the body, and runs an empty range zero times', () => {
    expect(run('n = 5\nFOR i = 1 TO n\nNEXT\nPRINT i\nFOR i = 1 TO n\nPRINT i;\nIF i = 2 THEN i = 9\nNEXT\nPRINT i\nFOR i = n TO 1\nPRINT "never";\nNEXT\nPRINT i')).toBe(' 6 \n 1  2  10 \n 5 \n');
  });
  it('the FOR limit is evaluated once', () => {
    expect(run('n=3\nFOR i=1 TO n\nn=10\nPRINT i;\nNEXT\nPRINT')).toBe(' 1  2  3 \n');
  });
  it('ON with a selector of 0 or above n falls through; 1 and n jump (measured, loco-measured.md 2026-11-08)', () => {
    const prog = (sel: string): string => `10 n=${sel}\n20 ON n GOTO 100,200\n30 PRINT "f"\n40 END\n100 PRINT "a"\n110 END\n200 PRINT "b"`;
    expect([0, 1, 2, 3, 255].map((n) => run(prog(String(n))))).toEqual(['f\n', 'a\n', 'b\n', 'f\n', 'f\n']);
  });
  it('ON with a selector of -1, 256 or more raises error 5 (measured)', () => {
    for (const sel of ['-1', '256', '1000', '-32768']) {
      const r = runSource(`10 n=${sel}\n20 ON n GOTO 100,200\n30 PRINT "fell"\n40 END\n100 PRINT "a"\n200 PRINT "b"`);
      expect(r.screen, sel).toContain('Error 5');
      expect(r.screen, sel).not.toContain('fell');
    }
    const g = runSource('10 n=-1\n20 ON n GOSUB 100\n30 PRINT "fell"\n40 END\n100 RETURN');
    expect(g.screen).toContain('Error 5');
  });
  it('ON ... GOSUB and RETURN inside a loop', () => {
    expect(run('10 FOR k=1 TO 3\n20 ON k GOSUB 100,200\n30 NEXT\n40 END\n100 PRINT "one";:RETURN\n200 PRINT "two";:RETURN')).toBe('onetwo\n');
  });
});

describe('types and operators', () => {
  it('typed variables wrap in their own width and print in their own type', () => {
    expect(
      run(
        'DIM b AS UBYTE = 250\nb = b + 10\nPRINT b\nDIM c AS BYTE = -5\nPRINT c; c*2\nDIM l AS LONG = 100000\nPRINT l*3; -l\nDIM u AS UINTEGER = 60000\nPRINT u+1',
      ),
    ).toBe(' 4 \n-5 -10 \n 300000 -100000 \n 60001 \n');
  });
  it('mixed 16-bit signedness computes in LONG instead of wrapping', () => {
    expect(
      run('DIM u AS UINTEGER = 60000\nDIM b AS BYTE = -1\ni% = 1000\nPRINT i% + 40000; u - i%; u < i%; b + u\ni% = -1\nPRINT u > i%; i% * u'),
    ).toBe(' 41000  59000  0  59999 \n-1 -60000 \n');
  });
  it('shifts take the count in any integer type', () => {
    expect(run('a=1:b=-16:s=3\nPRINT a<<4; b>>2; a<<s')).toBe(' 16 -4  8 \n');
  });
  it('MIN, MAX, ABS and SGN', () => {
    expect(run('a=3:b=-7\nPRINT MIN(a,b); MAX(a,b); ABS(b); SGN(b); SGN(a); SGN(a-3)\nPRINT MIN(a*2,b+20,4); MAX(a,b,10)')).toBe('-7  3  7 -1  1  0 \n 4  10 \n');
  });
  it('@ gives the address of a variable; PEEK reads bytes and words', () => {
    expect(run('a=&1234\nPRINT PEEK(@a); PEEK(@a+1)\nPRINT PEEK(UINTEGER, @a)')).toBe(' 52  18 \n 4660 \n');
  });
  it('CAST, CINT and UNT convert', () => {
    expect(run('x=300\nPRINT CAST(UBYTE, x); CAST(BYTE, x-100); CINT(70); UNT(-1)')).toBe(' 44 -56  70 -1 \n');
  });
  it('a DIM initial value and DIM ... AT', () => {
    expect(run('DIM a AS INTEGER = 42\nPRINT a\nDIM p AS UBYTE AT &C7E0\np = 9\nPRINT PEEK(&C7E0)')).toBe(' 42 \n 9 \n');
  });
  it('an ASM block is emitted as written', () => {
    expect(run('ASM\n ld a, 65\n call .core.__LOCO_PUTC\nEND ASM\nPRINT')).toBe('A\n');
  });
});

describe('screen statements and CALL', () => {
  it('LOCATE with computed arguments, POS and VPOS', () => {
    expect(run('x=7:y=4\nLOCATE x,y\nPRINT POS(#0); VPOS(#0)')).toBe(' 7  4 \n');
  });
  it('MODE, PEN, PAPER, BORDER and CLS reach the firmware', () => {
    const r = runSource('MODE 1\nPEN 3\nPAPER 1\nBORDER 5\nc=9\nBORDER c, 4\nCLS\nPRINT "x"');
    expect(r.built.problems).toEqual([]);
    expect(r.stopped).toBe('rst0');
    expect([r.cpc.mode, r.cpc.pen, r.cpc.paper]).toEqual([1, 3, 1]);
    expect(r.cpc.border).toEqual([9, 4]);
    expect(normalise(r.printer)).toBe('x\n');
  });
  it('a BORDER with one colour uses it twice', () => {
    const r = runSource('c=7\nBORDER c');
    expect(r.cpc.border).toEqual([7, 7]);
  });
  it('LOCATE outside the screen raises error 5', () => {
    const r = runSource('LOCATE 0,1\nPRINT "after"');
    expect(r.screen).toContain('Error 5');
    expect(r.screen).not.toContain('after');
    // 99 is no longer an error: Locomotive refuses only 0 and above 255 (loco-measured.md 2026-11-08)
    const r2 = runSource('x=256\nLOCATE x,1\nPRINT "after"');
    expect(r2.screen).toContain('Error 5');
  });
  it('LOCATE past the width wraps to the next row, a row above 25 is 25, from 129 on the first (measured, loco-measured.md 2026-11-08, L4-TEXT)', () => {
    // Mode 1 (the default): LOCATE 40,1 col 40 row 1; 41,1 and 81,1 col 1 row 2; 1,25 and 1,26 row 25; 255,1 col 40 row 1 (the last
    // column of the row before); 1,255 row 1.
    const prog = [
      'FOR k=1 TO 7',
      'READ c,r',
      'LOCATE c,r',
      'a=POS(#0):b=VPOS(#0)',
      'LOCATE 1,10',
      'PRINT a;b',
      'NEXT',
      'DATA 40,1, 41,1, 81,1, 1,25, 1,26, 255,1, 1,255',
    ].join('\n');
    expect(run(prog)).toBe(' 40  1 \n 1  2 \n 1  2 \n 1  25 \n 1  25 \n 40  1 \n 1  1 \n');
  });
  it('LOCATE 256 or 257 (computed or constant) and a negative value raise error 5', () => {
    for (const src of ['LOCATE 256,1', 'LOCATE 257,1', 'LOCATE 1,256', 'x=256\nLOCATE x,1', 'x=257\nLOCATE x,1', 'x=257\nLOCATE 1,x', 'x=-1\nLOCATE x,1', 'x=0\nLOCATE x,1', 'x=0\nLOCATE 1,x']) {
      const r = runSource(`${src}\nPRINT "never"`);
      expect(r.screen, src).toContain('Error 5');
      expect(r.screen, src).not.toContain('never');
    }
  });
  it('CALL of a computed address passes A = count and IX = the block, and restores IX and SP', () => {
    // routine at &C7D0: ld (&C7F0),a ; ld l,(ix+0) ; ld h,(ix+1) ; ld (&C7F1),hl ; ret
    const code = [0x32, 0xf0, 0xc7, 0xdd, 0x6e, 0x00, 0xdd, 0x66, 0x01, 0x22, 0xf1, 0xc7, 0xc9];
    const pokes = code.map((b, i) => `POKE &C7D0+${i},${b}`).join(':');
    const out = run(`${pokes}\na=&C7D0\nCALL a, 11, 300\nPRINT PEEK(&C7F0); PEEK(UINTEGER, &C7F1)\nCALL a\nPRINT PEEK(&C7F0)`);
    expect(out).toBe(' 2  300 \n 0 \n');
  });
});

describe('a FUNCTION whose ASM block leaves the result in the registers', () => {
  const asmFn = [
    'FUNCTION Seven(x AS UBYTE) AS UBYTE',
    'ASM',
    'ld a, 7',
    'END ASM',
    'END FUNCTION',
    'FUNCTION Wide(x AS UBYTE) AS UINTEGER',
    'ASM',
    'ld hl, 4660',
    'END ASM',
    'END FUNCTION',
    'FUNCTION Len2(s AS STRING) AS UBYTE',
    'ASM',
    'ld a, 9',
    'END ASM',
    'END FUNCTION',
    'FUNCTION Plain(x AS UBYTE) AS UBYTE',
    'RETURN x + 1',
    'END FUNCTION',
  ].join('\n');
  it('returns A or HL as the ASM left them (the reference compiler\'s rule; the library relies on it)', () => {
    expect(run(`${asmFn}\nPRINT Seven(1); Wide(2); Plain(4)`)).toBe(' 7  4660  5 \n');
  });
  it('keeps the result when a string parameter is freed on the way out', () => {
    expect(run(`${asmFn}\nPRINT Len2("abc" + "d")`)).toBe(' 9 \n');
  });
  it('keeps a REAL result (A E D C B = bytes 0..4 of the layout) when a string parameter is freed', () => {
    // 5-byte REAL: exponent &98 (2^24) in B, mantissa bytes 0..3 = &00 05 00 00 with the implied top bit: &800005 = 8388613.
    const src = ['FUNCTION Big(s AS STRING) AS REAL', 'ASM', 'ld a, 0', 'ld e, 5', 'ld d, 0', 'ld c, 0', 'ld b, 0x98', 'END ASM', 'END FUNCTION', 'PRINT Big("ab" + "c")'].join('\n');
    expect(run(src)).toBe(' 8388613 \n');
  });
  it('a FUNCTION without RETURN whose only asm is the lowering\'s own (LOCATE, BORDER) still returns 0', () => {
    const src = ['FUNCTION F(x AS UBYTE) AS UINTEGER', 'LOCATE 1, 1', 'BORDER 1', 'END FUNCTION', 'LOCATE 1, 3', 'PRINT F(1)'].join('\n');
    expect(run(src)).toBe(' 0 \n');
  });
});

describe('masks the library uses', () => {
  it('a UINTEGER ANDed with &FFFE keeps its high bit (cpcplus DmaAlign)', () => {
    expect(run('DIM a AS UINTEGER\na = 4660\nPRINT (a + 1) AND &FFFE\na = 65000\nPRINT (a + 1) AND &FFFE')).toBe(' 4660 \n 65000 \n');
  });
});

describe('CONST of built-in functions', () => {
  it('a CONST from ABS, LEN, CHR$, MID$ and STR$ can size an array and be printed', () => {
    expect(
      run('CONST k = ABS(-3)\nCONST n = LEN("abc")\nCONST s$ = CHR$(65) + MID$("hello", 2, 3) + STR$(7)\nDIM t(k + n) AS INTEGER\nPRINT k; n; UBOUND(t, 1)\nPRINT s$'),
    ).toBe(' 3  3  6 \nAell 7\n');
  });
});

describe('^ is always REAL (follow-up 41; Locomotive: PRINT 2^30 and 10^9 measured on the interpreter)', () => {
  it('constant integer powers print as REAL numbers', () => {
    expect(run('PRINT 2^3\nPRINT 2^30\nPRINT 10^9\nPRINT 10^8')).toBe(' 8 \n 1.07374E+09 \n 1E+09 \n 100000000 \n');
  });
  it('an array bound and an INTEGER CONST can be written with ^', () => {
    expect(run('CONST n AS INTEGER = 2^8\nDIM t(2^8) AS UBYTE\nPRINT n; UBOUND(t, 1)')).toBe(' 256  256 \n');
  });
});

describe('EXIT SUB / EXIT FUNCTION leave a procedure early (R11 shapes, now spelt as the library spells them)', () => {
  it('a SUB with parameters, an early RETURN and an ASM block (music_cpc.bas SfxPlay)', () => {
    const src = [
      'SUB P(n AS UBYTE, channel AS UBYTE, invvol AS UBYTE)',
      '  IF n = 0 OR channel > 2 THEN EXIT SUB',
      '  IF invvol > 16 THEN invvol = 16',
      '  ASM',
      '  ld a, (ix+5)',
      '  END ASM',
      '  PRINT "in"; n; invvol',
      'END SUB',
      'P(1, 0, 20)',
      'P(0, 1, 0)',
      'P(1, 3, 0)',
      'P(2, 2, 3)',
      'PRINT "end"',
    ].join('\n');
    expect(run(src)).toBe('in 1  16 \nin 2  3 \nend\n');
  });

  it('a FUNCTION: EXIT FUNCTION gives the value assigned to the name so far, and frees a local string array on that path', () => {
    const src = [
      'FUNCTION F(k AS INTEGER) AS INTEGER',
      '  DIM w(3) AS STRING',
      '  w(1) = "abc"',
      '  F = 5',
      '  IF k > 0 THEN EXIT FUNCTION',
      '  F = 9',
      'END FUNCTION',
      'DIM i AS INTEGER, s AS INTEGER',
      'FOR i = 1 TO 500: s = F(1): NEXT', // 500 leaked arrays would not fit in the 4768-byte heap (error 7)
      'PRINT F(1); F(0)',
    ].join('\n');
    expect(run(src)).toBe(' 5  9 \n');
  });
});
