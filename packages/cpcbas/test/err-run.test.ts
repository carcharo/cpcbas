/**
 * L4-ERR on the simulator: ON ERROR GOTO, ERR, ERL, ERROR, the three RESUME forms, the main-program RETURN check, the
 * non-fatal REAL errors and the fatal text "Error n". Expected values are worked out from the Locomotive manual and from
 * the transcripts measured on the interpreter, never taken from cpcbas's output.
 * The programs of tests/loco/err-*.bas are compared with the interpreter's transcripts by loco-conformance.test.ts.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile } from '../src/index.js';
import { realFromNumber } from '../src/core/locoreal.js';
import { buildSource, lowerSource, normalise, runSource } from './compile-helper.js';
import { libTree } from './runtime-tree.js';
import { assembleText, repoRoot, runImage } from './z80sim/run.js';
import type { Cpc } from './z80sim/cpc.js';

const run = (source: string): string => {
  const r = runSource(source);
  expect(r.built.problems).toEqual([]);
  expect(r.built.diagnostics.filter((d) => d.startsWith('E'))).toEqual([]);
  expect(r.stopped).toBe('rst0');
  return normalise(r.printer) as string;
};
/** A run that ends in a fatal error: what the printer got (no END marker: the reset comes first). */
const fatal = (source: string): string => {
  const r = runSource(source);
  expect(r.built.diagnostics.filter((d) => d.startsWith('E'))).toEqual([]);
  expect(r.stopped).toBe('rst0');
  return r.printer;
};

describe('ON ERROR GOTO and the three RESUME forms', () => {
  it('RESUME retries the statement, RESUME NEXT goes on after it, RESUME n goes to a line', () => {
    const src = [
      '10 ON ERROR GOTO 900',
      '20 PRINT "a":a=ASC(""):PRINT "b"',
      '30 a$="":x=ASC(a$):PRINT "x=";x',
      '40 z=ASC(""):PRINT "skipped"',
      '50 PRINT "c"',
      '60 PRINT "end"',
      '70 END',
      '900 PRINT "ERR";ERR;"ERL";ERL',
      '910 IF ERL=30 THEN a$="A":RESUME',
      '920 IF ERL=20 THEN RESUME NEXT',
      '930 RESUME 50',
    ].join('\n');
    // line 20: error 5, RESUME NEXT runs PRINT "b"; line 30: the handler fixes a$ and retries (65); line 40: RESUME 50
    expect(run(src)).toBe('a\nERR 5 ERL 20 \nb\nERR 5 ERL 30 \nx= 65 \nERR 5 ERL 40 \nc\nend\n');
  });

  it('ERR is 0 before an error and after RESUME, ERL keeps the last line (measured on the interpreter)', () => {
    const src = ['10 PRINT ERR;ERL', '20 ON ERROR GOTO 900', '30 x=ASC("")', '40 PRINT ERR;ERL', '50 END', '900 PRINT ERR;ERL:RESUME NEXT'].join('\n');
    expect(run(src)).toBe(' 0  0 \n 5  30 \n 0  30 \n');
  });

  it('RESUME NEXT inside a single-line IF continues with the next statement of that list', () => {
    const src = ['10 ON ERROR GOTO 900', '20 IF 1=1 THEN a=ASC(""):PRINT "t1":PRINT "t2"', '30 PRINT "d"', '40 END', '900 RESUME NEXT'].join('\n');
    expect(run(src)).toBe('t1\nt2\nd\n');
  });

  it('RESUME NEXT after an error in the header of a compound statement continues after the whole statement (documented dialect change)', () => {
    // the interpreter continues inside the loop body and fails with Unexpected NEXT (loco-measured.md); cpcbas does what docs/ir.md says
    const src = ['10 ON ERROR GOTO 900', '20 FOR i=1 TO ASC(""):PRINT "body";i:NEXT:PRINT "after for"', '30 WHILE ASC("")=0:PRINT "w":WEND:PRINT "after wend"', '40 END', '900 RESUME NEXT'].join('\n');
    expect(run(src)).toBe('after for\nafter wend\n');
  });

  it('an error in the test of a WHILE, DO ... LOOP or FOR on a later pass belongs to the loop, not to the last statement of its body (follow-up 81)', () => {
    const handler = ['900 PRINT "ERL";ERL', '910 RESUME 60'];
    const prog = (loop: string[]): string => ['10 ON ERROR GOTO 900', '20 i=0', ...loop, '60 PRINT "end"', '70 END', ...handler].join('\n');
    // the third test fails (ASC of the empty string) after the body on line 40 ran; the interpreter's WHILE line is 30
    expect(run(prog(['30 WHILE ASC(MID$("ab",i+1))>0', '40 i=i+1', '50 WEND']))).toBe('ERL 30 \nend\n');
    expect(run(prog(['30 WHILE ASC(MID$("ab",i+1))>0:i=i+1:WEND']))).toBe('ERL 30 \nend\n');
    // DO WHILE tests on the DO line; a LOOP UNTIL tests on the LOOP line (the interpreter has no DO)
    expect(run(prog(['30 DO WHILE ASC(MID$("ab",i+1))>0', '40 i=i+1', '50 LOOP']))).toBe('ERL 30 \nend\n');
    expect(run(prog(['30 DO', '40 i=i+1', '50 LOOP UNTIL ASC(MID$("ab",i+1))=0']))).toBe('ERL 50 \nend\n');
    // CONTINUE goes to the same test
    expect(run(prog(['30 WHILE ASC(MID$("ab",i+1))>0', '40 i=i+1', '45 IF i>0 THEN CONTINUE WHILE', '46 PRINT "no"', '50 WEND']))).toBe('ERL 30 \nend\n');
  });

  it('a FOR marks again at its NEXT; a program without ON ERROR marks nothing', () => {
    const marks = (src: string): number => (buildSource(src).asm.match(/call \.core\.__LOCO_MARK/g) ?? []).length;
    const body = ['10 ON ERROR GOTO 900', '20 FOR i=1 TO 3', '30 PRINT i', '40 NEXT i', '50 END', '900 RESUME NEXT'];
    expect(marks(body.join('\n'))).toBe(6); // ON ERROR, FOR, PRINT, END, RESUME (NEXT is part of the FOR statement), and the NEXT's own test
    expect(marks(body.filter((l) => !l.startsWith('10 ')).join('\n'))).toBe(0);
    expect(marks(['10 ON ERROR GOTO 900', '20 END', '900 RESUME NEXT'].join('\n'))).toBe(3);
  });

  it('a handler that is a GOTO keeps the GOSUB that was pending; a RETURN in the handler returns', () => {
    const src = ['10 ON ERROR GOTO 900', '20 GOSUB 100', '30 PRINT "back"', '40 END', '100 PRINT "sub":x=ASC(""):PRINT "not"', '110 RETURN', '900 PRINT "h":RETURN'].join('\n');
    expect(run(src)).toBe('sub\nh\nback\n');
  });

  it('RESUME NEXT inside a GOSUB goes on in the subroutine and the RETURN still works', () => {
    const src = ['10 ON ERROR GOTO 900', '20 GOSUB 100', '30 PRINT "back"', '40 END', '100 PRINT "sub":x=ASC(""):PRINT "sub2"', '110 RETURN', '900 RESUME NEXT'].join('\n');
    expect(run(src)).toBe('sub\nsub2\nback\n');
  });

  it('RESUME outside error processing is error 20, trapped or fatal', () => {
    expect(run(['10 ON ERROR GOTO 900', '20 RESUME', '30 PRINT "after"', '40 END', '900 PRINT "ERR";ERR:RESUME NEXT'].join('\n'))).toBe('ERR 20 \nafter\n');
    expect(fatal('10 RESUME NEXT')).toContain('Error 20');
    expect(fatal('10 ON ERROR GOTO 0\n20 RESUME')).toContain('Error 20');
  });

  it('ERROR n raises n: 1 to 255 as given (also the numbers Locomotive does not assign), anything else is error 5', () => {
    const src = ['10 ON ERROR GOTO 900', '20 ERROR 33', '30 ERROR 255', '40 ERROR 17', '50 ERROR 0', '60 ERROR 256', '70 ERROR -1', '80 END', '900 PRINT ERR;ERL:RESUME NEXT'].join('\n');
    expect(run(src)).toBe(' 33  20 \n 255  30 \n 17  40 \n 5  50 \n 5  60 \n 5  70 \n');
  });

  it('an error inside the handler is fatal', () => {
    // the interpreter reports it as fatal too ("Improper argument in 920"); cpcbas prints "Error 5"
    const src = ['10 ON ERROR GOTO 920', '20 y=ASC("")', '30 PRINT "not reached"', '40 END', '920 PRINT "h920":q=ASC("")', '930 PRINT "unreached"'].join('\n');
    expect(fatal(src)).toBe('h920\n\nError 5');
  });

  it('ON ERROR GOTO 0 inside the handler makes the pending error fatal at once', () => {
    const src = ['10 ON ERROR GOTO 910', '20 x=ASC("")', '30 PRINT "after20"', '40 END', '910 PRINT "h910":ON ERROR GOTO 0:RESUME NEXT'].join('\n');
    expect(fatal(src)).toBe('h910\n\nError 5');
  });

  it('ON ERROR GOTO 0 outside a handler turns the trap off; ON ERROR GOTO n inside a handler replaces it', () => {
    expect(fatal(['10 ON ERROR GOTO 900', '20 ON ERROR GOTO 0', '30 x=ASC("")', '40 END', '900 PRINT "no"'].join('\n'))).toBe('\nError 5');
    const src = ['10 ON ERROR GOTO 900', '20 x=ASC("")', '30 y=ASC("")', '40 END', '900 PRINT "first":ON ERROR GOTO 950:RESUME NEXT', '950 PRINT "second":RESUME NEXT'].join('\n');
    expect(run(src)).toBe('first\nsecond\n');
  });

  it('an untrapped error before any statement was marked, and a program without ON ERROR, print Error n', () => {
    expect(fatal('10 x=ASC("")')).toContain('Error 5');
    expect(fatal('10 ERROR 41')).toContain('Error 41');
  });

  it('ERR and ERL are the constant 0 in a program without ON ERROR GOTO n', () => {
    const built = buildSource('PRINT ERR; ERL\nON ERROR GOTO 0');
    expect(built.diagnostics.filter((d) => d.startsWith('E'))).toEqual([]);
    expect(built.asm).not.toContain('__LOCO_MARK');
    expect(built.asm).not.toContain('__LOCO_ERR\n');
    expect(run('PRINT ERR; ERL\nON ERROR GOTO 0')).toBe(' 0  0 \n');
  });

  it('ERL is 0 for a statement on a line without a number', () => {
    const src = ['ON ERROR GOTO Handler', 'x = ASC("")', 'END', 'Handler:', 'PRINT ERR; ERL', 'RESUME NEXT'].join('\n');
    expect(run(src)).toBe(' 5  0 \n');
  });

  it('ERL is 0 for a statement on an unnumbered line after a numbered one (follow-up 80)', () => {
    const src = ['10 ON ERROR GOTO 900', '20 x = ASC("")', 'y = ASC("")', 'IF 1 THEN', '  z = ASC("")', 'END IF', '30 w = ASC("")', '40 END', '900 PRINT ERL;:RESUME NEXT'].join('\n');
    // 20 -> 20; the unnumbered statements -> 0 (also the one inside a multi-line IF); 30 -> 30
    expect(run(src)).toBe(' 20  0  0  30 \n');
  });

  it('a named label does not give its line a number; a colon-led line is a new line', () => {
    const src = ['10 ON ERROR GOTO 900', '20 a = ASC("")', 'here: b = ASC("")', '30 c = ASC("")', ': d = ASC("")', 'e = ASC(""): f = ASC("")', '40 END', '900 PRINT ERL;:RESUME NEXT'].join('\n');
    expect(run(src)).toBe(' 20  0  30  0  0  0 \n');
  });

  it('a program with no line numbers is unchanged: ERL 0 throughout, and the parser marks nothing', () => {
    const src = ['ON ERROR GOTO Handler', 'x = ASC("")', 'END', 'Handler:', 'PRINT ERL', 'RESUME NEXT'].join('\n');
    expect(run(src)).toBe(' 0 \n');
  });
});

describe('errors inside SUBs and FUNCTIONs belong to the main-program statement that called them', () => {
  const procs = (bad: string): string[] => [
    'SUB Inner(k AS INTEGER)',
    '  PRINT "inner"; k',
    `  IF k = 2 THEN x = ASC("${bad}")`,
    '  PRINT "inner done"; k',
    'END SUB',
    'SUB Outer(k AS INTEGER)',
    '  DIM local AS INTEGER',
    '  local = k * 10',
    '  Inner(k)',
    '  PRINT "outer done"; local',
    'END SUB',
    'FUNCTION Twice(k AS INTEGER) AS INTEGER',
    `  IF k = 7 THEN x = ASC("${bad}")`,
    '  RETURN k * 2',
    'END FUNCTION',
  ];
  const PROCS = procs('');
  it('ERL is the calling statement; RESUME NEXT goes on after it; the stack is right afterwards', () => {
    const src = [
      ...PROCS,
      '10 ON ERROR GOTO 900',
      '20 FOR i = 1 TO 3',
      '30 Outer(i)',
      '40 NEXT',
      '50 PRINT "twice"; Twice(5); Twice(7); Twice(6)',
      '60 PRINT "end"; ERR; ERL',
      '70 END',
      '900 PRINT "ERR"; ERR; "ERL"; ERL',
      '910 RESUME NEXT',
    ].join('\n');
    // i = 2: the error is in Inner, called from Outer, called by line 30: the rest of Inner and Outer is skipped.
    // PRINT "twice": Twice(5) is printed, the error is inside Twice(7); RESUME NEXT goes on after the whole PRINT.
    expect(run(src)).toBe('inner 1 \ninner done 1 \nouter done 10 \ninner 2 \nERR 5 ERL 30 \ninner 3 \ninner done 3 \nouter done 30 \ntwice 10 ERR 5 ERL 50 \nend 0  50 \n');
  });

  it('SP and IX come back from the mark: a run with trapped procedure errors ends with the stack it started with', () => {
    const base = runSource([...procs('A'), 'FOR i = 1 TO 3', 'Outer(i)', 'NEXT'].join('\n'));
    const trapped = runSource([...PROCS, '10 ON ERROR GOTO 900', '20 FOR i = 1 TO 3', '30 Outer(i)', '40 NEXT', '50 END', '900 RESUME NEXT'].join('\n'));
    expect(trapped.stopped).toBe('rst0');
    expect(trapped.cpu.sp).toBe(base.cpu.sp);
  });

  it('ERR can be read inside a procedure, and a procedure may set ON ERROR GOTO and RESUME', () => {
    const src = [
      'SUB Report()',
      '  PRINT "err"; ERR',
      '  RESUME NEXT',
      'END SUB',
      'SUB Arm()',
      '  ON ERROR GOTO 900',
      'END SUB',
      '10 Arm()',
      '20 x = ASC("")',
      '30 PRINT "after"',
      '40 END',
      '900 Report()',
    ].join('\n');
    expect(run(src)).toBe('err 5 \nafter\n');
  });

  it('a handler target inside a procedure is E214, for ON ERROR, RESUME, EVERY and AFTER', () => {
    const body = (stmt: string): string => ['SUB P()', '100 PRINT "x"', 'END SUB', stmt].join('\n');
    for (const stmt of ['ON ERROR GOTO 100', 'RESUME 100', 'EVERY 5 GOSUB 100', 'AFTER 5 GOSUB 100']) {
      const r = lowerSource(body(stmt));
      expect(r.diagnostics.map((d) => d.slice(0, 4)), stmt).toContain('E214');
    }
    expect(lowerSource(['SUB P()', 'ON ERROR GOTO Handler', 'END SUB', 'P()', 'END', 'Handler:', 'RESUME NEXT'].join('\n')).diagnostics).toEqual([]);
  });
});

describe('RETURN with no GOSUB pending (follow-up 52)', () => {
  it('is error 3 in the main program: fatal, or trapped', () => {
    expect(fatal('10 PRINT "a"\n20 RETURN')).toBe('a\n\nError 3');
    expect(run(['10 ON ERROR GOTO 900', '20 RETURN', '30 PRINT "after"', '40 END', '900 PRINT ERR;ERL:RESUME NEXT'].join('\n'))).toBe(' 3  20 \nafter\n');
  });
  it('a RETURN with a GOSUB pending is not an error, at any depth', () => {
    const src = ['10 GOSUB 100', '20 PRINT "end"', '30 END', '100 PRINT "one":GOSUB 200:PRINT "one again":RETURN', '200 PRINT "two":RETURN'].join('\n');
    expect(run(src)).toBe('one\ntwo\none again\nend\n');
  });
  it('a RETURN after the GOSUB came back is error 3', () => {
    expect(fatal(['10 GOSUB 100', '20 RETURN', '30 END', '100 RETURN'].join('\n'))).toBe('\nError 3');
  });
});

describe('the non-fatal REAL errors (follow-up 60) and the fatal ones, firmware build', () => {
  it('Overflow and Division by zero print their name and go on with +-max', () => {
    // measured: tests/loco/err-real.bas on the interpreter
    expect(run('a! = 1E38\nPRINT a! * 10')).toBe('Overflow\n 1.70141E+38 \n');
    expect(run('a! = 0\nPRINT -1 / a!')).toBe('Division by zero\n-1.70141E+38 \n');
    expect(run('a! = 0\nb! = 1 / a!\nPRINT "after"; b!')).toBe('Division by zero\nafter 1.70141E+38 \n');
  });
  it('with a handler they are raised: the trap sees 6 and 11', () => {
    const src = ['10 DEFREAL a-z', '20 ON ERROR GOTO 900', '30 x=1E38:y=0', '40 PRINT x*10', '50 PRINT 1/y', '60 PRINT EXP(89)', '70 END', '900 PRINT "ERR";ERR;ERL:RESUME NEXT'].join('\n');
    expect(run(src)).toBe('ERR 6  40 \nERR 11  50 \nERR 6  60 \n');
  });
  it('inside the handler (error processing) they print their name and go on', () => {
    const src = ['10 DEFREAL a-z', '20 ON ERROR GOTO 900', '30 y=0', '40 x=ASC("")', '50 END', '900 PRINT 1/y:RESUME NEXT'].join('\n');
    expect(run(src)).toBe('Division by zero\n 1.70141E+38 \n');
  });
  it('SQR of a negative number, SIN of 1E6, a negative base to a fractional power: error 5, fatal; CINT(40000): error 6, fatal', () => {
    expect(fatal('a! = -1\nPRINT SQR(a!)')).toContain('Error 5');
    expect(fatal('a! = 1E6\nPRINT SIN(a!)')).toContain('Error 5');
    expect(fatal('a! = -2\nb! = 0.5\nPRINT a! ^ b!')).toContain('Error 5');
    expect(fatal('PRINT CINT(40000)')).toContain('Error 6');
    expect(fatal('a! = 32767.5\nPRINT CINT(a!)')).toContain('Error 6');
    expect(fatal('PRINT CINT(-32768.4)')).not.toContain('Error');
  });
  it('every row of the REAL errors table of loco-measured.md, with a handler (ERR) and without (the fatal rows stop)', () => {
    // the interpreter's table: 6 for the overflows and LOG(0), 11 for the zero divisions, 5 for SQR and the huge trigonometry
    const rows: Array<[string, number]> = [
      ['x*1.5+x*1.5', 6],
      ['-x*1.5-x*1.5', 6],
      ['x*10', 6],
      ['x/0.001', 6],
      ['10^39', 6],
      ['1/y', 11],
      ['y/y', 11],
      ['y^z', 11],
      ['SQR(z)', 5],
      ['LOG(y)', 6],
      ['LOG(z)', 6],
      ['LOG10(y)', 6],
      ['EXP(89)', 6],
      ['SIN(1E6)', 5],
      ['COS(1E6)', 5],
      ['TAN(1E6)', 5],
      ['(-2)^0.5', 5],
      ['CINT(40000)', 6],
    ];
    for (const [expr, err] of rows) {
      const withHandler = run(['10 DEFREAL a-z', '20 ON ERROR GOTO 900', '30 x=1E38:y=0:z=-1', `40 PRINT ${expr}`, '50 PRINT "end"', '60 END', '900 PRINT "ERR";ERR;ERL:RESUME NEXT'].join('\n'));
      expect(withHandler, expr).toBe(`ERR ${err}  40 \nend\n`);
    }
    // the rows that are values, not errors
    const values = run(['10 DEFREAL a-z', '20 ON ERROR GOTO 900', '30 PRINT EXP(88);EXP(-100);SIN(100000)', '35 PRINT (-2)^3;y^y;INT(1E10);ATN(1E38)', '40 END', '900 PRINT "ERR";ERR:RESUME NEXT'].join('\n'));
    expect(values).toBe(' 1.65164E+38  0  3.57533E-02 \n-8  1  1E+10  1.57079633 \n');
  });
});

describe('the mark costs nothing without ON ERROR GOTO n', () => {
  // The user code of these programs, as the linked asm has it before the runtime files, hashed on commit 3ad9647 (main
  // before L4-ERR) with the same compiler options. A program that links error.asm (every one does) is 10 bytes (firmware)
  // or 8 bytes (bare) longer: the trap test at the entry of `__ERROR`, which docs/ir.md "Errors" fixes.
  const BASELINE: Record<string, { fw: string; bare: string }> = {
    'hello.bas': { fw: '9260d6c6be2f1ca56c4430126cc9bfdf620f3656188b5e78d297b668cba04899', bare: 'e187160a9e402c56cd3dca5fde4dded2bba450cecf39dfecc4ee244a9e7d7a9b' },
    'str-basic.bas': { fw: '867196f7abc3a24aebf558519097672fe26d59ef6e0126c2221be6058a3f9e7b', bare: '900b3947cd93bc4d30c06c7117bcb842fd163bb48001d7f7b1393c65fe8a5874' },
    'data.bas': { fw: '4aa956301fbab23fee6f0bd7004ed4d77715f33b09e5ebba55e6a971187f19b4', bare: '0c4a6dfca59a6c105eff07451dafde6dd5e33c038b5322ec4dcfde8255f398ed' },
    'int-print.bas': { fw: 'cde1a6908eaeb78d14bc639fb0b87da73f409e6065f54e588093202fc4e3d23f', bare: 'f5c02b682707d2dd17cc473d2b02f8615cf9dd4ae7fd4d02b1548bdaf78120e7' },
    'deffn.bas': { fw: 'ebde02c528fdc00ffa5a4f6f8202ca1c9627e349558a181f19c19753d94e4968', bare: 'd2159f69e3cbb2fc056b687a5dfdcd7e0b085c8caf8a0df567100fae3814b2b4' },
    // has GOSUB and a main-program RETURN: the one difference is the RETURN check
    'int-flow.bas': { fw: '9a8cd33b80b52c58c8c5bc0a55ecc90284d42dd3b9e65b2e5cf46e2c87bccf1f', bare: 'a771fc0b3ab8069bef6faf5c32e9b4414e0df81fc8a2853bcebdc3ab55fee011' },
  };
  const userCode = (name: string, bare: boolean): { user: string; whole: string } => {
    const text = libTreeProgram(name);
    const r = compile({ files: new Map([['t.bas', text]]), main: 't.bas', defines: bare ? { CPC_BAREMETAL: '1' } : {}, runtime: libTree(), options: { format: 'bin', asm: true, optimize: 0 } }); // pins bytes: -O0 (L5)
    expect(r.ok).toBe(true);
    const whole = r.asm ?? '';
    // the RETURN check is the one allowed difference; take it out before hashing
    const user = (whole.split(';; --- end of user code ---')[0] as string).replaceAll('\tcall .core.__LOCO_RETCHK\n', '');
    return { user, whole };
  };
  for (const name of Object.keys(BASELINE)) {
    for (const bare of [false, true]) {
      it(`${name} (${bare ? 'bare' : 'firmware'}): the program's code is the code main generated${name === 'int-flow.bas' ? ' plus the RETURN check' : ''}; no error machinery is linked`, () => {
        const { user, whole } = userCode(name, bare);
        const want = BASELINE[name] as { fw: string; bare: string };
        expect(createHash('sha256').update(user).digest('hex')).toBe(bare ? want.bare : want.fw);
        expect(whole).not.toContain('__LOCO_MARK');
        expect(whole).not.toContain('__LOCO_TRAP');
      });
    }
  }
  it('a program with ON ERROR GOTO n marks main-program statements only, not the statements of procedures', () => {
    const r = lowerSource(['SUB P()', '  PRINT "in"', '  PRINT "in2"', 'END SUB', '10 ON ERROR GOTO 900', '20 P()', '30 END', '900 RESUME NEXT'].join('\n'));
    expect(r.diagnostics).toEqual([]);
    expect(r.problems).toEqual([]);
    expect(r.ir.procedures.flatMap((p) => p.body).filter((q) => q.op === 'asm')).toEqual([]);
    expect(r.ir.main.filter((q) => q.op === 'asm' && q.lines[0]?.text.includes('__LOCO_MARK')).length).toBe(4);
  });
});

function libTreeProgram(name: string): string {
  return readFileSync(join(repoRoot, 'tests/loco', name), 'latin1');
}

describe('a bare build: the trap empties the calculator stack (R13)', () => {
  /** Overflow trapped and resumed `n` times in a bare image (no firmware, the imported calculator): the error numbers seen. */
  function overflowLoop(n: number): { errors: number[]; stopped: string; count: number } {
    const loco: Record<string, string> = {};
    for (const [p, t] of libTree()) if (p.startsWith('loco/')) loco[p] = t;
    const re = (v: number): string => {
      const b = realFromNumber(v).bytes;
      return ` ld a,${b[0]}\n ld de,${(b[2]! << 8) | b[1]!}\n ld bc,${(b[4]! << 8) | b[3]!}`;
    };
    const text = [
      'org 64',
      '.core.CPC_PRIV_BASE EQU 48128',
      '.core.CPC_PRIV_SIZE EQU 1024',
      '.core.CPC_STACK_TOP EQU 48128',
      '.core.CPC_MEM_TOP EQU 49151',
      '.core.ZXBASIC_HEAP_SIZE EQU 4768',
      '.core.ZXBASIC_MEM_HEAP EQU 42336',
      '#define CPC_BAREMETAL',
      '.core.__START_PROGRAM:',
      ' di',
      ' ld sp,.core.CPC_STACK_TOP',
      ' call .core.CPC_INIT_FP_CALC',
      ' ld hl,handler',
      ' call .core.__LOCO_ONERR',
      `again:`,
      ' call .core.__LOCO_MARK',
      ' defw 7',
      ' defw after',
      re(1e38),
      ' push bc\n push de\n push af',
      re(10),
      ' call .core.__LOCO_FMUL',
      'after:',
      ' ld hl,count',
      ' inc (hl)',
      ` ld a,${n}`,
      ' cp (hl)',
      ' jr nz,again',
      ' rst 0',
      'handler:',
      ' call .core.__LOCO_ERR',
      ' ld a,(count)',
      ' ld e,a',
      ' ld d,0',
      ' ld ix,errs',
      ' add ix,de',
      ' ld (ix+0),l',
      ' call .core.__LOCO_RESUMENEXT',
      'count: defb 0',
      `errs: defs ${n + 1}`,
      '#include once <loco/error.asm>',
      '#include once <loco/realfn.asm>',
    ].join('\n');
    const image = assembleText(text, { files: loco } as never);
    const result = runImage(image.bytes, image.org, image.entry, {
      maxTStates: 300_000_000,
      // the trap enables interrupts: a bare build has its own handler (isr.asm), here the vector is just EI; RETI
      setup: (cpc: Cpc) => {
        cpc.cpu.mem[0x38] = 0xfb;
        cpc.cpu.mem[0x39] = 0xed;
        cpc.cpu.mem[0x3a] = 0x4d;
      },
    } as never);
    const at = image.addr('errs');
    return {
      errors: Array.from(result.memory.subarray(at, at + n)),
      stopped: result.stopped,
      count: result.memory[image.addr('count')] as number,
    };
  }
  it('Overflow trapped and resumed 20 times in a loop never ends in Memory full (error 7)', () => {
    const r = overflowLoop(20);
    expect(r.stopped).toBe('rst0');
    expect(r.count).toBe(20);
    expect(r.errors).toEqual(Array(20).fill(6));
  });
});
