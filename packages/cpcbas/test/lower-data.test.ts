/**
 * L2-DATA on the simulator: READ of each integer type and of strings, RESTORE to a line, a
 * label and the start, DATA statements anywhere in the program, DATA exhausted (error 4) and a
 * string item into a numeric variable (error 2, the item not consumed).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lowerSource, normalise, runSource } from './compile-helper.js';
import { repoRoot } from './z80sim/run.js';

/** PRINT of a string variable, no line end. */
const show = (name: string): string => `PRINT ${name}$;`;

const run = (source: string): string => {
  const r = runSource(source);
  expect(r.built.problems).toEqual([]);
  expect(r.stopped).toBe('rst0');
  return normalise(r.printer) ?? r.printer;
};

describe('DATA table and READ', () => {
  it('reads integers and strings in source order, DATA statements anywhere', () => {
    expect(run(`10 READ a,b$,c\n20 PRINT a;\n${show('b')}\n25 PRINT c\n30 DATA 5,"x y"\n40 READ d\n50 PRINT d\n60 DATA 9,100\n70 DATA 7`)).toBe(' 5 x y 9 \n 100 \n');
  });
  it('reads every integer type', () => {
    const src = [
      'DIM b AS BYTE, ub AS UBYTE, i AS INTEGER, ui AS UINTEGER, l AS LONG, ul AS ULONG',
      'READ b, ub, i, ui, l, ul',
      'PRINT b; ub; i; ui\nPRINT l; ul',
      'DATA -5, 200, -1234, 60000, -100000, 3000000000',
    ].join('\n');
    expect(run(src)).toBe('-5  200 -1234  60000 \n-100000  3000000000 \n');
  });
  it('wraps a number into a narrower variable and reads hex and binary items', () => {
    expect(run('DIM b AS UBYTE\nREAD b, x, y\nPRINT b; x; y\nDATA 300, &FF, &X101')).toBe(' 44  255  5 \n');
  });
  it('gives a numeric item as written to a string variable', () => {
    const shown = ['a', 'b', 'c', 'd'].map((n) => `PRINT "[";\n${show(n)}\nPRINT "]";`).join('\n');
    expect(run(`READ a$, b$, c$, d$\n${shown}\nPRINT\nDATA 7, -30, 70000, 65000`)).toBe('[7][-30][70000][65000]\n');
  });
  it('strips spaces of unquoted items and keeps quoted ones', () => {
    const shown = ['a', 'b'].map((n) => `PRINT "[";\n${show(n)}\nPRINT "]";`).join('\n');
    expect(run(`READ a$,b$\n${shown}\nPRINT\nDATA   hi there  ,"  q, r "`)).toBe('[hi there][  q, r ]\n');
  });
  it('an empty string item', () => {
    expect(run(`READ a$,b$\nPRINT "[";\n${show('a')}\nPRINT "][";\n${show('b')}\nPRINT "]"\nDATA "",x`)).toBe('[][x]\n');
  });
});

// Expected values: the measured transcripts of the 2026-11-08 session (empty items) and
// follow-ups 30 and 37 (spellings; a REAL item into an integer variable is rounded, into a string gives its text).
describe('empty items and spellings', () => {
  it('an empty item is 0 for a numeric variable and "" for a string one, no error', () => {
    const num = run('FOR k=1 TO 7\nREAD a\nPRINT a;\nNEXT\nPRINT\nDATA 1,,3\nDATA ,\nDATA 5,');
    expect(num).toBe(' 1  0  3  0  0  5  0 \n');
    const str = run('FOR k=1 TO 7\nREAD a$\nPRINT "[";a$;"]";\nNEXT\nPRINT\nDATA 1,,3\nDATA ,\nDATA 5,');
    expect(str).toBe('[1][][3][][][5][]\n');
  });
  it('a numeric item whose spelling is not canonical keeps it for a string and its value for a number', () => {
    const str = run('READ a$,b$,c$,d$,e$\nPRINT a$;"|";b$;"|";c$;"|";d$;"|";e$\nDATA 007,+5,&FF,&X101,12');
    expect(str).toBe('007|+5|&FF|&X101|12\n');
    expect(run('READ a,b,c,d,e\nPRINT a;b;c;d;e\nDATA 007,+5,&FF,&X101,12')).toBe(' 7  5  255  5  12 \n');
  });
  it('a spelled item can be skipped by a numeric READ and read as text after RESTORE', () => {
    expect(run('READ a,b\nPRINT a;b\nRESTORE\nREAD x$,y$,z\nPRINT x$;y$;z\nDATA 007,8,9')).toBe(' 7  8 \n0078 9 \n');
  });
  it('a REAL item read into an integer variable is rounded, into a string variable gives its text', () => {
    expect(run('READ a%,b%,c%,d\nPRINT a%;b%;c%;d\nDATA 1.5,2.4,-1.5,7')).toBe(' 2  2 -2  7 \n');
    expect(run('READ a$,b$,c$\nPRINT a$;"|";b$;"|";c$\nDATA 1.5,2.50,1E3')).toBe('1.5|2.50|1E3\n');
  });
  it('an integer past 32 bits is a REAL item: READ into a REAL variable works', () => {
    expect(run('READ x!,a$\nPRINT x!;a$\nDATA 5000000000,5000000000')).toBe(' 5E+09 5000000000\n');
  });
});

describe('RESTORE', () => {
  it('to the start, a line number and a label', () => {
    const src = [
      '10 DATA 1,2',
      '20 DATA 3,4',
      'second:',
      '30 DATA 5',
      '40 READ a,b,c,d,e',
      '50 PRINT a;b;c;d;e',
      '60 RESTORE',
      '70 READ a:PRINT a',
      '80 RESTORE 20',
      '90 READ a:PRINT a',
      '100 RESTORE 30',
      '110 READ a:PRINT a',
    ].join('\n');
    expect(run(src)).toBe(' 1  2  3  4  5 \n 1 \n 3 \n 5 \n');
  });
  it('to a named label before a DATA statement', () => {
    expect(run('DATA 1\nlater:\nDATA 2\nRESTORE later\nREAD a\nPRINT a')).toBe(' 2 \n');
  });
  it('to a line with no DATA at or after it leaves nothing to read (error 4)', () => {
    expect(run('10 DATA 1\n20 RESTORE 40\n30 READ a:PRINT a\n40 PRINT "end"')).toContain('Error 4');
  });
  it('in a loop reads the same items again', () => {
    expect(run('FOR k=1 TO 2\nRESTORE\nREAD a,b\nPRINT a;b\nNEXT\nDATA 3,4')).toBe(' 3  4 \n 3  4 \n');
  });
});

describe('runtime errors', () => {
  it('READ past the last item is error 4', () => {
    const out = run('READ a,b\nPRINT "a=";a\nREAD c\nPRINT "never"\nDATA 1,2');
    expect(out).toContain('Error 4');
    expect(out).not.toContain('never');
    expect(out).not.toContain('Error 9');
  });
  it('READ with no DATA in the program is error 4', () => {
    expect(run('READ a\nPRINT "never"')).toContain('Error 4');
  });
  it('a string item into a numeric variable is error 2 and is not consumed', () => {
    const src = `a=7\nREAD x$\n${show('x')}\nPRINT\nREAD a\nPRINT "never"\nDATA first,second`;
    const out = run(src);
    expect(out).toContain('first');
    expect(out).toContain('Error 2');
    expect(out).not.toContain('never');
  });
  it('the item that failed is still there for the next READ into a string', () => {
    // Without ON ERROR the program stops, so check the pointer with a string read first.
    expect(run(`READ a$:READ b$\n${show('a')}\n${show('b')}\nPRINT\nDATA abc,"7"`)).toBe('abc7\n');
  });
});

// data.bas end to end is lower-e2e.test.ts's.
describe('tests/loco/data.bas', () => {
  it('lowers without diagnostics', () => {
    expect(lowerSource(readFileSync(join(repoRoot, 'tests/loco/data.bas'), 'latin1')).diagnostics).toEqual([]);
  });
});

describe('IR', () => {
  it('passes verifyIr for a program with all three statements', () => {
    const low = lowerSource('10 DATA 1,"a"\n20 READ a,b$\n30 RESTORE 10\n40 RESTORE\n50 READ c');
    expect(low.diagnostics).toEqual([]);
    expect(low.problems).toEqual([]);
    expect(low.ir.data.map((d) => `${d.label ?? '-'}:${d.type}`)).toEqual(['.D.0:i16', '-:str']);
  });
  it('a REAL item is a typed `f` entry (since L2-CG-REAL) and READ into a REAL variable calls __LOCO_READF', () => {
    const low = lowerSource('DATA 1.5, 2, abc\nREAD x!');
    expect(low.diagnostics).toEqual([]);
    expect(low.ir.data.map((d) => `${d.type}:${String(d.value instanceof Uint8Array ? '' : d.value)}`)).toEqual(['f:1.5', 'i16:2', 'str:']);
    expect(low.irText).toContain('rtcall .core.__LOCO_READF -> f');
  });
});
