/** Instruction-level tests of the test Z80 (L2-Z80SIM): hand-checked results, flags and T-states. */
import { describe, expect, it } from 'vitest';
import { Cpc } from './cpc.js';
import { assembleAndRun } from './run.js';
import type { AssembledRun } from './run.js';

/** Flags without the undocumented bits 3 and 5. */
const F = (run: AssembledRun): number => run.cpu.f & 0xd7;
const S = 0x80;
const Z = 0x40;
const H = 0x10;
const PV = 0x04;
const N = 0x02;
const C = 0x01;

/** Assembles `code` at &8000 followed by RST 0 and runs it. */
function go(code: string, data = '', opts: Parameters<typeof assembleAndRun>[1] = {}): AssembledRun {
  const run = assembleAndRun(`org 0x8000\nstart:\n${code}\n rst 0\n${data}\n`, { entryLabel: 'start', ...opts });
  expect(run.stopped).toBe('rst0');
  return run;
}

describe('8-bit arithmetic and flags', () => {
  it('ADD A: signed overflow, half carry, carry', () => {
    let r = go(' ld a,0x7f\n add a,1');
    expect([r.cpu.a, F(r)]).toEqual([0x80, S | H | PV]);
    r = go(' ld a,0xff\n add a,1');
    expect([r.cpu.a, F(r)]).toEqual([0, Z | H | C]);
    r = go(' ld a,0x80\n add a,0x80');
    expect([r.cpu.a, F(r)]).toEqual([0, Z | PV | C]);
  });
  it('ADC A uses the carry', () => {
    const r = go(' ld a,0xff\n scf\n adc a,0');
    expect([r.cpu.a, F(r)]).toEqual([0, Z | H | C]);
    const r2 = go(' ld a,0x0e\n scf\n adc a,1');
    expect([r2.cpu.a, F(r2)]).toEqual([0x10, H]);
  });
  it('SUB, SBC and CP', () => {
    let r = go(' ld a,0x80\n sub 1');
    expect([r.cpu.a, F(r)]).toEqual([0x7f, H | PV | N]);
    r = go(' ld a,0\n sub 1');
    expect([r.cpu.a, F(r)]).toEqual([0xff, S | H | N | C]);
    r = go(' ld a,5\n scf\n sbc a,5');
    expect([r.cpu.a, F(r)]).toEqual([0xff, S | H | N | C]);
    r = go(' ld a,0x40\n cp 0x40');
    expect([r.cpu.a, F(r)]).toEqual([0x40, Z | N]);
    r = go(' ld a,0x10\n cp 0x20');
    expect([r.cpu.a, F(r)]).toEqual([0x10, S | N | C]);
  });
  it('AND OR XOR set parity and half carry as documented', () => {
    let r = go(' ld a,0xf0\n and 0x3c');
    expect([r.cpu.a, F(r)]).toEqual([0x30, H | PV]);
    r = go(' ld a,0xf0\n or 0x01');
    expect([r.cpu.a, F(r)]).toEqual([0xf1, S]);
    r = go(' ld a,0x55\n xor 0x55');
    expect([r.cpu.a, F(r)]).toEqual([0, Z | PV]);
  });
  it('INC and DEC keep carry and flag half carry and overflow', () => {
    let r = go(' ld a,0x7f\n scf\n inc a');
    expect([r.cpu.a, F(r)]).toEqual([0x80, S | H | PV | C]);
    r = go(' ld a,0x80\n dec a');
    expect([r.cpu.a, F(r)]).toEqual([0x7f, H | PV | N]);
    r = go(' ld b,0xff\n inc b');
    expect([r.cpu.b, F(r)]).toEqual([0, Z | H]);
  });
  it('NEG', () => {
    let r = go(' ld a,0x80\n neg');
    expect([r.cpu.a, F(r)]).toEqual([0x80, S | PV | N | C]);
    r = go(' ld a,1\n neg');
    expect([r.cpu.a, F(r)]).toEqual([0xff, S | H | N | C]);
    r = go(' xor a\n neg');
    expect([r.cpu.a, F(r)]).toEqual([0, Z | N]);
  });
  it('CPL SCF CCF', () => {
    let r = go(' ld a,0x0f\n cpl');
    expect([r.cpu.a, F(r) & (H | N)]).toEqual([0xf0, H | N]);
    r = go(' or a\n scf');
    expect(F(r) & (C | H | N)).toBe(C);
    r = go(' scf\n ccf');
    expect(F(r) & (C | H)).toBe(H);
  });
});

describe('DAA', () => {
  it('after addition', () => {
    let r = go(' ld a,0x15\n add a,0x27\n daa');
    expect([r.cpu.a, F(r) & C]).toEqual([0x42, 0]);
    r = go(' ld a,0x99\n add a,1\n daa');
    expect([r.cpu.a, F(r)]).toEqual([0, Z | H | PV | C]);
    r = go(' ld a,0x50\n add a,0x60\n daa');
    expect([r.cpu.a, F(r) & C]).toEqual([0x10, C]);
  });
  it('after subtraction', () => {
    let r = go(' ld a,0x42\n sub 0x15\n daa');
    expect([r.cpu.a, F(r) & (N | C)]).toEqual([0x27, N]);
    r = go(' ld a,0x10\n sub 0x20\n daa');
    expect([r.cpu.a, F(r) & C]).toEqual([0x90, C]);
  });
});

describe('16-bit arithmetic', () => {
  it('ADD HL,rr keeps S Z PV and sets H from bit 11', () => {
    const r = go(' ld hl,0x0fff\n ld bc,1\n xor a\n add hl,bc');
    expect([r.cpu.hl, F(r)]).toEqual([0x1000, Z | PV | H]);
    const r2 = go(' ld hl,0xffff\n ld de,1\n add hl,de');
    expect(r2.cpu.hl).toBe(0);
    expect(F(r2) & (C | H)).toBe(C | H);
  });
  it('ADC HL', () => {
    let r = go(' ld hl,0x7fff\n ld bc,1\n or a\n adc hl,bc');
    expect([r.cpu.hl, F(r)]).toEqual([0x8000, S | H | PV]);
    r = go(' ld hl,0x8000\n scf\n adc hl,hl');
    expect([r.cpu.hl, F(r)]).toEqual([1, PV | C]);
    r = go(' ld hl,0xffff\n ld de,0\n scf\n adc hl,de');
    expect([r.cpu.hl, F(r)]).toEqual([0, Z | H | C]);
  });
  it('SBC HL', () => {
    let r = go(' ld hl,0x8000\n ld de,1\n or a\n sbc hl,de');
    expect([r.cpu.hl, F(r)]).toEqual([0x7fff, H | PV | N]);
    r = go(' ld hl,5\n ld de,5\n or a\n sbc hl,de');
    expect([r.cpu.hl, F(r)]).toEqual([0, Z | N]);
    r = go(' ld hl,0\n ld de,1\n or a\n sbc hl,de');
    expect([r.cpu.hl, F(r)]).toEqual([0xffff, S | H | N | C]);
    r = go(' ld hl,10\n ld bc,3\n scf\n sbc hl,bc');
    expect([r.cpu.hl, F(r)]).toEqual([6, N]);
  });
  it('INC and DEC rr do not touch flags', () => {
    const r = go(' ld bc,0xffff\n ld a,0\n cp 1\n inc bc\n dec de\n inc sp\n dec sp');
    expect(r.cpu.bc).toBe(0);
    expect(r.cpu.de).toBe(0xffff);
    expect(F(r)).toBe(S | H | N | C);
  });
});

describe('rotates, shifts and bits', () => {
  it('accumulator rotates change only H N C (and Y X)', () => {
    let r = go(' ld a,0x81\n rlca');
    expect([r.cpu.a, F(r) & (C | H | N)]).toEqual([0x03, C]);
    r = go(' ld a,0x81\n rrca');
    expect([r.cpu.a, F(r) & C]).toEqual([0xc0, C]);
    r = go(' ld a,0x80\n scf\n rla');
    expect([r.cpu.a, F(r) & C]).toEqual([0x01, C]);
    r = go(' ld a,0x01\n or a\n rra');
    expect([r.cpu.a, F(r) & C]).toEqual([0, C]);
  });
  it('CB rotates and shifts set S Z P and the carry', () => {
    let r = go(' ld b,0x80\n rlc b');
    expect([r.cpu.b, F(r)]).toEqual([0x01, C]);
    r = go(' ld c,0x01\n rrc c');
    expect([r.cpu.c, F(r)]).toEqual([0x80, S | C]);
    r = go(' ld d,0x80\n or a\n rl d');
    expect([r.cpu.d, F(r)]).toEqual([0, Z | PV | C]);
    r = go(' ld e,0x01\n scf\n rr e');
    expect([r.cpu.e, F(r)]).toEqual([0x80, S | C]);
    r = go(' ld h,0x81\n sla h');
    expect([r.cpu.h, F(r)]).toEqual([0x02, C]);
    r = go(' ld l,0x81\n sra l');
    expect([r.cpu.l, F(r)]).toEqual([0xc0, S | PV | C]);
    r = go(' ld a,0x81\n srl a');
    expect([r.cpu.a, F(r)]).toEqual([0x40, C]);
  });
  it('SLL (undocumented, used by the divide routines) shifts a 1 in', () => {
    const r = go(' ld c,0x80\n sll c');
    expect([r.cpu.c, F(r)]).toEqual([0x01, C]);
    const r2 = go(' ld a,0x41\n or a\n sll a');
    expect([r2.cpu.a, F(r2)]).toEqual([0x83, S]);
  });
  it('BIT SET RES on registers and (HL)', () => {
    let r = go(' ld a,0x10\n bit 4,a');
    expect(F(r)).toBe(H);
    r = go(' ld a,0x10\n bit 3,a');
    expect(F(r)).toBe(Z | H | PV);
    r = go(' ld b,0x80\n bit 7,b');
    expect(F(r)).toBe(S | H);
    r = go(' ld c,0\n set 5,c\n set 0,c\n res 0,c');
    expect(r.cpu.c).toBe(0x20);
    r = go(' ld hl,buf\n set 7,(hl)\n res 1,(hl)\n bit 7,(hl)', 'buf: defb 0x03');
    expect(r.byteAt('buf')).toBe(0x81);
    expect(F(r)).toBe(S | H);
  });
  it('BIT SET RES and rotates with (IX+d) and (IY+d)', () => {
    const r = go(
      ' ld ix,buf\n ld iy,buf+4\n set 3,(ix+2)\n res 0,(ix+2)\n bit 3,(ix+2)\n' +
        ' rlc (iy-1)\n srl (ix+0)\n sll (iy+0)',
      'buf: defb 0x80,0,0x01,0,0x20',
    );
    expect(r.byteAt('buf', 2)).toBe(0x08);
    expect(r.byteAt('buf', 3)).toBe(0x00);
    expect(r.byteAt('buf', 0)).toBe(0x40);
    expect(r.byteAt('buf', 4)).toBe(0x41);
  });
  it('DDCB with a register operand also copies the result (undocumented)', () => {
    const r = go(' ld ix,buf\n defb 0xdd,0xcb,0,0x00', 'buf: defb 0x81');
    expect(r.byteAt('buf')).toBe(0x03);
    expect(r.cpu.b).toBe(0x03);
  });
  it('RLD and RRD', () => {
    let r = go(' ld hl,buf\n ld a,0x7a\n rld', 'buf: defb 0x31');
    expect([r.cpu.a, r.byteAt('buf')]).toEqual([0x73, 0x1a]);
    r = go(' ld hl,buf\n ld a,0x84\n rrd', 'buf: defb 0x20');
    expect([r.cpu.a, r.byteAt('buf')]).toEqual([0x80, 0x42]);
  });
});

describe('loads and the register banks', () => {
  it('LD forms, including (nn), (BC), (DE) and LD SP,HL', () => {
    const r = go(
      ' ld hl,0x1234\n ld (v),hl\n ld a,(v+1)\n ld bc,v\n ld (bc),a\n ld de,w\n ld a,0x77\n ld (de),a\n' +
        ' ld de,(v)\n ld (w2),bc\n ld sp,hl\n ld (v3),sp',
      'v: defw 0\nw: defb 0\nw2: defw 0\nv3: defw 0',
    );
    expect(r.wordAt('v')).toBe(0x1212);
    expect(r.byteAt('w')).toBe(0x77);
    expect(r.cpu.de).toBe(0x1212);
    expect(r.wordAt('w2')).toBe(r.image.addr('v'));
    expect(r.wordAt('v3')).toBe(0x1234);
  });
  it('EX DE,HL; EX AF,AF\'; EXX; EX (SP),HL', () => {
    const r = go(
      ' ld hl,0x1111\n ld de,0x2222\n ex de,hl\n' +
        " ld a,5\n scf\n ex af,af'\n ld a,9\n or a\n ex af,af'\n" +
        ' ld bc,0x0a0b\n exx\n ld bc,0x0c0d\n ld hl,0x3333\n exx\n' +
        ' push hl\n ld hl,0x4444\n ex (sp),hl',
    );
    expect([r.cpu.de, r.cpu.hl]).toEqual([0x1111, 0x2222]);
    expect([r.cpu.a, r.cpu.f & C]).toEqual([5, C]);
    expect(r.cpu.af2 >> 8).toBe(9);
    expect(r.cpu.bc).toBe(0x0a0b);
    expect(r.cpu.bc2).toBe(0x0c0d);
    expect(r.cpu.hl2).toBe(0x3333);
  });
  it('PUSH AF / POP BC round trip keeps the flags byte', () => {
    const r = go(' ld a,0x5a\n scf\n push af\n pop bc\n ld a,0x80\n add a,0x80\n pop_done:\n');
    expect(r.cpu.b).toBe(0x5a);
    expect(r.cpu.c & C).toBe(C);
    const r2 = go(' ld a,0x12\n cp 0x13\n push af\n xor a\n pop af');
    expect([r2.cpu.a, F(r2)]).toEqual([0x12, S | H | N | C]);
  });
});

describe('index registers', () => {
  it('(IX+d) and (IY+d) with negative and positive displacements', () => {
    const r = go(
      ' ld ix,buf+2\n ld iy,buf+2\n ld (ix-2),0x11\n ld a,0x22\n ld (iy+1),a\n ld b,(ix-2)\n ld c,(iy+1)\n' +
        ' inc (ix+0)\n dec (iy+2)\n add a,(ix+1)\n',
      'buf: defb 0,0,5,0,7',
    );
    expect([r.byteAt('buf'), r.byteAt('buf', 3), r.byteAt('buf', 2), r.byteAt('buf', 4)]).toEqual([0x11, 0x22, 6, 6]);
    expect([r.cpu.b, r.cpu.c, r.cpu.a]).toEqual([0x11, 0x22, 0x44]);
  });
  it('IXH IXL IYH IYL (undocumented halves)', () => {
    const r = go(' ld ix,0x1234\n ld a,ixh\n ld b,ixl\n ld ixh,0x56\n ld iyl,0x78\n inc ixl\n ld c,iyl\n add a,ixh');
    expect([r.cpu.a, r.cpu.b, r.cpu.ix, r.cpu.iy & 0xff, r.cpu.c]).toEqual([0x12 + 0x56, 0x34, 0x5635, 0x78, 0x78]);
  });
  it('ADD IX,rr; INC/DEC IX; LD IX,(nn); PUSH/POP IX; EX (SP),IX; JP (IX); LD SP,IY', () => {
    const r = go(
      ' ld ix,0x1000\n ld bc,0x0234\n add ix,bc\n add ix,ix\n inc ix\n dec iy\n ld iy,(v)\n ld (w),ix\n' +
        ' push ix\n pop de\n ld ix,there\n jp (ix)\n halt\nthere:\n ld ix,0x5555\n push iy\n ex (sp),ix\n pop iy\n ld sp,iy\n ld sp,0xb800',
      'v: defw 0xbeef\nw: defw 0',
    );
    expect(r.wordAt('w')).toBe((0x1234 * 2 + 1) & 0xffff);
    expect(r.cpu.de).toBe(0x2469);
    expect(r.cpu.ix).toBe(0xbeef);
    expect(r.cpu.iy).toBe(0x5555);
  });
});

describe('control flow', () => {
  it('DJNZ counts, JR cc, JP cc, CALL cc, RET cc', () => {
    const r = go(
      ' ld b,5\n xor a\nl1: inc a\n djnz l1\n ld c,a\n' +
        ' or a\n jr z,bad\n jr nz,ok1\nbad: ld c,0xff\nok1:\n' +
        ' scf\n call c,sub1\n call nc,bad2\n jp po,bad2\n jp pe,fin\nbad2: ld c,0xee\nfin:\n jr over\nsub1: ld d,0x42\n ret nc\n ld e,0x99\n ret c\n ld e,0\n ret\nover:',
    );
    expect(r.cpu.c).toBe(5);
    expect([r.cpu.d, r.cpu.e]).toEqual([0x42, 0x99]);
  });
  it('RST n, CALL/RET, JP (HL) and the stack', () => {
    const r = go(
      ' ld sp,0x9000\n call fn\n ld a,1\n jp done\nfn: pop hl\n push hl\n ld b,h\n ld c,l\n ret\ndone: ld hl,done2\n jp (hl)\n nop\ndone2:',
    );
    expect(r.cpu.bc).toBe(r.image.addr('start') + 6);
    expect(r.cpu.sp).toBe(0x9000 - 2); // rst 0 pushed its return address
  });
  it('EI/DI/IM state, HALT with interrupts off stops the run', () => {
    let r = go(' im 2\n ei');
    expect([r.cpu.im, r.cpu.iff1, r.cpu.iff2]).toEqual([2, true, true]);
    r = go(' ei\n di\n im 1');
    expect([r.cpu.im, r.cpu.iff1]).toEqual([1, false]);
    const h = assembleAndRun('org 0x8000\nstart: di\n halt\n', { entryLabel: 'start' });
    expect(h.stopped).toBe('halt');
  });
});

describe('block instructions', () => {
  it('LDIR copies and leaves BC=0, PV clear', () => {
    const r = go(' ld hl,src\n ld de,dst\n ld bc,5\n ldir', 'src: defb 1,2,3,4,5\ndst: defs 6');
    for (let i = 0; i < 5; i++) expect(r.byteAt('dst', i)).toBe(i + 1);
    expect(r.byteAt('dst', 5)).toBe(0);
    expect([r.cpu.bc, F(r) & (PV | H | N)]).toEqual([0, 0]);
    expect(r.cpu.hl).toBe(r.image.addr('src') + 5);
  });
  it('LDIR with overlap fills (the runtime zero-fill idiom)', () => {
    const r = go(' ld hl,dst\n ld (hl),0xaa\n ld de,dst+1\n ld bc,7\n ldir', 'dst: defs 9');
    for (let i = 0; i < 8; i++) expect(r.byteAt('dst', i)).toBe(0xaa);
    expect(r.byteAt('dst', 8)).toBe(0);
  });
  it('LDDR, LDI and LDD', () => {
    let r = go(' ld hl,src+4\n ld de,dst+4\n ld bc,5\n lddr', 'src: defb 1,2,3,4,5\ndst: defs 5');
    expect([r.byteAt('dst'), r.byteAt('dst', 4)]).toEqual([1, 5]);
    r = go(' ld hl,src\n ld de,dst\n ld bc,2\n ldi', 'src: defb 7,8\ndst: defs 2');
    expect([r.byteAt('dst'), r.cpu.bc, F(r) & PV]).toEqual([7, 1, PV]);
    r = go(' ld hl,src+1\n ld de,dst+1\n ld bc,1\n ldd', 'src: defb 7,8\ndst: defs 2');
    expect([r.byteAt('dst', 1), r.cpu.bc, F(r) & PV]).toEqual([8, 0, 0]);
  });
  it('CPIR finds a byte; CPDR; CPI flags', () => {
    let r = go(' ld hl,s\n ld bc,10\n ld a,0x33\n cpir', 's: defb 1,2,0x33,4,5');
    expect(r.cpu.hl).toBe(r.image.addr('s') + 3);
    expect([r.cpu.bc, F(r) & (Z | PV | N)]).toEqual([7, Z | PV | N]);
    r = go(' ld hl,s\n ld bc,3\n ld a,0x99\n cpir', 's: defb 1,2,3,4');
    expect([r.cpu.bc, F(r) & (Z | PV)]).toEqual([0, 0]);
    r = go(' ld hl,s+4\n ld bc,10\n ld a,2\n cpdr', 's: defb 1,2,3,4,5');
    expect(r.cpu.hl).toBe(r.image.addr('s') + 0);
    expect(F(r) & Z).toBe(Z);
    r = go(' ld hl,s\n ld bc,1\n ld a,5\n cpi', 's: defb 3');
    expect(F(r)).toBe(N);
  });
  it('INIR / OTIR use the port callbacks', () => {
    const outs: [number, number][] = [];
    const r = assembleAndRun(
      'org 0x8000\nstart: ld hl,buf\n ld bc,0x0300\n inir\n ld hl,outb\n ld b,2\n ld c,0x20\n otir\n rst 0\nbuf: defs 3\noutb: defb 0xa5,0x5a',
      {
        entryLabel: 'start',
        setup: (cpc) => {
          let n = 0;
          cpc.cpu.onIn = () => ++n;
          cpc.cpu.onOut = (port, v) => outs.push([port, v]);
        },
      },
    );
    expect([r.byteAt('buf'), r.byteAt('buf', 1), r.byteAt('buf', 2)]).toEqual([1, 2, 3]);
    expect(outs).toEqual([
      [0x0120, 0xa5],
      [0x0020, 0x5a],
    ]);
  });
});

describe('I/O', () => {
  it('IN returns &FF by default; IN r,(C) sets the flags; OUT (n),A reaches the callback', () => {
    const outs: [number, number][] = [];
    const r = assembleAndRun(
      'org 0x8000\nstart: ld bc,0x7f10\n in a,(c)\n ld d,a\n in a,(0x55)\n ld a,0x42\n out (0x99),a\n ld b,0x7f\n ld c,0\n out (c),a\n rst 0',
      { entryLabel: 'start', setup: (cpc) => (cpc.cpu.onOut = (p, v) => outs.push([p, v])) },
    );
    expect([r.cpu.d, r.cpu.a]).toEqual([0xff, 0x42]);
    expect(outs).toEqual([
      [0x4299, 0x42],
      [0x7f00, 0x42],
    ]);
  });
});

describe('timing', () => {
  it('counts published T-states', () => {
    // LD A,n 7 + NOP 4 + LD HL,nn 10 + RST 11 = 32
    expect(go(' ld a,1\n nop\n ld hl,0x1234').tstates).toBe(32);
    // LD HL,nn LD DE,nn LD BC,nn = 30, LDIR 3 bytes = 21+21+16 = 58, RST 11
    expect(go(' ld hl,s\n ld de,dd\n ld bc,3\n ldir', 's: defs 3\ndd: defs 3').tstates).toBe(30 + 58 + 11);
    // DJNZ x3 = 13+13+8 plus LD B,n 7
    expect(go(' ld b,3\nlp: djnz lp').tstates).toBe(7 + 34 + 11);
    // (IX+d) forms: LD A,(IX+d) 19, INC (IX+d) 23, LD (IX+d),n 19, BIT 3,(IX+d) 20, SET 23, ADD IX,BC 15
    expect(go(' ld a,(ix+1)').tstates).toBe(19 + 11);
    expect(go(' inc (ix+1)').tstates).toBe(23 + 11);
    expect(go(' ld (ix+1),5').tstates).toBe(19 + 11);
    expect(go(' bit 3,(ix+1)').tstates).toBe(20 + 11);
    expect(go(' set 3,(ix+1)').tstates).toBe(23 + 11);
    expect(go(' add ix,bc').tstates).toBe(15 + 11);
    // ED forms and CB forms: ADC HL,BC 15, SBC 15, LD (nn),BC 20, RLC B 8, RLC (HL) 15, BIT 0,(HL) 12, NEG 8
    expect(go(' adc hl,bc').tstates).toBe(15 + 11);
    expect(go(' ld (0x9000),bc').tstates).toBe(20 + 11);
    expect(go(' rlc b').tstates).toBe(8 + 11);
    expect(go(' rlc (hl)').tstates).toBe(15 + 11);
    expect(go(' bit 0,(hl)').tstates).toBe(12 + 11);
    expect(go(' neg').tstates).toBe(8 + 11);
    // PUSH 11, POP 10, CALL 17 + RET 10, EX (SP),HL 19, JR taken 12 / not taken 7
    expect(go(' push bc\n pop bc').tstates).toBe(21 + 11);
    expect(go(' call fn\n jr over\nfn: ret\nover:').tstates).toBe(17 + 10 + 12 + 11);
    expect(go(' or a\n jr c,lp\nlp:').tstates).toBe(4 + 7 + 11);
  });
});

describe('interrupts', () => {
  it('EI;HALT wakes on each 300 Hz interrupt through the RAM vector at &0038', () => {
    const r = go(' ei\n halt\n halt\n halt\n di');
    expect(r.cpc.interrupts).toBe(3);
    expect(r.tstates).toBeGreaterThanOrEqual(3 * 13333);
    expect(r.tstates).toBeLessThan(3 * 13333 + 200);
  });
  it('is not taken while interrupts are disabled, and not between EI and the next instruction', () => {
    const r = go(' di\n ld b,200\nlp: djnz lp\n ld bc,0\n ld hl,0\n xor a');
    expect(r.cpc.interrupts).toBe(0);
    const r2 = assembleAndRun('org 0x8000\nstart: ei\n ld a,1\n rst 0\n', { entryLabel: 'start', irqInterval: 5 });
    expect(r2.cpu.a).toBe(1);
  });
  it('fails when the firmware handler is entered with the wrong BC\' or AF\' carry', () => {
    expect(() => go(' ei\n halt\n', '', { firmwareBc: 0x0000 })).toThrow(/B' = &0, not &7F/);
    expect(() => go(" ld a,1\n scf\n ex af,af'\n ei\n halt\n")).toThrow(/AF' carry set/);
  });
});

describe('determinism', () => {
  it('two runs give identical transcripts and T-state counts', () => {
    const code = ' ei\n ld b,100\nlp: halt\n djnz lp\n di';
    const a = go(code);
    const b = go(code);
    expect([a.tstates, a.instructions, a.cpc.interrupts]).toEqual([b.tstates, b.instructions, b.cpc.interrupts]);
    expect(Array.from(a.memory)).toEqual(Array.from(b.memory));
  });
});

describe('opcode space', () => {
  it('every opcode with every prefix decodes, consumes bytes and takes time without throwing', () => {
    let count = 0;
    for (const prefix of [[], [0xcb], [0xed], [0xdd], [0xfd], [0xdd, 0xcb, 0x01], [0xfd, 0xcb, 0x01]]) {
      for (let op = 0; op < 256; op++) {
        if (prefix.length === 0 && (op === 0xcb || op === 0xed || op === 0xdd || op === 0xfd || op === 0x76)) continue;
        const cpc = new Cpc({ irqInterval: 0 });
        const cpu = cpc.cpu;
        const bytes = [...prefix, op, 0x00, 0x90, 0x00];
        // DDCB/FDCB put the displacement before the opcode
        const code = prefix.length === 3 ? [prefix[0], 0xcb, 0x01, op] : bytes;
        cpu.load(code, 0x8000);
        cpu.pc = 0x8000;
        cpu.sp = 0xb000;
        cpu.hl = 0x9000;
        cpu.ix = 0x9000;
        cpu.iy = 0x9000;
        cpu.bc = 0x0102;
        cpu.de = 0x9100;
        cpu.step();
        expect(cpu.t, `prefix ${prefix} op ${op}`).toBeGreaterThan(0);
        expect(cpu.stop).toBeNull();
        count++;
      }
    }
    expect(count).toBeGreaterThan(1700);
  });
});
