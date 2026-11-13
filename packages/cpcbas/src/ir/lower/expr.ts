/**
 * Expression lowering: a checked expression to stack quads (docs/ir.md, "Evaluation
 * model"). `lowerExpr` returns the value after the checker's recorded conversion.
 *
 * Operands that need no code stay as operands (`imm`, `global`, `addr`) so the integer
 * templates load them directly; anything computed is a temp. Evaluation order is the
 * source order, and a temp is consumed by the first quad after it that needs it, so the
 * LIFO rule of the verifier holds by construction. A variable read is only left lazy
 * when nothing evaluated after it can change it (no procedure call to its right).
 *
 * Strings (L2-STRLOWER): a constant is a `strconst` operand (the empty string is `imm 0`) and a
 * variable is its `global`, both borrowed; a computed string is an owned temp that exactly one
 * later quad consumes (a store takes it, a compare, a concat, an `fparam:str` or a built-in
 * frees it), so no explicit free is ever emitted. `+` on strings is `concat`, the comparisons
 * give -1/0.
 */
import type { BinaryExpr, Expr, UnaryExpr } from '../../ast/ast.js';
import { InternalError } from '../../core/diagnostics.js';
import { convertConst } from '../../checker/fold.js';
import type { Span } from '../../core/source.js';
import type { VariableSymbol } from '../../sem/model.js';
import { irType, wrap, type IrType, type TypeName } from '../../sem/types.js';
import type { BinaryOp, CompareOp } from '../ir.js';
import { lowerElementAddress, lowerElementRead } from './array.js';
import { lowerBuiltinCall } from './builtins.js';
import type { LowerCtx, Val } from './context.js';
import { lowerCallExpr } from './pending.js';

const TYPE_NAME: Readonly<Record<IrType, TypeName>> = {
  u8: 'UBYTE',
  i8: 'BYTE',
  u16: 'UINTEGER',
  i16: 'INTEGER',
  u32: 'ULONG',
  i32: 'LONG',
  f16: 'FIXED',
  f: 'REAL',
  str: 'STRING',
};

const isIntType = (t: IrType): boolean => t !== 'f' && t !== 'f16' && t !== 'str';

const ARITH: Readonly<Partial<Record<string, BinaryOp>>> = {
  '+': 'add',
  '-': 'sub',
  '*': 'mul',
  '/': 'div',
  '\\': 'div',
  MOD: 'mod',
  AND: 'and',
  OR: 'or',
  XOR: 'xor',
  '^': 'pow',
  '<<': 'shl',
  '>>': 'shr',
};

const COMPARE: Readonly<Partial<Record<string, CompareOp>>> = { '=': 'eq', '<>': 'ne', '<': 'lt', '>': 'gt', '<=': 'le', '>=': 'ge' };

/** An immediate of the IR type `t` for a number. */
export function immOf(value: number, t: IrType): Val {
  return { o: { k: 'imm', value: isIntType(t) ? wrap(value, TYPE_NAME[t]) : value }, t };
}

/** Converts `v` to the type `to` (spec §4); an immediate is converted at compile time. */
export function castTo(ctx: LowerCtx, v: Val, to: IrType, span: Span): Val {
  if (v.t === to) return v;
  if (v.t === 'str' || to === 'str') {
    ctx.notYet(span, 'Conversion between numbers and strings');
    return v;
  }
  if (v.o.k === 'imm') return immOf(isIntType(to) ? Math.trunc(v.o.value) : v.o.value, to);
  return { o: ctx.b.cast(to, v.t, v.o, span), t: to };
}

/** A temp holding `v` (immediates and temps stay as they are). */
export function materialize(ctx: LowerCtx, v: Val, span: Span): Val {
  if (v.o.k === 'temp' || v.o.k === 'imm') return v;
  return { o: ctx.b.load(v.t, v.o, span), t: v.t };
}

/** Whether evaluating `e` can run a user procedure (which may change any global). */
export function mayCall(ctx: LowerCtx, e: Expr): boolean {
  switch (e.kind) {
    case 'FnCall':
      return true;
    case 'CallOrIndex': {
      const id = ctx.checked.bound.resolutions.callOrIndex.get(e);
      return (id !== undefined && ctx.sym(id).kind !== 'array') || e.args.some((a) => mayCall(ctx, a));
    }
    case 'Name': {
      const id = ctx.checked.bound.resolutions.names.get(e);
      return id !== undefined && ctx.sym(id).kind === 'procedure';
    }
    case 'Unary':
      return mayCall(ctx, e.operand);
    case 'Binary':
      return mayCall(ctx, e.left) || mayCall(ctx, e.right);
    case 'BuiltinCall':
      return e.args.some((a) => mayCall(ctx, a));
    default:
      return false;
  }
}

/** The value of `e` in the type the checker converted it to; null after an error was reported. */
export function lowerExpr(ctx: LowerCtx, e: Expr): Val | null {
  const base = lowerRaw(ctx, e);
  if (base === null) return null;
  const to = ctx.checked.coercions.get(e);
  return to === undefined ? base : castTo(ctx, base, irType(to), e.span);
}

/**
 * `lowerExpr` without the checker's coercion: the value of `e` in its own type (L4-ERR: CINT must see the argument's own
 * type; L4-GFX: a graphics argument is rounded as CINT does, not truncated).
 */
export function lowerRaw(ctx: LowerCtx, e: Expr): Val | null {
  const type = ctx.typeOf(e);
  const c = ctx.checked.constants.get(e);
  if (type === 'STRING' && c !== undefined && typeof c.value === 'string') return stringConstant(ctx, c.value);
  if (c !== undefined && typeof c.value === 'number') {
    const v = c.type === type ? c.value : (convertConst(c, type)?.value ?? c.value);
    return immOf(v as number, irType(type));
  }
  switch (e.kind) {
    case 'NumberLit':
      throw new InternalError('lowering: a number literal without a folded value');
    case 'StringLit':
      return stringConstant(ctx, e.value);
    case 'Name': {
      const id = ctx.checked.bound.resolutions.names.get(e);
      const s = id === undefined ? undefined : ctx.sym(id);
      if (s?.kind === 'variable') {
        const o = ctx.varOperand(s, e.span);
        return o === null ? null : { o, t: irType(s.type) };
      }
      return lowerCallExpr(ctx, e);
    }
    case 'Unary':
      return lowerUnary(ctx, e);
    case 'Binary':
      return lowerBinary(ctx, e);
    case 'AddressOf': {
      const id = ctx.checked.bound.resolutions.names.get(e.target);
      const s = id === undefined ? undefined : ctx.sym(id);
      if (s?.kind === 'array') return lowerElementAddress(ctx, s, e.index ?? null, e.span);
      if (s?.kind === 'procedure' || s?.kind === 'label') return { o: { k: 'addr', label: s.label }, t: 'u16' };
      if (s?.kind === 'variable') return lowerVariableAddress(ctx, s, e.span);
      ctx.notYet(e.span, '@ of this kind of name');
      return null;
    }
    case 'CallOrIndex': {
      const id = ctx.checked.bound.resolutions.callOrIndex.get(e);
      const sym = id === undefined ? undefined : ctx.sym(id);
      if (sym?.kind === 'array') return lowerElementRead(ctx, e, sym);
      return lowerCallExpr(ctx, e);
    }
    case 'FnCall':
      return lowerCallExpr(ctx, e);
    case 'BuiltinCall':
      return lowerBuiltinCall(ctx, e);
    case 'BadExpr':
      throw new InternalError('lowering: a bad expression reached the lowering');
  }
}

/**
 * `@v`: the address of the variable's own storage. A global is its label; a local or a BYVAL
 * parameter is `frameaddr`; a BYREF parameter already holds the address of the caller's variable.
 * For a string it is the 2-byte slot that holds the heap pointer (a CALL argument gets the 3-byte
 * descriptor instead: `lowerCall`).
 */
function lowerVariableAddress(ctx: LowerCtx, s: VariableSymbol, span: Span): Val | null {
  const slot = ctx.slots.get(s.id);
  if (slot !== undefined) {
    if (slot.k !== 'frame') throw new InternalError('lowering: a variable slot that is not a frame operand');
    if (slot.byref === true) return { o: ctx.b.load('u16', { k: 'frame', offset: slot.offset }, span), t: 'u16' };
    return { o: { k: 'frameaddr', offset: slot.offset }, t: 'u16' };
  }
  if (s.storage === 'global' && s.label !== null) return { o: { k: 'addr', label: s.label }, t: 'u16' };
  ctx.notYet(span, `@ of '${s.name}'`);
  return null;
}

/** A string constant as a borrowed operand: the pool entry, or `imm 0` (the empty string) for "". */
export function stringConstant(ctx: LowerCtx, text: string): Val {
  return { o: text === '' ? { k: 'imm', value: 0 } : { k: 'strconst', id: ctx.stringId(text) }, t: 'str' };
}

/** `a$ + b$` (concat, owned result) and the six comparisons of strings (-1 / 0). */
function lowerStringBinary(ctx: LowerCtx, e: BinaryExpr): Val | null {
  let l = lowerExpr(ctx, e.left);
  if (l === null) return null;
  // A string variable read stays lazy unless a procedure call to its right could change it.
  if (l.o.k !== 'imm' && l.o.k !== 'temp' && l.o.k !== 'strconst' && mayCall(ctx, e.right)) l = materialize(ctx, l, e.span);
  const r = lowerExpr(ctx, e.right);
  if (r === null) return null;
  if (e.op === '+') return { o: ctx.b.concat(l.o, r.o, e.span), t: 'str' };
  const cmp = COMPARE[e.op];
  if (cmp === undefined) throw new InternalError(`lowering: string operator ${e.op}`);
  return { o: ctx.b.compare(cmp, 'str', l.o, r.o, e.span), t: 'i16' };
}

function lowerUnary(ctx: LowerCtx, e: UnaryExpr): Val | null {
  const v = lowerExpr(ctx, e.operand);
  if (v === null) return null;
  if (e.op === '+') return v;
  return { o: e.op === '-' ? ctx.b.neg(v.t, v.o, e.span) : ctx.b.not(v.t, v.o, e.span), t: v.t };
}

function lowerBinary(ctx: LowerCtx, e: BinaryExpr): Val | null {
  if (ctx.typeOf(e.left) === 'STRING') return lowerStringBinary(ctx, e);
  let l = lowerExpr(ctx, e.left);
  if (l === null) return null;
  // A variable read stays lazy unless a procedure call to its right could change it.
  if (l.o.k !== 'imm' && l.o.k !== 'temp' && mayCall(ctx, e.right)) l = materialize(ctx, l, e.span);
  let r = lowerExpr(ctx, e.right);
  if (r === null) return null;
  const cmp = COMPARE[e.op];
  if (cmp !== undefined) {
    r = castTo(ctx, r, l.t, e.span);
    return { o: ctx.b.compare(cmp, l.t, l.o, r.o, e.span), t: 'i16' };
  }
  const op = ARITH[e.op];
  if (op === undefined) throw new InternalError(`lowering: operator ${e.op}`);
  if (op === 'shl' || op === 'shr') r = castTo(ctx, r, 'u8', e.span);
  else r = castTo(ctx, r, l.t, e.span);
  return { o: ctx.b.binary(op, l.t, l.o, r.o, e.span), t: l.t };
}
