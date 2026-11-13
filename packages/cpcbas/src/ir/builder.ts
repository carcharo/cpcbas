/**
 * A small builder for writing IR by hand (lowering and template tests). Value methods
 * allocate the destination temp, append the quad and return the temp operand; every
 * quad gets `span: null` unless a span is given.
 */
import type { Span } from '../core/source.js';
import type { BinaryOp, CompareOp, IrType, Operand, Quad, UnaryOp } from './ir.js';

type Sp = Span | null;

export const imm = (value: number): Operand => ({ k: 'imm', value });
export const global = (label: string): Operand => ({ k: 'global', label });
export const frame = (offset: number, byref = false): Operand => (byref ? { k: 'frame', offset, byref } : { k: 'frame', offset });
export const addr = (label: string, offset?: number): Operand => (offset === undefined ? { k: 'addr', label } : { k: 'addr', label, offset });
export const frameaddr = (offset: number): Operand => ({ k: 'frameaddr', offset });
export const strconst = (id: number): Operand => ({ k: 'strconst', id });

export class IrBuilder {
  /** The quads appended so far. */
  readonly quads: Quad[] = [];
  private nextTemp = 0;
  private nextLabel = 0;

  /** A fresh temp operand (ids 0, 1, 2, ...). */
  temp(): Operand {
    return { k: 'temp', id: this.nextTemp++ };
  }

  /** A fresh IR label `.T.<n>` (not yet placed; use {@link label}). */
  newLabel(): string {
    return `.T.${this.nextLabel++}`;
  }

  /** Append any quad as is. */
  push(q: Quad): this {
    this.quads.push(q);
    return this;
  }

  /** Return the quads built so far and start over (temp and label counters continue). */
  take(): Quad[] {
    return this.quads.splice(0, this.quads.length);
  }

  // ---- values ---------------------------------------------------------
  load(type: IrType, a: Operand, span: Sp = null): Operand {
    const dst = this.temp();
    this.quads.push({ op: 'load', type, dst, a, span });
    return dst;
  }
  store(type: IrType, dst: Operand, a: Operand, span: Sp = null): this {
    return this.push({ op: 'store', type, dst, a, span });
  }
  binary(op: BinaryOp | CompareOp, type: IrType, a: Operand, b: Operand, span: Sp = null): Operand {
    const dst = this.temp();
    this.quads.push({ op, type, dst, a, b, span } as Quad);
    return dst;
  }
  add(type: IrType, a: Operand, b: Operand, span: Sp = null): Operand {
    return this.binary('add', type, a, b, span);
  }
  sub(type: IrType, a: Operand, b: Operand, span: Sp = null): Operand {
    return this.binary('sub', type, a, b, span);
  }
  mul(type: IrType, a: Operand, b: Operand, span: Sp = null): Operand {
    return this.binary('mul', type, a, b, span);
  }
  div(type: IrType, a: Operand, b: Operand, span: Sp = null): Operand {
    return this.binary('div', type, a, b, span);
  }
  mod(type: IrType, a: Operand, b: Operand, span: Sp = null): Operand {
    return this.binary('mod', type, a, b, span);
  }
  pow(a: Operand, b: Operand, span: Sp = null): Operand {
    return this.binary('pow', 'f', a, b, span);
  }
  and(type: IrType, a: Operand, b: Operand, span: Sp = null): Operand {
    return this.binary('and', type, a, b, span);
  }
  or(type: IrType, a: Operand, b: Operand, span: Sp = null): Operand {
    return this.binary('or', type, a, b, span);
  }
  xor(type: IrType, a: Operand, b: Operand, span: Sp = null): Operand {
    return this.binary('xor', type, a, b, span);
  }
  shl(type: IrType, a: Operand, b: Operand, span: Sp = null): Operand {
    return this.binary('shl', type, a, b, span);
  }
  shr(type: IrType, a: Operand, b: Operand, span: Sp = null): Operand {
    return this.binary('shr', type, a, b, span);
  }
  concat(a: Operand, b: Operand, span: Sp = null): Operand {
    return this.binary('concat', 'str', a, b, span);
  }
  /** Comparison `op` (eq ne lt le gt ge) of operands of `type`; the result is an i16 temp. */
  compare(op: CompareOp, type: IrType, a: Operand, b: Operand, span: Sp = null): Operand {
    return this.binary(op, type, a, b, span);
  }
  unary(op: UnaryOp, type: IrType, a: Operand, span: Sp = null): Operand {
    const dst = this.temp();
    this.quads.push({ op, type, dst, a, span });
    return dst;
  }
  neg(type: IrType, a: Operand, span: Sp = null): Operand {
    return this.unary('neg', type, a, span);
  }
  not(type: IrType, a: Operand, span: Sp = null): Operand {
    return this.unary('not', type, a, span);
  }
  abs(type: IrType, a: Operand, span: Sp = null): Operand {
    return this.unary('abs', type, a, span);
  }
  cast(type: IrType, from: IrType, a: Operand, span: Sp = null): Operand {
    const dst = this.temp();
    this.quads.push({ op: 'cast', type, from, dst, a, span });
    return dst;
  }

  // ---- memory ---------------------------------------------------------
  peek(type: IrType, a: Operand, span: Sp = null): Operand {
    const dst = this.temp();
    this.quads.push({ op: 'peek', type, dst, a, span });
    return dst;
  }
  poke(type: IrType, a: Operand, b: Operand, span: Sp = null): this {
    return this.push({ op: 'poke', type, a, b, span });
  }
  in(a: Operand, span: Sp = null): Operand {
    const dst = this.temp();
    this.quads.push({ op: 'in', type: 'u8', dst, a, span });
    return dst;
  }
  out(a: Operand, b: Operand, span: Sp = null): this {
    return this.push({ op: 'out', type: 'u8', a, b, span });
  }
  aaddr(type: IrType, array: Operand, dims: number, span: Sp = null): Operand {
    const dst = this.temp();
    this.quads.push({ op: 'aaddr', type, dst, array, dims, span });
    return dst;
  }
  aload(type: IrType, a: Operand, span: Sp = null): Operand {
    const dst = this.temp();
    this.quads.push({ op: 'aload', type, dst, a, span });
    return dst;
  }
  astore(type: IrType, a: Operand, b: Operand, span: Sp = null): this {
    return this.push({ op: 'astore', type, a, b, span });
  }

  // ---- control --------------------------------------------------------
  label(label: string, span: Sp = null): this {
    return this.push({ op: 'label', label, span });
  }
  jump(label: string, span: Sp = null): this {
    return this.push({ op: 'jump', label, span });
  }
  jz(type: IrType, a: Operand, label: string, span: Sp = null): this {
    return this.push({ op: 'jz', type, a, label, span });
  }
  jnz(type: IrType, a: Operand, label: string, span: Sp = null): this {
    return this.push({ op: 'jnz', type, a, label, span });
  }
  jtable(a: Operand, labels: readonly string[], gosub = false, span: Sp = null): this {
    return this.push({ op: 'jtable', a, labels, gosub, span });
  }
  gosub(label: string, span: Sp = null): this {
    return this.push({ op: 'gosub', label, span });
  }
  retsub(span: Sp = null): this {
    return this.push({ op: 'retsub', span });
  }
  end(a: Operand = imm(0), span: Sp = null): this {
    return this.push({ op: 'end', a, span });
  }

  // ---- procedures -----------------------------------------------------
  param(type: IrType, a: Operand, span: Sp = null): this {
    return this.push({ op: 'param', type, a, span });
  }
  fparam(type: IrType, a: Operand, span: Sp = null): this {
    return this.push({ op: 'fparam', type, a, span });
  }
  /** Call a user procedure; returns the result temp, or null when `ret` is null (a SUB). */
  call(label: string, argBytes: number, ret: IrType | null = null, span: Sp = null): Operand | null {
    const dst = ret === null ? null : this.temp();
    this.quads.push({ op: 'call', label, argBytes, ret, dst, span });
    return dst;
  }
  /** Call a runtime routine; returns the result temp, or null when `ret` is null. */
  rtcall(label: string, ret: IrType | null = null, span: Sp = null): Operand | null {
    const dst = ret === null ? null : this.temp();
    this.quads.push({ op: 'rtcall', label, ret, dst, span });
    return dst;
  }
  enter(localBytes: number, span: Sp = null): this {
    return this.push({ op: 'enter', localBytes, span });
  }
  ret(type: IrType, a: Operand, label: string, span: Sp = null): this {
    return this.push({ op: 'ret', type, a, label, span });
  }
  leave(argBytes: number, convention: 'STDCALL' | 'FASTCALL' = 'STDCALL', span: Sp = null): this {
    return this.push({ op: 'leave', argBytes, convention, span });
  }

  // ---- other ----------------------------------------------------------
  /** An `asm` quad; `internal` for the lowering's own lines (no `#line`: docs/ir.md, "Internal asm"). */
  asm(lines: readonly { readonly text: string; readonly span: Span }[], span: Sp = null, internal = false): this {
    return this.push(internal ? { op: 'asm', lines, span, internal: true } : { op: 'asm', lines, span });
  }
  stmt(number: number | null, span: Span): this {
    return this.push({ op: 'stmt', number, span });
  }
  comment(text: string, span: Sp = null): this {
    return this.push({ op: 'comment', text, span });
  }
}
