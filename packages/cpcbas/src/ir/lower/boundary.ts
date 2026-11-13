/**
 * Statement-boundary hooks (L4-0; contract: docs/ir.md "Events and errors").
 *
 * The statement lowering (`stmt.ts`) calls `statementStart` right after the `stmt` quad of every
 * executable statement (and after each `stmt` quad of a local DIM initialiser), and
 * `statementEnd` after every statement of a statement list, executable or not. Both run in the
 * main program and in procedure bodies; `ctx.procExit !== null` tells a procedure body.
 *
 * Fixed order at a statement start (owned by L4-0, wave-1 tasks do not change it):
 *   1. the ESC check of `ON BREAK STOP` (not here: the `stmt` quad's codegen template, L4-KEYS);
 *   2. `eventPoll` (L4-EVENTS): EVERY/AFTER handlers run here, before the mark, so a handler
 *      cannot leave its own error position behind for the statement that follows;
 *   3. `erlMark` (L4-ERR): the error position (line, restart and next points, SP, IX) of a
 *      main-program statement.
 * At a statement end: `erlEnd` (L4-ERR) places the RESUME NEXT point of the statement.
 *
 * Each hook emits nothing for a program that does not use its feature, so such a program's image
 * is byte-identical to one built without the hooks. Until their tasks fill them in, the hooks
 * emit nothing at all.
 */
import type { Stmt } from '../../ast/ast.js';
import type { LowerCtx } from './context.js';
import { usesEvents } from './events.js';
import { isMarked, markLoopTest, markStatement, markStatementEnd } from './errors.js';

/** Observes the hook calls (tests only): `start` after the start hooks ran, `end` after the end hook. */
export interface BoundaryProbe {
  readonly start?: (ctx: LowerCtx, s: Stmt) => void;
  readonly end?: (ctx: LowerCtx, s: Stmt) => void;
}

let probe: BoundaryProbe | null = null;

/** Installs (or with null removes) the test probe. Never used by the compiler itself. */
export function setBoundaryProbe(p: BoundaryProbe | null): void {
  probe = p;
}

/** The shared call at a statement start: the event poll, then the error mark (order fixed above). */
export function statementStart(ctx: LowerCtx, s: Stmt): void {
  eventPoll(ctx, s);
  erlMark(ctx, s);
  probe?.start?.(ctx, s);
}

/** The shared call after a statement of a list. */
export function statementEnd(ctx: LowerCtx, s: Stmt): void {
  erlEnd(ctx, s);
  probe?.end?.(ctx, s);
}

/**
 * L4-EVENTS: `call .core.__EVENT_POLL` (an `rtcall` with no argument or result) at every
 * statement start, main program and procedures, when the program uses EVERY or AFTER; nothing
 * otherwise.
 */
export function eventPoll(ctx: LowerCtx, s: Stmt): void {
  if (usesEvents(ctx)) ctx.b.rtcall('.core.__EVENT_POLL', null, s.span);
}

/**
 * L4-ERR: the error mark of a main-program statement (`ctx.procExit === null`) when the program
 * has `ON ERROR GOTO` with a target; nothing in procedures and nothing otherwise (errors.ts).
 */
export function erlMark(ctx: LowerCtx, s: Stmt): void {
  markStatement(ctx, s);
}

/** Follow-up 81: the error mark again at the test of a loop statement (WHILE, DO, FOR), for the passes after the first. */
export function erlMarkTest(ctx: LowerCtx, s: Stmt, line: number | null): void {
  markLoopTest(ctx, s, line);
}

/** Whether the statement's start was marked, that is whether `erlMarkTest` will emit anything for it. */
export function erlMarked(ctx: LowerCtx, s: Stmt): boolean {
  return isMarked(ctx, s);
}

/** L4-ERR: the label of the RESUME NEXT point after a statement `erlMark` marked (nothing for one it did not mark). */
export function erlEnd(ctx: LowerCtx, s: Stmt): void {
  markStatementEnd(ctx, s);
}
