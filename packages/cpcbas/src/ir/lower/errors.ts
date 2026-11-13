/**
 * ON ERROR GOTO, RESUME, ERROR, ERR, ERL, the error mark and the main-program RETURN check
 * (task L4-ERR; contract: docs/ir.md "Events and errors", runtime: lib/loco/error.asm).
 *
 * Only a program with `ON ERROR GOTO <target>` anywhere pays for the error machinery
 * (`usesErrorTrap`): the mark of every main-program statement and the trap routine. Without
 * one no error can be trapped, so ERR and ERL are the constant 0, RESUME is error 20
 * (Unexpected RESUME) and ON ERROR GOTO 0 emits nothing.
 */
import type { ErrorStmt, OnErrorStmt, ResumeStmt, Stmt } from '../../ast/ast.js';
import { walk } from '../../ast/walk.js';
import type { Operand } from '../ir.js';
import type { LowerCtx, Val } from './context.js';
import { castTo, immOf, lowerExpr } from './expr.js';

const trap = new WeakMap<LowerCtx, boolean>();
/** The `.T.b` label (RESUME NEXT point) of every statement `erlMark` marked, for `erlEnd`. */
const nextLabel = new WeakMap<Stmt, string>();

/** Whether the program has an `ON ERROR GOTO` with a target (not `GOTO 0`) anywhere. */
export function usesErrorTrap(ctx: LowerCtx): boolean {
  let known = trap.get(ctx);
  if (known === undefined) {
    known = false;
    walk(ctx.checked.bound.program, (n) => {
      if (n.kind === 'OnError' && n.target !== null) known = true;
      return !known;
    });
    trap.set(ctx, known);
  }
  return known;
}

/** Internal `asm` (docs/ir.md "Internal asm": the error mark). */
function asmLines(ctx: LowerCtx, s: Stmt, texts: readonly string[]): void {
  ctx.b.asm(
    texts.map((text) => ({ text, span: s.span })),
    s.span,
    true,
  );
}

/** The error mark at the start of a main-program statement (boundary.ts `erlMark`). */
export function markStatement(ctx: LowerCtx, s: Stmt): void {
  if (ctx.procExit !== null || !usesErrorTrap(ctx)) return;
  const here = ctx.newLabel();
  const next = ctx.newLabel();
  nextLabel.set(s, next);
  ctx.b.label(here, s.span);
  asmLines(ctx, s, ['\tcall .core.__LOCO_MARK', `\tdefw ${(ctx.lineNumber ?? 0) & 0xffff}`, `\tdefw ${next}`]);
}

/** Whether `markStatement` marked this statement (so that its loop test marks again: `markLoopTest`). */
export function isMarked(ctx: LowerCtx, s: Stmt): boolean {
  return ctx.procExit === null && nextLabel.has(s);
}

/**
 * The error mark again, at the test of a loop that `markStatement` marked (follow-up 81): the test of the second and later
 * passes runs after the body's last statement has marked, so without this an error in it is attributed to that statement.
 * Same statement, same RESUME NEXT point; `line` is the line the test belongs to. Nothing for a statement that was not marked.
 */
export function markLoopTest(ctx: LowerCtx, s: Stmt, line: number | null): void {
  const next = nextLabel.get(s);
  if (next === undefined || ctx.procExit !== null) return;
  ctx.b.label(ctx.newLabel(), s.span);
  asmLines(ctx, s, ['\tcall .core.__LOCO_MARK', `\tdefw ${(line ?? 0) & 0xffff}`, `\tdefw ${next}`]);
}

/** The RESUME NEXT point after a statement `markStatement` marked (boundary.ts `erlEnd`). */
export function markStatementEnd(ctx: LowerCtx, s: Stmt): void {
  const next = nextLabel.get(s);
  if (next === undefined) return;
  nextLabel.delete(s);
  ctx.b.label(next, s.span);
}

/** `ON ERROR GOTO target` and `ON ERROR GOTO 0`. */
export function lowerOnError(ctx: LowerCtx, s: OnErrorStmt): void {
  const b = ctx.b;
  if (s.target === null) {
    if (usesErrorTrap(ctx)) b.rtcall('.core.__LOCO_ONERR0', null, s.span);
    return;
  }
  b.fparam('u16', { k: 'addr', label: ctx.targetLabel(s.target) } as Operand, s.span);
  b.rtcall('.core.__LOCO_ONERR', null, s.span);
}

/** `RESUME`, `RESUME NEXT`, `RESUME target`. Without an ON ERROR in the program it is error 20, as at run time outside a handler. */
export function lowerResume(ctx: LowerCtx, s: ResumeStmt): void {
  const b = ctx.b;
  if (!usesErrorTrap(ctx)) {
    b.fparam('i16', immOf(20, 'i16').o, s.span);
    b.rtcall('.core.__LOCO_ERROR', null, s.span);
    return;
  }
  if (s.mode === 'same') {
    b.rtcall('.core.__LOCO_RESUME', null, s.span);
  } else if (s.mode === 'next') {
    b.rtcall('.core.__LOCO_RESUMENEXT', null, s.span);
  } else {
    if (s.target === null) return;
    b.fparam('u16', { k: 'addr', label: ctx.targetLabel(s.target) } as Operand, s.span);
    b.rtcall('.core.__LOCO_RESUMETO', null, s.span);
  }
}

/** `ERROR n`: raises n (1..255; anything else is error 5). */
export function lowerError(ctx: LowerCtx, s: ErrorStmt): void {
  const v: Val | null = lowerExpr(ctx, s.code);
  if (v === null) return;
  ctx.b.fparam('i16', castTo(ctx, v, 'i16', s.code.span).o, s.span);
  ctx.b.rtcall('.core.__LOCO_ERROR', null, s.span);
}

/** `ERR` (INTEGER) and `ERL` (UINTEGER). */
export function lowerErrFn(ctx: LowerCtx, keyword: 'ERR' | 'ERL', span: Stmt['span']): Val {
  const t = keyword === 'ERR' ? 'i16' : 'u16';
  if (!usesErrorTrap(ctx)) return immOf(0, t);
  return { o: ctx.b.rtcall(`.core.__LOCO_${keyword}`, t, span) as Operand, t };
}

/** The check before a main-program RETURN: error 3 when no GOSUB is pending (follow-up 52). */
export function returnCheck(ctx: LowerCtx, span: Stmt['span']): void {
  ctx.b.rtcall('.core.__LOCO_RETCHK', null, span);
}
