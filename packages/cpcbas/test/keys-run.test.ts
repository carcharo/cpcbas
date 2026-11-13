/**
 * L4-KEYS on the simulator: INKEY(n), JOY(n), CLEAR INPUT, KEY, KEY DEF, SPEED KEY, INPUT, LINE INPUT
 * and ON BREAK, through the whole pipeline. Typed keys go through the fake keyboard (KM WAIT CHAR);
 * the key states, the joysticks and the key-manager setters are fake firmware entries installed by
 * `machine()`. Expected values come from the manual (the register contracts of the KM entries, the
 * INKEY(n) values) and from transcripts measured on the interpreter (tests/loco/probes/p-input*.bas,
 * p-keyerr.bas), never from cpcbas's own output.
 */
import { describe, expect, it } from 'vitest';
import { compile, formatDiagnostic } from '../src/index.js';
import { buildSource, normalise, runSource } from './compile-helper.js';
import { libTree } from './runtime-tree.js';
import type { Cpc } from './z80sim/cpc.js';

interface Kit {
  /** Keys held: key number to the shift/control state KM TEST KEY returns in C. */
  held: Map<number, number>;
  joy: [number, number];
  /** Once this many KM TEST KEY calls for ESC (66) were answered, ESC reads as pressed. */
  escAfter: number | null;
  escCalls: number;
  expand: { token: number; text: string; len: number }[];
  /** KM SET EXPAND answers "no room" (Carry clear) when set. */
  expandFull: boolean;
  setters: string[];
  delay: number[];
}

const kit = (): Kit => ({ held: new Map(), joy: [0, 0], escAfter: null, escCalls: 0, expand: [], expandFull: false, setters: [], delay: [] });

/** The fake firmware entries INPUT, INKEY(n), JOY, KEY, KEY DEF, SPEED KEY and ON BREAK call. */
function machine(k: Kit): (cpc: Cpc) => void {
  return (cpc) => {
    const NONE: never[] = [];
    cpc.fw(0xbb81, 'TXT CUR ON', NONE, () => undefined);
    cpc.fw(0xbb84, 'TXT CUR OFF', NONE, () => undefined);
    cpc.fw(0xbb1e, 'KM TEST KEY', ['a', 'f', 'h', 'l'], (c, i) => {
      if (i.a === 66) {
        k.escCalls++;
        if (k.escAfter !== null && k.escCalls > k.escAfter) k.held.set(66, 0);
      }
      const state = k.held.get(i.a);
      c.f = state === undefined ? 0x40 : 0; // Z true: not pressed. Carry false.
      c.c = state ?? 0;
    });
    cpc.fw(0xbb24, 'KM GET JOYSTICK', ['a', 'f'], (c) => {
      c.h = k.joy[0];
      c.l = k.joy[1];
    });
    cpc.fw(0xbb0f, 'KM SET EXPAND', ['a', 'b', 'c', 'd', 'e', 'h', 'l'], (c, i) => {
      const text = Array.from(cpc.cpu.mem.subarray(i.h * 256 + i.l, i.h * 256 + i.l + i.c), (b) => String.fromCharCode(b)).join('');
      k.expand.push({ token: i.b, text, len: i.c });
      c.f = k.expandFull ? c.f & ~1 : c.f | 1;
    });
    const setter = (addr: number, name: string): void =>
      cpc.fw(addr, name, ['a', 'f', 'b', 'c', 'h', 'l'], (_c, i) => void k.setters.push(`${name} ${i.a} ${i.b}`));
    setter(0xbb27, 'KM SET TRANSLATE');
    setter(0xbb2d, 'KM SET SHIFT');
    setter(0xbb33, 'KM SET CONTROL');
    setter(0xbb39, 'KM SET REPEAT');
    cpc.fw(0xbb3f, 'KM SET DELAY', ['a', 'f'], (_c, i) => void k.delay.push(i.h, i.l));
  };
}

const run = (source: string, keys: string | undefined, k: Kit = kit(), subset = true): { out: string; screen: string; stopped: string } => {
  const r = runSource(source, { ...(keys !== undefined ? { keys } : {}), setup: machine(k) }, subset);
  expect(r.built.problems).toEqual([]);
  return { out: normalise(r.printer) ?? `(no END marker) ${JSON.stringify(r.printer)}`, screen: r.screen, stopped: r.stopped };
};

/** The program text of an INPUT test: statements printing what they read. */
const typed = (...lines: string[]): string => lines.map((l) => `${l}\r`).join('');

describe('INPUT: the interpreter transcripts (p-input1.bas, REAL variable a!)', () => {
  const prog = [
    'INPUT a!: PRINT "[";a!;"]"', // 12
    'INPUT a!: PRINT "[";a!;"]"', // 7 with blanks
    'INPUT a!: PRINT "[";a!;"]"', // abc: redo, then 5
    'INPUT a!: PRINT "[";a!;"]"', // 1e3
    'INPUT a!: PRINT "[";a!;"]"', // &FF
    'INPUT a%: PRINT "[";a%;"]"', // 3
    'INPUT a%: PRINT "[";a%;"]"', // 3.7 rounds to 4
    'INPUT a!: PRINT "[";a!;"]"', // "-": redo, then "1 2" is 12
    'INPUT a!: PRINT "[";a!;"]"', // 9
    'INPUT a!: PRINT "[";a!;"]"', // +4
    'INPUT a!: PRINT "[";a!;"]"', // empty line is 0
    'PRINT "end"',
  ].join('\n');
  it('numbers, blanks, radix, rounding into an INTEGER, the empty line, and ?Redo from start', () => {
    const r = run(prog, typed('12', '  7 ', 'abc', '5', '1e3', '&FF', '3', '3.7', '-', '1 2', '9', '+4', ''));
    expect(r.out).toBe(
      '? \n[ 12 ]\n? \n[ 7 ]\n? \n?Redo from start\n? \n[ 5 ]\n? \n[ 1000 ]\n? \n[ 255 ]\n? \n[ 3 ]\n? \n[ 4 ]\n? \n?Redo from start\n? \n[ 12 ]\n? \n[ 9 ]\n? \n[ 4 ]\n? \n[ 0 ]\nend\n',
    );
  });
});

describe('INPUT: a REAL item does not depend on the Carry the conversion leaves (follow-up 151)', () => {
  it('an item is good whatever Carry VAL returns with (bare keys-input hung on it once)', () => {
    const prog = 'INPUT a!: PRINT "[";a!;"]"\nINPUT a!,b!: PRINT "[";a!;"][";b!;"]"';
    const keys = typed('12', '3,4');
    const first = runSource(prog, { keys, setup: machine(kit()) });
    const entry = first.image.addr('.core.__IN_R1'); // where the REAL comes back from __LOCO_VAL
    const r = runSource(prog, {
      keys,
      setup: (cpc) => {
        machine(kit())(cpc);
        const step = cpc.cpu.step.bind(cpc.cpu);
        cpc.cpu.step = () => {
          if (cpc.cpu.pc === entry) cpc.cpu.f |= 1; // Carry set, as VAL may leave it
          step();
        };
      },
    });
    expect(normalise(r.printer)).toBe('? \n[ 12 ]\n? \n[ 3 ][ 4 ]\n');
  });
});

describe('INPUT: items, quotes and prompts (p-input2.bas, p-input3.bas)', () => {
  it('strings are trimmed, a quote holds commas, the counts must match, LINE INPUT keeps the line', () => {
    const prog = [
      'INPUT a$: PRINT "[";a$;"]"',
      'INPUT a$: PRINT "[";a$;"]"',
      'INPUT a!,b!: PRINT "[";a!;"][";b!;"]"',
      'INPUT a$,b!: PRINT "[";a$;"][";b!;"]"',
      'INPUT a$: PRINT "[";a$;"]"',
      'LINE INPUT a$: PRINT "[";a$;"]"',
      'INPUT a$: PRINT "[";a$;"]"',
      'INPUT a$: PRINT "[";a$;"]"',
      'INPUT a$: PRINT "[";a$;"]"',
      'INPUT a$,b$: PRINT "[";a$;"][";b$;"]"',
      'INPUT a$,b$,c$: PRINT "[";a$;"][";b$;"][";c$;"]"',
      'INPUT a!,b!: PRINT "[";a!;"][";b!;"]"',
      'INPUT a!,b!: PRINT "[";a!;"][";b!;"]"',
      'INPUT a!,b!: PRINT "[";a!;"][";b!;"]"',
      'INPUT a!,b!: PRINT "[";a!;"][";b!;"]"',
      'PRINT "end"',
    ].join('\n');
    const keys = typed('hi there', '"q,r"', ' 1 , 2 ', 'x,5', '  lead  ', 'x, "y" z', '', '"unterminated', 'a"b', '"a" , "b"', 'a, b ,c', '1,', '4,5', '1,2,3', '6,7', '8', '9,x', '10,11');
    expect(run(prog, keys).out).toBe(
      '? \n[hi there]\n? \n[q,r]\n? \n[ 1 ][ 2 ]\n? \n[x][ 5 ]\n? \n[lead]\n? \n[x, "y" z]\n? \n[]\n? \n[unterminated]\n? \n[a"b]\n? \n[a][b]\n? \n[a][b][c]\n? \n[ 1 ][ 0 ]\n? \n[ 4 ][ 5 ]\n? \n?Redo from start\n? \n[ 6 ][ 7 ]\n? \n?Redo from start\n? \n?Redo from start\n? \n[ 10 ][ 11 ]\nend\n',
    );
  });

  it('the prompt forms: ; adds "? ", a comma does not, LINE INPUT without a prompt shows "? ", INPUT ; keeps the cursor', () => {
    const prog = [
      'LINE INPUT a$: PRINT "[";a$;"]"',
      'LINE INPUT "P1";a$: PRINT "[";a$;"]"',
      'LINE INPUT "P2",a$: PRINT "[";a$;"]"',
      'INPUT "N1";a$: PRINT "[";a$;"]"',
      'INPUT "N2",a$: PRINT "[";a$;"]"',
      'INPUT ;a$: PRINT "[";a$;"]"',
      'INPUT "N3";a!: PRINT "[";a!;"]"',
      'INPUT "N4",a!,b!: PRINT "[";a!;"]"',
      'PRINT "end"',
    ].join('\n');
    expect(run(prog, typed('sp  ', 'abc', 'def', 'ghi', 'jkl', 'mno', '5', 'x', '1,2')).out).toBe(
      '? \n[sp  ]\nP1? \n[abc]\nP2\n[def]\nN1? \n[ghi]\nN2\n[jkl]\n? [mno]\nN3? \n[ 5 ]\nN4\n?Redo from start\nN4\n[ 1 ]\nend\n',
    );
  });

  it('typed characters reach the screen but not the printer; DEL takes the last one back', () => {
    const r = run('INPUT a$: PRINT a$', 'abc\x7f\x7fxy\r');
    expect(r.out).toBe('? \naxy\n');
    expect(r.screen).toContain('abc');
  });
});

describe('INPUT: the decimal and radix forms (p-input4.bas, p-input5.bas)', () => {
  it('which texts are numbers', () => {
    const entries = ['12abc', '1e', '1e+', '1.5.5', '--3', '- 3', '&', '&G', '&H1F', '&X101', '&X2', '.5', '5.', '1E-2', '3 4', '123456789012', '+', '&1F', '0x10', '1d3', '-.5e1', '&7FFF', '&FFFF', '-&10', '1e3x', '99999'];
    const prog = 'FOR i=1 TO 26\nINPUT a!: PRINT "[";a!;"]"\nIF a! = 99999 THEN EXIT FOR\nNEXT\nPRINT "end"';
    expect(run(prog, typed(...entries)).out).toBe(
      '? \n?Redo from start\n? \n?Redo from start\n? \n?Redo from start\n? \n?Redo from start\n? \n?Redo from start\n? \n[-3 ]\n? \n?Redo from start\n? \n?Redo from start\n? \n[ 31 ]\n? \n[ 5 ]\n? \n?Redo from start\n? \n[ 0.5 ]\n? \n[ 5 ]\n? \n[ 0.01 ]\n? \n[ 34 ]\n? \n[ 1.23457E+11 ]\n? \n?Redo from start\n? \n[ 31 ]\n? \n?Redo from start\n? \n?Redo from start\n? \n[-5 ]\n? \n[ 32767 ]\n? \n[-1 ]\n? \n?Redo from start\n? \n?Redo from start\n? \n[ 99999 ]\nend\n',
    );
  });

  it('a radix literal of more than 16 bits prints Overflow and asks again', () => {
    const r = run('INPUT a!: PRINT "[";a!;"]"\nINPUT a!: PRINT "[";a!;"]"', typed('&10000', '&X1111111111111111', '&X11111111111111111', '7'));
    expect(r.out).toBe('? \nOverflow\n?Redo from start\n? \n[-1 ]\n? \nOverflow\n?Redo from start\n? \n[ 7 ]\n');
  });

  it('a number beyond 16 bits read into an INTEGER is error 6, Overflow (measured: "Overflow in 70")', () => {
    const r = run('INPUT a%\nPRINT "not reached"', typed('40000'));
    expect(r.screen).toContain('Error 6');
    expect(r.out).not.toContain('not reached');
  });

  it('-32768 and 32767 fit an INTEGER, 32768 does not; 32767.4 rounds down', () => {
    const r = run('INPUT a%: PRINT a%\nINPUT a%: PRINT a%\nINPUT a%: PRINT a%', typed('-32768', '32767', '32767.4'));
    expect(r.out).toBe('? \n-32768 \n? \n 32767 \n? \n 32767 \n');
    expect(run('INPUT a%', typed('32768')).screen).toContain('Error 6');
    expect(run('INPUT a%', typed('-32769')).screen).toContain('Error 6');
  });
});

describe('INPUT: targets and ownership', () => {
  it('array elements, BYTE and UBYTE variables, and a string array element', () => {
    const prog = 'DIM n(3)\nDIM s$(2)\nDIM b AS UBYTE\nINPUT n(2), s$(1), b\nPRINT n(2); s$(1); b';
    expect(run(prog, typed('7,hello,200')).out).toBe('? \n 7 hello 200 \n');
  });

  it('300 INPUTs of a string do not exhaust the heap (the line buffer and the strings are freed)', () => {
    const prog = 'FOR i=1 TO 300\nINPUT a$\nLINE INPUT b$\nNEXT\nPRINT a$; b$';
    const keys = typed(...Array.from({ length: 600 }, (_, i) => `line number ${i} with some text`));
    const r = run(prog, keys);
    // (the second string does not fit the rest of the 40-column line, so PRINT starts a new one: the interpreter does the same)
    expect(r.out.endsWith('line number 598 with some text\nline number 599 with some text\n')).toBe(true);
  });

  it('INPUT inside a SUB, with the prompt from a call site per statement', () => {
    const prog = 'SUB ask(p$)\nINPUT "q";v\nPRINT v*2\nEND SUB\nask("x")\nask("y")';
    expect(run(prog, typed('4', '5')).out).toBe('q? \n 8 \nq? \n 10 \n');
  });

  it('INPUT on a text stream #1-#7 selects it around the statement (L4-FILES); #9 is the input file, #8 the printer is E262', () => {
    const b = buildSource('INPUT #1, a$');
    expect(b.diagnostics).toEqual([]);
    expect(b.asm).toContain('__LOCO_STREAM');
    expect(b.asm).toContain('__LOCO_STREAM0');
    expect(buildSource('LINE INPUT #0, a$').asm).not.toContain('__LOCO_STREAM');
    expect(buildSource('INPUT #9, a$').asm).toContain('__LOCO_FINITEM');
    expect(buildSource('INPUT #8, a$').diagnostics.some((d) => d.startsWith('E262'))).toBe(true);
  });

  it('a prompt of 256 characters is E267, naming the statement; 255 is accepted (R16)', () => {
    const p = (n: number): string => `"${'x'.repeat(n)}"`;
    expect(buildSource(`INPUT ${p(256)}; a$`).diagnostics.filter((d) => d.startsWith('E267'))).toEqual([expect.stringContaining('The INPUT prompt is longer than 255 characters')]);
    expect(buildSource(`LINE INPUT ${p(256)}; a$`).diagnostics.filter((d) => d.startsWith('E267'))).toEqual([expect.stringContaining('The LINE INPUT prompt')]);
    expect(buildSource(`INPUT ${p(255)}; a$`).diagnostics.filter((d) => d.startsWith('E267'))).toEqual([]);
  });

  it('LINE INPUT into a number is E266; a string-only INPUT does not link the REAL conversions', () => {
    expect(buildSource('LINE INPUT a%').diagnostics.some((d) => d.startsWith('E266'))).toBe(true);
    expect(buildSource('LINE INPUT a%').diagnostics.filter((d) => d.startsWith('E266'))).toEqual([expect.stringContaining('not an INTEGER')]); // R16: the article
    expect(buildSource('INPUT a$').asm).not.toContain('loco/inputreal.asm');
    expect(buildSource('INPUT a$').asm).toContain('__LOCO_INPUT');
    expect(buildSource('INPUT a%').asm).toContain('loco/inputreal.asm');
  });
});

describe('INKEY(n) and JOY(n)', () => {
  it('INKEY(n): -1 not pressed, 0 pressed, 32 with SHIFT, 128 with CONTROL, 160 with both (the manual)', () => {
    const k = kit();
    k.held.set(47, 0);
    k.held.set(10, 0x20);
    k.held.set(11, 0x80);
    k.held.set(12, 0xa0);
    const prog = 'FOR i=0 TO 79\nIF INKEY(i) <> -1 THEN PRINT i; INKEY(i)\nNEXT\nPRINT INKEY(0)';
    expect(run(prog, undefined, k).out).toBe(' 10  32 \n 11  128 \n 12  160 \n 47  0 \n-1 \n');
  });

  it('INKEY of a key outside 0..79 is error 5 (measured, p-keyerr.bas)', () => {
    for (const n of ['80', '-1', '255', '256']) {
      const r = run(`x = INKEY(${n})\nPRINT "after"`, undefined);
      expect(r.screen, n).toContain('Error 5');
      expect(r.out, n).not.toContain('after');
    }
  });

  it('JOY(0) and JOY(1) are the two joystick bytes of KM GET JOYSTICK; 2 and -1 are error 5', () => {
    const k = kit();
    k.joy = [0x21, 0x0a];
    expect(run('PRINT JOY(0); JOY(1); JOY(0) AND 32', undefined, k).out).toBe(' 33  10  32 \n');
    expect(run('x = JOY(2)', undefined).screen).toContain('Error 5');
    expect(run('x = JOY(-1)', undefined).screen).toContain('Error 5');
  });
});

describe('CLEAR INPUT', () => {
  it('empties the key buffer', () => {
    // the bootstrap's flush lets the fake keyboard release the typed-ahead keys into its buffer, so the
    // first INKEY$ gets x; CLEAR INPUT then takes y and z away
    const r = run('a$ = INKEY$\nCLEAR INPUT\nb$ = INKEY$\nPRINT LEN(b$); LEN(a$)', 'xyz');
    expect(r.out).toBe(' 0  1 \n');
    const r2 = run('a$ = INKEY$\nb$ = INKEY$\nPRINT b$', 'xyz');
    expect(r2.out).toBe('y\n');
  });
});

describe('KEY, KEY DEF, SPEED KEY', () => {
  it('KEY n, s$ sets the expansion string of token n (KM SET EXPAND: B token, C length, HL text)', () => {
    const k = kit();
    run('KEY 2, "hello"\nKEY 31, ""\nt$ = "ab"\nKEY 0, t$ + "cd"', undefined, k);
    expect(k.expand).toEqual([
      { token: 2, text: 'hello', len: 5 },
      { token: 31, text: '', len: 0 },
      { token: 0, text: 'abcd', len: 4 },
    ]);
  });

  it('KEY with n outside 0..31, a string over 255, or no room is error 5 (measured)', () => {
    for (const src of ['KEY 32, "a"', 'KEY -1, "a"', 'KEY 1, STRING$(255, "x") + "y"']) {
      const r = run(`${src}\nPRINT "after"`, undefined);
      expect(r.screen, src).toContain('Error 5');
    }
    const k = kit();
    k.expandFull = true;
    expect(run('KEY 1, "a"\nPRINT "after"', undefined, k).screen).toContain('Error 5');
  });

  it('KEY DEF n, repeat [, normal [, shift [, control]]] sets the repeat flag and the translations (KM SET REPEAT, TRANSLATE, SHIFT, CONTROL)', () => {
    const k = kit();
    run('KEY DEF 69, 1, 98, 66, 2\nKEY DEF 70, 0\nKEY DEF 71, 1, 120', undefined, k);
    expect(k.setters).toEqual([
      'KM SET REPEAT 69 255',
      'KM SET TRANSLATE 69 98',
      'KM SET SHIFT 69 66',
      'KM SET CONTROL 69 2',
      'KM SET REPEAT 70 0',
      'KM SET REPEAT 71 255',
      'KM SET TRANSLATE 71 120',
    ]);
  });

  it('KEY DEF with a bad key, repeat or character is error 5 and changes nothing (measured)', () => {
    for (const src of ['KEY DEF 80, 1, 65', 'KEY DEF 69, 2, 65', 'KEY DEF 69, 1, 256', 'KEY DEF -1, 1', 'KEY DEF 69, 1, 65, 66, -1']) {
      const k = kit();
      const r = run(`${src}\nPRINT "after"`, undefined, k);
      expect(r.screen, src).toContain('Error 5');
      expect(k.setters, src).toEqual([]);
    }
    const k = kit();
    run('KEY DEF 79, 1, 65', undefined, k);
    expect(k.setters.length).toBe(2);
  });

  it('SPEED KEY a, b: KM SET DELAY with H = the start-up delay and L = the repeat speed; 0 and 256 are error 5 (measured)', () => {
    const k = kit();
    run('SPEED KEY 10, 5\nSPEED KEY 255, 255', undefined, k);
    expect(k.delay).toEqual([10, 5, 255, 255]);
    for (const src of ['SPEED KEY 0, 1', 'SPEED KEY 1, 0', 'SPEED KEY 256, 1', 'SPEED KEY 1, 256']) {
      expect(run(src, undefined).screen, src).toContain('Error 5');
    }
  });
});

describe('ON BREAK', () => {
  it('STOP ends the program with Break at the next statement after ESC; Break is not an error', () => {
    const k = kit();
    k.escAfter = 50;
    const r = run('10 ON BREAK STOP\n20 n = 0\n30 n = n + 1\n40 GOTO 30', undefined, k);
    expect(r.stopped).toBe('rst0');
    expect(r.out).toMatch(/^Break in (30|40)\n$/); // the statement boundary where ESC was seen (follow-up 103)
    expect(r.screen).not.toContain('Error');
    expect(k.escCalls).toBeGreaterThan(50);
  });

  it('CONT clears it again, STOP sets it again, and a program without STOP never looks at ESC', () => {
    const k = kit();
    k.escAfter = 1; // ESC goes down after the first look: the statement after ON BREAK STOP
    const r = run('ON BREAK STOP\nON BREAK CONT\nFOR i = 1 TO 20\nNEXT\nPRINT "done"', undefined, k);
    expect(r.out).toBe('done\n');
    expect(k.escCalls).toBe(1); // CONT stopped the looking
    const k2 = kit();
    k2.held.set(66, 0);
    expect(run('ON BREAK CONT\nPRINT "plain"', undefined, k2).out).toBe('plain\n');
    expect(k2.escCalls).toBe(0);
    const k3 = kit();
    k3.held.set(66, 0);
    const r3 = run('PRINT "a"\nON BREAK STOP\nPRINT "b"', undefined, k3);
    expect(r3.out).toBe('a\nBreak\n'); // POS is 1: no extra line end (follow-up 116)
  });

  it('a program without ON BREAK STOP is unchanged: no check is emitted and the check routine is not linked', () => {
    const plain = buildSource('PRINT 1\nON BREAK CONT\nPRINT 2');
    expect(plain.asm).not.toContain('__LOCO_CHKBRK');
    expect(plain.asm).not.toContain('__LOCO_ONBREAK');
    const stop = buildSource('ON BREAK STOP\nPRINT 2');
    expect(stop.asm).toContain('__LOCO_CHKBRK');
  });

  it('works inside a procedure body too', () => {
    const k = kit();
    k.held.set(66, 0);
    const r = run('SUB spin()\nDO\nn = n + 1\nLOOP\nEND SUB\nON BREAK STOP\nspin()', undefined, k);
    expect(r.out).toBe('Break\n');
  });

  it('prints Break in n on a fresh line, as STOP does; Break on an unnumbered line (follow-ups 103, 116)', () => {
    const k = kit();
    k.escAfter = 1; // the check at line 20 finds ESC up, the check at line 30 finds it down
    expect(run('10 ON BREAK STOP\n20 PRINT "x";\n30 PRINT "y"\n40 PRINT "not reached"', undefined, k).out).toBe('x\nBreak in 30\n');
    const k2 = kit();
    k2.held.set(66, 0);
    // a mixed program: the line after a numbered one has no number
    expect(run('10 ON BREAK STOP\nPRINT "z"', undefined, k2).out).toBe('Break\n');
    // STOP prints the same text on the same line
    expect(run('10 PRINT "x";\n20 STOP', undefined, kit()).out).toBe('x\nBreak in 20\n');
  });
});

describe('bare builds', () => {
  const bare = (src: string): { ok: boolean; messages: string[] } => {
    const r = compile({ files: new Map([['t.bas', src]]), main: 't.bas', defines: { CPC_BAREMETAL: '' }, runtime: libTree(), options: { format: 'cpr', org: 0x4000 } });
    return { ok: r.ok, messages: r.diagnostics.map((d) => formatDiagnostic(d, r.sources)) };
  };
  it('INKEY(n), JOY(n), CLEAR INPUT, INPUT, LINE INPUT and ON BREAK CONT assemble', () => {
    const r = bare('ON BREAK CONT\nx = INKEY(47)\ny = JOY(1)\nCLEAR INPUT\nINPUT "n";a%, b$\nLINE INPUT c$\nINPUT d!\nPRINT x; y; a%; b$; c$; d!');
    expect(r.messages).toEqual([]);
    expect(r.ok).toBe(true);
  });
  it('KEY, KEY DEF, SPEED KEY and ON BREAK STOP are E270 in a bare build', () => {
    for (const src of ['KEY 1, "a"', 'KEY DEF 69, 1, 98', 'SPEED KEY 10, 5', 'ON BREAK STOP']) {
      const r = bare(src);
      expect(r.ok, src).toBe(false);
      expect(r.messages.join('\n'), src).toContain('E270');
    }
  });
});
