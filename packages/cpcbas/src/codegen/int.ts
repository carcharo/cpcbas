/**
 * Integer templates (L2-CG-INT): `u8 i8 u16 i16 u32 i32`. One template per quad op and type,
 * keyed `op:type` (codegen/types.ts). Conventions (docs/ir.md): results in A (8 bit), HL
 * (16 bit) or DEHL (32 bit); a temp is a value on the Z80 stack (`push af` / `push hl` /
 * `push de; push hl`); a binary quad pops `b` before `a`.
 *
 * Operand preparation (the loaders clobber A, plus the pair that receives the value; an 8-bit
 * BYREF load also HL):
 *   8 bit   A = a, B = b
 *   16 bit  HL = a, DE = b
 *   32 bit  DEHL = a, b on the stack (low word on top, as the runtime's CALLEE routines
 *           want it); add/sub/logic/compare with an immediate `b` skip the push
 * Comparisons give -1 or 0 as an i16 temp. Division and MOD by zero raise runtime error 11
 * (the runtime's divide routines do not), through `.core.__ERROR`; MOD takes the sign of
 * the dividend (the runtime's remainders are |a| mod |b|, fixed up here). 8-bit signed
 * division calls `__DIVI8_FAST`; its remainder is |a| mod |b|, fixed up like the wider types.
 * Shifts loop one bit at a time, so a count beyond the width gives 0 (or the sign fill).
 */

import { InternalError } from '../core/diagnostics.js';
import type { IrType, Operand, Quad } from '../ir/ir.js';
import { memoryOperand } from './array.js';
import { checkFrameOperands } from './flow.js';
import { constantShift } from './shift.js';
import type { CompareJumpTable, CompareJumpTemplate, EmitContext, RegisterFormTable, Template, TemplateTable, TempForm } from './types.js';

type IntType = 'u8' | 'i8' | 'u16' | 'i16' | 'u32' | 'i32';
const INT_TYPES: readonly IntType[] = ['u8', 'i8', 'u16', 'i16', 'u32', 'i32'];

const isInt = (t: IrType): t is IntType => (INT_TYPES as readonly string[]).includes(t);
const bits = (t: IntType): 8 | 16 | 32 => (t === 'u8' || t === 'i8' ? 8 : t === 'u16' || t === 'i16' ? 16 : 32);
const isSigned = (t: IntType): boolean => t.startsWith('i');

const ERR = '.core.__ERROR';

/** The optimised template styles (`fast` at -O2 and -O3, `short` at -Os); `base` (-O0, -O1) keeps RC3's forms (L5-CG). */
const optimised = (ctx: EmitContext): boolean => ctx.style === 'fast' || ctx.style === 'short';

const I = (s: string): string => `\t${s}`;
const lines = (...ss: string[]): string[] => ss.map(I);

/** `value` as an unsigned number of `n` bits. */
function mask(value: number, n: number): number {
  return Number(BigInt.asUintN(n, BigInt(Math.trunc(value))));
}

const disp = (offset: number): string => `ix${offset < 0 ? '-' : '+'}${Math.abs(offset)}`;
const plus = (label: string, n: number): string => (n === 0 ? label : `${label}+${n}`);

function bad(o: Operand, t: IrType): never {
  throw new InternalError(`integer template: operand ${o.k} is not valid for ${t}`);
}

/** Pushes the register value of a result onto the stack. */
function push(t: IntType): string[] {
  const n = bits(t);
  return n === 8 ? lines('push af') : n === 16 ? lines('push hl') : lines('push de', 'push hl');
}

/** {@link push} unless the quad hands its result to the next one in the result registers (L5-TEMPS). */
const pushIf = (t: IntType, form: TempForm | undefined): string[] => (form?.resultInRegs === true ? [] : push(t));

/** The temp operand `which` arrives in the result registers (L5-TEMPS, codegen/types.ts `TempForm`). */
const inRegs = (form: TempForm | undefined, which: 'a' | 'b'): boolean => form?.inRegs === which;

/** The stack form of a quad whose temp is in the result registers: push it back, then the RC3 lines (always correct, never smaller). */
function repush(t: IntType, tmpl: Template, x: Quad, ctx: EmitContext, form: TempForm | undefined): string[] {
  return [...push(t), ...tmpl(x, ctx, { inRegs: null, resultInRegs: form?.resultInRegs === true })];
}

/**
 * Loads operand `o` of type `t` into A / HL / DEHL (popping a temp, or taking it from the result registers when `inReg`).
 * Clobbers A besides the target registers (nothing for a temp); an 8-bit BYREF load also clobbers HL.
 */
function load(t: IntType, o: Operand, inReg = false): string[] {
  const n = bits(t);
  if (o.k === 'temp' && inReg) return [];
  if (o.k === 'temp') return n === 8 ? lines('pop af') : n === 16 ? lines('pop hl') : lines('pop hl', 'pop de');
  if (n === 8) {
    switch (o.k) {
      case 'imm':
        return lines(`ld a, ${mask(o.value, 8)}`);
      case 'global':
        return lines(`ld a, (${o.label})`);
      case 'frame':
        return o.byref === true
          ? lines(`ld l, (${disp(o.offset)})`, `ld h, (${disp(o.offset + 1)})`, 'ld a, (hl)')
          : lines(`ld a, (${disp(o.offset)})`);
      default:
        return bad(o, t);
    }
  }
  if (n === 16) {
    switch (o.k) {
      case 'imm':
        return lines(`ld hl, ${mask(o.value, 16)}`);
      case 'global':
        return lines(`ld hl, (${o.label})`);
      case 'frame':
        return o.byref === true
          ? lines(`ld l, (${disp(o.offset)})`, `ld h, (${disp(o.offset + 1)})`, 'ld a, (hl)', 'inc hl', 'ld h, (hl)', 'ld l, a')
          : lines(`ld l, (${disp(o.offset)})`, `ld h, (${disp(o.offset + 1)})`);
      case 'addr':
        return lines(`ld hl, ${plus(o.label, o.offset ?? 0)}`);
      case 'frameaddr':
        return lines('push bc', 'push ix', 'pop hl', `ld bc, ${mask(o.offset, 16)}`, 'add hl, bc', 'pop bc');
      default:
        return bad(o, t);
    }
  }
  switch (o.k) {
    case 'imm': {
      const v = mask(o.value, 32);
      return lines(`ld hl, ${v & 0xffff}`, `ld de, ${v >>> 16}`);
    }
    case 'global':
      return lines(`ld hl, (${o.label})`, `ld de, (${plus(o.label, 2)})`);
    case 'frame':
      return o.byref === true
        ? lines(
            `ld l, (${disp(o.offset)})`,
            `ld h, (${disp(o.offset + 1)})`,
            'ld e, (hl)',
            'inc hl',
            'ld d, (hl)',
            'inc hl',
            'ld a, (hl)',
            'inc hl',
            'ld h, (hl)',
            'ld l, a',
            'ex de, hl',
          )
        : lines(`ld l, (${disp(o.offset)})`, `ld h, (${disp(o.offset + 1)})`, `ld e, (${disp(o.offset + 2)})`, `ld d, (${disp(o.offset + 3)})`);
    default:
      return bad(o, t);
  }
}

/** Stores A / HL / DEHL into `dst` (a global or a frame slot, possibly BYREF). */
function storeTo(t: IntType, dst: Operand): string[] {
  const n = bits(t);
  if (dst.k === 'global') {
    return n === 8
      ? lines(`ld (${dst.label}), a`)
      : n === 16
        ? lines(`ld (${dst.label}), hl`)
        : lines(`ld (${dst.label}), hl`, `ld (${plus(dst.label, 2)}), de`);
  }
  if (dst.k !== 'frame') return bad(dst, t);
  const o = dst.offset;
  if (dst.byref !== true) {
    return n === 8
      ? lines(`ld (${disp(o)}), a`)
      : n === 16
        ? lines(`ld (${disp(o)}), l`, `ld (${disp(o + 1)}), h`)
        : lines(`ld (${disp(o)}), l`, `ld (${disp(o + 1)}), h`, `ld (${disp(o + 2)}), e`, `ld (${disp(o + 3)}), d`);
  }
  if (n === 8) return lines(`ld l, (${disp(o)})`, `ld h, (${disp(o + 1)})`, 'ld (hl), a');
  if (n === 16) {
    return lines('ex de, hl', `ld l, (${disp(o)})`, `ld h, (${disp(o + 1)})`, 'ld (hl), e', 'inc hl', 'ld (hl), d');
  }
  return lines(
    'push de',
    'push hl',
    `ld l, (${disp(o)})`,
    `ld h, (${disp(o + 1)})`,
    'pop bc',
    'ld (hl), c',
    'inc hl',
    'ld (hl), b',
    'inc hl',
    'pop bc',
    'ld (hl), c',
    'inc hl',
    'ld (hl), b',
  );
}

// ---------------------------------------------------------------------------
// operand preparation
// ---------------------------------------------------------------------------

/**
 * A = a, B = b. With `immB`, an immediate `b` is not loaded: `bImm` is its value. `form` is the template-operand form
 * (L5-TEMPS): `b` in A, or `a` in A (then `b` is not a temp, and C keeps `a` while `b` is loaded).
 */
function prep8(t: IntType, a: Operand, b: Operand, immB: boolean, form?: TempForm): { code: string[]; bImm: number | null } {
  if (inRegs(form, 'a')) {
    if (b.k === 'imm') return immB ? { code: [], bImm: mask(b.value, 8) } : { code: lines(`ld b, ${mask(b.value, 8)}`), bImm: null };
    return { code: [...lines('ld c, a'), ...load(t, b), ...lines('ld b, a', 'ld a, c')], bImm: null };
  }
  if (immB && b.k === 'imm') return { code: load(t, a), bImm: mask(b.value, 8) };
  const code =
    b.k === 'temp' ? lines(...(inRegs(form, 'b') ? [] : ['pop af']), 'ld b, a') : b.k === 'imm' ? lines(`ld b, ${mask(b.value, 8)}`) : [...load(t, b), I('ld b, a')];
  code.push(...load(t, a));
  return { code, bImm: null };
}

/** DE = operand `o` (not a temp) of a 16-bit type, HL kept. */
function loadDE(t: IntType, o: Operand): string[] {
  switch (o.k) {
    case 'imm':
      return lines(`ld de, ${mask(o.value, 16)}`);
    case 'global':
      return lines(`ld de, (${o.label})`);
    case 'addr':
      return lines(`ld de, ${plus(o.label, o.offset ?? 0)}`);
    case 'frame':
      if (o.byref !== true) return lines(`ld e, (${disp(o.offset)})`, `ld d, (${disp(o.offset + 1)})`);
      break;
  }
  return lines('push hl', ...load(t, o).map((l) => l.slice(1)), 'ex de, hl', 'pop hl');
}

/** HL = a, DE = b. `form`: `b` in HL (then `ex de, hl`), or `a` in HL (then `b`, not a temp, goes to DE directly). */
function prep16(t: IntType, a: Operand, b: Operand, form?: TempForm): string[] {
  if (inRegs(form, 'a')) return loadDE(t, b);
  const code =
    b.k === 'temp' ? (inRegs(form, 'b') ? lines('ex de, hl') : lines('pop de')) : b.k === 'imm' ? lines(`ld de, ${mask(b.value, 16)}`) : [...load(t, b), I('ex de, hl')];
  code.push(...load(t, a));
  return code;
}

/** HL = b, DE = a (the operands the other way round, for `a > b` and `a <= b` as `b < a`). `form` as for {@link prep16}. */
function prep16Swapped(t: IntType, a: Operand, b: Operand, form?: TempForm): string[] {
  if (inRegs(form, 'a')) return [I('ex de, hl'), ...load(t, b)];
  if (inRegs(form, 'b')) return a.k === 'temp' ? lines('pop de') : loadDE(t, a);
  if (b.k === 'temp') return a.k === 'temp' ? lines('pop hl', 'pop de') : [I('pop hl'), ...loadDE(t, a)];
  return a.k === 'temp' ? [I('pop de'), ...load(t, b)] : [...loadDE(t, a), ...load(t, b)];
}

/** What the 32-bit operations of a quad read `b` from: the stack (`bImm` and `bMem` null), an immediate, or a variable's memory (L5-TEMPS). */
interface Prep32 {
  readonly code: string[];
  readonly bImm: number | null;
  readonly bMem: Operand | null;
}

/** Pushes a 32-bit operand that is not a temp or a BYREF slot (low word on top) through BC, leaving DEHL alone. */
function pushViaBc(o: Operand): string[] {
  switch (o.k) {
    case 'imm': {
      const v = mask(o.value, 32);
      return lines(`ld bc, ${v >>> 16}`, 'push bc', `ld bc, ${v & 0xffff}`, 'push bc');
    }
    case 'global':
      return lines(`ld bc, (${plus(o.label, 2)})`, 'push bc', `ld bc, (${o.label})`, 'push bc');
    default:
      return lines(`ld c, (${disp((o as { offset: number }).offset + 2)})`, `ld b, (${disp((o as { offset: number }).offset + 3)})`, 'push bc', `ld c, (${disp((o as { offset: number }).offset)})`, `ld b, (${disp((o as { offset: number }).offset + 1)})`, 'push bc');
  }
}

/** A plain 32-bit memory operand (a global or a frame slot that is not BYREF), which BC can be loaded from without touching DEHL. */
const plainMem = (o: Operand): boolean => o.k === 'global' || (o.k === 'frame' && o.byref !== true);

/**
 * DEHL = a, b on the stack (low word on top). With `immB`, an immediate `b` is returned in `bImm` and not pushed. `form`: `b` is in
 * DEHL (it is pushed, and `a` loaded or swapped in from the stack), or `a` is in DEHL: it stays there while `b` is read through BC
 * (an immediate or, with `immB`, a variable is not pushed at all: `bMem`), and a BYREF `b` pushes `a` back and follows the stack form.
 */
function prep32(t: IntType, a: Operand, b: Operand, immB: boolean, form?: TempForm, fast = false): Prep32 {
  if (inRegs(form, 'a')) {
    if (immB && b.k === 'imm') return { code: [], bImm: mask(b.value, 32), bMem: null };
    if (immB && plainMem(b)) return { code: [], bImm: null, bMem: b };
    if (b.k === 'imm' || plainMem(b)) return { code: pushViaBc(b), bImm: null, bMem: null };
    return { code: [...lines('push de', 'push hl'), ...prep32(t, a, b, immB).code], bImm: null, bMem: null };
  }
  if (inRegs(form, 'b')) {
    // `a` is below `b` on the stack (low word on top): swap it into DEHL and leave `b` pushed in its place
    if (a.k === 'temp') return { code: lines('ex (sp), hl', 'pop bc', 'ex de, hl', 'ex (sp), hl', 'push bc', 'ex de, hl'), bImm: null, bMem: null };
    return { code: [...lines('push de', 'push hl'), ...load(t, a)], bImm: null, bMem: null };
  }
  if (immB && b.k === 'imm') return { code: load(t, a), bImm: mask(b.value, 32), bMem: null };
  // follow-up 184 (L5-CG, optimised styles): `a OP b` with `a` loaded first and `b` a plain variable reads `b` through BC at the
  // operation, so it is neither pushed nor popped (4 instructions fewer); `a` may be the temp left on the stack
  if (fast && immB && plainMem(b)) return { code: load(t, a), bImm: null, bMem: b };
  const code: string[] = [];
  if (b.k !== 'temp') code.push(...load(t, b), ...lines('push de', 'push hl'));
  if (a.k === 'temp') code.push(...lines('pop bc', 'pop af', 'pop hl', 'pop de', 'push af', 'push bc'));
  else code.push(...load(t, a));
  return { code, bImm: null, bMem: null };
}

/** Fetches the next word of `b` into BC: from the stack, from the immediate, or from the variable's memory. */
function bcOf(bImm: number | null, part: 'lo' | 'hi', bMem: Operand | null = null): string[] {
  if (bMem !== null) {
    const at = part === 'lo' ? 0 : 2;
    return bMem.k === 'global' ? lines(`ld bc, (${plus(bMem.label, at)})`) : lines(`ld c, (${disp((bMem as { offset: number }).offset + at)})`, `ld b, (${disp((bMem as { offset: number }).offset + at + 1)})`);
  }
  if (bImm === null) return lines('pop bc');
  return lines(`ld bc, ${part === 'lo' ? bImm & 0xffff : bImm >>> 16}`);
}

function errorIfZero(ctx: EmitContext, test: string[]): string[] {
  ctx.requires.label(ERR);
  const ok = ctx.newLabel();
  return [...test, I(`jr nz, ${ok}`), ...lines('ld a, 11', `jp ${ERR}`), `${ok}:`];
}

type BinQ = Extract<Quad, { readonly b: Operand; readonly dst: Operand }>;
type UnQ = Extract<Quad, { readonly op: 'neg' | 'not' | 'abs' }>;
type JumpQ = Extract<Quad, { readonly op: 'jz' | 'jnz' }>;
const q = <T extends Quad>(x: Quad): T => x as T;

// ---------------------------------------------------------------------------
// load, store, cast, param, fparam
// ---------------------------------------------------------------------------

const tLoad = (t: IntType): Template => (x, _ctx, form) => {
  const { a } = q<Extract<Quad, { readonly op: 'load' }>>(x);
  return [...load(t, memoryOperand(t, a, false)), ...pushIf(t, form)];
};

const tStore = (t: IntType): Template => (x, _ctx, form) => {
  const { dst, a } = q<Extract<Quad, { readonly op: 'store' }>>(x);
  return [...load(t, memoryOperand(t, a, false), inRegs(form, 'a')), ...storeTo(t, memoryOperand(t, dst, true))];
};

function convert(from: IntType, to: IntType): string[] {
  const fw = bits(from);
  const tw = bits(to);
  const signed = isSigned(from);
  if (tw <= fw) return tw === 8 && fw > 8 ? lines('ld a, l') : [];
  if (fw === 8) {
    if (tw === 16) return signed ? lines('ld l, a', 'add a, a', 'sbc a, a', 'ld h, a') : lines('ld l, a', 'ld h, 0');
    return signed ? lines('ld l, a', 'add a, a', 'sbc a, a', 'ld h, a', 'ld e, a', 'ld d, a') : lines('ld l, a', 'ld h, 0', 'ld de, 0');
  }
  return signed ? lines('ld a, h', 'add a, a', 'sbc a, a', 'ld e, a', 'ld d, a') : lines('ld de, 0');
}

const tCast = (to: IntType): Template => (x, ctx, form) => {
  const { from, a } = q<Extract<Quad, { readonly op: 'cast' }>>(x);
  if (!isInt(from)) {
    ctx.diagnostics.report('E002', x.span ?? { file: 0 as never, start: 0, end: 0 }, `\`cast\` from \`${from}\` to \`${to}\` is not implemented yet`);
    return [];
  }
  // same width, a temp: the value is already where the result goes, unless the form moves it
  if (a.k === 'temp' && bits(from) === bits(to)) {
    if (inRegs(form, 'a')) return pushIf(to, form);
    if (form?.resultInRegs !== true) return [];
  }
  return [...load(from, a, inRegs(form, 'a')), ...convert(from, to), ...pushIf(to, form)];
};

const tParam = (t: IntType): Template => (x) => {
  const { a } = q<Extract<Quad, { readonly op: 'param' }>>(x);
  return a.k === 'temp' ? [] : [...load(t, a), ...push(t)];
};

const tFparam = (t: IntType): Template => (x, _ctx, form) => load(t, q<Extract<Quad, { readonly op: 'fparam' }>>(x).a, inRegs(form, 'a'));

// ---------------------------------------------------------------------------
// add, sub, and, or, xor
// ---------------------------------------------------------------------------

type Simple = 'add' | 'sub' | 'and' | 'or' | 'xor';

const MNEMONIC8: Record<Simple, string> = { add: 'add a,', sub: 'sub', and: 'and', or: 'or', xor: 'xor' };
const LOGIC16: Record<'and' | 'or' | 'xor', string> = { and: 'and', or: 'or', xor: 'xor' };
const COMMUTATIVE: ReadonlySet<string> = new Set(['add', 'and', 'or', 'xor']);

/** An 8-bit memory operand `op a, <operand>` can use directly: `pre` clobbers HL only. */
function memOperand8(o: Operand): { pre: string[]; operand: string } | null {
  if (o.k === 'global') return { pre: lines(`ld hl, ${o.label}`), operand: '(hl)' };
  if (o.k !== 'frame') return null;
  if (o.byref !== true) return { pre: [], operand: `(${disp(o.offset)})` };
  return { pre: lines(`ld l, (${disp(o.offset)})`, `ld h, (${disp(o.offset + 1)})`), operand: '(hl)' };
}

const tSimple = (t: IntType, op: Simple): Template => (x, ctx, form) => {
  let { a, b } = q<BinQ>(x);
  let f = form;
  // b in the registers and a an ordinary operand: a commutative operation takes them the other way round
  if (inRegs(f, 'b') && a.k !== 'temp' && COMMUTATIVE.has(op) && (bits(t) < 32 || a.k === 'imm')) {
    [a, b] = [b, a];
    f = { inRegs: 'a', resultInRegs: f?.resultInRegs === true };
  }
  const n = bits(t);
  if (n === 8) {
    if (inRegs(f, 'a') && b.k !== 'imm') {
      const m = memOperand8(memoryOperand(t, b, false));
      if (m !== null) return [...m.pre, I(`${MNEMONIC8[op]} ${m.operand}`), ...pushIf(t, form)];
    }
    const p = prep8(t, a, b, true, f);
    return [...p.code, I(`${MNEMONIC8[op]} ${p.bImm ?? 'b'}`), ...pushIf(t, form)];
  }
  if (n === 16) {
    const p = prep16(t, a, b, f);
    let body: string[];
    if (op === 'add') body = lines('add hl, de');
    else if (op === 'sub') body = lines('or a', 'sbc hl, de');
    else {
      const m = LOGIC16[op];
      body = lines('ld a, h', `${m} d`, 'ld h, a', 'ld a, l', `${m} e`, 'ld l, a');
    }
    return [...p, ...body, ...pushIf(t, form)];
  }
  const p = prep32(t, a, b, true, f, optimised(ctx));
  let body: string[];
  if (op === 'add') {
    body = [...bcOf(p.bImm, 'lo', p.bMem), I('add hl, bc'), I('ex de, hl'), ...bcOf(p.bImm, 'hi', p.bMem), I('adc hl, bc'), I('ex de, hl')];
  } else if (op === 'sub') {
    body = [...bcOf(p.bImm, 'lo', p.bMem), I('or a'), I('sbc hl, bc'), I('ex de, hl'), ...bcOf(p.bImm, 'hi', p.bMem), I('sbc hl, bc'), I('ex de, hl')];
  } else {
    const m = LOGIC16[op];
    body = [
      ...bcOf(p.bImm, 'lo', p.bMem),
      ...lines('ld a, l', `${m} c`, 'ld l, a', 'ld a, h', `${m} b`, 'ld h, a'),
      ...bcOf(p.bImm, 'hi', p.bMem),
      ...lines('ld a, e', `${m} c`, 'ld e, a', 'ld a, d', `${m} b`, 'ld d, a'),
    ];
  }
  return [...p.code, ...body, ...pushIf(t, form)];
};

// ---------------------------------------------------------------------------
// mul, div, mod
// ---------------------------------------------------------------------------

const tMul = (t: IntType): Template => (x, ctx, form) => {
  const { a, b } = q<BinQ>(x);
  const n = bits(t);
  if (n === 8) {
    const p = prep8(t, a, b, true, form);
    return [...p.code, I(p.bImm === null ? 'ld h, b' : `ld h, ${p.bImm}`), ctx.requires.call('.core.__MUL8_FAST'), ...pushIf(t, form)];
  }
  if (n === 16) return [...prep16(t, a, b, form), ctx.requires.call('.core.__MUL16_FAST'), ...pushIf(t, form)];
  return [...prep32(t, a, b, false, form).code, ctx.requires.call('.core.__MUL32'), ...pushIf(t, form)];
};

/** Stack check of a 32-bit divisor (low word on top of the stack, DEHL live): error 11 when it is zero. */
function zeroCheck32(ctx: EmitContext): string[] {
  return errorIfZero(ctx, lines('push hl', 'push de', 'ld hl, 4', 'add hl, sp', 'ld a, (hl)', 'inc hl', 'or (hl)', 'inc hl', 'or (hl)', 'inc hl', 'or (hl)', 'pop de', 'pop hl'));
}

/** Negates HL when the sign word pushed before the call says the dividend was negative. */
function fixSign16(ctx: EmitContext): string[] {
  const skip = ctx.newLabel();
  return [...lines('pop af', 'or a', `jp p, ${skip}`), ctx.requires.call('.core.__NEGHL'), `${skip}:`];
}

const tDivMod = (t: IntType, op: 'div' | 'mod'): Template => (x, ctx, form) => {
  const { a, b } = q<BinQ>(x);
  const n = bits(t);
  const signed = isSigned(t);
  if (n === 8) {
    const p = prep8(t, a, b, true, form);
    const code = [...p.code];
    if (p.bImm === null) code.push(...errorIfZero(ctx, lines('inc b', 'dec b')), I('ld h, b'));
    else if (p.bImm === 0) code.push(...errorIfZero(ctx, lines('xor a')), I('ld h, 0'));
    else code.push(I(`ld h, ${p.bImm}`));
    code.push(ctx.requires.call(signed ? '.core.__DIVI8_FAST' : '.core.__DIVU8_FAST'));
    if (op === 'mod') {
      code.push(I('ld a, l'));
      if (signed) {
        // L is |a| mod |b|; E still holds the dividend: the remainder takes its sign
        const skip = ctx.newLabel();
        code.push(...lines('bit 7, e', `jr z, ${skip}`, 'neg'), `${skip}:`);
      }
    }
    return [...code, ...pushIf(t, form)];
  }
  if (n === 16) {
    // an immediate divisor that is not zero needs no run-time test (R18; optimised styles: -O0 and -O1 keep RC3's)
    const known = optimised(ctx) && b.k === 'imm' && mask(b.value, 16) !== 0;
    const code = [...prep16(t, a, b, form), ...(known ? [] : errorIfZero(ctx, lines('ld a, d', 'or e')))];
    if (!signed) code.push(ctx.requires.call(op === 'div' ? '.core.__DIVU16' : '.core.__MODU16'));
    else if (op === 'div') code.push(ctx.requires.call('.core.__DIVI16'));
    else code.push(...lines('ld a, h', 'push af'), ctx.requires.call('.core.__MODI16'), ...fixSign16(ctx));
    return [...code, ...pushIf(t, form)];
  }
  const known32 = optimised(ctx) && b.k === 'imm' && mask(b.value, 32) !== 0;
  const code = [...prep32(t, a, b, false, form).code, ...(known32 ? [] : zeroCheck32(ctx))];
  if (!signed) code.push(ctx.requires.call(op === 'div' ? '.core.__DIVU32' : '.core.__MODU32'));
  else if (op === 'div') code.push(ctx.requires.call('.core.__DIVI32'));
  else {
    // keep the dividend's sign under the divisor, for the fix-up after the call
    code.push(...lines('pop bc', 'pop af', 'ex af, af\'', 'ld a, d', 'push af', 'ex af, af\'', 'push af', 'push bc'));
    code.push(ctx.requires.call('.core.__MODI32'));
    const skip = ctx.newLabel();
    code.push(...lines('pop af', 'or a', `jp p, ${skip}`), ctx.requires.call('.core.__NEG32'), `${skip}:`);
  }
  return [...code, ...pushIf(t, form)];
};

// ---------------------------------------------------------------------------
// neg, abs, not
// ---------------------------------------------------------------------------

const tNeg = (t: IntType): Template => (x, ctx, form) => {
  const { a } = q<UnQ>(x);
  const n = bits(t);
  const body = n === 8 ? lines('neg') : n === 16 ? lines('xor a', 'sub l', 'ld l, a', 'sbc a, a', 'sub h', 'ld h, a') : [ctx.requires.call('.core.__NEG32')];
  return [...load(t, a, inRegs(form, 'a')), ...body, ...pushIf(t, form)];
};

const tAbs = (t: IntType): Template => (x, ctx, form) => {
  const { a } = q<UnQ>(x);
  if (!isSigned(t)) {
    if (a.k === 'temp' && !inRegs(form, 'a') && form?.resultInRegs !== true) return [];
    return [...load(t, a, inRegs(form, 'a')), ...pushIf(t, form)];
  }
  const n = bits(t);
  const call = ctx.requires.call(n === 8 ? '.core.__ABS8' : n === 16 ? '.core.__ABS16' : '.core.__ABS32');
  return [...load(t, a, inRegs(form, 'a')), call, ...pushIf(t, form)];
};

const tNot = (t: IntType): Template => (x, _ctx, form) => {
  const { a } = q<UnQ>(x);
  const n = bits(t);
  const body =
    n === 8
      ? lines('cpl')
      : n === 16
        ? lines('ld a, h', 'cpl', 'ld h, a', 'ld a, l', 'cpl', 'ld l, a')
        : lines('ld a, h', 'cpl', 'ld h, a', 'ld a, l', 'cpl', 'ld l, a', 'ld a, d', 'cpl', 'ld d, a', 'ld a, e', 'cpl', 'ld e, a');
  return [...load(t, a, inRegs(form, 'a')), ...body, ...pushIf(t, form)];
};

// ---------------------------------------------------------------------------
// shl, shr
// ---------------------------------------------------------------------------

function shiftStep(t: IntType, dir: 'shl' | 'shr'): string[] {
  const n = bits(t);
  const arith = isSigned(t);
  if (dir === 'shl') return n === 8 ? lines('add a, a') : n === 16 ? lines('add hl, hl') : lines('add hl, hl', 'rl e', 'rl d');
  const sh = arith ? 'sra' : 'srl';
  return n === 8 ? lines(`${sh} a`) : n === 16 ? lines(`${sh} h`, 'rr l') : lines(`${sh} d`, 'rr e', 'rr h', 'rr l');
}

const tShift = (t: IntType, dir: 'shl' | 'shr'): Template => {
  const self: Template = (x, ctx, form) => {
    const { a, b } = q<BinQ>(x);
    const step = shiftStep(t, dir);
    const n = bits(t);
    // `a` in the registers with a count that is not a constant: the count's load would clobber it
    if (inRegs(form, 'a') && b.k !== 'imm') return repush(t, self, x, ctx, form);
    if (b.k === 'imm') {
      const count = Math.min(mask(b.value, 8), n);
      const head = load(t, a, inRegs(form, 'a'));
      if (count === 0) return [...head, ...pushIf(t, form)];
      if (optimised(ctx)) {
        // whole-byte moves, unrolled steps, rotate-and-mask: the cheapest way for the style (codegen/shift.ts)
        const body = constantShift(n, dir, isSigned(t), count, ctx.style as 'fast' | 'short', ctx.newLabel);
        return [...head, ...body, ...pushIf(t, form)];
      }
      if (count <= 3) {
        const body: string[] = [];
        for (let i = 0; i < count; i++) body.push(...step);
        return [...head, ...body, ...pushIf(t, form)];
      }
      const loop = ctx.newLabel();
      return [...head, I(`ld b, ${count}`), `${loop}:`, ...step, I(`djnz ${loop}`), ...pushIf(t, form)];
    }
    // the count is a u8 temp (in A when it is the adjacent one)
    const count = b.k === 'temp' ? lines(...(inRegs(form, 'b') ? [] : ['pop af']), 'ld b, a') : [...load('u8', b), I('ld b, a')];
    const loop = ctx.newLabel();
    const done = ctx.newLabel();
    return [...count, ...load(t, a), ...lines('inc b', 'dec b', `jr z, ${done}`), `${loop}:`, ...step, I(`djnz ${loop}`), `${done}:`, ...pushIf(t, form)];
  };
  return self;
};

// ---------------------------------------------------------------------------
// comparisons: -1 or 0 in an i16 temp
// ---------------------------------------------------------------------------

type Cmp = 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge';

/** After the flags of `a - b` (or of the high word's `sbc`) are set: A = -1 when a < b, A = 0 otherwise. */
function lessFlags(t: IntType, ctx: EmitContext, signedSource: string[]): string[] {
  if (!isSigned(t)) return lines('sbc a, a');
  const l = ctx.newLabel();
  return [...signedSource, I(`jp po, ${l}`), I('xor 128'), `${l}:`, ...lines('rlca', 'sbc a, a')];
}


/** An 8-bit comparison with an immediate: the instruction that sets the flags, then how A becomes -1 or 0. */
interface Imm8Compare {
  readonly test: string[];
  /** The flags are those of `a - k` (carry when less, the signed fix-up for a signed type): `lessFlags` finishes them. Otherwise `zero` does. */
  readonly less: boolean;
  readonly zero: string[];
  readonly invert: boolean;
}

/** Null when the operation needs the operands the other way round and the constant cannot be moved by one (`a > 255`, `a <= 127`). */
function compareImm8(t: IntType, op: Cmp, value: number): Imm8Compare | null {
  const k = mask(value, 8);
  if (op === 'eq' || op === 'ne') {
    return { test: k === 0 ? [] : lines(`xor ${k}`), less: false, zero: op === 'eq' ? lines('sub 1', 'sbc a, a') : lines('add a, 255', 'sbc a, a'), invert: false };
  }
  const signed = isSigned(t);
  let bound = k;
  if (op === 'gt' || op === 'le') {
    // a > k is not (a < k+1), a <= k is a < k+1
    if (signed ? (k >= 128 ? k - 256 : k) >= 127 : k === 255) return null;
    bound = (k + 1) & 255;
  }
  return { test: lines(signed ? `sub ${bound}` : `cp ${bound}`), less: true, zero: [], invert: op === 'ge' || op === 'gt' };
}

const tCompare = (t: IntType, op: Cmp): Template => (x, ctx, form) => {
  const { a, b } = q<BinQ>(x);
  const n = bits(t);
  const result = form?.resultInRegs === true ? lines('ld h, a', 'ld l, a') : lines('ld h, a', 'ld l, a', 'push hl');
  const invert = op === 'ge' || op === 'le' || op === 'ne';
  let code: string[];
  if (n === 8 && optimised(ctx) && b.k === 'imm' && compareImm8(t, op, b.value) !== null) {
    // an immediate `b` is an operand of the instruction (`xor 5`, `cp 5`), not loaded into B first (L5-CG; optimised styles)
    const p = prep8(t, a, b, true, form);
    const c = compareImm8(t, op, b.value) as Imm8Compare;
    code = [...p.code, ...c.test, ...(c.less ? lessFlags(t, ctx, []) : c.zero), ...(c.invert ? lines('cpl') : [])];
  } else if (n === 8) {
    const p = prep8(t, a, b, false, form).code;
    if (op === 'eq') code = [...p, ...lines('xor b', 'sub 1', 'sbc a, a')];
    else if (op === 'ne') code = [...p, ...lines('xor b', 'add a, 255', 'sbc a, a')];
    else {
      const swap = op === 'gt' || op === 'le' ? lines('ld c, a', 'ld a, b', 'ld b, c') : [];
      const sub = isSigned(t) ? lines('sub b') : lines('cp b');
      code = [...p, ...swap, ...sub, ...lessFlags(t, ctx, []), ...(invert ? lines('cpl') : [])];
    }
  } else if (n === 16) {
    const p = prep16(t, a, b, form);
    if (op === 'eq' || op === 'ne') {
      code = [...p, ...lines('ld a, h', 'xor d', 'ld h, a', 'ld a, l', 'xor e', 'or h'), ...(op === 'eq' ? lines('sub 1', 'sbc a, a') : lines('add a, 255', 'sbc a, a'))];
    } else {
      const swap = op === 'gt' || op === 'le' ? lines('ex de, hl') : [];
      code = [...p, ...swap, ...lines('or a', 'sbc hl, de'), ...lessFlags(t, ctx, lines('ld a, h')), ...(invert ? lines('cpl') : [])];
    }
  } else {
    const p = prep32(t, a, b, true, form, optimised(ctx));
    if (op === 'eq' || op === 'ne') {
      code = [
        ...p.code,
        ...bcOf(p.bImm, 'lo', p.bMem),
        ...lines('ld a, l', 'xor c', 'ld l, a', 'ld a, h', 'xor b', 'or l', 'ld l, a'),
        ...bcOf(p.bImm, 'hi', p.bMem),
        ...lines('ld a, e', 'xor c', 'ld e, a', 'ld a, d', 'xor b', 'or e', 'or l'),
        ...(op === 'eq' ? lines('sub 1', 'sbc a, a') : lines('add a, 255', 'sbc a, a')),
      ];
    } else {
      const diff = [...p.code, ...bcOf(p.bImm, 'lo', p.bMem), ...lines('or a', 'sbc hl, bc', 'ex de, hl'), ...bcOf(p.bImm, 'hi', p.bMem), I('sbc hl, bc')];
      const less = lessFlags(t, ctx, lines('ld a, h'));
      if (op === 'lt') code = [...diff, ...less];
      else if (op === 'ge') code = [...diff, ...less, ...lines('cpl')];
      else {
        // a <= b is (a < b) or (a == b); a > b is its complement
        code = [...diff, ...less, ...lines('ld b, a', 'ld a, h', 'or l', 'or d', 'or e', 'sub 1', 'sbc a, a', 'or b'), ...(op === 'gt' ? lines('cpl') : [])];
      }
    }
  }
  return [...code, ...result];
};

/**
 * Compare-and-branch (L5-TEMPS): the comparison and the `jz`/`jnz` that tests it, with no boolean. The flags of `cp` / `sub` /
 * `sbc hl, de` decide; the sign and overflow handling is the `lt`/`gt` templates' (`jp po` / `xor 128`). `cc` is the condition
 * under which the comparison is true; the branch is taken on it (`when: 'true'`) or on its inverse (`'false'`).
 */
const INVERSE: Readonly<Record<string, string>> = { z: 'nz', nz: 'z', c: 'nc', nc: 'c' };

const tCmpJump = (t: IntType, op: Cmp): CompareJumpTemplate => (cmp, br, ctx, form) => {
  if (!checkFrameOperands(cmp, ctx)) return [];
  const { a, b } = cmp;
  const n = bits(t);
  const signed = isSigned(t);
  let code: string[];
  let cc: 'z' | 'nz' | 'c' | 'nc';
  // a signed less-than leaves its answer in the carry: A holds the (a - b) sign byte after this
  const signFix = (src: string[]): string[] => {
    const l = ctx.newLabel();
    return [...src, I(`jp po, ${l}`), I('xor 128'), `${l}:`, I('rlca')];
  };
  if (n === 32) {
    // eq, ne, lt and ge only: a > b and a <= b would need the operands the other way round on the stack
    const p = prep32(t, a, b, true, form, optimised(ctx));
    if (op === 'eq' || op === 'ne') {
      code = [
        ...p.code,
        ...bcOf(p.bImm, 'lo', p.bMem),
        ...lines('ld a, l', 'xor c', 'ld l, a', 'ld a, h', 'xor b', 'or l', 'ld l, a'),
        ...bcOf(p.bImm, 'hi', p.bMem),
        ...lines('ld a, e', 'xor c', 'ld e, a', 'ld a, d', 'xor b', 'or e', 'or l'),
      ];
      cc = op === 'eq' ? 'z' : 'nz';
    } else {
      const diff = [...p.code, ...bcOf(p.bImm, 'lo', p.bMem), ...lines('or a', 'sbc hl, bc', 'ex de, hl'), ...bcOf(p.bImm, 'hi', p.bMem), I('sbc hl, bc')];
      code = signed ? signFix([...diff, I('ld a, h')]) : diff;
      cc = op === 'lt' ? 'c' : 'nc';
    }
  } else if (n === 8) {
    const swap = op === 'gt' || op === 'le';
    if (op === 'eq' || op === 'ne') {
      const p = prep8(t, a, b, true, form);
      code = [...p.code, I(`cp ${p.bImm ?? 'b'}`)];
      cc = op === 'eq' ? 'z' : 'nz';
    } else if (!signed && swap && b.k === 'imm' && mask(b.value, 8) < 255) {
      // a > k is a >= k+1, a <= k is a < k+1
      const p = prep8(t, a, b, true, form);
      code = [...p.code, I(`cp ${(p.bImm as number) + 1}`)];
      cc = op === 'gt' ? 'nc' : 'c';
    } else if (swap) {
      const p = prep8(t, a, b, false, form);
      code = [...p.code, ...lines('ld c, a', 'ld a, b'), ...(signed ? signFix(lines('sub c')) : lines('cp c'))];
      cc = op === 'gt' ? 'c' : 'nc';
    } else {
      const p = prep8(t, a, b, true, form);
      code = [...p.code, ...(signed ? signFix(lines(`sub ${p.bImm ?? 'b'}`)) : lines(`cp ${p.bImm ?? 'b'}`))];
      cc = op === 'lt' ? 'c' : 'nc';
    }
  } else {
    const sub = lines('or a', 'sbc hl, de');
    if (op === 'eq' || op === 'ne') {
      code = [...prep16(t, a, b, form), ...sub];
      cc = op === 'eq' ? 'z' : 'nz';
    } else {
      // a > b and a <= b are b < a: the operands go in the other registers rather than being swapped afterwards
      const swap = op === 'gt' || op === 'le';
      code = [...(swap ? prep16Swapped(t, a, b, form) : prep16(t, a, b, form)), ...(signed ? signFix([...sub, ...lines('ld a, h')]) : sub)];
      cc = op === 'lt' || op === 'gt' ? 'c' : 'nc';
    }
  }
  const taken = br.when === 'true' ? cc : (INVERSE[cc] as string);
  return [...code, I(`jp ${taken}, ${br.label}`)];
};

// ---------------------------------------------------------------------------
// jz, jnz
// ---------------------------------------------------------------------------

const tJump = (t: IntType, cond: 'z' | 'nz'): Template => (x, _ctx, form) => {
  const { a, label } = q<JumpQ>(x);
  const n = bits(t);
  const test = n === 8 ? lines('or a') : n === 16 ? lines('ld a, h', 'or l') : lines('ld a, h', 'or l', 'or d', 'or e');
  return [...load(t, a, inRegs(form, 'a')), ...test, I(`jp ${cond}, ${label}`)];
};

// ---------------------------------------------------------------------------
// peek, poke, in, out
// ---------------------------------------------------------------------------

const tPeek = (t: IntType): Template => (x, _ctx, form) => {
  const { a } = q<Extract<Quad, { readonly op: 'peek' }>>(x);
  const n = bits(t);
  if (a.k === 'imm') {
    const ad = mask(a.value, 16);
    const body = n === 8 ? lines(`ld a, (${ad})`) : n === 16 ? lines(`ld hl, (${ad})`) : lines(`ld hl, (${ad})`, `ld de, (${(ad + 2) & 0xffff})`);
    return [...body, ...pushIf(t, form)];
  }
  const body =
    n === 8
      ? lines('ld a, (hl)')
      : n === 16
        ? lines('ld a, (hl)', 'inc hl', 'ld h, (hl)', 'ld l, a')
        : lines('ld e, (hl)', 'inc hl', 'ld d, (hl)', 'inc hl', 'ld a, (hl)', 'inc hl', 'ld h, (hl)', 'ld l, a', 'ex de, hl');
  return [...load('u16', a, inRegs(form, 'a')), ...body, ...pushIf(t, form)];
};

const tPoke = (t: IntType): Template => (x, _ctx, form) => {
  const { a, b } = q<Extract<Quad, { readonly op: 'poke' }>>(x);
  const n = bits(t);
  const addrIn = inRegs(form, 'a'); // the address is in HL (b is then not a temp)
  const valueIn = inRegs(form, 'b'); // the value is in the result registers
  if (n === 8) {
    if (b.k === 'imm' && a.k !== 'imm') return [...load('u16', a, addrIn), ...lines(`ld (hl), ${mask(b.value, 8)}`)];
    if (addrIn) {
      // the address stays in HL while the value is loaded (a BYREF slot's load clobbers HL)
      const v = load(t, b);
      return b.k === 'frame' && b.byref === true ? [I('push hl'), ...v, I('pop hl'), I('ld (hl), a')] : [...v, I('ld (hl), a')];
    }
    const code = load(t, b, valueIn);
    if (a.k === 'imm') return [...code, ...lines(`ld (${mask(a.value, 16)}), a`)];
    return [...code, I('ld c, a'), ...load('u16', a), I('ld (hl), c')];
  }
  if (n === 16) {
    if (addrIn) return [...loadDE(t, b), ...lines('ld (hl), e', 'inc hl', 'ld (hl), d')];
    const code = load(t, b, valueIn);
    if (a.k === 'imm') return [...code, ...lines(`ld (${mask(a.value, 16)}), hl`)];
    return [...code, I('ex de, hl'), ...load('u16', a), ...lines('ld (hl), e', 'inc hl', 'ld (hl), d')];
  }
  const code = load(t, b);
  const pointer = a.k === 'temp' ? lines('pop bc', 'push hl', 'ld h, b', 'ld l, c', 'pop bc') : [I('push hl'), ...load('u16', a), I('pop bc')];
  return [...code, ...pointer, ...lines('ld (hl), c', 'inc hl', 'ld (hl), b', 'inc hl', 'ld (hl), e', 'inc hl', 'ld (hl), d')];
};

const tIn: Template = (x) => {
  const { a } = q<Extract<Quad, { readonly op: 'in' }>>(x);
  const port = a.k === 'temp' ? lines('pop bc') : a.k === 'imm' ? lines(`ld bc, ${mask(a.value, 16)}`) : [...load('u16', a), ...lines('ld b, h', 'ld c, l')];
  return [...port, ...lines('in a, (c)', 'push af')];
};

const tOut: Template = (x) => {
  const { a, b } = q<Extract<Quad, { readonly op: 'out' }>>(x);
  const value = b.k === 'imm' ? [] : [...load('u8', b), I('ld d, a')];
  const port = a.k === 'temp' ? lines('pop bc') : a.k === 'imm' ? lines(`ld bc, ${mask(a.value, 16)}`) : [...load('u16', a), ...lines('ld b, h', 'ld c, l')];
  return [...value, ...port, I(b.k === 'imm' ? `ld a, ${mask(b.value, 8)}` : 'ld a, d'), I('out (c), a')];
};

// ---------------------------------------------------------------------------
// the table
// ---------------------------------------------------------------------------

/**
 * A template that first checks its frame operands with the shared range check (flow.ts). It passes the
 * template-operand form through (codegen/types.ts `TempForm`), so L5-TEMPS' register forms reach the
 * wrapped template (R17: the wrapper used to drop it).
 */
export function withFrameCheck(t: Template): Template {
  return (q, ctx, form) => (checkFrameOperands(q, ctx) ? t(q, ctx, form) : []);
}

function build(): TemplateTable {
  const table: Record<string, Template> = {};
  for (const t of INT_TYPES) {
    table[`load:${t}`] = tLoad(t);
    table[`store:${t}`] = tStore(t);
    for (const f of INT_TYPES) table[`cast:${f}->${t}`] = tCast(t);
    table[`param:${t}`] = tParam(t);
    table[`fparam:${t}`] = tFparam(t);
    for (const op of ['add', 'sub', 'and', 'or', 'xor'] as const) table[`${op}:${t}`] = tSimple(t, op);
    table[`mul:${t}`] = tMul(t);
    table[`div:${t}`] = tDivMod(t, 'div');
    table[`mod:${t}`] = tDivMod(t, 'mod');
    table[`neg:${t}`] = tNeg(t);
    table[`abs:${t}`] = tAbs(t);
    table[`not:${t}`] = tNot(t);
    table[`shl:${t}`] = tShift(t, 'shl');
    table[`shr:${t}`] = tShift(t, 'shr');
    for (const op of ['eq', 'ne', 'lt', 'le', 'gt', 'ge'] as const) table[`${op}:${t}`] = tCompare(t, op);
    table[`jz:${t}`] = tJump(t, 'z');
    table[`jnz:${t}`] = tJump(t, 'nz');
    table[`peek:${t}`] = tPeek(t);
    table[`poke:${t}`] = tPoke(t);
  }
  table['in:u8'] = tIn;
  table['out:u8'] = tOut;
  // every template checks its frame operands with the shared range check (flow.ts)
  for (const [key, t] of Object.entries(table)) table[key] = withFrameCheck(t);
  return table;
}

// ---------------------------------------------------------------------------
// register forms and compare-and-branch (L5-TEMPS; docs/ir.md "The template-operand protocol")
// ---------------------------------------------------------------------------

const NARROW: readonly IntType[] = ['u8', 'i8', 'u16', 'i16'];

function buildForms(): RegisterFormTable {
  const forms: Record<string, { result: boolean; operands: ('a' | 'b')[] }> = {};
  const set = (key: string, result: boolean, ...operands: ('a' | 'b')[]): void => void (forms[key] = { result, operands });
  for (const t of INT_TYPES) {
    set(`load:${t}`, true);
    set(`store:${t}`, false, 'a');
    set(`fparam:${t}`, false, 'a');
    for (const f of INT_TYPES) set(`cast:${f}->${t}`, true, 'a');
    for (const op of ['neg', 'not', 'abs']) set(`${op}:${t}`, true, 'a');
    set(`jz:${t}`, false, 'a');
    set(`jnz:${t}`, false, 'a');
    set(`peek:${t}`, true, 'a');
    for (const op of ['add', 'sub', 'and', 'or', 'xor', 'mul', 'div', 'mod', 'shl', 'shr', 'eq', 'ne', 'lt', 'le', 'gt', 'ge']) set(`${op}:${t}`, true, 'a', 'b');
    if (NARROW.includes(t)) set(`poke:${t}`, false, 'a', 'b');
  }
  return forms;
}

/** Which integer templates can leave a result in the result registers and take a temp operand from them. */
export const INT_REGISTER_FORMS: RegisterFormTable = buildForms();

function buildCompareJumps(): CompareJumpTable {
  const table: Record<string, CompareJumpTemplate> = {};
  for (const t of NARROW) for (const op of ['eq', 'ne', 'lt', 'le', 'gt', 'ge'] as const) table[`cmpjump:${op}:${t}`] = tCmpJump(t, op);
  for (const t of ['u32', 'i32'] as const) for (const op of ['eq', 'ne', 'lt', 'ge'] as const) table[`cmpjump:${op}:${t}`] = tCmpJump(t, op);
  return table;
}

/** Compare-and-branch for the 8- and 16-bit comparisons, and eq, ne, lt and ge of the 32-bit ones. */
export const INT_COMPARE_JUMPS: CompareJumpTable = buildCompareJumps();

/** Templates for u8, i8, u16, i16, u32 and i32 (see the module comment). */
export const INT_TEMPLATES: TemplateTable = build();
