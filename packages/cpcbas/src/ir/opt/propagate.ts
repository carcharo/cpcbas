/**
 * `ir-const` and `ir-copy` (L5-IR, slot 100): one forward walk over each body.
 *
 * `ir-const`: a temp defined by `load` of a constant (`imm`, `addr`, `frameaddr`) is replaced by the
 * constant in the quad that pops it, and the `load` goes; a quad whose operands are all constants
 * is folded with the checker's own rules (`checker/fold.ts`, run-time semantics: results wrap in the
 * quad's type, a zero divisor is never folded); `jz`/`jnz` on a constant become a `jump` or nothing;
 * and a `store` of a constant to a variable is remembered inside the statement, so a later read of
 * that variable in the same statement is the constant (a memory fact: it dies at every `label` and
 * `stmt` and at every quad of docs/ir.md "The rules every pass keeps" that kills memory).
 *
 * `ir-copy`: a temp defined by `load` of a variable (`global`, `frame`) is replaced by the variable
 * in the quad that pops it, when no killing quad lies between the two (the read moves later, so
 * this is the memory-fact rule: `call`, `rtcall`, `gosub`, `asm`, `poke`, `astore`, `in`, `out`,
 * `store`, `jtable` end the window). BYREF slots are left alone (the templates take them only
 * through a `load`).
 *
 * Only integer types are touched. A temp whose popper cannot take a plain operand (the element
 * address of `aload`/`astore`, the `aaddr` index temps) keeps its `load`.
 */
import { foldBinary } from '../../checker/fold.js';
import type { BinaryOp as AstBinaryOp } from '../../ast/ast.js';
import { irSize } from '../../sem/types.js';
import type { IrProgram, IrType, Operand, Quad } from '../ir.js';
import { printQuad } from '../print.js';
import {
  attachTrace,
  bitsOf,
  fieldOf,
  isIntType,
  isTemp,
  killsMemory,
  mapBodies,
  popFields,
  readType,
  typeName,
  unsignedOf,
  withField,
  wrapInt,
  type Field,
} from './util.js';
import type { IrPass, IrPassEnv } from '../../opt/index.js';

type Mode = 'const' | 'copy';

interface Entry {
  readonly o: Operand;
  readonly type: IrType;
  readonly slot: number;
  readonly mem: boolean;
  /** `param` quads emitted before the definition: a `param` of a temp is the value already pushed, in place (see `propagateBody`). */
  readonly params: number;
}

interface Fact {
  readonly where: 'global' | 'frame';
  readonly label: string;
  readonly offset: number;
  readonly size: number;
  readonly type: IrType;
  readonly value: number;
}

const BINARY_AST: Readonly<Record<string, AstBinaryOp>> = {
  add: '+',
  sub: '-',
  mul: '*',
  div: '/',
  mod: 'MOD',
  and: 'AND',
  or: 'OR',
  xor: 'XOR',
  shl: '<<',
  shr: '>>',
  eq: '=',
  ne: '<>',
  lt: '<',
  le: '<=',
  gt: '>',
  ge: '>=',
};
/** The largest offset `@v + K` is folded to: far enough for a table's fields, near enough that the assembler never wraps. */
const MAX_ADDR_OFFSET = 1024;
const COMPARES: ReadonlySet<string> = new Set(['eq', 'ne', 'lt', 'le', 'gt', 'ge']);

const isConstOperand = (o: Operand): boolean => o.k === 'imm' || o.k === 'addr' || o.k === 'frameaddr';
const immOf = (o: Operand): number | null => (o.k === 'imm' ? o.value : null);

/** Folds a quad of integer type whose inputs are all `imm`: the new `load`, or null. */
export function foldQuad(q: Quad): Quad | null {
  // `@v + K`, `@v - K`: an address with a small constant offset is one constant (a `poke` or `peek` through it still kills memory facts:
  // the pointer-store rule of docs/ir.md "Offsets outside the variable"; this pass records no fact about such an operand)
  if ((q.op === 'add' || q.op === 'sub') && q.type === 'u16' && q.dst.k === 'temp') {
    const [ad, k] = q.a.k === 'addr' && q.b.k === 'imm' ? [q.a, q.b.value] : q.op === 'add' && q.b.k === 'addr' && q.a.k === 'imm' ? [q.b, q.a.value] : [null, 0];
    if (ad !== null) {
      const u = unsignedOf(k, 'u16');
      const sk = u >= 0x8000 ? u - 0x10000 : u;
      const off = (ad.offset ?? 0) + (q.op === 'add' ? sk : -sk);
      if (Math.abs(sk) <= MAX_ADDR_OFFSET && Math.abs(off) <= MAX_ADDR_OFFSET) {
        return { op: 'load', type: 'u16', dst: q.dst, a: { k: 'addr', label: ad.label, ...(off === 0 ? {} : { offset: off }) }, span: q.span };
      }
    }
  }
  switch (q.op) {
    case 'add':
    case 'sub':
    case 'mul':
    case 'div':
    case 'mod':
    case 'and':
    case 'or':
    case 'xor':
    case 'shl':
    case 'shr':
    case 'eq':
    case 'ne':
    case 'lt':
    case 'le':
    case 'gt':
    case 'ge': {
      if (!isIntType(q.type)) return null;
      const x = immOf(q.a);
      const y = immOf(q.b);
      if (x === null || y === null || q.dst.k !== 'temp') return null;
      const t = q.type;
      const tn = typeName(t);
      const xa = wrapInt(x, t);
      // a shift count is a u8; a count of the operand's width or more is left to the template
      const yb = q.op === 'shl' || q.op === 'shr' ? wrapInt(y, 'u8') : wrapInt(y, t);
      if ((q.op === 'shl' || q.op === 'shr') && yb >= bitsOf(t)) return null;
      if ((q.op === 'div' || q.op === 'mod') && (yb === 0 || (yb === -1 && (t === 'i8' || t === 'i16' || t === 'i32')))) return null;
      const r = foldBinary(
        BINARY_AST[q.op] as AstBinaryOp,
        { type: tn, value: xa },
        { type: q.op === 'shl' || q.op === 'shr' ? 'UBYTE' : tn, value: yb },
        tn,
      );
      if (r === null || r === 'div0' || typeof r.value !== 'number') return null;
      const rt: IrType = COMPARES.has(q.op) ? 'i16' : t;
      return { op: 'load', type: rt, dst: q.dst, a: { k: 'imm', value: wrapInt(r.value, rt) }, span: q.span };
    }
    case 'neg':
    case 'not':
    case 'abs': {
      if (!isIntType(q.type) || q.a.k !== 'imm' || q.dst.k !== 'temp') return null;
      const v = wrapInt(q.a.value, q.type);
      let r: number;
      if (q.op === 'neg') r = -v;
      else if (q.op === 'not') r = ~v;
      else {
        if (v < 0 && v === -(2 ** (bitsOf(q.type) - 1))) return null; // abs of the type's minimum: the template's wrap, not ours
        r = Math.abs(v);
      }
      return { op: 'load', type: q.type, dst: q.dst, a: { k: 'imm', value: wrapInt(r, q.type) }, span: q.span };
    }
    case 'cast': {
      if (!isIntType(q.type) || !isIntType(q.from) || q.a.k !== 'imm' || q.dst.k !== 'temp') return null;
      return { op: 'load', type: q.type, dst: q.dst, a: { k: 'imm', value: wrapInt(wrapInt(q.a.value, q.from), q.type) }, span: q.span };
    }
    default:
      return null;
  }
}

function overlap(f: Fact, where: 'global' | 'frame', label: string, offset: number, size: number): boolean {
  if (f.where !== where) return false;
  if (where === 'global') return f.label === label;
  return f.offset < offset + size && offset < f.offset + f.size;
}

function propagateBody(body: readonly Quad[], mode: Mode, log: string[] | null): readonly Quad[] {
  const out: { q: Quad; dead: boolean }[] = [];
  const env = new Map<number, Entry>();
  let facts: Fact[] = [];
  let changed = false;
  // A `param` of a temp pushes nothing: the temp's own push is the argument, at its place under whatever `param`s came after it.
  // Replacing it by the operand would push the argument at the `param`, so it is allowed only when no `param` lies between.
  let params = 0;

  const dropMemEntries = (): void => {
    for (const [id, e] of env) if (e.mem) env.delete(id);
  };
  const note = (what: () => string): void => {
    changed = true;
    if (log !== null) log.push(what());
  };

  for (const orig of body) {
    let q = orig;
    if (q.op === 'label' || q.op === 'stmt') {
      env.clear();
      facts = [];
    }

    // 1. replace the temps this quad pops by what defined them
    for (const f of popFields(q) as readonly Field[]) {
      const o = fieldOf(q, f);
      if (!isTemp(o)) continue;
      const e = env.get(o.id);
      if (e === undefined) continue;
      env.delete(o.id);
      const want = readType(q, f);
      if (want === null || want !== e.type) continue;
      if (q.op === 'param' && e.params !== params) continue;
      const slot = out[e.slot] as { q: Quad; dead: boolean };
      const before = q;
      q = withField(q, f, e.o);
      slot.dead = true;
      note(() => `${e.mem ? 'copy' : 'constant'} into ${printQuad(before)}`);
    }

    // 2. fold
    if (mode === 'const') {
      const folded = foldQuad(q);
      if (folded !== null) {
        const before = q;
        note(() => `fold ${printQuad(before)} -> ${printQuad(folded)}`);
        q = folded;
      } else if ((q.op === 'jz' || q.op === 'jnz') && isIntType(q.type) && q.a.k === 'imm') {
        const zero = wrapInt(q.a.value, q.type) === 0;
        const jumps = (q.op === 'jz') === zero;
        const before = q;
        note(() => `${printQuad(before)} -> ${jumps ? 'jump' : 'nothing'}`);
        if (jumps) q = { op: 'jump', label: q.label, span: q.span };
        else continue;
      }
    }

    // 3. a read of a variable whose value is known in this statement
    if (mode === 'const' && q.op === 'load' && isIntType(q.type) && (q.a.k === 'global' || (q.a.k === 'frame' && q.a.byref !== true))) {
      const a = q.a;
      const lt = q.type;
      const f = facts.find((x) =>
        a.k === 'global' ? x.where === 'global' && x.label === a.label && x.type === lt : x.where === 'frame' && x.offset === a.offset && x.type === lt,
      );
      if (f !== undefined) {
        const folded: Quad = { op: 'load', type: q.type, dst: q.dst, a: { k: 'imm', value: f.value }, span: q.span };
        const before = q;
        note(() => `known value: ${printQuad(before)} -> ${printQuad(folded)}`);
        q = folded;
      }
    }

    // 4. kills (after this quad's own reads)
    if (killsMemory(q)) {
      dropMemEntries();
      if (q.op === 'store' && isIntType(q.type) && (q.dst.k === 'global' || (q.dst.k === 'frame' && q.dst.byref !== true))) {
        const d = q.dst;
        const size = irSize(q.type);
        const where = d.k === 'global' ? 'global' : 'frame';
        const label = d.k === 'global' ? d.label : '';
        const offset = d.k === 'frame' ? d.offset : 0;
        facts = facts.filter((x) => !overlap(x, where, label, offset, size));
        if (mode === 'const' && q.a.k === 'imm') facts.push({ where, label, offset, size, type: q.type, value: wrapInt(q.a.value, q.type) });
      } else facts = [];
    }

    // 5. a load that can be deferred into its popper
    const idx = out.length;
    out.push({ q, dead: false });
    if (q.op === 'param') params++;
    if (q.op === 'load' && q.dst.k === 'temp' && isIntType(q.type)) {
      const a = q.a;
      if (mode === 'const' && isConstOperand(a)) {
        if (a.k === 'imm' || q.type === 'u16') env.set(q.dst.id, { o: a, type: q.type, slot: idx, mem: false, params });
      } else if (mode === 'copy' && (a.k === 'global' || (a.k === 'frame' && a.byref !== true))) {
        env.set(q.dst.id, { o: a, type: q.type, slot: idx, mem: true, params });
      }
    }
  }
  if (!changed) return body;
  return out.filter((s) => !s.dead).map((s) => s.q);
}

function run(mode: Mode, name: string, ir: IrProgram, env: IrPassEnv): IrProgram {
  const log: string[] | null = env.trace ? [] : null;
  const out = mapBodies(ir, (body) => propagateBody(body, mode, log));
  return attachTrace(ir, out, name, log ?? []);
}

export const IR_CONST: IrPass = {
  name: 'ir-const',
  order: 100,
  when: (spec) => spec.irPasses,
  run: (ir, env) => run('const', 'ir-const', ir, env),
};

export const IR_COPY: IrPass = {
  name: 'ir-copy',
  order: 100,
  when: (spec) => spec.irPasses,
  run: (ir, env) => run('copy', 'ir-copy', ir, env),
};
