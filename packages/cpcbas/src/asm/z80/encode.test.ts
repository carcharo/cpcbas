import { describe, expect, it } from 'vitest';
import type { Condition, Operand, Reg16, Reg8 } from '../types.js';
import { encode } from './encode.js';
import { Z80_TABLE } from './table.gen.js';

const r8 = (reg: Reg8): Operand => ({ kind: 'reg8', reg });
const r16 = (reg: Reg16): Operand => ({ kind: 'reg16', reg });
const cond = (c: Exclude<Condition, 'C'>): Operand => ({ kind: 'cond', cond: c });
const imm = (value: number, pending = false): Operand => (pending ? { kind: 'imm', value, pending } : { kind: 'imm', value });
const mem = (address: number, pending = false): Operand => (pending ? { kind: 'mem', address, pending } : { kind: 'mem', address });
const ind = (reg: 'BC' | 'DE' | 'HL' | 'SP' | 'IX' | 'IY' | 'C'): Operand => ({ kind: 'regIndirect', reg });
const ix = (disp: number, pending = false): Operand => (pending ? { kind: 'index', reg: 'IX', disp, pending } : { kind: 'index', reg: 'IX', disp });
const iy = (disp: number): Operand => ({ kind: 'index', reg: 'IY', disp });
const A = r8('A');
const B = r8('B');
const C = r8('C');
const HL = r16('HL');

function bytes(mnemonic: string, operands: Operand[] = [], pc = 0): number[] {
  const r = encode({ mnemonic, operands, pc });
  if (!r.ok) throw new Error(`${mnemonic}: ${r.code} ${r.message}`);
  return [...r.bytes];
}

type Case = [string, string, Operand[], number[]];

/** Expected bytes written by hand from the Zilog Z80 opcode tables. */
const groups: Record<string, Case[]> = {
  '8-bit LD': [
    ['ld a,b', 'LD', [A, B], [0x78]],
    ['ld b,c', 'LD', [B, C], [0x41]],
    ['ld h,l', 'LD', [r8('H'), r8('L')], [0x65]],
    ['ld a,(hl)', 'LD', [A, ind('HL')], [0x7e]],
    ['ld (hl),b', 'LD', [ind('HL'), B], [0x70]],
    ['ld a,5', 'LD', [A, imm(5)], [0x3e, 0x05]],
    ['ld c,255', 'LD', [C, imm(255)], [0x0e, 0xff]],
    ['ld (hl),7', 'LD', [ind('HL'), imm(7)], [0x36, 0x07]],
    ['ld a,(bc)', 'LD', [A, ind('BC')], [0x0a]],
    ['ld a,(de)', 'LD', [A, ind('DE')], [0x1a]],
    ['ld (bc),a', 'LD', [ind('BC'), A], [0x02]],
    ['ld (de),a', 'LD', [ind('DE'), A], [0x12]],
    ['ld a,(1234h)', 'LD', [A, mem(0x1234)], [0x3a, 0x34, 0x12]],
    ['ld (1234h),a', 'LD', [mem(0x1234), A], [0x32, 0x34, 0x12]],
    ['ld a,(ix+5)', 'LD', [A, ix(5)], [0xdd, 0x7e, 0x05]],
    ['ld b,(iy-2)', 'LD', [B, iy(-2)], [0xfd, 0x46, 0xfe]],
    ['ld (ix+3),c', 'LD', [ix(3), C], [0xdd, 0x71, 0x03]],
    ['ld (iy+127),a', 'LD', [iy(127), A], [0xfd, 0x77, 0x7f]],
    ['ld (ix-128),e', 'LD', [ix(-128), r8('E')], [0xdd, 0x73, 0x80]],
    ['ld (ix),h', 'LD', [ix(0), r8('H')], [0xdd, 0x74, 0x00]],
    ['ld (ix+1),9', 'LD', [ix(1), imm(9)], [0xdd, 0x36, 0x01, 0x09]],
    ['ld (iy+2),128', 'LD', [iy(2), imm(128)], [0xfd, 0x36, 0x02, 0x80]],
    ['ld a,ixh', 'LD', [A, r8('IXH')], [0xdd, 0x7c]],
    ['ld ixl,b', 'LD', [r8('IXL'), B], [0xdd, 0x68]],
    ['ld ixh,5', 'LD', [r8('IXH'), imm(5)], [0xdd, 0x26, 0x05]],
    ['ld iyl,a', 'LD', [r8('IYL'), A], [0xfd, 0x6f]],
    ['ld c,iyh', 'LD', [C, r8('IYH')], [0xfd, 0x4c]],
    ['ld a,i', 'LD', [A, r8('I')], [0xed, 0x57]],
    ['ld a,r', 'LD', [A, r8('R')], [0xed, 0x5f]],
    ['ld i,a', 'LD', [r8('I'), A], [0xed, 0x47]],
    ['ld r,a', 'LD', [r8('R'), A], [0xed, 0x4f]],
  ],
  '16-bit LD and stack': [
    ['ld bc,1234h', 'LD', [r16('BC'), imm(0x1234)], [0x01, 0x34, 0x12]],
    ['ld de,1234h', 'LD', [r16('DE'), imm(0x1234)], [0x11, 0x34, 0x12]],
    ['ld hl,1234h', 'LD', [HL, imm(0x1234)], [0x21, 0x34, 0x12]],
    ['ld sp,1234h', 'LD', [r16('SP'), imm(0x1234)], [0x31, 0x34, 0x12]],
    ['ld ix,4000h', 'LD', [r16('IX'), imm(0x4000)], [0xdd, 0x21, 0x00, 0x40]],
    ['ld iy,4000h', 'LD', [r16('IY'), imm(0x4000)], [0xfd, 0x21, 0x00, 0x40]],
    ['ld hl,(8000h)', 'LD', [HL, mem(0x8000)], [0x2a, 0x00, 0x80]],
    ['ld (8000h),hl', 'LD', [mem(0x8000), HL], [0x22, 0x00, 0x80]],
    ['ld bc,(8000h)', 'LD', [r16('BC'), mem(0x8000)], [0xed, 0x4b, 0x00, 0x80]],
    ['ld (8000h),de', 'LD', [mem(0x8000), r16('DE')], [0xed, 0x53, 0x00, 0x80]],
    ['ld sp,(8000h)', 'LD', [r16('SP'), mem(0x8000)], [0xed, 0x7b, 0x00, 0x80]],
    ['ld (8000h),sp', 'LD', [mem(0x8000), r16('SP')], [0xed, 0x73, 0x00, 0x80]],
    ['ld ix,(8000h)', 'LD', [r16('IX'), mem(0x8000)], [0xdd, 0x2a, 0x00, 0x80]],
    ['ld (8000h),iy', 'LD', [mem(0x8000), r16('IY')], [0xfd, 0x22, 0x00, 0x80]],
    ['ld sp,hl', 'LD', [r16('SP'), HL], [0xf9]],
    ['ld sp,ix', 'LD', [r16('SP'), r16('IX')], [0xdd, 0xf9]],
    ['ld sp,iy', 'LD', [r16('SP'), r16('IY')], [0xfd, 0xf9]],
    ['push bc', 'PUSH', [r16('BC')], [0xc5]],
    ['push de', 'PUSH', [r16('DE')], [0xd5]],
    ['push hl', 'PUSH', [HL], [0xe5]],
    ['push af', 'PUSH', [r16('AF')], [0xf5]],
    ['push ix', 'PUSH', [r16('IX')], [0xdd, 0xe5]],
    ['push iy', 'PUSH', [r16('IY')], [0xfd, 0xe5]],
    ['pop bc', 'POP', [r16('BC')], [0xc1]],
    ['pop de', 'POP', [r16('DE')], [0xd1]],
    ['pop hl', 'POP', [HL], [0xe1]],
    ['pop af', 'POP', [r16('AF')], [0xf1]],
    ['pop ix', 'POP', [r16('IX')], [0xdd, 0xe1]],
    ['pop iy', 'POP', [r16('IY')], [0xfd, 0xe1]],
  ],
  'EX and EXX': [
    ['ex de,hl', 'EX', [r16('DE'), HL], [0xeb]],
    ["ex af,af'", 'EX', [r16('AF'), r16("AF'")], [0x08]],
    ['exx', 'EXX', [], [0xd9]],
    ['ex (sp),hl', 'EX', [ind('SP'), HL], [0xe3]],
    ['ex (sp),ix', 'EX', [ind('SP'), r16('IX')], [0xdd, 0xe3]],
    ['ex (sp),iy', 'EX', [ind('SP'), r16('IY')], [0xfd, 0xe3]],
  ],
  'ALU 8-bit': [
    ['add a,b', 'ADD', [A, B], [0x80]],
    ['add a,(hl)', 'ADD', [A, ind('HL')], [0x86]],
    ['add a,5', 'ADD', [A, imm(5)], [0xc6, 0x05]],
    ['adc a,c', 'ADC', [A, C], [0x89]],
    ['adc a,n', 'ADC', [A, imm(0x20)], [0xce, 0x20]],
    ['sub b', 'SUB', [B], [0x90]],
    ['sub 10', 'SUB', [imm(10)], [0xd6, 0x0a]],
    ['sbc a,d', 'SBC', [A, r8('D')], [0x9a]],
    ['sbc a,3', 'SBC', [A, imm(3)], [0xde, 0x03]],
    ['and e', 'AND', [r8('E')], [0xa3]],
    ['and 0fh', 'AND', [imm(0x0f)], [0xe6, 0x0f]],
    ['xor a', 'XOR', [A], [0xaf]],
    ['xor 1', 'XOR', [imm(1)], [0xee, 0x01]],
    ['or l', 'OR', [r8('L')], [0xb5]],
    ['or 2', 'OR', [imm(2)], [0xf6, 0x02]],
    ['cp (hl)', 'CP', [ind('HL')], [0xbe]],
    ['cp 5', 'CP', [imm(5)], [0xfe, 0x05]],
    ['add a,(ix+4)', 'ADD', [A, ix(4)], [0xdd, 0x86, 0x04]],
    ['cp (iy-1)', 'CP', [iy(-1)], [0xfd, 0xbe, 0xff]],
    ['sub ixl', 'SUB', [r8('IXL')], [0xdd, 0x95]],
    ['and iyh', 'AND', [r8('IYH')], [0xfd, 0xa4]],
    ['cp ixh', 'CP', [r8('IXH')], [0xdd, 0xbc]],
    ['inc a', 'INC', [A], [0x3c]],
    ['dec b', 'DEC', [B], [0x05]],
    ['inc (hl)', 'INC', [ind('HL')], [0x34]],
    ['dec (hl)', 'DEC', [ind('HL')], [0x35]],
    ['inc (ix+2)', 'INC', [ix(2)], [0xdd, 0x34, 0x02]],
    ['dec (iy+1)', 'DEC', [iy(1)], [0xfd, 0x35, 0x01]],
    ['neg', 'NEG', [], [0xed, 0x44]],
    ['cpl', 'CPL', [], [0x2f]],
    ['daa', 'DAA', [], [0x27]],
    ['ccf', 'CCF', [], [0x3f]],
    ['scf', 'SCF', [], [0x37]],
    ['nop', 'NOP', [], [0x00]],
    ['halt', 'HALT', [], [0x76]],
    ['di', 'DI', [], [0xf3]],
    ['ei', 'EI', [], [0xfb]],
  ],
  '16-bit arithmetic': [
    ['add hl,bc', 'ADD', [HL, r16('BC')], [0x09]],
    ['add hl,de', 'ADD', [HL, r16('DE')], [0x19]],
    ['add hl,hl', 'ADD', [HL, HL], [0x29]],
    ['add hl,sp', 'ADD', [HL, r16('SP')], [0x39]],
    ['add ix,bc', 'ADD', [r16('IX'), r16('BC')], [0xdd, 0x09]],
    ['add ix,ix', 'ADD', [r16('IX'), r16('IX')], [0xdd, 0x29]],
    ['add iy,sp', 'ADD', [r16('IY'), r16('SP')], [0xfd, 0x39]],
    ['adc hl,bc', 'ADC', [HL, r16('BC')], [0xed, 0x4a]],
    ['adc hl,sp', 'ADC', [HL, r16('SP')], [0xed, 0x7a]],
    ['sbc hl,de', 'SBC', [HL, r16('DE')], [0xed, 0x52]],
    ['sbc hl,hl', 'SBC', [HL, HL], [0xed, 0x62]],
    ['inc bc', 'INC', [r16('BC')], [0x03]],
    ['inc de', 'INC', [r16('DE')], [0x13]],
    ['inc hl', 'INC', [HL], [0x23]],
    ['inc sp', 'INC', [r16('SP')], [0x33]],
    ['dec bc', 'DEC', [r16('BC')], [0x0b]],
    ['dec hl', 'DEC', [HL], [0x2b]],
    ['dec sp', 'DEC', [r16('SP')], [0x3b]],
    ['inc ix', 'INC', [r16('IX')], [0xdd, 0x23]],
    ['dec iy', 'DEC', [r16('IY')], [0xfd, 0x2b]],
  ],
  'rotate and shift': [
    ['rlca', 'RLCA', [], [0x07]],
    ['rrca', 'RRCA', [], [0x0f]],
    ['rla', 'RLA', [], [0x17]],
    ['rra', 'RRA', [], [0x1f]],
    ['rlc b', 'RLC', [B], [0xcb, 0x00]],
    ['rrc c', 'RRC', [C], [0xcb, 0x09]],
    ['rl d', 'RL', [r8('D')], [0xcb, 0x12]],
    ['rr e', 'RR', [r8('E')], [0xcb, 0x1b]],
    ['sla h', 'SLA', [r8('H')], [0xcb, 0x24]],
    ['sra l', 'SRA', [r8('L')], [0xcb, 0x2d]],
    ['sll a', 'SLL', [A], [0xcb, 0x37]],
    ['srl a', 'SRL', [A], [0xcb, 0x3f]],
    ['rlc (hl)', 'RLC', [ind('HL')], [0xcb, 0x06]],
    ['srl (hl)', 'SRL', [ind('HL')], [0xcb, 0x3e]],
    ['rlc (ix+3)', 'RLC', [ix(3)], [0xdd, 0xcb, 0x03, 0x06]],
    ['rr (iy-1)', 'RR', [iy(-1)], [0xfd, 0xcb, 0xff, 0x1e]],
    ['sla (ix)', 'SLA', [ix(0)], [0xdd, 0xcb, 0x00, 0x26]],
    ['sll (ix+1)', 'SLL', [ix(1)], [0xdd, 0xcb, 0x01, 0x36]],
    ['rld', 'RLD', [], [0xed, 0x6f]],
    ['rrd', 'RRD', [], [0xed, 0x67]],
  ],
  'BIT SET RES': [
    ['bit 0,b', 'BIT', [imm(0), B], [0xcb, 0x40]],
    ['bit 7,a', 'BIT', [imm(7), A], [0xcb, 0x7f]],
    ['bit 3,(hl)', 'BIT', [imm(3), ind('HL')], [0xcb, 0x5e]],
    ['set 0,a', 'SET', [imm(0), A], [0xcb, 0xc7]],
    ['set 7,(hl)', 'SET', [imm(7), ind('HL')], [0xcb, 0xfe]],
    ['res 0,b', 'RES', [imm(0), B], [0xcb, 0x80]],
    ['res 7,(hl)', 'RES', [imm(7), ind('HL')], [0xcb, 0xbe]],
    ['bit 2,(ix+5)', 'BIT', [imm(2), ix(5)], [0xdd, 0xcb, 0x05, 0x56]],
    ['set 4,(iy-3)', 'SET', [imm(4), iy(-3)], [0xfd, 0xcb, 0xfd, 0xe6]],
    ['res 1,(ix+10)', 'RES', [imm(1), ix(10)], [0xdd, 0xcb, 0x0a, 0x8e]],
    ['bit 7,(iy)', 'BIT', [imm(7), iy(0)], [0xfd, 0xcb, 0x00, 0x7e]],
  ],
  'jumps calls returns': [
    ['jp 1234h', 'JP', [imm(0x1234)], [0xc3, 0x34, 0x12]],
    ['jp nz,1234h', 'JP', [cond('NZ'), imm(0x1234)], [0xc2, 0x34, 0x12]],
    ['jp z,1234h', 'JP', [cond('Z'), imm(0x1234)], [0xca, 0x34, 0x12]],
    ['jp nc,1234h', 'JP', [cond('NC'), imm(0x1234)], [0xd2, 0x34, 0x12]],
    ['jp c,1234h', 'JP', [C, imm(0x1234)], [0xda, 0x34, 0x12]],
    ['jp po,1234h', 'JP', [cond('PO'), imm(0x1234)], [0xe2, 0x34, 0x12]],
    ['jp pe,1234h', 'JP', [cond('PE'), imm(0x1234)], [0xea, 0x34, 0x12]],
    ['jp p,1234h', 'JP', [cond('P'), imm(0x1234)], [0xf2, 0x34, 0x12]],
    ['jp m,1234h', 'JP', [cond('M'), imm(0x1234)], [0xfa, 0x34, 0x12]],
    ['jp (hl)', 'JP', [ind('HL')], [0xe9]],
    ['jp (ix)', 'JP', [ix(0)], [0xdd, 0xe9]],
    ['jp (iy)', 'JP', [iy(0)], [0xfd, 0xe9]],
    ['call 1234h', 'CALL', [imm(0x1234)], [0xcd, 0x34, 0x12]],
    ['call nz,1234h', 'CALL', [cond('NZ'), imm(0x1234)], [0xc4, 0x34, 0x12]],
    ['call c,1234h', 'CALL', [C, imm(0x1234)], [0xdc, 0x34, 0x12]],
    ['call m,1234h', 'CALL', [cond('M'), imm(0x1234)], [0xfc, 0x34, 0x12]],
    ['ret', 'RET', [], [0xc9]],
    ['ret nz', 'RET', [cond('NZ')], [0xc0]],
    ['ret z', 'RET', [cond('Z')], [0xc8]],
    ['ret nc', 'RET', [cond('NC')], [0xd0]],
    ['ret c', 'RET', [C], [0xd8]],
    ['ret po', 'RET', [cond('PO')], [0xe0]],
    ['ret pe', 'RET', [cond('PE')], [0xe8]],
    ['ret p', 'RET', [cond('P')], [0xf0]],
    ['ret m', 'RET', [cond('M')], [0xf8]],
    ['reti', 'RETI', [], [0xed, 0x4d]],
    ['retn', 'RETN', [], [0xed, 0x45]],
  ],
  RST: [0, 8, 16, 24, 32, 40, 48, 56].map((n, i): Case => [`rst ${n}`, 'RST', [imm(n)], [0xc7 + i * 8]]),
  'IN OUT IM': [
    ['in a,(c)', 'IN', [A, ind('C')], [0xed, 0x78]],
    ['in b,(c)', 'IN', [B, ind('C')], [0xed, 0x40]],
    ['in l,(c)', 'IN', [r8('L'), ind('C')], [0xed, 0x68]],
    ['in a,(0feh)', 'IN', [A, mem(0xfe)], [0xdb, 0xfe]],
    ['out (c),a', 'OUT', [ind('C'), A], [0xed, 0x79]],
    ['out (c),d', 'OUT', [ind('C'), r8('D')], [0xed, 0x51]],
    ['out (7fh),a', 'OUT', [mem(0x7f), A], [0xd3, 0x7f]],
    ['im 0', 'IM', [imm(0)], [0xed, 0x46]],
    ['im 1', 'IM', [imm(1)], [0xed, 0x56]],
    ['im 2', 'IM', [imm(2)], [0xed, 0x5e]],
  ],
  'block instructions': [
    ['ldi', 'LDI', [], [0xed, 0xa0]],
    ['ldir', 'LDIR', [], [0xed, 0xb0]],
    ['ldd', 'LDD', [], [0xed, 0xa8]],
    ['lddr', 'LDDR', [], [0xed, 0xb8]],
    ['cpi', 'CPI', [], [0xed, 0xa1]],
    ['cpir', 'CPIR', [], [0xed, 0xb1]],
    ['cpd', 'CPD', [], [0xed, 0xa9]],
    ['cpdr', 'CPDR', [], [0xed, 0xb9]],
    ['ini', 'INI', [], [0xed, 0xa2]],
    ['inir', 'INIR', [], [0xed, 0xb2]],
    ['ind', 'IND', [], [0xed, 0xaa]],
    ['indr', 'INDR', [], [0xed, 0xba]],
    ['outi', 'OUTI', [], [0xed, 0xa3]],
    ['otir', 'OTIR', [], [0xed, 0xb3]],
    ['outd', 'OUTD', [], [0xed, 0xab]],
    ['otdr', 'OTDR', [], [0xed, 0xbb]],
  ],
};

describe('hand-assembled: every instruction group', () => {
  for (const [name, cases] of Object.entries(groups)) {
    it(name, () => {
      expect(cases.length).toBeGreaterThanOrEqual(5);
      for (const [text, mnemonic, operands, expected] of cases) {
        expect(bytes(mnemonic, operands), text).toEqual(expected);
      }
    });
  }

  it('JR and DJNZ forward and back', () => {
    const pc = 0x8000;
    expect(bytes('JR', [imm(pc + 2 + 5)], pc)).toEqual([0x18, 0x05]);
    expect(bytes('JR', [imm(pc)], pc)).toEqual([0x18, 0xfe]);
    expect(bytes('JR', [imm(pc + 2)], pc)).toEqual([0x18, 0x00]);
    expect(bytes('JR', [cond('NZ'), imm(pc - 10)], pc)).toEqual([0x20, 0xf4]);
    expect(bytes('JR', [cond('Z'), imm(pc + 4)], pc)).toEqual([0x28, 0x02]);
    expect(bytes('JR', [cond('NC'), imm(pc + 4)], pc)).toEqual([0x30, 0x02]);
    expect(bytes('JR', [C, imm(pc + 4)], pc)).toEqual([0x38, 0x02]);
    expect(bytes('DJNZ', [imm(pc - 4)], pc)).toEqual([0x10, 0xfa]);
    expect(bytes('DJNZ', [imm(pc + 12)], pc)).toEqual([0x10, 0x0a]);
  });
});

describe('systematic cross-check of the regular opcode blocks', () => {
  // Register field of the opcode: B C D E H L (HL) A = 0..7.
  const regs: Array<[Reg8, number]> = [['B', 0], ['C', 1], ['D', 2], ['E', 3], ['H', 4], ['L', 5], ['A', 7]];

  it('LD r,r', () => {
    for (const [d, dn] of regs) for (const [s, sn] of regs) {
      expect(bytes('LD', [r8(d), r8(s)]), `ld ${d},${s}`).toEqual([0x40 + dn * 8 + sn]);
    }
  });
  it('ALU r', () => {
    const ops: Array<[string, number]> = [['ADD', 0x80], ['ADC', 0x88], ['SUB', 0x90], ['SBC', 0x98], ['AND', 0xa0], ['XOR', 0xa8], ['OR', 0xb0], ['CP', 0xb8]];
    for (const [m, base] of ops) for (const [s, sn] of regs) {
      const operands = m === 'ADD' || m === 'ADC' || m === 'SBC' ? [A, r8(s)] : [r8(s)];
      expect(bytes(m, operands), `${m} ${s}`).toEqual([base + sn]);
    }
  });
  it('CB rotate, BIT, SET, RES on registers and (HL)', () => {
    const all: Array<[Operand, number]> = [...regs.map(([r, n]): [Operand, number] => [r8(r), n]), [ind('HL'), 6]];
    const rots = ['RLC', 'RRC', 'RL', 'RR', 'SLA', 'SRA', 'SLL', 'SRL'];
    rots.forEach((m, k) => all.forEach(([o, n]) => expect(bytes(m, [o]), m).toEqual([0xcb, k * 8 + n])));
    const bitOps: Array<[string, number]> = [['BIT', 0x40], ['RES', 0x80], ['SET', 0xc0]];
    for (const [m, base] of bitOps) for (let b = 0; b < 8; b++) all.forEach(([o, n]) => {
      expect(bytes(m, [imm(b), o]), `${m} ${b}`).toEqual([0xcb, base + b * 8 + n]);
      expect(bytes(m, [imm(b), ix(9)]), `${m} ${b},(ix+9)`).toEqual([0xdd, 0xcb, 9, base + b * 8 + 6]);
      expect(bytes(m, [imm(b), iy(-9)]), `${m} ${b},(iy-9)`).toEqual([0xfd, 0xcb, 0xf7, base + b * 8 + 6]);
    });
  });
  it('index-register halves take the prefix and H/L slots (documented forms)', () => {
    const slots: Array<[Reg8, Reg8, number, number]> = [['IXH', 'H', 0xdd, 4], ['IXL', 'L', 0xdd, 5], ['IYH', 'H', 0xfd, 4], ['IYL', 'L', 0xfd, 5]];
    for (const [half, , prefix, n] of slots) {
      for (const [r, rn] of regs.filter(([x]) => x !== 'H' && x !== 'L')) {
        expect(bytes('LD', [r8(r), r8(half)]), `ld ${r},${half}`).toEqual([prefix, 0x40 + rn * 8 + n]);
        expect(bytes('LD', [r8(half), r8(r)]), `ld ${half},${r}`).toEqual([prefix, 0x40 + n * 8 + rn]);
      }
      expect(bytes('INC', [r8(half)])).toEqual([prefix, 0x04 + n * 8]);
      expect(bytes('DEC', [r8(half)])).toEqual([prefix, 0x05 + n * 8]);
    }
  });
});

describe('reference table bugs corrected in the generator', () => {
  it('LD IYH,IYH / IYH,IYL use the FD prefix (z80.py wrongly has DD)', () => {
    // z80.py encodes these with DD (the IX prefix), a bug; the generator overrides them.
    expect(bytes('LD', [r8('IYH'), r8('IYH')])).toEqual([0xfd, 0x64]);
    expect(bytes('LD', [r8('IYH'), r8('IYL')])).toEqual([0xfd, 0x65]);
  });
});

describe('table round trip', () => {
  const regNames = new Set(['A', 'B', 'C', 'D', 'E', 'H', 'L', 'I', 'R', 'IXH', 'IXL', 'IYH', 'IYL']);
  const reg16Names = new Set(['AF', "AF'", 'BC', 'DE', 'HL', 'SP', 'IX', 'IY']);
  const conds = new Set(['NZ', 'Z', 'NC', 'PO', 'PE', 'P', 'M']);
  const PC = 0x8000;

  function parse(mnemonic: string, text: string): Operand {
    let m: RegExpMatchArray | null;
    if (regNames.has(text)) return r8(text as Reg8);
    if (reg16Names.has(text)) return r16(text as Reg16);
    if (conds.has(text)) return cond(text as Exclude<Condition, 'C'>);
    if ((m = /^\((IX|IY)\+N\)$/.exec(text))) return m[1] === 'IX' ? ix(5) : iy(5);
    if ((m = /^\((IX|IY)\)$/.exec(text))) return m[1] === 'IX' ? ix(0) : iy(0);
    if (text === '(NN)') return mem(0x3456);
    if (text === '(N)') return mem(0x56);
    if ((m = /^\((C|HL|BC|DE|SP)\)$/.exec(text))) return ind(m[1] as 'C' | 'HL' | 'BC' | 'DE' | 'SP');
    if (text === 'NN') return imm(0x3456);
    if (text === 'N') return imm(mnemonic === 'JR' || mnemonic === 'DJNZ' ? PC + 2 + 0x12 : 0x56);
    if (/^\d$/.test(text)) return imm(Number(text));
    if (mnemonic === 'RST' && /^[0-9A-F]+H$/.test(text)) return imm(parseInt(text, 16));
    throw new Error(`cannot parse operand ${text}`);
  }

  it('every Z80 pattern encodes to bytes of the declared size', () => {
    let n = 0;
    for (const [pattern, , size, opcode, z80n] of Z80_TABLE) {
      if (z80n === 1) continue;
      const sp = pattern.indexOf(' ');
      const mnemonic = sp < 0 ? pattern : pattern.slice(0, sp);
      const operands = sp < 0 ? [] : pattern.slice(sp + 1).split(',').map((t) => parse(mnemonic, t));
      const got = bytes(mnemonic, operands, PC);
      expect(got.length, pattern).toBe(size);
      // Independent expansion of the template: XX slots take the sample values in order.
      const isJr = mnemonic === 'JR' || mnemonic === 'DJNZ';
      const sample: number[] = [];
      for (const g of pattern.match(/\bN+\b/g) ?? []) {
        if (g === 'NN') sample.push(0x56, 0x34);
        else sample.push(isJr ? 0x12 : pattern.includes('+N') && sample.length === 0 ? 5 : 0x56);
      }
      let k = 0;
      const want = opcode.split(' ').map((t) => (t === 'XX' ? (sample[k++] as number) : parseInt(t, 16)));
      expect(got, pattern).toEqual(want);
      n++;
    }
    expect(n).toBe(Z80_TABLE.filter((r) => r[4] === 0).length);
    expect(n).toBe(798);
  });

  it('the table has the 827 reference patterns, all keys unique', () => {
    expect(Z80_TABLE.length).toBe(827);
    expect(new Set(Z80_TABLE.map((r) => r[0])).size).toBe(827);
  });
});

describe('JR range', () => {
  const pc = 0x4000;
  it('-126 and +129 relative to pc are the edges', () => {
    expect(bytes('JR', [imm(pc - 126)], pc)).toEqual([0x18, 0x80]);
    expect(bytes('JR', [imm(pc + 129)], pc)).toEqual([0x18, 0x7f]);
    expect(bytes('DJNZ', [imm(pc - 126)], pc)).toEqual([0x10, 0x80]);
    expect(bytes('JR', [cond('NZ'), imm(pc + 129)], pc)).toEqual([0x20, 0x7f]);
  });
  it('beyond the edges gives E502', () => {
    for (const [m, ops] of [
      ['JR', [imm(pc - 127)]],
      ['JR', [imm(pc + 130)]],
      ['DJNZ', [imm(pc + 130)]],
      ['JR', [C, imm(pc - 127)]],
    ] as Array<[string, Operand[]]>) {
      const r = encode({ mnemonic: m, operands: ops, pc });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('E502');
    }
  });
  it('a pending target is not range checked', () => {
    expect(bytes('JR', [imm(0, true)], pc)).toEqual([0x18, 0x00]);
  });
});

describe('truncation warning', () => {
  it('ld a,300 gives W504 and byte 0x2C', () => {
    const r = encode({ mnemonic: 'LD', operands: [A, imm(300)], pc: 0 });
    expect(r).toEqual({ ok: true, bytes: [0x3e, 0x2c], warnings: [{ code: 'W504', message: 'Value will be truncated' }] });
  });
  it('16-bit values truncate too', () => {
    const r = encode({ mnemonic: 'LD', operands: [HL, imm(0x12345)], pc: 0 });
    expect(r).toMatchObject({ ok: true, bytes: [0x21, 0x45, 0x23], warnings: [{ code: 'W504' }] });
  });
  it('in-range signed and unsigned values do not warn', () => {
    for (const v of [-128, -1, 0, 255]) {
      const r = encode({ mnemonic: 'LD', operands: [A, imm(v)], pc: 0 });
      expect(r.ok && r.warnings).toBeFalsy();
    }
    const r = encode({ mnemonic: 'LD', operands: [HL, imm(-1)], pc: 0 });
    expect(r).toEqual({ ok: true, bytes: [0x21, 0xff, 0xff] });
  });
  it('-1 encodes as FF', () => {
    expect(bytes('LD', [A, imm(-1)])).toEqual([0x3e, 0xff]);
  });
});

describe('pending operands', () => {
  it('give the right size and no range error', () => {
    expect(bytes('LD', [A, imm(0x1234, true)])).toEqual([0x3e, 0x00]);
    expect(bytes('LD', [HL, imm(99999, true)])).toEqual([0x21, 0x00, 0x00]);
    expect(bytes('JP', [imm(0, true)])).toEqual([0xc3, 0x00, 0x00]);
    expect(bytes('CALL', [cond('NZ'), imm(0, true)])).toEqual([0xc4, 0x00, 0x00]);
    expect(bytes('LD', [A, mem(0, true)])).toEqual([0x3a, 0x00, 0x00]);
    expect(bytes('LD', [A, ix(500, true)])).toEqual([0xdd, 0x7e, 0x00]);
    expect(bytes('BIT', [imm(1), ix(-999, true)])).toEqual([0xdd, 0xcb, 0x00, 0x4e]);
    expect(bytes('LD', [ix(300, true), imm(70000, true)])).toEqual([0xdd, 0x36, 0x00, 0x00]);
    expect(bytes('JR', [imm(0xffff, true)], 0x10)).toEqual([0x18, 0x00]);
    expect(bytes('IN', [A, mem(0x1ff, true)])).toEqual([0xdb, 0x00]);
  });
  it('no truncation warning for pending values', () => {
    const r = encode({ mnemonic: 'LD', operands: [A, imm(1000, true)], pc: 0 });
    expect(r.ok && r.warnings).toBeFalsy();
  });
});

describe('C as condition vs register', () => {
  it('jp c,nn / ld c,a / ret c', () => {
    expect(bytes('JP', [C, imm(0x1234)])).toEqual([0xda, 0x34, 0x12]);
    expect(bytes('LD', [C, A])).toEqual([0x4f]);
    expect(bytes('RET', [C])).toEqual([0xd8]);
    expect(bytes('CALL', [C, imm(0x1234)])).toEqual([0xdc, 0x34, 0x12]);
    expect(bytes('JR', [C, imm(2)], 0)).toEqual([0x38, 0x00]);
    expect(bytes('ADD', [A, C])).toEqual([0x81]);
  });
});

describe('errors', () => {
  const fail = (mnemonic: string, operands: Operand[]) => {
    const r = encode({ mnemonic, operands, pc: 0 });
    if (r.ok) throw new Error('expected failure');
    return r.code;
  };
  it('unknown mnemonic is E500', () => {
    expect(fail('FROB', [])).toBe('E500');
    expect(fail('MIRROR', [])).toBe('E500'); // Z80N is not accepted
  });
  it('bad operand combinations are E501', () => {
    expect(fail('LD', [ind('HL'), ind('HL')])).toBe('E501');
    expect(fail('LD', [A, r16('HL')])).toBe('E501');
    expect(fail('PUSH', [A])).toBe('E501');
    expect(fail('ADD', [HL, imm(5)])).toBe('E501'); // Z80N form
    expect(fail('BIT', [imm(8), A])).toBe('E501');
    expect(fail('RST', [imm(7)])).toBe('E501');
    expect(fail('IM', [imm(3)])).toBe('E501');
    expect(fail('IN', [{ kind: 'flags' }, ind('C')])).toBe('E501');
    expect(fail('NOP', [A])).toBe('E501');
  });
  it('index displacement out of range is E503', () => {
    expect(fail('LD', [A, ix(128)])).toBe('E503');
    expect(fail('LD', [A, iy(-129)])).toBe('E503');
  });
  it('mnemonic is case-insensitive', () => {
    expect(bytes('nop')).toEqual([0]);
  });
});
