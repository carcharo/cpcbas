import { describe, expect, it } from 'vitest';
import { convertConst, foldBinary, foldUnary } from './fold.js';

const i = (value: number, type: 'INTEGER' | 'UBYTE' | 'ULONG' | 'LONG' | 'UINTEGER' = 'INTEGER'): { type: typeof type; value: number } => ({ type, value });

describe('foldBinary', () => {
  it('wraps in the operation type', () => {
    expect(foldBinary('+', i(32767), i(1), 'INTEGER')).toEqual(i(-32768));
    expect(foldBinary('+', i(255, 'UBYTE'), i(1, 'UBYTE'), 'UBYTE')).toEqual(i(0, 'UBYTE'));
    expect(foldBinary('*', i(0xffffffff, 'ULONG'), i(0xffffffff, 'ULONG'), 'ULONG')).toEqual(i(1, 'ULONG'));
    expect(foldBinary('-', i(0, 'UINTEGER'), i(1, 'UINTEGER'), 'UINTEGER')).toEqual(i(65535, 'UINTEGER'));
  });
  it('division truncates, MOD takes the sign of the dividend', () => {
    expect(foldBinary('\\', i(-7), i(2), 'INTEGER')).toEqual(i(-3));
    expect(foldBinary('MOD', i(-7), i(3), 'INTEGER')).toEqual(i(-1));
    expect(foldBinary('MOD', i(7), i(-3), 'INTEGER')).toEqual(i(1));
    expect(foldBinary('/', i(-32768), i(-1), 'INTEGER')).toEqual(i(-32768));
    expect(foldBinary('/', i(1), i(0), 'INTEGER')).toBe('div0');
    expect(foldBinary('MOD', i(1), i(0), 'INTEGER')).toBe('div0');
  });
  it('bitwise and shifts', () => {
    expect(foldBinary('AND', i(-1), i(255), 'INTEGER')).toEqual(i(255));
    expect(foldBinary('XOR', i(-1), i(255), 'INTEGER')).toEqual(i(-256));
    expect(foldBinary('<<', i(1), i(15), 'INTEGER')).toEqual(i(-32768));
    expect(foldBinary('>>', i(-8), i(1), 'INTEGER')).toEqual(i(-4));
    expect(foldBinary('>>', i(255, 'UBYTE'), i(1), 'UBYTE')).toEqual(i(127, 'UBYTE'));
    expect(foldBinary('<<', i(1), i(-1), 'INTEGER')).toBeNull();
  });
  it('comparisons give -1 and 0', () => {
    expect(foldBinary('<', i(1), i(2), 'INTEGER')).toEqual(i(-1));
    expect(foldBinary('>=', i(1), i(2), 'INTEGER')).toEqual(i(0));
    expect(foldBinary('<', { type: 'STRING', value: 'ab' }, { type: 'STRING', value: 'abc' }, 'STRING')).toEqual(i(-1));
  });
  it('FIXED wraps and quantises, REAL is plain', () => {
    expect(foldBinary('+', { type: 'FIXED', value: 32767 }, { type: 'FIXED', value: 1 }, 'FIXED')).toEqual({ type: 'FIXED', value: -32768 });
    expect(foldBinary('/', { type: 'REAL', value: 1 }, { type: 'REAL', value: 4 }, 'REAL')).toEqual({ type: 'REAL', value: 0.25 });
  });
});

describe('conversions and helpers', () => {
  it('convertConst truncates reals and wraps integers; refuses string mixes', () => {
    expect(convertConst({ type: 'REAL', value: -2.7 }, 'INTEGER')).toEqual(i(-2));
    expect(convertConst(i(300), 'UBYTE')).toEqual(i(44, 'UBYTE'));
    expect(convertConst(i(-1), 'ULONG')).toEqual(i(0xffffffff, 'ULONG'));
    expect(convertConst(i(1), 'STRING')).toBeNull();
    expect(convertConst({ type: 'REAL', value: 1e30 }, 'INTEGER')).not.toBeNull();
  });
  it('foldUnary', () => {
    expect(foldUnary('-', i(-32768))).toEqual(i(-32768));
    expect(foldUnary('NOT', i(0))).toEqual(i(-1));
    expect(foldUnary('NOT', i(0, 'UBYTE'))).toEqual(i(255, 'UBYTE'));
  });
});
