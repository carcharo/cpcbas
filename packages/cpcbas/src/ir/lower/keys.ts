/**
 * L4-KEYS: the keyboard statements and functions (runtime lib/loco/keys.asm
 * and input.asm, register contracts in their headers): INKEY(n), JOY(n), CLEAR INPUT, KEY, KEY DEF,
 * SPEED KEY, INPUT, LINE INPUT and ON BREAK STOP / CONT.
 *
 * INPUT and LINE INPUT are one runtime call (`__LOCO_INPUT`) whose control block is a hidden global
 * built here: flags, the item count, the prompt, one type byte per item and the result slots. The
 * variables are then assigned from the slots through `__LOCO_INGETW` / `__LOCO_INGETF`, so no runtime
 * state lives across quads (docs/ir.md "Events and errors"). The numeric conversions are in
 * `inputreal.asm`, linked only for an INPUT that has a number item.
 */
import type { BuiltinCall, BuiltinStmt, Expr, InputStmt, OnBreakStmt, Stmt } from '../../ast/ast.js';
import { children } from '../../ast/walk.js';
import { InternalError } from '../../core/diagnostics.js';
import type { Span } from '../../core/source.js';
import type { ArraySymbol } from '../../sem/model.js';
import { irType, type IrType, type TypeName } from '../../sem/types.js';
import type { Operand } from '../ir.js';
import { arrayOf, storeElement } from './array.js';
import type { LowerCtx, Val } from './context.js';
import { castTo, lowerExpr } from './expr.js';
import { selectStream } from './print.js';

const LOCO = '.core.__LOCO_';

/** The folded numeric value of an expression, or null. */
function constNumber(ctx: LowerCtx, e: Expr): number | null {
  const c = ctx.checked.constants.get(e);
  return c !== undefined && typeof c.value === 'number' ? c.value : null;
}

function operandOf(ctx: LowerCtx, e: Expr, type: IrType): Val | null {
  const v = lowerExpr(ctx, e);
  return v === null ? null : castTo(ctx, v, type, e.span);
}

// ---------------------------------------------------------------------------
// INKEY(n), JOY(n)
// ---------------------------------------------------------------------------

/** INKEY(n) and JOY(n); null for any other keyword. INKEY is an INTEGER (-1, 0, 32, 128, 160), JOY a UBYTE. */
export function lowerKeyFunction(ctx: LowerCtx, e: BuiltinCall): Val | null | undefined {
  if (e.keyword !== 'INKEY' && e.keyword !== 'JOY') return undefined;
  const a = e.args[0];
  if (a === undefined) throw new InternalError(`lowering: ${e.keyword} without an argument`);
  const n = operandOf(ctx, a, 'i16');
  if (n === null) return null;
  ctx.b.fparam('i16', n.o, e.span);
  if (e.keyword === 'INKEY') return { o: ctx.b.rtcall(`${LOCO}INKEYN`, 'i16', e.span) as Operand, t: 'i16' };
  const o = ctx.b.rtcall(`${LOCO}JOY`, 'u16', e.span) as Operand;
  return castTo(ctx, { o, t: 'u16' }, 'u8', e.span);
}

// ---------------------------------------------------------------------------
// CLEAR INPUT, KEY, KEY DEF, SPEED KEY
// ---------------------------------------------------------------------------

/** The keyboard built-in statements; false for any other keyword. */
export function lowerKeyStatement(ctx: LowerCtx, s: BuiltinStmt): boolean {
  const b = ctx.b;
  switch (s.keyword) {
    case 'CLEAR INPUT':
      b.rtcall(`${LOCO}CLEARIN`, null, s.span);
      return true;
    case 'KEY': {
      // KEY n, text$: n is pushed, the string goes in HL with its free flag in A
      const [nE, tE] = [s.args[0], s.args[1]];
      if (nE === null || nE === undefined || tE === null || tE === undefined) throw new InternalError('lowering: KEY without its arguments');
      const n = operandOf(ctx, nE, 'i16');
      if (n === null) return true;
      b.param('i16', n.o, nE.span);
      const t = lowerExpr(ctx, tE);
      if (t === null) return true;
      b.fparam('str', t.o, tE.span);
      b.rtcall(`${LOCO}KEY`, null, s.span);
      return true;
    }
    case 'KEY DEF': {
      // the values are pushed in source order, the count goes in HL (the runtime pops them last first)
      const given = s.args.filter((a): a is Expr => a !== null);
      for (const a of given) {
        const v = operandOf(ctx, a, 'i16');
        if (v === null) return true;
        b.param('i16', v.o, a.span);
      }
      b.fparam('i16', { k: 'imm', value: given.length }, s.span);
      b.rtcall(`${LOCO}KEYDEF`, null, s.span);
      return true;
    }
    case 'SPEED KEY': {
      const [aE, bE] = [s.args[0], s.args[1]];
      if (aE === null || aE === undefined || bE === null || bE === undefined) throw new InternalError('lowering: SPEED KEY without its arguments');
      const first = operandOf(ctx, aE, 'i16');
      if (first === null) return true;
      b.param('i16', first.o, aE.span);
      const second = operandOf(ctx, bE, 'i16');
      if (second === null) return true;
      b.fparam('i16', second.o, bE.span);
      b.rtcall(`${LOCO}SPEEDKEY`, null, s.span);
      return true;
    }
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// ON BREAK
// ---------------------------------------------------------------------------

const breakStop = new WeakMap<object, boolean>();

/** Whether the program has an `ON BREAK STOP` anywhere, procedures included (it sets `IrProgram.checkBreak`). */
export function programHasBreakStop(ctx: LowerCtx): boolean {
  const known = breakStop.get(ctx.checked);
  if (known !== undefined) return known;
  const visit = (node: Parameters<typeof children>[0]): boolean => {
    if (node.kind === 'OnBreak' && (node as OnBreakStmt).action === 'STOP') return true;
    return children(node).some(visit);
  };
  const found = visit(ctx.checked.bound.program);
  breakStop.set(ctx.checked, found);
  return found;
}

/**
 * ON BREAK STOP sets the runtime flag the check at every statement start reads, ON BREAK CONT clears it
 * (both can appear in one program, as in Locomotive). A program with no STOP has nothing to ignore: CONT
 * emits no code there (the default, and all a bare build has).
 */
export function lowerOnBreak(ctx: LowerCtx, s: OnBreakStmt): void {
  if (!programHasBreakStop(ctx)) return;
  ctx.b.fparam('u8', { k: 'imm', value: s.action === 'STOP' ? 1 : 0 }, s.span);
  ctx.b.rtcall(`${LOCO}ONBREAK`, null, s.span);
}

// ---------------------------------------------------------------------------
// INPUT and LINE INPUT
// ---------------------------------------------------------------------------

interface Target {
  /** The variable's operand, or the array element. */
  readonly dst: Operand | null;
  readonly element: ArraySymbol | null;
  readonly args: readonly Expr[];
  readonly type: TypeName;
  readonly span: Span;
}

/** The runtime item type: S (a string), I (an INTEGER, a BYTE or a UBYTE) or F (any other number, read as a REAL). */
function itemKind(type: TypeName): 'S' | 'I' | 'F' {
  if (type === 'STRING') return 'S';
  if (type === 'INTEGER' || type === 'BYTE' || type === 'UBYTE') return 'I';
  return 'F';
}

const SLOT_SIZE = { S: 2, I: 2, F: 5 } as const;

function inputTargets(ctx: LowerCtx, s: InputStmt): Target[] | null {
  const out: Target[] = [];
  for (const target of s.targets) {
    if (target.kind === 'Name') {
      const id = ctx.checked.bound.resolutions.names.get(target);
      const sym = id === undefined ? undefined : ctx.sym(id);
      if (sym?.kind !== 'variable') throw new InternalError('lowering: INPUT into something that is not a variable');
      const dst = ctx.varOperand(sym, target.span);
      if (dst === null) return null;
      out.push({ dst, element: null, args: [], type: sym.type, span: target.span });
    } else {
      const arr = arrayOf(ctx, target);
      if (arr === null) throw new InternalError('lowering: INPUT into a call');
      out.push({ dst: null, element: arr, args: target.args, type: arr.element, span: target.span });
    }
  }
  return out;
}

/**
 * INPUT / LINE INPUT. On the keyboard, on a text stream #1-#7 (selected before the editor runs and
 * released after it, docs/ir.md "Streams") or, with the constant stream #9, from the input file
 * (L4-FILES: one runtime call per item, the numbers converted with VAL; the prompt is not shown).
 */
export function lowerInput(ctx: LowerCtx, s: InputStmt): void {
  const b = ctx.b;
  if (s.stream !== null && constNumber(ctx, s.stream) === 9) {
    lowerFileInput(ctx, s);
    return;
  }
  const selected = selectStream(ctx, s.stream, s.span);
  if (selected === null) return;
  lowerKeyboardInput(ctx, s);
  if (selected) b.rtcall(`${LOCO}STREAM0`, null, s.span);
}

/** INPUT #9 and LINE INPUT #9: the item or the line comes from `file.asm` as a string, the variable is set at once. */
function lowerFileInput(ctx: LowerCtx, s: InputStmt): void {
  const b = ctx.b;
  const targets = inputTargets(ctx, s);
  if (targets === null) return;
  ctx.require('loco/file.asm');
  for (const t of targets) {
    const kind = itemKind(t.type);
    const to = irType(t.type);
    const fetch = (): Val => {
      if (s.line) return { o: b.rtcall(`${LOCO}FLINE`, 'str', t.span) as Operand, t: 'str' };
      b.fparam('u8', { k: 'imm', value: kind === 'S' ? 0 : 1 }, t.span);
      const text = b.rtcall(`${LOCO}FINITEM`, 'str', t.span) as Operand;
      if (kind === 'S') return { o: text, t: 'str' };
      return castTo(ctx, { o: b.cast('f', 'str', text, t.span), t: 'f' }, to, t.span);
    };
    if (t.dst !== null) b.store(to, t.dst, fetch().o, t.span);
    else if (t.element !== null) storeElement(ctx, t.element, t.args, t.span, fetch);
  }
}

function lowerKeyboardInput(ctx: LowerCtx, s: InputStmt): void {
  const b = ctx.b;
  const targets = inputTargets(ctx, s);
  if (targets === null) return;
  const kinds = targets.map((t) => itemKind(t.type));
  const prompt = s.prompt === null ? [] : [...s.prompt.value].map((c) => c.charCodeAt(0) & 0xff);
  const typesAt = 3 + prompt.length;
  let size = typesAt + kinds.length;
  const slots: number[] = [];
  for (const k of kinds) {
    slots.push(size);
    size += SLOT_SIZE[k];
  }
  const bytes = new Uint8Array(size);
  bytes[0] = (s.promptSep === ',' ? 0 : 1) | (s.keepCursor ? 2 : 0) | (s.line ? 4 : 0);
  bytes[1] = kinds.length;
  bytes[2] = prompt.length;
  bytes.set(prompt, 3);
  kinds.forEach((k, i) => {
    bytes[typesAt + i] = k.charCodeAt(0);
  });
  const label = ctx.hiddenBytes(bytes);
  const numeric = kinds.some((k) => k !== 'S');
  if (numeric) {
    ctx.require('loco/inputreal.asm');
    b.param('u16', { k: 'addr', label: '.core.__LOCO_INREAL' }, s.span);
  } else {
    b.param('u16', { k: 'imm', value: 0 }, s.span);
  }
  b.fparam('u16', { k: 'addr', label }, s.span);
  b.rtcall(`${LOCO}INPUT`, null, s.span);
  targets.forEach((t, i) => {
    const kind = kinds[i] as 'S' | 'I' | 'F';
    const to = irType(t.type);
    const slot: Operand = { k: 'addr', label, offset: slots[i] as number };
    const fetch = (): Val => {
      b.fparam('u16', slot, t.span);
      if (kind === 'F') return castTo(ctx, { o: b.rtcall(`${LOCO}INGETF`, 'f', t.span) as Operand, t: 'f' }, to, t.span);
      const from: IrType = kind === 'S' ? 'str' : 'i16';
      return castTo(ctx, { o: b.rtcall(`${LOCO}INGETW`, from, t.span) as Operand, t: from }, to, t.span);
    };
    if (t.dst !== null) b.store(to, t.dst, fetch().o, t.span);
    else if (t.element !== null) storeElement(ctx, t.element, t.args, t.span, fetch);
  });
}

/** Statement kinds this file lowers (for stmt.ts's dispatch). */
export function isKeyStmt(s: Stmt): s is InputStmt | OnBreakStmt {
  return s.kind === 'Input' || s.kind === 'OnBreak';
}
