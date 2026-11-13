/**
 * L4-FILES: the file statements and functions (runtime lib/loco/filecom.asm,
 * file.asm, fileout.asm, write.asm, register contracts in their headers): OPENIN, CLOSEIN, OPENOUT, CLOSEOUT,
 * LOAD, SAVE, CAT, CHAIN, WRITE, EOF and DERR. INPUT #9, LINE INPUT #9 are in keys.ts, PRINT #9 is PRINT on
 * stream 9 (print.ts, window.asm); all of it is firmware only (the checker refuses it in a bare build, E270).
 *
 * A file name goes in HL as a string (`fparam str`, A = 1 for a temporary the routine frees). LOAD's address and SAVE's
 * address, length and entry are pushed first, in that order, and the name is evaluated last, so a name that is
 * an expression is the last thing evaluated (the order of the arguments' side effects is not Locomotive's, which
 * nothing observes). The link step sizes the AMSDOS buffers from `IrProgram.requires`: `loco/file.asm` takes the
 * input stream's, `loco/fileout.asm` the output stream's (codegen/memory-map.ts).
 */
import type { BuiltinCall, BuiltinStmt, Expr, WriteStmt } from '../../ast/ast.js';
import { InternalError } from '../../core/diagnostics.js';
import type { Operand } from '../ir.js';
import type { LowerCtx, Val } from './context.js';
import { castTo, immOf, lowerExpr } from './expr.js';
import { selectStream } from './print.js';

const LOCO = '.core.__LOCO_';

/** The statements `lowerFileStatement` handles. */
export const FILE_STATEMENTS: ReadonlySet<string> = new Set(['OPENIN', 'CLOSEIN', 'OPENOUT', 'CLOSEOUT', 'LOAD', 'SAVE', 'CAT', 'CHAIN']);

function number(ctx: LowerCtx, e: Expr): Val | null {
  const v = lowerExpr(ctx, e);
  return v === null ? null : castTo(ctx, v, 'u16', e.span);
}

/** The file name as the register argument of the call that follows; false after an error. */
function nameArg(ctx: LowerCtx, e: Expr | null | undefined, span: BuiltinStmt['span']): boolean {
  if (e === null || e === undefined) throw new InternalError('lowering: a file statement without its name');
  const v = lowerExpr(ctx, e);
  if (v === null) return false;
  ctx.b.fparam('str', v.o, span);
  return true;
}

/** The file statements; false for any other keyword. */
export function lowerFileStatement(ctx: LowerCtx, s: BuiltinStmt): boolean {
  const b = ctx.b;
  switch (s.keyword) {
    case 'OPENIN':
    case 'CAT':
    case 'CLOSEIN':
      ctx.require('loco/file.asm');
      if (s.keyword === 'OPENIN' && !nameArg(ctx, s.args[0], s.span)) return true;
      b.rtcall(`${LOCO}${s.keyword}`, null, s.span);
      return true;
    case 'CHAIN':
      ctx.require('loco/file.asm');
      if (nameArg(ctx, s.args[0], s.span)) b.rtcall(`${LOCO}CHAIN`, null, s.span);
      return true;
    case 'LOAD': {
      ctx.require('loco/file.asm');
      const addr = s.args[1];
      if (addr !== undefined && addr !== null) {
        const v = number(ctx, addr);
        if (v === null) return true;
        b.param('u16', v.o, addr.span);
      }
      if (!nameArg(ctx, s.args[0], s.span)) return true;
      b.rtcall(addr !== undefined && addr !== null ? `${LOCO}LOAD` : `${LOCO}LOADH`, null, s.span);
      return true;
    }
    case 'OPENOUT':
    case 'CLOSEOUT':
      ctx.require('loco/fileout.asm');
      if (s.keyword === 'OPENOUT' && !nameArg(ctx, s.args[0], s.span)) return true;
      b.rtcall(`${LOCO}${s.keyword}`, null, s.span);
      return true;
    case 'SAVE': {
      // SAVE "name", B, address, length [, entry]: the checker has seen to the shape
      ctx.require('loco/fileout.asm');
      for (let i = 2; i < 5; i++) {
        const a = s.args[i];
        if (a === undefined || a === null) {
          b.param('u16', immOf(0, 'u16').o, s.span);
          continue;
        }
        const v = number(ctx, a);
        if (v === null) return true;
        b.param('u16', v.o, a.span);
      }
      if (nameArg(ctx, s.args[0], s.span)) b.rtcall(`${LOCO}SAVE`, null, s.span);
      return true;
    }
    default:
      return false;
  }
}

/** EOF and DERR (INTEGERs); undefined for any other keyword. */
export function lowerFileFunction(ctx: LowerCtx, e: BuiltinCall): Val | undefined {
  if (e.keyword === 'EOF') {
    ctx.require('loco/file.asm');
    return { o: ctx.b.rtcall(`${LOCO}EOF`, 'i16', e.span) as Operand, t: 'i16' };
  }
  if (e.keyword === 'DERR') {
    ctx.require('loco/filecom.asm');
    return { o: ctx.b.rtcall(`${LOCO}DERR`, 'i16', e.span) as Operand, t: 'i16' };
  }
  return undefined;
}

/**
 * WRITE [#s,] items: a string in quotes, a number as STR$ text without its leading space, the items
 * separated by commas, a line end after the last (lib/loco/write.asm). A stream other than #0 is selected
 * around the statement as PRINT does (docs/ir.md "Streams").
 */
export function lowerWrite(ctx: LowerCtx, s: WriteStmt): void {
  const b = ctx.b;
  const selected = selectStream(ctx, s.stream, s.span);
  if (selected === null) return;
  s.items.forEach((item, i) => {
    if (i > 0) b.rtcall(`${LOCO}WRITEC`, null, item.span);
    const v = lowerExpr(ctx, item);
    if (v === null) return;
    if (v.t === 'str') {
      b.fparam('str', v.o, item.span);
      b.rtcall(`${LOCO}WRITES`, null, item.span);
      return;
    }
    let n = v;
    if (n.t === 'f16') n = castTo(ctx, n, 'f', item.span); // a FIXED is written as the REAL of the same value
    b.fparam('str', b.cast('str', n.t, n.o, item.span), item.span);
    b.rtcall(`${LOCO}WRITEN`, null, item.span);
  });
  b.rtcall(`${LOCO}NL`, null, s.span);
  if (selected) b.rtcall(`${LOCO}STREAM0`, null, s.span);
}
