/**
 * L4-TEXT end to end on the test Z80: streams, windows, TAG, SYMBOL, ZONE, WIDTH, PRINT USING, COPYCHR$ and the printer
 * stream. The fake firmware has one text window and none of the stream, matrix or window-setting entries, so these tests
 * register handlers that keep the firmware guide's register contract (SOFT968, entries 32, 33, 34, 56, 57, 60, 61) and
 * record what the compiled code asked of them: the sequences and registers are checked against the guide, the printer
 * bytes against what the interpreter sent (tests/loco/text-printer.expected and
 * text-symbol.expected are its transcripts).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalise, runSource } from './compile-helper.js';
import type { Cpc } from './z80sim/cpc.js';
import { assembleText, repoRoot, runImage } from './z80sim/run.js';
import { libTree } from './runtime-tree.js';

const END = '\x04END\n';

interface TextFw {
  readonly setup: (cpc: Cpc) => void;
  /** What the compiled code asked of the entries, in order. */
  readonly log: string[];
  readonly matrices: Map<number, number[]>;
  /** The result of TXT RD CHAR: a character (Carry set) or null (Carry clear, A = 0). */
  rdChar: number | null;
  /** The first character of the user matrix table, 0-255, or 256 for none. */
  first: number;
  tableAt: number;
}

/** Fake stream, window, graphics-write and matrix entries (guide entries 32, 33, 34, 56, 57, 60, 61). */
function textFw(): TextFw {
  const fw: TextFw = {
    log: [],
    matrices: new Map(),
    rdChar: null,
    first: 256,
    tableAt: 0,
    setup: (cpc) => {
      let current = 0;
      const carry = (cpu: { f: number }, on: boolean): void => {
        cpu.f = (cpu.f & ~1) | (on ? 1 : 0);
      };
      cpc.fw(0xbbb4, 'TXT STR SELECT', ['h', 'l', 'f'], (cpu, i) => {
        fw.log.push(`select ${i.a}`);
        cpu.a = current;
        current = i.a & 7;
      });
      cpc.fw(0xbbb7, 'TXT SWAP STREAMS', ['a', 'f', 'b', 'c', 'd', 'e', 'h', 'l'], (_cpu, i) => {
        fw.log.push(`swap ${i.b} ${i.c}`);
      });
      cpc.fw(0xbb66, 'TXT WIN ENABLE', ['a', 'f', 'b', 'c', 'd', 'e', 'h', 'l'], (_cpu, i) => {
        fw.log.push(`window ${i.h} ${i.d} ${i.l} ${i.e}`);
      });
      cpc.fw(0xbb63, 'TXT SET GRAPHIC', ['a', 'f'], (_cpu, i) => {
        fw.log.push(`graphic ${i.a === 0 ? 'off' : 'on'}`);
      });
      cpc.fw(0xbb60, 'TXT RD CHAR', ['a', 'f'], (cpu) => {
        fw.log.push('rdchar');
        cpu.a = fw.rdChar ?? 0;
        carry(cpu, fw.rdChar !== null);
      });
      cpc.fw(0xbbab, 'TXT SET M TABLE', ['a', 'f', 'b', 'c', 'd', 'e', 'h', 'l'], (_cpu, i) => {
        const first = (i.d << 8) | i.e;
        fw.log.push(`mtable ${first} ${first < 256 ? 'table' : 'none'}`);
        // the firmware reads the table with the lower ROM on: it must not be under it
        if (first < 256) expect((i.h << 8) | i.l, 'the matrix table must be at or above &4000').toBeGreaterThanOrEqual(0x4000);
        fw.first = first;
        fw.tableAt = (i.h << 8) | i.l;
      });
      cpc.fw(0xbba8, 'TXT SET MATRIX', ['a', 'f', 'b', 'c', 'd', 'e', 'h', 'l'], (cpu, i) => {
        const at = (i.h << 8) | i.l;
        expect(at, 'the matrix must be at or above &4000').toBeGreaterThanOrEqual(0x4000);
        const rows = Array.from(cpu.mem.subarray(at, at + 8));
        fw.log.push(`matrix ${i.a} ${rows.join(',')}`);
        const ok = i.a >= fw.first;
        if (ok) fw.matrices.set(i.a, rows);
        carry(cpu, ok);
      });
    },
  };
  return fw;
}

/** Runs a program with the text entries; the printer capture without the END marker. */
function run(src: string, fw: TextFw = textFw()): { screen: string; printer: string; log: string[]; fw: TextFw; r: ReturnType<typeof runSource> } {
  const r = runSource(src, { setup: fw.setup });
  expect(r.stopped).toBe('rst0');
  return { screen: r.screen, printer: r.printer.replace(END, ''), log: fw.log, fw, r };
}

/** The printer port has seven data lines (MC PRINT CHAR ignores bit 7: guide entry 185); the fake one keeps the byte. */
const seven = (s: string): string => [...s].map((c) => String.fromCharCode(c.charCodeAt(0) & 0x7f)).join('');

const POKEAT = 30000;
const byte = (r: ReturnType<typeof runSource>, off = 0): number => r.memory[POKEAT + off] as number;

describe('streams: the selection around a statement (docs/ir.md "Streams")', () => {
  it('PRINT #3 selects stream 3 before its output and stream 0 after it', () => {
    const { log, r } = run('PRINT #3, "x"');
    expect(log).toEqual(['select 3', 'select 0']);
    expect(r.cpc.calls.filter((c) => c.name === 'TXT OUTPUT').length).toBe(3); // x CR LF
  });
  it('no stream, #0 and a constant 0 emit no selection at all', () => {
    expect(run('PRINT "x"\nPRINT #0, "y"').log).toEqual([]);
  });
  it('the stream expression is evaluated first and selected once; an operand that is a variable works', () => {
    const { log } = run('s = 2\nLOCATE #s, 4, 5\nPEN #s + 1, 2\nCLS #2');
    expect(log).toEqual(['select 2', 'select 0', 'select 3', 'select 0', 'select 2', 'select 0']);
  });
  it('a stream above 9, below 0 or above 255 is error 5 and selects nothing', () => {
    for (const s of ['10', '-1', '256', '300']) {
      const { screen, log } = run(`s = ${s}\nPRINT #s, "never"`);
      expect(screen, s).toContain('Error 5');
      expect(screen, s).not.toContain('never');
      expect(log, s).toEqual([]);
    }
  });
  it('#8 and #9 do not touch the firmware stream: LOCO_DEV only', () => {
    const { log, printer } = run('s = 8\nPRINT #s, "p"');
    expect(log).toEqual(['select 0']); // only the closing STREAM0
    expect(printer).toBe('p\r\n');
  });
  it('an expression with POS(#2) does not change the selected stream for the rest of the statement', () => {
    const { log } = run('PRINT #1, POS(#2)');
    expect(log).toEqual(['select 1', 'select 2', 'select 1', 'select 0']);
  });
});

describe('WINDOW, WINDOW SWAP, TAG, TAGOFF (guide entries 34, 61, 33)', () => {
  it('WINDOW l, r, t, b gives TXT WIN ENABLE the values less one: H = left, D = right, L = top, E = bottom', () => {
    expect(run('WINDOW 3, 20, 2, 8').log).toEqual(['window 2 19 1 7']);
  });
  it('WINDOW #2 selects the stream around the call', () => {
    expect(run('WINDOW #2, 1, 40, 1, 25').log).toEqual(['select 2', 'window 0 39 0 24', 'select 0']);
  });
  it('each of the four is 1-255; anything else is error 5 and sets no window (measured: 0 and 256 are error 5, 255 and a window off the screen are not)', () => {
    for (const bad of ['0, 20, 1, 5', '1, 256, 1, 5', '1, 20, 0, 5', '1, 20, 1, 256', '-1, 20, 1, 5']) {
      const { screen, log } = run(`WINDOW ${bad}`);
      expect(screen, bad).toContain('Error 5');
      expect(log, bad).toEqual([]);
    }
    expect(run('WINDOW 1, 255, 1, 255').log).toEqual(['window 0 254 0 254']);
    expect(run('WINDOW 41, 50, 26, 30').log).toEqual(['window 40 49 25 29']);
  });
  it('the arguments may be expressions, evaluated left to right', () => {
    expect(run('a = 2\nWINDOW a, a + 10, a * 2, 9').log).toEqual(['window 1 11 3 8']);
  });
  it('WINDOW SWAP a, b gives TXT SWAP STREAMS B = a, C = b; one argument is a swap with stream 0 (measured); above 7 is error 5', () => {
    expect(run('WINDOW SWAP 1, 2').log).toEqual(['swap 1 2']);
    expect(run('WINDOW SWAP 3').log).toEqual(['swap 3 0']);
    expect(run('WINDOW SWAP 0, 7').log).toEqual(['swap 0 7']);
    for (const bad of ['1, 8', '8, 1', '1, 9', '-1, 1', '256, 1']) {
      const { screen, log } = run(`WINDOW SWAP ${bad}`);
      expect(screen, bad).toContain('Error 5');
      expect(log, bad).toEqual([]);
    }
  });
  it('TAG and TAGOFF are TXT SET GRAPHIC with A non-zero and zero, on the stream given', () => {
    expect(run('TAG\nTAGOFF').log).toEqual(['graphic on', 'graphic off']);
    expect(run('TAG #2\nTAGOFF #2').log).toEqual(['select 2', 'graphic on', 'select 0', 'select 2', 'graphic off', 'select 0']);
  });
});

describe('POS(#s), VPOS(#s), LOCATE #s (guide entries 39, 40, 60)', () => {
  it('POS(#s) selects the stream for the read and selects the previous one again', () => {
    const { log, r } = run(`LOCATE #2, 7, 3\nPOKE ${POKEAT}, POS(#2)\nPOKE ${POKEAT + 1}, VPOS(#2)`);
    expect(log).toEqual(['select 2', 'select 0', 'select 2', 'select 0', 'select 2', 'select 0']);
    expect([byte(r), byte(r, 1)]).toEqual([7, 3]); // the fake has one window: the cursor LOCATE #2 set
  });
  it('POS(#0) with a constant stream is a plain POS: no selection', () => {
    expect(run(`POKE ${POKEAT}, POS(#0)`).log).toEqual([]);
  });
  it('POS of a variable stream above 9 and VPOS(#8) are error 5', () => {
    expect(run('s = 10\nx = POS(#s)').screen).toContain('Error 5');
    expect(run('s = 8\nx = VPOS(#s)').screen).toContain('Error 5');
    expect(run('s = 9\nx = VPOS(#s)').screen).toContain('Error 5');
  });
  it('LOCATE #s passes the column as it is and the row cut to the window to TXT SET CURSOR', () => {
    const { r } = run('LOCATE #1, 41, 3\nLOCATE 255, 255');
    const sets = r.cpc.calls.filter((c) => c.name === 'TXT SET CURSOR');
    expect(sets.length).toBe(2);
  });
});

describe('COPYCHR$ (guide entry 32; measured: the empty string when no character is recognised)', () => {
  it('a recognised character is a one-byte string, read on the stream given', () => {
    const fw = textFw();
    fw.rdChar = 72;
    const { log, r } = run(`a$ = COPYCHR$(#2)\nPOKE ${POKEAT}, LEN(a$)\nPOKE ${POKEAT + 1}, ASC(a$)`, fw);
    expect(log).toEqual(['select 2', 'rdchar', 'select 0']);
    expect([byte(r), byte(r, 1)]).toEqual([1, 72]);
  });
  it('no character (Carry clear) is the empty string', () => {
    const fw = textFw();
    fw.rdChar = null;
    const { r } = run(`a$ = COPYCHR$(#0)\nPOKE ${POKEAT}, LEN(a$)`, fw);
    expect(byte(r)).toBe(0);
  });
  it('a space or a character above 127 is a character like any other', () => {
    const fw = textFw();
    fw.rdChar = 32;
    expect(byte(run(`a$ = COPYCHR$(#0)\nPOKE ${POKEAT}, ASC(a$)`, fw).r)).toBe(32);
    fw.rdChar = 200;
    expect(byte(run(`a$ = COPYCHR$(#0)\nPOKE ${POKEAT}, ASC(a$)`, fw).r)).toBe(200);
  });
  it('the printer and the file cannot be read: #8, #9 and above 9 are error 5', () => {
    for (const s of ['8', '9', '10']) expect(run(`s = ${s}\na$ = COPYCHR$(#s)`).screen, s).toContain('Error 5');
  });
});

describe('SYMBOL and SYMBOL AFTER (guide entries 56, 57; measured: a missing row is 0, a character below the table or above 255 is error 5)', () => {
  it('the first SYMBOL installs a table of 240-255 and then sets the matrix from a copy above &4000', () => {
    const { log, fw } = run('SYMBOL 250, 1, 2, 3');
    expect(log).toEqual(['mtable 240 table', 'matrix 250 1,2,3,0,0,0,0,0']);
    expect(fw.matrices.get(250)).toEqual([1, 2, 3, 0, 0, 0, 0, 0]);
    expect(fw.tableAt).toBeGreaterThanOrEqual(0x4000);
  });
  it('the table is installed once; eight rows go through as they are', () => {
    const { log } = run('SYMBOL 240, 255, 129, 129, 129, 129, 129, 129, 255\nSYMBOL 255, 60, 66, 165, 129, 165, 153, 66, 60');
    expect(log).toEqual(['mtable 240 table', 'matrix 240 255,129,129,129,129,129,129,255', 'matrix 255 60,66,165,129,165,153,66,60']);
  });
  it('the rows may be expressions and are evaluated left to right', () => {
    const { log } = run('FOR i = 0 TO 1\nSYMBOL 250 + i, 2 ^ i, i\nNEXT');
    expect(log).toEqual(['mtable 240 table', 'matrix 250 1,0,0,0,0,0,0,0', 'matrix 251 2,1,0,0,0,0,0,0']);
  });
  it('SYMBOL AFTER n takes a table of 256 - n characters from the heap and installs it with TXT SET M TABLE (DE = n, HL = table)', () => {
    const { log, fw } = run('SYMBOL AFTER 200\nSYMBOL 201, 1, 2, 3, 4, 5, 6, 7, 8');
    expect(log).toEqual(['mtable 200 table', 'matrix 201 1,2,3,4,5,6,7,8']);
    expect(fw.first).toBe(200);
  });
  it('SYMBOL AFTER 256 leaves no table and every SYMBOL is error 5', () => {
    const { log, screen } = run('SYMBOL AFTER 256\nSYMBOL 255, 1');
    expect(log[0]).toBe('mtable 256 none');
    expect(screen).toContain('Error 5');
  });
  it('a character below SYMBOL AFTER (the firmware refuses it: Carry clear) is error 5', () => {
    expect(run('SYMBOL AFTER 200\nSYMBOL 100, 1').screen).toContain('Error 5');
    expect(run('SYMBOL 239, 1').screen).toContain('Error 5');
  });
  it('a character or a row above 255, or below 0, is error 5 and reaches no firmware entry', () => {
    for (const bad of ['256, 1', '-1, 1', '250, 256', '250, 1, -1']) {
      const { screen, log } = run(`SYMBOL ${bad}`);
      expect(screen, bad).toContain('Error 5');
      expect(log.filter((l) => l.startsWith('matrix')), bad).toEqual([]);
    }
  });
});

describe('ZONE (measured: 1-255, 0 and 256 are error 5)', () => {
  it('ZONE 5 puts the commas of PRINT 5 columns apart', () => {
    expect(normalise(run('ZONE 5\nPRINT 1, 2, 3').r.printer)).toBe(' 1    2    3 \n');
  });
  it('ZONE 255 sends a comma to the next line (the zone does not fit)', () => {
    expect(normalise(run('ZONE 255\nPRINT 1, 2').r.printer)).toBe(' 1 \n 2 \n');
  });
  it('ZONE 0 and ZONE 256 are error 5', () => {
    expect(run('ZONE 0').screen).toContain('Error 5');
    expect(run('ZONE 256').screen).toContain('Error 5');
    expect(run('n = 0\nZONE n').screen).toContain('Error 5');
  });
});

describe('the printer stream #8 and WIDTH (measured on the 6128; tests/loco/text-printer.bas)', () => {
  it('the compiled text-printer.bas sends the bytes the interpreter sent', () => {
    const want = readFileSync(join(repoRoot, 'tests/loco/text-printer.expected'), 'latin1');
    const src = readFileSync(join(repoRoot, 'tests/loco/text-printer.bas'), 'latin1');
    const { r } = run(src);
    expect(seven(normalise(r.printer) as string)).toBe(want);
  });
  it('POS(#8) is 1 before anything is sent and counts the bytes of 32 and above; CR makes it 1; the other control codes do not count', () => {
    const { r } = run(
      `p1 = POS(#8)\nPRINT #8, "ab";\nPOKE ${POKEAT}, p1\nPOKE ${POKEAT + 1}, POS(#8)\nPRINT #8, CHR$(7);CHR$(9);CHR$(8);\nPOKE ${POKEAT + 2}, POS(#8)\nPRINT #8, "c";CHR$(13);\nPOKE ${POKEAT + 3}, POS(#8)`,
    );
    expect([0, 1, 2, 3].map((k) => byte(r, k))).toEqual([1, 3, 3, 1]);
    expect(r.printer).toBe(`ab\x07\x09\x08c\r${END}`);
  });
  it('a byte that arrives past the width is preceded by CR LF, a CR included; PRINT\'s own line end is not tested', () => {
    expect(run('WIDTH 5\nPRINT #8, "1234567890"').printer).toBe('12345\r\n67890\r\n');
    expect(run('WIDTH 5\nPRINT #8, "12345";CHR$(13);"|"').printer).toBe('12345\r\n\r|\r\n');
    expect(run('WIDTH 5\nPRINT #8, "12345";CHR$(10);"|"').printer).toBe('12345\r\n\n|\r\n');
    expect(run('WIDTH 5\nPRINT #8, "12345"').printer).toBe('12345\r\n');
  });
  it('the default width is 132; WIDTH 255 never wraps and POS stays at 255', () => {
    const a = 'a'.repeat(132);
    expect(run('PRINT #8, STRING$(140, "z");').printer).toBe(`${'z'.repeat(132)}\r\n${'z'.repeat(8)}`);
    const { r, printer } = run(`WIDTH 255\nPRINT #8, STRING$(250, "z");\nPRINT #8, "abcdefghij";\nPOKE ${POKEAT}, POS(#8)`);
    expect(printer).toBe(`${'z'.repeat(250)}abcdefghij`);
    expect(byte(r)).toBe(255);
    expect(a.length).toBe(132);
  });
  it('WIDTH 0 and WIDTH 256 are error 5', () => {
    expect(run('WIDTH 0').screen).toContain('Error 5');
    expect(run('WIDTH 256').screen).toContain('Error 5');
    expect(run('w = 0\nWIDTH w').screen).toContain('Error 5');
  });
  it('TAB, SPC and the comma of #8 follow its column and width (a TAB left of the cursor starts a new line)', () => {
    expect(run('PRINT #8, "abc";TAB(10);"x"').printer).toBe(`abc${' '.repeat(6)}x\r\n`);
    expect(run('PRINT #8, "abcdef";TAB(3);"x"').printer).toBe('abcdef\r\n  x\r\n');
    expect(run('WIDTH 5\nPRINT #8, "";SPC(7);"c";').printer).toBe('  c');
    expect(run('PRINT #8, "abc","d"').printer).toBe(`abc${' '.repeat(10)}d\r\n`);
  });
  it('the screen is untouched by a #8 statement', () => {
    expect(run('PRINT #8, "p"').screen).toBe('');
  });
});

describe('PRINT USING errors and forms (tests/loco/text-using.bas is the interpreter\'s transcript of the formats)', () => {
  const printed = (src: string): string => run(src).printer.replace(/\r\n/g, '\n');
  it('a format with no field prints its text and is then error 5 (measured)', () => {
    const { screen } = run('PRINT USING "abc"; 5');
    expect(screen.startsWith('abc')).toBe(true);
    expect(screen).toContain('Error 5');
  });
  it('a number for a string field and a string for a numeric one are error 13, after the text before the field', () => {
    const a = run('PRINT USING "x!y"; 5').screen;
    expect(a.startsWith('x')).toBe(true);
    expect(a).toContain('Error 13');
    expect(run('PRINT USING "###"; "abc"').screen).toContain('Error 13');
  });
  it('the format starts again for every item, "# and #" with one item ends at the next field, a trailing ; keeps the line', () => {
    expect(printed('PRINT USING "# and #"; 5')).toBe('5 and \n');
    expect(printed('PRINT USING "[#]"; 5; 6')).toBe('[5][6]\n');
    expect(printed('PRINT USING "###"; 1;\nPRINT "x"')).toBe('  1x\n');
    expect(printed('PRINT "a"; USING "#"; 5')).toBe('a5\n');
  });
  it('PRINT #s, USING selects the stream around the whole statement; #8 USING goes to the printer', () => {
    expect(run('PRINT #2, USING "##"; 5; 6').log).toEqual(['select 2', 'select 0']);
    expect(run('PRINT #8, USING "##.#"; 3.14159; 2.71828').printer).toBe(' 3.1 2.7\r\n');
  });
  it('a temporary format is freed at the end and the same format string works again', () => {
    expect(printed('f$ = "##"\nPRINT USING f$ + "x"; 5\nPRINT USING f$ + "x"; 6')).toBe(' 5x\n 6x\n');
  });
  it('a format with a literal backslash that is not a field stays text', () => {
    expect(run('PRINT USING "\\"; "ab"').screen).toContain('Error 5');
  });
});

describe('bare builds: stream 0 only, SYMBOL in the font table', () => {
  const files: Record<string, string> = {};
  for (const [path, text] of libTree()) if (path.startsWith('loco/')) files[path] = text;
  const bare = (body: string, data = ''): { r: ReturnType<typeof runImage>; at: (label: string) => number; error: number | null } => {
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
      body,
      ' rst 0',
      data,
      '#include once <loco/symbol.asm>',
      '#include once <loco/window.asm>',
    ].join('\n');
    const image = assembleText(text, { files } as never);
    let error: number | null = null;
    const r = runImage(image.bytes, image.org, image.entry, {
      setup: (cpc: Cpc) => {
        cpc.cpu.hooks[image.addr('.core.__ERROR')] = (c) => {
          error = c.a;
          c.stop = 'halt';
        };
      },
    } as never);
    return { r, at: (label) => image.addr(label), error };
  };
  const symbol = (c: number, rows: number[]): string =>
    [c, ...rows.slice(0, 7)].map((v) => ` ld hl,${v}\n push hl`).join('\n') + `\n ld hl,${rows[7] ?? 0}\n call .core.__LOCO_SYMBOL`;
  it('SYMBOL writes the eight rows into the renderer\'s glyph table (character c at __CPC_FONT + (c - 32) * 8)', () => {
    const { r, at, error } = bare(symbol(250, [1, 2, 3, 4, 5, 6, 7, 8]));
    expect(error).toBeNull();
    const font = at('.core.__CPC_FONT') + (250 - 32) * 8;
    expect(Array.from(r.memory.subarray(font, font + 8))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it('a character below 240 is error 5 until SYMBOL AFTER moves the limit; SYMBOL AFTER 256 refuses all', () => {
    expect(bare(symbol(200, [1, 0, 0, 0, 0, 0, 0, 0])).error).toBe(5);
    const moved = bare(` ld hl,100\n call .core.__LOCO_SYMAFTER\n${symbol(100, [9, 0, 0, 0, 0, 0, 0, 0])}`);
    expect(moved.error).toBeNull();
    const font = moved.at('.core.__CPC_FONT') + (100 - 32) * 8;
    expect(moved.r.memory[font]).toBe(9);
    expect(bare(` ld hl,256\n call .core.__LOCO_SYMAFTER\n${symbol(255, [1, 0, 0, 0, 0, 0, 0, 0])}`).error).toBe(5);
  });
  it('__LOCO_STREAM accepts 0 and raises error 5 for any other stream; __LOCO_STREAM0 does nothing', () => {
    expect(bare(' xor a\n call .core.__LOCO_STREAM\n call .core.__LOCO_STREAM0').error).toBeNull();
    expect(bare(' ld a,1\n call .core.__LOCO_STREAM').error).toBe(5);
    expect(bare(' ld a,8\n call .core.__LOCO_STREAM').error).toBe(5);
  });
});

describe('the interpreter\'s transcripts of tests/loco programs, on the test Z80 with the text entries', () => {
  it('text-symbol.bas prints the transcript the interpreter printed and sets the matrices it asks for', () => {
    const want = readFileSync(join(repoRoot, 'tests/loco/text-symbol.expected'), 'latin1');
    const src = readFileSync(join(repoRoot, 'tests/loco/text-symbol.bas'), 'latin1');
    const { r, fw } = run(src);
    expect(seven(normalise(r.printer) as string)).toBe(want);
    expect(fw.matrices.get(240)).toEqual([255, 129, 129, 129, 129, 129, 129, 255]);
    expect(fw.matrices.get(252)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(fw.matrices.get(255)).toEqual([60, 66, 165, 129, 165, 153, 66, 60]);
  });
});
