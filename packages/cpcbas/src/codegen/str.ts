/**
 * String templates (L2-CG-STR): `load store concat eq ne lt le gt ge param fparam ret aload
 * astore` on `str`, `jz`/`jnz` on `str` (a string condition is a checker error: unreachable)
 * and the casts with `str` on one side (`cast:<int>->str` is STR$, `cast:str->f` is VAL).
 * The string built-ins (LEN, LEFT$ ...) are `rtcall`s into lib/loco/str.asm, lowered by
 * `ir/lower/strings.ts`.
 *
 * Ownership (docs/ir.md, "Evaluation model"), as the reference's `_str.py`:
 *  - a `str` *temp* is owned: a fresh heap string that exactly one quad consumes, by storing
 *    it without a copy (`__STORE_STR2`), freeing it (after a compare, a concat, a PRINT, a
 *    built-in) or handing it on;
 *  - a `global`, `frame` or `strconst` operand is borrowed: it is read in place and never
 *    freed; storing it copies (`__STORE_STR`);
 *  - `load` of a borrowed operand makes an owned copy (`__LOADSTR`); `param` does the same
 *    for a borrowed operand, so a string argument pushed on the stack is always owned by the
 *    callee; `fparam` hands the pointer over with the free flag in A (1 for a temp, 0 for
 *    a borrowed operand), the convention of `__PRINTSTR`, `__ASC` and lib/loco/str.asm;
 *  - `ret` of a borrowed operand returns a copy.
 *
 * Registers: a string is HL (pointer to the length word; 0 is the empty string). The runtime
 * compares and concatenates with HL = a$, DE = b$; the comparison routines take bit 0 (free
 * a$) and bit 1 (free b$) of A as the free flags and give back A = 0 or non-zero, which is
 * turned into the IR's -1 / 0 here.
 *
 * Every template that can allocate or free requires `mem/alloc.asm`, so the link step defines
 * the heap (a file in MEMINITS) even when only lib/loco files reach the heap.
 */

import { InternalError } from '../core/diagnostics.js';
import type { IrType, Operand, Quad } from '../ir/ir.js';
import { memoryOperand } from './array.js';
import { frameInRange, ixd, loadReg, pushResult } from './flow.js';
import type { CompareJumpTable, CompareJumpTemplate, EmitContext, RegisterFormTable, Template, TemplateTable, TempForm } from './types.js';

type Q<K extends Quad['op']> = Extract<Quad, { op: K }>;

const I = (s: string): string => `\t${s}`;

/** The heap is in use: link `mem/alloc.asm`, which makes the link step define the heap EQUs. */
function heap(ctx: EmitContext): void {
  ctx.requires.file('mem/alloc.asm');
}

/** Loads a string operand's pointer into DE (a temp is popped; a borrowed operand is read in place). */
function loadDe(a: Operand, q: Quad, ctx: EmitContext): string[] {
  switch (a.k) {
    case 'temp':
      return [I('pop de')];
    case 'imm':
      return [I(`ld de, ${a.value & 0xffff}`)];
    case 'global':
      return [I(`ld de, (${a.label})`)];
    case 'strconst':
      return [I(`ld de, .S.${a.id}`)];
    case 'addr':
      return [I(`ld de, ${a.label}${a.offset === undefined || a.offset === 0 ? '' : a.offset > 0 ? `+${a.offset}` : `${a.offset}`}`)];
    case 'frame': {
      if (!frameInRange(a.offset, 2, q, ctx)) return [];
      if (a.byref === true) return [I(`ld l, ${ixd(a.offset)}`), I(`ld h, ${ixd(a.offset + 1)}`), I('ld e, (hl)'), I('inc hl'), I('ld d, (hl)')];
      return [I(`ld e, ${ixd(a.offset)}`), I(`ld d, ${ixd(a.offset + 1)}`)];
    }
    case 'frameaddr':
      throw new InternalError('string template: a frame address is not a string value');
  }
}

/** The address of a string variable (`global`, `frame`) in HL, for the store routines. Clobbers BC for a frame slot. */
function varAddress(dst: Operand, q: Quad, ctx: EmitContext): string[] {
  if (dst.k === 'global') return [I(`ld hl, ${dst.label}`)];
  if (dst.k === 'frame') {
    if (dst.byref === true) {
      if (!frameInRange(dst.offset, 2, q, ctx)) return [];
      return [I(`ld l, ${ixd(dst.offset)}`), I(`ld h, ${ixd(dst.offset + 1)}`)];
    }
    return [I('push ix'), I('pop hl'), I(`ld bc, ${dst.offset & 0xffff}`), I('add hl, bc')];
  }
  throw new InternalError(`string template: operand ${dst.k} is not a string variable`);
}

/** Loads the borrowed pointer (HL) and copies it into a new heap string. */
function loadCopy(a: Operand, q: Quad, ctx: EmitContext): string[] {
  const load = loadReg('str', a, q, ctx);
  if (a.k === 'imm') return load; // the empty string needs no copy
  return [...load, ctx.requires.call('.core.__LOADSTR')];
}

// ---------------------------------------------------------------------------
// load, store, param, fparam, ret, aload, astore
// ---------------------------------------------------------------------------

// L5-TEMPS (docs/ir.md "The template-operand protocol"): an owned string temp in the registers is HL, the pointer, as it is when the
// stack form pops it; a template that wants it in DE moves it (`ex de, hl`).
const inRegs = (form: TempForm | undefined, which: 'a' | 'b'): boolean => form?.inRegs === which;
/** The result is pushed unless the next quad takes it from HL. */
const pushStr = (form: TempForm | undefined): string[] => (form?.resultInRegs === true ? [] : [I('push hl')]);

const load: Template = (q, ctx, form) => {
  heap(ctx);
  return [...loadCopy(memoryOperand('str', (q as Q<'load'>).a, false), q, ctx), ...pushStr(form)];
};

const store: Template = (q, ctx, form) => {
  heap(ctx);
  const { dst, a } = q as Q<'store'>;
  const owned = a.k === 'temp';
  // An `addr` source is the string variable at that address (an element of a global array with a constant index).
  const src = memoryOperand('str', a, false);
  const target = dst.k === 'addr' ? [I(`ld hl, ${dst.label}${dst.offset === undefined || dst.offset === 0 ? '' : `+${dst.offset}`}`)] : varAddress(dst, q, ctx);
  const source = owned && inRegs(form, 'a') ? [I('ex de, hl')] : loadDe(src, q, ctx);
  return [...source, ...target, ctx.requires.call(owned ? '.core.__STORE_STR2' : '.core.__STORE_STR')];
};

const param: Template = (q, ctx) => {
  const { a } = q as Q<'param'>;
  heap(ctx);
  return a.k === 'temp' ? [] : [...loadCopy(a, q, ctx), I('push hl')];
};

const fparam: Template = (q, ctx, form) => {
  const { a } = q as Q<'fparam'>;
  // A constant (or the empty string) is never freed: PRINT "Hello" links no heap.
  if (a.k !== 'strconst' && a.k !== 'imm') heap(ctx);
  if (a.k === 'temp') return inRegs(form, 'a') ? [I('ld a, 1')] : [I('pop hl'), I('ld a, 1')];
  return [...loadReg('str', a, q, ctx), I('xor a')];
};

const ret: Template = (q, ctx, form) => {
  const r = q as Q<'ret'>;
  heap(ctx);
  return [...(r.a.k === 'temp' ? (inRegs(form, 'a') ? [] : [I('pop hl')]) : loadCopy(r.a, q, ctx)), I(`jp ${r.label}`)];
};

/** `dst` = the string at the element address `a` (a u16 temp), copied. */
const aload: Template = (q, ctx, form) => {
  heap(ctx);
  const { a } = q as Q<'aload'>;
  const address = a.k === 'temp' && inRegs(form, 'a') ? [] : loadReg('u16', a, q, ctx);
  return [...address, I('ld a, (hl)'), I('inc hl'), I('ld h, (hl)'), I('ld l, a'), ctx.requires.call('.core.__LOADSTR'), ...pushStr(form)];
};

/** The element at address `a` = `b` (taken when `b` is a temp, copied otherwise). */
const astore: Template = (q, ctx, form) => {
  heap(ctx);
  const { a, b } = q as Q<'astore'>;
  const routine = ctx.requires.call(b.k === 'temp' ? '.core.__STORE_STR2' : '.core.__STORE_STR');
  if (inRegs(form, 'a')) {
    // the element address is in HL and `b` is not a temp: the pointer goes in DE, HL kept (a BYREF slot's load uses HL)
    const byref = b.k === 'frame' && b.byref === true;
    return [...(byref ? [I('push hl')] : []), ...loadDe(b, q, ctx), ...(byref ? [I('pop hl')] : []), routine];
  }
  // `b` (the string, on top of the address) in HL goes to DE; the address is popped into HL
  return [...(inRegs(form, 'b') ? [I('ex de, hl')] : loadDe(b, q, ctx)), ...loadReg('u16', a, q, ctx), routine];
};

// ---------------------------------------------------------------------------
// concat and the comparisons
// ---------------------------------------------------------------------------

/**
 * HL = a$, DE = b$, in that load order (b first, so a temp `a` is the deeper one); returns the free-flag bits. `form`: `b` (a temp) is
 * already in HL, so it moves to DE; or `a` (a temp) is in HL and `b`, not a temp, is loaded into DE around it.
 */
function loadPair(a: Operand, b: Operand, q: Quad, ctx: EmitContext, form?: TempForm): { code: string[]; freeA: boolean; freeB: boolean } {
  let code: string[];
  if (inRegs(form, 'a')) {
    const byref = b.k === 'frame' && b.byref === true;
    code = [...(byref ? [I('push hl')] : []), ...loadDe(b, q, ctx), ...(byref ? [I('pop hl')] : [])];
  } else {
    code = [...(inRegs(form, 'b') ? [I('ex de, hl')] : loadDe(b, q, ctx)), ...loadReg('str', a, q, ctx)];
  }
  return { code, freeA: a.k === 'temp', freeB: b.k === 'temp' };
}

const concat: Template = (q, ctx, form) => {
  heap(ctx);
  const { a, b } = q as Q<'concat'>;
  const p = loadPair(a, b, q, ctx, form);
  const out = [...p.code];
  if (p.freeA) out.push(I('push hl'));
  if (p.freeB) out.push(I('push de'));
  out.push(ctx.requires.call('.core.__ADDSTR'));
  const free = ctx.requires.call('.core.__MEM_FREE');
  if (p.freeA && p.freeB) out.push(I('pop de'), I('ex (sp), hl'), I('push de'), free, I('pop hl'), free);
  else if (p.freeA || p.freeB) out.push(I('ex (sp), hl'), free);
  if (p.freeA || p.freeB) out.push(I('pop hl'));
  out.push(...pushStr(form));
  return out;
};

const COMPARE_LABEL = {
  eq: '.core.__STREQ',
  ne: '.core.__STRNE',
  lt: '.core.__STRLT',
  le: '.core.__STRLE',
  gt: '.core.__STRGT',
  ge: '.core.__STRGE',
} as const;

const compare = (op: keyof typeof COMPARE_LABEL): Template => (q, ctx, form) => {
  heap(ctx);
  const { a, b } = q as Q<'eq'>;
  const p = loadPair(a, b, q, ctx, form);
  const flags = (p.freeA ? 1 : 0) | (p.freeB ? 2 : 0);
  // A is 0 for false and non-zero for true; the IR wants -1 / 0 in an i16.
  return [
    ...p.code,
    I(flags === 0 ? 'xor a' : `ld a, ${flags}`),
    ctx.requires.call(COMPARE_LABEL[op]),
    I('add a, 255'),
    I('sbc a, a'),
    I('ld l, a'),
    I('ld h, a'),
    ...(form?.resultInRegs === true ? [] : [I('push hl')]),
  ];
};

/** Compare-and-branch (L5-TEMPS): the routine's A is non-zero when the comparison holds, which the flags of `or a` branch on. */
const compareJump =
  (op: keyof typeof COMPARE_LABEL): CompareJumpTemplate =>
  (cmp, br, ctx, form) => {
    heap(ctx);
    const p = loadPair(cmp.a, cmp.b, cmp, ctx, form);
    const flags = (p.freeA ? 1 : 0) | (p.freeB ? 2 : 0);
    return [...p.code, I(flags === 0 ? 'xor a' : `ld a, ${flags}`), ctx.requires.call(COMPARE_LABEL[op]), I('or a'), I(`jp ${br.when === 'true' ? 'nz' : 'z'}, ${br.label}`)];
  };

/** `cmpjump:<op>:str` for the six comparisons. */
export const STR_COMPARE_JUMPS: CompareJumpTable = Object.fromEntries((Object.keys(COMPARE_LABEL) as (keyof typeof COMPARE_LABEL)[]).map((op) => [`cmpjump:${op}:str`, compareJump(op)]));

const condition: Template = (q) => {
  throw new InternalError(`\`${q.op}\` on a string: a string condition is a checker error`);
};

// ---------------------------------------------------------------------------
// casts
// ---------------------------------------------------------------------------

type IntType = 'u8' | 'i8' | 'u16' | 'i16' | 'u32' | 'i32';
const INT_TYPES: readonly IntType[] = ['u8', 'i8', 'u16', 'i16', 'u32', 'i32'];

const STR_ENTRY: Record<IntType, string> = {
  u8: '.core.__LOCO_STRU16',
  i8: '.core.__LOCO_STRI16',
  u16: '.core.__LOCO_STRU16',
  i16: '.core.__LOCO_STRI16',
  u32: '.core.__LOCO_STRU32',
  i32: '.core.__LOCO_STRI32',
};

/** STR$: the Locomotive number text of the value (a sign position, no trailing space), an owned string. */
const intToStr = (from: IntType): Template => (q, ctx, form) => {
  heap(ctx);
  const { a } = q as Q<'cast'>;
  const widen =
    from === 'u8' ? [I('ld l, a'), I('ld h, 0')] : from === 'i8' ? [I('ld l, a'), I('add a, a'), I('sbc a, a'), I('ld h, a')] : [];
  return [...(a.k === 'temp' && inRegs(form, 'a') ? [] : loadReg(from as IrType, a, q, ctx)), ...widen, ctx.requires.call(STR_ENTRY[from]), ...pushStr(form)];
};

/** VAL: the REAL value of the text (the string is freed when it is a temp). */
const strToReal: Template = (q, ctx) => {
  heap(ctx);
  const { a } = q as Q<'cast'>;
  const arg = a.k === 'temp' ? [I('pop hl'), I('ld a, 1')] : [...loadReg('str', a, q, ctx), I('xor a')];
  return [...arg, ctx.requires.call('.core.__LOCO_VAL'), ...pushResult('f')];
};

function build(): TemplateTable {
  const table: Record<string, Template> = {
    'load:str': load,
    'store:str': store,
    'param:str': param,
    'fparam:str': fparam,
    'ret:str': ret,
    'aload:str': aload,
    'astore:str': astore,
    'concat:str': concat,
    'jz:str': condition,
    'jnz:str': condition,
    'cast:str->f': strToReal,
  };
  for (const op of Object.keys(COMPARE_LABEL) as (keyof typeof COMPARE_LABEL)[]) table[`${op}:str`] = compare(op);
  // REAL and FIXED text (cast:f->str, cast:f16->str) and VAL into other types are not
  // registered: generate() reports them as not implemented until L2-CG-REAL provides the text.
  for (const t of INT_TYPES) table[`cast:${t}->str`] = intToStr(t);
  return table;
}

export const STR_TEMPLATES: TemplateTable = build();

/**
 * Register forms (L5-TEMPS): a string temp stays in HL (owned, as when popped) between its producer (`load`, `concat`, STR$, a `call`
 * or `aload`) and its consumer (`store`, `concat`, a comparison, `fparam`, `ret`, `astore`). `param` keeps the stack form: the argument
 * is pushed either way.
 */
export const STR_REGISTER_FORMS: RegisterFormTable = ((): RegisterFormTable => {
  const forms: Record<string, { result: boolean; operands: ('a' | 'b')[] }> = {
    'load:str': { result: true, operands: [] },
    'store:str': { result: false, operands: ['a'] },
    'fparam:str': { result: false, operands: ['a'] },
    'ret:str': { result: false, operands: ['a'] },
    'aload:str': { result: true, operands: ['a'] },
    'astore:str': { result: false, operands: ['a', 'b'] },
    'concat:str': { result: true, operands: ['a', 'b'] },
  };
  for (const op of Object.keys(COMPARE_LABEL)) forms[`${op}:str`] = { result: true, operands: ['a', 'b'] };
  for (const t of INT_TYPES) forms[`cast:${t}->str`] = { result: true, operands: ['a'] };
  return forms;
})();
