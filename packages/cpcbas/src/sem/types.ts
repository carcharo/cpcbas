/**
 * The language's value types and the rules every semantic stage shares: sizes, ranks,
 * promotion, the IR type each one lowers to, and the type a literal has.
 *
 * Contract (phase L2). The binder, the checker, the lowering and the code generator all
 * import these helpers instead of re-deriving the rules; change them only together with
 * the tests next to this file.
 *
 * Source of the rules: spec §4 (types, sizes, ranges, promotion order), §5 (operators).
 */

import type { TypeName } from '../ast/ast.js';
import type { NumberLit } from '../ast/ast.js';

export type { TypeName } from '../ast/ast.js';

/**
 * IR value types, in the reference backend's naming (compiler-design §3): `f16` is FIXED
 * (16.16 fixed point, 4 bytes), `f` is REAL (5-byte float), `str` a pointer to a heap or
 * constant string.
 */
export type IrType = 'u8' | 'i8' | 'u16' | 'i16' | 'u32' | 'i32' | 'f16' | 'f' | 'str';

export const ALL_TYPES: readonly TypeName[] = ['UBYTE', 'BYTE', 'UINTEGER', 'INTEGER', 'ULONG', 'LONG', 'FIXED', 'REAL', 'STRING'];

const IR: Readonly<Record<TypeName, IrType>> = {
  UBYTE: 'u8',
  BYTE: 'i8',
  UINTEGER: 'u16',
  INTEGER: 'i16',
  ULONG: 'u32',
  LONG: 'i32',
  FIXED: 'f16',
  REAL: 'f',
  STRING: 'str',
};

/** The IR type a value of this type is held in. */
export function irType(t: TypeName): IrType {
  return IR[t];
}

const SIZE: Readonly<Record<TypeName, number>> = {
  UBYTE: 1,
  BYTE: 1,
  UINTEGER: 2,
  INTEGER: 2,
  ULONG: 4,
  LONG: 4,
  FIXED: 4,
  REAL: 5,
  STRING: 2,
};

/** Storage size in bytes (STRING: the 2-byte pointer). Spec §4. */
export function sizeOf(t: TypeName): number {
  return SIZE[t];
}

/** IR type sizes; `u8`/`i8` occupy 2 bytes when pushed (the reference pushes AF). */
export function irSize(t: IrType): number {
  switch (t) {
    case 'u8':
    case 'i8':
      return 1;
    case 'u16':
    case 'i16':
    case 'str':
      return 2;
    case 'u32':
    case 'i32':
    case 'f16':
      return 4;
    case 'f':
      return 5;
  }
}

export function isInteger(t: TypeName): boolean {
  return t !== 'FIXED' && t !== 'REAL' && t !== 'STRING';
}

export function isNumeric(t: TypeName): boolean {
  return t !== 'STRING';
}

export function isSigned(t: TypeName): boolean {
  return t === 'BYTE' || t === 'INTEGER' || t === 'LONG' || t === 'FIXED' || t === 'REAL';
}

/** Promotion order of spec §4: UBYTE < BYTE < UINTEGER < INTEGER < ULONG < LONG < FIXED < REAL. */
const RANK: Readonly<Record<TypeName, number>> = {
  UBYTE: 0,
  BYTE: 1,
  UINTEGER: 2,
  INTEGER: 3,
  ULONG: 4,
  LONG: 5,
  FIXED: 6,
  REAL: 7,
  STRING: -1,
};

/** Signed types whose values UINTEGER cannot hold and that a 16-bit result would wrap. */
const SIGNED_16: ReadonlySet<TypeName> = new Set<TypeName>(['BYTE', 'INTEGER']);
/** The signed integer types: with ULONG they give LONG. */
const SIGNED_INT: ReadonlySet<TypeName> = new Set<TypeName>(['BYTE', 'INTEGER', 'LONG']);

/**
 * The wider of two numeric types (spec §4). Throws on STRING: the checker reports E230 first.
 *
 * Mixed 16-bit signedness: UINTEGER with INTEGER
 * or BYTE gives LONG, which holds every value of both, instead of a 16-bit type that would
 * wrap one of them (`i% + 40000`, `u < i%`). ULONG with any signed type (BYTE, INTEGER, LONG)
 * gives LONG too (follow-up 29): no wider integer exists, but the signed choice keeps the
 * result independent of the operand order (MIN/MAX) and negative values exact. The 8-bit
 * pair UBYTE/BYTE stays BYTE.
 */
export function promote(a: TypeName, b: TypeName): TypeName {
  if (a === 'STRING' || b === 'STRING') throw new Error(`promote(${a}, ${b}): not numeric`);
  if ((a === 'UINTEGER' && SIGNED_16.has(b)) || (b === 'UINTEGER' && SIGNED_16.has(a))) return 'LONG';
  if ((a === 'ULONG' && SIGNED_INT.has(b)) || (b === 'ULONG' && SIGNED_INT.has(a))) return 'LONG';
  return RANK[a] >= RANK[b] ? a : b;
}


/** Inclusive value range of an integer type; null for FIXED, REAL and STRING. */
export function integerRange(t: TypeName): { readonly min: number; readonly max: number } | null {
  switch (t) {
    case 'UBYTE':
      return { min: 0, max: 0xff };
    case 'BYTE':
      return { min: -0x80, max: 0x7f };
    case 'UINTEGER':
      return { min: 0, max: 0xffff };
    case 'INTEGER':
      return { min: -0x8000, max: 0x7fff };
    case 'ULONG':
      return { min: 0, max: 0xffffffff };
    case 'LONG':
      return { min: -0x80000000, max: 0x7fffffff };
    default:
      return null;
  }
}

/** Whether an integer value fits a type without wrapping (FIXED: -32768..32767.99998, REAL: always). */
export function fits(value: number, t: TypeName): boolean {
  if (t === 'STRING') return false;
  if (t === 'REAL') return true;
  if (t === 'FIXED') return value >= -32768 && value < 32768;
  const r = integerRange(t) as { min: number; max: number };
  return Number.isInteger(value) && value >= r.min && value <= r.max;
}

/**
 * Wraps an integer value into an integer type, two's complement, as the generated code
 * does (spec §4: integer overflow wraps silently). Constant folding uses this.
 */
export function wrap(value: number, t: TypeName): number {
  const r = integerRange(t);
  if (r === null) return value;
  const span = r.max - r.min + 1;
  let v = Math.trunc(value) - r.min;
  v = ((v % span) + span) % span;
  return v + r.min;
}

/** Type of a suffix (spec §4): `%` INTEGER, `!` REAL, `$` STRING. */
export function suffixType(suffix: '%' | '!' | '$'): TypeName {
  return suffix === '%' ? 'INTEGER' : suffix === '!' ? 'REAL' : 'STRING';
}

/**
 * The type of a numeric literal on its own:
 * - `!` suffix, a `.` or an exponent: REAL;
 * - `%` suffix: INTEGER (the checker reports a value outside -32768..32767);
 * - hex or binary: INTEGER up to 16 bits, read as two's complement (`&FFFF` is -1, as in
 *   Locomotive), else ULONG (the lexer refuses more than 32 bits);
 * - decimal: INTEGER when it fits, else UINTEGER, else ULONG, else REAL.
 * `literalValue` gives the value in that type (`&FFFF` gives -1).
 */
export function literalType(lit: Pick<NumberLit, 'value' | 'radix' | 'isReal' | 'suffix'>): TypeName {
  if (lit.suffix === '!' || lit.isReal) return 'REAL';
  if (lit.suffix === '%') return 'INTEGER';
  const v = lit.value;
  if (lit.radix !== 10) return v <= 0xffff ? 'INTEGER' : 'ULONG';
  if (v <= 0x7fff) return 'INTEGER';
  if (v <= 0xffff) return 'UINTEGER';
  if (v <= 0xffffffff) return 'ULONG';
  return 'REAL';
}

/** The value of a literal in {@link literalType}'s type. */
export function literalValue(lit: Pick<NumberLit, 'value' | 'radix' | 'isReal' | 'suffix'>): number {
  const t = literalType(lit);
  if (lit.radix !== 10 && t === 'INTEGER') return wrap(lit.value, 'INTEGER');
  return lit.value;
}
