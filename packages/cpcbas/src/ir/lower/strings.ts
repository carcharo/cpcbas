/**
 * Lowering of the string built-ins (L2-CG-STR), for L2-LOWER's builtin dispatch: the lowering
 * evaluates the arguments (strings as `str` operands, numbers already converted to INTEGER)
 * and calls {@link lowerStringBuiltin}, which appends the quads and returns the result temp.
 *
 * Every built-in is a `rtcall` into lib/loco/str.asm (or the imported runtime). Two argument
 * conventions, chosen per built-in:
 *  - one argument, in the result registers (`fparam`, then `rtcall`): a string goes in HL with
 *    the free flag in A, set by the `fparam:str` template (1 for an owned temp, 0 for a
 *    variable or constant), so the routine frees a temp argument itself; a number goes in HL;
 *  - several arguments, on the stack: the arguments are `param`ed so that the first is
 *    deepest and the last on top (the routine pops them itself); a string on the stack is
 *    always owned, so a variable or constant is first copied by `load`. The `param`s are
 *    written last argument first, which for temps pushed in order is a no-op and keeps the
 *    verifier's last-in first-out rule.
 * Arguments are given in evaluation order: a non-temp operand may not come before a temp
 * (the temp would already be on the stack, under the load).
 *
 * | Built-in | Arguments | Entry | Result |
 * |---|---|---|---|
 * | LEN(s$) | fparam s$ | `__LOCO_LEN` | u16 |
 * | ASC(s$) | fparam s$ | `__LOCO_ASC` | u8 (error 5 for the empty string) |
 * | VAL(s$) | fparam s$ | `__LOCO_VAL` | f |
 * | UPPER$(s$), LOWER$(s$) | fparam s$ | `__LOCO_UPPER`, `__LOCO_LOWER` | str |
 * | CHR$(n), SPACE$(n) | fparam n (i16) | `__LOCO_CHR`, `__LOCO_SPACE` | str |
 * | STRING$(n, c) | n, c (i16: the code; STRING$(n, c$) passes ASC(c$), so "" is error 5) | `__LOCO_STRING` | str |
 * | LEFT$(s$, n), RIGHT$(s$, n) | s$, n | `__LOCO_LEFT`, `__LOCO_RIGHT` | str |
 * | MID$(s$, p [, n]) | s$, p [, n] | `__LOCO_MID2`, `__LOCO_MID` | str |
 * | INSTR([start,] a$, b$) | [start,] a$, b$ | `__LOCO_INSTR`, `__LOCO_INSTR3` | u16 |
 * | STR$(n) | a `cast` from the number's type to str (`cast:<type>->str`) | | str |
 *
 * Counts and positions are INTEGER; a negative one, MID$ and INSTR positions of 0 and CHR$
 * codes outside 0..255 raise error 5 at run time. REAL and FIXED arguments to STR$ are a later
 * task (L2-CG-REAL).
 */

import type { BuiltinCall } from '../../ast/ast.js';
import { InternalError } from '../../core/diagnostics.js';
import type { Span } from '../../core/source.js';
import type { IrBuilder } from '../builder.js';
import type { IrType, Operand, Quad } from '../ir.js';
import type { LowerCtx, Val } from './context.js';
import { castTo, lowerExpr } from './expr.js';

export type StringBuiltin = 'LEN' | 'ASC' | 'VAL' | 'UPPER$' | 'LOWER$' | 'CHR$' | 'SPACE$' | 'STRING$' | 'LEFT$' | 'RIGHT$' | 'MID$' | 'INSTR' | 'STR$';

interface Entry {
  readonly label: string;
  readonly ret: IrType;
}

const ONE_REG: Readonly<Record<string, { entry: Entry; arg: IrType }>> = {
  LEN: { entry: { label: '.core.__LOCO_LEN', ret: 'u16' }, arg: 'str' },
  ASC: { entry: { label: '.core.__LOCO_ASC', ret: 'u8' }, arg: 'str' },
  VAL: { entry: { label: '.core.__LOCO_VAL', ret: 'f' }, arg: 'str' },
  'UPPER$': { entry: { label: '.core.__LOCO_UPPER', ret: 'str' }, arg: 'str' },
  'LOWER$': { entry: { label: '.core.__LOCO_LOWER', ret: 'str' }, arg: 'str' },
  'CHR$': { entry: { label: '.core.__LOCO_CHR', ret: 'str' }, arg: 'i16' },
  'SPACE$': { entry: { label: '.core.__LOCO_SPACE', ret: 'str' }, arg: 'i16' },
};

/** Stack built-ins by name and argument count: the entry and the argument types (first to last). */
const ON_STACK: Readonly<Record<string, Readonly<Record<number, { entry: Entry; args: readonly IrType[] }>>>> = {
  'STRING$': { 2: { entry: { label: '.core.__LOCO_STRING', ret: 'str' }, args: ['i16', 'i16'] } },
  'LEFT$': { 2: { entry: { label: '.core.__LOCO_LEFT', ret: 'str' }, args: ['str', 'i16'] } },
  'RIGHT$': { 2: { entry: { label: '.core.__LOCO_RIGHT', ret: 'str' }, args: ['str', 'i16'] } },
  'MID$': {
    2: { entry: { label: '.core.__LOCO_MID2', ret: 'str' }, args: ['str', 'i16'] },
    3: { entry: { label: '.core.__LOCO_MID', ret: 'str' }, args: ['str', 'i16', 'i16'] },
  },
  INSTR: {
    2: { entry: { label: '.core.__LOCO_INSTR', ret: 'u16' }, args: ['str', 'str'] },
    3: { entry: { label: '.core.__LOCO_INSTR3', ret: 'u16' }, args: ['i16', 'str', 'str'] },
  },
};

/**
 * Appends the quads of built-in `name` applied to `args` (in evaluation order) and returns the
 * result temp. `STR$` is not here: it is `b.cast('str', fromType, a)`.
 */
export function lowerStringBuiltin(b: IrBuilder, name: Exclude<StringBuiltin, 'STR$'>, args: readonly Operand[], span: Span | null = null): Operand {
  const one = ONE_REG[name];
  if (one !== undefined) {
    if (args.length !== 1) throw new InternalError(`${name} takes one argument, got ${args.length}`);
    const a = args[0] as Operand;
    b.push({ op: 'fparam', type: one.arg, a, span });
    const dst = b.temp();
    b.push({ op: 'rtcall', label: one.entry.label, ret: one.entry.ret, dst, span });
    return dst;
  }
  const many = ON_STACK[name]?.[args.length];
  if (many === undefined) throw new InternalError(`${name} does not take ${args.length} arguments`);
  const temps = args.map((a, i): Operand => {
    if (a.k === 'temp') return a;
    if (args.slice(i + 1).some((x) => x.k === 'temp')) {
      throw new InternalError(`${name}: a borrowed argument cannot come before a temp (evaluation order)`);
    }
    return b.load(many.args[i] as IrType, a, span);
  });
  for (let i = temps.length - 1; i >= 0; i--) b.push({ op: 'param', type: many.args[i] as IrType, a: temps[i] as Operand, span } as Quad);
  const dst = b.temp();
  b.push({ op: 'rtcall', label: many.entry.label, ret: many.entry.ret, dst, span });
  return dst;
}

// ---------------------------------------------------------------------------
// The AST side: evaluating the arguments of a built-in call (L2-STRLOWER)
// ---------------------------------------------------------------------------

/** One argument: a thunk that lowers it (conversions applied) and the IR type the built-in wants. */
interface ArgPlan {
  readonly type: IrType;
  readonly value: () => Val | null;
}

/**
 * Evaluates the arguments in source order and returns them as operands that
 * {@link lowerStringBuiltin} accepts. A borrowed operand (a variable, a constant, an
 * immediate) may not sit under a temp, so when an argument emits code, every earlier
 * borrowed argument is loaded (an owned copy, or a pushed number) just before that code is
 * emitted: this keeps source order, and reads a variable before a later procedure call can
 * change it. Null after an error was reported.
 */
function lowerArgs(ctx: LowerCtx, plan: readonly ArgPlan[], span: Span): Operand[] | null {
  const b = ctx.b;
  const ops: Operand[] = [];
  for (const arg of plan) {
    const mark = b.quads.length;
    const v = arg.value();
    if (v === null) return null;
    if (b.quads.length > mark && ops.some((o) => o.k !== 'temp')) {
      const loads: Quad[] = [];
      ops.forEach((o, i) => {
        if (o.k === 'temp') return;
        const dst = b.temp();
        loads.push({ op: 'load', type: (plan[i] as ArgPlan).type, dst, a: o, span });
        ops[i] = dst;
      });
      b.quads.splice(mark, 0, ...loads);
    }
    ops.push(v.o);
  }
  return ops;
}

const strArg = (ctx: LowerCtx, e: BuiltinCall, i: number): ArgPlan => ({
  type: 'str',
  value: () => {
    const a = e.args[i];
    if (a === undefined) throw new InternalError(`lowering: ${e.keyword} without argument ${i + 1}`);
    return lowerExpr(ctx, a);
  },
});

const numArg = (ctx: LowerCtx, e: BuiltinCall, i: number): ArgPlan => ({
  type: 'i16',
  value: () => {
    const a = e.args[i];
    if (a === undefined) throw new InternalError(`lowering: ${e.keyword} without argument ${i + 1}`);
    const v = lowerExpr(ctx, a);
    return v === null ? null : castTo(ctx, v, 'i16', a.span);
  },
});

/** STRING$'s second argument: a code, or the first character of a string (ASC; folded for a literal). */
const charArg = (ctx: LowerCtx, e: BuiltinCall, i: number): ArgPlan => ({
  type: 'i16',
  value: () => {
    const a = e.args[i];
    if (a === undefined) throw new InternalError(`lowering: ${e.keyword} without argument ${i + 1}`);
    if (ctx.typeOf(a) !== 'STRING') return numArg(ctx, e, i).value();
    const c = ctx.checked.constants.get(a);
    if (c !== undefined && typeof c.value === 'string' && c.value !== '') return { o: { k: 'imm', value: c.value.charCodeAt(0) & 0xff }, t: 'i16' };
    const v = lowerExpr(ctx, a);
    if (v === null) return null;
    const code = lowerStringBuiltin(ctx.b, 'ASC', [v.o], e.span);
    return { o: ctx.b.cast('i16', 'u8', code, e.span), t: 'i16' };
  },
});

const RESULT: Readonly<Record<string, IrType>> = { LEN: 'u16', ASC: 'u8', INSTR: 'u16' };

/** A string built-in call: the arguments, then the quads of {@link lowerStringBuiltin}, `cast` for STR$ and VAL. */
export function lowerStringCall(ctx: LowerCtx, e: BuiltinCall): Val | null {
  const b = ctx.b;
  const k = e.keyword;
  if (k === 'STR$') {
    const a = e.args[0];
    if (a === undefined) throw new InternalError('lowering: STR$ without an argument');
    const v = lowerExpr(ctx, a);
    return v === null ? null : { o: b.cast('str', v.t, v.o, e.span), t: 'str' };
  }
  if (k === 'VAL') {
    const plan = lowerArgs(ctx, [strArg(ctx, e, 0)], e.span);
    return plan === null ? null : { o: b.cast('f', 'str', plan[0] as Operand, e.span), t: 'f' };
  }
  let plan: ArgPlan[];
  switch (k) {
    case 'LEN':
    case 'ASC':
    case 'UPPER$':
    case 'LOWER$':
      plan = [strArg(ctx, e, 0)];
      break;
    case 'CHR$':
    case 'SPACE$':
      plan = [numArg(ctx, e, 0)];
      break;
    case 'LEFT$':
    case 'RIGHT$':
      plan = [strArg(ctx, e, 0), numArg(ctx, e, 1)];
      break;
    case 'MID$':
      plan = e.args.length > 2 ? [strArg(ctx, e, 0), numArg(ctx, e, 1), numArg(ctx, e, 2)] : [strArg(ctx, e, 0), numArg(ctx, e, 1)];
      break;
    case 'STRING$':
      plan = [numArg(ctx, e, 0), charArg(ctx, e, 1)];
      break;
    case 'INSTR':
      plan = e.args.length > 2 ? [numArg(ctx, e, 0), strArg(ctx, e, 1), strArg(ctx, e, 2)] : [strArg(ctx, e, 0), strArg(ctx, e, 1)];
      break;
    default:
      throw new InternalError(`lowering: ${k} is not a string built-in`);
  }
  const ops = lowerArgs(ctx, plan, e.span);
  if (ops === null) return null;
  const o = lowerStringBuiltin(b, k as Exclude<StringBuiltin, 'STR$'>, ops, e.span);
  return { o, t: RESULT[k] ?? 'str' };
}
