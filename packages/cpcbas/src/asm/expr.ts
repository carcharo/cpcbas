/**
 * Asm expressions: the tree the parser builds and the evaluator. Evaluation follows the
 * reference (expr.py): integers of any size, `/` is floor division, `%` takes the sign of
 * the divisor, `^` is a power, `~` is xor, and a label is looked up when the expression is
 * evaluated (an EQU holds its expression, so forward references work).
 */
import type { DiagnosticCode } from '../core/diagnostics.js';
import type { Span } from '../core/source.js';

/** A label, as the reference keeps it: a value that is an address, an expression (EQU) or still unknown. */
export interface Lbl {
  readonly name: string;
  /** Where it was defined (or first used while still undefined). */
  span: Span;
  value: number | Expr | null;
  local: boolean;
  namespace: string;
  isAddress: boolean;
  /** Cached result once the value has been evaluated. */
  cached: number | null;
  evaluating: boolean;
  /** True once an "undefined" error has been reported for it. */
  reported: boolean;
}

/** A reference to a temporary label (`1f`, `1b`), resolved at the end of its ORG segment. */
export interface TmpRef {
  readonly name: string;
  readonly dir: -1 | 1;
  readonly namespace: string;
  readonly seq: number;
  readonly span: Span;
  value: number | null;
}

export type Expr =
  | { readonly k: 'int'; readonly v: number }
  | { readonly k: 'lbl'; readonly lbl: Lbl; readonly span: Span }
  | { readonly k: 'tmp'; readonly ref: TmpRef; readonly span: Span }
  | { readonly k: 'un'; readonly op: '-' | '+'; readonly e: Expr }
  | { readonly k: 'bin'; readonly op: string; readonly l: Expr; readonly r: Expr; readonly span: Span };

export interface EvalHost {
  report(code: DiagnosticCode, span: Span, message: string, hint?: string): void;
}

function isInt32(n: number): boolean {
  return n >= -2147483648 && n < 2147483648;
}

function bitop(op: string, a: number, b: number): number {
  if (isInt32(a) && isInt32(b)) {
    if (op === '&') return a & b;
    if (op === '|') return a | b;
    return a ^ b;
  }
  const x = BigInt(a);
  const y = BigInt(b);
  const r = op === '&' ? x & y : op === '|' ? x | y : x ^ y;
  return Number(r);
}

/** Applies a binary operator; returns null (after reporting) when it cannot. */
function apply(op: string, a: number, b: number, span: Span, host: EvalHost): number | null {
  switch (op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      if (b === 0) {
        host.report('E527', span, 'Division by 0');
        return null;
      }
      return Math.floor(a / b);
    case '%':
      if (b === 0) {
        host.report('E527', span, 'Division by 0');
        return null;
      }
      return ((a % b) + b) % b;
    case '^': {
      if (b < 0) {
        host.report('E536', span, 'Negative exponent: the result is not a whole number');
        return null;
      }
      return a ** b;
    }
    case '&':
    case '|':
    case '~':
      return bitop(op, a, b);
    case '<<':
      return b < 0 ? null : a * 2 ** b;
    case '>>':
      return b < 0 ? null : Math.floor(a / 2 ** b);
    default:
      return null;
  }
}

/** Evaluates `e`. A label with no value yet gives `null` (an error E520 at the use, when `report` is true). */
export function evalExpr(e: Expr, host: EvalHost, report: boolean): number | null {
  switch (e.k) {
    case 'int':
      return e.v;
    case 'un': {
      const v = evalExpr(e.e, host, report);
      return v === null ? null : e.op === '-' ? -v : v;
    }
    case 'bin': {
      const a = evalExpr(e.l, host, report);
      const b = evalExpr(e.r, host, report);
      if (a === null || b === null) return null;
      return apply(e.op, a, b, e.span, host);
    }
    case 'tmp': {
      if (e.ref.value !== null) return e.ref.value;
      if (report) host.report('E520', e.span, `Undefined temporary label '${e.ref.name}${e.ref.dir === 1 ? 'f' : 'b'}'`);
      return null;
    }
    case 'lbl': {
      const v = labelValue(e.lbl, host, report);
      if (v === null && e.lbl.value === null && report) {
        e.lbl.reported = true;
        host.report('E520', e.span, `Undefined label '${e.lbl.name}'`);
      }
      return v;
    }
  }
}

/** The value of a label, or null when it has none (yet). */
export function labelValue(lbl: Lbl, host: EvalHost, report: boolean): number | null {
  if (lbl.cached !== null) return lbl.cached;
  const value = lbl.value;
  if (value === null) return null;
  if (typeof value === 'number') {
    lbl.cached = value;
    return value;
  }
  if (lbl.evaluating) {
    if (report) host.report('E528', lbl.span, `'${lbl.name}' is defined in terms of itself`);
    return null;
  }
  lbl.evaluating = true;
  const r = evalExpr(value, host, report);
  lbl.evaluating = false;
  if (r !== null) lbl.cached = r;
  return r;
}
