/**
 * Lowering of DATA, READ and RESTORE (L2-DATA).
 *
 * - The DATA table: the items of `bound.data` in source order (Locomotive order), each a typed
 *   entry for `codegen/data.ts`. An unquoted item that reads as an integer literal is a number
 *   (`i16`, `u16`, `i32` or `u32`, by value); every other item and every quoted item is a
 *   string. An item RESTORE can name carries the label `.D.<index>`.
 * - READ: one `rtcall` into lib/loco/read.asm per target, with the variable's type tag in A;
 *   the result is stored in the variable (a REAL or FIXED variable calls `__LOCO_READF` in
 *   lib/loco/readf.asm, which converts any numeric item). Past the last item the routine raises error 4,
 *   a string into a number error 2.
 * - RESTORE: loads a table address into HL and calls `__LOCO_RESTORE`.
 *
 * With no DATA at all there is no table: READ is error 4 at once and RESTORE does nothing.
 */
import type { ReadStmt, RestoreStmt } from '../../ast/ast.js';
import { DATA_TABLE_LABEL } from '../../codegen/data.js';
import { InternalError } from '../../core/diagnostics.js';
import type { Span } from '../../core/source.js';
import { runtimeLabelFile } from '../../runtime/labels.js';
import { irType, type IrType } from '../../sem/types.js';
import type { ArraySymbol } from '../../sem/model.js';
import type { IrDataItem, Operand } from '../ir.js';
import { arrayOf, storeElement, supported } from './array.js';
import type { LowerCtx, Val } from './context.js';

/** The label at the end of the table (emitted by `codegen/data.ts`), for RESTORE past the last item. */
const TABLE_END_LABEL = '__DATA__END';

/** The type tag `lib/loco/read.asm` takes in A for a variable of this IR type. */
const READ_TAG: Readonly<Partial<Record<IrType, number>>> = { str: 1, i8: 2, u8: 3, i16: 4, u16: 5, i32: 6, u32: 7 };

const dataLabel = (index: number): string => `.D.${index}`;

/** The value of an unquoted item that is an integer literal (`-12`, `&HFF`, `&X101`), or null. */
function parseIntItem(raw: string): number | null {
  let m = /^([+-]?)(\d+)$/.exec(raw);
  if (m !== null) {
    const v = Number(m[2]);
    return m[1] === '-' ? -v : v;
  }
  m = /^&[hH]?([0-9a-fA-F]+)$/.exec(raw);
  if (m !== null && !/^&[xX]/.test(raw)) return wrapHex(parseInt(m[1] as string, 16));
  m = /^&[xX]([01]+)$/.exec(raw);
  if (m !== null) return wrapHex(parseInt(m[1] as string, 2));
  return null;
}

/** A 16-bit hex or binary literal is two's complement (`&FFFF` is -1, as in Locomotive). */
const wrapHex = (v: number): number => (v > 0x7fff && v <= 0xffff ? v - 0x10000 : v);

/** True for an unquoted item that is a REAL literal (a point or an exponent): a REAL item, read only into a REAL variable. */
const isRealItem = (raw: string): boolean => /^[+-]?(\d+\.\d*|\.\d+|\d+(\.\d*)?[eE][+-]?\d+)$/.test(raw);

const textBytes = (raw: string): Uint8Array => {
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i) & 0xff;
  return bytes;
};

/**
 * A numeric item keeps its spelling (for a READ into a string) unless the written text is the
 * canonical decimal of the value. An empty unquoted item is 0 for a numeric variable and "" for a
 * string one (measured); a REAL item always keeps its text, an integer past 32 bits is a REAL item.
 */
function encode(raw: string, quoted: boolean, label: string | null): IrDataItem {
  if (!quoted && raw === '') return { label, type: 'i16', value: 0, spelling: new Uint8Array() };
  const v = quoted ? null : parseIntItem(raw);
  if (v !== null && Number.isFinite(v)) {
    const spelling = String(v) === raw ? {} : { spelling: textBytes(raw) };
    if (v >= -32768 && v <= 32767) return { label, type: 'i16', value: v, ...spelling };
    if (v >= 0 && v <= 0xffff) return { label, type: 'u16', value: v, ...spelling };
    if (v >= -0x80000000 && v < 0x80000000) return { label, type: 'i32', value: v, ...spelling };
    if (v >= 0 && v <= 0xffffffff) return { label, type: 'u32', value: v, ...spelling };
    return { label, type: 'f', value: v, spelling: textBytes(raw) };
  }
  if (!quoted && isRealItem(raw) && Number.isFinite(Number(raw))) return { label, type: 'f', value: Number(raw), spelling: textBytes(raw) };
  return { label, type: 'str', value: textBytes(raw) };
}

/** The DATA table (the items of `bound.data`, encoded as docs/ir.md "DATA"). */
export function lowerDataTable(ctx: LowerCtx): IrDataItem[] {
  const { items, restoreIndex } = ctx.checked.bound.data;
  const named = new Set(restoreIndex.values());
  return items.map((item) => encode(item.value.raw, item.value.quoted, named.has(item.index) ? dataLabel(item.index) : null));
}

function raise(ctx: LowerCtx, code: number, span: Span): void {
  const errFile = runtimeLabelFile('.core.__ERROR');
  if (errFile === undefined) throw new InternalError('lowering: no file for .core.__ERROR');
  ctx.require(errFile);
  ctx.b.asm([`\tld a, ${code}`, '\tjp .core.__ERROR'].map((text) => ({ text, span })), span, true);
}

export function lowerRead(ctx: LowerCtx, s: ReadStmt): void {
  const b = ctx.b;
  for (const target of s.targets) {
    // The variable or array element the item goes into: its IR type, and where to put the value.
    let type: IrType;
    let dst: Operand | null = null;
    let element: ArraySymbol | null = null;
    if (target.kind === 'Name') {
      const id = ctx.checked.bound.resolutions.names.get(target);
      const sym = id === undefined ? undefined : ctx.sym(id);
      if (sym?.kind !== 'variable') throw new InternalError('lowering: READ into something that is not a variable');
      type = irType(sym.type);
      dst = ctx.varOperand(sym, target.span);
      if (dst === null) continue;
    } else {
      element = arrayOf(ctx, target);
      if (element === null) throw new InternalError('lowering: READ into a call');
      if (!supported(ctx, element, target.span)) continue;
      type = irType(element.element);
    }
    if (ctx.checked.bound.data.items.length === 0) {
      raise(ctx, 4, s.span); // no DATA at all: the first READ is DATA exhausted
      return;
    }
    const tag = READ_TAG[type];
    const anyReal = tag !== undefined && tag !== 1 &&
      ctx.checked.bound.data.items.some((it) => encode(it.value.raw, it.value.quoted, null).type === 'f');
    // The item as a value of `type` (the element's address, if any, is already on the stack).
    const read = (): Val => {
      if (tag === undefined) {
        // REAL and FIXED: __LOCO_READF converts any numeric item to a REAL (a FIXED variable then casts)
        const r = b.rtcall('.core.__LOCO_READF', 'f', s.span);
        if (r === null) throw new InternalError('lowering: READ produced no value');
        return { o: type === 'f' ? r : b.cast(type, 'f', r, s.span), t: type };
      }
      if (anyReal) {
        // A REAL item can reach an integer variable (Locomotive rounds it): read through __LOCO_READF, round, convert.
        const r = b.rtcall('.core.__LOCO_READF', 'f', s.span);
        if (r === null) throw new InternalError('lowering: READ produced no value');
        if (tag <= 5) {
          b.fparam('f', r, s.span);
          return { o: b.cast(type, 'i16', b.rtcall('.core.__LOCO_CINT', 'i16', s.span) as Operand, s.span), t: type };
        }
        return { o: b.cast(type, 'f', r, s.span), t: type };
      }
      b.fparam('u8', { k: 'imm', value: tag }, target.span);
      const v = b.rtcall('.core.__LOCO_READ', type, s.span);
      if (v === null) throw new InternalError('lowering: READ produced no value');
      return { o: v, t: type };
    };
    if (dst !== null) b.store(type, dst, read().o, s.span);
    else if (element !== null && target.kind === 'CallOrIndex') storeElement(ctx, element, target.args, s.span, read);
  }
}

export function lowerRestore(ctx: LowerCtx, s: RestoreStmt): void {
  const { items, restoreIndex } = ctx.checked.bound.data;
  if (items.length === 0) return;
  let label = DATA_TABLE_LABEL;
  if (s.target !== null) {
    const index = restoreIndex.get(s.target);
    if (index === undefined) return; // the binder reported the target
    label = index >= items.length ? TABLE_END_LABEL : dataLabel(index);
  }
  ctx.b.fparam('u16', { k: 'addr', label }, s.span);
  ctx.b.rtcall('.core.__LOCO_RESTORE', null, s.span);
}
