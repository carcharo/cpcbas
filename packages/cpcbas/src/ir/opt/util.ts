/**
 * Shared helpers of the IR passes (L5-IR): which operand fields of a quad pop a temp, the type a
 * field is read in, the memory-killing quads of docs/ir.md "The rules every pass keeps", integer
 * wrapping, and the change log the `ir-opt` dump prints under `--opt-trace`.
 *
 * Every pass is pure: it returns a new program (or the same object when nothing changed), keeps
 * every `label` and `stmt` quad, and leaves `globals`, `strings`, `data` and the procedure
 * headers alone.
 */
import { wrap, type TypeName } from '../../sem/types.js';
import type { IrProgram, IrProcedure, IrType, Operand, Quad } from '../ir.js';

export type Field = 'a' | 'b';

export const INT_TYPES: ReadonlySet<IrType> = new Set<IrType>(['u8', 'i8', 'u16', 'i16', 'u32', 'i32']);
export const isIntType = (t: IrType): boolean => INT_TYPES.has(t);
export const isTemp = (o: Operand | null | undefined): o is Extract<Operand, { k: 'temp' }> => o !== null && o !== undefined && o.k === 'temp';

const TYPE_NAME: Readonly<Record<IrType, TypeName>> = {
  u8: 'UBYTE',
  i8: 'BYTE',
  u16: 'UINTEGER',
  i16: 'INTEGER',
  u32: 'ULONG',
  i32: 'LONG',
  f16: 'FIXED',
  f: 'REAL',
  str: 'STRING',
};
export const typeName = (t: IrType): TypeName => TYPE_NAME[t];

export const bitsOf = (t: IrType): number => (t === 'u8' || t === 'i8' ? 8 : t === 'u16' || t === 'i16' ? 16 : 32);
export const isSignedType = (t: IrType): boolean => t === 'i8' || t === 'i16' || t === 'i32';

/** `v` wrapped into integer type `t` (two's complement, the type's own range). */
export const wrapInt = (v: number, t: IrType): number => wrap(v, TYPE_NAME[t]);
/** `v` as the unsigned bit pattern of `t`. */
export const unsignedOf = (v: number, t: IrType): number => {
  const n = bitsOf(t);
  const m = 2 ** n;
  return ((Math.trunc(v) % m) + m) % m;
};

/** Log2 of `v` when it is a power of two at least 2, else -1. */
export function log2Exact(v: number): number {
  if (!Number.isInteger(v) || v < 2) return -1;
  const l = Math.round(Math.log2(v));
  return 2 ** l === v ? l : -1;
}

/** The operand fields of a quad that pop a temp, in the verifier's order (pop order: b before a). */
export function popFields(q: Quad): readonly Field[] {
  switch (q.op) {
    case 'poke':
    case 'out':
    case 'astore':
    case 'add':
    case 'sub':
    case 'mul':
    case 'div':
    case 'mod':
    case 'pow':
    case 'and':
    case 'or':
    case 'xor':
    case 'shl':
    case 'shr':
    case 'concat':
    case 'eq':
    case 'ne':
    case 'lt':
    case 'le':
    case 'gt':
    case 'ge':
      return ['b', 'a'];
    case 'load':
    case 'store':
    case 'neg':
    case 'not':
    case 'abs':
    case 'cast':
    case 'peek':
    case 'in':
    case 'aload':
    case 'jz':
    case 'jnz':
    case 'jtable':
    case 'end':
    case 'param':
    case 'fparam':
    case 'ret':
      return ['a'];
    default:
      return [];
  }
}

/** The operand of field `f` (the field must be one of {@link popFields}). */
export const fieldOf = (q: Quad, f: Field): Operand => (q as unknown as Record<Field, Operand>)[f];
export const withField = (q: Quad, f: Field, o: Operand): Quad => ({ ...q, [f]: o }) as Quad;

/**
 * The type a field is read in, or null when the field cannot take anything but a temp (the element
 * address of `aload`/`astore`) or is not an integer read.
 */
export function readType(q: Quad, f: Field): IrType | null {
  switch (q.op) {
    case 'add':
    case 'sub':
    case 'mul':
    case 'div':
    case 'mod':
    case 'and':
    case 'or':
    case 'xor':
    case 'eq':
    case 'ne':
    case 'lt':
    case 'le':
    case 'gt':
    case 'ge':
      return q.type;
    case 'shl':
    case 'shr':
      return f === 'a' ? q.type : 'u8';
    case 'neg':
    case 'not':
    case 'abs':
    case 'store':
    case 'jz':
    case 'jnz':
    case 'param':
    case 'fparam':
    case 'ret':
      return q.type;
    case 'cast':
      return q.from;
    case 'peek':
    case 'in':
      return 'u16';
    case 'poke':
      return f === 'a' ? 'u16' : q.type;
    case 'out':
      return 'u8';
    case 'astore':
      return f === 'b' ? q.type : null;
    case 'jtable':
    case 'end':
      return 'u16';
    default:
      return null;
  }
}

/** Quads that kill every memory fact (docs/ir.md "The rules every pass keeps"; a `store` kills them too: this IR stage is conservative). */
export function killsMemory(q: Quad): boolean {
  switch (q.op) {
    case 'call':
    case 'rtcall':
    case 'gosub':
    case 'asm':
    case 'poke':
    case 'astore':
    case 'in':
    case 'out':
    case 'store':
    case 'jtable':
      return true;
    default:
      return false;
  }
}

/** Quads after which the next quad is unreachable by falling through. */
export const isTerminator = (q: Quad): boolean => q.op === 'jump' || q.op === 'end' || q.op === 'retsub' || q.op === 'leave' || q.op === 'ret';

/** The program with every body mapped by `fn` (main, then each procedure); the same object when no body changed. */
export function mapBodies(ir: IrProgram, fn: (body: readonly Quad[], where: string) => readonly Quad[]): IrProgram {
  let changed = false;
  const main = fn(ir.main, 'main');
  if (main !== ir.main) changed = true;
  const procedures: IrProcedure[] = ir.procedures.map((p) => {
    const body = fn(p.body, p.label);
    if (body === p.body) return p;
    changed = true;
    return { ...p, body };
  });
  return changed ? { ...ir, main, procedures } : ir;
}

// ---------------------------------------------------------------------------
// The change log (the `--opt-trace` lines of the `ir-opt` dump)
// ---------------------------------------------------------------------------

const logs = new WeakMap<IrProgram, readonly string[]>();

/** The lines `; opt <pass>: <what>` the passes wrote for this program (empty unless `trace` was on). */
export function irOptTrace(ir: IrProgram): readonly string[] {
  return logs.get(ir) ?? [];
}

/** Attaches the changes of one pass to its result (the input's earlier lines carry over). */
export function attachTrace(input: IrProgram, output: IrProgram, pass: string, changes: readonly string[]): IrProgram {
  const prior = logs.get(input) ?? [];
  if (output !== input && (prior.length > 0 || changes.length > 0)) logs.set(output, [...prior, ...changes.map((c) => `; opt ${pass}: ${c}`)]);
  return output;
}
