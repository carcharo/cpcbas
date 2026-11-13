/**
 * Control, procedure and operand-loading templates (task L2-CG-FLOW): `label jump jtable
 * gosub retsub end call rtcall enter ret leave stmt` (and `asm`, which the generate() driver
 * handles itself before the table lookup).
 *
 * Ported from the reference backend (`z80/backend/generic.py`: `_label _jump _call _enter
 * _leave _ret`; `cpc/backend/generic.py`: `_end`) with these differences:
 * - `jtable` is 1-based and falls through when out of range, over the reused
 *   `.core.__ON_GOTO` / `.core.__ON_GOSUB` (lib/runtime/ongoto.asm, which wants a 0-based
 *   index in A and a table `DEFB n` + `DEFW` labels); the table is emitted inline, jumped over.
 * - `leave` with more than 11 argument bytes is expanded inline (no shared `__EXIT_FUNCTION`
 *   label, so a template needs no program-wide state).
 * - A FASTCALL procedure with locals (or with parameters beyond the first) gets an IX frame
 *   built without touching any register, so the first argument survives in the result
 *   registers; one without locals and with at most one parameter has no frame at all.
 * - The first `end` emits the whole END block, later ones load the exit code and jump to it.
 *
 * Frame layout (STDCALL): `(ix+0)` saved IX, `(ix+2)` return address, arguments from
 * `(ix+4)` upwards (the first argument nearest; a u8 argument's value is the high byte of
 * its pushed word), locals from `(ix-1)` downwards, zeroed by `enter`.
 *
 * The operand loaders are exported for the other template tables and the tests.
 */

import { InternalError } from '../core/diagnostics.js';
import { asFileId, type Span } from '../core/source.js';
import type { IrType, Operand, Quad } from '../ir/ir.js';
import { encodeReal5 } from './data.js';
import type { EmitContext, RegisterFormTable, Template, TemplateTable } from './types.js';

type Q<K extends Quad['op']> = Extract<Quad, { op: K }>;

const NO_SPAN: Span = { file: asFileId(0), start: 0, end: 0 };

/** Bytes a value of `type` occupies in memory. */
export function memSize(type: IrType): 1 | 2 | 4 | 5 {
  switch (type) {
    case 'u8':
    case 'i8':
      return 1;
    case 'u16':
    case 'i16':
    case 'str':
      return 2;
    case 'u32':
    case 'i32':
    case 'f16':
      return 4;
    case 'f':
      return 5;
  }
}

/**
 * The one frame range check (docs/ir.md "Frame size"): IX addressing is a signed byte, so every byte of a
 * frame slot at `offset` (`size` bytes) must lie in -128..127. Reports E002 "frames are limited to 128 bytes"
 * at the quad and returns false when it does not; the templates of every table call this.
 */
export function frameInRange(offset: number, size: number, q: Quad, ctx: EmitContext): boolean {
  if (offset >= -128 && offset + size - 1 <= 127) return true;
  ctx.diagnostics.report('E002', q.span ?? NO_SPAN, `a frame offset of ${offset} does not fit IX addressing (frames are limited to 128 bytes)`);
  return false;
}

/** {@link frameInRange} for every `frame` operand of a quad, sized by the operand's role (a BYREF slot holds an address). */
export function checkFrameOperands(q: Quad, ctx: EmitContext): boolean {
  const own = (q as { type?: IrType }).type;
  if (own === undefined) return true;
  const from = (q as { from?: IrType }).from;
  const sizeOf = (key: string): number => {
    if (q.op === 'cast') return memSize(key === 'a' ? (from ?? own) : own);
    if (q.op === 'peek' || q.op === 'poke') return key === 'a' ? 2 : memSize(own);
    if (q.op === 'shl' || q.op === 'shr') return key === 'b' ? 1 : memSize(own);
    if (q.op === 'in' || q.op === 'out') return key === 'a' ? 2 : 1;
    return memSize(own);
  };
  let ok = true;
  for (const key of ['a', 'b', 'dst'] as const) {
    const o = (q as unknown as Record<string, Operand | undefined>)[key];
    if (o === undefined || o.k !== 'frame') continue;
    if (!frameInRange(o.offset, o.byref === true ? 2 : sizeOf(key), q, ctx)) ok = false;
  }
  return ok;
}

/** `(ix+n)` / `(ix-n)`. */
export const ixd = (offset: number): string => `(ix${offset < 0 ? '-' : '+'}${Math.abs(offset)})`;

/** Lines that push the value held in the result registers of `type` (the reference's `_call` / `_cast` tails). */
export function pushResult(type: IrType): string[] {
  switch (memSize(type)) {
    case 1:
      return ['\tpush af'];
    case 2:
      return ['\tpush hl'];
    case 4:
      return ['\tpush de', '\tpush hl'];
    case 5:
      return ['\tpush bc', '\tpush de', '\tpush af'];
  }
}

/** Lines that pop a pushed value of `type` into its result registers (u8: A, 16 bit: HL, 32 bit: DEHL, f: A E D C B = bytes 0..4 of Locomotive's layout, which a push leaves in memory order at sp+1..sp+5). */
export function popResult(type: IrType): string[] {
  switch (memSize(type)) {
    case 1:
      return ['\tpop af'];
    case 2:
      return ['\tpop hl'];
    case 4:
      return ['\tpop hl', '\tpop de'];
    case 5:
      return ['\tpop af', '\tpop de', '\tpop bc'];
  }
}

/** Loads the value at (HL) into the result registers of `type` (HL is overwritten; BC too for 32 bit). */
function derefHl(type: IrType): string[] {
  switch (memSize(type)) {
    case 1:
      return ['\tld a, (hl)'];
    case 2:
      return ['\tld a, (hl)', '\tinc hl', '\tld h, (hl)', '\tld l, a'];
    case 4:
      return [
        '\tld c, (hl)',
        '\tinc hl',
        '\tld b, (hl)',
        '\tinc hl',
        '\tld e, (hl)',
        '\tinc hl',
        '\tld d, (hl)',
        '\tld l, c',
        '\tld h, b',
      ];
    case 5:
      return ['\tld a, (hl)', '\tinc hl', '\tld e, (hl)', '\tinc hl', '\tld d, (hl)', '\tinc hl', '\tld c, (hl)', '\tinc hl', '\tld b, (hl)'];
  }
}

function span(q: Quad): Span {
  return q.span ?? NO_SPAN;
}

/**
 * Loads operand `a` of `type` into the result registers (temps are popped). `q` is the
 * quad being generated, for diagnostics. An operand that cannot be a value of that type
 * (an `addr` as a REAL) is E002.
 */
export function loadReg(type: IrType, a: Operand, q: Quad, ctx: EmitContext): string[] {
  const size = memSize(type);
  switch (a.k) {
    case 'temp':
      return popResult(type);
    case 'imm': {
      if (size === 5) {
        // Locomotive's layout, bytes 0..4 in A E D C B (docs/ir.md)
        const [b0, b1, b2, b3, b4] = encodeReal5(a.value) as [number, number, number, number, number];
        return [`\tld a, ${b0}`, `\tld de, ${(b2 << 8) | b1}`, `\tld bc, ${(b4 << 8) | b3}`];
      }
      const v = type === 'f16' ? Math.round(a.value * 65536) : Math.trunc(a.value);
      if (size === 1) return [`\tld a, ${v & 0xff}`];
      if (size === 2) return [`\tld hl, ${v & 0xffff}`];
      return [`\tld hl, ${v & 0xffff}`, `\tld de, ${Math.floor(v / 65536) & 0xffff}`];
    }
    case 'global': {
      const L = a.label;
      switch (size) {
        case 1:
          return [`\tld a, (${L})`];
        case 2:
          return [`\tld hl, (${L})`];
        case 4:
          return [`\tld hl, (${L})`, `\tld de, (${L}+2)`];
        case 5:
          return [`\tld a, (${L})`, `\tld de, (${L}+1)`, `\tld bc, (${L}+3)`];
      }
      break;
    }
    case 'frame': {
      const o = a.offset;
      if (!frameInRange(o, a.byref === true ? 2 : size, q, ctx)) return [];
      if (a.byref === true) return [`\tld l, ${ixd(o)}`, `\tld h, ${ixd(o + 1)}`, ...derefHl(type)];
      switch (size) {
        case 1:
          return [`\tld a, ${ixd(o)}`];
        case 2:
          return [`\tld l, ${ixd(o)}`, `\tld h, ${ixd(o + 1)}`];
        case 4:
          return [`\tld l, ${ixd(o)}`, `\tld h, ${ixd(o + 1)}`, `\tld e, ${ixd(o + 2)}`, `\tld d, ${ixd(o + 3)}`];
        case 5:
          return [`\tld a, ${ixd(o)}`, `\tld e, ${ixd(o + 1)}`, `\tld d, ${ixd(o + 2)}`, `\tld c, ${ixd(o + 3)}`, `\tld b, ${ixd(o + 4)}`];
      }
      break;
    }
    case 'addr':
    case 'frameaddr':
    case 'strconst': {
      if (size !== 2) {
        ctx.diagnostics.report('E002', span(q), `an address cannot be loaded as ${type}`);
        return [];
      }
      if (a.k === 'addr') return [`\tld hl, ${a.label}${a.offset === undefined || a.offset === 0 ? '' : a.offset > 0 ? `+${a.offset}` : `${a.offset}`}`];
      if (a.k === 'strconst') return [`\tld hl, .S.${a.id}`];
      return ['\tpush ix', '\tpop hl', `\tld de, ${a.offset}`, '\tadd hl, de'];
    }
  }
  throw new InternalError(`loadReg: unsupported operand ${a.k} for ${type}`);
}

// ---------------------------------------------------------------------------
// Simple control
// ---------------------------------------------------------------------------

const label: Template = (q) => [`${(q as Q<'label'>).label}:`];
const jump: Template = (q) => [`\tjp ${(q as Q<'jump'>).label}`];
const gosub: Template = (q) => [`\tcall ${(q as Q<'gosub'>).label}`];
const retsub: Template = () => ['\tret'];

/** ON n GOTO/GOSUB: see the module comment. */
const jtable: Template = (q, ctx, form) => {
  const t = q as Q<'jtable'>;
  const load = t.a.k === 'temp' && form?.inRegs === 'a' ? [] : loadReg('u16', t.a, q, ctx);
  if (t.labels.length === 0) return load;
  if (t.labels.length > 255) {
    ctx.diagnostics.report('E002', span(q), 'ON ... GOTO/GOSUB with more than 255 targets is not implemented');
    return [];
  }
  const table = ctx.newLabel();
  const done = ctx.newLabel();
  const target = t.gosub ? '.core.__ON_GOSUB' : '.core.__ON_GOTO';
  return [
    ...load,
    '\tdec hl',
    '\tld a, h',
    '\tor a',
    `\tjp nz, ${done}`,
    '\tld a, l',
    `\tld hl, ${table}`,
    '\tpush hl',
    ctx.requires.call(target),
    `\tjp ${done}`,
    `${table}:`,
    `\tDEFB ${t.labels.length}`,
    ...t.labels.map((l) => `\tDEFW ${l}`),
    `${done}:`,
  ];
};

/** Whether an END block was already emitted in the program being generated (one RequireSet per generate() call). */
const endEmitted = new WeakSet<object>();

const end: Template = (q, ctx) => {
  const load = loadReg('u16', (q as Q<'end'>).a, q, ctx);
  const out = [...load, '\tld b, h', '\tld c, l'];
  ctx.requires.file('bootstrap.asm'); // defines __CPC_END (forced anyway)
  if (endEmitted.has(ctx.requires)) return [...out, '\tjp .core.__END_PROGRAM'];
  endEmitted.add(ctx.requires);
  // END and the end of the program close both files, as Locomotive does (follow-up 127); STOP, ON BREAK STOP and an error jump to
  // __CPC_END directly and leave them open. The routines are linked exactly when the program has file statements of that side.
  const close: string[] = [];
  if (ctx.target.asmDefines.has('__LOCO_FILE_IN')) close.push('\tcall .core.__LOCO_CLOSEIN');
  if (ctx.target.asmDefines.has('__LOCO_FILE_OUT')) close.push('\tcall .core.__LOCO_CLOSEOUT');
  if (close.length > 0) close.splice(0, close.length, '\tpush bc', ...close, '\tpop bc');
  return [...out, '.core.__END_PROGRAM:', ...close, '\tjp .core.__CPC_END'];
};

const asm: Template = (q) => (q as Q<'asm'>).lines.map((l) => l.text);

/**
 * A statement boundary (the driver skips `stmt` unless a flag is set). `checkBreak`: the ESC
 * check (lib/loco/keys.asm's `__LOCO_CHKBRK`, L4-KEYS) with break.asm's convention (`push hl` / `ld hl, line` / `call`; it returns with the
 * stack and HL as before the push). The EVERY/AFTER poll is not here: it is an `rtcall` quad that the
 * statement-boundary hooks emit (lower/boundary.ts).
 */
const stmt: Template = (q, ctx) => {
  const s = q as Q<'stmt'>;
  const out: string[] = [];
  if (ctx.checkBreak) out.push('\tpush hl', `\tld hl, ${s.number === null ? 0xffff : s.number & 0xffff}`, ctx.requires.call('.core.__LOCO_CHKBRK'));
  return out;
};

// ---------------------------------------------------------------------------
// Calls and procedures
// ---------------------------------------------------------------------------

const call: Template = (q, _ctx, form) => {
  const c = q as Q<'call'>;
  return [`\tcall ${c.label}`, ...(c.ret === null || form?.resultInRegs === true ? [] : pushResult(c.ret))];
};

const rtcall: Template = (q, ctx, form) => {
  const c = q as Q<'rtcall'>;
  return [ctx.requires.call(c.label), ...(c.ret === null || form?.resultInRegs === true ? [] : pushResult(c.ret))];
};

/** FASTCALL without locals and with at most its one register parameter: no frame at all. */
function frameless(ctx: EmitContext, convention: 'STDCALL' | 'FASTCALL', localBytes: number): boolean {
  if (convention !== 'FASTCALL') return false;
  return localBytes === 0 && (ctx.procedure === null || ctx.procedure.params.length <= 1);
}

const MAX_FASTCALL_LOCALS = 32;

const enter: Template = (q, ctx) => {
  const n = (q as Q<'enter'>).localBytes;
  const fast = ctx.procedure?.convention === 'FASTCALL';
  if (frameless(ctx, fast ? 'FASTCALL' : 'STDCALL', n)) return [];
  const out = ['\tpush ix', '\tld ix, 0', '\tadd ix, sp'];
  if (n === 0) return out;
  if (fast) {
    // No register may change: the first argument is in the result registers.
    if (n > MAX_FASTCALL_LOCALS) {
      ctx.diagnostics.report('E002', span(q), `a FASTCALL procedure with more than ${MAX_FASTCALL_LOCALS} bytes of locals is not implemented`);
      return out;
    }
    for (let i = 0; i < n >> 1; i++) out.push('\tpush hl');
    if (n & 1) out.push('\tdec sp');
    for (let i = 1; i <= n; i++) out.push(`\tld ${ixd(-i)}, 0`);
    out.push(...spillFastcallArg(ctx, n));
    return out;
  }
  if (n < 7) {
    out.push('\tld hl, 0');
    for (let i = 0; i < n >> 1; i++) out.push('\tpush hl');
    if (n & 1) out.push('\tpush hl', '\tinc sp');
    return out;
  }
  out.push(`\tld hl, -${n}`, '\tadd hl, sp', '\tld sp, hl', '\tld (hl), 0', `\tld bc, ${n - 1}`, '\tld d, h', '\tld e, l', '\tinc de', '\tldir');
  return out;
};

/** Result registers of each size, in memory order (u8: A; 16 bit: L H; 32 bit: L H E D; f: A E D C B). */
const REG_BYTES: Readonly<Record<1 | 2 | 4 | 5, readonly string[]>> = { 1: ['a'], 2: ['l', 'h'], 4: ['l', 'h', 'e', 'd'], 5: ['a', 'e', 'd', 'c', 'b'] };

/** A FASTCALL procedure whose first parameter has a local slot (negative offset): store the register argument there (a BYREF one is an address in HL). */
function spillFastcallArg(ctx: EmitContext, localBytes: number): string[] {
  const p = ctx.procedure?.params[0];
  if (p === undefined || p.offset >= 0) return [];
  const size = p.byref ? 2 : memSize(p.type);
  if (p.offset < -localBytes || p.offset + size > 0) {
    throw new InternalError(`enter: FASTCALL argument slot ${p.offset} (${size} bytes) is outside the ${localBytes} bytes of locals`);
  }
  return REG_BYTES[size].map((r, i) => `\tld ${ixd(p.offset + i)}, ${r}`);
}

const leave: Template = (q, ctx) => {
  const l = q as Q<'leave'>;
  const enterQ = ctx.procedure?.body.find((x): x is Q<'enter'> => x.op === 'enter');
  if (frameless(ctx, l.convention, enterQ?.localBytes ?? 0)) return ['\tret'];
  const n = l.argBytes;
  if (n % 2 !== 0) throw new InternalError(`leave: odd argument size ${n} (u8 arguments are pushed as words)`);
  if (n === 0) return ['\tld sp, ix', '\tpop ix', '\tret'];
  if (n <= 11) {
    return ['\tld sp, ix', '\tpop ix', '\texx', '\tpop hl', ...Array<string>((n >> 1) - 1).fill('\tpop bc'), '\tex (sp), hl', '\texx', '\tret'];
  }
  return ['\texx', `\tld hl, ${n}`, '\tld sp, ix', '\tpop ix', '\tpop de', '\tadd hl, sp', '\tld sp, hl', '\tpush de', '\texx', '\tret'];
};

const ret: Template = (q, ctx, form) => {
  const r = q as Q<'ret'>;
  return [...(form?.inRegs === 'a' ? [] : loadReg(r.type, r.a, q, ctx)), `\tjp ${r.label}`];
};

/** Register forms (L5-TEMPS): a call's result stays in the result registers, and `ret` takes its value from them. */
export const FLOW_REGISTER_FORMS: RegisterFormTable = Object.fromEntries([
  ['call', { result: true, operands: [] }],
  ['rtcall', { result: true, operands: [] }],
  ['jtable', { result: false, operands: ['a'] }],
  ...(['u8', 'i8', 'u16', 'i16', 'u32', 'i32', 'f16', 'f'] as const).map((t) => [`ret:${t}`, { result: false, operands: ['a'] }] as const),
]);

export const FLOW_TEMPLATES: TemplateTable = {
  label,
  jump,
  jtable,
  gosub,
  retsub,
  end,
  call,
  rtcall,
  enter,
  ret,
  leave,
  asm,
  stmt,
};
