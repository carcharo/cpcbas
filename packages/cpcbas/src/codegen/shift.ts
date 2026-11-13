/**
 * Constant shifts of the optimised template styles (L5-CG, follow-up 18). The operand is already in A, HL or DEHL; the
 * count is a constant. A shift by a whole byte or word is a register move, the remaining bits are unrolled steps or a
 * `djnz` loop, and an 8-bit shift can rotate and mask (`rrca` x n, `and`): each way is built, costed with the
 * assembler's own table (`opt/z80size.ts`) and the cheapest is taken: fewest bytes (then T-states) for `short`
 * (-Os), the least `T-states + 8 x bytes` for `fast` (-O2), so a long unrolled run does not win by a hair of speed.
 *
 * The results are exactly the one-bit-at-a-time loops' (a count beyond the width gives 0, or the sign fill for an
 * arithmetic right shift); `int.test.ts` checks every width, direction and count against the model on the simulator.
 */

import { instructionCost } from '../opt/z80size.js';

type Dir = 'shl' | 'shr';

/** A way to do it: its lines (a loop label is `@L`, replaced by the caller), bytes and T-states. */
interface Cand {
  readonly lines: readonly string[];
  readonly bytes: number;
  readonly t: number;
}

const I = (s: string): string => `\t${s}`;
const EMPTY: Cand = { lines: [], bytes: 0, t: 0 };

function costOf(lines: readonly string[]): Cand {
  let bytes = 0;
  let t = 0;
  for (const l of lines) {
    const c = instructionCost(l);
    if (c === null) throw new Error(`shift.ts: cannot cost ${l}`);
    bytes += c.bytes;
    t += c.t;
  }
  return { lines: lines.map(I), bytes, t };
}

const seq = (...parts: readonly Cand[]): Cand => ({ lines: parts.flatMap((p) => p.lines), bytes: parts.reduce((n, p) => n + p.bytes, 0), t: parts.reduce((n, p) => n + p.t, 0) });
const one = (...lines: string[]): Cand => costOf(lines);
const times = (step: readonly string[], n: number): Cand => costOf(Array.from({ length: n }, () => step).flat());

/** `ld b, n` / loop / steps / `djnz`: the steps are written once and run n times. */
function loop(step: readonly string[], n: number): Cand {
  const body = costOf(step);
  const head = costOf([`ld b, ${n}`]);
  const dj = costOf(['djnz @L']);
  return { lines: [...head.lines, '@L:', ...body.lines, ...dj.lines], bytes: head.bytes + body.bytes + dj.bytes, t: head.t + n * body.t + (n - 1) * dj.t + 8 };
}

/** The ways to run `step` n times (n >= 1). */
const repeat = (step: readonly string[], n: number): Cand[] => (n === 1 ? [times(step, 1)] : [times(step, n), loop(step, n)]);

/** The shifts of A by `k` (0..7), and of the whole range: 8 and above is 0, or the sign fill. */
function a8(dir: Dir, signed: boolean, k: number): Cand[] {
  if (k === 0) return [EMPTY];
  if (k >= 8) return [dir === 'shr' && signed ? one('add a, a', 'sbc a, a') : one('xor a')];
  if (dir === 'shl') {
    const mask = (255 << k) & 255;
    return [...repeat(['add a, a'], k), seq(times(['rrca'], 8 - k), one(`and ${mask}`))];
  }
  if (signed) return repeat(['sra a'], k);
  const mask = 255 >> k;
  return [...repeat(['srl a'], k), seq(times(['rrca'], k), one(`and ${mask}`)), seq(times(['rlca'], 8 - k), one(`and ${mask}`))];
}

/** The shifts of HL by `k` (0..15 and beyond). */
function hl16(dir: Dir, signed: boolean, k: number): Cand[] {
  if (k === 0) return [EMPTY];
  if (k >= 16) return [dir === 'shr' && signed ? one('ld a, h', 'add a, a', 'sbc a, a', 'ld h, a', 'ld l, a') : one('ld hl, 0')];
  const out: Cand[] = [];
  if (k < 8) {
    const step = dir === 'shl' ? ['add hl, hl'] : [signed ? 'sra h' : 'srl h', 'rr l'];
    return repeat(step, k);
  }
  const j = k - 8;
  if (dir === 'shl') {
    const move = one('ld h, l', 'ld l, 0');
    if (j === 0) out.push(move);
    else {
      out.push(...repeat(['add hl, hl'], j).map((c) => seq(move, c)), ...repeat(['sla h'], j).map((c) => seq(move, c)));
      for (const c of a8('shl', false, j)) out.push(seq(one('ld a, l'), c, one('ld h, a', 'ld l, 0')));
    }
    return out;
  }
  if (!signed) {
    const move = one('ld l, h', 'ld h, 0');
    if (j === 0) out.push(move);
    else {
      out.push(...repeat(['srl l'], j).map((c) => seq(move, c)));
      for (const c of a8('shr', false, j)) out.push(seq(one('ld a, h'), c, one('ld l, a', 'ld h, 0')));
    }
    return out;
  }
  const move = one('ld a, h', 'ld l, a', 'add a, a', 'sbc a, a', 'ld h, a');
  if (j === 0) out.push(move);
  else {
    out.push(...repeat(['sra l'], j).map((c) => seq(move, c)));
    for (const c of a8('shr', true, j)) out.push(seq(one('ld a, h'), c, one('ld l, a', 'ld a, h', 'add a, a', 'sbc a, a', 'ld h, a')));
  }
  return out;
}

/** The shifts of DEHL by `k`. */
function dehl32(dir: Dir, signed: boolean, k: number): Cand[] {
  if (k === 0) return [EMPTY];
  if (k >= 32) return [dir === 'shr' && signed ? one('ld a, d', 'add a, a', 'sbc a, a', 'ld l, a', 'ld h, a', 'ld e, a', 'ld d, a') : one('ld hl, 0', 'ld d, h', 'ld e, l')];
  if (k >= 16) {
    const w = k - 16;
    if (dir === 'shl') return hl16('shl', false, w).map((c) => seq(c, one('ex de, hl', 'ld hl, 0')));
    const tail = signed ? one('ld a, h', 'add a, a', 'sbc a, a', 'ld d, a', 'ld e, a') : one('ld de, 0');
    return hl16('shr', signed, w).map((c) => seq(one('ex de, hl'), c, tail));
  }
  const bitStep = dir === 'shl' ? ['add hl, hl', 'rl e', 'rl d'] : [signed ? 'sra d' : 'srl d', 'rr e', 'rr h', 'rr l'];
  if (k < 8) return repeat(bitStep, k);
  const j = k - 8;
  const move =
    dir === 'shl'
      ? one('ld d, e', 'ld e, h', 'ld h, l', 'ld l, 0')
      : signed
        ? one('ld l, h', 'ld h, e', 'ld e, d', 'ld a, d', 'add a, a', 'sbc a, a', 'ld d, a')
        : one('ld l, h', 'ld h, e', 'ld e, d', 'ld d, 0');
  return j === 0 ? [move] : repeat(bitStep, j).map((c) => seq(move, c));
}

/** The lines (and bytes) of the best way to shift by the constant `count` (1 or more) a value of `width` bits in A, HL or DEHL. */
export function constantShift(width: 8 | 16 | 32, dir: Dir, signed: boolean, count: number, style: 'fast' | 'short', newLabel: () => string): string[] {
  const k = Math.min(count, width);
  const cands = width === 8 ? a8(dir, signed, k) : width === 16 ? hl16(dir, signed, k) : dehl32(dir, signed, k);
  const score = (c: Cand): number => (style === 'short' ? c.bytes * 1000 + c.t : c.t + 8 * c.bytes);
  let best = cands[0] as Cand;
  for (const c of cands) if (score(c) < score(best)) best = c;
  if (!best.lines.includes('@L:')) return [...best.lines];
  const label = newLabel();
  return best.lines.map((l) => l.replace('@L', label));
}
