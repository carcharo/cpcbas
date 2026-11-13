/**
 * A TypeScript model of Locomotive BASIC's REAL as the Amstrad CPC firmware computes it (FWM-SIM).
 * Pure: no I/O, no globals. Written from the measured behaviour of the interpreter
 * and tested against the recorded vectors of tests/fixtures/fwmath-vectors.json;
 * no ROM code is involved.
 *
 * Layout (5 bytes): mantissa bytes 0-3 least significant first, bit 7 of byte 3 is the sign (the
 * leading mantissa bit is implicit), byte 4 the exponent with bias &80; the value is
 * `sign * (2^31 + m) * 2^(exp - 160)`. Exponent byte 0 is zero whatever the mantissa bytes hold.
 *
 * Exact (bit for bit, every recorded vector): `+ - * /` (`realAdd`, `realSub`, `realMul`, `realDiv`),
 * compare, negate, sign, the integer and binary conversions and their carry and sign results.
 * NOT exact: `realMul10` (REAL x 10^A) is the correctly rounded product, which agrees with the
 * firmware on 170 of the 200 recorded vectors (the others differ by one unit in the last place;
 * no simple rule for the firmware's intermediate precision was found), and `realFromNumber` /
 * `realToNumber`, which exist so that callers can approximate the transcendental functions with JS
 * `Math` (the firmware's own results are not 1-ulp accurate either).
 *
 * Results that are zero (underflow, cancellation) are returned as five zero bytes. The firmware
 * leaves junk in the mantissa bytes of such a zero (fwmath-entries.md section 7); nothing reads it.
 */

/** Five bytes of a REAL, least significant mantissa byte first. */
export type Real5 = readonly number[];

/** A result with the firmware's carry (true = valid; false = overflow or domain error). */
export interface RealResult {
  readonly bytes: number[];
  readonly ok: boolean;
}

export const REAL_ZERO: Real5 = [0, 0, 0, 0, 0];
export const REAL_MAX_POS: Real5 = [0xff, 0xff, 0xff, 0x7f, 0xff];
export const REAL_MAX_NEG: Real5 = [0xff, 0xff, 0xff, 0xff, 0xff];

/** A decoded REAL: `mant` has bit 31 set unless the value is zero (then 0n). */
export interface RealParts {
  readonly neg: boolean;
  readonly mant: bigint;
  readonly exp: number;
}

const M32 = 0x1_0000_0000n;

export function isRealZero(b: Real5): boolean {
  return b[4] === 0;
}

export function decodeReal(b: Real5): RealParts {
  const exp = b[4]!;
  if (exp === 0) return { neg: false, mant: 0n, exp: 0 };
  const mant =
    (BigInt((b[3]! & 0x7f) | 0x80) << 24n) | (BigInt(b[2]!) << 16n) | (BigInt(b[1]!) << 8n) | BigInt(b[0]!);
  return { neg: (b[3]! & 0x80) !== 0, mant, exp };
}

/** Encodes sign, a normalised 32-bit mantissa (bit 31 set) and an exponent byte 1..255. */
export function encodeReal(neg: boolean, mant: bigint, exp: number): number[] {
  return [
    Number(mant & 0xffn),
    Number((mant >> 8n) & 0xffn),
    Number((mant >> 16n) & 0xffn),
    Number((mant >> 24n) & 0x7fn) | (neg ? 0x80 : 0),
    exp,
  ];
}

const maxFor = (neg: boolean): number[] => (neg ? [...REAL_MAX_NEG] : [...REAL_MAX_POS]);

/** Packs a result: overflow saturates (carry clear), exponent below 1 is zero (carry set). */
function pack(neg: boolean, mant: bigint, exp: number): RealResult {
  if (exp > 255) return { bytes: maxFor(neg), ok: false };
  if (exp < 1) return { bytes: [...REAL_ZERO], ok: true };
  return { bytes: encodeReal(neg, mant, exp), ok: true };
}

/** Flips the sign bit and nothing else (so NEG of zero is `00 00 00 80 00`, as the firmware gives). */
export function realNeg(b: Real5): number[] {
  return [b[0]!, b[1]!, b[2]!, b[3]! ^ 0x80, b[4]!];
}

/** -1, 0 or 1 for the sign of the value (exponent byte 0 is zero). */
export function realSgn(b: Real5): -1 | 0 | 1 {
  if (b[4] === 0) return 0;
  return (b[3]! & 0x80) !== 0 ? -1 : 1;
}

/** Compares two REALs: -1 (a < b), 0, 1 (a > b). */
export function realCmp(a: Real5, b: Real5): -1 | 0 | 1 {
  const x = decodeReal(a);
  const y = decodeReal(b);
  const sx = realSgn(a);
  const sy = realSgn(b);
  if (sx !== sy) return sx < sy ? -1 : 1;
  if (sx === 0) return 0;
  let c: -1 | 0 | 1;
  if (x.exp !== y.exp) c = x.exp < y.exp ? -1 : 1;
  else c = x.mant === y.mant ? 0 : x.mant < y.mant ? -1 : 1;
  return (x.neg ? -c : c) as -1 | 0 | 1;
}

/** The firmware's `+`: align by a truncating shift into 32 + 8 bits, round half up on the 8 extra bits. */
export function realAdd(a: Real5, b: Real5): RealResult {
  let x = decodeReal(a);
  let y = decodeReal(b);
  if (x.mant === 0n) return { bytes: [...b], ok: true };
  if (y.mant === 0n) return { bytes: [...a], ok: true };
  if (x.exp < y.exp) [x, y] = [y, x];
  const sh = BigInt(Math.min(x.exp - y.exp, 64));
  const big = x.mant << 8n;
  const small = (y.mant << 8n) >> sh;
  let s = (x.neg ? -big : big) + (y.neg ? -small : small);
  const neg = s < 0n;
  if (neg) s = -s;
  if (s === 0n) return { bytes: [...REAL_ZERO], ok: true };
  let exp = x.exp;
  while (s >> 40n) {
    s >>= 1n;
    exp++;
  }
  while (!(s >> 39n)) {
    s <<= 1n;
    exp--;
  }
  let m = s >> 8n;
  if ((s & 0xffn) >= 0x80n) m += 1n;
  if (m >> 32n) {
    m >>= 1n;
    exp++;
  }
  return pack(neg, m, exp);
}

/** a - b. */
export function realSub(a: Real5, b: Real5): RealResult {
  return realAdd(a, isRealZero(b) ? b : realNeg(b));
}

/** The firmware's `*`: the exact product rounded to 32 bits, halves away from zero. */
export function realMul(a: Real5, b: Real5): RealResult {
  const x = decodeReal(a);
  const y = decodeReal(b);
  if (x.mant === 0n || y.mant === 0n) return { bytes: [...REAL_ZERO], ok: true };
  const p = x.mant * y.mant; // [2^62, 2^64)
  const shift = p >> 63n ? 32n : 31n;
  let m = (p + (1n << (shift - 1n))) >> shift;
  let exp = x.exp + y.exp - 160 + Number(shift);
  if (m >> 32n) {
    m >>= 1n;
    exp++;
  }
  return pack(x.neg !== y.neg, m, exp);
}

/** The firmware's `/`: the exact quotient rounded to 32 bits, halves away from zero. */
export function realDiv(a: Real5, b: Real5): RealResult {
  const x = decodeReal(a);
  const y = decodeReal(b);
  if (y.mant === 0n) return { bytes: maxFor(x.mant !== 0n && x.neg), ok: false };
  if (x.mant === 0n) return { bytes: [...a], ok: true };
  const n = x.mant << 33n;
  const k = n / y.mant >= 1n << 33n ? 2n : 1n;
  const d = y.mant << k;
  let m = (2n * n + d) / (2n * d);
  let exp = x.exp - y.exp + 127 + Number(k);
  if (m >> 32n) {
    m >>= 1n;
    exp++;
  }
  return pack(x.neg !== y.neg, m, exp);
}

/** Adds `n` (signed) to the exponent byte (the 464's EXPADD). */
export function realExpAdd(a: Real5, n: number): RealResult {
  const e = a[4]! + n;
  if (a[4] === 0) return { bytes: [...a], ok: true };
  if (e > 255) return { bytes: maxFor((a[3]! & 0x80) !== 0), ok: false };
  if (e < 1) return { bytes: [a[0]!, a[1]!, a[2]!, a[3]!, 0], ok: true };
  return { bytes: [a[0]!, a[1]!, a[2]!, a[3]!, e], ok: true };
}

// ---------------------------------------------------------------------------------------------
// Conversions

/** An exact rational |x| = num / 2^sh (sh >= 0) for a REAL: the magnitude as `mant >> (160 - exp)`. */
function magnitudeParts(b: Real5): { whole: bigint; fracNum: bigint; fracBits: bigint } {
  const x = decodeReal(b);
  if (x.mant === 0n) return { whole: 0n, fracNum: 0n, fracBits: 0n };
  const sh = 160 - x.exp; // value = mant / 2^sh
  if (sh <= 0) return { whole: x.mant << BigInt(-sh), fracNum: 0n, fracBits: 0n };
  if (sh > 64) return { whole: 0n, fracNum: 1n, fracBits: 65n }; // below 2^-33: a tiny non-zero fraction
  const s = BigInt(sh);
  return { whole: x.mant >> s, fracNum: x.mant & ((1n << s) - 1n), fracBits: s };
}

export type BinRounding = 'round' | 'trunc' | 'floor';

export interface RealToBin {
  /** The 32-bit magnitude (undefined when the value does not fit). */
  readonly value: number | undefined;
  /** The sign of the operand (the firmware's B bit 7), also for a result of zero. */
  readonly neg: boolean;
  /** Carry: the value fits 32 bits. */
  readonly ok: boolean;
}

/**
 * REAL to a 32-bit magnitude: `round` (REAL2BIN: halves away from zero), `trunc` (FIX: toward
 * zero) or `floor` (INT: the magnitude of the floor). A magnitude of 2^32 or more does not fit.
 */
export function realToBin(b: Real5, mode: BinRounding): RealToBin {
  const x = decodeReal(b);
  const { whole, fracNum, fracBits } = magnitudeParts(b);
  let v = whole;
  const hasFrac = fracNum !== 0n;
  if (mode === 'round') {
    if (hasFrac && fracNum >= 1n << (fracBits - 1n) && fracBits <= 64n) v += 1n;
  } else if (mode === 'floor' && x.neg && hasFrac) v += 1n;
  if (v >= M32) return { value: undefined, neg: x.neg, ok: false };
  return { value: Number(v), neg: x.neg, ok: true };
}

export interface RealToInt16 {
  /** The magnitude 0..65535, or undefined: the entry left HL alone (`unchanged`) or returned 0 (`zero`). */
  readonly value: number | undefined;
  readonly onFail: 'unchanged' | 'zero' | undefined;
  /** The S flag: the operand is negative. */
  readonly negative: boolean;
  /** Carry: the rounded magnitude fits 16 bits. */
  readonly ok: boolean;
}

/** REAL to a 16-bit magnitude, rounded half away from zero (the firmware's REAL2INT). */
export function realToInt16(b: Real5): RealToInt16 {
  const r = realToBin(b, 'round');
  // S is set for a negative operand whose rounded magnitude is not zero (-0.3 gives 0 with S clear).
  const negative = r.neg && b[4] !== 0;
  if (r.ok && r.value! <= 0xffff) return { value: r.value, onFail: undefined, negative: negative && r.value !== 0, ok: true };
  // 65535.5 rounds up to 65536 and the entry returns HL = 0 (measured); 65536 itself and everything
  // larger leave HL alone.
  const t = realToBin(b, 'trunc');
  return { value: undefined, onFail: t.ok && t.value === 0xffff ? 'zero' : 'unchanged', negative, ok: false };
}

/** A normalised REAL of a non-negative integer below 2^32 (A bit 7 gives the sign; zero has none). */
export function binToReal(value: number, neg: boolean): number[] {
  if (value === 0) return [...REAL_ZERO];
  const v = BigInt(value);
  const bits = v.toString(2).length;
  return encodeReal(neg, v << BigInt(32 - bits), 128 + bits);
}

/** The firmware's INT2REAL: an unsigned 16-bit integer to a REAL. */
export function int16ToReal(value: number, neg: boolean): number[] {
  return binToReal(value & 0xffff, neg);
}

// ---------------------------------------------------------------------------------------------
// JS numbers (for approximations only)

export function realToNumber(b: Real5): number {
  const x = decodeReal(b);
  if (x.mant === 0n) return 0;
  const v = Number(x.mant) * 2 ** (x.exp - 160);
  return x.neg ? -v : v;
}

/** The nearest REAL to a JS number (halves away from zero); overflow saturates with ok = false. */
export function realFromNumber(v: number): RealResult {
  if (Number.isNaN(v)) return { bytes: [...REAL_MAX_POS], ok: false };
  if (v === 0) return { bytes: [...REAL_ZERO], ok: true };
  const neg = v < 0;
  const a = Math.abs(v);
  if (!Number.isFinite(a)) return { bytes: maxFor(neg), ok: false };
  let e = Math.floor(Math.log2(a)) + 1; // a in [2^(e-1), 2^e)
  if (a / 2 ** e >= 1) e++;
  else if (a / 2 ** e < 0.5) e--;
  if (e + 128 < 0) return { bytes: [...REAL_ZERO], ok: true };
  if (e + 128 > 256) return { bytes: maxFor(neg), ok: false };
  // scaled in [2^31, 2^32): exact in a double (53 bits)
  const scaled = a * 2 ** (32 - e);
  let m = BigInt(Math.floor(scaled));
  if (scaled - Number(m) >= 0.5) m += 1n;
  if (m >> 32n) {
    m >>= 1n;
    e++;
  }
  return pack(neg, m, e + 128);
}

/**
 * REAL x 10^n. APPROXIMATE: the correctly rounded product. The firmware agrees on 170 of its 200
 * recorded vectors and is one unit in the last place away on the others (the firmware's intermediate precision is not understood).
 */
export function realMul10(a: Real5, n: number): RealResult {
  if (n === 0 || a[4] === 0) return { bytes: [...a], ok: true };
  const x = decodeReal(a);
  const p = 10n ** BigInt(Math.abs(n));
  const num = n > 0 ? x.mant * p : x.mant;
  const den = n > 0 ? 1n : p;
  // value = num / den * 2^(exp - 160); find s with 2^31 <= (num << s) / den < 2^32
  let s = 31 - (num.toString(2).length - den.toString(2).length);
  const quot = (): bigint => (s >= 0 ? num << BigInt(s) : num >> BigInt(-s)) / den;
  while (quot() >= M32) s--;
  while (quot() < 0x8000_0000n) s++;
  const scaled = s >= 0 ? num << BigInt(s) : num;
  const d2 = s >= 0 ? den : den << BigInt(-s);
  let m = (2n * scaled + d2) / (2n * d2);
  let exp = x.exp - s;
  if (m >> 32n) {
    m >>= 1n;
    exp++;
  }
  return pack(x.neg, m, exp);
}

// ---------------------------------------------------------------------------------------------
// Literals

/** REAL(D) for a non-negative integer D: rounded to a 32-bit mantissa, halves away from zero. */
export function realFromBigInt(d: bigint): RealResult {
  if (d <= 0n) return { bytes: [...REAL_ZERO], ok: true };
  const bits = d.toString(2).length;
  let m: bigint;
  let exp = 128 + bits;
  if (bits <= 32) m = d << BigInt(32 - bits);
  else {
    const sh = BigInt(bits - 32);
    m = d >> sh;
    if (((d >> (sh - 1n)) & 1n) === 1n) m += 1n; // the halves go up
    if (m >> 32n) {
      m >>= 1n;
      exp++;
    }
  }
  return pack(false, m, exp);
}

/**
 * A decimal literal the way Locomotive's tokeniser makes it: the digits
 * as an integer D, rounded to a REAL, times 10^E (the firmware's MUL10A, here the APPROXIMATE `realMul10`, follow-up 56).
 * `value` is the literal's double: its shortest decimal digits are D (the trailing zeros of the source text are not
 * known, so 1.50 is 15 x 10^-1: the same value, but it can round differently).
 */
export function realLiteral(value: number): number[] {
  if (value === 0 || !Number.isFinite(value)) return [...REAL_ZERO];
  const neg = value < 0;
  const [mant, ex] = Math.abs(value).toExponential().split('e') as [string, string];
  const frac = mant.includes('.') ? mant.split('.')[1]!.length : 0;
  const d = BigInt(mant.replace('.', ''));
  const e = Number(ex) - frac;
  const r = realMul10(realFromBigInt(d).bytes, e);
  return neg ? realNeg(r.bytes) : r.bytes;
}

/**
 * The 5 bytes for a REAL constant of the compiler. A double that is exactly a REAL (every result of the model's
 * arithmetic, every small decimal such as 0.5 or 100) is encoded as it is; any other is a decimal literal and gets the
 * tokeniser's rule above. Too large saturates, too small is zero.
 */
export function realConstant(value: number): number[] {
  if (value === 0 || !Number.isFinite(value)) return [...REAL_ZERO];
  const exact = realFromNumber(value);
  if (exact.ok && realToNumber(exact.bytes) === value) return exact.bytes;
  return realLiteral(value);
}
