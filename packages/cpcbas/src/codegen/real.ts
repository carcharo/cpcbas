/**
 * REAL and FIXED templates (L2-CG-REAL): `f` is the 5-byte float, `f16` the 16.16 fixed point.
 * Keys: `load store param fparam` on both, `add sub mul div neg abs eq ne lt le gt ge jz jnz peek
 * poke` on both, `pow` on `f`, and every `cast:<from>-><to>` with `f` or `f16` on either side
 * except `cast:str->f` (VAL, in str.ts); `cast:f->str` and `cast:f16->str` (STR$) are here too,
 * over the text routine of lib/loco/real.asm.
 *
 * Registers (docs/ir.md): a REAL is Locomotive's 5-byte layout in A E D C B (bytes 0..4: A the
 * least significant mantissa byte, C the top one with the sign, B the exponent) and is pushed as
 * `push bc`, `push de`, `push af`, which leaves the five bytes in memory order. The arithmetic
 * and comparisons are the `__LOCO_F*` entries of lib/loco/fmath.asm (CALLEE like the imported
 * float routines they replace: the second operand `b` is in the registers and the first, `a`,
 * was pushed), so a binary quad whose operands are both temps only pops `b`. When `a` is a
 * variable or a constant it is pushed with HL alone (the exx set for a BYREF slot), after `b` has
 * been popped or before `b` is loaded, so no operand register is lost.
 *
 * FIXED reuses the 32-bit integer templates for everything that is the same as a LONG (load,
 * store, add, sub, the comparisons, neg, abs, jz, peek, poke): a FIXED immediate becomes its
 * 16.16 bit pattern first. mul and div call the imported `__MULF16` and `__DIVF16`.
 *
 * Conversions (spec §4): an integer to REAL/FIXED is exact (a FIXED keeps the low 16 bits of
 * the integer); REAL/FIXED to an integer truncates towards zero and wraps in the target. A REAL division by zero is runtime error 11,
 * like the integer one.
 */

import type { IrType, Operand, Quad } from '../ir/ir.js';
import { asFileId, type Span } from '../core/source.js';
import { encodeReal5 } from './data.js';
import { frameInRange, ixd, loadReg, popResult, pushResult } from './flow.js';
import { memoryOperand } from './array.js';
import { INT_COMPARE_JUMPS, INT_REGISTER_FORMS, INT_TEMPLATES } from './int.js';
import type { CompareJumpTable, CompareJumpTemplate, CompareQuad, EmitContext, RegisterFormTable, Template, TemplateTable, TempForm } from './types.js';

type Q<K extends Quad['op']> = Extract<Quad, { op: K }>;
type UnQ = Extract<Quad, { readonly op: 'neg' | 'not' | 'abs' }>;
type BinQ = Extract<Quad, { readonly b: Operand; readonly dst: Operand }>;

const NO_SPAN: Span = { file: asFileId(0), start: 0, end: 0 };
const span = (q: Quad): Span => q.span ?? NO_SPAN;
const I = (s: string): string => `\t${s}`;
const lines = (...ss: string[]): string[] => ss.map(I);
const ERR = '.core.__ERROR';
const plus = (label: string, n: number): string => (n === 0 ? label : `${label}+${n}`);

type IntType = 'u8' | 'i8' | 'u16' | 'i16' | 'u32' | 'i32';
const INT_TYPES: readonly IntType[] = ['u8', 'i8', 'u16', 'i16', 'u32', 'i32'];
const bits = (t: IntType): 8 | 16 | 32 => (t === 'u8' || t === 'i8' ? 8 : t === 'u16' || t === 'i16' ? 16 : 32);

/** The 5 bytes of a REAL immediate as the register pairs of a push: [A, DE, BC] (bytes 0 | 1, 2 | 3, 4 of the layout). */
function realWords(value: number): [number, number, number] {
  const [b0, b1, b2, b3, b4] = encodeReal5(value) as [number, number, number, number, number];
  return [b0, (b2 << 8) | b1, (b4 << 8) | b3];
}

const frameOk = frameInRange;

// ---------------------------------------------------------------------------
// REAL operands
// ---------------------------------------------------------------------------

/** Pushes a REAL operand (not a temp) as `push bc / push de / push af`, using HL only (the exx set for BYREF). */
function pushOperandF(o: Operand, q: Quad, ctx: EmitContext): string[] {
  switch (o.k) {
    case 'imm': {
      const [a, de, bc] = realWords(o.value);
      return lines(`ld hl, ${bc}`, 'push hl', `ld hl, ${de}`, 'push hl', `ld h, ${a}`, 'push hl');
    }
    case 'global':
      // the exponent byte is the high byte of the last word: read it from one byte below
      return lines(`ld hl, (${plus(o.label, 3)})`, 'push hl', `ld hl, (${plus(o.label, 1)})`, 'push hl', `ld hl, (${o.label}-1)`, 'push hl');
    case 'frame': {
      const d = o.offset;
      if (!frameOk(d, o.byref === true ? 2 : 5, q, ctx)) return [];
      if (o.byref !== true) {
        return lines(
          `ld l, ${ixd(d + 3)}`,
          `ld h, ${ixd(d + 4)}`,
          'push hl',
          `ld l, ${ixd(d + 1)}`,
          `ld h, ${ixd(d + 2)}`,
          'push hl',
          `ld h, ${ixd(d)}`,
          'push hl',
        );
      }
      return lines(
        'exx',
        `ld l, ${ixd(d)}`,
        `ld h, ${ixd(d + 1)}`,
        'ld de, 3',
        'add hl, de',
        'ld e, (hl)',
        'inc hl',
        'ld d, (hl)',
        'push de',
        'dec hl',
        'dec hl',
        'dec hl',
        'ld e, (hl)',
        'inc hl',
        'ld d, (hl)',
        'push de',
        'dec hl',
        'dec hl',
        'ld d, (hl)',
        'push de',
        'exx',
      );
    }
    default:
      ctx.diagnostics.report('E002', span(q), `an operand of kind ${o.k} cannot be a REAL`);
      return [];
  }
}

/** Operands of a binary REAL quad: b in A E D C B, a on the stack. `form`: b is already in the registers (L5-TEMPS). */
function prepF(a: Operand, b: Operand, q: Quad, ctx: EmitContext, form?: TempForm): string[] {
  const inB = form?.inRegs === 'b';
  if (a.k === 'temp') return b.k === 'temp' ? (inB ? [] : popResult('f')) : loadReg('f', b, q, ctx);
  if (b.k === 'temp') return [...(inB ? [] : popResult('f')), ...pushOperandF(a, q, ctx)];
  return [...pushOperandF(a, q, ctx), ...loadReg('f', b, q, ctx)];
}

/** The REAL result is pushed unless the next quad takes it from A E D C B. */
const pushF = (form: TempForm | undefined): string[] => (form?.resultInRegs === true ? [] : pushResult('f'));
/** The REAL operand `o` in A E D C B: popped, or already there (`inReg`). */
const loadF = (o: Operand, q: Quad, ctx: EmitContext, form: TempForm | undefined): string[] => (o.k === 'temp' && form?.inRegs === 'a' ? [] : loadReg('f', o, q, ctx));

/** Stores A E D C B at `dst` (a global or frame slot, possibly BYREF). Clobbers HL for a BYREF slot. */
function storeF(dst: Operand, q: Quad, ctx: EmitContext): string[] {
  if (dst.k === 'global') return lines(`ld (${dst.label}), a`, `ld (${plus(dst.label, 1)}), de`, `ld (${plus(dst.label, 3)}), bc`);
  if (dst.k !== 'frame') {
    ctx.diagnostics.report('E002', span(q), `a REAL cannot be stored to an operand of kind ${dst.k}`);
    return [];
  }
  const d = dst.offset;
  if (!frameOk(d, dst.byref === true ? 2 : 5, q, ctx)) return [];
  if (dst.byref === true) {
    return lines(`ld l, ${ixd(d)}`, `ld h, ${ixd(d + 1)}`, 'ld (hl), a', 'inc hl', 'ld (hl), e', 'inc hl', 'ld (hl), d', 'inc hl', 'ld (hl), c', 'inc hl', 'ld (hl), b');
  }
  return lines(`ld ${ixd(d)}, a`, `ld ${ixd(d + 1)}, e`, `ld ${ixd(d + 2)}, d`, `ld ${ixd(d + 3)}, c`, `ld ${ixd(d + 4)}, b`);
}

/** Error 11 when the divisor in A E D C B is zero: a REAL is zero when its exponent byte (B) is 0, whatever the mantissa. */
function zeroCheckF(ctx: EmitContext): string[] {
  // Firmware builds: `__LOCO_FDIV` finds the zero divisor itself and carries on with the firmware's +-max after
  // printing "Division by zero" (Locomotive's non-fatal error; L4-ERR). Bare builds raise it.
  if (ctx.target.mode === 'firmware') return [];
  ctx.requires.label(ERR);
  const ok = ctx.newLabel();
  return [...lines('ld l, a', 'ld a, b', 'or a', 'ld a, l', `jr nz, ${ok}`, 'ld a, 11', `jp ${ERR}`), `${ok}:`];
}

const tLoadF: Template = (q, ctx, form) => [...loadReg('f', memoryOperand('f', (q as Q<'load'>).a, false), q, ctx), ...pushF(form)];
const tStoreF: Template = (q, ctx, form) => {
  const s = q as Q<'store'>;
  return [...loadF(memoryOperand('f', s.a, false), q, ctx, form), ...storeF(memoryOperand('f', s.dst, true), q, ctx)];
};
const tParamF: Template = (q, ctx) => {
  const { a } = q as Q<'param'>;
  return a.k === 'temp' ? [] : [...loadReg('f', a, q, ctx), ...pushResult('f')];
};
const tFparamF: Template = (q, ctx, form) => loadF((q as Q<'fparam'>).a, q, ctx, form);

const tBinF =
  (label: string, divide = false): Template =>
  (q, ctx, form) => {
    const { a, b } = q as BinQ;
    return [...prepF(a, b, q, ctx, form), ...(divide ? zeroCheckF(ctx) : []), ctx.requires.call(label), ...pushF(form)];
  };

const CMP_LABEL = { eq: '.core.__LOCO_FEQ', ne: '.core.__LOCO_FNE', lt: '.core.__LOCO_FLT', le: '.core.__LOCO_FLE', gt: '.core.__LOCO_FGT', ge: '.core.__LOCO_FGE' } as const;

const tCmpF =
  (op: keyof typeof CMP_LABEL): Template =>
  (q, ctx, form) => {
    const { a, b } = q as BinQ;
    return [...prepF(a, b, q, ctx, form), ctx.requires.call(CMP_LABEL[op]), ...lines('neg', 'ld h, a', 'ld l, a'), ...(form?.resultInRegs === true ? [] : lines('push hl'))];
  };

/** Compare-and-branch for REAL (L5-TEMPS): the routine's A is non-zero when the comparison holds. */
const cmpJumpF =
  (op: keyof typeof CMP_LABEL): CompareJumpTemplate =>
  (cmp, br, ctx, form) => [
    ...prepF(cmp.a, cmp.b, cmp, ctx, form),
    ctx.requires.call(CMP_LABEL[op]),
    ...lines('or a', `jp ${br.when === 'true' ? 'nz' : 'z'}, ${br.label}`),
  ];

const tNegF: Template = (q, ctx, form) => [...loadF((q as UnQ).a, q, ctx, form), ctx.requires.call('.core.__LOCO_FNEG'), ...pushF(form)];
const tAbsF: Template = (q, ctx, form) => [...loadF((q as UnQ).a, q, ctx, form), ctx.requires.call('.core.__LOCO_ABSF'), ...pushF(form)];

const tJumpF =
  (cond: 'z' | 'nz'): Template =>
  (q, ctx, form) => {
    const { a, label } = q as Q<'jz'>;
    // a REAL is zero when its exponent byte (B) is 0, whatever the mantissa (the firmware leaves junk there)
    return [...loadF(a, q, ctx, form), ...lines('inc b', 'dec b', `jp ${cond}, ${label}`)];
  };

const tPeekF: Template = (q, ctx, form) => {
  const { a } = q as Q<'peek'>;
  return [...(a.k === 'temp' && form?.inRegs === 'a' ? [] : loadReg('u16', a, q, ctx)), ctx.requires.call('.core.__LOADF'), ...pushF(form)];
};

const tPokeF: Template = (q, ctx) => {
  const { a, b } = q as Q<'poke'>;
  // b first (the value is on top of the address), then the address in HL with the value kept in the registers
  const addr = a.k === 'temp' ? lines('pop hl') : [...lines('push af', 'push bc', 'push de'), ...loadReg('u16', a, q, ctx), ...lines('pop de', 'pop bc', 'pop af')];
  return [...loadReg('f', b, q, ctx), ...addr, ...lines('ld (hl), a', 'inc hl', 'ld (hl), e', 'inc hl', 'ld (hl), d', 'inc hl', 'ld (hl), c', 'inc hl', 'ld (hl), b')];
};

// ---------------------------------------------------------------------------
// FIXED: the 32-bit integer templates with the 16.16 bit pattern as the immediate
// ---------------------------------------------------------------------------

const bitPattern = (o: Operand): Operand => (o.k === 'imm' ? { k: 'imm', value: Math.round(o.value * 65536) } : o);

/** `op:i32` of the integer table applied to the FIXED quad. */
const asLong =
  (key: string): Template =>
  (q, ctx, form) => {
    const t = INT_TEMPLATES[key];
    if (t === undefined) throw new Error(`no integer template ${key}`);
    const x = q as Record<string, unknown>;
    const mapped: Record<string, unknown> = { ...x, type: 'i32' };
    if ('a' in x) mapped.a = bitPattern(x.a as Operand);
    if ('b' in x) mapped.b = bitPattern(x.b as Operand);
    return t(mapped as unknown as Quad, ctx, form);
  };

/**
 * Pushes a FIXED operand that is not a temp (low word on top) through the exx set, leaving DEHL
 * alone: the imported `__MULF16` and `__DIVF16` take the second operand in DEHL and the first on
 * the stack (the reference's `get_oper`), so the quotient is `stack / DEHL`.
 */
function pushOperand32(o: Operand, q: Quad, ctx: EmitContext): string[] {
  switch (o.k) {
    case 'imm': {
      const v = Math.round(o.value * 65536);
      const lo = ((v % 65536) + 65536) % 65536;
      const hi = ((Math.floor(v / 65536) % 65536) + 65536) % 65536;
      return lines('exx', `ld hl, ${hi}`, 'push hl', `ld hl, ${lo}`, 'push hl', 'exx');
    }
    case 'global':
      return lines('exx', `ld hl, (${plus(o.label, 2)})`, 'push hl', `ld hl, (${o.label})`, 'push hl', 'exx');
    case 'frame': {
      const d = o.offset;
      if (!frameOk(d, o.byref === true ? 2 : 4, q, ctx)) return [];
      if (o.byref !== true) return lines('exx', `ld l, ${ixd(d + 2)}`, `ld h, ${ixd(d + 3)}`, 'push hl', `ld l, ${ixd(d)}`, `ld h, ${ixd(d + 1)}`, 'push hl', 'exx');
      return lines('exx', `ld l, ${ixd(d)}`, `ld h, ${ixd(d + 1)}`, 'ld e, (hl)', 'inc hl', 'ld d, (hl)', 'inc hl', 'ld c, (hl)', 'inc hl', 'ld b, (hl)', 'push bc', 'push de', 'exx');
    }
    default:
      ctx.diagnostics.report('E002', span(q), `an operand of kind ${o.k} cannot be a FIXED`);
      return [];
  }
}

/** b in DEHL, a on the stack (low word on top). */
function prep32(a: Operand, b: Operand, q: Quad, ctx: EmitContext): string[] {
  if (a.k === 'temp') return b.k === 'temp' ? lines('pop hl', 'pop de') : loadReg('f16', b, q, ctx);
  if (b.k === 'temp') return [...lines('pop hl', 'pop de'), ...pushOperand32(a, q, ctx)];
  return [...pushOperand32(a, q, ctx), ...loadReg('f16', b, q, ctx)];
}

const pushF16 = (form: TempForm | undefined): string[] => (form?.resultInRegs === true ? [] : pushResult('f16'));

const tMulF16: Template = (q, ctx, form) => {
  const { a, b } = q as BinQ;
  return [...prep32(a, b, q, ctx), ctx.requires.call('.core.__MULF16'), ...pushF16(form)];
};

const tDivF16: Template = (q, ctx, form) => {
  const { a, b } = q as BinQ;
  ctx.requires.label(ERR);
  const ok = ctx.newLabel();
  const check = lines('ld a, d', 'or e', 'or h', 'or l', `jr nz, ${ok}`, 'ld a, 11', `jp ${ERR}`);
  return [...prep32(a, b, q, ctx), ...check, `${ok}:`, ctx.requires.call('.core.__DIVF16'), ...pushF16(form)];
};

// ---------------------------------------------------------------------------
// casts
// ---------------------------------------------------------------------------

/** From a loaded integer (A / HL / DEHL) to A E D C B. */
function intToReal(from: IntType, ctx: EmitContext): string[] {
  switch (from) {
    case 'u8':
      return [ctx.requires.call('.core.__LOCO_FU8')];
    case 'i8':
      return [ctx.requires.call('.core.__LOCO_FI8')];
    case 'u16':
      return [I('ld de, 0'), ctx.requires.call('.core.__LOCO_FU32')];
    case 'i16':
      return [...lines('ld a, h', 'add a, a', 'sbc a, a', 'ld e, a', 'ld d, a'), ctx.requires.call('.core.__LOCO_FI32')];
    case 'u32':
      return [ctx.requires.call('.core.__LOCO_FU32')];
    case 'i32':
      return [ctx.requires.call('.core.__LOCO_FI32')];
  }
}

/** The operand of a cast, popped or (L5-TEMPS) already in the result registers of its type. */
const loadFrom = (type: IrType, q: Quad, ctx: EmitContext, form: TempForm | undefined): string[] => {
  const a = (q as Q<'cast'>).a;
  return a.k === 'temp' && form?.inRegs === 'a' ? [] : loadReg(type, a, q, ctx);
};
/** The result of a cast of `type`, pushed unless the next quad takes it from the result registers. */
const pushAs = (type: IrType, form: TempForm | undefined): string[] => (form?.resultInRegs === true ? [] : pushResult(type));

const castIntToF =
  (from: IntType): Template =>
  (q, ctx, form) => [...loadFrom(from, q, ctx, form), ...intToReal(from, ctx), ...pushAs('f', form)];

const castFToInt =
  (to: IntType): Template =>
  (q, ctx, form) => {
    const tail = bits(to) === 8 ? lines('ld a, l') : [];
    return [...loadFrom('f', q, ctx, form), ctx.requires.call('.core.__LOCO_FTOI'), ...tail, ...pushAs(to as IrType, form)];
  };

const castFToF16: Template = (q, ctx, form) => [...loadFrom('f', q, ctx, form), ctx.requires.call('.core.__LOCO_FTOF16'), ...pushAs('f16', form)];
const castF16ToF: Template = (q, ctx, form) => [...loadFrom('f16', q, ctx, form), ctx.requires.call('.core.__LOCO_FF16'), ...pushAs('f', form)];

/** FIXED to an integer: the integer part, plus one for a negative value with a fraction (truncation towards zero). */
const castF16ToInt =
  (to: IntType): Template =>
  (q, ctx, form) => {
    const skip = ctx.newLabel();
    const adjust = lines('bit 7, d', `jr z, ${skip}`, 'ld a, h', 'or l', `jr z, ${skip}`, 'inc de');
    const w = bits(to);
    // DE is the integer part; the target takes its low bits, sign-extended into 32 bits when it is a LONG
    const narrow =
      w === 8
        ? lines('ld a, e')
        : w === 16
          ? lines('ex de, hl')
          : lines('ex de, hl', 'ld a, h', 'add a, a', 'sbc a, a', 'ld e, a', 'ld d, a');
    return [...loadFrom('f16', q, ctx, form), ...adjust, `${skip}:`, ...narrow, ...pushAs(to as IrType, form)];
  };

/** An integer to FIXED: the low 16 bits are the integer part. */
const castIntToF16 =
  (from: IntType): Template =>
  (q, ctx, form) => {
    const w = bits(from);
    const signed = from.startsWith('i');
    const widen =
      w === 8
        ? signed
          ? lines('ld e, a', 'add a, a', 'sbc a, a', 'ld d, a', 'ld hl, 0')
          : lines('ld e, a', 'ld d, 0', 'ld hl, 0')
        : w === 16
          ? lines('ex de, hl', 'ld hl, 0')
          : lines('ex de, hl', 'ld hl, 0');
    return [...loadFrom(from, q, ctx, form), ...widen, ...pushAs('f16', form)];
  };

/** STR$ of a REAL or FIXED: the Locomotive text without the trailing space, an owned string. */
const castToStr =
  (from: 'f' | 'f16'): Template =>
  (q, ctx, form) => {
    ctx.requires.file('mem/alloc.asm');
    const conv = from === 'f16' ? [ctx.requires.call('.core.__LOCO_FF16')] : [];
    return [...loadFrom(from, q, ctx, form), ...conv, ctx.requires.call('.core.__LOCO_STRF'), ...(form?.resultInRegs === true ? [] : [I('push hl')])];
  };

// ---------------------------------------------------------------------------
// the table
// ---------------------------------------------------------------------------

function build(): TemplateTable {
  const table: Record<string, Template> = {
    'load:f': tLoadF,
    'store:f': tStoreF,
    'param:f': tParamF,
    'fparam:f': tFparamF,
    'add:f': tBinF('.core.__LOCO_FADD'),
    'sub:f': tBinF('.core.__LOCO_FSUB'),
    'mul:f': tBinF('.core.__LOCO_FMUL'),
    'div:f': tBinF('.core.__LOCO_FDIV', true),
    'pow:f': tBinF('.core.__LOCO_POW'),
    'neg:f': tNegF,
    'abs:f': tAbsF,
    'jz:f': tJumpF('z'),
    'jnz:f': tJumpF('nz'),
    'peek:f': tPeekF,
    'poke:f': tPokeF,
    'mul:f16': tMulF16,
    'div:f16': tDivF16,
    'cast:f->f16': castFToF16,
    'cast:f16->f': castF16ToF,
    'cast:f->str': castToStr('f'),
    'cast:f16->str': castToStr('f16'),
  };
  for (const op of Object.keys(CMP_LABEL) as (keyof typeof CMP_LABEL)[]) table[`${op}:f`] = tCmpF(op);
  for (const op of ['load', 'store', 'param', 'fparam', 'add', 'sub', 'neg', 'abs', 'eq', 'ne', 'lt', 'le', 'gt', 'ge', 'jz', 'jnz', 'peek', 'poke']) {
    table[`${op}:f16`] = asLong(`${op}:i32`);
  }
  for (const t of INT_TYPES) {
    table[`cast:${t}->f`] = castIntToF(t);
    table[`cast:f->${t}`] = castFToInt(t);
    table[`cast:${t}->f16`] = castIntToF16(t);
    table[`cast:f16->${t}`] = castF16ToInt(t);
  }
  return table;
}

/** Templates for f and f16 (see the module comment). */
export const REAL_TEMPLATES: TemplateTable = build();

/** `cmpjump` for REAL (the six comparisons) and for FIXED (as the LONG's: eq, ne, lt, ge, on the 16.16 bit patterns). */
export const REAL_COMPARE_JUMPS: CompareJumpTable = ((): CompareJumpTable => {
  const table: Record<string, CompareJumpTemplate> = {};
  for (const op of Object.keys(CMP_LABEL) as (keyof typeof CMP_LABEL)[]) table[`cmpjump:${op}:f`] = cmpJumpF(op);
  for (const op of ['eq', 'ne', 'lt', 'ge']) {
    const base = INT_COMPARE_JUMPS[`cmpjump:${op}:i32`] as CompareJumpTemplate;
    table[`cmpjump:${op}:f16`] = (cmp, br, ctx, form) => base({ ...cmp, type: 'i32', a: bitPattern(cmp.a), b: bitPattern(cmp.b) } as CompareQuad, br, ctx, form);
  }
  return table;
})();

/**
 * Register forms (L5-TEMPS). REAL: a result stays in A E D C B; a binary quad takes `b` from there (the callee wants `a` on the
 * stack, so `a` never arrives in registers); the unary quads, `store`, `fparam`, `jz`/`jnz` and `peek` take their operand. FIXED
 * mirrors the LONG forms it is built from.
 */
export const REAL_REGISTER_FORMS: RegisterFormTable = ((): RegisterFormTable => {
  const forms: Record<string, { result: boolean; operands: ('a' | 'b')[] }> = {
    'load:f': { result: true, operands: [] },
    'store:f': { result: false, operands: ['a'] },
    'fparam:f': { result: false, operands: ['a'] },
    'neg:f': { result: true, operands: ['a'] },
    'abs:f': { result: true, operands: ['a'] },
    'jz:f': { result: false, operands: ['a'] },
    'jnz:f': { result: false, operands: ['a'] },
    'peek:f': { result: true, operands: ['a'] },
    'mul:f16': { result: true, operands: [] },
    'div:f16': { result: true, operands: [] },
    'cast:f->f16': { result: true, operands: ['a'] },
    'cast:f16->f': { result: true, operands: ['a'] },
    'cast:f->str': { result: true, operands: ['a'] },
    'cast:f16->str': { result: true, operands: ['a'] },
  };
  for (const t of INT_TYPES) {
    for (const key of [`cast:${t}->f`, `cast:f->${t}`, `cast:${t}->f16`, `cast:f16->${t}`]) forms[key] = { result: true, operands: ['a'] };
  }
  for (const op of ['add', 'sub', 'mul', 'div', 'eq', 'ne', 'lt', 'le', 'gt', 'ge']) forms[`${op}:f`] = { result: true, operands: ['b'] };
  for (const op of ['load', 'store', 'fparam', 'add', 'sub', 'neg', 'abs', 'eq', 'ne', 'lt', 'le', 'gt', 'ge', 'jz', 'jnz', 'peek']) {
    const base = INT_REGISTER_FORMS[`${op}:i32`];
    if (base !== undefined) forms[`${op}:f16`] = { result: base.result, operands: [...base.operands] };
  }
  return forms;
})();
