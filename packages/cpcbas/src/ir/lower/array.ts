/**
 * Arrays in the lowering (L3-ARR-LOWER; layout and rules: docs/ir.md "Arrays", `ir/arrays.ts`).
 *
 * An element of a global array is reached one of two ways:
 * - every index a constant: an `addr` operand `<label>.__DATA__ + offset` (`elementOffset`), a
 *   memory operand for `load` and `store` of every type but UINTEGER (an `addr` source of `u16`
 *   is the immediate address, so a UINTEGER element is read with `peek`; a store takes the memory
 *   reading for every type);
 * - otherwise the indexes become `u16` temps, the first pushed first, `aaddr` turns them into the
 *   element address and `aload` / `astore` read and write through it.
 *
 * `astore` pops the value before the address, so a store computes the address first.
 * A local array (L3-ARR-PROC) has its descriptor in the frame (`ctx.slots`: a `frame` operand at the
 * descriptor's first byte, reached as a `frameaddr`); an array parameter has a `frame` slot holding
 * the descriptor's address. Neither has a static element: every access goes through `aaddr`.
 * Whole-array assignment and FOR over an element stay refused (spec §8).
 */
import type { CallOrIndex, Expr } from '../../ast/ast.js';
import { convertConst } from '../../checker/fold.js';
import { InternalError } from '../../core/diagnostics.js';
import type { Span } from '../../core/source.js';
import type { ArraySymbol } from '../../sem/model.js';
import { isInteger, irType, type IrType } from '../../sem/types.js';
import { ARRAY_DATA_OFFSET, arrayLabels, arrayLayout, elementOffset, type ArrayLayout } from '../arrays.js';
import type { Operand } from '../ir.js';
import type { LowerCtx, Val } from './context.js';
import { castTo, lowerExpr } from './expr.js';
import { initBytes } from './globals.js';

/** Where an element is: a constant memory address, or a `u16` temp from `aaddr`. */
export type ElementRef = { readonly kind: 'static'; readonly at: Operand } | { readonly kind: 'dynamic'; readonly addr: Operand };

/** The array a `name(args)` expression indexes, or null when it is a call. */
export function arrayOf(ctx: LowerCtx, e: CallOrIndex): ArraySymbol | null {
  const id = ctx.checked.bound.resolutions.callOrIndex.get(e);
  const s = id === undefined ? undefined : ctx.sym(id);
  return s?.kind === 'array' ? s : null;
}

/** The layout of a DIMmed array (its constant bounds are the checker's). */
export function layoutOf(ctx: LowerCtx, a: ArraySymbol): ArrayLayout {
  const bounds = ctx.checked.arrayBounds.get(a.id);
  if (bounds === undefined) throw new InternalError(`lowering: array '${a.name}' has no bounds`);
  return arrayLayout(bounds, irType(a.element));
}

/** Whether the lowering can reach this array (a global, or a local or parameter with a frame slot); E002 at `span` when not. */
export function supported(ctx: LowerCtx, a: ArraySymbol, span: Span): boolean {
  if (a.storage === 'global' && a.label !== null) return true;
  if (a.storage !== 'global' && ctx.slots.has(a.id)) return true;
  ctx.notYet(span, a.storage === 'local' ? 'Local arrays' : 'Array parameters');
  return false;
}

/** The value of a constant index (the checker's conversion to INTEGER applied), or null. */
function constantIndex(ctx: LowerCtx, e: Expr): number | null {
  const c = ctx.checked.constants.get(e);
  if (c === undefined || typeof c.value !== 'number') return null;
  if (isInteger(c.type)) return c.value;
  const v = convertConst(c, 'INTEGER')?.value;
  return typeof v === 'number' ? v : null;
}

/** The element a constant-index global access names: an `addr` operand with the element's offset. */
function staticElement(ctx: LowerCtx, a: ArraySymbol, args: readonly Expr[]): Operand | null {
  if (a.storage !== 'global' || a.label === null) return null;
  const indexes: number[] = [];
  for (const arg of args) {
    const v = constantIndex(ctx, arg);
    if (v === null) return null;
    indexes.push(v);
  }
  const offset = elementOffset(layoutOf(ctx, a), indexes);
  if (offset === null) throw new InternalError(`lowering: constant index outside '${a.name}'`);
  return offset === 0 ? { k: 'addr', label: arrayLabels(a.label).data } : { k: 'addr', label: arrayLabels(a.label).data, offset };
}

/** The descriptor operand `aaddr` takes: an `addr`, a `frameaddr` (local) or the `frame` slot holding the address (parameter). */
function descriptorOf(ctx: LowerCtx, a: ArraySymbol): Operand {
  if (a.storage === 'global') {
    if (a.label === null) throw new InternalError('lowering: a global array without a label');
    return { k: 'addr', label: arrayLabels(a.label).descriptor };
  }
  const slot = ctx.slots.get(a.id);
  if (slot === undefined || slot.k !== 'frame') throw new InternalError(`lowering: array '${a.name}' has no frame slot`);
  return a.storage === 'local' ? { k: 'frameaddr', offset: slot.offset } : slot;
}

/**
 * The address of the array's descriptor as a `u16` operand (what an array argument passes): the label
 * of a global, the `frameaddr` of a local, the address a parameter's slot holds.
 */
export function descriptorAddress(ctx: LowerCtx, a: ArraySymbol, span: Span): Val | null {
  if (!supported(ctx, a, span)) return null;
  const d = descriptorOf(ctx, a);
  return { o: d, t: 'u16' };
}

/** One index as a `u16` temp (`aaddr` pops them: first index pushed first); null after an error. */
function indexTemp(ctx: LowerCtx, e: Expr): Operand | null {
  const v = lowerExpr(ctx, e);
  if (v === null) return null;
  const u = castTo(ctx, v, 'u16', e.span);
  return u.o.k === 'temp' ? u.o : ctx.b.load('u16', u.o, e.span);
}

/**
 * The element `a(args)`: constant memory operand or an `aaddr` temp. The indexes are evaluated in
 * source order. Null after an error (E002 for a local array or parameter, or a failed index).
 */
export function lowerElement(ctx: LowerCtx, a: ArraySymbol, args: readonly Expr[], span: Span): ElementRef | null {
  if (!supported(ctx, a, span)) return null;
  const at = staticElement(ctx, a, args);
  if (at !== null) return { kind: 'static', at };
  for (const arg of args) if (!indexTemp(ctx, arg)) return null;
  return { kind: 'dynamic', addr: ctx.b.aaddr(irType(a.element), descriptorOf(ctx, a), args.length, span) };
}

/** `a(args)` read as a value: an owned copy for a string, a temp for every other type. */
export function lowerElementRead(ctx: LowerCtx, e: CallOrIndex, a: ArraySymbol): Val | null {
  const t = irType(a.element);
  const ref = lowerElement(ctx, a, e.args, e.span);
  if (ref === null) return null;
  if (ref.kind === 'dynamic') return { o: ctx.b.aload(t, ref.addr, e.span), t };
  // UINTEGER: an `addr` source of u16 is an immediate address, so read the memory with peek.
  return { o: t === 'u16' ? ctx.b.peek('u16', ref.at, e.span) : ctx.b.load(t, ref.at, e.span), t };
}

/**
 * Stores into `a(args)` the value `produce` lowers (already of the element type). The element's
 * address comes first (the indexes, then `aaddr`), then the value, because `astore` pops the
 * value `b` before the address `a` (docs/ir.md "Evaluation model"); a constant element needs no
 * address, so `store` takes the `addr` operand directly.
 */
export function storeElement(ctx: LowerCtx, a: ArraySymbol, args: readonly Expr[], span: Span, produce: () => Val | null): void {
  const t: IrType = irType(a.element);
  const ref = lowerElement(ctx, a, args, span);
  if (ref === null) return;
  const v = produce();
  if (v === null) return;
  if (ref.kind === 'static') ctx.b.store(t, ref.at, v.o, span);
  else ctx.b.astore(t, ref.addr, v.o, span);
}

/** `@a(args)`, or `@a` (`args` null): the address of an element, or of the first element. */
export function lowerElementAddress(ctx: LowerCtx, a: ArraySymbol, args: readonly Expr[] | null, span: Span): Val | null {
  if (!supported(ctx, a, span)) return null;
  if (args === null) {
    if (a.storage === 'global') return { o: { k: 'addr', label: arrayLabels(a.label as string).data }, t: 'u16' };
    // the +2 word of the descriptor: in the frame for a local, through the held address for a parameter
    const slot = ctx.slots.get(a.id) as Extract<Operand, { k: 'frame' }>;
    if (a.storage === 'local') return { o: ctx.b.load('u16', { k: 'frame', offset: slot.offset + ARRAY_DATA_OFFSET }, span), t: 'u16' };
    const at = ctx.b.add('u16', ctx.b.load('u16', slot, span), { k: 'imm', value: ARRAY_DATA_OFFSET }, span);
    return { o: ctx.b.peek('u16', at, span), t: 'u16' };
  }
  const ref = lowerElement(ctx, a, args, span);
  if (ref === null) return null;
  return { o: ref.kind === 'static' ? ref.at : ref.addr, t: 'u16' };
}

// ---------------------------------------------------------------------------
// Local arrays and array parameters (L3-ARR-PROC)
// ---------------------------------------------------------------------------

/** A local array of a procedure: its symbol, descriptor offset in the frame and layout. */
export interface LocalArray {
  readonly sym: ArraySymbol;
  readonly offset: number;
  readonly layout: ArrayLayout;
}

/**
 * On entry: allocates and zeroes the elements on the heap and fills the descriptor
 * (`.core.__LOCO_ALOCAL`, lib/loco/array.asm: `param` the descriptor's address, `param` the element
 * bytes, `fparam` the dimension table, which is followed by the UBOUND table in one constant block),
 * then copies a numeric initial list or stores the texts of a string list.
 */
export function allocLocalArray(ctx: LowerCtx, l: LocalArray, span: Span): void {
  const b = ctx.b;
  const tables = new Uint8Array([...l.layout.dimsTable, ...l.layout.uboundTable]);
  const label = ctx.hiddenBytes(tables);
  b.param('u16', { k: 'frameaddr', offset: l.offset }, span);
  b.param('u16', { k: 'imm', value: l.layout.dataBytes }, span);
  b.fparam('u16', { k: 'addr', label }, span);
  b.rtcall('.core.__LOCO_ALOCAL', null, span);

  const values = ctx.checked.initialValues.get(l.sym.id);
  if (values === undefined || values.length === 0) return;
  if (l.sym.element === 'STRING') {
    values.forEach((v, i) => {
      if (typeof v.value !== 'string' || v.value === '' || i >= l.layout.elements) return;
      // the element's indexes, row-major from i
      const idx: number[] = [];
      let rest = i;
      for (let d = l.layout.counts.length - 1; d >= 0; d--) {
        const c = l.layout.counts[d] as number;
        idx.unshift(rest % c);
        rest = Math.floor(rest / c);
      }
      for (const x of idx) b.load('u16', { k: 'imm', value: x }, span);
      const addr = b.aaddr('str', { k: 'frameaddr', offset: l.offset }, idx.length, span);
      b.astore('str', addr, { k: 'strconst', id: ctx.stringId(v.value) }, span);
    });
    return;
  }
  const bytes = new Uint8Array(l.layout.dataBytes);
  values.forEach((v, i) => {
    const e = initBytes(v, l.sym.element);
    if (e !== null && i < l.layout.elements) bytes.set(e, i * l.layout.elementSize);
  });
  if (bytes.every((x) => x === 0)) return;
  const src = ctx.hiddenBytes(bytes);
  // HL = source, DE = the elements (the descriptor's +2 word), BC = bytes
  b.asm(
    [
      `\tld e, (ix${signed(l.offset + ARRAY_DATA_OFFSET)})`,
      `\tld d, (ix${signed(l.offset + ARRAY_DATA_OFFSET + 1)})`,
      `\tld hl, ${src}`,
      `\tld bc, ${l.layout.dataBytes}`,
      '\tldir',
    ].map((text) => ({ text, span })),
    span,
    true,
  );
}

const signed = (n: number): string => (n < 0 ? `${n}` : `+${n}`);

/** On the way out: frees the texts of a string array and then its elements. */
export function freeLocalArray(ctx: LowerCtx, l: LocalArray, span: Span): void {
  const b = ctx.b;
  const elements: Operand = { k: 'frame', offset: l.offset + ARRAY_DATA_OFFSET };
  if (l.sym.element === 'STRING') {
    b.param('u16', { k: 'imm', value: l.layout.elements }, span);
    b.fparam('u16', elements, span);
    b.rtcall('.core.__ARRAYSTR_FREE_MEM', null, span);
  } else {
    b.fparam('u16', elements, span);
    b.rtcall('.core.__MEM_FREE', null, span);
  }
}

/** LBOUND / UBOUND of an array parameter: the runtime reads the descriptor (dimension 1 when none is written). */
export function lowerParamBound(ctx: LowerCtx, which: 'LBOUND' | 'UBOUND', a: ArraySymbol, dim: Expr | undefined, span: Span): Val | null {
  if (!supported(ctx, a, span)) return null;
  const b = ctx.b;
  let d: Val = { o: { k: 'imm', value: 1 }, t: 'u16' };
  if (dim !== undefined) {
    const v = lowerExpr(ctx, dim);
    if (v === null) return null;
    d = castTo(ctx, v, 'u16', dim.span);
  }
  b.param('u16', d.o, span);
  b.fparam('u16', descriptorOf(ctx, a), span);
  return { o: b.rtcall(`.core.__${which}`, 'u16', span) as Operand, t: 'u16' };
}
