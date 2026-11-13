/**
 * L2-STRLOWER on the simulator: string variables, literals, concatenation, comparisons, the
 * string built-ins, STR$, INKEY$ and PRINT of string expressions, compiled from BASIC source
 * through the whole pipeline. Each program's transcript is hand-computed Locomotive output;
 * the leak tests compare the heap's free list after 1000 iterations with that after 2.
 * VAL, UPPER$, LOWER$ and INSTR are outside the L2 subset gate, so those programs lift it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSource, normalise, runSource } from './compile-helper.js';
import { repoRoot } from './z80sim/run.js';
import type { AssembledRun, RunOptions } from './z80sim/run.js';

const loco = join(repoRoot, 'tests/loco');

function exec(source: string, subset = true, options: RunOptions = {}): AssembledRun {
  const r = runSource(source, options, subset);
  expect(r.built.problems).toEqual([]);
  expect(r.stopped).toBe('rst0');
  return r;
}
const run = (source: string, subset = true, options: RunOptions = {}): string => normalise(exec(source, subset, options).printer) as string;

const word = (r: AssembledRun, a: number): number => (r.memory[a] as number) | ((r.memory[a + 1] as number) << 8);

/** Bytes free on the heap: the sum of the free list's blocks (as src/codegen/str.test.ts). */
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

describe('tests/loco/str-basic.bas', () => {
  it('prints the blessed transcript', () => {
    const source = readFileSync(join(loco, 'str-basic.bas'), 'latin1');
    expect(run(source)).toBe(readFileSync(join(loco, 'str-basic.expected'), 'latin1'));
  });
});

describe('assignment, concatenation, comparison', () => {
  it('assigns, reassigns, copies and concatenates', () => {
    const out = run(
      'a$="foo":b$="bar"\nc$=a$+"-"+b$\nPRINT c$\nc$=c$+c$\nPRINT c$;LEN(c$)\nb$=a$\na$="changed"\nPRINT a$;" ";b$\na$=a$\nPRINT a$\na$=a$+a$+a$\nPRINT LEN(a$)\nd$=""\nd$=d$+d$\nPRINT LEN(d$);d$+"|"',
    );
    expect(out).toBe('foo-bar\nfoo-barfoo-bar 14 \nchanged foo\nchanged\n 21 \n 0 |\n');
  });
  it('an unset string variable is empty', () => {
    expect(run('PRINT LEN(z$);"[";z$;"]";z$+"x"')).toBe(' 0 []x\n');
  });
  it('compares to -1 or 0, with temps and variables on either side', () => {
    const out = run(
      'a$="abc":b$="abd"\nPRINT a$<b$;a$>b$;a$=b$;a$<>b$;a$<=a$;a$>=b$\nPRINT a$+"d"=b$+"";LEFT$(b$,2)=LEFT$(a$,2);"abc"=a$;a$="ab"\nn=(a$="abc")+(b$="x")+1\nPRINT n\nIF a$<b$ THEN PRINT "lt" ELSE PRINT "ge"\nIF a$+"d"=b$ THEN PRINT "eq" ELSE PRINT "ne"\nIF NOT (a$="x") THEN PRINT "not"\nIF a$="abc" AND b$<>"" THEN PRINT "and"\nWHILE LEN(a$)<5:a$=a$+"x":WEND\nPRINT a$',
    );
    expect(out).toBe('-1  0  0 -1 -1  0 \n 0 -1 -1  0 \n 0 \nlt\nne\nnot\nand\nabcxx\n');
  });
  it('INKEY$ with no key pressed, compared with "" and with a character', () => {
    expect(run('k$=INKEY$\nPRINT LEN(k$);k$="";INKEY$="";INKEY$="A";LEN(INKEY$)')).toBe(' 0 -1 -1  0  0 \n');
  });
  it('INKEY$ with a key waiting', () => {
    expect(run('k$=INKEY$\nPRINT LEN(k$);k$="A";k$', true, { keys: 'A' })).toBe(' 1 -1 A\n');
  });
});

describe('the string built-ins', () => {
  it('LEN, ASC, LEFT$, RIGHT$, MID$ (2 and 3 arguments) at the edges', () => {
    const out = run(
      'a$="Hello World":n=5:e$=""\nPRINT LEN(a$);LEN(e$);LEN(a$+a$);ASC(a$);ASC("z")\nPRINT LEFT$(a$,n);"|";RIGHT$(a$,n);"|";MID$(a$,7);"|";MID$(a$,7,3);"|";MID$(a$,n+2,n)\nPRINT LEFT$(a$,0);"|";LEFT$(a$,50);"|";RIGHT$(a$,0);"|";RIGHT$(a$,50);"|";MID$(a$,20);"|";MID$(a$,11);"|";MID$(a$,11,9);"|";MID$(e$,1,1);"|";LEFT$(e$,3)\nPRINT LEFT$(a$+"!",LEN(a$)-6);RIGHT$(a$+"?",2);MID$(a$+a$,11,3)',
    );
    expect(out).toBe(
      ' 11  0  22  72  122 \nHello|World|World|Wor|World\n|Hello World||Hello World||d|d||\nHellod?dHe\n',
    );
  });
  it('CHR$, SPACE$, STRING$ (a code and a string) and arguments from variables', () => {
    const out = run(
      'n=3:c=66:s$="xyz"\nPRINT CHR$(72)+CHR$(105);CHR$(c+1);"[";SPACE$(n);"][";SPACE$(0);"]"\nPRINT STRING$(n,"*");STRING$(2,c);STRING$(n,s$);STRING$(0,"q");STRING$(2,LEFT$(s$,1)+"Q")\nPRINT LEN(CHR$(0));LEN(SPACE$(200));LEN(STRING$(n*10,"-"))',
    );
    expect(out).toBe('HiC[   ][]\n***BBxxxxx\n 1  200  30 \n');
  });
  it('STR$ of each integer type is the Locomotive text', () => {
    const out = run(
      'DIM u8 AS UBYTE = 200\nDIM i8 AS BYTE = -100\nDIM u16 AS UINTEGER = 60000\nDIM i16 AS INTEGER = -12345\nDIM u32 AS ULONG = 4000000000\nDIM i32 AS LONG = -100000\nPRINT STR$(u8);"|";STR$(i8);"|";STR$(u16);"|";STR$(i16);"|";STR$(u32)\nPRINT STR$(i32)\nPRINT STR$(0);"|";STR$(7);"|";STR$(u16+1);"|";LEN(STR$(i32*2));"|";STR$(3)+STR$(-3)',
    );
    expect(out).toBe(' 200|-100| 60000|-12345| 4000000000\n-100000\n 0| 7| 60001| 7 | 3-3\n');
  });
  it('UPPER$, LOWER$ and INSTR', () => {
    const out = run(
      'a$="Hello World"\nPRINT UPPER$(a$);"|";LOWER$(a$);"|";UPPER$("a"+"b1");"|";LOWER$("")\nPRINT INSTR(a$,"o");INSTR(a$,"World");INSTR(a$,"x");INSTR(a$,"");INSTR(6,a$,"o");INSTR(9,a$,"o");INSTR(1,"abcabc","ca");INSTR(a$+a$,"dH")',
    );
    expect(out).toBe('HELLO WORLD|hello world|AB1|\n 5  7  0  1  8  0  3  11 \n');
  });
  it('INSTR with an empty needle finds it only while start <= LEN(a$) (measured, loco-measured.md 2026-11-08)', () => {
    const out = run('PRINT INSTR("abc","");INSTR(2,"abc","");INSTR(4,"abc","");INSTR(5,"abc","");INSTR("","")');
    expect(out).toBe(' 1  2  0  0  0 \n');
  });
  it('VAL lowers to the str-to-REAL cast (REAL code generation is a later task)', () => {
    const b = buildSource('a$="12"\nn=VAL(a$)+VAL("3")', {}, false);
    expect(b.problems).toEqual([]);
    expect(b.irText).toContain('cast.f<-str');
    expect(b.diagnostics.every((d) => d.startsWith('E002'))).toBe(true);
  });
  it('an argument that is a variable still reads it before a later argument runs', () => {
    expect(run('a$="abcdef":b$="XY"\nn=2\nPRINT MID$(a$,n,LEN(b$+b$));LEFT$(a$,LEN(b$));INSTR(n,a$,LEFT$(a$+b$,3))')).toBe('bcde' + 'ab' + ' 0 \n');
  });
});

describe('ASC and STRING$ of the empty string', () => {
  it('are Improper argument (error 5), as in Locomotive', () => {
    for (const src of ['e$=""\nPRINT ASC(e$)', 'PRINT ASC("")', 'e$=""\nPRINT ASC(e$+e$)', 'PRINT STRING$(3, "")', 'e$=""\nx$=STRING$(2, e$)']) {
      const r = exec(`${src}\nPRINT "never"`, true, {});
      expect(r.printer, src).toContain('Error 5');
      expect(r.printer, src).not.toContain('never');
    }
  });
});

describe('DIM of a STRING with an initial value', () => {
  it('a global gets its text at start-up, a local on each call', () => {
    expect(
      run('DIM a$ = "hello", b$ = ""\nCONST k$ = "K"\nDIM c$ = k$\nPRINT a$; LEN(b$); c$\na$ = a$ + "!"\nPRINT a$\nSUB S()\n  DIM t$ = "t"\n  PRINT t$;\n  t$ = t$ + "u"\nEND SUB\nS\nS\nPRINT'),
    ).toBe('hello 0 K\nhello!\ntt\n');
  });
});

describe('PRINT of string expressions', () => {
  it('mixes strings with numbers, separators and zones', () => {
    const out = run('a$="ab":b$="cd"\nPRINT a$;1;b$;LEN(a$+b$);"|"\nPRINT a$,b$\nPRINT a$+b$,LEN(a$);\nPRINT TAB(20);b$;SPC(2);a$\nPRINT a$;b$;');
    const pad = (t: string, n: number): string => t + ' '.repeat(n - t.length);
    expect(out).toBe(`ab 1 cd 4 |\n${pad('ab', 13)}cd\n${pad('abcd', 13)} 2    cd  ab\nabcd\n`);
  });
});

describe('ownership: no leaks over 1000 iterations', () => {
  const scenarios: Record<string, string> = {
    'assignment and reassignment': 'r$=a$\nr$=b$\nr$=a$\nr$=r$',
    'assignment of a constant and of an empty string': 'r$="a constant"\nr$=""\nr$=a$',
    'concatenation chains': 'r$=a$+"x"+b$+a$+"-"+b$\nr$=r$+r$\nr$=""',
    'a string compared with a temp on either side': 'IF a$+b$="abcde" THEN x=x+1\nIF "x"+a$>a$ THEN x=x+1\nIF a$<b$ THEN x=x+1\nIF a$+a$<>a$+b$ THEN x=x+1\nx=(a$="abc")',
    'LEN, ASC and INKEY$': 'x=LEN(a$+b$)+ASC(a$+"z")+LEN(a$)+ASC(b$)\nk$=INKEY$\nIF INKEY$="" THEN x=1',
    'LEFT$, RIGHT$ and MID$ of temps and variables': 'r$=LEFT$(a$+b$,3)+RIGHT$(a$,2)+MID$(a$,2)+MID$(b$+a$,2,2)+MID$(a$,9)+LEFT$("",2)',
    'CHR$, SPACE$ and STRING$': 'r$=CHR$(65)+SPACE$(3)+STRING$(2,"q")+STRING$(2,66)+STRING$(2,a$+b$)+SPACE$(0)',
    'STR$': 'k=i MOD 3+1\nr$=STR$(k)+STR$(-3)+STR$(k*2)',
    'PRINT of temps and variables': 'PRINT a$+b$;a$;LEN(a$+b$);INKEY$;LEFT$(a$,1)',
    'nested built-ins': 'r$=MID$(LEFT$(a$+b$+a$,6),2,3)+RIGHT$(STR$(i MOD 7)+a$,4)',
  };
  const lateAdded: Record<string, string> = {
    'UPPER$, LOWER$ and INSTR': 'r$=UPPER$(a$+b$)+LOWER$("XY")+UPPER$(a$)\nx=INSTR(a$+b$,"d")+INSTR(2,a$,b$)+INSTR(a$,"b")+INSTR(1,a$+"q",b$+"")',
  };
  const freeAfter = (body: string, n: number, subset: boolean): number => {
    const r = exec(`a$="abc":b$="de":x=0\nFOR i=1 TO ${n}\n${body}\nNEXT\nPRINT "done"`, subset, { maxTStates: 2_000_000_000 });
    return heapFree(r);
  };
  for (const [name, body] of Object.entries(scenarios)) {
    it(name, () => expect(freeAfter(body, 1000, true)).toBe(freeAfter(body, 2, true)));
  }
  for (const [name, body] of Object.entries(lateAdded)) {
    it(name, () => expect(freeAfter(body, 1000, true)).toBe(freeAfter(body, 2, true)));
  }
  it('the check itself detects a leak (a result stored nowhere is not freed by this program)', () => {
    // r$ keeps growing by one character per iteration: the free space shrinks with n.
    expect(freeAfter('r$=r$+"x"', 100, true)).toBeLessThan(freeAfter('r$=r$+"x"', 2, true));
  });
});
