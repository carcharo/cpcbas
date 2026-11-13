/**
 * `ir-strength` (L5-IR, slot 300): the cheaper equivalents. Integer types only, and every rewrite
 * keeps the type's wrap rule (arithmetic is modulo 2^bits, so these identities hold for signed and
 * unsigned alike; `div` and `mod` by a power of two are rewritten for unsigned types only, because a
 * signed quotient truncates towards zero and a signed remainder takes the dividend's sign).
 *
 * - `x + 0`, `x - 0`, `x * 1`, `x / 1`, `x OR 0`, `x XOR 0`, `x AND -1`, `x << 0`, `x >> 0`: the quad goes (a temp
 *   operand takes its place; a variable is read by a `load`, so that a read keeps its place).
 * - `x * 0`, `x AND 0` of a variable or constant: the constant 0.
 * - `x * 2^n` becomes `x << n` (n up to 4: past that the shift loop is slower than `__MUL16_FAST`);
 *   `x / 2^n` of an unsigned type becomes `x >> n`, `x MOD 2^n` of an unsigned type `x AND (2^n - 1)`.
 * - `(x + 4) - 5`: two adds or subtracts of constants in a row are one.
 * - A comparison with 0 that only a `jz`/`jnz` reads: the `jz`/`jnz` tests the value itself.
 * - `jz`/`jnz` over a `stmt` and a `jump` (the shape of `IF c THEN GOTO L`) branches to `L` directly; the `stmt`
 *   quad stays where the fall-through starts. Only when the `stmt` is the whole statement boundary (no
 *   `ON BREAK STOP`, which gives it code, and no event poll between it and the `jump`).
 */
import type { BinaryOp, CompareOp, IrProgram, Operand, Quad } from '../ir.js';
import { printQuad } from '../print.js';
import { attachTrace, bitsOf, isIntType, isSignedType, isTemp, log2Exact, mapBodies, unsignedOf, wrapInt } from './util.js';
import type { IrPass, IrPassEnv } from '../../opt/index.js';

/** Largest `n` for which `x * 2^n` becomes a shift. */
const MAX_SHL = 4;

type Bin = Extract<Quad, { readonly op: BinaryOp }>;
const BIN_OPS: ReadonlySet<string> = new Set(['add', 'sub', 'mul', 'div', 'mod', 'and', 'or', 'xor', 'shl', 'shr']);
const isBin = (q: Quad): q is Bin => BIN_OPS.has(q.op);

const immValue = (o: Operand): number | null => (o.k === 'imm' ? o.value : null);

/** What an identity leaves: the operand that survives, or null when the quad is not an identity. */
function identityOperand(q: Bin): Operand | null {
  if (!isIntType(q.type)) return null;
  const ua = q.a.k === 'imm' ? unsignedOf(q.a.value, q.type) : null;
  const ub = q.b.k === 'imm' ? unsignedOf(q.b.value, q.type) : null;
  const ones = 2 ** bitsOf(q.type) - 1;
  switch (q.op) {
    case 'add':
    case 'or':
    case 'xor':
      if (ub === 0) return q.a;
      if (ua === 0) return q.b;
      return null;
    case 'sub':
      return ub === 0 ? q.a : null;
    case 'mul':
      if (ub === 1) return q.a;
      if (ua === 1) return q.b;
      return null;
    case 'div':
      return ub === 1 ? q.a : null;
    case 'and':
      if (ub === ones) return q.a;
      if (ua === ones) return q.b;
      return null;
    case 'shl':
    case 'shr':
      return q.b.k === 'imm' && unsignedOf(q.b.value, 'u8') === 0 ? q.a : null;
    default:
      return null;
  }
}

/** A quad that is the constant 0, when one operand is the constant 0 and the other a non-temp (nothing to pop). */
function zeroed(q: Bin): boolean {
  if (!isIntType(q.type) || (q.op !== 'mul' && q.op !== 'and')) return false;
  const za = q.a.k === 'imm' && unsignedOf(q.a.value, q.type) === 0;
  const zb = q.b.k === 'imm' && unsignedOf(q.b.value, q.type) === 0;
  return (za && !isTemp(q.b)) || (zb && !isTemp(q.a));
}

/** The signed amount `k` such that this add/sub of a constant is `x + k` (wrapped), or null. */
function addendOf(q: Quad): { readonly x: Operand; readonly k: number } | null {
  if ((q.op !== 'add' && q.op !== 'sub') || !isIntType(q.type)) return null;
  if (q.b.k === 'imm') return { x: q.a, k: q.op === 'add' ? q.b.value : -q.b.value };
  if (q.op === 'add' && q.a.k === 'imm') return { x: q.b, k: q.a.value };
  return null;
}

function strengthBody(body: readonly Quad[], checkBreak: boolean, log: string[] | null): readonly Quad[] {
  const out: Quad[] = [];
  const alias = new Map<number, Operand>();
  let changed = false;
  const note = (from: Quad, to: string): void => {
    changed = true;
    if (log !== null) log.push(`${printQuad(from)} -> ${to}`);
  };
  const sub = (o: Operand): Operand => (isTemp(o) ? (alias.get(o.id) ?? o) : o);
  /** Emits `dst = x` where the quad used to compute it. */
  const emitCopy = (q: Bin, x: Operand): void => {
    if (isTemp(x) && q.dst.k === 'temp') alias.set(q.dst.id, x);
    else out.push({ op: 'load', type: q.type, dst: q.dst, a: x, span: q.span });
  };

  for (const orig of body) {
    let q = orig;
    // temps renamed by an earlier dropped quad
    const f = q as unknown as { a?: Operand; b?: Operand };
    if ((f.a !== undefined && isTemp(f.a) && alias.has(f.a.id)) || (f.b !== undefined && isTemp(f.b) && alias.has(f.b.id))) {
      q = { ...q, ...(f.a !== undefined ? { a: sub(f.a) } : {}), ...(f.b !== undefined ? { b: sub(f.b) } : {}) } as Quad;
    }

    if (isBin(q) && isIntType(q.type)) {
      const t = q.type;
      // 1. identities
      const id = identityOperand(q);
      if (id !== null) {
        note(q, isTemp(id) ? 'dropped' : 'a plain load');
        emitCopy(q, id);
        continue;
      }
      if (zeroed(q)) {
        note(q, 'constant 0');
        out.push({ op: 'load', type: t, dst: q.dst, a: { k: 'imm', value: 0 }, span: q.span });
        continue;
      }
      // 2. reassociation: (x + c1) +/- c2 where the first is the quad just before
      const here = addendOf(q);
      const prev = out[out.length - 1];
      if (here !== null && isTemp(here.x) && prev !== undefined && (prev.op === 'add' || prev.op === 'sub')) {
        const before = addendOf(prev);
        if (before !== null && prev.type === t && prev.dst.k === 'temp' && prev.dst.id === here.x.id) {
          const k = wrapInt(before.k + here.k, t);
          const sk = unsignedOf(k, t) >= 2 ** (bitsOf(t) - 1) ? unsignedOf(k, t) - 2 ** bitsOf(t) : unsignedOf(k, t); // the amount as a signed number
          const merged: Quad =
            sk < 0 && sk !== -(2 ** (bitsOf(t) - 1))
              ? { op: 'sub', type: t, dst: q.dst, a: before.x, b: { k: 'imm', value: wrapInt(-sk, t) }, span: q.span }
              : { op: 'add', type: t, dst: q.dst, a: before.x, b: { k: 'imm', value: k }, span: q.span };
          note(q, `merged with the quad before into ${printQuad(merged)}`);
          out.pop();
          // the merged quad may itself be an identity (x + 4 - 4)
          if (merged.op === 'add' && unsignedOf(k, t) === 0) emitCopy(merged as Bin, before.x);
          else out.push(merged);
          continue;
        }
      }
      // 3. powers of two
      const bv = immValue(q.b);
      const av = immValue(q.a);
      if (q.op === 'mul') {
        // `c * x` is `x * c`: only when exactly one side is the constant
        const c = bv !== null && av === null ? bv : av !== null && bv === null ? av : null;
        const x = bv !== null && av === null ? q.a : q.b;
        const n = c === null ? -1 : log2Exact(unsignedOf(c, t));
        if (n >= 1 && n <= MAX_SHL && n < bitsOf(t)) {
          const r: Quad = { op: 'shl', type: t, dst: q.dst, a: x, b: { k: 'imm', value: n }, span: q.span };
          note(q, printQuad(r));
          out.push(r);
          continue;
        }
      } else if ((q.op === 'div' || q.op === 'mod') && !isSignedType(t) && bv !== null) {
        const n = log2Exact(unsignedOf(bv, t));
        if (n >= 1 && n < bitsOf(t)) {
          const r: Quad =
            q.op === 'div'
              ? { op: 'shr', type: t, dst: q.dst, a: q.a, b: { k: 'imm', value: n }, span: q.span }
              : { op: 'and', type: t, dst: q.dst, a: q.a, b: { k: 'imm', value: 2 ** n - 1 }, span: q.span };
          note(q, printQuad(r));
          out.push(r);
          continue;
        }
      }
    }

    // 4. a comparison with 0 that a jz/jnz reads: test the value
    if ((q.op === 'jz' || q.op === 'jnz') && isTemp(q.a)) {
      const prev = out[out.length - 1];
      if (prev !== undefined && isCompare(prev) && isIntType(prev.type) && prev.dst.k === 'temp' && prev.dst.id === q.a.id) {
        const x = zeroTested(prev);
        if (x !== null) {
          // truth of the comparison: x != 0 (`ne`, unsigned `gt`) or x == 0 (`eq`, unsigned `le`)
          const nonZero = x.nonZero;
          const jumpsOnZero = (q.op === 'jz') === nonZero; // jz on "x != 0" jumps when x == 0
          const r: Quad = { op: jumpsOnZero ? 'jz' : 'jnz', type: prev.type, a: x.operand, label: q.label, span: q.span };
          note(q, `${printQuad(r)} (the comparison with 0 goes)`);
          out.pop();
          out.push(r);
          continue;
        }
      }
    }
    out.push(q);
  }

  // 5. IF c THEN GOTO L: jz/jnz L1 ; stmt ; jump L ; L1:  ->  jnz/jz L ; stmt ; L1:
  let res = out;
  if (!checkBreak) {
    const r: Quad[] = [];
    for (let i = 0; i < out.length; i++) {
      const j = out[i] as Quad;
      const s = out[i + 1];
      const g = out[i + 2];
      const l = out[i + 3];
      if ((j.op === 'jz' || j.op === 'jnz') && s !== undefined && s.op === 'stmt' && g !== undefined && g.op === 'jump' && l !== undefined && l.op === 'label' && l.label === j.label && g.label !== j.label) {
        const flipped: Quad = { ...j, op: j.op === 'jz' ? 'jnz' : 'jz', label: g.label };
        note(j, `${printQuad(flipped)} (the jump over ${printQuad(g)} goes)`);
        r.push(flipped, s);
        i += 2;
        continue;
      }
      r.push(j);
    }
    res = r;
  }
  return changed ? res : body;
}

type Cmp = Extract<Quad, { readonly op: CompareOp }>;
const isCompare = (q: Quad): q is Cmp => q.op === 'eq' || q.op === 'ne' || q.op === 'lt' || q.op === 'le' || q.op === 'gt' || q.op === 'ge';

/** For a comparison of a value with the constant 0: the value, and whether the comparison is true when it is non-zero. */
function zeroTested(c: Cmp): { readonly operand: Operand; readonly nonZero: boolean } | null {
  const zb = c.b.k === 'imm' && wrapInt(c.b.value, c.type) === 0;
  const za = c.a.k === 'imm' && wrapInt(c.a.value, c.type) === 0;
  if (zb === za) return null; // neither, or both (folded elsewhere)
  const x = zb ? c.a : c.b;
  const unsigned = !isSignedType(c.type);
  // with the constant on the right: x op 0; on the left: 0 op x, the mirror image
  let op: Cmp['op'] = c.op;
  if (za) op = ({ eq: 'eq', ne: 'ne', lt: 'gt', le: 'ge', gt: 'lt', ge: 'le' } as const)[c.op];
  if (op === 'ne') return { operand: x, nonZero: true };
  if (op === 'eq') return { operand: x, nonZero: false };
  if (unsigned && op === 'gt') return { operand: x, nonZero: true };
  if (unsigned && op === 'le') return { operand: x, nonZero: false };
  return null;
}

export const IR_STRENGTH: IrPass = {
  name: 'ir-strength',
  order: 300,
  when: (spec) => spec.irPasses,
  run(ir: IrProgram, env: IrPassEnv): IrProgram {
    const log: string[] | null = env.trace ? [] : null;
    const out = mapBodies(ir, (body) => strengthBody(body, ir.checkBreak === true, log));
    return attachTrace(ir, out, 'ir-strength', log ?? []);
  },
};

