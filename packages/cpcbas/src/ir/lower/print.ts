/**
 * PRINT (spec §9): one runtime call per item, then a line end unless the statement ends in
 * `;` or `,` (lib/loco/README.md). Numbers go to the PRINT{I16,U16,I32,U32,F} entries (a BYTE
 * is widened to INTEGER and a UBYTE to UINTEGER first); `,` is COMMA; SPC and TAB take their
 * count in A. A string goes through `fparam:str`: HL = the string and A = 1 for an owned temp,
 * which `__LOCO_PRINTSTR` frees, 0 for a variable or a constant.
 */
import type { Expr, PrintItem, PrintStmt } from '../../ast/ast.js';
import { InternalError } from '../../core/diagnostics.js';
import type { Span } from '../../core/source.js';
import { runtimeLabelFile } from '../../runtime/labels.js';
import type { Operand } from '../ir.js';
import type { LowerCtx } from './context.js';
import { castTo, immOf, lowerExpr } from './expr.js';

const LOCO = '.core.__LOCO_';

export function lowerPrint(ctx: LowerCtx, s: PrintStmt): void {
  const selected = selectStream(ctx, s.stream, s.span);
  if (selected === null) return;
  let endsInSeparator = false;
  let using = false;
  for (const item of s.items) {
    endsInSeparator = item.kind === 'PrintSep';
    if (item.kind === 'PrintUsing') {
      // PRINT USING format$; values: every value after the format goes to the format (lib/loco/using.asm)
      const f = lowerExpr(ctx, item.format);
      if (f === null) return;
      ctx.b.fparam('str', f.o, item.span);
      ctx.b.rtcall(`${LOCO}USING`, null, item.span);
      using = true;
      continue;
    }
    if (using && item.kind === 'PrintSep') continue; // `,` is no zone inside USING
    if (using && item.kind === 'PrintExpr') {
      if (!lowerUsingValue(ctx, item.expr, item.span)) return;
      continue;
    }
    if (!lowerItem(ctx, item)) return;
  }
  if (using) ctx.b.rtcall(`${LOCO}USINGE`, null, s.span);
  if (!endsInSeparator) ctx.b.rtcall(`${LOCO}NL`, null, s.span);
  if (selected) ctx.b.rtcall(`${LOCO}STREAM0`, null, s.span);
}

/**
 * The stream of `#s` as a u8 operand (docs/ir.md "Streams"): a constant as it is, any other value
 * through the 0..255 check (error 5 above it, negative values included); null after an error.
 */
export function streamOperand(ctx: LowerCtx, stream: Expr): Operand | null {
  const c = constNumber(ctx, stream);
  if (c !== null) return immOf(Number.isInteger(c) && c >= 0 && c <= 255 ? c : 255, 'u8').o;
  const v = lowerExpr(ctx, stream);
  if (v === null) return null;
  ctx.b.fparam('u16', castTo(ctx, v, 'u16', stream.span).o, stream.span);
  const r = ctx.b.rtcall(`${LOCO}ARG255`, 'u16', stream.span) as Operand;
  return castTo(ctx, { o: r, t: 'u16' }, 'u8', stream.span).o;
}

/**
 * The start of a statement with a stream (docs/ir.md "Streams"): the stream is evaluated first and
 * selected; the caller sends `__LOCO_STREAM0` after its last output call when this returns true. No
 * stream, or the constant 0, emits nothing (false); null after an error.
 */
export function selectStream(ctx: LowerCtx, stream: Expr | null, span: Span): boolean | null {
  if (stream === null || constNumber(ctx, stream) === 0) return false;
  const o = streamOperand(ctx, stream);
  if (o === null) return null;
  ctx.b.fparam('u8', o, span);
  ctx.b.rtcall(`${LOCO}STREAM`, null, span);
  return true;
}

/** One value of a PRINT USING: a string to the string fields, anything else as a REAL to the numeric ones. */
function lowerUsingValue(ctx: LowerCtx, e: Expr, span: Span): boolean {
  const b = ctx.b;
  if (ctx.typeOf(e) === 'STRING') {
    const sv = lowerExpr(ctx, e);
    if (sv === null) return false;
    b.fparam('str', sv.o, span);
    b.rtcall(`${LOCO}USINGS`, null, span);
    return true;
  }
  const v = lowerExpr(ctx, e);
  if (v === null) return false;
  if (v.t === 'str') throw new InternalError('lowering: a string value reached PRINT USING as a number');
  b.fparam('f', castTo(ctx, v, 'f', e.span).o, span);
  b.rtcall(`${LOCO}USINGN`, null, span);
  return true;
}

/** False after an error was reported. */
function lowerItem(ctx: LowerCtx, item: PrintItem): boolean {
  const b = ctx.b;
  switch (item.kind) {
    case 'PrintSep':
      if (item.sep === ',') b.rtcall(`${LOCO}COMMA`, null, item.span);
      return true;
    case 'PrintTab':
    case 'PrintSpc': {
      const e = item.kind === 'PrintTab' ? item.column : item.count;
      const v = lowerExpr(ctx, e);
      if (v === null) return false;
      b.fparam('u8', castTo(ctx, v, 'u8', e.span).o, item.span);
      b.rtcall(`${LOCO}${item.kind === 'PrintTab' ? 'TAB' : 'SPC'}`, null, item.span);
      return true;
    }
    case 'PrintExpr':
      return lowerValue(ctx, item.expr, item.span);
    case 'PrintAt':
      return lowerAt(ctx, item.row, item.col, item.span);
    case 'PrintUsing':
      throw new InternalError('lowering: PRINT USING reached lowerItem');
  }
}

/** The folded numeric value of an expression, or null. */
function constNumber(ctx: LowerCtx, e: Expr): number | null {
  const c = ctx.checked.constants.get(e);
  return c !== undefined && typeof c.value === 'number' ? c.value : null;
}

/**
 * `AT row, col` (spec §11, the 0-based Sinclair form) is `LOCATE col + 1, row + 1`: H = the 1-based
 * column and L = the 1-based row for `__LOCO_LOCATE`, which returns Carry for a pair outside the
 * screen (error 5, the same range rule as LOCATE). A value outside 0..254 becomes 0 in its byte
 * (branch-free: the sum is masked with the -1/0 result of the comparison), which the routine refuses.
 */
function lowerAt(ctx: LowerCtx, rowE: Expr, colE: Expr, span: Span): boolean {
  const b = ctx.b;
  const rc = constNumber(ctx, rowE);
  const cc = constNumber(ctx, colE);
  if (rc !== null && cc !== null) {
    const ok = (x: number): boolean => Number.isInteger(x) && x >= 0 && x <= 254;
    b.fparam('u16', immOf(ok(rc) && ok(cc) ? (cc + 1) * 256 + (rc + 1) : 0, 'u16').o, span);
  } else {
    const r = lowerExpr(ctx, rowE);
    if (r === null) return false;
    const rSlot = ctx.scratch('u16');
    b.store('u16', rSlot, castTo(ctx, r, 'u16', rowE.span).o, span);
    const c = lowerExpr(ctx, colE);
    if (c === null) return false;
    const cSlot = ctx.scratch('u16');
    b.store('u16', cSlot, castTo(ctx, c, 'u16', colE.span).o, span);
    const plusOne = (slot: Operand): Operand => {
      const sum = b.add('u16', slot, immOf(1, 'u16').o, span);
      const ok = castTo(ctx, { o: b.compare('le', 'u16', slot, immOf(254, 'u16').o, span), t: 'i16' }, 'u16', span);
      return b.and('u16', sum, ok.o, span);
    };
    const hi = b.shl('u16', plusOne(cSlot), immOf(8, 'u8').o, span);
    b.fparam('u16', b.or('u16', hi, plusOne(rSlot), span), span);
  }
  b.rtcall(`${LOCO}LOCATE`, null, span);
  const ok = ctx.newLabel();
  const errFile = runtimeLabelFile('.core.__ERROR');
  if (errFile === undefined) throw new InternalError('lowering: no file for .core.__ERROR');
  ctx.require(errFile);
  b.asm(
    ['\tjr nc, ' + ok, '\tld a, 5', '\tjp .core.__ERROR'].map((text) => ({ text, span })),
    span,
    true,
  );
  b.label(ok, span);
  return true;
}

function lowerValue(ctx: LowerCtx, e: Expr, span: Span): boolean {
  const b = ctx.b;
  if (ctx.typeOf(e) === 'STRING') {
    // HL = the string, A = 1 for an owned temp (the routine frees it) and 0 for a variable
    // or a constant: the `fparam:str` template sets both.
    const sv = lowerExpr(ctx, e);
    if (sv === null) return false;
    b.fparam('str', sv.o, span);
    b.rtcall(`${LOCO}PRINTSTR`, null, span);
    return true;
  }
  let v = lowerExpr(ctx, e);
  if (v === null) return false;
  if (v.t === 'u8') v = castTo(ctx, v, 'u16', e.span);
  else if (v.t === 'i8') v = castTo(ctx, v, 'i16', e.span);
  if (v.t === 'f16') v = castTo(ctx, v, 'f', e.span); // a FIXED prints as the REAL of the same value
  if (v.t === 'str') throw new InternalError('lowering: a string value reached PRINT');
  b.fparam(v.t, v.o, span);
  b.rtcall(`${LOCO}PRINT${v.t.toUpperCase()}`, null, span);
  return true;
}
