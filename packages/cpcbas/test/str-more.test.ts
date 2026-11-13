/**
 * L3-STR on the simulator: string SELECT CASE, HEX$, BIN$, DEC$, the MID$ statement and PRINT AT,
 * compiled from BASIC source through the whole pipeline. The expected values are the transcripts
 * of the real interpreter (tests/loco/probes/p-strfmt.bas and p-dec.bas, run on the 464 and the
 * 6128), the manuals' examples, or hand-computed from the spec
 * (SELECT CASE and PRINT AT have no interpreter equivalent). The leak tests compare the heap's
 * free list after 1000 iterations with that after 2.
 */
import { describe, expect, it } from 'vitest';
import { normalise, runSource } from './compile-helper.js';
import type { AssembledRun, RunOptions } from './z80sim/run.js';

function exec(source: string, options: RunOptions = {}): AssembledRun {
  const r = runSource(source, options, true);
  expect(r.built.problems).toEqual([]);
  expect(r.stopped).toBe('rst0');
  return r;
}
const run = (source: string, options: RunOptions = {}): string => normalise(exec(source, options).printer) as string;
const errorOf = (source: string): string => {
  const r = exec(`${source}\nPRINT "never"`);
  expect(r.printer, source).not.toContain('never');
  return /Error \d+/.exec(r.printer)?.[0] ?? 'no error';
};

const word = (r: AssembledRun, a: number): number => (r.memory[a] as number) | ((r.memory[a + 1] as number) << 8);
/** Bytes free on the heap: the sum of the free list's blocks. */
function heapFree(r: AssembledRun): number {
  const heap = r.image.addr('.core.ZXBASIC_MEM_HEAP');
  let total = 0;
  let p = word(r, heap + 2);
  let guard = 0;
  while (p !== 0 && guard++ < 10000) {
    total += word(r, p);
    p = word(r, p + 2);
  }
  return total;
}
const freeAfter = (setup: string, body: string, n: number): number => heapFree(exec(`${setup}\nFOR i=1 TO ${n}\n${body}\nNEXT\nPRINT "done"`, { maxTStates: 2_000_000_000 }));

const DEC_ROWS: [string, string, string][] = [
  ["1234.5678", "\"####.##\"", "1234.57"],
  ["5", "\"###\"", "  5"],
  ["-5", "\"###\"", " -5"],
  ["123", "\"##\"", "%123"],
  ["-123", "\"###\"", "%-123"],
  ["0", "\"###\"", "  0"],
  ["0", "\"#.##\"", "0.00"],
  ["0.5", "\"#.##\"", "0.50"],
  ["0.5", "\".##\"", ".50"],
  ["-0.5", "\"#.##\"", "-.50"],
  ["1234567", "\"#,###,###\"", "1,234,567"],
  ["1234567", "\"##,###,###\"", " 1,234,567"],
  ["12", "\"#,###\"", "   12"],
  ["1234.5", "\"#,###.#\"", "1,234.5"],
  ["1234.5", "\"####,.##\"", "1,234.50"],
  ["-1234", "\"#,###\"", "%-1,234"],
  ["999", "\"#,###\"", "  999"],
  ["1000", "\"#,###\"", "1,000"],
  ["100000", "\"#,###\"", "%100,000"],
  ["5", "\"+###\"", "  +5"],
  ["-5", "\"+###\"", "  -5"],
  ["5", "\"###+\"", "  5+"],
  ["-5", "\"###+\"", "  5-"],
  ["5", "\"###-\"", "  5 "],
  ["-5", "\"###-\"", "  5-"],
  ["5", "\"**###\"", "****5"],
  ["-5", "\"**###\"", "***-5"],
  ["0", "\"**##\"", "***0"],
  ["123", "\"**##\"", "*123"],
  ["5", "\"$$###\"", "   $5"],
  ["-5", "\"$$###\"", "  -$5"],
  ["5", "\"$$#\"", " $5"],
  ["123", "\"$$#\"", "%$123"],
  ["5", "\"**$###\"", "****$5"],
  ["5", "\"+$$##\"", "  +$5"],
  ["-5", "\"+$$##\"", "  -$5"],
  ["5", "\"$$##+\"", "  $5+"],
  ["5", "\"##.##^^^^\"", " 5.00E+00"],
  ["12345.678", "\"#.###^^^^\"", " .123E+05"],
  ["0", "\"##^^^^\"", " 0E+00"],
  ["-5", "\"##^^^^\"", "-5E+00"],
  ["0.00123", "\"#.##^^^^\"", " .12E-02"],
  ["2.5", "\"#\"", "3"],
  ["3.5", "\"#\"", "4"],
  ["0.125", "\"#.##\"", "0.13"],
  ["0.995", "\"#.##\"", "1.00"],
  ["9.995", "\"#.##\"", "%10.00"],
  ["99.5", "\"##\"", "%100"],
  ["-0.001", "\"#.##\"", "0.00"],
  ["-0.5", "\"#\"", "%-1"],
  ["0.4", "\"#\"", "0"],
  ["1E10", "\"#.##\"", "%10000000000.00"],
  ["123456789012", "\"############\"", "123456789000"],
  ["1E15", "\"#\"", "%1000000000000000"],
  ["123456789", "\"#########\"", "123456789"],
  ["1234567.891", "\"#######.###\"", "1234567.890"],
  ["0.000001", "\"#.#######\"", "0.0000010"],
  ["5", "\"#,\"", " 5"],
  ["10000000", "CHR$(163)+CHR$(163)+\"########,.##\"", "\u00a310,000,000.00"],
  ["-5", "CHR$(163)+CHR$(163)+\"##\"", " -\u00a35"],
  ["5", "\"**\"+CHR$(163)+\"##\"", "***\u00a35"],
  ["-0.001", "\"+#.##\"", "+0.00"],
  ["-0.001", "\"#.##-\"", "0.00 "],
  ["1E16", "\"#\"", "%10000000000000000"],
  ["1E17", "\"#\"", "%100000000000000000"],
  ["1E19", "\"#\"", "%10000000000000000000"],
  ["1E20", "\"#\"", "%1E+20"],
  ["1E25", "\"#\"", "%1E+25"],
  ["-1E20", "\"#\"", "%-1E+20"],
  ["123456789012345", "\"#\"", "%123456789000000"],
  ["0.00001", "\"#.##\"", "0.00"],
  ["0.333333333333", "\"#.###########\"", "0.33333333300"],
  ["0.666666666667", "\"##.##########\"", " 0.6666666670"],
  ["123.456", "\"###.###########\"", "123.45600000000"],
  ["5", "\"##,,#\"", "    5"],
  ["12345.6", "\"##,###.#\"", "12,345.6"],
  ["5", "\"+**##\"", "***+5"],
  ["-5", "\"**##-\"", "***5-"],
  ["5", "\"$$##-\"", "  $5 "],
  ["0", "\"+###\"", "  +0"],
  ["0.5", "\"$$#.##\"", " $0.50"],
  ["0.5", "\"$$.##\"", "$0.50"],
  ["0.5", "\"+#.##\"", "+0.50"],
  ["-0.5", "\"+.##\"", "-.50"],
  ["0.5", "\"##.##\"", " 0.50"],
  ["-0.5", "\"##.##\"", "-0.50"],
  ["-0.5", "\"**.##\"", "-0.50"],
  ["5", "\"**,##\"", "****5"],
  ["1234", "\"**,###\"", "*1,234"],
  ["1234", "\"$$,###\"", "$1,234"],
  ["123", "\"##,#\"", " 123"],
  ["1234", "\"##,#\"", "%1,234"],
  ["5.5", "\"#.#+\"", "5.5+"],
  ["5", "\"+.#\"", "%+5.0"],
  ["-5", "\"#.#-\"", "5.0-"],
  ["5", "\"$$\"", "$5"],
  ["5", "\"**\"", "*5"],
  ["5", "\"#\"", "5"],
  ["5", "\"**$\"", "*$5"],
  ["12.345", "\"#####\"", "   12"],
  ["12.345", "\"####.\"", "  12."],
  ["0", "\"#.##^^^^\"", " .00E+00"],
  ["5", "\"##^^^^\"", " 5E+00"],
  ["5", "\"####.##^^^^\"", " 500.00E-02"],
  ["12345", "\"##.##^^^^\"", " 1.23E+04"],
  ["0.05", "\"##.##^^^^\"", " 5.00E-02"],
  ["-12345", "\"+##.##^^^^\"", "-12.35E+03"],
  ["12345", "\"##.##^^^^-\"", "12.35E+03 "],
  ["99999", "\"#.##^^^^\"", " .10E+06"],
  ["12345", "\"#.##^^^^\"", " .12E+05"],
  ["1E30", "\"##.##^^^^\"", " 1.00E+30"],
  ["1E-30", "\"##.##^^^^\"", " 1.00E-30"],
  ["5", "\"**##^^^^\"", "*500E-02"],
  ["5", "\"#^^^^\"", "%5E+00"],
  ["1E-38", "\"#.#\"", "0.0"],
];

const DEC_ERRORS: [string, string][] = [
  ["5", "\"-###\""],
  ["-5", "\"-###\""],
  ["5", "\"+###-\""],
  ["5", "\"**+##\""],
  ["5", "\"##**\""],
  ["5", "\"^^^^\""],
  ["5", "\"#^^^\""],
  ["5", "\"#^^^^^\""],
  ["5", "\"#.#.#\""],
  ["5", "\"##.##.##\""],
  ["5", "\"A##\""],
  ["5", "\"\""],
  ["5", "\"abc\""],
  ["5", "\"##a\""],
  ["5", "\"# #\""],
  ["5", "\",#\""],
  ["5", "\".\""],
  ["5", "\"$$$##\""],
  ["5", "\"***##\""],
  ["5", "\",##\""],
  ["5", "CHR$(163)+\"##\""],
  ["5", "\"$\"+CHR$(163)+\"##\""],
  ["5", "\"$$\"+CHR$(163)+\"##\""],
  ["5", "\"$$$\""],
  ["5", "\"*#\""],
  ["5", "\"$#\""],
  ["5", "\"#**\""],
  ["5", "\"#$$\""],
  ["5", "\"^^^^#\""],
  ["5", "\"##.##^^^^^\""],
  ["5", "\"##.##^^^\""],
  ["5", "\"##.##^^^^,\""],
  ["5", "\"##+-\""],
  ["5", "\"+##\"+CHR$(32)"],
  ["5", "\"#.##,\""],
  ["5", "\"#,#.#,#\""],
  ["5", "\"+\""],
  ["5", "\"#\"+CHR$(0)"],
];

// ---------------------------------------------------------------------------
// HEX$ and BIN$ (probes/p-strfmt.bas; the manual's PRINT BIN$(64,8) and PRINT HEX$(65534))
// ---------------------------------------------------------------------------

const RADIX_ROWS: [string, string][] = [
  ['HEX$(0)', '0'],
  ['HEX$(255)', 'FF'],
  ['HEX$(-1)', 'FFFF'],
  ['HEX$(65535)', 'FFFF'],
  ['HEX$(65534)', 'FFFE'],
  ['HEX$(-32768)', '8000'],
  ['HEX$(255,0)', 'FF'],
  ['HEX$(255,1)', 'FF'],
  ['HEX$(255,4)', '00FF'],
  ['HEX$(255,16)', '00000000000000FF'],
  ['HEX$(2.5)', '3'],
  ['HEX$(3.5)', '4'],
  ['HEX$(0,3)', '000'],
  ['BIN$(5,8)', '00000101'],
  ['BIN$(64,8)', '01000000'],
  ['BIN$(0)', '0'],
  ['BIN$(-1)', '1111111111111111'],
  ['BIN$(5)', '101'],
  ['BIN$(255,16)', '0000000011111111'],
  ['BIN$(5,0)', '101'],
  ['BIN$(5,2)', '101'],
  // from variables and expressions, in all the integer widths
  ['HEX$(n)', 'FFFE'],
  ['HEX$(n+1,w)', '0000FFFF'],
  ['HEX$(m,w)', '00001234'],
  ['HEX$(x)', '3'],
  ['HEX$(x,w-4)', '0003'],
  ['BIN$(b,w)', '00000101'],
  ['HEX$(LEN(a$+a$),2)', '08'],
];

describe('HEX$ and BIN$', () => {
  it('print the measured text', () => {
    const src = `DIM x AS REAL\nn=-2:m=&H1234:x=2.5:b=5:w=8:a$="abcd"\n${RADIX_ROWS.map(([e]) => `PRINT "[";${e};"]"`).join('\n')}`;
    expect(run(src)).toBe(RADIX_ROWS.map(([, want]) => `[${want}]\n`).join(''));
  });
  it('a width outside 0..16 is error 5', () => {
    for (const e of ['HEX$(255,17)', 'HEX$(255,-1)', 'BIN$(5,17)', 'BIN$(5,-1)', 'HEX$(5,w)']) {
      expect(errorOf(`w=-3\nx$=${e}`), e).toBe('Error 5');
    }
  });
  it('do not leak', () => {
    const body = 'r$=HEX$(n)+BIN$(w,12)+HEX$(n,w)\nx$=HEX$(LEN(r$))';
    expect(freeAfter('n=300:w=6', body, 1000)).toBe(freeAfter('n=300:w=6', body, 2));
  });
});

// ---------------------------------------------------------------------------
// The MID$ statement (probes/p-strfmt.bas, 6128: a position past the end is no error)
// ---------------------------------------------------------------------------

const MID_ROWS: [string, string][] = [
  ['MID$(a$,2,2)="XYZ"', 'HXYLO'],
  ['MID$(a$,2)="XYZ"', 'HXYZO'],
  ['MID$(a$,4,5)="12"', 'HEL12'],
  ['MID$(a$,4)="123456"', 'HEL12'],
  ['MID$(a$,5)="xy"', 'HELLx'],
  ['MID$(a$,6)="x"', 'HELLO'],
  ['MID$(a$,9)="x"', 'HELLO'],
  ['MID$(a$,2,0)="x"', 'HELLO'],
  ['MID$(a$,2)=""', 'HELLO'],
  ['MID$(a$,1,1)="xyz"', 'xELLO'],
  ['MID$(a$,2,255)="xy"', 'HxyLO'],
  ['MID$(a$,255)="x"', 'HELLO'],
  ['MID$(a$,2,2)=STR$(7)', 'H 7LO'],
  ['MID$(a$,2,2)=a$', 'HHHLO'],
  ['MID$(a$,p,q)=LEFT$(b$,3)', 'HyxLO'],
  ['MID$(a$,p+q)=b$+b$', 'HELLy'],
  ['MID$(a$,1,3)=MID$(a$,3)', 'LLOLO'],
];

describe('the MID$ statement', () => {
  it('replaces in place and never changes the length', () => {
    const src = `p=2:q=3:b$="yx":\n${MID_ROWS.map(([s]) => `a$="HELLO":${s}:PRINT "[";a$;"]";LEN(a$)`).join('\n')}`;
    expect(run(src)).toBe(MID_ROWS.map(([, want]) => `[${want}] 5 \n`).join(''));
  });
  it('an empty target stays empty, and a copy is not changed', () => {
    expect(run('e$="":MID$(e$,1)="x":PRINT "[";e$;"]"\na$="HELLO":b$=a$:MID$(a$,1,1)="J":PRINT a$;b$')).toBe('[]\nJELLOHELLO\n');
  });
  it('p outside 1..255 and n outside 0..255 are error 5', () => {
    for (const s of ['MID$(a$,0,1)="x"', 'MID$(a$,0)="x"', 'MID$(a$,-1)="x"', 'MID$(a$,256)="x"', 'MID$(a$,2,-1)="x"', 'MID$(a$,1,300)="x"', 'MID$(a$,2,256)="x"']) {
      expect(errorOf(`a$="HELLO"\n${s}`), s).toBe('Error 5');
    }
  });
  it('works on a local string and on a BYREF parameter', () => {
    expect(
      run('SUB Z(BYREF t$)\n  MID$(t$,2,1)="#"\nEND SUB\nSUB L()\n  DIM l$ = "abcd"\n  MID$(l$,3)="XY"\n  PRINT l$;\n  Z l$\n  PRINT l$\nEND SUB\na$="HELLO"\nZ a$\nPRINT a$\nL'),
    ).toBe('H#LLO\nabXYa#XY\n');
  });
  it('does not leak', () => {
    const body = 'r$=a$\nMID$(r$,2,2)=b$+"zz"\nMID$(r$,1)=b$\nMID$(r$,2)=a$\nMID$(r$,1,1)=STR$(i)\nMID$(r$,9)="q"';
    expect(freeAfter('a$="abcdef":b$="XY"', body, 1000)).toBe(freeAfter('a$="abcdef":b$="XY"', body, 2));
  });
});

// ---------------------------------------------------------------------------
// DEC$ (probes/p-dec.bas, 6128: BASIC 1.1 only; the manual's PRINT DEC$(10^7,"££########,.##"))
// ---------------------------------------------------------------------------


describe('DEC$', () => {
  it('formats as the interpreter does', () => {
    const src = DEC_ROWS.map(([n, f]) => `s$=DEC$(${n},${f}):PRINT "[";s$;"]"`).join('\n');
    const got = (run(src) as string).split('\n');
    DEC_ROWS.forEach(([n, f, want], i) => expect(got[i], `DEC$(${n}, ${f})`).toBe(`[${want}]`));
  });
  it('a format the interpreter refuses is error 5', () => {
    for (const [n, f] of DEC_ERRORS) expect(errorOf(`s$=DEC$(${n},${f})`), `DEC$(${n}, ${f})`).toBe('Error 5');
  });
  it('takes the value from any numeric type and the format from a variable or an expression', () => {
    expect(run('DIM l AS LONG, r AS REAL, u AS UINTEGER\ni=1234:u=65535:l=100000:r=2.5:f$="#,###.#"\nPRINT DEC$(i,f$);"|";DEC$(u,"######");"|";DEC$(l,"#,###,###");"|";DEC$(r*2,"##.##")+"|"+DEC$(i,LEFT$(f$,5))')).toBe(
      '1,234.0| 65535|  100,000| 5.00|1,234\n',
    );
  });
  it('does not leak', () => {
    const body = 'r$=DEC$(i*37/10,"##,###.##")+DEC$(-i,f$)+DEC$(i,"**$####")+DEC$(i,"##.##^^^^")+DEC$(1E22,"#")+DEC$(0,"#")';
    expect(freeAfter('f$="+#.##-"', body, 1000)).toBe(freeAfter('f$="+#.##-"', body, 2));
  });
});

// ---------------------------------------------------------------------------
// SELECT CASE on a string
// ---------------------------------------------------------------------------

const SEL = [
  'SUB T(s$)',
  '  SELECT CASE s$',
  '  CASE "apple"',
  '    PRINT "A";',
  '  CASE "b" TO "m"',
  '    PRINT "R";',
  '  CASE IS > "x"',
  '    PRINT "G";',
  '  CASE "p", "q"',
  '    PRINT "L";',
  '  CASE ""',
  '    PRINT "E";',
  '  CASE ELSE',
  '    PRINT "-";',
  '  END SELECT',
  'END SUB',
].join('\n');

describe('SELECT CASE on a string', () => {
  it('matches values, ranges, IS tests, lists, the empty string and ELSE', () => {
    const calls = ['apple', 'c', 'b', 'm', 'mm', 'y', 'xa', 'x', 'p', 'q', '', 'a', 'apples', 'B'];
    const want = 'A' + 'R' + 'R' + 'R' + '-' + 'G' + 'G' + '-' + 'L' + 'L' + 'E' + '-' + '-' + '-';
    expect(run(`${SEL}\n${calls.map((c) => `T "${c}"`).join('\n')}\nPRINT`)).toBe(`${want}\n`);
  });
  it('the subject can be a temp or an expression, and is evaluated once', () => {
    expect(
      run(
        [
          'a$="ab":b$="cd"',
          'SELECT CASE a$+b$',
          'CASE "abcd"',
          '  PRINT "temp";',
          'CASE ELSE',
          '  PRINT "no";',
          'END SELECT',
          'SELECT CASE LEFT$(a$+b$,3)',
          'CASE a$+"c"',
          '  PRINT " computed";',
          'END SELECT',
          'SELECT CASE INKEY$',
          'CASE ""',
          '  PRINT " none";',
          'CASE ELSE',
          '  PRINT " key";',
          'END SELECT',
          'SELECT CASE b$',
          'CASE "x"',
          '  PRINT "x"',
          'END SELECT',
          'PRINT',
        ].join('\n'),
      ),
    ).toBe('temp computed none\n');
  });
  it('a body may change the subject variable, and select again', () => {
    expect(
      run('s$="k1"\nSELECT CASE s$\nCASE "k1"\n  s$="k2"\n  SELECT CASE s$\n  CASE "k2"\n    PRINT "inner ";\n  END SELECT\n  PRINT s$\nEND SELECT'),
    ).toBe('inner k2\n');
  });
  it('works inside a procedure, with RETURN and EXIT', () => {
    expect(
      run(
        'FUNCTION F(s$) AS INTEGER\n  SELECT CASE s$\n  CASE "a"\n    RETURN 1\n  CASE "b"\n    EXIT FUNCTION\n  END SELECT\n  RETURN 9\nEND FUNCTION\nPRINT F("a");F("b");F("c")',
      ),
    ).toBe(' 1  0  9 \n');
  });
  describe('does not leak, on any way out', () => {
    const cases: Record<string, string> = {
      'a variable subject and a match': 'SELECT CASE a$\nCASE "abc"\n  x=1\nEND SELECT',
      'a temp subject and no match': 'SELECT CASE a$+b$\nCASE "zz"\n  x=1\nEND SELECT',
      'ELSE': 'SELECT CASE a$+"!"\nCASE "q"\n  x=1\nCASE ELSE\n  x=2\nEND SELECT',
      'computed CASE values and ranges': 'SELECT CASE b$\nCASE a$+"x" TO a$+"z"\n  x=1\nCASE IS < a$+b$\n  x=3\nCASE LEFT$(a$+b$,2), RIGHT$(a$+b$,2)\n  x=2\nEND SELECT',
      'EXIT FOR out of a body': 'FOR j=1 TO 3\n  SELECT CASE a$\n  CASE "abc"\n    EXIT FOR\n  END SELECT\nNEXT',
      'EXIT DO and CONTINUE': 'DO\n  SELECT CASE a$+b$\n  CASE "abcde"\n    EXIT DO\n  END SELECT\nLOOP',
      'GOTO out of a body': 'SELECT CASE a$\nCASE "abc"\n  GOTO lbl1\nEND SELECT\nx=5\nlbl1:\nx=x+1',
      'GOTO out of ELSE': 'SELECT CASE b$+a$\nCASE ELSE\n  GOTO lbl2\nEND SELECT\nx=5\nlbl2:\nx=x+1',
    };
    for (const [name, body] of Object.entries(cases)) {
      it(name, () => expect(freeAfter('a$="abc":b$="de":x=0', body, 1000), name).toBe(freeAfter('a$="abc":b$="de":x=0', body, 2)));
    }
    it('a procedure that leaves from inside the SELECT', () => {
      const setup = 'a$="abc"\nFUNCTION G(s$) AS INTEGER\n  SELECT CASE s$+"x"\n  CASE "abcx"\n    RETURN 1\n  CASE ELSE\n    EXIT FUNCTION\n  END SELECT\nEND FUNCTION\nx=0';
      expect(freeAfter(setup, 'x=x+G(a$)+G("z")', 1000)).toBe(freeAfter(setup, 'x=x+G(a$)+G("z")', 2));
    });
  });
});

// ---------------------------------------------------------------------------
// PRINT AT row, col (spec §11): LOCATE col + 1, row + 1
// ---------------------------------------------------------------------------

describe('PRINT AT', () => {
  it('is LOCATE with the row and column swapped and 0-based', () => {
    expect(run('PRINT AT 4,9;\nPRINT POS(#0);VPOS(#0)\nPRINT AT 0,0;\nPRINT POS(#0);VPOS(#0)\nPRINT AT 24,39;\na=POS(#0):b=VPOS(#0)\nPRINT AT 0,0;\nPRINT a;b')).toBe(' 10  5 \n 1  1 \n 40  25 \n');
  });
  it('takes variables and expressions, and prints its items there', () => {
    expect(run('r=2:c=7\nPRINT AT r+1,c*2;"x";:a=POS(#0):b=VPOS(#0)\nPRINT AT 0,0;\nPRINT a;b\nPRINT AT r,c;"ab";"cd"')).toBe('x 16  4 \nabcd\n');
  });
  it('a pair past the screen follows LOCATE: the row is clamped, the column wraps (measured, L3-LOCOFIX)', () => {
    for (const s of ['PRINT AT 25,0;"x"', 'PRINT AT 0,40;"x"']) {
      const r = exec(`${s}\nPRINT "after"`);
      expect(r.printer, s).toContain('x');
      expect(r.printer, s).toContain('after');
      expect(r.printer, s).not.toMatch(/Error \d+/);
    }
  });
  it('a value LOCATE refuses (0 after the +1, or past 255) is error 5', () => {
    for (const s of ['PRINT AT -1,0;"x"', 'PRINT AT 0,-1;"x"', 'PRINT AT 0,255;"x"', 'PRINT AT 255,0;"x"', 'PRINT AT 300,300;"x"', 'r=-1\nPRINT AT r,0;"x"', 'c=256\nPRINT AT 0,c;"x"']) {
      expect(errorOf(s), s).toBe('Error 5');
    }
  });
});
