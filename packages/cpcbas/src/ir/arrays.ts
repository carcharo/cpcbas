/**
 * The array layout (docs/ir.md, "Arrays"): the reference compiler's descriptor, which the
 * reused runtime (`array/array.asm` `__ARRAY`, `arraybound.asm` `__LBOUND`/`__UBOUND`,
 * `arraystrfree.asm`, `arrayalloc.asm`) and the library's asm read. One module so the lowering
 * (constant-index offsets, local descriptors, bound folding) and the code generator (the data
 * area) cannot disagree. Contract for phase L3 (wave 0).
 *
 * A global array `_a` of `DIM a(2, 3) AS UINTEGER` is emitted as
 *
 * ```
 * _a:                        ; the descriptor (8 bytes)
 *     DEFW _a.__DIMS__       ;   +0 the dimension table
 * _a.__DATA__.__PTR__:
 *     DEFW _a.__DATA__       ;   +2 the elements
 *     DEFW 0                 ;   +4 the LBOUND table: 0, every array is 0-based
 *     DEFW _a.__UBOUND__     ;   +6 the UBOUND table
 * _a.__DATA__:               ; the elements, row-major (last index fastest), zeros or the initialiser
 *     DEFB ...
 * _a.__DIMS__:               ; dimension count - 1, the element counts of dimensions 2..n, the element size
 *     DEFW 0001h
 *     DEFW 0004h
 *     DEFB 02h
 * _a.__UBOUND__:             ; the upper bound of each dimension
 *     DEFW 0002h
 *     DEFW 0003h
 * ```
 *
 * which is the reference's layout (tests/asm-golden/programs/cpc_arrays.asm) except that the
 * UBOUND table is always emitted (the reference emits it only when UBOUND is used): 2 bytes per
 * dimension, and `UBOUND` of a local array or parameter needs it.
 */

import type { IrType } from './ir.js';
import { irSize } from '../sem/types.js';

/** Bytes of a descriptor: the dimension table, the data pointer, the LBOUND and UBOUND tables. */
export const ARRAY_DESCRIPTOR_BYTES = 8;
/** Offsets inside a descriptor. */
export const ARRAY_DIMS_OFFSET = 0;
export const ARRAY_DATA_OFFSET = 2;
export const ARRAY_LBOUND_OFFSET = 4;
export const ARRAY_UBOUND_OFFSET = 6;
/** Most dimensions an array may have (spec §8). */
export const MAX_ARRAY_DIMS = 4;

/** Asm labels that belong to the global array whose descriptor label is `label`. */
export function arrayLabels(label: string): { readonly descriptor: string; readonly dataPtr: string; readonly data: string; readonly dims: string; readonly ubound: string } {
  return {
    descriptor: label,
    dataPtr: `${label}.__DATA__.__PTR__`,
    data: `${label}.__DATA__`,
    dims: `${label}.__DIMS__`,
    ubound: `${label}.__UBOUND__`,
  };
}

export interface ArrayLayout {
  /** Elements per dimension (upper bound + 1). */
  readonly counts: readonly number[];
  readonly upperBounds: readonly number[];
  readonly elementSize: number;
  readonly elements: number;
  /** Bytes of the element area. */
  readonly dataBytes: number;
  /** The dimension table as bytes: DEFW count - 1, DEFW each count of dimensions 2..n, DEFB element size. */
  readonly dimsTable: Uint8Array;
  /** The UBOUND table as bytes: DEFW each upper bound. */
  readonly uboundTable: Uint8Array;
}

/** The layout of an array with these upper bounds (0-based: `n + 1` elements each) and element type. */
export function arrayLayout(upperBounds: readonly number[], element: IrType): ArrayLayout {
  if (upperBounds.length === 0) throw new RangeError('an array has at least one dimension');
  const counts = upperBounds.map((u) => u + 1);
  const elementSize = irSize(element);
  const elements = counts.reduce((n, c) => n * c, 1);
  const words = (ws: readonly number[]): number[] => ws.flatMap((w) => [w & 0xff, (w >> 8) & 0xff]);
  const dimsTable = new Uint8Array([...words([counts.length - 1, ...counts.slice(1)]), elementSize & 0xff]);
  const uboundTable = new Uint8Array(words(upperBounds));
  return { counts, upperBounds: [...upperBounds], elementSize, elements, dataBytes: elements * elementSize, dimsTable, uboundTable };
}

/**
 * The byte offset of an element from the start of the element area, for constant indexes (row-major,
 * as `__ARRAY` computes it). Null when an index is out of range (the caller reports it: a constant
 * index outside the bounds is a compile-time error, spec §8 has no run-time check).
 */
export function elementOffset(layout: ArrayLayout, indexes: readonly number[]): number | null {
  if (indexes.length !== layout.counts.length) return null;
  let linear = 0;
  for (let i = 0; i < indexes.length; i++) {
    const x = indexes[i] as number;
    const c = layout.counts[i] as number;
    if (!Number.isInteger(x) || x < 0 || x >= c) return null;
    linear = linear * c + x;
  }
  return linear * layout.elementSize;
}
