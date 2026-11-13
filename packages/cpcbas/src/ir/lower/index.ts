/**
 * Lowering of a checked program to the IR (task L2-LOWER; contract: ir/ir.ts, docs/ir.md).
 *
 * - `globals.ts`   the data area;
 * - `expr.ts`      expressions;  `stmt.ts` statements and control flow;  `print.ts` PRINT;
 * - `builtins.ts`  MODE, PEN, LOCATE, CALL, POKE, PEEK, ... and the string built-in hook;
 * - `pending.ts`   the dispatch points of procedures (L2-PROC) and DATA/READ (L2-DATA),
 *                  which report E002 until those tasks replace them.
 * The main program is every top-level statement except procedure declarations; falling off
 * its end is END.
 */
import type { LowerFn } from '../ir.js';
import { LowerCtx } from './context.js';
import { lowerGlobals, lowerStringInits } from './globals.js';
import { programHasBreakStop } from './keys.js';
import { lowerDataTable, lowerProcedures } from './pending.js';
import { reachableProcedures } from './reach.js';
import { lowerStmts } from './stmt.js';

export const lowerProgram: LowerFn = (input) => {
  const ctx = new LowerCtx(input.checked, input.diagnostics);
  ctx.minimalSpills = input.minimalSpills === true;
  const bound = input.checked.bound;
  const globals = lowerGlobals(ctx);
  ctx.startBody();
  lowerStringInits(ctx);
  lowerStmts(ctx, bound.program.body);
  const last = ctx.b.quads[ctx.b.quads.length - 1];
  if (last === undefined || last.op !== 'end') ctx.b.end({ k: 'imm', value: 0 }, null);
  const main = ctx.finishBody();
  const procedures = lowerProcedures(ctx);
  const data = lowerDataTable(ctx);

  // A `#require` inside a procedure that is not compiled links nothing.
  const reached = reachableProcedures(input.checked);
  const wanted = bound.requires.filter((r) => r.owner === null || reached.has(r.owner));
  const requires = wanted.map((r) => r.path);
  const requireSpans = new Map<string, (typeof bound.requires)[number]['span']>();
  for (const r of wanted) if (!requireSpans.has(r.path)) requireSpans.set(r.path, r.span);
  for (const f of ctx.requiresList()) requires.push(f);

  return {
    main,
    procedures,
    globals: [...globals, ...ctx.hiddenList()],
    strings: [...ctx.stringsList()],
    data,
    requires: [...new Set(requires)],
    inits: bound.inits.map((i) => i.label),
    requireSpans,
    ...(programHasBreakStop(ctx) ? { checkBreak: true } : {}),
  };
};
