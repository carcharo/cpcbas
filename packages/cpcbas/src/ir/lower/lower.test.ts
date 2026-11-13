/**
 * L2-LOWER: IR snapshots (`printIr`, the `--stage ir` dump) for one small program per
 * statement kind, each passing the verifier; and the constructs that belong to later tasks
 * report E002.
 */
import { describe, expect, it } from 'vitest';
import { lowerSource } from '../../../test/compile-helper.js';

const KINDS: Record<string, string> = {
  hello: '10 MODE 1\n20 PRINT "Hello CPC";1\n30 END',
  let: 'a%=3\nb%=a%*2+1\nPRINT b%',
  'if-else': 'a=1\nIF a=1 THEN PRINT "y" ELSE PRINT "n"',
  'if-block': 'a=1\nIF a=1 THEN\nPRINT 1\nELSEIF a=2 THEN\nPRINT 2\nELSE\nPRINT 3\nEND IF',
  'for-const-step': 'FOR i=1 TO 10 STEP 2\nPRINT i;\nNEXT',
  'for-var-step': 's=-1\nFOR i=9 TO 1 STEP s\nNEXT',
  'for-var-limit': 'n=5\nFOR i=1 TO n\nNEXT\nDIM b AS UBYTE\nFOR b=0 TO 255 STEP 1\nNEXT',
  while: 'n=3\nWHILE n>0\nn=n-1\nWEND',
  'do-loop': 'n=0\nDO\nn=n+1\nIF n>2 THEN EXIT DO\nLOOP UNTIL n>9',
  select: 'n=2\nSELECT CASE n\nCASE 1 TO 2\nPRINT "lo"\nCASE ELSE\nPRINT "hi"\nEND SELECT',
  goto: '10 GOTO 30\n20 PRINT "skipped"\n30 PRINT "here"',
  gosub: '10 GOSUB 100\n20 END\n100 PRINT "sub":RETURN',
  'on-goto': '10 n=2\n20 ON n GOTO 100,200\n30 END\n100 END\n200 END',
  'on-gosub': '10 n=1\n20 ON n GOSUB 100\n30 END\n100 RETURN',
  end: 'PRINT 1\nEND\nPRINT 2',
  poke: 'POKE &C000,7\nPOKE UINTEGER,&C002,1000',
  peek: 'PRINT PEEK(&C000); PEEK(UINTEGER, &C002)',
  print: 'a=5\nPRINT "x";a,a+1;\nPRINT TAB(5);SPC(a);"y"',
  screen: 'MODE 1:PEN 2:PAPER 0:BORDER 3:CLS\nLOCATE 5,6\nc=4\nBORDER c,5',
  'pos-vpos': 'PRINT POS(#0);VPOS(#0)',
  call: 'CALL &BD19\nCALL &C7D0,1,@x',
  asm: 'ASM\n nop\nEND ASM',
  dim: 'DIM b AS UBYTE = 7\nDIM p AS UINTEGER AT &C000\nb=b+1',
  functions: 'a=-3\nPRINT ABS(a);SGN(a);MIN(a,2);MAX(a,2);CINT(a);CAST(UBYTE,a)',
  shifts: 'a=1\nPRINT a<<3;a>>1',
  'string-assign': 'a$="Hello"\nb$=a$+" "+a$\na$=b$\nPRINT a$;b$',
  'string-compare': 'a$="x"\nIF a$<>"y" AND a$>="a" THEN PRINT "ne"\nIF INKEY$="" THEN PRINT "none"',
  'string-builtins': 'a$="Hello":n=2\nPRINT LEN(a$);ASC(a$);LEFT$(a$,n);RIGHT$(a$+"!",n);MID$(a$,2);MID$(a$,n,LEN(a$)-1)\nPRINT CHR$(65);SPACE$(n);STRING$(n,"*");STRING$(3,n+60);STR$(n);STR$(-1)',
};

describe('IR snapshots, one program per statement kind', () => {
  it.each(Object.keys(KINDS))('%s', (name) => {
    const r = lowerSource(KINDS[name] as string);
    expect(r.diagnostics.filter((d) => d.startsWith('E'))).toEqual([]);
    expect(r.problems).toEqual([]);
    expect(r.irText).toMatchSnapshot();
  });
});

describe('internal asm quads', () => {
  it('BORDER, LOCATE and CALL mark their asm internal; an ASM block does not', () => {
    const asmQuads = (src: string): Array<boolean> =>
      lowerSource(src)
        .ir.main.filter((q) => q.op === 'asm')
        .map((q) => q.op === 'asm' && q.internal === true);
    expect(asmQuads('c=4\nBORDER c\nLOCATE c,1\nCALL &BD19\nCALL c,1')).toEqual([true, true, true, true, true, true]);
    expect(asmQuads('ASM\n nop\nEND ASM')).toEqual([false]);
  });
});

describe('features of later tasks report E002', () => {
  const e002 = (src: string): string[] => lowerSource(src).diagnostics.filter((d) => d.startsWith('E'));
  it('procedures, DEF FN, array parameters and local arrays are lowered (L2-PROC, L3-ARR-PROC)', () => {
    expect(e002('SUB s()\nEND SUB\ns')).toEqual([]);
    expect(e002('DEF FNa(x)=x*2\nPRINT FNa(1)')).toEqual([]);
    expect(e002('SUB s(a() AS INTEGER)\nEND SUB')).toEqual([]);
  });
  it('a REAL item in DATA and READ into a REAL variable are lowered (L2-CG-REAL)', () => {
    expect(e002('DATA 1.5\nREAD x!')).toEqual([]);
  });
  it('string features outside L3-STR: string arrays (SELECT CASE on a string is lowered)', () => {
    expect(e002('a$="x"\nSELECT CASE a$\nCASE "x"\nPRINT 1\nEND SELECT')).toEqual([]);
    expect(e002('DIM a$ = "x"')).toEqual([]);
    expect(e002('DIM a$(3)\na$(1)="q"')).toEqual([]); // string arrays: L3-ARR-LOWER
  });
  it('@ of a string and a CALL string argument are lowered since L3-ADDR (REAL values in PRINT since L2-CG-REAL)', () => {
    expect(e002('PRINT 1.5')).toEqual([]);
    expect(e002('a$="q"\nCALL &C000,@a$')).toEqual([]);
    expect(e002('a$="q"\nCALL &C000,a$+"x"\nPRINT @a$')).toEqual([]);
  });
});
