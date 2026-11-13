/**
 * Built-in statements and functions of the L2 subset (checker/subset.ts): MODE, PEN, PAPER,
 * BORDER, LOCATE, CLS, POKE, MEMORY, CALL; PEEK, POS, VPOS, INKEY$, ABS, SGN, MIN, MAX,
 * CINT, UNT, CAST, SIZEOF.
 *
 * Screen statements call the lib/loco routines with their register contracts
 * (lib/loco/README.md): A for MODE, PEN and PAPER; H = column and L = row for LOCATE, which
 * returns Carry for an out-of-range pair (error 5, Improper argument); B and C for BORDER.
 * A value that must reach a register the IR has no `fparam` for (BORDER's BC) goes through a
 * hidden global and a short `asm` quad.
 */
import type { BuiltinCall, BuiltinStmt, CallStmt, Expr, MidAssignStmt, Name } from '../../ast/ast.js';
import type { VariableSymbol } from '../../sem/model.js';
import { InternalError } from '../../core/diagnostics.js';
import type { Span } from '../../core/source.js';
import { runtimeLabelFile } from '../../runtime/labels.js';
import { irType, type IrType } from '../../sem/types.js';
import type { Operand } from '../ir.js';
import { arrayOf, lowerElement, lowerParamBound } from './array.js';
import type { LowerCtx, Val } from './context.js';
import { lowerErrFn } from './errors.js';
import { lowerRemain, lowerTime } from './events.js';
import { castTo, immOf, lowerExpr, lowerRaw, materialize, mayCall } from './expr.js';
import { FILE_STATEMENTS, lowerFileFunction, lowerFileStatement } from './files.js';
import { lowerKeyFunction, lowerKeyStatement } from './keys.js';
import { selectStream, streamOperand } from './print.js';
import { lowerStringCall } from './strings.js';

/** The lowering of a built-in function call. L2-CG-STR registers the string built-ins in `STRING_BUILTINS`. */
export type BuiltinLowerer = (ctx: LowerCtx, e: BuiltinCall) => Val | null;

/** String built-ins by keyword (LEN, LEFT$, MID$, CHR$, ASC, STR$, SPACE$, STRING$, ...): L2-CG-STR adds its lowerers here. */
export const STRING_BUILTINS: Readonly<Record<string, BuiltinLowerer>> = Object.fromEntries(
  ['LEN', 'ASC', 'VAL', 'STR$', 'UPPER$', 'LOWER$', 'CHR$', 'SPACE$', 'STRING$', 'LEFT$', 'RIGHT$', 'MID$', 'INSTR'].map((k): [string, BuiltinLowerer] => [
    k,
    (ctx, e) => lowerStringCall(ctx, e),
  ]),
);

/** An internal `asm` quad (docs/ir.md, "Internal asm"): BORDER's BC, LOCATE's Carry test, CALL's block and call. */
const asmLines = (ctx: LowerCtx, span: Span, texts: readonly string[]): void => {
  ctx.b.asm(
    texts.map((text) => ({ text, span })),
    span,
    true,
  );
};

/** The folded numeric value of an expression, or null. */
function constNumber(ctx: LowerCtx, e: Expr): number | null {
  const c = ctx.checked.constants.get(e);
  return c !== undefined && typeof c.value === 'number' ? c.value : null;
}

/** The value of `e` as an operand of `type` (conversions applied); null after an error. */
function operandOf(ctx: LowerCtx, e: Expr, type: IrType): Val | null {
  const v = lowerExpr(ctx, e);
  return v === null ? null : castTo(ctx, v, type, e.span);
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

export function lowerBuiltinStmt(ctx: LowerCtx, s: BuiltinStmt): void {
  // `#s` (docs/ir.md "Streams"): selected before the arguments are evaluated, stream 0 again at the end.
  const selected = selectStream(ctx, s.stream, s.span);
  if (selected === null) return;
  lowerBuiltinBody(ctx, s);
  if (selected) ctx.b.rtcall('.core.__LOCO_STREAM0', null, s.span);
}

function lowerBuiltinBody(ctx: LowerCtx, s: BuiltinStmt): void {
  const b = ctx.b;
  const arg = (i: number): Expr | null => s.args[i] ?? null;
  switch (s.keyword) {
    case 'MODE':
    case 'PAPER':
    case 'PEN': {
      const a = arg(0);
      if (a === null || (s.keyword === 'PEN' && arg(1) !== null)) {
        ctx.notYet(s.span, a === null ? 'PEN without an ink' : 'The second argument of PEN');
        return;
      }
      const v = operandOf(ctx, a, 'u8');
      if (v === null) return;
      b.fparam('u8', v.o, s.span);
      b.rtcall(`.core.__LOCO_${s.keyword}`, null, s.span);
      return;
    }
    case 'CLS':
      b.rtcall('.core.__LOCO_CLS', null, s.span);
      return;
    case 'BORDER':
      lowerBorder(ctx, s);
      return;
    case 'LOCATE':
      lowerLocate(ctx, s);
      return;
    case 'POKE': {
      const [addr, value] = [arg(0), arg(1)];
      if (addr === null || value === null) throw new InternalError('lowering: POKE without its arguments');
      const t = irType(s.typeArg?.name ?? 'UBYTE');
      let a = operandOf(ctx, addr, 'u16');
      if (a === null) return;
      if (a.o.k !== 'imm' && a.o.k !== 'temp' && mayCall(ctx, value)) a = materialize(ctx, a, s.span);
      const v = operandOf(ctx, value, t);
      if (v === null) return;
      b.poke(t, a.o, v.o, s.span);
      return;
    }
    case 'SOUND':
      lowerSound(ctx, s);
      return;
    case 'ENV':
    case 'ENT':
      lowerEnvelope(ctx, s);
      return;
    case 'RELEASE':
      lowerRelease(ctx, s);
      return;
    case 'BEEP':
      lowerBeep(ctx, s);
      return;
    case 'MEMORY':
      // A build-time setting: no code in L2.
      return;
    case 'DEG':
    case 'RAD':
      b.rtcall(`.core.__LOCO_${s.keyword}`, null, s.span);
      return;
    case 'RANDOMIZE': {
      // No number: reseed from the time (never prompts, spec section 9); RANDOMIZE n: from |n|.
      const a = arg(0);
      if (a === null) {
        b.rtcall('.core.__LOCO_RANDTIME', null, s.span);
        return;
      }
      const v = operandOf(ctx, a, 'f');
      if (v === null) return;
      b.fparam('f', v.o, a.span);
      b.rtcall('.core.__LOCO_RANDOMIZE', null, s.span);
      return;
    }
    case 'WINDOW': {
      // WINDOW l, r, t, b: l, r and t on the stack, b in HL (lib/loco/window.asm checks 1-255)
      for (const [i, a] of s.args.entries()) {
        const v = a === null ? null : operandOf(ctx, a, 'u16');
        if (v === null) return;
        if (i < 3) b.param('u16', v.o, s.span);
        else b.fparam('u16', v.o, s.span);
      }
      b.rtcall('.core.__LOCO_WINDOW', null, s.span);
      return;
    }
    case 'WINDOW SWAP': {
      const a = arg(0);
      const va = a === null ? null : operandOf(ctx, a, 'u16');
      if (va === null) return;
      b.param('u16', va.o, s.span);
      const second = arg(1);
      const vb = second === null ? immOf(0, 'u16') : operandOf(ctx, second, 'u16');
      if (vb === null) return;
      b.fparam('u16', vb.o, s.span);
      b.rtcall('.core.__LOCO_WINSWAP', null, s.span);
      return;
    }
    case 'TAG':
    case 'TAGOFF':
      b.rtcall(`.core.__LOCO_${s.keyword}`, null, s.span);
      return;
    case 'SYMBOL': {
      // SYMBOL c, r1 .. r8: nine words, a missing row 0 (lib/loco/symbol.asm); the last in HL
      for (let i = 0; i < 9; i++) {
        const a = arg(i);
        const v = a === null ? immOf(0, 'u16') : operandOf(ctx, a, 'u16');
        if (v === null) return;
        if (i < 8) b.param('u16', v.o, s.span);
        else b.fparam('u16', v.o, s.span);
      }
      b.rtcall('.core.__LOCO_SYMBOL', null, s.span);
      return;
    }
    case 'SYMBOL AFTER': {
      const a = arg(0);
      const n = a === null ? null : constNumber(ctx, a);
      if (n === null) throw new InternalError('lowering: SYMBOL AFTER without its constant');
      b.fparam('u16', immOf(n, 'u16').o, s.span);
      b.rtcall('.core.__LOCO_SYMAFTER', null, s.span);
      return;
    }
    case 'ZONE':
    case 'WIDTH': {
      const a = arg(0);
      const v = a === null ? null : operandOf(ctx, a, 'u16');
      if (v === null) return;
      b.fparam('u16', v.o, s.span);
      b.rtcall(s.keyword === 'ZONE' ? '.core.__LOCO_ZONEN' : '.core.__LOCO_WIDTH', null, s.span);
      return;
    }
    case 'FRAME':
      b.rtcall('.core.__LOCO_FRAME', null, s.span);
      return;
    case 'PAUSE': {
      // n frames; PAUSE 0 waits for a key (the imported runtime's __PAUSE, HL = n).
      const a = arg(0);
      if (a === null) throw new InternalError('lowering: PAUSE without its argument');
      const v = operandOf(ctx, a, 'u16');
      if (v === null) return;
      b.fparam('u16', v.o, s.span);
      b.rtcall('.core.__PAUSE', null, s.span);
      return;
    }
    case 'OUT': {
      const [port, value] = [arg(0), arg(1)];
      if (port === null || value === null) throw new InternalError('lowering: OUT without its arguments');
      let p = operandOf(ctx, port, 'u16');
      if (p === null) return;
      if (p.o.k !== 'imm' && p.o.k !== 'temp' && mayCall(ctx, value)) p = materialize(ctx, p, s.span);
      const v = operandOf(ctx, value, 'u8');
      if (v === null) return;
      b.out(p.o, v.o, s.span);
      return;
    }
    case 'WAIT':
      lowerWait(ctx, s);
      return;
    default:
      if (GFX_STMTS.has(s.keyword)) {
        lowerGraphics(ctx, s);
        return;
      }
      if (FILE_STATEMENTS.has(s.keyword)) {
        lowerFileStatement(ctx, s);
        return;
      }
      if (!lowerKeyStatement(ctx, s)) ctx.notYet(s.span, s.keyword);
  }
}

/**
 * WAIT port, mask [, inversion]: reads the port until (value XOR inversion) AND mask is not zero.
 * The operands are evaluated once, in order, into scratch slots; the loop re-reads the port only.
 */
function lowerWait(ctx: LowerCtx, s: BuiltinStmt): void {
  const b = ctx.b;
  const [port, mask, inv] = [s.args[0], s.args[1], s.args[2] ?? null];
  if (port === undefined || port === null || mask === undefined || mask === null) throw new InternalError('lowering: WAIT without its arguments');
  const once = (e: Expr, t: IrType): Operand | null => {
    const v = operandOf(ctx, e, t);
    if (v === null) return null;
    if (v.o.k === 'imm') return v.o;
    const slot = ctx.scratch(t);
    b.store(t, slot, v.o, e.span);
    return slot;
  };
  const p = once(port, 'u16');
  const m = p === null ? null : once(mask, 'u8');
  const i = m === null || inv === null ? null : once(inv, 'u8');
  if (p === null || m === null || (inv !== null && i === null)) return;
  const top = ctx.newLabel();
  b.label(top, s.span);
  let x = b.in(p, s.span);
  if (i !== null) x = b.xor('u8', x, i, s.span);
  b.jz('u8', b.and('u8', x, m, s.span), top, s.span);
}

// ---------------------------------------------------------------------------
// Graphics and colour (L4-GFX; lib/loco/gfx.asm, gfxfill.asm, gfxpx.asm, inkset.asm)
// ---------------------------------------------------------------------------

/** The graphics and colour statements this file lowers. */
const GFX_STMTS: ReadonlySet<string> = new Set([
  'CLG', 'ORIGIN', 'GRAPHICS PEN', 'GRAPHICS PAPER', 'PLOT', 'PLOTR', 'MOVE', 'MOVER', 'DRAW', 'DRAWR',
  'INK', 'SPEED INK', 'MASK', 'FILL', 'CIRCLE',
]);

/** A graphics coordinate, pen or colour as an INTEGER; a REAL is rounded half away from zero first (CINT), as the interpreter does. */
function gfxInt(ctx: LowerCtx, e: Expr): Val | null {
  if (ctx.typeOf(e) === 'STRING') {
    // these keywords are not in the checker's signature tables (keywords.ts `checked`), so the type is checked here
    ctx.diagnostics.report('E230', e.span, 'A graphics argument must be a number, not a STRING', 'Convert the text with VAL.');
    return null;
  }
  let v = lowerRaw(ctx, e);
  if (v === null) return null;
  if (v.t === 'f' || v.t === 'f16') {
    if (v.o.k === 'imm') {
      const x = v.o.value;
      v = immOf(x < 0 ? -Math.floor(-x + 0.5) : Math.floor(x + 0.5), 'i16');
    } else {
      const r = castTo(ctx, v, 'f', e.span);
      ctx.b.fparam('f', r.o, e.span);
      v = { o: ctx.b.rtcall('.core.__LOCO_CINT', 'i16', e.span) as Operand, t: 'i16' };
    }
  }
  return castTo(ctx, v, 'i16', e.span);
}

/** The argument `e` pushed as a temp (it waits on the stack while the arguments after it are evaluated); null after an error. */
function gfxPushed(ctx: LowerCtx, e: Expr): Val | null {
  const v = gfxInt(ctx, e);
  return v === null ? null : pushed(ctx, v, e.span);
}

/** The runtime routine of each relative or absolute move: x on the stack, y in HL. */
const GFX_MOVES: Readonly<Record<string, string>> = {
  PLOT: 'GPLOT',
  PLOTR: 'GPLOTR',
  MOVE: 'GMOVE',
  MOVER: 'GMOVER',
  DRAW: 'GDRAW',
  DRAWR: 'GDRAWR',
};

/** The routine that is called with one register argument (n in HL) per statement. */
function gfxOne(ctx: LowerCtx, e: Expr, label: string, span: Span): void {
  const v = gfxInt(ctx, e);
  if (v === null) return;
  ctx.b.fparam('i16', v.o, span);
  ctx.b.rtcall(`.core.__LOCO_${label}`, null, span);
}

/**
 * The call of a routine whose arguments are all on the stack, the first deepest: `last` and the temps that wait are
 * consumed by `param` quads, the latest first (the IR's temps are the stack, docs/ir.md "Evaluation model"; an
 * immediate is pushed by its `param`).
 */
function gfxFinish(ctx: LowerCtx, waiting: readonly Val[], last: Val, label: string, span: Span, ret: IrType | null = null): Operand | null {
  const b = ctx.b;
  b.param('i16', last.o, span);
  for (const w of [...waiting].reverse()) b.param('i16', w.o, span);
  return b.rtcall(`.core.__LOCO_${label}`, ret, span) as Operand | null;
}

/** An argument that may be left out (`PLOT 1, 1, , 1`): the expression, or null. */
function gfxArg(s: BuiltinStmt, i: number): Expr | null {
  return s.args[i] ?? null;
}

function lowerGraphics(ctx: LowerCtx, s: BuiltinStmt): void {
  const b = ctx.b;
  const [a0, a1, a2, a3] = [gfxArg(s, 0), gfxArg(s, 1), gfxArg(s, 2), gfxArg(s, 3)];
  const move = GFX_MOVES[s.keyword];
  if (move !== undefined) {
    // PLOT x, y [, pen [, mode]]: x waits on the stack, then the pen and the ink mode are set, then y goes in HL.
    if (a0 === null || a1 === null) throw new InternalError(`lowering: ${s.keyword} without its coordinates`);
    const x = gfxPushed(ctx, a0);
    if (x === null) return;
    const y = gfxInt(ctx, a1);
    if (y === null) return;
    if (a2 !== null) gfxOne(ctx, a2, 'GPENP', s.span);
    if (a3 !== null) gfxOne(ctx, a3, 'GMODE', s.span);
    gfxFinish(ctx, [x], y, move, s.span);
    return;
  }
  switch (s.keyword) {
    case 'CLG':
      if (a0 === null) b.rtcall('.core.__LOCO_GCLG', null, s.span);
      else gfxOne(ctx, a0, 'GCLGP', s.span);
      return;
    case 'GRAPHICS PEN':
      if (a0 !== null) gfxOne(ctx, a0, 'GPEN', s.span);
      if (a1 !== null) gfxOne(ctx, a1, 'GBACK', s.span);
      return;
    case 'GRAPHICS PAPER':
      if (a0 !== null) gfxOne(ctx, a0, 'GPAPER', s.span);
      return;
    case 'FILL':
      if (a0 !== null) gfxOne(ctx, a0, 'GFILL', s.span);
      return;
    case 'MASK':
      if (a0 !== null) gfxOne(ctx, a0, 'GMASK', s.span);
      if (a1 !== null) gfxOne(ctx, a1, 'GFIRST', s.span);
      return;
    case 'ORIGIN': {
      // ORIGIN x, y [, left, right, top, bottom]: all but the last are pushed in order, the last goes in HL.
      const list = s.args.filter((a): a is Expr => a !== null && a !== undefined);
      if (list.length !== 2 && list.length !== 6) throw new InternalError('lowering: ORIGIN needs 2 or 6 arguments');
      const waiting: Val[] = [];
      for (const e of list.slice(0, -1)) {
        const w = gfxPushed(ctx, e);
        if (w === null) return;
        waiting.push(w);
      }
      const last = gfxInt(ctx, list[list.length - 1] as Expr);
      if (last !== null) gfxFinish(ctx, waiting, last, list.length === 2 ? 'GORIGIN' : 'GORIGINW', s.span);
      return;
    }
    case 'INK': {
      // INK pen, c1 [, c2]: pen (and c1) wait on the stack, the last colour goes in HL.
      if (a0 === null || a1 === null) throw new InternalError('lowering: INK without its arguments');
      const waiting: Val[] = [];
      for (const e of a2 === null ? [a0] : [a0, a1]) {
        const w = gfxPushed(ctx, e);
        if (w === null) return;
        waiting.push(w);
      }
      const last = gfxInt(ctx, a2 ?? a1);
      if (last !== null) gfxFinish(ctx, waiting, last, a2 === null ? 'INK1' : 'INK', s.span);
      return;
    }
    case 'SPEED INK':
    case 'CIRCLE': {
      if (a0 === null || a1 === null) throw new InternalError(`lowering: ${s.keyword} without its arguments`);
      const waiting: Val[] = [];
      for (const e of s.keyword === 'CIRCLE' ? [a0, a1] : [a0]) {
        const w = gfxPushed(ctx, e);
        if (w === null) return;
        waiting.push(w);
      }
      const e = s.keyword === 'CIRCLE' ? a2 : a1;
      const last = e === null ? null : gfxInt(ctx, e);
      if (last !== null) gfxFinish(ctx, waiting, last, s.keyword === 'CIRCLE' ? 'GCIRCLE' : 'SPEEDINK', s.span);
      return;
    }
    default:
      ctx.notYet(s.span, s.keyword);
  }
}

/** TEST(x, y), TESTR(dx, dy), POINT(x, y): x on the stack, y in HL; the pen comes back in HL. */
function lowerGfxTest(ctx: LowerCtx, e: BuiltinCall, label: string): Val | null {
  const [xE, yE] = [e.args[0], e.args[1]];
  if (xE === undefined || yE === undefined) throw new InternalError(`lowering: ${e.keyword} without its arguments`);
  const x = gfxPushed(ctx, xE);
  if (x === null) return null;
  const y = gfxInt(ctx, yE);
  if (y === null) return null;
  const o = gfxFinish(ctx, [x], y, label, e.span, 'u16');
  return o === null ? null : castTo(ctx, { o, t: 'u16' }, 'u8', e.span);
}

/** BORDER c1 [, c2]: B = c1, C = c2 (c1 again for the one-colour form). */
function lowerBorder(ctx: LowerCtx, s: BuiltinStmt): void {
  const first = s.args[0];
  const second = s.args[1] ?? null;
  if (first === undefined || first === null) throw new InternalError('lowering: BORDER without a colour');
  const toB = (e: Expr, reg: 'b' | 'c'): string[] | null => {
    const v = operandOf(ctx, e, 'u8');
    if (v === null) return null;
    if (v.o.k === 'imm') return [`\tld ${reg}, ${v.o.value}`];
    const slot = ctx.hidden('u8');
    ctx.b.store('u8', slot, v.o, e.span);
    return [`\tld a, (${(slot as Extract<Operand, { k: 'global' }>).label})`, `\tld ${reg}, a`];
  };
  const lb = toB(first, 'b');
  if (lb === null) return;
  const lc = second === null ? ['\tld c, b'] : toB(second, 'c');
  if (lc === null) return;
  asmLines(ctx, s.span, [...lb, ...lc]);
  ctx.b.rtcall('.core.__LOCO_BORDER', null, s.span);
}

/** LOCATE col, row: H = col, L = row (1-based); the routine returns Carry for an out-of-range pair, which is error 5. */
function lowerLocate(ctx: LowerCtx, s: BuiltinStmt): void {
  const colE = s.args[0];
  const rowE = s.args[1];
  if (colE === undefined || colE === null || rowE === undefined || rowE === null) throw new InternalError('lowering: LOCATE without its arguments');
  const b = ctx.b;
  const cc = constNumber(ctx, colE);
  const rc = constNumber(ctx, rowE);
  if (cc !== null && rc !== null) {
    // A constant outside 0..255 becomes column 0, which the routine refuses like any other bad pair.
    const ok = cc >= 0 && cc <= 255 && rc >= 0 && rc <= 255 && Number.isInteger(cc) && Number.isInteger(rc);
    b.fparam('u16', immOf(ok ? cc * 256 + rc : 0, 'u16').o, s.span);
  } else {
    // Each argument is checked against 0..255 as a 16-bit value (Locomotive: error 5 above 255; 0 is the routine's).
    const c = operandOf(ctx, colE, 'u16');
    if (c === null) return;
    b.fparam('u16', c.o, s.span);
    const c16 = b.rtcall('.core.__LOCO_ARG255', 'u16', s.span) as Operand;
    const hi = b.shl('u16', c16, immOf(8, 'u8').o, s.span);
    const r = operandOf(ctx, rowE, 'u16');
    if (r === null) return;
    b.fparam('u16', r.o, s.span);
    const r16 = b.rtcall('.core.__LOCO_ARG255', 'u16', s.span) as Operand;
    b.fparam('u16', b.or('u16', hi, r16, s.span), s.span);
  }
  b.rtcall('.core.__LOCO_LOCATE', null, s.span);
  const ok = ctx.newLabel();
  const errFile = runtimeLabelFile('.core.__ERROR');
  if (errFile === undefined) throw new InternalError('lowering: no file for .core.__ERROR');
  ctx.require(errFile);
  asmLines(ctx, s.span, [`\tjr nc, ${ok}`, '\tld a, 5', '\tjp .core.__ERROR']);
  b.label(ok, s.span);
}

/**
 * CALL address [, p1, ...] (spec §18): the parameters are pushed as 16-bit words, first
 * first, so the last is at IX+0; A = count, IX = the block. A constant address in the
 * firmware jumpblock (&B900-&BDFF) goes through the gate; any other constant is a plain
 * call, and a computed address is called through `jp (hl)`. IX is saved and restored and the
 * block removed afterwards.
 */
export function lowerCall(ctx: LowerCtx, s: CallStmt): void {
  const b = ctx.b;
  const n = s.args.length;
  if (n > 32) {
    ctx.notYet(s.span, 'CALL with more than 32 parameters');
    return;
  }
  const known = constNumber(ctx, s.address);
  // String temporaries whose descriptors the callee reads: freed after the CALL.
  const owned: Operand[] = [];
  for (const arg of s.args) {
    if (isStringArgument(ctx, arg)) {
      const d = callDescriptor(ctx, arg, owned);
      if (d === null) return;
      b.param('u16', d, arg.span);
      continue;
    }
    const v = operandOf(ctx, arg, 'u16');
    if (v === null) return;
    b.param('u16', v.o, arg.span);
  }
  // A computed address is evaluated after the arguments (it is the last value needed), so an
  // argument that runs this same CALL again (a recursive FUNCTION) cannot overwrite it.
  let target: Operand | null = null;
  if (known === null) {
    const a = operandOf(ctx, s.address, 'u16');
    if (a === null) return;
    target = ctx.hidden('u16');
    b.store('u16', target, a.o, s.address.span);
  }
  const head = ['\tld hl, 0', '\tadd hl, sp', '\tpush ix', '\tpush hl', '\tpop ix', `\tld a, ${n}`];
  const tail = ['\tpop ix', ...(n > 0 ? [`\tld hl, ${2 * n}`, '\tadd hl, sp', '\tld sp, hl'] : [])];
  if (known !== null) {
    const addr = Math.trunc(known) & 0xffff;
    if (addr >= 0xb900 && addr <= 0xbdff) {
      ctx.require('fwcall.asm');
      asmLines(ctx, s.span, [...head, '\tcall .core.__FW_CALL', `\tdefw ${addr}`, ...tail]);
    } else {
      asmLines(ctx, s.span, [...head, `\tcall ${addr}`, ...tail]);
    }
    freeDescriptorStrings(ctx, owned, s.span);
    return;
  }
  const enter = ctx.newLabel();
  const done = ctx.newLabel();
  asmLines(ctx, s.span, [...head, `\tld hl, (${(target as Extract<Operand, { k: 'global' }>).label})`, `\tcall ${enter}`, `\tjr ${done}`]);
  b.label(enter, s.span);
  asmLines(ctx, s.span, ['\tjp (hl)']);
  b.label(done, s.span);
  asmLines(ctx, s.span, tail);
  freeDescriptorStrings(ctx, owned, s.span);
}

/** A CALL argument that is passed as a string descriptor: a STRING expression, or `@name$` of a string variable. */
function isStringArgument(ctx: LowerCtx, arg: Expr): boolean {
  if (ctx.typeOf(arg) === 'STRING') return true;
  return arg.kind === 'AddressOf' && arg.index === undefined && stringVariable(ctx, arg.target) !== undefined;
}

function stringVariable(ctx: LowerCtx, name: Name): VariableSymbol | undefined {
  const id = ctx.checked.bound.resolutions.names.get(name);
  const s = id === undefined ? undefined : ctx.sym(id);
  return s?.kind === 'variable' && s.type === 'STRING' ? s : undefined;
}

/**
 * The address of the 3-byte descriptor (length capped at 255, text address) of a string
 * argument, built by `__LOCO_STRDESC` in a scratch buffer (a frame slot in a procedure, so
 * recursion keeps its own). An owned temporary is parked in a scratch string slot until the CALL
 * has returned (`owned`); a variable or constant is read where it is, so a routine that writes
 * into the text changes the variable.
 */
function callDescriptor(ctx: LowerCtx, arg: Expr, owned: Operand[]): Operand | null {
  const b = ctx.b;
  let str: Operand;
  if (arg.kind === 'AddressOf') {
    const v = stringVariable(ctx, arg.target) as VariableSymbol;
    const o = ctx.varOperand(v, arg.span);
    if (o === null) return null;
    str = o;
  } else {
    const val = lowerExpr(ctx, arg);
    if (val === null) return null;
    str = val.o;
    if (str.k === 'temp') {
      const slot = ctx.scratch('str');
      b.store('str', slot, str, arg.span);
      owned.push(slot);
      str = slot;
    }
  }
  const buf = ctx.scratch('f'); // 5 bytes; the descriptor uses 3
  const at: Operand = buf.k === 'frame' ? { k: 'frameaddr', offset: buf.offset } : { k: 'addr', label: (buf as Extract<Operand, { k: 'global' }>).label };
  b.param('u16', at, arg.span);
  b.fparam('str', str, arg.span);
  b.rtcall('.core.__LOCO_STRDESC', null, arg.span);
  return at;
}

/** Frees the string temporaries parked for descriptors, and clears their slots so a loop starts clean. */
function freeDescriptorStrings(ctx: LowerCtx, owned: readonly Operand[], span: Span): void {
  for (const slot of owned) {
    ctx.b.fparam('str', slot, span);
    ctx.b.rtcall('.core.__MEM_FREE', null, span);
    ctx.b.store('u16', slot, { k: 'imm', value: 0 }, span);
  }
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

export function lowerBuiltinCall(ctx: LowerCtx, e: BuiltinCall): Val | null {
  const b = ctx.b;
  const a0 = e.args[0];
  switch (e.keyword) {
    case 'PEEK': {
      if (a0 === undefined) throw new InternalError('lowering: PEEK without an address');
      const t = irType(e.typeArg?.name ?? 'UBYTE');
      const a = operandOf(ctx, a0, 'u16');
      return a === null ? null : { o: b.peek(t, a.o, e.span), t };
    }
    case 'INP': {
      if (a0 === undefined) throw new InternalError('lowering: INP without a port');
      const a = operandOf(ctx, a0, 'u16');
      return a === null ? null : { o: b.in(a.o, e.span), t: 'u8' };
    }
    case 'FRE':
      // FRE(0) and FRE(""): the argument is not evaluated (the heap has nothing to collect).
      return { o: b.rtcall('.core.__LOCO_FRE', 'u16', e.span) as Operand, t: 'u16' };
    case 'HIMEM':
      return { o: b.rtcall('.core.__LOCO_HIMEM', 'u16', e.span) as Operand, t: 'u16' };
    case 'RANDOM': {
      if (a0 === undefined) throw new InternalError('lowering: RANDOM without its range');
      const n = operandOf(ctx, a0, 'u16');
      if (n === null) return null;
      b.fparam('u16', n.o, e.span);
      return { o: b.rtcall('.core.__LOCO_RANDOM', 'u16', e.span) as Operand, t: 'u16' };
    }
    case 'SQ': {
      const v = a0 === undefined ? null : soundInt(ctx, a0);
      if (v === null) return null;
      b.fparam('i16', v.o, e.span);
      const r = b.rtcall('.core.__LOCO_SQ', 'u16', e.span) as Operand;
      return castTo(ctx, { o: r, t: 'u16' }, 'u8', e.span);
    }
    case 'POS':
    case 'VPOS': {
      // POS(#s): a stream other than the constant 0 goes to __LOCO_POSS / __LOCO_VPOSS with A = the stream
      let o: Operand;
      if (e.stream === null || constNumber(ctx, e.stream) === 0) {
        o = b.rtcall(`.core.__LOCO_${e.keyword}`, 'u16', e.span) as Operand;
      } else {
        const st = streamOperand(ctx, e.stream);
        if (st === null) return null;
        b.fparam('u8', st, e.span);
        o = b.rtcall(`.core.__LOCO_${e.keyword}S`, 'u16', e.span) as Operand;
      }
      return castTo(ctx, { o, t: 'u16' }, 'u8', e.span);
    }
    case 'COPYCHR$': {
      const st = e.stream === null ? immOf(0, 'u8').o : streamOperand(ctx, e.stream);
      if (st === null) return null;
      b.fparam('u8', st, e.span);
      return { o: b.rtcall('.core.__LOCO_COPYCHR', 'str', e.span) as Operand, t: 'str' };
    }
    case 'ERR':
    case 'ERL':
      return lowerErrFn(ctx, e.keyword, e.span);
    case 'INKEY$':
      return { o: b.rtcall('.core.__LOCO_INKEY', 'str', e.span) as Operand, t: 'str' };
    case 'TEST':
      return lowerGfxTest(ctx, e, 'GTEST');
    case 'TESTR':
      return lowerGfxTest(ctx, e, 'GTESTR');
    case 'POINT':
      return lowerGfxTest(ctx, e, 'GPOINT');
    case 'XPOS':
    case 'YPOS':
      return { o: b.rtcall(`.core.__LOCO_G${e.keyword}`, 'i16', e.span) as Operand, t: 'i16' };
    case 'INKEY':
    case 'JOY':
      return lowerKeyFunction(ctx, e) ?? null;
    case 'EOF':
    case 'DERR':
      return lowerFileFunction(ctx, e) ?? null;
    case 'ABS': {
      const v = a0 === undefined ? null : lowerExpr(ctx, a0);
      return v === null ? null : { o: b.abs(v.t, v.o, e.span), t: v.t };
    }
    case 'SGN': {
      const v = a0 === undefined ? null : lowerExpr(ctx, a0);
      if (v === null) return null;
      const x = duplicable(ctx, v, e.span);
      const zero = immOf(0, v.t).o;
      const neg = b.compare('lt', v.t, x.o, zero, e.span);
      const pos = b.compare('gt', v.t, x.o, zero, e.span);
      return { o: b.sub('i16', neg, pos, e.span), t: 'i16' };
    }
    case 'MIN':
    case 'MAX':
      return lowerMinMax(ctx, e);
    case 'CINT':
      return lowerCint(ctx, e);
    case 'UNT': {
      const v = a0 === undefined ? null : lowerExpr(ctx, a0);
      return v === null ? null : castTo(ctx, v, 'i16', e.span);
    }
    case 'SQR':
    case 'SIN':
    case 'COS':
    case 'TAN':
    case 'ATN':
    case 'EXP':
    case 'LOG':
    case 'LOG10': {
      const v = a0 === undefined ? null : operandOf(ctx, a0, 'f');
      if (v === null) return null;
      b.fparam('f', v.o, e.span);
      return { o: b.rtcall(`.core.__LOCO_${e.keyword}`, 'f', e.span) as Operand, t: 'f' };
    }
    case 'PI':
      return immOf(Math.PI, 'f');
    case 'CREAL': {
      const v = a0 === undefined ? null : lowerExpr(ctx, a0);
      return v === null ? null : castTo(ctx, v, 'f', e.span);
    }
    case 'INT':
    case 'FIX': {
      const v = a0 === undefined ? null : lowerExpr(ctx, a0);
      if (v === null) return null;
      if (v.t === 'f') {
        b.fparam('f', v.o, e.span);
        return { o: b.rtcall(`.core.__LOCO_${e.keyword}`, 'f', e.span) as Operand, t: 'f' };
      }
      if (v.t === 'f16') {
        b.fparam('f16', v.o, e.span);
        return { o: b.rtcall(`.core.__LOCO_${e.keyword}F16`, 'f16', e.span) as Operand, t: 'f16' };
      }
      return v; // an integer is its own floor and truncation
    }
    case 'RND': {
      // RND and RND(n > 0): the next value; RND(0): the last value again; RND(-n): a reseed from n,
      // then the first value of the new sequence. A sign known only at run time goes to __LOCO_RNDARG.
      if (a0 === undefined) return { o: b.rtcall('.core.__LOCO_RND', 'f', e.span) as Operand, t: 'f' };
      const n = constNumber(ctx, a0);
      if (n !== null && n > 0) return { o: b.rtcall('.core.__LOCO_RND', 'f', e.span) as Operand, t: 'f' };
      if (n === 0) return { o: b.rtcall('.core.__LOCO_RNDLAST', 'f', e.span) as Operand, t: 'f' };
      const v = operandOf(ctx, a0, 'f');
      if (v === null) return null;
      b.fparam('f', v.o, a0.span);
      return { o: b.rtcall('.core.__LOCO_RNDARG', 'f', e.span) as Operand, t: 'f' };
    }
    case 'ROUND':
      return lowerRound(ctx, e);
    case 'HEX$':
    case 'BIN$':
      return lowerRadix(ctx, e);
    case 'DEC$':
      return lowerDec(ctx, e);
    case 'LBOUND':
    case 'UBOUND': {
      // the bounds of a DIMmed array are folded by the checker; only an array parameter reaches here
      const id = a0?.kind === 'Name' ? ctx.checked.bound.resolutions.names.get(a0) : undefined;
      const arr = id === undefined ? undefined : ctx.sym(id);
      if (arr?.kind !== 'array') throw new InternalError(`lowering: ${e.keyword} of something that is not an array`);
      return lowerParamBound(ctx, e.keyword, arr, e.args[1], e.span);
    }
    case 'REMAIN':
      return lowerRemain(ctx, e);
    case 'TIME':
      return lowerTime(ctx, e);
    case 'CAST': {
      const to = e.typeArg?.name;
      if (a0 === undefined || to === undefined) throw new InternalError('lowering: CAST without its operands');
      return operandOf(ctx, a0, irType(to));
    }
    default: {
      const hook = STRING_BUILTINS[e.keyword];
      if (hook !== undefined) return hook(ctx, e);
      ctx.notYet(e.span, e.keyword.endsWith('$') || e.keyword === 'LEN' || e.keyword === 'ASC' ? `${e.keyword} (strings)` : e.keyword);
      return null;
    }
  }
}

/** A value that can be read twice: immediates and variables as they are, a temp spilled to a scratch slot. */
function duplicable(ctx: LowerCtx, v: Val, span: Span): Val {
  if (v.o.k !== 'temp') return v;
  const slot = ctx.scratch(v.t);
  ctx.b.store(v.t, slot, v.o, span);
  return { o: slot, t: v.t };
}

/** MIN / MAX without a branch (a branch would leave temps live across a label): (a AND m) OR (b AND NOT m) with m the comparison. */
function lowerMinMax(ctx: LowerCtx, e: BuiltinCall): Val | null {
  const b = ctx.b;
  const rt = ctx.typeOf(e);
  if (e.args.length > 0 && (rt === 'REAL' || rt === 'FIXED')) {
    // FIXED goes through the REAL routines (a FIXED is exact as a REAL): the -1/0 mask of the
    // integer form below is not a FIXED bit pattern
    const r = lowerMinMaxReal(ctx, e);
    return r === null || rt === 'REAL' ? r : castTo(ctx, r, 'f16', e.span);
  }
  const [lowerOp, upperOp] = e.keyword === 'MIN' ? (['lt', 'ge'] as const) : (['gt', 'le'] as const);
  let acc: Val | null = null;
  for (const arg of e.args) {
    const v = lowerExpr(ctx, arg);
    if (v === null) return null;
    if (acc === null) {
      acc = v;
      continue;
    }
    // acc and v are both possibly temps (acc pushed first): spill v first, then acc.
    const bv = duplicable(ctx, v, e.span);
    const av = duplicable(ctx, acc, e.span);
    const t = av.t;
    const mA = castTo(ctx, { o: b.compare(lowerOp, t, av.o, bv.o, e.span), t: 'i16' }, t, e.span);
    const left = b.and(t, av.o, mA.o, e.span);
    const mB = castTo(ctx, { o: b.compare(upperOp, t, av.o, bv.o, e.span), t: 'i16' }, t, e.span);
    const right = b.and(t, bv.o, mB.o, e.span);
    acc = { o: b.or(t, left, right, e.span), t };
  }
  return acc;
}

/**
 * MIN / MAX of REALs: the pairwise result comes from `__LOCO_MINF` / `__LOCO_MAXF`, which pop
 * both values from the stack (two `param` quads, the second value first). The running value is a
 * temp (pushed before the next argument is evaluated), so a procedure call in a later argument
 * cannot change it.
 */
function lowerMinMaxReal(ctx: LowerCtx, e: BuiltinCall): Val | null {
  const b = ctx.b;
  const label = `.core.__LOCO_${e.keyword === 'MIN' ? 'MINF' : 'MAXF'}`;
  let acc: Val | null = null;
  for (const arg of e.args) {
    let v = lowerExpr(ctx, arg);
    if (v === null) return null;
    if (v.t !== 'f') v = castTo(ctx, v, 'f', e.span);
    if (v.o.k !== 'temp') v = { o: b.load('f', v.o, e.span), t: 'f' };
    if (acc === null) {
      acc = v;
      continue;
    }
    b.param('f', v.o, e.span);
    b.param('f', acc.o, e.span);
    acc = { o: b.rtcall(label, 'f', e.span) as Operand, t: 'f' };
  }
  return acc;
}

/** CINT: rounds half away from zero (Locomotive); a result outside -32768..32767 is error 6 (Overflow, L4-ERR), at run time too for a constant. */
function lowerCint(ctx: LowerCtx, e: BuiltinCall): Val | null {
  const a0 = e.args[0];
  const v = a0 === undefined ? null : lowerRaw(ctx, a0);
  if (v === null) return null;
  // BYTE, UBYTE and INTEGER always fit; a UINTEGER, LONG or ULONG goes through the REAL routine unless it is a constant in range
  const wide = v.t === 'u16' || v.t === 'i32' || v.t === 'u32';
  if (v.t !== 'f' && v.t !== 'f16' && !(wide && !(v.o.k === 'imm' && v.o.value >= -32768 && v.o.value <= 32767))) return castTo(ctx, v, 'i16', e.span);
  if (v.o.k === 'imm') {
    const x = v.o.value;
    const r = x < 0 ? -Math.floor(-x + 0.5) : Math.floor(x + 0.5);
    if (r >= -32768 && r <= 32767) return immOf(r, 'i16');
    // out of range: the run-time routine raises Overflow, as Locomotive does when the program runs
  }
  const r = castTo(ctx, v, 'f', e.span);
  ctx.b.fparam('f', r.o, e.span);
  return { o: ctx.b.rtcall('.core.__LOCO_CINT', 'i16', e.span) as Operand, t: 'i16' };
}

// ---------------------------------------------------------------------------
// HEX$, BIN$, DEC$ and the MID$ statement (L3-STR; lib/loco/strfmt.asm)
// ---------------------------------------------------------------------------

/** A temp holding `v` (even an immediate), so it can be pushed before later code runs. */
function pushed(ctx: LowerCtx, v: Val, span: Span): Val {
  return v.o.k === 'temp' ? v : { o: ctx.b.load(v.t, v.o, span), t: v.t };
}

/**
 * ROUND(x [, n]): x as a REAL on the stack (`param f`), n (a REAL is rounded half away from zero
 * first, as the interpreter does: ROUND(2.567, 1.6) is 2.57) as a 16-bit value in HL
 * (`__LOCO_ROUND`). The result is a REAL.
 */
function lowerRound(ctx: LowerCtx, e: BuiltinCall): Val | null {
  const b = ctx.b;
  const [xE, nE] = [e.args[0], e.args[1]];
  if (xE === undefined) throw new InternalError('lowering: ROUND without an argument');
  const x0 = operandOf(ctx, xE, 'f');
  if (x0 === null) return null;
  b.param('f', pushed(ctx, x0, xE.span).o, xE.span);
  let n: Val = immOf(0, 'i16');
  if (nE !== undefined) {
    let v = lowerExpr(ctx, nE);
    if (v === null) return null;
    if (v.t === 'f' || v.t === 'f16') {
      if (v.o.k === 'imm') {
        const k = v.o.value;
        v = immOf(k < 0 ? -Math.floor(-k + 0.5) : Math.floor(k + 0.5), 'i16');
      } else {
        const r = castTo(ctx, v, 'f', nE.span);
        b.fparam('f', r.o, nE.span);
        v = { o: b.rtcall('.core.__LOCO_CINT', 'i16', nE.span) as Operand, t: 'i16' };
      }
    }
    n = castTo(ctx, v, 'i16', nE.span);
  }
  b.fparam('i16', n.o, e.span);
  return { o: b.rtcall('.core.__LOCO_ROUND', 'f', e.span) as Operand, t: 'f' };
}

/**
 * HEX$(n [, w]) and BIN$(n [, w]): n as a 16-bit unsigned value (-1 is FFFF; a REAL is rounded
 * half away from zero first, as the interpreter does), w the minimum width (0 when omitted);
 * both go to `__LOCO_HEX` / `__LOCO_BIN` on the stack, n first. A width outside 0..16 is error 5.
 */
function lowerRadix(ctx: LowerCtx, e: BuiltinCall): Val | null {
  const b = ctx.b;
  const [nE, wE] = [e.args[0], e.args[1]];
  if (nE === undefined) throw new InternalError(`lowering: ${e.keyword} without an argument`);
  let v = lowerExpr(ctx, nE);
  if (v === null) return null;
  if (v.t === 'f' || v.t === 'f16') {
    if (v.o.k === 'imm') {
      const x = v.o.value;
      v = immOf(x < 0 ? -Math.floor(-x + 0.5) : Math.floor(x + 0.5), 'i16');
    } else {
      const r = castTo(ctx, v, 'f', nE.span);
      b.fparam('f', r.o, nE.span);
      v = { o: b.rtcall('.core.__LOCO_CINT', 'i16', nE.span) as Operand, t: 'i16' };
    }
  }
  const n = pushed(ctx, castTo(ctx, v, 'u16', nE.span), nE.span);
  let w: Val | null = immOf(0, 'i16');
  if (wE !== undefined) {
    w = operandOf(ctx, wE, 'i16');
    if (w === null) return null;
  }
  b.param('i16', w.o, e.span);
  b.param('u16', n.o, e.span);
  return { o: b.rtcall(`.core.__LOCO_${e.keyword === 'HEX$' ? 'HEX' : 'BIN'}`, 'str', e.span) as Operand, t: 'str' };
}

/**
 * DEC$(n, f$): n as a REAL (pushed first, as `param f`), the format in HL with the free flag in A
 * (`fparam:str`), so a variable or constant format is not copied.
 */
function lowerDec(ctx: LowerCtx, e: BuiltinCall): Val | null {
  const b = ctx.b;
  const [nE, fE] = [e.args[0], e.args[1]];
  if (nE === undefined || fE === undefined) throw new InternalError('lowering: DEC$ without its arguments');
  const n0 = operandOf(ctx, nE, 'f');
  if (n0 === null) return null;
  const n = pushed(ctx, n0, nE.span);
  b.param('f', n.o, e.span);
  const f = lowerExpr(ctx, fE);
  if (f === null) return null;
  b.fparam('str', f.o, fE.span);
  return { o: b.rtcall('.core.__LOCO_DEC', 'str', e.span) as Operand, t: 'str' };
}

/**
 * MID$(a$, p [, n]) = b$ (spec §8): the characters of a$ from p on are replaced in place by those of
 * b$, at most n of them, and a$ never changes length (`__LOCO_MIDSET`, `__LOCO_MIDSET2`). The
 * arguments are evaluated p, n, b$; p and n go on the stack, b$ as a pointer (a temp is owned and
 * freed by the routine: the `F` entries), and a$'s current pointer travels in HL.
 * Only a variable can be the target for now.
 */
export function lowerMidAssign(ctx: LowerCtx, s: MidAssignStmt): void {
  const b = ctx.b;
  // The string to change: a variable's slot, or an array element (its indexes first, as Locomotive
  // reads the target before the value). A computed element's address waits in a scratch slot, since
  // the arguments go on the stack above it; the pointer is read from it last.
  let pointer: () => Operand;
  if (s.target.kind === 'Name') {
    const id = ctx.checked.bound.resolutions.names.get(s.target);
    const sym = id === undefined ? undefined : ctx.sym(id);
    if (sym?.kind !== 'variable') throw new InternalError('lowering: a MID$ assignment to something that is not a variable');
    const dst = ctx.varOperand(sym, s.target.span);
    if (dst === null) return;
    pointer = () => dst;
  } else {
    const arr = s.target.kind === 'CallOrIndex' ? arrayOf(ctx, s.target) : null;
    if (arr === null || s.target.kind !== 'CallOrIndex') throw new InternalError('lowering: a MID$ assignment to something that is not a variable or an element');
    const ref = lowerElement(ctx, arr, s.target.args, s.target.span);
    if (ref === null) return;
    const span = s.target.span;
    if (ref.kind === 'static') {
      const at = ref.at;
      pointer = () => b.peek('u16', at, span);
    } else {
      const slot = ctx.scratch('u16');
      b.store('u16', slot, ref.addr, span);
      pointer = () => b.peek('u16', slot, span);
    }
  }
  const p = operandOf(ctx, s.start, 'i16');
  if (p === null) return;
  const pv = pushed(ctx, p, s.start.span);
  let nv: Val | null = null;
  if (s.length !== null) {
    const n = operandOf(ctx, s.length, 'i16');
    if (n === null) return;
    nv = pushed(ctx, n, s.length.span);
  }
  const v = lowerExpr(ctx, s.value);
  if (v === null) return;
  const owned = v.o.k === 'temp';
  // a constant's address is an `addr` operand for the integer templates
  const bo: Operand = v.o.k === 'strconst' ? { k: 'addr', label: `.S.${v.o.id}` } : v.o;
  b.param(owned ? 'str' : 'u16', bo, s.value.span);
  if (nv !== null) b.param('i16', nv.o, s.span);
  b.param('i16', pv.o, s.span);
  b.fparam('u16', pointer(), s.span);
  b.rtcall(`.core.__LOCO_MIDSET${nv === null ? '2' : ''}${owned ? 'F' : ''}`, null, s.span);
}

// ---------------------------------------------------------------------------
// SOUND, ENV, ENT, RELEASE, SQ and BEEP (L4-SOUND; lib/loco/sound.asm, lib/runtime/io/sound/beeper.asm)
// ---------------------------------------------------------------------------

/**
 * A sound argument as a 16-bit value. Locomotive reads these as integers, so a REAL is rounded half
 * away from zero (SOUND 1.5, 100 is channel 2, measured); an integer keeps its low 16 bits (the
 * routines test them as unsigned, so a negative value is above every limit).
 */
function soundInt(ctx: LowerCtx, e: Expr): Val | null {
  const v = lowerExpr(ctx, e);
  if (v === null) return null;
  if (v.t === 'f' || v.t === 'f16') {
    if (v.o.k === 'imm') {
      const x = v.o.value;
      return immOf(x < 0 ? -Math.floor(-x + 0.5) : Math.floor(x + 0.5), 'i16');
    }
    const r = castTo(ctx, v, 'f', e.span);
    ctx.b.fparam('f', r.o, e.span);
    return { o: ctx.b.rtcall('.core.__LOCO_CINT', 'i16', e.span) as Operand, t: 'i16' };
  }
  return castTo(ctx, v, 'i16', e.span);
}

/**
 * Pushes the values in order (first deepest, each as a word) and declares them the stack arguments of
 * the next runtime call: the `param` quads go last value first, which pushes nothing (a temp is already
 * on the stack, see docs/ir.md "Evaluation model"). Null after an error.
 */
function pushWords(ctx: LowerCtx, values: readonly (Expr | number)[], span: Span): boolean {
  const temps: Operand[] = [];
  for (const v of values) {
    const val = typeof v === 'number' ? immOf(v, 'i16') : soundInt(ctx, v);
    if (val === null) return false;
    temps.push(pushed(ctx, val, span).o);
  }
  for (let i = temps.length - 1; i >= 0; i--) ctx.b.param('i16', temps[i] as Operand, span);
  return true;
}

/** SOUND ch, period [, dur [, vol [, env [, ent [, noise]]]]]: the seven words, the omitted ones at Locomotive's defaults. */
function lowerSound(ctx: LowerCtx, s: BuiltinStmt): void {
  const defaults = [0, 0, 20, 12, 0, 0, 0];
  const values = defaults.map((d, i) => s.args[i] ?? d);
  if (!pushWords(ctx, values as (Expr | number)[], s.span)) return;
  ctx.b.rtcall('.core.__LOCO_SOUND', null, s.span);
}

/** ENV n, sections / ENT n, sections: n and the values on the stack, HL = the value count + 256 * the hardware-section mask. */
function lowerEnvelope(ctx: LowerCtx, s: BuiltinStmt): void {
  const args = s.args as readonly Expr[];
  if (!pushWords(ctx, args, s.span)) return;
  let mask = 0;
  const hw = new Set(s.hardwareAt ?? []);
  for (let i = 1, section = 0; i < args.length; section++) {
    if (hw.has(i)) {
      mask |= 1 << section;
      i += 2;
    } else i += 3;
  }
  ctx.b.fparam('u16', immOf(args.length - 1 + mask * 256, 'u16').o, s.span);
  ctx.b.rtcall(`.core.__LOCO_${s.keyword}`, null, s.span);
}

/** RELEASE channels: HL = the channel mask 0..7. */
function lowerRelease(ctx: LowerCtx, s: BuiltinStmt): void {
  const a = s.args[0];
  const v = a === undefined || a === null ? null : soundInt(ctx, a);
  if (v === null) return;
  ctx.b.fparam('i16', v.o, s.span);
  ctx.b.rtcall('.core.__LOCO_RELEASE', null, s.span);
}

/** Middle C is 261.625565290 Hz (the reference compiler's table); the AY divides 62500 Hz by the tone period. */
const BEEP_PERIOD_AT_C = 62500 / 261.62556529;

/** BEEP's constants as the reference compiler's `getDEHL` has them: [duration in 1/100 s, tone period]. */
export function beepConstants(duration: number, pitch: number): [number, number] {
  const period = Math.min(4095, Math.max(1, Math.trunc(0.5 + BEEP_PERIOD_AT_C * 2 ** (-pitch / 12))));
  return [Math.trunc(0.5 + duration * 100), period];
}

/**
 * BEEP duration, pitch (Sinclair): both constant, the checker has range-checked them and they become
 * the period (pushed) and the duration in 1/100 s (HL) of `__BEEPER`. Otherwise the same numbers are
 * computed at run time by `__LOCO_BEEP` on REALs, with the pitch held to -60..127 and the duration to 0..10 seconds (the
 * reference compiler's run-time BEEP clamps the period and plays nothing for a negative duration).
 */
function lowerBeep(ctx: LowerCtx, s: BuiltinStmt): void {
  const b = ctx.b;
  const [dE, pE] = [s.args[0], s.args[1]];
  if (dE === undefined || dE === null || pE === undefined || pE === null) throw new InternalError('lowering: BEEP without its arguments');
  const [dc, pc] = [constNumber(ctx, dE), constNumber(ctx, pE)];
  if (dc !== null && pc !== null) {
    const [dur, period] = beepConstants(dc, pc);
    b.param('u16', immOf(period, 'u16').o, s.span);
    b.fparam('u16', immOf(dur, 'u16').o, s.span);
    b.rtcall('.core.__BEEPER', null, s.span);
    return;
  }
  // run time: one routine (lib/loco/beep.asm) holds the pitch to -60..127 and the duration to 0..10, computes
  // the period 62500 / (261.6256 * 2^(pitch / 12)) and the duration in 1/100 s, and plays them. The duration is pushed
  // as a REAL, the pitch goes in the result registers.
  const d = operandOf(ctx, dE, 'f');
  if (d === null) return;
  b.param('f', d.o, dE.span);
  const p = operandOf(ctx, pE, 'f');
  if (p === null) return;
  b.fparam('f', p.o, pE.span);
  b.rtcall('.core.__LOCO_BEEP', null, s.span);
}
