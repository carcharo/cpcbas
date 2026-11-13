/**
 * L4-GFX on the test Z80: the graphics and colour statements (lib/loco/gfx.asm, gfxpx.asm, gfxfill.asm, inkset.asm).
 *
 * Firmware mode: each statement must reach the firmware entries the Locomotive interpreter reaches, with the
 * arguments the firmware guide (SOFT968) defines for them: GRA MOVE/PLOT/TEST/LINE ABSOLUTE and RELATIVE (DE = x,
 * HL = y, in Locomotive's own 640 x 400 units, unscaled), GRA SET PEN / PAPER (A), SCR ACCESS (A = 0 force, 1 XOR,
 * 2 AND, 3 OR), GRA SET ORIGIN, GRA WIN WIDTH / HEIGHT (DE, HL), GRA CLEAR WINDOW, SCR SET INK (A = pen, B, C),
 * SCR SET FLASHING (H, L), GRA SET LINE MASK / SET FIRST / SET BACK / FILL (the 664/6128 entries). The firmware is
 * a recording stand-in here; what the real firmware draws is the interpreter's (tests/loco/gfx-*.bas, ink.bas).
 *
 * Bare mode: a minimal bare image (no bootstrap) draws into the simulator's RAM, and the expected pixels come from
 * the CPC screen layout (the hardware documentation: 80 bytes per character row, 8 lines 2 KB apart, the pen bits of
 * a pixel in the byte per mode) and from Locomotive's own conversion (a virtual unit is half a pixel across in mode
 * 1, a quarter in mode 0, one in mode 2, and half a line up).
 */
import { describe, expect, it } from 'vitest';
import { buildSource, normalise } from './compile-helper.js';
import { libTree } from './runtime-tree.js';
import type { Cpc } from './z80sim/cpc.js';
import type { Z80Cpu } from './z80sim/cpu.js';
import { assembleAndRun, assembleText, runImage } from './z80sim/run.js';
import type { RunOptions } from './z80sim/run.js';

const files: Record<string, string> = {};
for (const [path, text] of libTree()) if (path.startsWith('loco/')) files[path] = text;

// ---------------------------------------------------------------------------
// Firmware mode
// ---------------------------------------------------------------------------

type Reg = 'a' | 'f' | 'b' | 'c' | 'd' | 'e' | 'h' | 'l';
const ALL: Reg[] = ['a', 'f', 'b', 'c', 'd', 'e', 'h', 'l'];
const s16 = (n: number): number => (n << 16) >> 16;

/** A recording stand-in for the graphics and colour entries; `log` holds one line per call, in order. */
function graphicsFirmware(opts: { has6128?: boolean; testPen?: number } = {}): { log: string[]; setup: (cpc: Cpc) => void } {
  const log: string[] = [];
  return {
    log,
    setup: (cpc: Cpc): void => {
      let cx = 0; // the cursor, in user units (no origin in this stand-in)
      let cy = 0;
      const xy = (i: { d: number; e: number; h: number; l: number }): [number, number] => [s16((i.d << 8) | i.e), s16((i.h << 8) | i.l)];
      const entry = (addr: number, name: string, fn: (c: Z80Cpu, i: { a: number; b: number; c: number; d: number; e: number; h: number; l: number }) => void): void => {
        cpc.fw(addr, name, ALL, (c, i) => fn(c, i));
      };
      const move = (name: string, addr: number, rel: boolean, draws: boolean): void =>
        entry(addr, name, (_c, i) => {
          const [x, y] = xy(i);
          cx = rel ? cx + x : x;
          cy = rel ? cy + y : y;
          log.push(`${name} ${x},${y}`);
          void draws;
        });
      move('GRA MOVE ABSOLUTE', 0xbbc0, false, false);
      move('GRA MOVE RELATIVE', 0xbbc3, true, false);
      move('GRA PLOT ABSOLUTE', 0xbbea, false, true);
      move('GRA PLOT RELATIVE', 0xbbed, true, true);
      move('GRA LINE ABSOLUTE', 0xbbf6, false, true);
      move('GRA LINE RELATIVE', 0xbbf9, true, true);
      entry(0xbbf0, 'GRA TEST ABSOLUTE', (c, i) => {
        const [x, y] = xy(i);
        cx = x;
        cy = y;
        log.push(`GRA TEST ABSOLUTE ${x},${y}`);
        c.a = opts.testPen ?? 2;
      });
      entry(0xbbf3, 'GRA TEST RELATIVE', (c, i) => {
        const [x, y] = xy(i);
        cx += x;
        cy += y;
        log.push(`GRA TEST RELATIVE ${x},${y}`);
        c.a = opts.testPen ?? 2;
      });
      entry(0xbbc6, 'GRA ASK CURSOR', (c) => {
        c.de = cx & 0xffff;
        c.hl = cy & 0xffff;
        log.push('GRA ASK CURSOR');
      });
      entry(0xbbc9, 'GRA SET ORIGIN', (_c, i) => log.push(`GRA SET ORIGIN ${xy(i).join(',')}`));
      entry(0xbbcf, 'GRA WIN WIDTH', (_c, i) => log.push(`GRA WIN WIDTH ${xy(i).join(',')}`));
      entry(0xbbd2, 'GRA WIN HEIGHT', (_c, i) => log.push(`GRA WIN HEIGHT ${xy(i).join(',')}`));
      entry(0xbbdb, 'GRA CLEAR WINDOW', () => log.push('GRA CLEAR WINDOW'));
      entry(0xbbde, 'GRA SET PEN', (_c, i) => log.push(`GRA SET PEN ${i.a}`));
      entry(0xbbe4, 'GRA SET PAPER', (_c, i) => log.push(`GRA SET PAPER ${i.a}`));
      entry(0xbc59, 'SCR ACCESS', (_c, i) => log.push(`SCR ACCESS ${i.a}`));
      entry(0xbc32, 'SCR SET INK', (_c, i) => log.push(`SCR SET INK ${i.a},${i.b},${i.c}`));
      entry(0xbc3e, 'SCR SET FLASHING', (_c, i) => log.push(`SCR SET FLASHING ${i.h},${i.l}`));
      entry(0xbd46, 'GRA SET BACK', (_c, i) => log.push(`GRA SET BACK ${i.a}`));
      entry(0xbd49, 'GRA SET FIRST', (_c, i) => log.push(`GRA SET FIRST ${i.a}`));
      entry(0xbd4c, 'GRA SET LINE MASK', (_c, i) => log.push(`GRA SET LINE MASK ${i.a}`));
      entry(0xbd52, 'GRA FILL', (_c, i) => log.push(`GRA FILL ${i.a} buffer ${i.h * 256 + i.l > 0 ? 'set' : 'none'} ${i.d * 256 + i.e}`));
      // the jumpblock of a 664/6128 starts every entry with RST 1 (&CF); a 464's has no entry at &BD46 and beyond
      // (the fake CPC's own 6128 jumpblock has them since L5-SIMFW: a 464 here clears them)
      for (const a of [0xbd46, 0xbd49, 0xbd4c, 0xbd52]) cpc.cpu.mem[a] = opts.has6128 !== false ? 0xcf : 0;
    },
  };
}

function runGfx(source: string, opts: { has6128?: boolean; testPen?: number } = {}): { log: string[]; printer: string; screen: string; stopped: string } {
  const built = buildSource(source);
  expect(built.diagnostics).toEqual([]);
  expect(built.problems).toEqual([]);
  const fw = graphicsFirmware(opts);
  const r = assembleAndRun(built.asm, { defines: built.defines, files, maxTStates: 50_000_000, setup: fw.setup } as RunOptions);
  return { log: fw.log, printer: r.printer, screen: r.screen, stopped: r.stopped };
}

describe('firmware mode: the graphics statements reach the firmware entries', () => {
  it('PLOT, MOVE and DRAW are the absolute entries with Locomotive coordinates unscaled', () => {
    expect(runGfx('PLOT 100,50\nMOVE 639,399\nDRAW -5,7').log).toEqual([
      'GRA PLOT ABSOLUTE 100,50',
      'GRA MOVE ABSOLUTE 639,399',
      'GRA LINE ABSOLUTE -5,7',
    ]);
  });
  it('PLOTR, MOVER and DRAWR are the relative entries', () => {
    expect(runGfx('PLOTR 3,-4\nMOVER -1,2\nDRAWR 10,20').log).toEqual([
      'GRA PLOT RELATIVE 3,-4',
      'GRA MOVE RELATIVE -1,2',
      'GRA LINE RELATIVE 10,20',
    ]);
  });
  it('the pen argument sets the graphics pen first, the ink mode sets SCR ACCESS, then the point is drawn', () => {
    expect(runGfx('PLOT 1,2,3\nDRAW 4,5,6,1\nMOVE 7,8,,2\nPLOTR 9,10,1,3').log).toEqual([
      'GRA SET PEN 3',
      'GRA PLOT ABSOLUTE 1,2',
      'GRA SET PEN 6',
      'SCR ACCESS 1',
      'GRA LINE ABSOLUTE 4,5',
      'SCR ACCESS 2',
      'GRA MOVE ABSOLUTE 7,8',
      'GRA SET PEN 1',
      'SCR ACCESS 3',
      'GRA PLOT RELATIVE 9,10',
    ]);
  });
  it('arguments are evaluated in order and may be expressions or variables', () => {
    const r = runGfx('a% = 10\nb% = 20\nPLOT a% + 1, b% * 2, a% MOD 4\nDRAWR a%, -b%');
    expect(r.log).toEqual(['GRA SET PEN 2', 'GRA PLOT ABSOLUTE 11,40', 'GRA LINE RELATIVE 10,-20']);
  });
  it('a REAL argument is rounded half away from zero, as the interpreter does (PLOT 1.5, 2.5 is PLOT 2, 3)', () => {
    expect(runGfx('PLOT 1.5,2.5\nPLOT -1.5,-2.5\nPLOT 0.4,0.6').log).toEqual([
      'GRA PLOT ABSOLUTE 2,3',
      'GRA PLOT ABSOLUTE -2,-3',
      'GRA PLOT ABSOLUTE 0,1',
    ]);
  });
  it('TEST and TESTR return the pen the firmware reports; XPOS and YPOS read the cursor', () => {
    const r = runGfx('PRINT TEST(10,20);TESTR(1,2)\nMOVE 30,40\nPRINT XPOS;YPOS\nMOVER -5,5\nPRINT XPOS+YPOS', { testPen: 3 });
    expect(r.log.filter((l) => l.startsWith('GRA TEST'))).toEqual(['GRA TEST ABSOLUTE 10,20', 'GRA TEST RELATIVE 1,2']);
    expect(normalise(r.printer)).toBe(' 3  3 \n 30  40 \n 70 \n');
  });
  it('CLG sets the paper first when it has an argument, then clears the window', () => {
    expect(runGfx('CLG\nCLG 3').log).toEqual(['GRA CLEAR WINDOW', 'GRA SET PAPER 3', 'GRA CLEAR WINDOW']);
  });
  it('GRAPHICS PEN and GRAPHICS PAPER; the background mode is the 664/6128 entry', () => {
    expect(runGfx('GRAPHICS PEN 2\nGRAPHICS PAPER 5\nGRAPHICS PEN ,1\nGRAPHICS PEN 3,0').log).toEqual([
      'GRA SET PEN 2',
      'GRA SET PAPER 5',
      'GRA SET BACK 1',
      'GRA SET PEN 3',
      'GRA SET BACK 0',
    ]);
  });
  it('ORIGIN x, y is GRA SET ORIGIN; with a window it also sets the width (left, right) and the height (top, bottom)', () => {
    expect(runGfx('ORIGIN 10,20').log).toEqual(['GRA SET ORIGIN 10,20']);
    expect(runGfx('ORIGIN 10,20,0,100,300,50').log).toEqual(['GRA WIN HEIGHT 300,50', 'GRA WIN WIDTH 0,100', 'GRA SET ORIGIN 10,20']);
  });
  it('INK n, c1 [, c2] and SPEED INK a, b are SCR SET INK and SCR SET FLASHING', () => {
    expect(runGfx('INK 2,13,20\nINK 1,5\nINK 15,26\nSPEED INK 10,20').log).toEqual([
      'SCR SET INK 2,13,20',
      'SCR SET INK 1,5,5',
      'SCR SET INK 15,26,26',
      'SCR SET FLASHING 10,20',
    ]);
  });
  it('MASK n, first and FILL n are the 664/6128 entries', () => {
    expect(runGfx('MASK 15\nMASK ,1\nMASK 255,0\nFILL 2').log).toEqual([
      'GRA SET LINE MASK 15',
      'GRA SET FIRST 1',
      'GRA SET LINE MASK 255',
      'GRA SET FIRST 0',
      'GRA FILL 2 buffer set 512',
    ]);
  });
  it('MASK, FILL and GRAPHICS PEN ,m on a 464 are error 2, Syntax error (the 464 has no such entries)', () => {
    for (const src of ['MASK 15', 'MASK ,1', 'FILL 2', 'GRAPHICS PEN ,1']) {
      const r = runGfx(src, { has6128: false });
      expect(r.screen, src).toContain('Error 2');
      expect(r.log, src).toEqual([]);
    }
  });
  it('arguments out of range are error 5, Improper argument, and nothing is drawn', () => {
    for (const src of [
      'GRAPHICS PEN 16',
      'GRAPHICS PEN -1',
      'GRAPHICS PAPER 16',
      'CLG 16',
      'INK 16,1',
      'INK 1,32',
      'INK 1,2,32',
      'INK -1,2',
      'SPEED INK 0,5',
      'SPEED INK 5,0',
      'SPEED INK 256,5',
      'MASK 256',
      'MASK ,2',
      'FILL 16',
      'PLOT 1,2,3,4',
      'PLOT 1,2,3,-1',
      'GRAPHICS PEN ,2',
    ]) {
      const r = runGfx(src);
      expect(r.screen, src).toContain('Error 5');
      expect(r.log.filter((l) => /DRAW|PLOT|CLEAR|FILL|SET INK|FLASHING|MASK|FIRST|ORIGIN/.test(l)), src).toEqual([]);
    }
  });
  it('arguments that call a FUNCTION keep the values already evaluated, and a SUB can draw with its parameters', () => {
    const r = runGfx(
      'n% = 0\nFUNCTION f%(a%)\nn% = n% + 1\nRETURN a% * 10 + n%\nEND FUNCTION\nSUB s(a%, b%)\nDRAW a%, b%, a% MOD 4\nEND SUB\nPLOT f%(1), f%(2), f%(3) MOD 16\ns(7, 8)\nINK 1, f%(0), f%(1)\n',
    );
    expect(r.log).toEqual(['GRA SET PEN 1', 'GRA PLOT ABSOLUTE 11,22', 'GRA SET PEN 3', 'GRA LINE ABSOLUTE 7,8', 'SCR SET INK 1,4,15']);
  });
  it('a statement that is not used links none of the graphics code (the image does not change)', () => {
    const plain = buildSource('PRINT 1').asm;
    expect(plain).not.toContain('__LOCO_GPLOT');
    expect(plain).not.toContain('__LOCO_INK');
  });
  it('CIRCLE and POINT take the mode pixels: x is scaled left by the mode (mode 1: x 2, y 2) for the firmware', () => {
    const r = runGfx('CIRCLE 10,10,0\nPRINT POINT(3,4)', { testPen: 1 });
    // the centre (10, 10) pixels is (20, 20) virtual units in mode 1; POINT leaves the cursor where it was (the cursor
    // is asked first and put back after the test)
    expect(r.log).toEqual([
      'GRA PLOT ABSOLUTE 20,20',
      'GRA ASK CURSOR',
      'GRA TEST ABSOLUTE 6,8',
      'GRA MOVE ABSOLUTE 20,20',
    ]);
    expect(normalise(r.printer)).toBe(' 1 \n');
  });
  it('CIRCLE plots every pixel of the midpoint circle once (radius 5, mode 1: 28 points)', () => {
    const r = runGfx('CIRCLE 100,100,5');
    const pts = r.log.filter((l) => l.startsWith('GRA PLOT ABSOLUTE')).map((l) => l.slice('GRA PLOT ABSOLUTE '.length));
    expect(new Set(pts).size).toBe(pts.length);
    // the midpoint circle of radius 5 has 28 pixels: x = 0..5 per octant (0,5) (1,5) (2,5) (3,4) (4,3) (5,2) (5,1) (5,0) in
    // eight-fold symmetry without the doubled axis and diagonal points
    expect(pts.length).toBe(28);
    for (const p of pts) {
      const [vx, vy] = p.split(',').map(Number) as [number, number];
      expect(vx % 2).toBe(0); // mode 1: a pixel is two units wide
      expect(vy % 2).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Bare-metal mode
// ---------------------------------------------------------------------------

const SCREEN = 0xc000;

/** The pen of pixel (x, y) (y from the bottom) as the hardware's screen memory layout encodes it. */
function penAt(mem: Uint8Array, mode: 0 | 1 | 2, x: number, y: number): number {
  const line = 199 - y;
  const ppb = mode === 0 ? 2 : mode === 1 ? 4 : 8;
  const addr = SCREEN + (line % 8) * 0x800 + Math.floor(line / 8) * 80 + Math.floor(x / ppb);
  const byte = mem[addr] as number;
  const i = x % ppb;
  const bit = (n: number): number => (byte >> n) & 1;
  if (mode === 2) return bit(7 - i);
  if (mode === 1) return bit(7 - i) | (bit(3 - i) << 1);
  return bit(7 - i) | (bit(3 - i) << 1) | (bit(5 - i) << 2) | (bit(1 - i) << 3);
}

/** Every pixel that is not pen 0 (the screen was cleared to pen 0), as "x,y". */
function litPixels(mem: Uint8Array, mode: 0 | 1 | 2, w: number): Set<string> {
  const out = new Set<string>();
  for (let y = 0; y < 200; y++) for (let x = 0; x < w; x++) if (penAt(mem, mode, x, y) !== 0) out.add(`${x},${y}`);
  return out;
}

interface BareRun {
  mem: Uint8Array;
  error: number | null;
  word: (label: string) => number;
  byte: (label: string) => number;
}

/** Runs `body` (asm) in a minimal bare image: MODE `mode` first, then `body`; `error` is the error number __ERROR was called with. */
function bare(mode: 0 | 1 | 2, body: string, data = ''): BareRun {
  const text = [
    'org 64',
    '.core.CPC_PRIV_BASE EQU 48128',
    '.core.CPC_PRIV_SIZE EQU 1024',
    '.core.CPC_STACK_TOP EQU 48128',
    '.core.CPC_MEM_TOP EQU 49151',
    '.core.ZXBASIC_HEAP_SIZE EQU 4768',
    '.core.ZXBASIC_MEM_HEAP EQU 42336',
    '#define CPC_BAREMETAL',
    '#define CPC_LINE_6128',
    '.core.__START_PROGRAM:',
    ' di',
    ' ld sp,.core.CPC_STACK_TOP',
    ' ld a,$C0',
    ' ld (.core.SCREEN_ADDR+1),a',
    ' call .core.CPC_INIT_13_LOCOGFX',
    ` ld a,${mode}`,
    ' call .core.__LOCO_MODE',
    body,
    ' rst 0',
    data,
    '#include once <loco/gfx.asm>',
    '#include once <loco/gfxpx.asm>',
    '#include once <loco/inkset.asm>',
    '#include once <loco/screen.asm>',
  ].join('\n');
  const image = assembleText(text, { files } as never);
  let error: number | null = null;
  const run = runImage(image.bytes, image.org, image.entry, {
    maxTStates: 200_000_000,
    setup: (cpc: Cpc) => {
      cpc.cpu.hooks[image.addr('.core.__ERROR')] = (c: Z80Cpu) => {
        error = c.a;
        c.stop = 'halt';
      };
    },
  } as never);
  return {
    mem: run.memory,
    error,
    word: (label) => run.memory[image.addr(label)]! | (run.memory[image.addr(label) + 1]! << 8),
    byte: (label) => run.memory[image.addr(label)]!,
  };
}

/** asm that calls a two-argument entry: x then y pushed, y on top. */
const call2 = (label: string, x: number, y: number): string => ` ld hl,${x & 0xffff}\n push hl\n ld hl,${y & 0xffff}\n push hl\n call .core.${label}`;
const call1 = (label: string, v: number): string => ` ld hl,${v & 0xffff}\n call .core.${label}`;

describe('bare mode: pixels and Locomotive coordinates', () => {
  it('PLOT x, y lights the pixel x >> 1, y >> 1 in mode 1 with graphics pen 1', () => {
    const r = bare(1, call2('__LOCO_GPLOT', 101, 51));
    expect(r.error).toBeNull();
    expect([...litPixels(r.mem, 1, 320)]).toEqual(['50,25']);
    expect(penAt(r.mem, 1, 50, 25)).toBe(1);
  });
  it('a virtual unit is a quarter pixel across in mode 0 and a whole pixel in mode 2', () => {
    const m0 = bare(0, call2('__LOCO_GPLOT', 11, 10) + '\n' + call2('__LOCO_GPLOT', 12, 10));
    expect([...litPixels(m0.mem, 0, 160)].sort()).toEqual(['2,5', '3,5']);
    const m2 = bare(2, call2('__LOCO_GPLOT', 639, 399) + '\n' + call2('__LOCO_GPLOT', 0, 0));
    expect([...litPixels(m2.mem, 2, 640)].sort()).toEqual(['0,0', '639,199']);
  });
  it('a negative coordinate rounds down: PLOT -1, -1 is the pixel below and left of the screen (nothing drawn)', () => {
    const r = bare(1, call2('__LOCO_GPLOT', -1, -1) + '\n' + call2('__LOCO_GPLOT', 640, 400) + '\n' + call2('__LOCO_GPLOT', 639, 399));
    expect([...litPixels(r.mem, 1, 320)]).toEqual(['319,199']);
  });
  it('the pen argument sets the graphics pen: GPENP 2 then PLOT lights pen 2; GRAPHICS PEN above 15 is error 5', () => {
    const r = bare(1, call1('__LOCO_GPENP', 2) + '\n' + call2('__LOCO_GPLOT', 20, 20));
    expect(penAt(r.mem, 1, 10, 10)).toBe(2);
    expect(bare(1, call1('__LOCO_GPEN', 16)).error).toBe(5);
    expect(bare(1, call1('__LOCO_GPEN', 15)).error).toBeNull();
    expect(bare(1, call1('__LOCO_GPAPER', 16)).error).toBe(5);
  });
  it('mode 0 draws pen 9 (a pen over the mode 1 range is masked) in the screen byte layout', () => {
    const r = bare(0, call1('__LOCO_GPENP', 9) + '\n' + call2('__LOCO_GPLOT', 4, 2));
    expect(penAt(r.mem, 0, 1, 1)).toBe(9);
  });
  it('XPOS and YPOS read the cursor relative to the origin; MOVE and the relative forms move it', () => {
    const r = bare(
      1,
      [
        call2('__LOCO_GORIGIN', 100, 50),
        call2('__LOCO_GMOVE', 10, 20),
        call2('__LOCO_GMOVER', 5, -7),
        ' call .core.__LOCO_GXPOS',
        ' ld (rx),hl',
        ' call .core.__LOCO_GYPOS',
        ' ld (ry),hl',
      ].join('\n'),
      'rx: defw 0\nry: defw 0',
    );
    expect(r.word('rx')).toBe(15);
    expect(r.word('ry')).toBe(13);
  });
  it('ORIGIN moves the drawing and sends the cursor to the origin; MODE sets both back to 0, 0', () => {
    const r = bare(
      1,
      [call2('__LOCO_GMOVE', 70, 70), call2('__LOCO_GORIGIN', 100, 50), ' call .core.__LOCO_GXPOS', ' ld (rx),hl', call2('__LOCO_GPLOT', 20, 20)].join('\n'),
      'rx: defw 99',
    );
    expect(r.word('rx')).toBe(0);
    expect([...litPixels(r.mem, 1, 320)]).toEqual(['60,35']);
    const m = bare(
      1,
      [call2('__LOCO_GORIGIN', 100, 50), ' ld a,1', ' call .core.__LOCO_MODE', call2('__LOCO_GPLOT', 20, 20), ' call .core.__LOCO_GXPOS', ' ld (rx),hl'].join('\n'),
      'rx: defw 99',
    );
    expect([...litPixels(m.mem, 1, 320)]).toEqual(['10,10']);
    expect(m.word('rx')).toBe(20);
  });
  it('DRAW draws between the pixels of its two ends: a horizontal line, a vertical line and a 45 degree line', () => {
    const h = bare(2, call2('__LOCO_GMOVE', 10, 40) + '\n' + call2('__LOCO_GDRAW', 29, 40));
    expect([...litPixels(h.mem, 2, 640)].sort()).toEqual(Array.from({ length: 20 }, (_, i) => `${10 + i},20`).sort());
    const v = bare(2, call2('__LOCO_GMOVE', 5, 10) + '\n' + call2('__LOCO_GDRAW', 5, 30));
    expect([...litPixels(v.mem, 2, 640)].sort()).toEqual(Array.from({ length: 11 }, (_, i) => `5,${5 + i}`).sort());
    const d = bare(1, call2('__LOCO_GMOVE', 0, 0) + '\n' + call2('__LOCO_GDRAWR', 20, 20));
    expect([...litPixels(d.mem, 1, 320)].sort()).toEqual(Array.from({ length: 11 }, (_, i) => `${i},${i}`).sort());
  });
  it('a line leaving the screen is clipped without an error', () => {
    const r = bare(1, call2('__LOCO_GMOVE', 100, 100) + '\n' + call2('__LOCO_GDRAW', 100, 900) + '\n' + call2('__LOCO_GDRAW', -400, 900));
    expect(r.error).toBeNull();
    const lit = litPixels(r.mem, 1, 320);
    expect(lit.has('50,50')).toBe(true);
    expect(lit.has('50,199')).toBe(true);
  });
  it('TEST returns the pen of the pixel and the graphics paper outside the screen, and moves the cursor', () => {
    const r = bare(
      1,
      [
        call1('__LOCO_GPENP', 2),
        call2('__LOCO_GPLOT', 20, 20),
        call1('__LOCO_GPAPER', 3),
        call2('__LOCO_GTEST', 21, 21),
        ' ld (t1),hl',
        call2('__LOCO_GTEST', 22, 20),
        ' ld (t2),hl',
        call2('__LOCO_GTEST', -5, 20),
        ' ld (t3),hl',
        call2('__LOCO_GTESTR', 3, 3),
        ' ld (t4),hl',
        ' call .core.__LOCO_GXPOS',
        ' ld (rx),hl',
      ].join('\n'),
      't1: defw 9\nt2: defw 9\nt3: defw 9\nt4: defw 9\nrx: defw 0',
    );
    expect([r.word('t1'), r.word('t2'), r.word('t3'), r.word('t4'), r.word('rx')]).toEqual([2, 0, 3, 3, 0xfffe]);
  });
  it('CLG clears to the graphics paper and leaves the text cursor; CLG n sets the paper first (n above 15 is error 5)', () => {
    const r = bare(
      1,
      [call2('__LOCO_GPLOT', 20, 20), ' ld hl,(.core.S_POSN)', ' ld (c0),hl', ' ld hl,$0705', ' ld (.core.S_POSN),hl', call1('__LOCO_GCLGP', 3), ' ld hl,(.core.S_POSN)', ' ld (c1),hl'].join('\n'),
      'c0: defw 0\nc1: defw 0',
    );
    for (const [x, y] of [[10, 10], [0, 0], [319, 199], [100, 100]] as const) expect(penAt(r.mem, 1, x, y)).toBe(3);
    expect(r.word('c1')).toBe(0x0705);
    expect(bare(1, call1('__LOCO_GCLGP', 16)).error).toBe(5);
  });
  it('a mode argument other than 0 is error 5 in a bare build (the checker refuses constants; this is the run-time guard)', () => {
    expect(bare(1, call1('__LOCO_GMODE', 0)).error).toBeNull();
    expect(bare(1, call1('__LOCO_GMODE', 1)).error).toBe(5);
  });
});

describe('bare mode: CIRCLE, POINT and INK', () => {
  /** The midpoint circle of radius r about (cx, cy) in pixels: the textbook algorithm's pixel set (8-fold symmetry). */
  const circle = (cx: number, cy: number, r: number): Set<string> => {
    const out = new Set<string>();
    const put = (x: number, y: number): void => void out.add(`${cx + x},${cy + y}`);
    let x = 0;
    let y = r;
    let d = 1 - r;
    const eight = (a: number, b: number): void => {
      for (const [p, q] of [[a, b], [-a, b], [a, -b], [-a, -b], [b, a], [-b, a], [b, -a], [-b, -a]] as const) put(p, q);
    };
    eight(x, y);
    while (x < y) {
      if (d < 0) d += 2 * x + 3;
      else {
        d += 2 * (x - y) + 5;
        y--;
      }
      x++;
      if (x > y) break;
      eight(x, y);
    }
    return out;
  };
  it('CIRCLE draws the pixels of the midpoint circle in the graphics pen (mode 1, radius 20 and 7, one off the screen edge)', () => {
    for (const [cx, cy, r] of [[100, 100, 20], [160, 100, 7], [10, 100, 20]] as const) {
      const run = bare(1, ` ld hl,${cx}\n push hl\n ld hl,${cy}\n push hl\n ld hl,${r}\n push hl\n call .core.__LOCO_GCIRCLE`);
      const want = new Set([...circle(cx, cy, r)].filter((p) => {
        const [x, y] = p.split(',').map(Number) as [number, number];
        return x >= 0 && x < 320 && y >= 0 && y < 200;
      }));
      expect(litPixels(run.mem, 1, 320)).toEqual(want);
    }
  });
  it('CIRCLE with radius 0 plots the centre, with a negative radius nothing', () => {
    const c0 = bare(1, ' ld hl,50\n push hl\n ld hl,60\n push hl\n ld hl,0\n push hl\n call .core.__LOCO_GCIRCLE');
    expect([...litPixels(c0.mem, 1, 320)]).toEqual(['50,60']);
    const cn = bare(1, ' ld hl,50\n push hl\n ld hl,60\n push hl\n ld hl,-3\n push hl\n call .core.__LOCO_GCIRCLE');
    expect(litPixels(cn.mem, 1, 320).size).toBe(0);
  });
  it('POINT reads a mode pixel and leaves the graphics cursor where it was', () => {
    const r = bare(
      1,
      [
        call1('__LOCO_GPENP', 2),
        ' ld hl,30\n push hl\n ld hl,40\n push hl\n ld hl,1\n push hl\n call .core.__LOCO_GCIRCLE',
        call2('__LOCO_GMOVE', 123, 77),
        ' ld hl,31\n push hl\n ld hl,40\n push hl\n call .core.__LOCO_GPOINT',
        ' ld (p1),hl',
        ' ld hl,10\n push hl\n ld hl,10\n push hl\n call .core.__LOCO_GPOINT',
        ' ld (p2),hl',
        ' call .core.__LOCO_GXPOS\n ld (rx),hl',
      ].join('\n'),
      'p1: defw 9\np2: defw 9\nrx: defw 0',
    );
    expect([r.word('p1'), r.word('p2'), r.word('rx')]).toEqual([2, 0, 123]);
  });
  it('INK n, c writes the Gate Array in the first colour; out-of-range arguments are error 5', () => {
    const writes: number[] = [];
    const text = [
      'org 64',
      '.core.CPC_PRIV_BASE EQU 48128',
      '.core.CPC_PRIV_SIZE EQU 1024',
      '.core.CPC_STACK_TOP EQU 48128',
      '.core.CPC_MEM_TOP EQU 49151',
      '#define CPC_BAREMETAL',
      '.core.__START_PROGRAM:',
      ' di',
      ' ld sp,.core.CPC_STACK_TOP',
      ' ld hl,2\n push hl\n ld hl,13\n push hl\n ld hl,20\n push hl\n call .core.__LOCO_INK',
      ' ld hl,3\n push hl\n ld hl,26\n push hl\n call .core.__LOCO_INK1',
      ' rst 0',
      '#include once <loco/inkset.asm>',
    ].join('\n');
    const image = assembleText(text, { files } as never);
    runImage(image.bytes, image.org, image.entry, {
      setup: (cpc: Cpc) => {
        cpc.cpu.onOut = (port: number, value: number) => void writes.push(((port >> 8) << 8) | value);
      },
    } as never);
    // pen select 2, then the first colour only: firmware colour 13 (white) is hardware colour 0, Gate Array byte &40;
    // pen select 3, then firmware colour 26 (bright white) is hardware colour 11, byte &4B (the hardware documentation)
    expect(writes).toEqual([0x7f02, 0x7f40, 0x7f03, 0x7f4b]);
  });
});
