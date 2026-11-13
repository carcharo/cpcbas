/**
 * Constant folding with run-time semantics (spec section 5): integer arithmetic wraps in the operation's type, `/` and `\` truncate
 * towards zero, MOD takes the sign of the dividend, comparisons give -1 or 0, AND OR XOR
 * NOT are bitwise. Pure functions; the checker decides the operation's type first.
 */
import type { BinaryOp } from '../ast/ast.js';
import { isRealZero, realAdd, realConstant, realDiv, realMul, realSub, realToNumber, type RealResult } from '../core/locoreal.js';
import type { ConstValue } from '../sem/model.js';
import { integerRange, isInteger, type TypeName } from '../sem/types.js';

/** Result of folding: a value, 'div0' for a zero divisor, or null when the operation cannot be folded. */
export type Folded = ConstValue | 'div0' | null;

const num = (type: TypeName, value: number): ConstValue => ({ type, value });

function wrapBig(x: bigint, t: TypeName): number {
  const r = integerRange(t);
  if (r === null) return Number(x);
  const min = BigInt(r.min);
  const span = BigInt(r.max - r.min + 1);
  return Number(((((x - min) % span) + span) % span) + min);
}

const q = (x: number): number => Math.round(x * 65536) / 65536;
function wrapFixed(x: number): number {
  const v = q(x);
  return ((((v + 32768) % 65536) + 65536) % 65536) - 32768;
}

/** Converts a constant to a type as the generated code would (integers wrap; FIXED/REAL to integer truncate). Null for STRING <-> number. */
export function convertConst(c: ConstValue, to: TypeName): ConstValue | null {
  if (c.type === to) return c;
  if ((c.type === 'STRING') !== (to === 'STRING')) return null;
  const v = c.value as number;
  if (isInteger(to)) {
    const t = Number.isInteger(v) ? v : Math.trunc(v);
    if (!Number.isFinite(t)) return num(to, 0);
    return num(to, wrapBig(BigInt(t), to));
  }
  if (to === 'FIXED') return num(to, wrapFixed(v));
  return num(to, v);
}

/**
 * Folds a binary operation. Both operands are already converted to `opType` (the operation's
 * type; for shifts the left operand's type and `b` is the count in any integer type). The
 * result of a comparison is INTEGER -1 or 0.
 */
export function foldBinary(op: BinaryOp, a: ConstValue, b: ConstValue, opType: TypeName): Folded {
  if (opType === 'STRING') {
    const x = a.value as string;
    const y = b.value as string;
    switch (op) {
      case '+':
        return { type: 'STRING', value: x + y };
      case '=':
        return num('INTEGER', x === y ? -1 : 0);
      case '<>':
        return num('INTEGER', x !== y ? -1 : 0);
      case '<':
        return num('INTEGER', x < y ? -1 : 0);
      case '>':
        return num('INTEGER', x > y ? -1 : 0);
      case '<=':
        return num('INTEGER', x <= y ? -1 : 0);
      case '>=':
        return num('INTEGER', x >= y ? -1 : 0);
      default:
        return null;
    }
  }
  // A REAL constant is the REAL the run-time code holds: a decimal literal is rounded as Locomotive's tokeniser does
  const real = (v: number): number => realToNumber(realConstant(v));
  const x = opType === 'REAL' ? real(a.value as number) : (a.value as number);
  const y = opType === 'REAL' ? real(b.value as number) : (b.value as number);
  switch (op) {
    case '=':
      return num('INTEGER', x === y ? -1 : 0);
    case '<>':
      return num('INTEGER', x !== y ? -1 : 0);
    case '<':
      return num('INTEGER', x < y ? -1 : 0);
    case '>':
      return num('INTEGER', x > y ? -1 : 0);
    case '<=':
      return num('INTEGER', x <= y ? -1 : 0);
    case '>=':
      return num('INTEGER', x >= y ? -1 : 0);
    default:
      break;
  }
  if (isInteger(opType)) {
    const bx = BigInt(x);
    const by = BigInt(y);
    switch (op) {
      case '+':
        return num(opType, wrapBig(bx + by, opType));
      case '-':
        return num(opType, wrapBig(bx - by, opType));
      case '*':
        return num(opType, wrapBig(bx * by, opType));
      case '/':
      case '\\':
        return y === 0 ? 'div0' : num(opType, wrapBig(bx / by, opType));
      case 'MOD':
        return y === 0 ? 'div0' : num(opType, wrapBig(bx % by, opType));
      case 'AND':
        return num(opType, wrapBig(bx & by, opType));
      case 'OR':
        return num(opType, wrapBig(bx | by, opType));
      case 'XOR':
        return num(opType, wrapBig(bx ^ by, opType));
      case '<<':
      case '>>': {
        if (y < 0) return null;
        const n = BigInt(Math.min(y, 64));
        return num(opType, wrapBig(op === '<<' ? bx << n : bx >> n, opType));
      }
      default:
        return null;
    }
  }
  if (opType === 'REAL') return foldReal(op, x, y);
  // FIXED
  const fin = (v: number): ConstValue => (opType === 'FIXED' ? num(opType, wrapFixed(v)) : num(opType, v));
  switch (op) {
    case '+':
      return fin(x + y);
    case '-':
      return fin(x - y);
    case '*':
      return fin(x * y);
    case '/':
      return y === 0 ? 'div0' : fin(x / y);
    case '^':
      return Number.isFinite(Math.pow(x, y)) ? fin(Math.pow(x, y)) : null;
    default:
      return null;
  }
}

/**
 * REAL `+ - * /` with the firmware's rounding after every operation (src/core/locoreal.ts reproduces every
 * recorded vector), so a folded constant is the REAL the program would compute. An overflow is not folded (the run
 * time raises error 6). `^` is the firmware's POW, which cannot be modelled: only a whole base to a whole
 * power whose exact value is a REAL (a non-negative power, or a power of two to a negative one) is folded (the recorded vectors of that kind are exact).
 */
function foldReal(op: BinaryOp, x: number, y: number): Folded {
  const A = realConstant(x);
  const B = realConstant(y);
  let r: RealResult;
  switch (op) {
    case '+':
      r = realAdd(A, B);
      break;
    case '-':
      r = realSub(A, B);
      break;
    case '*':
      r = realMul(A, B);
      break;
    case '/':
      if (isRealZero(B)) return 'div0';
      r = realDiv(A, B);
      break;
    case '^': {
      if (!Number.isInteger(x) || !Number.isInteger(y) || y > 128 || y < -128) return null;
      if (y < 0) {
        // a power of two to a negative power is exact (recorded: 2^-1, 2^-2, -2^-1, -8^-1)
        const ax = Math.abs(x);
        const v = x ** y;
        return ax > 0 && Number.isInteger(Math.log2(ax)) && v !== 0 && Math.abs(v) >= 2 ** -126 ? num('REAL', v) : null;
      }
      const p = BigInt(x) ** BigInt(y);
      const m = (p < 0n ? -p : p).toString(2).replace(/0+$/, '').length;
      if (m > 32 || (p < 0n ? -p : p).toString(2).length > 127) return null;
      return num('REAL', Number(p));
    }
    default:
      return null;
  }
  return r.ok ? num('REAL', realToNumber(r.bytes)) : null;
}

/** Folds unary minus and bitwise NOT; `a` is already of the result type. */
export function foldUnary(op: '-' | '+' | 'NOT', a: ConstValue): ConstValue | null {
  if (a.type === 'STRING') return null;
  const x = a.value as number;
  if (op === '+') return a;
  if (op === '-') {
    if (isInteger(a.type)) return num(a.type, wrapBig(-BigInt(x), a.type));
    return a.type === 'FIXED' ? num(a.type, wrapFixed(-x)) : num(a.type, -x);
  }
  if (!isInteger(a.type)) return null;
  return num(a.type, wrapBig(~BigInt(x), a.type));
}

const strVal = (c: ConstValue | undefined): string | null => (c !== undefined && typeof c.value === 'string' ? c.value : null);
/** A whole number in 0..255 (a count, a position or a character code), else null. */
const byteVal = (c: ConstValue | undefined): number | null =>
  c !== undefined && typeof c.value === 'number' && Number.isInteger(c.value) && c.value >= 0 && c.value <= 255 ? c.value : null;

/** The text of a number as STR$ gives it: a space or `-`, then the digits. Only whole numbers below 1E+9 here. */
function numberText(x: number): string | null {
  if (!Number.isInteger(x) || Math.abs(x) >= 1e9) return null;
  return (x < 0 ? '-' : ' ') + String(Math.abs(x));
}

/**
 * Folds a built-in function of constant arguments with its run-time semantics (the lowering in
 * `ir/lower/builtins.ts` and `strings.ts`). `rt` is the type the checker gave the call. Null when
 * the call has no constant value: an argument outside what the run-time routine accepts (those
 * raise error 5 or 6 at run time), a REAL STR$ that is not a whole number below 1E+9, or a
 * keyword not listed.
 */
export function foldBuiltin(keyword: string, args: readonly ConstValue[], rt: TypeName): ConstValue | null {
  const [a, b, c] = args;
  const n = (v: ConstValue | undefined): number => (v?.value ?? 0) as number;
  switch (keyword) {
    case 'ABS': {
      const v = a && convertConst(a, rt);
      if (!v) return null;
      return isInteger(rt) ? num(rt, wrapBig(BigInt(Math.abs(n(v))), rt)) : num(rt, rt === 'FIXED' ? wrapFixed(Math.abs(n(v))) : Math.abs(n(v)));
    }
    case 'SGN':
      return a && a.type !== 'STRING' ? num('INTEGER', Math.sign(n(a)) + 0) : null;
    case 'MIN':
    case 'MAX': {
      const vs = args.map((x) => convertConst(x, rt));
      if (vs.length === 0 || vs.some((x) => x === null)) return null;
      const xs = vs.map((x) => n(x ?? undefined));
      return num(rt, keyword === 'MIN' ? Math.min(...xs) : Math.max(...xs));
    }
    case 'CINT': {
      if (!a || a.type === 'STRING') return null;
      const x = n(a);
      // an integer outside INTEGER's range is not folded: CINT of it is Overflow at run time (L4-ERR)
      if (isInteger(a.type)) return x >= -32768 && x <= 32767 ? convertConst(a, 'INTEGER') : null;
      const r = x < 0 ? -Math.floor(-x + 0.5) : Math.floor(x + 0.5);
      return r >= -32768 && r <= 32767 ? num('INTEGER', r + 0) : null;
    }
    case 'UNT':
      return a && a.type !== 'STRING' && Number.isInteger(n(a)) ? convertConst(a, 'INTEGER') : null;
    case 'LEN': {
      const s = strVal(a);
      return s === null ? null : num('UINTEGER', s.length);
    }
    case 'ASC': {
      const s = strVal(a);
      return s === null || s === '' ? null : num('UBYTE', s.charCodeAt(0));
    }
    case 'CHR$': {
      const k = byteVal(a);
      return k === null ? null : { type: 'STRING', value: String.fromCharCode(k) };
    }
    case 'SPACE$': {
      const k = byteVal(a);
      return k === null ? null : { type: 'STRING', value: ' '.repeat(k) };
    }
    case 'STRING$': {
      const k = byteVal(a);
      const s = strVal(b);
      const code = s !== null ? (s === '' ? null : s.charCodeAt(0)) : byteVal(b);
      return k === null || code === null ? null : { type: 'STRING', value: String.fromCharCode(code).repeat(k) };
    }
    case 'LEFT$':
    case 'RIGHT$': {
      const s = strVal(a);
      const k = byteVal(b);
      if (s === null || k === null) return null;
      return { type: 'STRING', value: keyword === 'LEFT$' ? s.slice(0, k) : k === 0 ? '' : s.slice(-k) };
    }
    case 'MID$': {
      const s = strVal(a);
      const p = byteVal(b);
      const k = c === undefined ? 255 : byteVal(c);
      if (s === null || p === null || p < 1 || k === null) return null;
      return { type: 'STRING', value: s.substr(p - 1, k) };
    }
    case 'STR$': {
      const t = a && a.type !== 'STRING' ? numberText(n(a)) : null;
      return t === null ? null : { type: 'STRING', value: t };
    }
    default:
      return null;
  }
}
