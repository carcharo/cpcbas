/**
 * L4-FILES on the simulator: OPENIN, OPENOUT, PRINT #9, WRITE, INPUT #9, LINE INPUT #9, EOF, DERR, LOAD, SAVE and the
 * rest, through the whole pipeline, against a fake AMSDOS (the register contracts of the CAS entries from the firmware
 * manual: CAS IN OPEN &BC77, CAS IN CLOSE &BC7A, CAS IN ABANDON &BC7D, CAS IN CHAR &BC80, CAS IN DIRECT &BC83,
 * CAS RETURN &BC86, CAS TEST EOF &BC89, CAS OUT OPEN &BC8C, CAS OUT CLOSE &BC8F, CAS OUT ABANDON &BC92, CAS OUT CHAR
 * &BC95, CAS OUT DIRECT &BC98, KL INIT BACK &BCCE). Expected values come from the manual and from transcripts measured
 * on the interpreter (L4-FILES probes; tests/loco/files.expected for the whole
 * program), never from cpcbas's own output. The emulator version is `tools/loco-diff.py` on tests/loco/files.bas.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile, formatDiagnostic } from '../src/index.js';
import { normalise } from './compile-helper.js';
import { libTree } from './runtime-tree.js';
import { repoRoot, runImage } from './z80sim/run.js';
import { Disc, installDisc as install } from './z80sim/disc.js';
import { FakeTicker } from './z80sim/ticker.js';

function build(text: string, options: Record<string, number | string> = {}, defines: Record<string, string> = {}): ReturnType<typeof compile> {
  return compile({
    files: new Map([['t.bas', text]]),
    main: 't.bas',
    defines: { __CPC_PRINTER_ECHO__: '', ...defines },
    runtime: libTree(),
    options: { format: 'bin', ...options },
  });
}

function run(text: string, disc: Disc = new Disc(), ticker = false, escAfter: number | null = null): { out: string; disc: Disc; stopped: string; mem: Uint8Array } {
  const r = build(text);
  expect(r.diagnostics.filter((d) => d.severity === 'error').map((d) => formatDiagnostic(d, r.sources))).toEqual([]);
  const res = runImage(r.binary as Uint8Array, r.org as number, r.entry as number, { maxTStates: 400_000_000, setup: (cpc) => {
    install(cpc, disc);
    if (ticker) new FakeTicker(cpc);
    if (escAfter !== null) {
      // ESC (key 66) for ON BREAK STOP's check: up for the first escAfter looks, then down (Z false); every other key is up.
      let looks = 0;
      cpc.fw(0xbb1e, 'KM TEST KEY', ['a', 'f', 'h', 'l'], (c, i) => {
        c.f = i.a === 66 && ++looks > escAfter ? 0 : 0x40;
        c.c = 0;
      });
    }
  } });
  return { out: normalise(res.printer) ?? `(no END marker) ${JSON.stringify(res.printer)}`, disc, stopped: res.stopped, mem: res.memory };
}

const errors = (text: string, defines: Record<string, string> = {}, options: Record<string, number | string> = {}): string[] => {
  const r = build(text, options, defines);
  return r.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.code} ${d.message}`);
};

describe('the whole of tests/loco/files.bas against the fake AMSDOS', () => {
  it('prints the transcript the interpreter printed', () => {
    const text = readFileSync(join(repoRoot, 'tests/loco/files.bas'), 'latin1');
    const want = readFileSync(join(repoRoot, 'tests/loco/files.expected'), 'latin1');
    const r = run(text);
    expect(r.stopped).toBe('rst0');
    expect(r.out).toBe(want);
  });
});

describe('tests/loco/files-abandon.bas (LOAD, SAVE with a file open; blessed on the 6128 interpreter) against the fake AMSDOS', () => {
  it('prints the transcript the interpreter printed', () => {
    const text = readFileSync(join(repoRoot, 'tests/loco/files-abandon.bas'), 'latin1');
    const want = readFileSync(join(repoRoot, 'tests/loco/files-abandon.6128.expected'), 'latin1');
    const r = run(text);
    expect(r.stopped).toBe('rst0');
    expect(r.out).toBe(want);
  });
});

describe('files across the two sides (tests/loco/files-cross.*)', () => {
  const text = (name: string): string => readFileSync(join(repoRoot, 'tests/loco', name), 'latin1');

  it('the file a compiled program writes is byte for byte the one the interpreter reads in files-cross.bas', () => {
    // lines 70-170 of files.bas write F1.TXT; files-cross.txt is those bytes, and the interpreter's reading of them is blessed as files-cross.expected
    const r = run(text('files.bas'));
    expect(r.disc.text('F1.TXT')).toBe(text('files-cross.txt'));
  });
  it('the compiled reader gives the interpreter\'s transcript for that file', () => {
    const d = new Disc();
    d.put('F1.TXT', text('files-cross.txt'));
    expect(run(text('files-cross.bas'), d).out).toBe(text('files-cross.expected'));
  });
});

describe('INPUT #9 and LINE INPUT #9: the item rules measured on the interpreter (probes p-files-input)', () => {
  const CR = '\r';
  const LF = '\n';
  /** The file content, then one read per letter of `reads`: S a string, N a REAL, L a line; E prints EOF. */
  const reading = (content: string, reads: string): string => {
    const lines = ['ON ERROR GOTO 900', 'OPENIN "F.TXT"'];
    for (const c of reads) {
      if (c === 'S') lines.push('a$="?":INPUT #9,a$:PRINT "[";a$;"]";');
      else if (c === 'N') lines.push('n!=-77:INPUT #9,n!:PRINT "<";n!;">";');
      else if (c === 'L') lines.push('a$="?":LINE INPUT #9,a$:PRINT "{";a$;"}";');
      else lines.push('PRINT "e=";EOF;');
    }
    lines.push('PRINT:END');
    const d = new Disc();
    d.put('F.TXT', content);
    return run([...lines.map((l, i) => `${(i + 1) * 10} ${l}`), '900 PRINT "!";ERR;:RESUME NEXT'].join('\n'), d).out;
  };

  it('splits at commas and CR; LF is never part of an item; an LF after a CR goes with it', () => {
    expect(reading(`a,b${CR}${LF}c${CR}${LF}`, 'SSSE')).toBe('[a][b][c]e=-1 \n');
    expect(reading(`x${CR}${CR}y${CR}`, 'SSS')).toBe('[x][][y]\n');
    expect(reading(`x${CR}y${LF}z${LF}w`, 'SS')).toBe('[x][yzw]\n');
  });
  it('skips blanks before a string and keeps the ones after it', () => {
    expect(reading(' a b ,c ', 'SS')).toBe('[a b ][c ]\n');
  });
  it('quoted strings end at the quote, may hold commas and CR, and the item after them starts where the text goes on', () => {
    expect(reading('x"y,z', 'SS')).toBe('[x"y][z]\n');
    expect(reading('ab"c"d,e', 'SS')).toBe('[ab"c"d][e]\n');
    expect(reading('"ab"cd,e', 'SS')).toBe('[ab][cd]\n');
    expect(reading('"ab"  ,e', 'SS')).toBe('[ab][e]\n');
    expect(reading(`"ab${CR}${LF}cd",e`, 'SS')).toBe('[ab\ncd][e]\n');
  });
  it('reads a number as VAL does (no quotes: a quote is text, so it is 0)', () => {
    expect(reading('12,abc,.5,+3,1.5e1,"a,b"', 'NNNNNNN')).toBe('< 12 >< 0 >< 0.5 >< 3 >< 15 >< 0 >< 0 >\n');
  });
  it('LINE INPUT keeps the line as it is, quotes and blanks included', () => {
    expect(reading(`  "a",b ${CR}${LF}second${CR}${LF}`, 'LLE')).toBe('{  "a",b }{second}e=-1 \n');
  });
  it('reading at the end of the file is error 24 (EOF met)', () => {
    expect(reading('x', 'SL')).toBe('[x]! 24 {?}\n');
  });
});

describe('errors and DERR', () => {
  it('a name AMSDOS cannot find is error 32 with its code in DERR (measured: ERR 32, DERR 146)', () => {
    const r = run('10 ON ERROR GOTO 900\n20 PRINT DERR\n30 OPENIN "NOPE.TXT"\n40 PRINT "after":END\n900 PRINT "err";ERR;"DERR";DERR:RESUME NEXT');
    expect(r.out).toBe(' 0 \nerr 32 DERR 146 \nafter\n');
    expect(r.disc.log).toEqual(['IN OPEN NOPE.TXT']);
  });
  it('a file that is not open: error 31 (INPUT #9, LINE INPUT #9, PRINT #9, WRITE #9)', () => {
    const r = run(
      ['10 ON ERROR GOTO 900', '20 INPUT #9,a$', '30 LINE INPUT #9,a$', '40 PRINT #9,"x"', '50 WRITE #9,"x"', '60 END', '900 PRINT "err";ERR:RESUME NEXT'].join('\n'),
    );
    expect(r.out).toBe('err 31 \nerr 31 \nerr 31 \nerr 31 \n');
  });
  it('a stream that is open already is error 27, and CLOSEIN and CLOSEOUT with nothing open are fine', () => {
    const d = new Disc();
    d.put('A.TXT', 'x');
    const r = run(
      ['10 ON ERROR GOTO 900', '20 CLOSEIN:CLOSEOUT', '30 OPENIN "A.TXT":OPENIN "A.TXT"', '40 OPENOUT "B.TXT":OPENOUT "C.TXT"', '50 CLOSEIN:CLOSEOUT', '60 END', '900 PRINT "err";ERR:RESUME NEXT'].join('\n'),
      d,
    );
    expect(r.out).toBe('err 27 \nerr 27 \n');
    expect(r.disc.input).toBeNull();
    expect(r.disc.output).toBeNull();
  });
  it('EOF is -1 with no file open', () => {
    expect(run('10 PRINT EOF').out).toBe('-1 \n');
  });
  it('EOF stays -1 once the end has been seen, though AMSDOS answers a second test differently', () => {
    const d = new Disc();
    d.put('A.TXT', 'ab\r\n');
    const r = run('10 OPENIN "A.TXT":LINE INPUT #9,a$:PRINT EOF;EOF:PRINT a$', d);
    expect(r.out).toBe('-1 -1 \nab\n');
  });
});

describe('the output side', () => {
  it('a file statement in an EVERY handler: its PRINT #9 goes to the file, its PRINT to the screen, and the main program keeps its streams', () => {
    // L4-FILES brief (R15): the dispatcher saves and restores LOCO_DEV and the text stream around a handler. The handler runs at a
    // statement boundary, between the main program's PRINT #9 statements; each output goes where its own statement says (manual:
    // PRINT #9 to the open output file, PRINT to stream 0).
    const d = new Disc();
    const r = run(
      [
        '10 OPENOUT "E.TXT"',
        '20 EVERY 1 GOSUB 100',
        '30 WHILE k < 3: PRINT #9, "m";: WEND',
        '40 PRINT #9, "end": CLOSEOUT',
        '50 PRINT "k="; k: END',
        '100 k = k + 1: PRINT #9, "t"; k: PRINT "h";',
        '110 IF k = 3 THEN r = REMAIN(0)',
        '120 RETURN',
      ].join('\n'),
      d,
      true,
    );
    expect(r.stopped).toBe('rst0');
    expect(r.out).toBe('hhhk= 3 \n');
    expect(d.text('E.TXT')).toMatch(/^m+t 1 \r\nm+t 2 \r\nm+t 3 \r\nm*end\r\n$/);
  });
  it('PRINT #9 and WRITE #9 write what the interpreter wrote (probe p-files-output, measured)', () => {
    const d = new Disc();
    run(
      [
        '10 OPENOUT "T.TXT"',
        '20 PRINT #9,"hello";1;-2;3.5;"x"',
        '30 PRINT #9,"a","b";TAB(20);"t";SPC(3);"s"',
        '40 WRITE #9,"q,r",12,-3.5,"s"',
        '50 WRITE #9',
        '60 a$="v":b!=7:WRITE #9,a$,b!,a$+"w",b!/4,1E10,.5',
        '70 WRITE #9,1;2',
        '80 CLOSEOUT',
      ].join('\n'),
      d,
    );
    expect(d.text('T.TXT')).toBe(
      'hello 1 -2  3.5 x\r\na            b     t   s\r\n"q,r",12,-3.5,"s"\r\n\r\n"v",7,"vw",1.75,1E+10,0.5\r\n1,2\r\n',
    );
  });
  it('a line of 255 characters is broken before the next byte, and POS(#9) counts from 1', () => {
    const d = new Disc();
    const r = run('10 OPENOUT "T.TXT":PRINT POS(#9);:PRINT #9,"abc";:PRINT POS(#9):FOR i=1 TO 300:PRINT #9,"x";:NEXT:CLOSEOUT', d);
    expect(r.out).toBe(' 1  4 \n'.replace(/ 1 {2}4/, ' 1  4'));
    const lines = (d.text('T.TXT') as string).split('\r\n');
    expect(lines.map((l) => l.length)).toEqual([255, 48]); // "abc" and 300 x: 303 bytes, the break after 255
  });
  it('the buffers: the input stream below the private block, the output stream below it when both are used', () => {
    const d = new Disc();
    d.put('A.TXT', 'x');
    run('10 OPENIN "A.TXT":OPENOUT "B.TXT":PRINT #9,"y":CLOSEOUT:CLOSEIN', d);
    expect(d.buffers.in).toEqual([0x9600]);
    expect(d.buffers.out).toEqual([0x8e00]);
    const only = new Disc();
    run('10 OPENOUT "B.TXT":PRINT #9,"y":CLOSEOUT', only);
    expect(only.buffers.out).toEqual([0x9600]);
  });
  it('AMSDOS is started with KL INIT BACK once, before the first file call', () => {
    const d = new Disc();
    run('10 OPENOUT "B.TXT":PRINT #9,"y":CLOSEOUT:OPENOUT "C.TXT":PRINT #9,"z":CLOSEOUT', d);
    expect(d.initBack).toBe(1);
  });
});

describe('LOAD, SAVE and CHAIN', () => {
  it('SAVE gives CAS OUT DIRECT the address, length, entry and type 2, and the name in capitals', () => {
    const d = new Disc();
    run('10 FOR i=0 TO 9:POKE &C100+i,i*3:NEXT\n20 SAVE "my.bin",B,&C100,10,&C108\n30 SAVE "b2.bin",B,&C100,4', d);
    expect(d.log.filter((l) => l.startsWith('OUT OPEN'))).toEqual(['OUT OPEN MY.BIN', 'OUT OPEN B2.BIN']);
    expect(d.files.get('MY.BIN')).toEqual({ data: [0, 3, 6, 9, 12, 15, 18, 21, 24, 27], type: 2, load: 0xc100, entry: 0xc108 });
    expect(d.files.get('B2.BIN')?.entry).toBe(0);
  });
  it('LOAD puts the file at the address given, or at its own', () => {
    const d = new Disc();
    d.put('A.BIN', [5, 6, 7, 8], { type: 2, load: 0xc200, entry: 0 });
    const r = run('10 LOAD "a.bin",&C300\n20 PRINT PEEK(&C300);PEEK(&C303);PEEK(&C200)\n30 LOAD "a.bin"\n40 PRINT PEEK(&C200);PEEK(&C203)', d);
    expect(r.out).toBe(' 5  8  0 \n 5  8 \n');
    expect(d.log.filter((l) => l.startsWith('IN DIRECT'))).toEqual(['IN DIRECT c300', 'IN DIRECT c200']);
    expect(d.input).toBeNull(); // closed again
  });
  it('LOAD while an input file is open abandons that file and loads (measured, R15: no error; the next INPUT #9 is 31)', () => {
    const d = new Disc();
    d.put('A.BIN', [1], { type: 2 });
    d.put('T.TXT', 'x');
    const r = run('10 ON ERROR GOTO 900\n20 OPENIN "T.TXT":LOAD "A.BIN",&C300:PRINT PEEK(&C300);:LINE INPUT #9,a$\n30 END\n900 PRINT "err";ERR;:RESUME NEXT', d);
    expect(r.out).toBe(' 1 err 31 \n');
    expect(d.log).toContain('IN ABANDON');
    expect(d.input).toBeNull();
  });
  it('LOAD while an output file is open abandons it too: never written, the next PRINT #9 is 31 (measured, p-files-chain-out)', () => {
    const d = new Disc();
    d.put('A.BIN', [1], { type: 2 });
    const r = run('10 ON ERROR GOTO 900\n20 OPENOUT "O.TXT":PRINT #9,"x":LOAD "A.BIN",&C300:PRINT "l";:PRINT #9,"y"\n30 END\n900 PRINT "err";ERR;:RESUME NEXT', d);
    expect(r.out).toBe('lerr 31 \n');
    expect(d.files.has('O.TXT')).toBe(false);
    expect(d.output).toBeNull();
  });
  it('SAVE while an output file is open abandons it and saves; the file is never written; SAVE with an input file open abandons that', () => {
    const d = new Disc();
    d.put('T.TXT', 'x');
    const r = run(
      '10 ON ERROR GOTO 900\n20 OPENOUT "O.TXT":PRINT #9,"x":SAVE "S.BIN",B,&C000,4:PRINT "s";:PRINT #9,"y"\n30 OPENIN "T.TXT":SAVE "S2.BIN",B,&C000,4:LINE INPUT #9,a$\n40 END\n900 PRINT "err";ERR;:RESUME NEXT',
      d,
    );
    expect(r.out).toBe('serr 31 err 31 \n');
    expect(d.files.has('O.TXT')).toBe(false);
    expect(d.files.has('S.BIN')).toBe(true);
    expect(d.files.has('S2.BIN')).toBe(true);
  });
});

describe('open files at the end of a program (follow-up 127; measured, loco-measured.md "R15")', () => {
  const opener = (tail: string): string => `10 OPENOUT "T1":PRINT #9,"HELLO"\n${tail}`;
  it('END closes the output file: its last block reaches the disc', () => {
    const r = run(opener('20 END'));
    expect(r.disc.text('T1')).toBe('HELLO\r\n');
    expect(r.disc.output).toBeNull();
  });
  it('running off the last line closes it as END does', () => {
    expect(run(opener('20 REM last')).disc.text('T1')).toBe('HELLO\r\n');
  });
  it('END and the end of the program close the input file too', () => {
    const d = new Disc();
    d.put('A.TXT', 'x');
    const r = run('10 OPENIN "A.TXT":END', d);
    expect(r.disc.log).toContain('IN CLOSE');
    expect(r.disc.input).toBeNull();
  });
  it('END inside an IF and a procedure body closes as well, the control CLOSEOUT before END is not closed twice', () => {
    expect(run(opener('20 IF 1 THEN END')).disc.text('T1')).toBe('HELLO\r\n');
    const r = run(opener('20 CLOSEOUT:END'));
    expect(r.disc.log.filter((l) => l === 'OUT CLOSE')).toHaveLength(1);
  });
  it('STOP leaves the output file open and unwritten (Break in 20, as the interpreter)', () => {
    const r = run(opener('20 STOP'));
    expect(r.disc.files.has('T1')).toBe(false);
    expect(r.disc.output).not.toBeNull();
    expect(r.out).toContain('Break in 20');
  });
  it('END inside a SUB, END in an ON ERROR handler and the natural end close as END does (R16)', () => {
    const sub = run(opener('20 Quit\n30 PRINT "not reached"\nSUB Quit\n  END\nEND SUB'));
    expect(sub.disc.text('T1')).toBe('HELLO\r\n');
    expect(sub.out).not.toContain('not reached');
    const handler = run(opener('15 ON ERROR GOTO 100\n20 ERROR 5\n30 PRINT "not reached"\n100 END'));
    expect(handler.disc.text('T1')).toBe('HELLO\r\n');
    const d = new Disc();
    d.put('A.TXT', 'x');
    expect(run('10 OPENIN "A.TXT"\n20 REM last', d).disc.input).toBeNull();
  });
  it('ON BREAK STOP leaves the files open and unwritten, as STOP does (R16)', () => {
    const d = new Disc();
    d.put('A.TXT', 'x');
    const r = run('10 ON BREAK STOP\n20 OPENIN "A.TXT":OPENOUT "T1":PRINT #9,"HELLO"\n30 GOTO 30', d, false, 10);
    expect(r.out).toContain('Break in 30');
    expect(r.disc.files.has('T1')).toBe(false);
    expect(r.disc.output).not.toBeNull();
    expect(r.disc.input).not.toBeNull();
    expect(r.disc.log).not.toContain('OUT CLOSE');
  });
  it('an untrapped error leaves the files open', () => {
    const d = new Disc();
    d.put('A.TXT', 'x');
    const r = run('10 OPENIN "A.TXT":OPENOUT "T1":PRINT #9,"HELLO":ERROR 5', d);
    expect(r.disc.files.has('T1')).toBe(false);
    expect(r.disc.output).not.toBeNull();
    expect(r.disc.input).not.toBeNull();
  });
});

describe('CAT and CHAIN', () => {
  it('CAT calls CAS CATALOG with the input stream buffer, and abandons an open file of either stream (measured, R15: no error)', () => {
    const d = new Disc();
    d.put('A.TXT', 'x');
    let seen: number | null = null;
    const r = (() => {
      const built = build(
        '10 ON ERROR GOTO 900\n20 CAT\n30 OPENIN "A.TXT":CAT:LINE INPUT #9,a$\n40 OPENOUT "O.TXT":PRINT #9,"x":CAT:PRINT #9,"y"\n50 END\n900 PRINT "err";ERR:RESUME NEXT',
      );
      return runImage(built.binary as Uint8Array, built.org as number, built.entry as number, {
        maxTStates: 50_000_000,
        setup: (cpc) => {
          install(cpc, d);
          cpc.fw(0xbc9b, 'CAS CATALOG', ['a', 'f', 'b', 'c', 'd', 'e', 'h', 'l'], (c, i) => {
            seen = i.d * 256 + i.e;
            c.f |= 1;
          });
        },
      });
    })();
    expect(normalise(r.printer)).toBe('err 31 \nerr 31 \n');
    expect(d.files.has('O.TXT')).toBe(false);
    expect(seen).toBe(0x9600);
  });

  it('CHAIN opens the file to be sure of it, puts the firmware interrupt vector back, copies a loader above the private block and hands over to MC BOOT PROGRAM', () => {
    const d = new Disc();
    d.put('NEXT.BIN', [1, 2, 3, 4], { type: 2, load: 0x4000, entry: 0x4002 });
    const built = build('10 PRINT "go":CHAIN "next.bin":PRINT "not reached"');
    let boot: { hl: number; vector: number } | null = null;
    let loaded: { carry: boolean; hl: number } | null = null;
    const r = runImage(built.binary as Uint8Array, built.org as number, built.entry as number, {
      maxTStates: 50_000_000,
      setup: (cpc) => {
        install(cpc, d);
        const mem = cpc.cpu.mem;
        // the runtime keeps the firmware's own handler address in its interrupt front end; the vector at &0038 is ours until CHAIN puts it back
        const RET = 0xfff0;
        cpc.hook(RET, (c) => {
          loaded = { carry: (c.f & 1) === 1, hl: c.h * 256 + c.l };
          c.stop = 'halt';
        });
        cpc.hook(0xbd13, (c) => {
          const hl = c.h * 256 + c.l;
          boot = { hl, vector: mem[0x39] + mem[0x3a] * 256 };
          // MC BOOT PROGRAM calls the loader on the system stack: do that, and stop when it returns
          c.sp = 0xb000;
          c.push(RET);
          c.pc = hl;
        });
      },
    });
    expect(r.stopped).toBe('halt');
    expect(boot).not.toBeNull();
    expect((boot as unknown as { hl: number }).hl).toBe(0xa200); // just above the private block (&9E00 + &400)
    expect((boot as unknown as { vector: number }).vector).toBe(0xb941); // the 6128's firmware handler, as before the runtime put its own at &0038
    expect(d.log).toContain('IN ABANDON'); // the probe
    // the loader opened the file again, read it into its own load address and closed it; it returns the entry address with Carry set
    expect(d.log.filter((l) => l.startsWith('IN OPEN NEXT.BIN'))).toHaveLength(2);
    expect(d.log.filter((l) => l.startsWith('IN DIRECT'))).toEqual(['IN DIRECT 4000']);
    expect(loaded).toEqual({ carry: true, hl: 0x4002 });
    expect(Array.from(r.memory.subarray(0x4000, 0x4004))).toEqual([1, 2, 3, 4]);
    expect(r.printer).not.toContain('not reached');
  });

  it('CHAIN (even one that fails with 32) abandons the open files of both streams (measured, R15 and p-files-chain-out)', () => {
    const d = new Disc();
    d.put('T.TXT', 'x');
    const r = run(
      '10 ON ERROR GOTO 900\n20 OPENIN "T.TXT":CHAIN "nope.bin":LINE INPUT #9,a$\n30 OPENOUT "O.TXT":PRINT #9,"x":CHAIN "nope.bin":PRINT #9,"y"\n40 END\n900 PRINT "err";ERR;:RESUME NEXT',
      d,
    );
    expect(r.out).toBe('err 32 err 31 err 32 err 31 \n');
    expect(d.files.has('O.TXT')).toBe(false);
    expect(d.input).toBeNull();
    expect(d.output).toBeNull();
  });

  it('CHAIN of a file AMSDOS cannot find is error 32 and the program goes on', () => {
    const r = run('10 ON ERROR GOTO 900\n20 CHAIN "nope.bin"\n30 PRINT "after":END\n900 PRINT "err";ERR;"DERR";DERR:RESUME NEXT');
    expect(r.out).toBe('err 32 DERR 146 \nafter\n');
  });
});

describe('what the compiler refuses', () => {
  const codes = (text: string, defines: Record<string, string> = {}): string[] => errors(text, defines).map((e) => e.split(' ')[0] as string);

  it('every file statement is E270 in a bare build, naming the statement', () => {
    for (const s of ['OPENIN "a"', 'OPENOUT "a"', 'CLOSEIN', 'CLOSEOUT', 'CAT', 'LOAD "a",&C000', 'SAVE "a",B,&C000,4', 'CHAIN "a"', 'WRITE #9,1', 'PRINT #9,1', 'INPUT #9,a$', 'LINE INPUT #9,a$']) {
      const e = errors(`10 ${s}`, { CPC_BAREMETAL: '' });
      expect(e, s).toHaveLength(1);
      expect(e[0], s).toMatch(/^E270 /);
      expect(e[0], s).toContain(s.split(/[ ,]/)[0] === 'LINE' ? 'LINE INPUT' : (s.split(/[ ,]/)[0] as string));
    }
    expect(errors('10 PRINT EOF', { CPC_BAREMETAL: '' })[0]).toMatch(/^E270 EOF/);
    expect(errors('10 PRINT DERR', { CPC_BAREMETAL: '' })[0]).toMatch(/^E270 DERR/);
  });
  it('E279: SAVE needs B, an address and a length', () => {
    expect(codes('10 SAVE "a"')).toEqual(['E279']);
    expect(codes('10 SAVE "a",A')).toEqual(['E279']);
    expect(codes('10 SAVE "a",P,&C000,4')).toEqual(['E279']);
    expect(codes('10 SAVE "a",B')).toEqual(['E279']);
    expect(codes('10 SAVE "a",B,&C000')).toEqual(['E279']);
    expect(codes('10 SAVE "a",B,&C000,4')).toEqual([]);
    expect(codes('10 SAVE "a",b,&C000,4,&C002')).toEqual([]);
  });
  it('E280: a constant address or length that does not fit in 16 bits', () => {
    expect(codes('10 SAVE "a",B,70000,4')).toEqual(['E280']);
    expect(codes('10 SAVE "a",B,&C000,70000')).toEqual(['E280']);
    expect(codes('10 SAVE "a",B,&C000,-1')).toEqual(['E280']);
    expect(codes('10 LOAD "a",70000')).toEqual(['E280']);
    expect(codes('10 LOAD "a",-1')).toEqual([]);
  });
  it('E281: an empty file name', () => {
    expect(codes('10 OPENIN ""')).toEqual(['E281']);
    expect(codes('10 OPENOUT ""')).toEqual(['E281']);
    expect(codes('10 a$="":OPENIN a$')).toEqual([]);
  });
  it('a file name is a string', () => {
    expect(codes('10 OPENIN 5')).not.toEqual([]);
  });
  it('INPUT cannot read the printer, #9 is the input file; PRINT and WRITE take #8 and #9', () => {
    expect(codes('10 INPUT #8,a$')).toEqual(['E262']);
    expect(codes('10 LINE INPUT #10,a$')).toEqual(['E262']);
    expect(codes('10 WRITE #10,1')).toEqual(['E262']);
    expect(codes('10 INPUT #9,a$\n20 PRINT #9,1\n30 WRITE #8,1\n40 PRINT POS(#9)')).toEqual([]);
  });
  it('E191: WRITE with a separator and no item after it (the interpreter stops with Operand missing)', () => {
    expect(codes('10 WRITE 1,')).toEqual(['E191']);
    expect(codes('10 WRITE #9,"a";')).toEqual(['E191']);
    expect(codes('10 WRITE 1;2,3\n20 WRITE\n30 WRITE #9')).toEqual([]);
  });
  it('E405 and E406: the file buffers under the private block', () => {
    // a program that ends between &9600 and &9E00 is fine without files and E405 with them
    const prog = (files: boolean): string => `10 ${files ? 'OPENIN "A":' : ''}a$="x"+STR$(1):PRINT a$`;
    const size = (build(prog(true)).binary as Uint8Array).length;
    const org = 0x9800 - size;
    expect(errors(prog(true), {}, { org, heapSize: 16, heapAddress: 0x4000 }).map((e) => e.split(' ')[0])).toEqual(['E405']);
    expect(errors(prog(false), {}, { org, heapSize: 16, heapAddress: 0x4000 })).toEqual([]);
    expect(errors('10 OPENIN "A":a$="x"+STR$(1):PRINT a$', {}, { heapAddress: 0x9000 }).map((e) => e.split(' ')[0])).toContain('E406');
  });
  it('the default heap ends under the buffers: 2 KB with the input stream, 4 KB with both', () => {
    const heapOf = (text: string): number => {
      const r = build(text, { map: 1 as unknown as number });
      const m = /ZXBASIC_MEM_HEAP EQU (\d+)/.exec(r.asm ?? '');
      return m === null ? -1 : Number(m[1]);
    };
    const withAsm = (text: string): number => {
      const r = compile({ files: new Map([['t.bas', text]]), main: 't.bas', runtime: libTree(), options: { asm: true } });
      const m = /ZXBASIC_MEM_HEAP EQU (\d+)/.exec(r.asm ?? '');
      return m === null ? -1 : Number(m[1]);
    };
    void heapOf;
    const plain = withAsm('10 a$="x"+STR$(1):PRINT a$');
    expect(plain).toBe(0x9e00 - 4768);
    expect(withAsm('10 OPENIN "A":a$="x"+STR$(1):PRINT a$')).toBe(0x9e00 - 0x800 - 4768);
    expect(withAsm('10 OPENIN "A":OPENOUT "B":a$="x"+STR$(1):PRINT a$')).toBe(0x9e00 - 0x1000 - 4768);
    expect(withAsm('10 PRINT #9,"x":a$="x"+STR$(1):PRINT a$')).toBe(0x9e00 - 4768); // PRINT #9 alone needs no buffer
  });
});
