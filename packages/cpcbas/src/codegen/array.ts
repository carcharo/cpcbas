/**
 * Array templates (L3-ARR-CG): `aaddr`, `aload` and `astore` (docs/ir.md, "Arrays"), plus the
 * memory-operand reading of an `addr` operand that `load` and `store` use for the constant-index
 * element of a global array. `aload:str` and `astore:str` live with the other string templates (str.ts); the
 * table here covers `aaddr` for every type and `aload`/`astore` for the others.
 *
 * `aaddr`: the `dims` index temps (u16) are on the stack with the first index pushed first, so
 * the last index is on top. The runtime's `__ARRAY` (CALLEE, lib/runtime/array/array.asm) wants
 * the first index on top (it computes `((i * c2 + j) * c3 + k) ...`), so the template reverses the
 * indexes when there is more than one, then loads HL = the descriptor, calls `__ARRAY` and pushes
 * the element address. The descriptor is an `addr` (a global array's label), a `frameaddr` (a
 * local array's descriptor in the frame) or a `frame` slot holding the descriptor's address (an
 * array parameter). Bounds are not checked (spec §8).
 *
 * `aload` pops the element address and pushes the element (A, HL, DEHL, A E D C B as the other
 * `load` templates); `astore` stores a value (`b`, any operand the type's `load` accepts) at the
 * address `a`, which is the temp below `b` on the stack. Neither calls the runtime.
 */

import { InternalError } from '../core/diagnostics.js';
import { asFileId, type Span } from '../core/source.js';
import type { IrType, Operand, Quad } from '../ir/ir.js';
import { frameInRange, ixd, loadReg, memSize, pushResult } from './flow.js';
import type { EmitContext, RegisterFormTable, Template, TemplateTable, TempForm } from './types.js';

type Q<K extends Quad['op']> = Extract<Quad, { op: K }>;

const NO_SPAN: Span = { file: asFileId(0), start: 0, end: 0 };
const span = (q: Quad): Span => q.span ?? NO_SPAN;
const lines = (...ss: string[]): string[] => ss.map((s) => `\t${s}`);

/**
 * An `addr` operand read as memory. In `load` and `store`, `addr` is an immediate address
 * (`@x`, typed u16) for a source, so only a u16 *source* keeps that meaning; for every other
 * type, and for any destination, it names the variable at `label + offset` (the element of a
 * global array with constant indexes, docs/ir.md "Arrays"), which is rewritten to the `global`
 * operand every template already reads and writes. Anything else passes through unchanged.
 * A UINTEGER element with a constant index therefore cannot be a `load`: the lowering reads it
 * with `peek` (and writes it with `poke` or `store`).
 */
export function memoryOperand(type: IrType, o: Operand, isDestination: boolean): Operand {
  if (o.k !== 'addr') return o;
  if (type === 'u16' && !isDestination) return o;
  const offset = o.offset ?? 0;
  return { k: 'global', label: offset === 0 ? o.label : `${o.label}+${offset}` };
}

// ---------------------------------------------------------------------------
// aaddr
// ---------------------------------------------------------------------------

/** Reverses the `dims` words on the stack (first index deepest becomes first index on top). */
function reverseIndexes(dims: number): string[] {
  switch (dims) {
    case 1:
      return [];
    case 2:
      return lines('pop hl', 'pop de', 'push hl', 'push de');
    case 3:
      return lines('pop hl', 'pop de', 'pop bc', 'push hl', 'push de', 'push bc');
    case 4:
      return lines('pop hl', 'pop de', 'pop bc', 'exx', 'pop hl', 'exx', 'push hl', 'push de', 'push bc', 'exx', 'push hl', 'exx');
    default:
      throw new InternalError(`aaddr: ${dims} dimensions (1 to 4)`);
  }
}

/** HL = the address of the descriptor. */
function descriptor(a: Operand, q: Quad, ctx: EmitContext): string[] {
  switch (a.k) {
    case 'addr':
      return lines(`ld hl, ${a.offset === undefined || a.offset === 0 ? a.label : `${a.label}+${a.offset}`}`);
    case 'frameaddr':
      return lines('push ix', 'pop hl', `ld de, ${a.offset & 0xffff}`, 'add hl, de');
    case 'frame': {
      if (!frameInRange(a.offset, 2, q, ctx)) return [];
      return lines(`ld l, ${ixd(a.offset)}`, `ld h, ${ixd(a.offset + 1)}`);
    }
    default:
      throw new InternalError(`aaddr: the array operand is ${a.k}, not an addr, frameaddr or frame slot`);
  }
}

const aaddr: Template = (q, ctx, form) => {
  const { array, dims } = q as Q<'aaddr'>;
  return [...reverseIndexes(dims), ...descriptor(array, q, ctx), ctx.requires.call('.core.__ARRAY'), ...(form?.resultInRegs === true ? [] : lines('push hl'))];
};

// ---------------------------------------------------------------------------
// aload, astore
// ---------------------------------------------------------------------------

/** The element address of a quad is a temp (the `aaddr` result), popped into HL. */
function addressTemp(a: Operand, q: Quad, ctx: EmitContext, form: TempForm | undefined): string[] {
  if (a.k !== 'temp') {
    ctx.diagnostics.report('E002', span(q), `\`${q.op}\` needs the element address from \`aaddr\` (a temp), not ${a.k}`);
    return [];
  }
  return form?.inRegs === 'a' ? [] : lines('pop hl');
}

const aloadT =
  (type: IrType): Template =>
  (q, ctx, form) => {
    const { a } = q as Q<'aload'>;
    const addr = addressTemp(a, q, ctx, form);
    const inRegs = form?.resultInRegs === true;
    switch (memSize(type)) {
      case 1:
        return [...addr, ...lines('ld a, (hl)'), ...(inRegs ? [] : pushResult(type))];
      case 2:
        return [...addr, ...lines('ld e, (hl)', 'inc hl', 'ld d, (hl)', inRegs ? 'ex de, hl' : 'push de')];
      case 4:
        // in the registers: DEHL, as every 32-bit result; pushed: the high word first, so the low word is on top
        return inRegs
          ? [...addr, ...lines('ld c, (hl)', 'inc hl', 'ld b, (hl)', 'inc hl', 'ld e, (hl)', 'inc hl', 'ld d, (hl)', 'ld l, c', 'ld h, b')]
          : [...addr, ...lines('ld e, (hl)', 'inc hl', 'ld d, (hl)', 'inc hl', 'ld c, (hl)', 'inc hl', 'ld b, (hl)', 'push bc', 'push de')];
      case 5:
        return [...addr, ...lines('ld a, (hl)', 'inc hl', 'ld e, (hl)', 'inc hl', 'ld d, (hl)', 'inc hl', 'ld c, (hl)', 'inc hl', 'ld b, (hl)'), ...(inRegs ? [] : pushResult('f'))];
    }
  };

/** The stores of a value in A / HL / DEHL through BC (sizes 1, 2, 4), or A E D C B through HL (size 5), after the address is popped. */
function storeTail(size: 1 | 2 | 4 | 5): string[] {
  switch (size) {
    case 1:
      return lines('ld (bc), a');
    case 2:
      return lines('ld a, l', 'ld (bc), a', 'inc bc', 'ld a, h', 'ld (bc), a');
    case 4:
      return lines('ld a, l', 'ld (bc), a', 'inc bc', 'ld a, h', 'ld (bc), a', 'inc bc', 'ld a, e', 'ld (bc), a', 'inc bc', 'ld a, d', 'ld (bc), a');
    case 5:
      return lines('ld (hl), a', 'inc hl', 'ld (hl), e', 'inc hl', 'ld (hl), d', 'inc hl', 'ld (hl), c', 'inc hl', 'ld (hl), b');
  }
}

const astoreT =
  (type: IrType): Template =>
  (q, ctx, form) => {
    const { a, b } = q as Q<'astore'>;
    if (a.k !== 'temp') {
      ctx.diagnostics.report('E002', span(q), `\`astore\` needs the element address from \`aaddr\` (a temp), not ${a.k}`);
      return [];
    }
    const size = memSize(type) as 1 | 2 | 4 | 5;
    if (form?.inRegs === 'a') {
      // The address is in HL and the value (not a temp) is loaded without touching it: an 8-bit store goes through HL, 16 and 32 bit move the
      // address to BC first, a REAL keeps HL (its load never uses it); a BYREF value's load clobbers HL, so the address goes through the stack.
      const value = loadReg(type, b, q, ctx);
      if (b.k === 'frame' && b.byref === true) return [...lines('push hl'), ...value, ...lines(size === 5 ? 'pop hl' : 'pop bc'), ...storeTail(size)];
      if (size === 1) return b.k === 'imm' ? lines(`ld (hl), ${Math.trunc(b.value) & 0xff}`) : [...value, ...lines('ld (hl), a')];
      if (size === 5) return [...value, ...storeTail(5)];
      return [...lines('ld b, h', 'ld c, l'), ...value, ...storeTail(size)];
    }
    // The value is on top of the address temp: load it first (popping it when it is a temp), then pop the address.
    const value = form?.inRegs === 'b' ? [] : loadReg(type, b, q, ctx);
    return [...value, ...lines(size === 5 ? 'pop hl' : 'pop bc'), ...storeTail(size)];
  };

const ELEMENT_TYPES: readonly IrType[] = ['u8', 'i8', 'u16', 'i16', 'u32', 'i32', 'f16', 'f'];

/** Register forms (L5-TEMPS): the element address stays in HL between `aaddr` and `aload`/`astore`, a loaded element in its registers. */
export const ARRAY_REGISTER_FORMS: RegisterFormTable = Object.fromEntries([
  ['aaddr:str', { result: true, operands: [] }],
  ...ELEMENT_TYPES.flatMap((t) => [
    [`aaddr:${t}`, { result: true, operands: [] }],
    [`aload:${t}`, { result: true, operands: ['a'] }],
    [`astore:${t}`, { result: false, operands: ['a', 'b'] }],
  ]),
]);

/** `aaddr` for every type (the element type only sets the element size, which the descriptor holds), and `aload`/`astore` for the types but `str`. */
function build(): TemplateTable {
  const table: Record<string, Template> = {};
  const types: readonly IrType[] = ['u8', 'i8', 'u16', 'i16', 'u32', 'i32', 'f16', 'f', 'str'];
  for (const t of types) table[`aaddr:${t}`] = aaddr;
  for (const t of types) {
    if (t === 'str') continue;
    table[`aload:${t}`] = aloadT(t);
    table[`astore:${t}`] = astoreT(t);
  }
  return table;
}

export const ARRAY_TEMPLATES: TemplateTable = build();
