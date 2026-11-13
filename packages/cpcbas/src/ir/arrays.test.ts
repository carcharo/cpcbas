import { describe, expect, it } from 'vitest';
import { ARRAY_DATA_OFFSET, ARRAY_DESCRIPTOR_BYTES, ARRAY_UBOUND_OFFSET, arrayLabels, arrayLayout, elementOffset } from './arrays.js';

describe('array layout (docs/ir.md "Arrays")', () => {
  it('the dimension table is the reference compiler\'s (tests/asm-golden/programs/cpc_arrays.asm)', () => {
    // DIM a(4) AS UBYTE: DEFW 0000h / DEFB 01h; DIM b(2, 3) AS UINTEGER: DEFW 0001h / DEFW 0004h / DEFB 02h.
    expect([...arrayLayout([4], 'u8').dimsTable]).toEqual([0, 0, 1]);
    expect([...arrayLayout([2, 3], 'u16').dimsTable]).toEqual([1, 0, 4, 0, 2]);
    expect([...arrayLayout([2], 'f').dimsTable]).toEqual([0, 0, 5]);
    expect(arrayLayout([2, 3], 'u16').dataBytes).toBe(24);
    expect(arrayLayout([2], 'f').dataBytes).toBe(15);
    expect(arrayLayout([3], 'str').elementSize).toBe(2);
  });

  it('the UBOUND table holds each upper bound', () => {
    expect([...arrayLayout([2, 300, 0], 'i8').uboundTable]).toEqual([2, 0, 0x2c, 1, 0, 0]);
  });

  it('constant indexes give the offsets the reference uses (row-major, last index fastest)', () => {
    expect(elementOffset(arrayLayout([4], 'u8'), [2])).toBe(2); // ld (_a.__DATA__ + 2), a
    expect(elementOffset(arrayLayout([2, 3], 'u16'), [1, 2])).toBe(12); // ld (_b.__DATA__ + 12), hl
    expect(elementOffset(arrayLayout([2], 'f'), [1])).toBe(5); // ld hl, _c.__DATA__ + 5
    expect(elementOffset(arrayLayout([1, 1, 1], 'i16'), [1, 0, 1])).toBe(10);
  });

  it('out-of-range or wrong-arity indexes give null', () => {
    const l = arrayLayout([2, 3], 'u8');
    expect(elementOffset(l, [3, 0])).toBeNull();
    expect(elementOffset(l, [0, -1])).toBeNull();
    expect(elementOffset(l, [0])).toBeNull();
    expect(elementOffset(l, [0.5, 0])).toBeNull();
  });

  it('descriptor offsets and labels', () => {
    expect([ARRAY_DESCRIPTOR_BYTES, ARRAY_DATA_OFFSET, ARRAY_UBOUND_OFFSET]).toEqual([8, 2, 6]);
    expect(arrayLabels('_a__a')).toEqual({
      descriptor: '_a__a',
      dataPtr: '_a__a.__DATA__.__PTR__',
      data: '_a__a.__DATA__',
      dims: '_a__a.__DIMS__',
      ubound: '_a__a.__UBOUND__',
    });
  });

  it('an array has at least one dimension', () => {
    expect(() => arrayLayout([], 'u8')).toThrow(RangeError);
  });
});
