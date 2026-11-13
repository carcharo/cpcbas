/**
 * lib/loco, the Locomotive text layer (L2-RTLOCO): every file assembles in the firmware and
 * bare variants, every label of LOCO_LABEL_FILES is defined in its file, and the routines run
 * on the test Z80 and fake firmware with the transcripts measured on the real interpreter
 * as expected values.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCO_LABEL_FILES } from '../src/runtime/loco-labels.js';
import { assembleAndRun, assembleText, repoRoot, runProgram, wrapProgram } from './z80sim/run.js';
import type { AssembleOptions, ProgramOptions, RunOptions } from './z80sim/run.js';

const locoDir = join(repoRoot, 'lib/loco');
const locoFiles = readdirSync(locoDir)
  .filter((f) => f.endsWith('.asm'))
  .sort();
const files: Record<string, string> = {};
for (const f of locoFiles) files[`loco/${f}`] = readFileSync(join(locoDir, f), 'latin1');

const PRIV = 40448; // CPC_PRIV_BASE of the firmware-mode wrapper
const TXT_COLS = PRIV + 0xa9;
const PEN_MAP = PRIV + 0xa0;
const NL = '\r\n';
const END = '\x04END\n';

function wrapper(path: string, variant: 'fw' | 'bare'): string {
  const [privBase, stackTop, memTop, heap] = variant === 'bare' ? [48128, 48128, 49151, 42336] : [40448, 42496, 42619, 35680];
  const lines = [
    'org 64',
    `.core.CPC_PRIV_BASE EQU ${privBase}`,
    '.core.CPC_PRIV_SIZE EQU 1024',
    `.core.CPC_STACK_TOP EQU ${stackTop}`,
    `.core.CPC_MEM_TOP EQU ${memTop}`,
    '.core.ZXBASIC_HEAP_SIZE EQU 4768',
    `.core.ZXBASIC_MEM_HEAP EQU ${heap}`,
  ];
  if (variant === 'bare') lines.push('#define CPC_BAREMETAL');
  lines.push(`#include once <${path}>`);
  // read.asm starts reading at the table the code generator emits
  if (path === 'loco/read.asm' || path === 'loco/readf.asm') lines.push('.DATA.__DATA__0:', '\tDEFB 0');
  return `${lines.join('\n')}\n`;
}

describe('lib/loco files', () => {
  it('has the files the label table names, and no others', () => {
    const named = new Set(Object.values(LOCO_LABEL_FILES).map((f) => f.slice('loco/'.length)));
    expect([...named].sort()).toEqual(locoFiles);
  });
  for (const f of locoFiles) {
    for (const variant of ['fw', 'bare'] as const) {
      for (const echo of [false, true]) {
        it(`${f} assembles (${variant}${echo ? ', printer echo' : ''}) with no diagnostics`, () => {
          const defines: Record<string, string> = echo ? { __CPC_PRINTER_ECHO__: '1' } : {};
          const image = assembleText(wrapper(`loco/${f}`, variant), { files, defines });
          // fwmath.asm is the firmware maths gate: empty in a bare build, which has no firmware; vars.asm is EQUs only
          if (f === 'vars.asm') expect(image.bytes.length).toBe(0);
          else if (!(f === 'fwmath.asm' && variant === 'bare')) expect(image.bytes.length).toBeGreaterThan(0);
        });
      }
    }
  }
  it('defines every label of the table in its file', () => {
    for (const [label, file] of Object.entries(LOCO_LABEL_FILES)) {
      const image = assembleText(wrapper(file, 'fw'), { files, defines: { __CPC_PRINTER_ECHO__: '1', CPC_INKEY_BUFFERED: '1' } });
      expect(() => image.addr(label), label).not.toThrow();
    }
    // one assembly per label (about 1.3 s alone): the default 5 s failed under the full suite's load (R19)
  }, 30_000);
  it('screen.asm in bare mode defines every screen entry and has no firmware gate (L2-BARE)', () => {
    const image = assembleText(wrapper('loco/screen.asm', 'bare'), { files, defines: {} });
    for (const l of ['MODE', 'PEN', 'PAPER', 'BORDER', 'LOCATE', 'CLS', 'POS', 'VPOS']) {
      expect(() => image.addr(`.core.__LOCO_${l}`), l).not.toThrow();
    }
    expect(() => image.addr('.core.__FW_CALL')).toThrow();
    // the bare text layer's renderer is what MODE and CLS reach
    expect(() => image.addr('.core.__BT_SET_MODE')).not.toThrow();
    expect(() => image.addr('.core.__BT_CLEAR')).not.toThrow();
  });
  it('carries the MIT header and register contracts', () => {
    for (const f of locoFiles) {
      const text = files[`loco/${f}`];
      expect(text, f).toMatch(/MIT/);
      expect(text, f).toMatch(/Clobbers/);
    }
  });
});

const ALL = ['loco/txt.asm', 'loco/print.asm', 'loco/number.asm', 'loco/screen.asm', 'loco/inkey.asm'];

/** Runs a firmware-mode program that includes the whole of lib/loco, with the printer echo on. */
function run(body: string, data = '', extra: Partial<ProgramOptions> = {}, opts: RunOptions & AssembleOptions = {}) {
  const r = runProgram({ body, data, include: ALL, heap: true, ...extra }, { files, ...opts });
  expect(r.stopped).toBe('rst0');
  return r;
}
const at = (col: number, row: number): string => ` ld h,${col}\n ld l,${row}\n call .core.__LOCO_LOCATE\n`;
const num = (entry: string, v: number): string => ` ld hl,${v & 0xffff}\n call .core.${entry}\n`;
const str = (label: string): string => ` ld hl,${label}\n xor a\n call .core.__LOCO_PRINTSTR\n`;
const pos = ' call .core.__LOCO_POS\n ld (rpos),hl\n call .core.__LOCO_VPOS\n ld (rpos+2),hl\n';
const POSDATA = 'rpos: defw 0,0\n';

describe('character output and the printer echo', () => {
  it('sends every byte to TXT OUTPUT; the printer gets the filtered bytes', () => {
    const r = run(' ld a,65\n call .core.__LOCO_PUTC\n ld a,7\n call .core.__LOCO_PUTC\n call .core.__LOCO_NL\n ld a,66\n call .core.__LOCO_PUTC\n ld a,13\n call .core.__LOCO_PUTC\n ld a,10\n call .core.__LOCO_PUTC');
    expect(r.screen).toBe(`A\x07${NL}B\r\n`);
    // 13 is a line end, 10 and 7 are dropped
    expect(r.printer).toBe(`A\nB\n${END}`);
  });
  it('preserves A, BC, DE and HL', () => {
    const r = run(
      ' ld a,120\n ld bc,0x1234\n ld de,0x5678\n ld hl,0x9abc\n call .core.__LOCO_PUTC\n ld (rg),a\n ld (rg+1),bc\n ld (rg+3),de\n ld (rg+5),hl',
      'rg: defs 8',
    );
    expect([r.byteAt('rg'), r.wordAt('rg', 1), r.wordAt('rg', 3), r.wordAt('rg', 5)]).toEqual([0x78, 0x1234, 0x5678, 0x9abc]);
  });
  it('control codes with parameters act on the screen (CHR$(31) moves the cursor), the parameters are echoed', () => {
    const r = run(' ld a,31\n call .core.__LOCO_PUTC\n ld a,33\n call .core.__LOCO_PUTC\n ld a,10\n call .core.__LOCO_PUTC\n ld a,81\n call .core.__LOCO_PUTC');
    expect(r.cpc.cursor).toEqual({ col: 34, row: 10 });
    expect(r.rows[9]).toBe(`${' '.repeat(32)}Q`);
    expect(r.printer).toBe(`!Q${END}`);
  });
  it('the printer transcript is the harness filter applied to the screen bytes', () => {
    const bytes = [72, 105, 13, 10, 7, 12, 65, 0, 200, 31, 33, 10, 90, 27, 13, 13, 10];
    const r = run(bytes.map((b) => ` ld a,${b}\n call .core.__LOCO_PUTC\n`).join(''));
    const filtered = bytes
      .filter((b) => b === 13 || b >= 32)
      .map((b) => (b === 13 ? '\n' : String.fromCharCode(b)))
      .join('');
    expect([...r.cpc.textBytes]).toEqual(bytes);
    expect(r.printer).toBe(filtered + END);
  });
  it('without the printer echo nothing reaches the printer', () => {
    const r = assembleAndRun(wrapProgram({ body: ' ld a,65\n call .core.__LOCO_PUTC', include: ALL, heap: true }), { files });
    expect(r.stopped).toBe('waitkey'); // END waits for a key without the echo
    expect(r.screen).toBe('A');
    expect(r.printer).toBe('');
  });
});

describe('PRINT of numbers: the measured number text', () => {
  const cases: [string, number, string][] = [
    ['__LOCO_PRINTI16', 5, ' 5 '],
    ['__LOCO_PRINTI16', -5, '-5 '],
    ['__LOCO_PRINTI16', 0, ' 0 '],
    ['__LOCO_PRINTI16', 32767, ' 32767 '],
    ['__LOCO_PRINTI16', -32768, '-32768 '],
    ['__LOCO_PRINTI16', 10, ' 10 '],
    ['__LOCO_PRINTI16', -10000, '-10000 '],
    ['__LOCO_PRINTU16', 65535, ' 65535 '],
    ['__LOCO_PRINTU16', 32768, ' 32768 '],
    ['__LOCO_PRINTU16', 100, ' 100 '],
  ];
  for (const [entry, v, text] of cases) {
    it(`${entry} ${v} prints "${text}"`, () => {
      const r = run(num(entry, v));
      expect(r.screen).toBe(text);
      expect(r.printer).toBe(text + END);
    });
  }
  const long: [string, number, string][] = [
    ['__LOCO_PRINTI32', 100000, ' 100000 '],
    ['__LOCO_PRINTI32', -100000, '-100000 '],
    ['__LOCO_PRINTI32', 65536, ' 65536 '],
    ['__LOCO_PRINTI32', 999999999, ' 999999999 '],
    ['__LOCO_PRINTI32', 2147483647, ' 2147483647 '],
    ['__LOCO_PRINTI32', -2147483648, '-2147483648 '],
    ['__LOCO_PRINTI32', -65536, '-65536 '],
    ['__LOCO_PRINTU32', 4294967295, ' 4294967295 '],
    ['__LOCO_PRINTU32', 2147483648, ' 2147483648 '],
    ['__LOCO_PRINTU32', 70000, ' 70000 '],
  ];
  for (const [entry, v, text] of long) {
    it(`${entry} ${v} prints "${text}"`, () => {
      const u = v >>> 0;
      const r = run(` ld de,${u >>> 16}\n ld hl,${u & 0xffff}\n call .core.${entry}\n`);
      expect(r.screen).toBe(text);
    });
  }
  it('every INTEGER from -300 to 300 and a sweep of the range match JS formatting', () => {
    const values = [-32768, -32767, -12345, -9999, -1000, -999, -100, -99, -10, -9, -1, 0, 1, 9, 10, 99, 100, 999, 1000, 9999, 10000, 12345, 32767];
    const r = run(values.map((v) => num('__LOCO_PRINTI16', v) + ' ld a,124\n call .core.__LOCO_PUTC\n ld a,13\n call .core.__LOCO_PUTC\n ld a,10\n call .core.__LOCO_PUTC\n').join(''));
    expect(r.printer).toBe(values.map((v) => `${v < 0 ? '-' : ' '}${Math.abs(v)} |\n`).join('') + END);
  });
});

describe('STR$: the number text without the trailing space', () => {
  const str$ = (entry: string, hl: string, de?: string): string => {
    const r = run(
      ` ${de ? `ld de,${de}\n ` : ''}ld hl,${hl}\n call .core.${entry}\n ld (sp1),hl\n ld a,h\n or l\n jr z,nul\n ld c,(hl)\n inc hl\n ld b,(hl)\n inc hl\n ld de,sbuf\n ld a,b\n or c\n jr z,nul\n ldir\nnul:`,
      'sp1: defw 0\nsbuf: defs 16',
    );
    const p = r.wordAt('sp1');
    const len = r.memory[p] | (r.memory[p + 1] << 8);
    return String.fromCharCode(...r.memory.slice(p + 2, p + 2 + len));
  };
  it('STR$(5) is " 5", STR$(-5) is "-5"', () => {
    expect(str$('__LOCO_STRI16', '5')).toBe(' 5');
    expect(str$('__LOCO_STRI16', '65531')).toBe('-5');
    expect(str$('__LOCO_STRI16', '0')).toBe(' 0');
    expect(str$('__LOCO_STRI16', '32768')).toBe('-32768');
    expect(str$('__LOCO_STRU16', '65535')).toBe(' 65535');
  });
  it('LONG and ULONG', () => {
    expect(str$('__LOCO_STRI32', '0', '65535')).toBe('-65536');
    expect(str$('__LOCO_STRI32', '0', '1')).toBe(' 65536');
    expect(str$('__LOCO_STRU32', '1', '1')).toBe(' 65537');
  });
});

describe('PRINT of strings, wrap in mode 1 (40 columns)', () => {
  const S = (label: string, text: string): string => `${label}: defw ${text.length}\n defb "${text}"\n`;
  it('prints a string and frees a temporary one only when the flag is set', () => {
    const r = run(str('s1'), S('s1', 'HELLO'));
    expect(r.screen).toBe('HELLO');
    expect(r.printer).toBe(`HELLO${END}`);
  });
  it('a NULL string prints nothing', () => {
    const r = run(' ld hl,0\n xor a\n call .core.__LOCO_PRINTSTR');
    expect(r.screen).toBe('');
  });
  it('an item that does not fit moves whole to the next line (LOCATE 37,5; "ABCDEF"); POS 7, VPOS 6', () => {
    const r = run(at(37, 5) + str('s1') + pos, S('s1', 'ABCDEF') + POSDATA);
    expect(r.screen).toBe(`${NL}ABCDEF`);
    expect([r.wordAt('rpos'), r.wordAt('rpos', 2)]).toEqual([7, 6]);
    expect(r.rows[5]).toBe('ABCDEF');
  });
  it('an item that fits to the last column stays; the cursor is then at column 1 of the next row', () => {
    const r = run(at(37, 5) + str('s1') + pos, S('s1', 'ABCD') + POSDATA);
    expect(r.screen).toBe('ABCD');
    expect([r.wordAt('rpos'), r.wordAt('rpos', 2)]).toEqual([1, 6]);
  });
  it('PRINT "abcd";"efgh" from column 36: the second item moves to the next line', () => {
    const r = run(at(36, 3) + str('s1') + str('s2'), S('s1', 'abcd') + S('s2', 'efgh'));
    expect(r.screen).toBe(`abcd${NL}efgh`);
    expect(r.printer).toBe(`abcd\nefgh${END}`);
  });
  it('an item at column 1 is never preceded by a line end, even when longer than the line', () => {
    const long = 'x'.repeat(45);
    const r = run(str('s1'), S('s1', long));
    expect(r.screen).toBe(long);
  });
  it('a number at column 39 needs 3 columns and wraps first; at column 38 it fits', () => {
    const r39 = run(at(39, 2) + num('__LOCO_PRINTI16', 7) + pos, POSDATA);
    expect(r39.screen).toBe(`${NL} 7 `);
    expect([r39.wordAt('rpos'), r39.wordAt('rpos', 2)]).toEqual([4, 3]);
    const r38 = run(at(38, 2) + num('__LOCO_PRINTI16', 7) + pos, POSDATA);
    expect(r38.screen).toBe(' 7 ');
    expect([r38.wordAt('rpos'), r38.wordAt('rpos', 2)]).toEqual([1, 3]);
  });
  it('a character in the last column leaves the cursor at column 1 of the next row without a CR LF', () => {
    const r = run(at(40, 17) + ' ld a,90\n call .core.__LOCO_PUTC\n' + pos, POSDATA);
    expect(r.screen).toBe('Z');
    expect([r.wordAt('rpos'), r.wordAt('rpos', 2)]).toEqual([1, 18]);
  });
  it('a number printed right after a last-column character does not add a line end', () => {
    const r = run(at(40, 17) + ' ld a,90\n call .core.__LOCO_PUTC\n' + num('__LOCO_PRINTI16', 5), '');
    expect(r.screen).toBe('Z 5 ');
    expect(r.rows[17]).toBe(' 5');
  });
});

describe('PRINT zones', () => {
  const S = (label: string, text: string): string => `${label}: defw ${text.length}\n defb "${text}"\n`;
  const items = (names: string[]): string => names.map((n) => str(n)).join(' call .core.__LOCO_COMMA\n');
  it('PRINT "a","b","c","d": items at columns 1, 14, 27 and the fourth on the next line', () => {
    const r = run(items(['za', 'zb', 'zc', 'zd']), S('za', 'a') + S('zb', 'b') + S('zc', 'c') + S('zd', 'd'));
    expect(r.screen).toBe(`a${' '.repeat(12)}b${' '.repeat(12)}c${NL}d`);
    expect(r.printer).toBe(`a${' '.repeat(12)}b${' '.repeat(12)}c\nd${END}`);
    expect(r.rows[0]).toBe(`a${' '.repeat(12)}b${' '.repeat(12)}c`);
    expect(r.rows[1]).toBe('d');
  });
  it('a trailing comma after the last zone leaves the cursor on the next line', () => {
    const r = run(`${items(['za', 'zb', 'zc'])} call .core.__LOCO_COMMA\n${pos}`, S('za', 'a') + S('zb', 'b') + S('zc', 'c') + POSDATA);
    expect([r.wordAt('rpos'), r.wordAt('rpos', 2)]).toEqual([1, 2]);
  });
  // [start column, spaces sent, column after] -- `,` at columns 1, 12, 13, 14, 26, 27, 28, 38
  const commas: [number, number | 'NL'][] = [
    [1, 13],
    [2, 12],
    [12, 2],
    [13, 1],
    [14, 13],
    [26, 1],
    [27, 'NL'],
    [28, 'NL'],
    [38, 'NL'],
    [40, 'NL'],
  ];
  for (const [col, want] of commas) {
    it(`"," at column ${col} ${want === 'NL' ? 'sends CR LF' : `sends ${want} spaces`}`, () => {
      const r = run(at(col, 4) + ' call .core.__LOCO_COMMA\n' + pos, POSDATA);
      if (want === 'NL') {
        expect(r.screen).toBe(NL);
        expect([r.wordAt('rpos'), r.wordAt('rpos', 2)]).toEqual([1, 5]);
      } else {
        expect(r.screen).toBe(' '.repeat(want));
        expect([r.wordAt('rpos'), r.wordAt('rpos', 2)]).toEqual([col + want, 4]);
      }
    });
  }
  it('an item longer than a zone is followed by spaces to the next zone start (20 characters, 6 spaces)', () => {
    const t = 'ABCDEFGHIJKLMNOPQRST';
    const r = run(str('za') + ' call .core.__LOCO_COMMA\n' + pos, S('za', t) + POSDATA);
    expect(r.screen).toBe(t + ' '.repeat(6));
    expect(r.wordAt('rpos')).toBe(27);
  });
  it('ZONE 5 changes the width: items at columns 1, 6, 11', () => {
    const r = run(
      ' ld a,5\n call .core.__LOCO_ZONE_SET\n' + items(['za', 'zb', 'zc']),
      S('za', 'a') + S('zb', 'b') + S('zc', 'c'),
    );
    expect(r.screen).toBe('a    b    c');
  });
  it('a leading comma pads 13 spaces', () => {
    const r = run(' call .core.__LOCO_COMMA\n' + str('za'), S('za', 'x'));
    expect(r.screen).toBe(`${' '.repeat(13)}x`);
  });
});

describe('SPC and TAB', () => {
  it('SPC(5) sends 5 spaces, SPC(0) none', () => {
    expect(run(' ld a,5\n call .core.__LOCO_SPC').screen).toBe('     ');
    expect(run(' xor a\n call .core.__LOCO_SPC').screen).toBe('');
  });
  it('TAB(10) from column 1 sends 9 spaces; TAB to the cursor column sends none', () => {
    expect(run(' ld a,10\n call .core.__LOCO_TAB').screen).toBe(' '.repeat(9));
    expect(run(at(10, 1) + ' ld a,10\n call .core.__LOCO_TAB').screen).toBe('');
  });
  it('TAB left of the cursor starts a new line first', () => {
    const r = run(at(20, 1) + ' ld a,5\n call .core.__LOCO_TAB\n' + pos, POSDATA);
    expect(r.screen).toBe(`${NL}    `);
    expect([r.wordAt('rpos'), r.wordAt('rpos', 2)]).toEqual([5, 2]);
  });
  it('TAB(0) counts as column 1; TAB(45) in mode 1 is column 5', () => {
    expect(run(' xor a\n call .core.__LOCO_TAB').screen).toBe('');
    expect(run(' ld a,45\n call .core.__LOCO_TAB').screen).toBe('    ');
  });
});

describe('LOCATE, POS, VPOS, CLS', () => {
  it('LOCATE then POS and VPOS (1-based)', () => {
    const r = run(at(12, 7) + pos, POSDATA);
    expect([r.wordAt('rpos'), r.wordAt('rpos', 2)]).toEqual([12, 7]);
    expect(r.cpc.cursor).toEqual({ col: 12, row: 7 });
    expect(r.cpc.calls.some((c) => c.name === 'TXT SET CURSOR')).toBe(true);
  });
  it('LOCATE with a 0 sets Carry and moves nothing', () => {
    const go = (h: number, l: number): { bad: boolean; cursor: { col: number; row: number } } => {
      const r = run(`${at(5, 5)} ld h,${h}\n ld l,${l}\n call .core.__LOCO_LOCATE\n sbc a,a\n ld (cy),a`, 'cy: defb 0');
      return { bad: r.byteAt('cy') !== 0, cursor: r.cpc.cursor };
    };
    expect(go(0, 3)).toEqual({ bad: true, cursor: { col: 5, row: 5 } });
    expect(go(3, 0)).toEqual({ bad: true, cursor: { col: 5, row: 5 } });
    expect(go(40, 1)).toEqual({ bad: false, cursor: { col: 40, row: 1 } });
  });
  // The measured rule (464 and 6128, CPCEC; L4-TEXT: rows too):
  // the firmware gets the column as it is and the row cut to the window, and POS/VPOS read the position where the
  // next character goes (TXT VALIDATE's rule: a column W+1..W+128 is column 1 of the next row, W+129..255 the last
  // column of the previous row; the row is held to the window, the roll comes with the next character).
  const past: [number, number, number, number, number][] = [
    // columns W = 40 (mode 1), [mode, column, row, POS, VPOS]
    [1, 41, 25, 1, 25],
    [1, 255, 25, 40, 24],
    [1, 255, 10, 40, 9],
    [1, 254, 10, 40, 9],
    [1, 255, 1, 40, 1],
    [1, 100, 25, 1, 25],
    [1, 129, 10, 1, 11],
    [1, 168, 10, 1, 11],
    [1, 169, 10, 40, 9],
    [1, 40, 10, 40, 10],
    [1, 41, 10, 1, 11],
    [1, 5, 26, 5, 25],
    [1, 5, 128, 5, 25],
    [1, 5, 129, 5, 1],
    [1, 5, 255, 5, 1],
    [2, 207, 10, 1, 11],
    [2, 208, 10, 1, 11],
    [2, 209, 10, 80, 9],
    [2, 255, 10, 80, 9],
    [2, 100, 10, 1, 11],
    [2, 200, 10, 1, 11],
  ];
  for (const [mode, col, row, p, v] of past) {
    it(`LOCATE ${col},${row} in mode ${mode} leaves POS ${p}, VPOS ${v}`, () => {
      const r = run(` ld a,${mode}\n call .core.__LOCO_MODE\n${at(col, row)}${pos}`, POSDATA);
      expect([r.wordAt('rpos'), r.wordAt('rpos', 2)]).toEqual([p, v]);
    });
  }
  it('CLS clears the screen and homes the cursor', () => {
    const r = run(`${at(5, 5)} ld a,88\n call .core.__LOCO_PUTC\n call .core.__LOCO_CLS`);
    expect(r.rows.every((row) => row === '')).toBe(true);
    expect(r.cpc.cursor).toEqual({ col: 1, row: 1 });
    expect(r.cpc.calls.some((c) => c.name === 'TXT CLEAR WINDOW')).toBe(true);
  });
});

describe('MODE, PEN, PAPER, BORDER', () => {
  it('MODE 2 sets the firmware mode and the runtime variables (80 columns, pen map)', () => {
    const r = run(' ld a,2\n call .core.__LOCO_MODE');
    expect(r.cpc.mode).toBe(2);
    expect(r.memory[TXT_COLS]).toBe(80);
    expect([...r.memory.slice(PEN_MAP, PEN_MAP + 8)]).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
  });
  it('MODE 0 gives 20 columns; MODE 1 back to 40', () => {
    const r0 = run(' ld a,0\n call .core.__LOCO_MODE');
    expect(r0.cpc.mode).toBe(0);
    expect(r0.memory[TXT_COLS]).toBe(20);
    expect([...r0.memory.slice(PEN_MAP, PEN_MAP + 8)]).toEqual([5, 6, 3, 7, 12, 2, 1, 4]);
    const r1 = run(' ld a,0\n call .core.__LOCO_MODE\n ld a,1\n call .core.__LOCO_MODE');
    expect(r1.memory[TXT_COLS]).toBe(40);
  });
  it('MODE clears the screen and homes the cursor', () => {
    const r = run(' ld a,88\n call .core.__LOCO_PUTC\n ld a,1\n call .core.__LOCO_MODE');
    expect(r.rows[0]).toBe('');
    expect(r.cpc.cursor).toEqual({ col: 1, row: 1 });
  });
  it('wraps follow the mode: a number at column 19 of 20 (mode 0) and 79 of 80 (mode 2) wraps first', () => {
    const r0 = run(` ld a,0\n call .core.__LOCO_MODE\n${at(19, 2)}${num('__LOCO_PRINTI16', 7)}`);
    expect(r0.screen.endsWith(`${NL} 7 `)).toBe(true);
    const r0b = run(` ld a,0\n call .core.__LOCO_MODE\n${at(18, 2)}${num('__LOCO_PRINTI16', 7)}`);
    expect(r0b.screen.endsWith(' 7 ') && !r0b.screen.includes(NL)).toBe(true);
    const r2 = run(` ld a,2\n call .core.__LOCO_MODE\n${at(79, 2)}${num('__LOCO_PRINTI16', 7)}`);
    expect(r2.screen.endsWith(`${NL} 7 `)).toBe(true);
    const r2b = run(` ld a,2\n call .core.__LOCO_MODE\n${at(78, 2)}${num('__LOCO_PRINTI16', 7)}`);
    expect(r2b.screen.endsWith(' 7 ') && !r2b.screen.includes(NL)).toBe(true);
  });
  it('commas follow the mode: zones 1, 14, 27, 40, 53, 66 in mode 2; a comma in mode 0 starts a new line', () => {
    const S = 'za: defw 1\n defb "a"\n';
    const items = Array.from({ length: 6 }, () => str('za')).join(' call .core.__LOCO_COMMA\n');
    const r2 = run(` ld a,2\n call .core.__LOCO_MODE\n${items}`, S);
    expect(r2.rows[0]).toBe(['a', 'a', 'a', 'a', 'a', 'a'].join(' '.repeat(12)));
    const r0 = run(` ld a,0\n call .core.__LOCO_MODE\n${str('za')} call .core.__LOCO_COMMA\n${str('za')}`, S);
    expect(r0.rows[0]).toBe('a');
    expect(r0.rows[1]).toBe('a');
  });
  it('PEN and PAPER take pen numbers; BORDER takes hardware colours', () => {
    const r = run(' ld a,2\n call .core.__LOCO_PEN\n ld a,3\n call .core.__LOCO_PAPER\n ld b,20\n ld c,6\n call .core.__LOCO_BORDER');
    expect(r.cpc.pen).toBe(2);
    expect(r.cpc.paper).toBe(3);
    expect(r.cpc.border).toEqual([20, 6]);
    expect(r.cpc.calls.filter((c) => ['TXT SET PEN', 'TXT SET PAPER', 'SCR SET BORDER'].includes(c.name)).length).toBe(3);
  });
});

describe('INKEY$', () => {
  const inkey = (keys?: string): string => {
    const r = run(
      ' call .core.__LOCO_INKEY\n ld (sp1),hl\n ld c,(hl)\n ld b,0\n ld (ln),bc\n inc hl\n inc hl\n ld a,(hl)\n ld (ch),a',
      'sp1: defw 0\nln: defw 0\nch: defb 0',
      {},
      { keys, defines: { __CPC_PRINTER_ECHO__: '1', CPC_INKEY_BUFFERED: '1' } },
    );
    expect(r.stopped).toBe('rst0');
    return r.wordAt('ln') === 0 ? '' : String.fromCharCode(r.byteAt('ch'));
  };
  it('returns the empty string with no key and the key typed ahead otherwise; it never waits', () => {
    expect(inkey()).toBe('');
    expect(inkey('k')).toBe('k');
  });
});
