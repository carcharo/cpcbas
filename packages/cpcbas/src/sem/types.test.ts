import { describe, expect, it } from 'vitest';
import { fits, integerRange, irType, literalType, literalValue, promote, sizeOf, wrap } from './types.js';

const lit = (value: number, radix: 2 | 10 | 16 = 10, isReal = false, suffix: '%' | '!' | null = null) => ({ value, radix, isReal, suffix });

describe('sem/types', () => {
  it('maps every type to its IR type and size (spec §4)', () => {
    expect(irType('UBYTE')).toBe('u8');
    expect(irType('FIXED')).toBe('f16');
    expect(irType('REAL')).toBe('f');
    expect(irType('STRING')).toBe('str');
    expect(sizeOf('REAL')).toBe(5);
    expect(sizeOf('STRING')).toBe(2);
  });

  it('promotes to the wider type in the spec order', () => {
    expect(promote('UBYTE', 'BYTE')).toBe('BYTE');
    // mixed 16-bit signedness widens to LONG
    expect(promote('INTEGER', 'UINTEGER')).toBe('LONG');
    expect(promote('UINTEGER', 'INTEGER')).toBe('LONG');
    expect(promote('BYTE', 'UINTEGER')).toBe('LONG');
    expect(promote('UINTEGER', 'BYTE')).toBe('LONG');
    expect(promote('UBYTE', 'UINTEGER')).toBe('UINTEGER');
    expect(promote('UBYTE', 'INTEGER')).toBe('INTEGER');
    expect(promote('BYTE', 'INTEGER')).toBe('INTEGER');
    expect(promote('UINTEGER', 'LONG')).toBe('LONG');
    expect(promote('UINTEGER', 'ULONG')).toBe('ULONG');
    expect(promote('ULONG', 'INTEGER')).toBe('LONG');
    expect(promote('INTEGER', 'ULONG')).toBe('LONG');
    expect(promote('ULONG', 'BYTE')).toBe('LONG');
    expect(promote('BYTE', 'ULONG')).toBe('LONG');
    expect(promote('ULONG', 'LONG')).toBe('LONG');
    expect(promote('LONG', 'ULONG')).toBe('LONG');
    expect(promote('ULONG', 'UBYTE')).toBe('ULONG');
    expect(promote('UINTEGER', 'ULONG')).toBe('ULONG');
    expect(promote('FIXED', 'LONG')).toBe('FIXED');
    expect(promote('INTEGER', 'REAL')).toBe('REAL');
    expect(() => promote('STRING', 'INTEGER')).toThrow();
  });

  it('wraps integers two\'s complement and checks ranges', () => {
    expect(wrap(256, 'UBYTE')).toBe(0);
    expect(wrap(-1, 'UBYTE')).toBe(255);
    expect(wrap(32768, 'INTEGER')).toBe(-32768);
    expect(wrap(0xffffffff, 'LONG')).toBe(-1);
    expect(wrap(-7.9, 'INTEGER')).toBe(-7);
    expect(integerRange('BYTE')).toEqual({ min: -128, max: 127 });
    expect(fits(255, 'UBYTE')).toBe(true);
    expect(fits(256, 'UBYTE')).toBe(false);
    expect(fits(1.5, 'INTEGER')).toBe(false);
    expect(fits(32767.5, 'FIXED')).toBe(true);
  });

  it('types literals', () => {
    expect(literalType(lit(5))).toBe('INTEGER');
    expect(literalType(lit(40000))).toBe('UINTEGER');
    expect(literalType(lit(70000))).toBe('ULONG');
    expect(literalType(lit(5e12))).toBe('REAL');
    expect(literalType(lit(1.5, 10, true))).toBe('REAL');
    expect(literalType(lit(5, 10, false, '!'))).toBe('REAL');
    expect(literalType(lit(5, 10, false, '%'))).toBe('INTEGER');
    expect(literalType(lit(0xffff, 16))).toBe('INTEGER');
    expect(literalValue(lit(0xffff, 16))).toBe(-1);
    expect(literalValue(lit(0x7fff, 16))).toBe(0x7fff);
    expect(literalType(lit(0x10000, 16))).toBe('ULONG');
  });
});
