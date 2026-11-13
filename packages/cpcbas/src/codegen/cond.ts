/**
 * Conditions (L5-TEMPS; docs/ir.md "The template-operand protocol", "Conditions"): the comparisons, `not`, `and` and `or` that a
 * `jz`/`jnz` tests, turned into branches.
 *
 * Locomotive's AND, OR and NOT are bitwise and a comparison is -1 or 0, so on conditions they are the logical operators. The IR of
 * `IF c1 AND c2 THEN` is `c1 ... cmp t1 / c2 ... cmp t2 / and t3 = t1, t2 / jz t3, L`: both comparisons make a boolean on the stack,
 * the `and` combines them, `jz` tests the result. This module finds such a tree behind a `jz`/`jnz` and plans the branches
 * instead: for `jz L`, "c1 false: to L; c2 false: to L" for AND, "c1 true: to S; c2 false: to L; S:" for OR, and the mirror for
 * `jnz` and for NOT. The comparisons are then the compare-and-branch templates (codegen/types.ts `CompareJumpTable`); no boolean is
 * made. The plan only says where each branch goes; the driver emits the quads.
 *
 * Short-circuiting skips the code of c2 when c1 decides, so it is allowed only when every quad of c2 is pure (docs/ir.md): integer
 * `load`, arithmetic and bitwise operations, comparisons, integer casts, `peek`, `aaddr` and `aload`; never `div`, `mod`, anything
 * on `f`, `f16` or `str`, `call`, `rtcall`, `param`, `fparam`, `asm`, `in`, `out`, `poke`, `store`. c1 runs whatever happens.
 */

import type { Operand, Quad } from '../ir/ir.js';

/** Where a fused comparison branches. */
export interface LeafJump {
  readonly when: 'true' | 'false';
  readonly label: string;
}

/**
 * One step of a condition evaluated as 8-bit booleans (L5-CG; the optimised template styles). Each comparison leaves 0 or -1 in A,
 * a left operand waits on the stack as one `push af` (the call that follows may clobber every register), `and`/`or` pop it into B
 * and combine, `not` is `cpl`, and the `jz`/`jnz` that tests the tree is `or a / jp z|nz`. Every operand still runs, so impure ones
 * (a FUNCTION call, a division, a REAL) are allowed: nothing is short-circuited.
 */
export type BoolStep =
  /** A comparison: its template with the result left in A. `raw`: only zero or non-zero matters (an OR chain of `<> 0` tests), so the value tested is left as it is. `push`: it is the left operand of an `and`/`or`. */
  | { readonly kind: 'leaf'; readonly raw: boolean; readonly push: boolean }
  | { readonly kind: 'and' | 'or' | 'not'; readonly push: boolean }
  | { readonly kind: 'root'; readonly when: 'true' | 'false'; readonly label: string };

/** What the driver does with the quads of the trees that were planned. */
export interface CondPlan {
  /** Quads of the trees that are evaluated as 8-bit booleans (the root `jz`/`jnz`, the comparisons and the `and`/`or`/`not`). */
  readonly bool: ReadonlyMap<number, BoolStep>;
  /** Comparison quads (by index) that branch instead of making a boolean: they are emitted as compare-and-branch. */
  readonly leaf: ReadonlyMap<number, LeafJump>;
  /** Quads that are not emitted: the `jz`/`jnz`, and the `and`, `or`, `not` of a tree. */
  readonly skip: ReadonlySet<number>;
  /** A label line emitted where an `and`/`or` quad was (the end of the short-circuited operand). */
  readonly labelAt: ReadonlyMap<number, string>;
}

const COMPARES: ReadonlySet<string> = new Set(['eq', 'ne', 'lt', 'le', 'gt', 'ge']);
const INTS: ReadonlySet<string> = new Set(['u8', 'i8', 'u16', 'i16', 'u32', 'i32']);
const PURE_BINARY: ReadonlySet<string> = new Set(['add', 'sub', 'mul', 'and', 'or', 'xor', 'shl', 'shr']);
/** Quads that may appear in the operands of a condition whose temps the backward scan can account for. */
const SCANNABLE: ReadonlySet<string> = new Set(['load', 'neg', 'not', 'abs', 'cast', 'peek', 'aaddr', 'aload', 'in', 'call', 'rtcall', 'param', 'fparam', ...PURE_BINARY, ...COMPARES, 'div', 'mod', 'pow', 'concat']);

type Opd = Operand | undefined;
const operand = (q: Quad, key: 'a' | 'b' | 'dst'): Opd => (q as unknown as Partial<Record<string, Opd>>)[key];
const tempId = (o: Opd): number | null => (o?.k === 'temp' ? o.id : null);
const defines = (q: Quad): number | null => tempId(operand(q, 'dst'));
const typeOf = (q: Quad): string | undefined => (q as { type?: string }).type;

/** How many stack temps a quad consumes: its temp operands, and the index temps of an `aaddr`. */
function pops(q: Quad): number {
  return (tempId(operand(q, 'a')) !== null ? 1 : 0) + (tempId(operand(q, 'b')) !== null ? 1 : 0) + (q.op === 'aaddr' ? q.dims : 0);
}

function pure(q: Quad): boolean {
  const t = typeOf(q);
  if (q.op === 'cast') return INTS.has(q.from) && INTS.has(q.type);
  if (t === undefined || !INTS.has(t)) return false;
  if (q.op === 'load' || q.op === 'neg' || q.op === 'not' || q.op === 'peek' || q.op === 'aload' || q.op === 'aaddr') return true;
  return PURE_BINARY.has(q.op) || COMPARES.has(q.op);
}

type Node =
  | { readonly kind: 'leaf'; readonly idx: number; readonly start: number }
  | { readonly kind: 'not'; readonly idx: number; readonly start: number; readonly child: Node }
  | { readonly kind: 'and' | 'or'; readonly idx: number; readonly start: number; readonly left: Node; readonly right: Node };

/**
 * The first quad of the expression whose last quad is `k`: scanning back, each quad that makes a temp pays for one needed, and
 * each temp it consumes is needed in turn. null when the scan meets a quad it cannot account for.
 */
function expressionStart(quads: readonly Quad[], k: number): number | null {
  let need = pops(quads[k] as Quad);
  let j = k;
  for (;;) {
    while (need > 0) {
      j--;
      if (j < 0) return null;
      const q = quads[j] as Quad;
      if (!SCANNABLE.has(q.op)) return null;
      if (defines(q) !== null) need--;
      need += pops(q);
      if (need < 0) return null;
    }
    // A call at the head of the expression: its arguments are the `param`/`fparam` quads right before it (they define no temp, so the
    // scan above does not meet them), and the temps they consume are produced further back.
    const head = quads[j] as Quad;
    if (head.op !== 'call' && head.op !== 'rtcall') return j;
    let absorbed = false;
    while (j > 0 && ((quads[j - 1] as Quad).op === 'param' || (quads[j - 1] as Quad).op === 'fparam')) {
      j--;
      need += pops(quads[j] as Quad);
      absorbed = true;
    }
    if (need === 0 || !absorbed) return j;
  }
}

/** Options of {@link planConditions}. */
export interface PlanOptions {
  /** A tree that cannot be branched (an operand is not pure) is evaluated as 8-bit booleans instead of 16-bit ones on the stack. */
  readonly bool8?: boolean;
}

/** Plans the branches of every condition tree that a `jz`/`jnz` tests, for the comparisons `hasKey` accepts (`cmpjump:<op>:<type>`). */
export function planConditions(quads: readonly Quad[], hasKey: (key: string) => boolean, newLabel: () => string, options: PlanOptions = {}): CondPlan {
  const bool = new Map<number, BoolStep>();
  const leaf = new Map<number, LeafJump>();
  const skip = new Set<number>();
  const labelAt = new Map<number, string>();

  const parse = (i: number, wantId: number, strict = true): Node | null => {
    if (i < 0) return null;
    const q = quads[i] as Quad;
    if (defines(q) !== wantId) return null;
    if (COMPARES.has(q.op)) {
      const t = typeOf(q) as string;
      if (strict ? !hasKey(`cmpjump:${q.op}:${t}`) : !INTS.has(t)) return null;
      const start = expressionStart(quads, i);
      return start === null ? null : { kind: 'leaf', idx: i, start };
    }
    if (q.op === 'not' && q.type === 'i16') {
      const a = tempId(q.a);
      const child = a === null ? null : parse(i - 1, a, strict);
      return child === null ? null : { kind: 'not', idx: i, start: child.start, child };
    }
    if ((q.op === 'and' || q.op === 'or') && q.type === 'i16') {
      const a = tempId(q.a);
      const b = tempId(q.b);
      if (a === null || b === null || a === b) return null;
      const right = parse(i - 1, b, strict);
      if (right === null) return null;
      const left = parse(right.start - 1, a, strict);
      if (left === null) return null;
      if (strict) for (let k = right.start; k < i; k++) if (!pure(quads[k] as Quad)) return null;
      return { kind: q.op, idx: i, start: left.start, left, right };
    }
    return null;
  };

  // Branches of node `n`: to `target` when its value is `jumpIf`, falling through otherwise.
  const emit = (n: Node, jumpIf: boolean, target: string): void => {
    switch (n.kind) {
      case 'leaf':
        leaf.set(n.idx, { when: jumpIf ? 'true' : 'false', label: target });
        return;
      case 'not':
        skip.add(n.idx);
        emit(n.child, !jumpIf, target);
        return;
      case 'and':
      case 'or': {
        skip.add(n.idx);
        // AND is false when either is false, OR true when either is true: that case jumps to `target` from both operands
        if ((n.kind === 'and') !== jumpIf) {
          emit(n.left, jumpIf, target);
          emit(n.right, jumpIf, target);
          return;
        }
        // the other case: the first operand deciding the opposite skips the second, to the end of the node
        const end = newLabel();
        labelAt.set(n.idx, end);
        emit(n.left, !jumpIf, end);
        emit(n.right, jumpIf, target);
      }
    }
  };

  // The 8-bit boolean form of a tree: `push` marks the node that is the left operand of an `and`/`or`; `onlyOr` that every node above is an OR.
  const emit8 = (n: Node, push: boolean, onlyOr: boolean): void => {
    switch (n.kind) {
      case 'leaf': {
        const q = quads[n.idx] as Quad;
        const raw =
          onlyOr && q.op === 'ne' && q.b.k === 'imm' && q.b.value === 0 && (q.type === 'u8' || q.type === 'i8' || q.type === 'u16' || q.type === 'i16');
        bool.set(n.idx, { kind: 'leaf', raw, push });
        return;
      }
      case 'not':
        emit8(n.child, false, false);
        bool.set(n.idx, { kind: 'not', push });
        return;
      case 'and':
      case 'or':
        emit8(n.left, true, onlyOr && n.kind === 'or');
        emit8(n.right, false, onlyOr && n.kind === 'or');
        bool.set(n.idx, { kind: n.kind, push });
    }
  };

  quads.forEach((q, j) => {
    if (q.op !== 'jz' && q.op !== 'jnz') return;
    const t = tempId(q.a);
    if (t === null) return;
    const root = parse(j - 1, t);
    if (root === null) {
      if (options.bool8 !== true) return;
      const loose = parse(j - 1, t, false);
      if (loose === null) return;
      emit8(loose, false, true);
      bool.set(j, { kind: 'root', when: q.op === 'jnz' ? 'true' : 'false', label: q.label });
      return;
    }
    skip.add(j);
    emit(root, q.op === 'jnz', q.label);
  });
  return { leaf, skip, labelAt, bool };
}
