/**
 * L4-EVENTS: EVERY, AFTER, REMAIN, DI, EI and TIME (runtime: lib/loco/event.asm; contract: docs/ir.md
 * "Events and errors"). `stmt.ts` and `builtins.ts` call the functions below from one `case` each;
 * `boundary.ts`'s `eventPoll` calls `usesEvents`.
 *
 * - `EVERY n [, t] GOSUB target` / `AFTER ...`: n first, then t; both go on the stack (n deeper) and the
 *   target's address in HL (`fparam.u16` of an `addr` operand). The runtime raises error 5 for n < 0 and for
 *   t outside 0-3, and n = 0 stops the timer (measured on the interpreter).
 * - `REMAIN(t)`: t in HL, the result an INTEGER in HL.
 * - `DI`, `EI`: no arguments. `TIME`: ULONG in DEHL.
 */
import type { BuiltinCall, BuiltinStmt, EveryAfterStmt, Expr, Stmt } from '../../ast/ast.js';
import type { Span } from '../../core/source.js';
import { walk } from '../../ast/walk.js';
import { InternalError } from '../../core/diagnostics.js';
import type { Operand } from '../ir.js';
import type { LowerCtx, Val } from './context.js';
import { castTo, lowerExpr } from './expr.js';

const usage = new WeakMap<object, boolean>();

/** Whether the program has an EVERY or AFTER anywhere (main program or procedures): only then does every statement poll. */
export function usesEvents(ctx: LowerCtx): boolean {
  const key = ctx.checked;
  let found = usage.get(key);
  if (found === undefined) {
    found = false;
    walk(ctx.checked.bound.program, (node) => {
      if (node.kind === 'EveryAfter') found = true;
      return found ? false : undefined;
    });
    usage.set(key, found);
  }
  return found;
}

/** Statements that start no code of their own (and so no poll): labels and declarations. */
const SILENT: ReadonlySet<Stmt['kind']> = new Set<Stmt['kind']>(['LineLabel', 'Const', 'DefType', 'Option', 'Declare', 'Pragma', 'Require', 'Init', 'Data', 'Procedure', 'DefFn', 'BadStmt', 'Dim']);

/**
 * A loop whose body holds no executable statement (`WHILE n < 4 : WEND`, `FOR i = 1 TO 5000 : NEXT`) has no
 * statement boundary inside it, so its back edge polls (Locomotive polls at the NEXT/WEND/LOOP statement). Only in
 * programs that use EVERY or AFTER, and only for an empty body: any other body polls at its own statements.
 */
export function pollEmptyLoop(ctx: LowerCtx, body: readonly Stmt[], span: Span): void {
  if (usesEvents(ctx) && body.every((st) => SILENT.has(st.kind))) ctx.b.rtcall('.core.__EVENT_POLL', null, span);
}

/** An argument as an INTEGER (the checker has converted a REAL argument by truncation: follow-up 85). */
function integerArg(ctx: LowerCtx, e: Expr): Val | null {
  const v = lowerExpr(ctx, e);
  return v === null ? null : castTo(ctx, v, 'i16', e.span);
}

/** `EVERY n [, t] GOSUB target` and `AFTER n [, t] GOSUB target`. */
function lowerEveryAfter(ctx: LowerCtx, s: EveryAfterStmt, label: string): void {
  const b = ctx.b;
  const n = integerArg(ctx, s.interval);
  if (n === null) return;
  const nTemp = b.load('i16', n.o, s.span); // evaluated first, so it goes on the stack first
  let t: Val | null = { o: { k: 'imm', value: 0 }, t: 'i16' };
  if (s.timer !== null) t = integerArg(ctx, s.timer);
  if (t === null) return;
  const tTemp = b.load('i16', t.o, s.span);
  b.param('u16', tTemp, s.span);
  b.param('u16', nTemp, s.span);
  b.fparam('u16', { k: 'addr', label: ctx.targetLabel(s.target) }, s.span);
  b.rtcall(label, null, s.span);
}

export function lowerEvery(ctx: LowerCtx, s: EveryAfterStmt): void {
  lowerEveryAfter(ctx, s, '.core.__LOCO_EVERY');
}

export function lowerAfter(ctx: LowerCtx, s: EveryAfterStmt): void {
  lowerEveryAfter(ctx, s, '.core.__LOCO_AFTER');
}

/** DI and EI (the GOSUBs only, not the Z80's interrupts). */
export function lowerDiEi(ctx: LowerCtx, s: BuiltinStmt): void {
  if (s.keyword !== 'DI' && s.keyword !== 'EI') throw new InternalError('lowering: lowerDiEi on something that is not DI or EI');
  ctx.b.rtcall(`.core.__LOCO_${s.keyword}`, null, s.span);
}

/** REMAIN(t): what is left of timer t, in 1/50 s; the timer is stopped. */
export function lowerRemain(ctx: LowerCtx, e: BuiltinCall): Val | null {
  const a0 = e.args[0];
  if (a0 === undefined) throw new InternalError('lowering: REMAIN without a timer');
  const t = integerArg(ctx, a0);
  if (t === null) return null;
  ctx.b.fparam('i16', t.o, e.span);
  return { o: ctx.b.rtcall('.core.__LOCO_REMAIN', 'i16', e.span) as Operand, t: 'i16' };
}

/** TIME: the 1/300 s counter as a ULONG. */
export function lowerTime(ctx: LowerCtx, e: BuiltinCall): Val {
  return { o: ctx.b.rtcall('.core.__LOCO_TIME', 'u32', e.span) as Operand, t: 'u32' };
}
