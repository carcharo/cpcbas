/**
 * The runtime library and the fork-compiled hello program on the test Z80 and the fake CPC
 * firmware (L2-Z80SIM): routines go through the real firmware gate (lib/runtime/fwcall.asm).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Cpc, FirmwareContractError, UnhandledFirmwareError } from './cpc.js';
import { assembleAndRun, assembleText, repoRoot, runCpc, runImage, runProgram, wrapProgram } from './run.js';

const s16 = (v: number): number => (v << 16) >> 16;

describe('arith routines under live interrupts', () => {
  const mul = (a: number, b: number): number => {
    const r = runProgram({
      body: ` ld hl,${a & 0xffff}\n ld de,${b & 0xffff}\n call .core.__MUL16_FAST\n ld (resv),hl`,
      data: 'resv: defw 0',
      include: ['arith/mul16.asm'],
    });
    expect(r.stopped).toBe('rst0');
    return r.wordAt('resv');
  };
  it('__MUL16_FAST multiplies HL by DE (low 16 bits)', () => {
    for (const [a, b] of [
      [0, 0],
      [1, 1],
      [7, 6],
      [255, 255],
      [256, 256],
      [300, 200],
      [0xffff, 2],
      [0x8000, 2],
      [12345, 3],
      [-5, 7],
    ]) {
      expect(mul(a, b)).toBe((a * b) & 0xffff);
    }
  });

  const div = (a: number, b: number): { q: number; m: number } => {
    const r = runProgram({
      body: ` ld hl,${a & 0xffff}\n ld de,${b & 0xffff}\n call .core.__DIVI16_FAST\n ld (resv),hl\n ld (resv+2),de`,
      data: 'resv: defw 0,0',
      include: ['arith/div16.asm'],
    });
    expect(r.stopped).toBe('rst0');
    return { q: s16(r.wordAt('resv')), m: s16(r.wordAt('resv', 2)) };
  };
  it('__DIVI16 truncates toward zero; the remainder is |a| mod |b|, never negative', () => {
    // Finding for the code generator: the runtime's signed remainder (DE after __DIVI16_FAST,
    // HL after __MODI16) does not take the dividend's sign, unlike BASIC's MOD (-7 MOD 2 = -1).
    for (const [a, b] of [
      [7, 2],
      [-7, 2],
      [7, -2],
      [-7, -2],
      [100, 10],
      [-100, 10],
      [1, 3],
      [-1, 3],
      [32767, 1],
      [-32767, 1],
      [-32767, -1],
      [12345, -123],
    ]) {
      const q = Math.trunc(a / b) || 0;
      expect(div(a, b), `${a} / ${b}`).toEqual({ q, m: Math.abs(a) % Math.abs(b) });
    }
  });
  it('__DIVU16 and __MODU16 unsigned', () => {
    const r = runProgram({
      body:
        ' ld hl,60000\n ld de,7\n call .core.__DIVU16_FAST\n ld (resv),hl\n ld (resv+2),de\n' +
        ' ld hl,65535\n ld de,256\n call .core.__MODU16\n ld (resv+4),hl',
      data: 'resv: defw 0,0,0',
      include: ['arith/div16.asm'],
    });
    expect([r.wordAt('resv'), r.wordAt('resv', 2), r.wordAt('resv', 4)]).toEqual([8571, 3, 255]);
  });
  it('interrupts fired during the routines (300 Hz through isr.asm and the firmware gate)', () => {
    const r = runProgram({
      body: ' ld b,100\nlp: push bc\n ld hl,30001\n ld de,13\n call .core.__DIVI16_FAST\n pop bc\n djnz lp',
      include: ['arith/div16.asm'],
    });
    expect(r.cpc.interrupts).toBeGreaterThan(5);
    expect(r.stopped).toBe('rst0');
  });
});

describe('printing through the firmware gate', () => {
  it('__PRINTI16 prints -1234 through TXT OUTPUT (and the printer echo)', () => {
    const r = runProgram({
      body: ' ld hl,-1234\n call .core.__PRINTI16',
      include: ['printi16.asm'],
    });
    expect(r.stopped).toBe('rst0');
    expect(r.screen).toBe('-1234');
    expect(r.rows[0]).toBe('-1234');
    expect(r.printer).toBe('-1234\x04END\n');
  });
  it('the gate hands the firmware BC\' = FW_BC with AF\' carry clear and interrupts enabled', () => {
    const r = runProgram({ body: ' ld hl,7\n call .core.__PRINTI16', include: ['printi16.asm'] });
    const txt = r.cpc.calls.filter((c) => c.name === 'TXT OUTPUT');
    expect(txt.length).toBe(1);
    for (const c of r.cpc.calls) {
      expect(c.bc2 >> 8, c.name).toBe(0x7f);
      expect(c.af2 & 1, c.name).toBe(0);
      expect(c.iff1, c.name).toBe(true);
    }
    // the bootstrap set mode 1 through the gate, then flushed the key buffer
    expect(r.cpc.calls[0].name).toBe('SCR SET MODE');
    expect(r.cpc.calls[1].name).toBe('KM READ CHAR');
  });
  it('an unhandled firmware address fails the test with its address', () => {
    const asm = wrapProgram({ body: ' call .core.__FW_CALL\n defw 0xbc02', include: ['fwcall.asm'] });
    expect(() => assembleAndRun(asm)).toThrow(UnhandledFirmwareError);
    expect(() => assembleAndRun(asm)).toThrow(/unhandled firmware address &BC02/);
  });
  it('an END without the printer echo waits for a key (the run stops as "waitkey")', () => {
    const asm = wrapProgram({ body: ' nop' });
    expect(assembleAndRun(asm).stopped).toBe('waitkey');
    expect(assembleAndRun(asm, { defines: { __CPC_PRINTER_ECHO__: '1' } }).stopped).toBe('rst0');
  });
  it('keys typed ahead survive the bootstrap flush and are seen by a later poll', () => {
    const r = runProgram(
      {
        body: ' call .core.__FW_CALL\n defw 0xbb09\n ld (resv),a\n',
        data: 'resv: defb 0',
      },
      { keys: 'x' },
    );
    expect(r.byteAt('resv')).toBe(0x78);
  });
});

describe('the fake firmware', () => {
  /** Calls entries directly (no gate) on a bare CPC; the program is a string of asm lines. */
  const direct = (code: string, data = ''): ReturnType<typeof assembleAndRun> =>
    assembleAndRun(`org 0x8000\nstart:\n${code}\n rst 0\n${data}\n`, { entryLabel: 'start' });

  it('TXT OUTPUT called through the jumpblock: characters, CR LF, locate and cursor left', () => {
    const r = direct(
      ' ld hl,msg\nlp: ld a,(hl)\n or a\n jr z,done\n call 0xbb5a\n inc hl\n jr lp\ndone:',
      'msg: defb 0x41,0x42,13,10,0x43,0x44,31,3,2,0x58,8,8,0x59,0',
    );
    expect(r.rows[0]).toBe('AB');
    expect(r.rows[1]).toBe('CYX');
    expect(r.screen.length).toBe(13);
  });
  it('wraps at 40 columns in mode 1 and rolls the window at the bottom', () => {
    const cpc = new Cpc();
    const put = (s: string): void => [...s].forEach((c) => cpc.textOutput(c.charCodeAt(0)));
    put('x'.repeat(41));
    expect(cpc.rows[0]).toBe('x'.repeat(40));
    expect(cpc.rows[1]).toBe('x');
    expect(cpc.cursor).toEqual({ col: 2, row: 2 });
    put('\x0c');
    for (let i = 0; i < 25; i++) put(`L${i}\r\n`);
    expect(cpc.rows[0]).toBe('L1');
    expect(cpc.rows[23]).toBe('L24');
    expect(cpc.rows[24]).toBe('');
    // locate (31, col, row), 1-based logical, and home (30)
    put('\x1f\x05\x03AT');
    expect(cpc.rows[2]).toBe('L3  AT');
  });
  it('mode 0 is 20 columns, mode 2 is 80', () => {
    const cpc = new Cpc();
    const put = (s: string): void => [...s].forEach((c) => cpc.textOutput(c.charCodeAt(0)));
    put('\x04\x00' + 'y'.repeat(21));
    expect(cpc.rows[0]).toBe('y'.repeat(20));
    expect(cpc.mode).toBe(0);
    put('\x04\x02' + 'z'.repeat(81));
    expect(cpc.rows[0]).toBe('z'.repeat(80));
    expect(cpc.rows[1]).toBe('z');
    expect(cpc.cpu.bc2 & 3).toBe(2); // the mode lives in C' as the gate captures it
  });
  it('TXT SET CURSOR / GET CURSOR use H = column, L = row, 1-based logical', () => {
    const r = direct(
      ' ld hl,0x0a05\n call 0xbb75\n ld a,0x4b\n call 0xbb5a\n call 0xbb78\n ld (cur),hl\n',
      'cur: defw 0',
    );
    // H is the column, L the row: LD (cur),HL stores the row first
    expect([r.byteAt('cur', 1), r.byteAt('cur')]).toEqual([11, 5]); // column after the K, row
    expect(r.wordAt('cur')).toBe((11 << 8) | 5);
    expect(r.rows[4]).toBe(' '.repeat(9) + 'K');
  });
  it('TXT GET WINDOW, window control code 26 and TXT CLEAR WINDOW', () => {
    const cpc = new Cpc();
    const put = (s: string): void => [...s].forEach((c) => cpc.textOutput(c.charCodeAt(0)));
    put('\x1a\x05\x0a\x03\x08\x1e'); // window cols 5..10, rows 3..8, then home
    put('hello world, this wraps');
    expect(cpc.rows.slice(2, 6)).toEqual(['    hello', '    world,', '     this', '    wraps']);
    expect(cpc.cursor).toEqual({ col: 6, row: 4 });
    put('\x0c');
    expect(cpc.rows.slice(2, 6)).toEqual(['', '', '', '']);
    expect(cpc.cursor).toEqual({ col: 1, row: 1 });
  });
  it('KM READ CHAR returns queued keys with carry, none with carry clear; WAIT KEY blocks the run', () => {
    const r = assembleAndRun('org 0x8000\nstart: call 0xbb09\n ld b,0\n jr nc,none\n inc b\nnone: ld c,a\n rst 0\n', {
      entryLabel: 'start',
      setup: (cpc) => cpc.keyQueue.push(0x41),
    });
    expect([r.cpu.b, r.cpu.c]).toEqual([1, 0x41]);
    const r2 = assembleAndRun('org 0x8000\nstart: call 0xbb09\n ld b,0\n jr nc,none\n inc b\nnone: rst 0\n', {
      entryLabel: 'start',
    });
    expect(r2.cpu.b).toBe(0);
    const r3 = assembleAndRun('org 0x8000\nstart: call 0xbb18\n rst 0\n', { entryLabel: 'start' });
    expect(r3.stopped).toBe('waitkey');
  });
  it('MC PRINT CHAR appends to the printer transcript with carry set and BC, HL kept', () => {
    const r = direct(' ld bc,0x1234\n ld hl,0x5678\n ld a,0x50\n call 0xbd2b\n ld a,0\n rla', '');
    expect(r.printer).toBe('P');
    expect(r.cpu.a & 1).toBe(1);
    expect([r.cpu.bc, r.cpu.hl]).toEqual([0x1234, 0x5678]);
  });
  it('registers the guide calls corrupt really are corrupted; the preserved ones are not', () => {
    const r = direct(' ld bc,0x1111\n ld de,0x2222\n ld hl,0x3333\n ld a,3\n call 0xbb90\n', '');
    expect([r.cpu.bc, r.cpu.de]).toEqual([0x1111, 0x2222]);
    expect(r.cpu.hl).not.toBe(0x3333);
    const quiet = assembleAndRun(
      'org 0x8000\nstart: ld bc,0x1111\n ld de,0x2222\n ld hl,0x3333\n ld a,3\n call 0xbb90\n rst 0\n',
      { entryLabel: 'start', corruptRegisters: false },
    );
    expect(quiet.cpu.hl).toBe(0x3333);
  });
  it('MC WAIT FLYBACK advances to the next 50 Hz frame; KL TIME PLEASE reads 300 Hz ticks', () => {
    const r = direct(' call 0xbd19\n call 0xbd19\n call 0xbd0d', '');
    expect(r.tstates).toBeGreaterThanOrEqual(160000);
    expect(r.tstates).toBeLessThan(160200);
    expect(r.cpu.hl).toBe(Math.floor(160000 / 13333));
  });
  it('SCR SET BORDER / GET INK / SET INK', () => {
    const r = direct(' ld bc,0x0a0b\n call 0xbc38\n ld a,1\n call 0xbc35\n ld (ink),bc', 'ink: defw 0');
    expect(r.cpc.border).toEqual([10, 11]);
    expect(r.wordAt('ink')).toBe((24 << 8) | 24);
  });
});

describe('the fork-compiled hello program (tests/e2e/hello.asm, printer echo build)', () => {
  const asmText = readFileSync(join(repoRoot, 'tests/e2e/hello.asm'), 'latin1');
  const expected = readFileSync(join(repoRoot, 'tests/e2e/hello.expected'), 'latin1');
  const image = assembleText(asmText, { path: 'tests/e2e/hello.asm', defines: { __CPC_PRINTER_ECHO__: '1' } });
  it('captures "Hello CPC" through TXT OUTPUT and prints hello.expected on the fake printer', () => {
    const cpc = new Cpc();
    cpc.cpu.load(image.bytes, image.org);
    cpc.cpu.pc = image.entry;
    cpc.cpu.sp = 0xb800;
    const r = runCpc(cpc);
    expect(r.stopped).toBe('rst0');
    expect(r.screen.startsWith('Hello CPC')).toBe(true);
    expect(r.screen).toBe('Hello CPC\r\n1\r\n2\r\n3\r\n4\r\n5\r\n');
    expect(r.rows.slice(0, 6)).toEqual(['Hello CPC', '1', '2', '3', '4', '5']);
    // the printer gets the echo, then the END marker line the harness strips
    expect(r.printer.endsWith('\x04END\n')).toBe(true);
    expect(r.printer.slice(0, -'\x04END\n'.length)).toBe(expected);
  });
  it('is deterministic: two runs give identical transcripts and T-state counts', () => {
    const go = (): { printer: string; t: number; n: number } => {
      const cpc = new Cpc();
      cpc.cpu.load(image.bytes, image.org);
      cpc.cpu.pc = image.entry;
      cpc.cpu.sp = 0xb800;
      const r = runCpc(cpc);
      return { printer: r.printer, t: r.tstates, n: r.instructions };
    };
    expect(go()).toEqual(go());
  });
});

describe('simulator speed', () => {
  it('runs about a million instructions in well under a few seconds', () => {
    // Outer loop of 16 passes over the 65536-pass inner loop: about 4.2 million instructions.
    const image = assembleText(
      'org 0x8000\nstart: ld e,16\nouter: ld bc,0\nlp: dec bc\n ld a,b\n or c\n jr nz,lp\n dec e\n jr nz,outer\n rst 0\n',
      { entryLabel: 'start' },
    );
    const t0 = performance.now();
    const r = runImage(image.bytes, image.org, image.entry, { maxTStates: 500_000_000, irqInterval: 0 });
    const secs = (performance.now() - t0) / 1000;
    expect(r.stopped).toBe('rst0');
    expect(r.instructions).toBeGreaterThan(4_000_000);
    process.stderr.write(`z80sim speed: ${(r.instructions / secs / 1e6).toFixed(1)} M instructions/s\n`);
    expect(secs).toBeLessThan(10);
  });
});

void FirmwareContractError;
