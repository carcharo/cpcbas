/**
 * Edits to a file's tokens. A rule never rewrites text in place: it records an operation on a token
 * (replace, remove, insert before or after) and the file is rendered once at the end. An operation may be a
 * function, evaluated at render time, so a rewrite can copy the text of a neighbouring expression after that
 * expression's own rewrites (`h$(CODE x TO 5)`). A token is replaced at most once: rules never match their
 * own output.
 */
import type { Tok } from './tokenize.js';

export type Piece = string | (() => string);

const text = (p: Piece): string => (typeof p === 'string' ? p : p());

export class Ops {
  private readonly rep = new Map<number, Piece>();
  private readonly del = new Set<number>();
  private readonly before = new Map<number, Piece[]>();
  private readonly after = new Map<number, Piece[]>();
  /** Output offset of each token's own text (after its `before` pieces); filled by {@link renderAll}. */
  outStart: number[] = [];

  constructor(readonly toks: readonly Tok[]) {}

  /** True when the token already has a replacement or is removed. */
  taken(i: number): boolean {
    return this.rep.has(i) || this.del.has(i);
  }

  replace(i: number, piece: Piece): void {
    if (this.taken(i)) return;
    this.rep.set(i, piece);
  }

  remove(i: number): void {
    if (this.rep.has(i)) this.rep.delete(i);
    this.del.add(i);
  }

  insertBefore(i: number, piece: Piece): void {
    const list = this.before.get(i);
    if (list) list.unshift(piece);
    else this.before.set(i, [piece]);
  }

  insertAfter(i: number, piece: Piece): void {
    const list = this.after.get(i);
    if (list) list.push(piece);
    else this.after.set(i, [piece]);
  }

  /**
   * The tokens `[a, b)` as they will be written. `limit` (from {@link mark}) leaves out what was inserted
   * before the first and after the last token since the mark: a rewrite's message shows its own text only.
   */
  render(a: number, b: number, track?: number[], limit?: { beforeA: number; afterB: number }): string {
    let out = '';
    for (let i = a; i < b; i++) {
      const bef = this.before.get(i) ?? [];
      const skipB = limit !== undefined && i === a ? bef.length - limit.beforeA : 0;
      for (const p of bef.slice(skipB)) out += text(p);
      if (track) track[i] = out.length;
      if (!this.del.has(i)) {
        const r = this.rep.get(i);
        out += r !== undefined ? text(r) : (this.toks[i] as Tok).text;
      }
      const aft = this.after.get(i) ?? [];
      const keep = limit !== undefined && i === b - 1 ? limit.afterB : aft.length;
      for (const p of aft.slice(0, keep)) out += text(p);
    }
    return out;
  }

  /** What is inserted around `a` and `b` right now. */
  mark(a: number, b: number): { beforeA: number; afterB: number } {
    return { beforeA: (this.before.get(a) ?? []).length, afterB: (this.after.get(b) ?? []).length };
  }

  /** The whole file; `outStart` maps tokens to output offsets. */
  renderAll(): string {
    const track: number[] = [];
    const s = this.render(0, this.toks.length, track);
    this.outStart = track;
    return s;
  }

  /** Maps an offset of the rendered output back to an offset of the input. */
  toInput(outOffset: number): number {
    const starts = this.outStart;
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((starts[mid] as number) <= outOffset) lo = mid;
      else hi = mid - 1;
    }
    const tok = this.toks[lo];
    if (tok === undefined) return 0;
    const delta = outOffset - (starts[lo] as number);
    return this.rep.has(lo) || this.del.has(lo) ? tok.start : tok.start + Math.min(delta, Math.max(0, tok.end - tok.start - 1));
  }
}
