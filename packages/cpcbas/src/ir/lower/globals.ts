/**
 * The data area: every global variable of the bound program becomes an `IrGlobal`, in
 * declaration order (`bound.globals`), with its initial value from the checker's folded
 * initialisers. Hidden globals the lowering made (FOR limits, spill slots) follow. A STRING
 * global with an initial value (`DIM a$ = "x"`) starts empty in the data area and gets its
 * text from a `store` at the start of the main program ({@link lowerStringInits}), in
 * declaration order, before the first statement runs.
 */
import { encodeReal5 } from '../../codegen/data.js';
import type { ArraySymbol, ConstValue, HidataAt } from '../../sem/model.js';
import { irType, sizeOf, type TypeName } from '../../sem/types.js';
import { ARRAY_DESCRIPTOR_BYTES, arrayLabels } from '../arrays.js';
import type { IrGlobal, Operand } from '../ir.js';
import { layoutOf } from './array.js';
import type { LowerCtx } from './context.js';

/** The little-endian bytes of a folded value in the runtime's format for `type`. */
export function initBytes(c: ConstValue, type: TypeName): Uint8Array | null {
  if (typeof c.value !== 'number') return null;
  if (type === 'REAL') return Uint8Array.from(encodeReal5(c.value));
  const size = sizeOf(type);
  let v = BigInt(Math.trunc(type === 'FIXED' ? Math.round(c.value * 65536) : c.value));
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/**
 * A global array's `IrGlobal` (docs/ir.md "Arrays"): the descriptor plus the elements (the
 * descriptor alone with `AT` or `#pragma hidata`), the element counts, and the initial bytes of a
 * numeric `=> {...}` list padded with zeros to the whole array. A STRING array starts empty; its
 * list is stored at the start of the main program ({@link lowerStringInits}).
 */
function arrayGlobal(ctx: LowerCtx, s: ArraySymbol, cursor: HidataCursor): IrGlobal | null {
  if (s.storage !== 'global' || s.label === null || ctx.checked.arrayBounds.get(s.id) === undefined) return null;
  const layout = layoutOf(ctx, s);
  const at = ctx.checked.atAddresses.get(s.id) ?? null;
  const values = ctx.checked.initialValues.get(s.id);
  let init: Uint8Array | null = null;
  if (s.element !== 'STRING' && values !== undefined && values.length > 0) {
    init = new Uint8Array(layout.dataBytes);
    values.forEach((v, i) => {
      const bytes = initBytes(v, s.element);
      if (bytes !== null && i < layout.elements) init?.set(bytes, i * layout.elementSize);
    });
  }
  const pragma = s.decl === null || init === null || at !== null ? undefined : ctx.checked.bound.hidataAt.get(s.decl);
  const hidata = pragma === undefined ? undefined : cursor.place(ctx, pragma, layout.dataBytes, s);
  const external = at !== null || hidata !== undefined;
  return {
    label: s.label,
    type: irType(s.element),
    size: ARRAY_DESCRIPTOR_BYTES + (external ? 0 : layout.dataBytes),
    init,
    at,
    dims: layout.counts,
    ...(hidata === undefined ? {} : { hidata }),
  };
}

/**
 * The fork's HIDATA cursor: the initialised arrays of one `#pragma hidata` run go one after another
 * from the pragma's address (declaration order); each new setting of the pragma starts again at its
 * address. An array that would end past &FFFF is E249.
 */
class HidataCursor {
  private run = -1;
  private next = 0;
  place(ctx: LowerCtx, at: HidataAt, bytes: number, s: ArraySymbol): number | undefined {
    if (at.run !== this.run) {
      this.run = at.run;
      this.next = at.address;
    }
    const addr = this.next;
    if (addr + bytes > 0x10000) {
      ctx.diagnostics.report('E249', s.span, `#pragma hidata: '${s.name}' (${bytes} bytes at &${addr.toString(16).toUpperCase()}) does not fit below &10000`);
      return undefined;
    }
    this.next = addr + bytes;
    return addr;
  }
}

export function lowerGlobals(ctx: LowerCtx): IrGlobal[] {
  const out: IrGlobal[] = [];
  const cursor = new HidataCursor();
  for (const id of ctx.checked.bound.globals) {
    const s = ctx.sym(id);
    if (s.kind === 'array') {
      const g = arrayGlobal(ctx, s, cursor);
      if (g !== null) out.push(g);
      continue;
    }
    if (s.kind !== 'variable' || s.label === null) continue;
    const initial = ctx.checked.initialValues.get(id)?.[0];
    let init: Uint8Array | null = null;
    if (initial !== undefined && typeof initial.value === 'number') init = initBytes(initial, s.type);
    out.push({ label: s.label, type: irType(s.type), size: sizeOf(s.type), init, at: ctx.checked.atAddresses.get(id) ?? null, dims: [] });
  }
  return out;
}

/** The start-up stores of STRING globals with an initial value, into the main body being built. */
export function lowerStringInits(ctx: LowerCtx): void {
  for (const id of ctx.checked.bound.globals) {
    const s = ctx.sym(id);
    if (s.kind === 'array') {
      stringArrayInits(ctx, s);
      continue;
    }
    if (s.kind !== 'variable' || s.label === null) continue;
    const initial = ctx.checked.initialValues.get(id)?.[0];
    if (initial === undefined || typeof initial.value !== 'string') continue;
    if (initial.value === '') continue; // the slot starts as the empty string
    ctx.b.store('str', { k: 'global', label: s.label }, { k: 'strconst', id: ctx.stringId(initial.value) }, s.span);
  }
}

/** The start-up stores of a STRING array's `=> {...}` list: element i from the list's i-th text ("" leaves the element empty). */
function stringArrayInits(ctx: LowerCtx, s: ArraySymbol): void {
  if (s.element !== 'STRING' || s.storage !== 'global' || s.label === null || ctx.checked.arrayBounds.get(s.id) === undefined) return;
  const values = ctx.checked.initialValues.get(s.id);
  if (values === undefined) return;
  const layout = layoutOf(ctx, s);
  const data = arrayLabels(s.label).data;
  values.forEach((v, i) => {
    if (typeof v.value !== 'string' || v.value === '' || i >= layout.elements) return;
    const dst: Operand = i === 0 ? { k: 'addr', label: data } : { k: 'addr', label: data, offset: i * layout.elementSize };
    ctx.b.store('str', dst, { k: 'strconst', id: ctx.stringId(v.value) }, s.span);
  });
}
