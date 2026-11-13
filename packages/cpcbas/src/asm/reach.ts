/**
 * Reachability over preprocessed asm lines (L5-STRIP): which chunks of the runtime and library region nothing reachable names.
 *
 * A chunk is the run of lines from one global label to the next. It can be dropped only when:
 * - none of its labels is named by reachable code or data (the user region, every `EQU`, the head of the region, and the
 *   chunks that are themselves kept);
 * - the chunk before it, when that is kept, does not fall through into it (it ends in an unconditional `ret`, `reti`, `retn`,
 *   `jp` or `jr`, and does not end in data followed by more data: a table can be read across the label of the next one, also
 *   when it sits after the last `ret` of a routine);
 * - no `EQU` arithmetic names its labels (an `EQU` is always kept, and everything it names is a root).
 *
 * A chunk with a `DEFS` whose count is an expression (alignment padding) is never dropped.
 *
 * What the analysis cannot see is code entered at a computed offset from a label (`ld de, __EV_TICK0` then `+ 4 x t`): the
 * library must not put a global label inside such a run, or the entries after it are dropped (R18: lib/loco/event.asm's
 * timers 1-3 were). A label that only documents an entry point there is a comment instead.
 *
 * Lines that shape the layout or the scopes are never dropped: `EQU` outside a `PROC`, `PROC`, `ENDP`, `ALIGN`, `NAMESPACE` and
 * `push`/`pop namespace`, `END` and `#` lines. When anything is in doubt (a line that does not lex, a continuation line, an
 * `ORG` or `INCBIN` in the region) nothing is dropped: the answer is "keep".
 *
 * Names are compared by their key: without the leading dot and the `core.` namespace, so `.core.__PRINT` and `__PRINT` are one
 * name. Two chunks with the same key are both kept when either is named (conservative). Labels declared `LOCAL` in a `PROC`
 * belong to that chunk and are not exported.
 */

import { lexLine, type LexError, type Tok } from './lexer.js';

/** Half-open ranges `[from, to)` of line indices. */
export type LineRanges = ReadonlyArray<readonly [number, number]>;

export interface ReachResult {
  /** The lines to drop, as ranges of indices into the input. Empty when nothing is dropped or when in doubt. */
  readonly drop: LineRanges;
  /** Chunks found (the head counted), and the labels of each dropped chunk (for tests and `--stats`). */
  readonly chunks: number;
  readonly dropped: ReadonlyArray<{ readonly labels: readonly string[]; readonly lines: number; readonly ranges: LineRanges }>;
}

const NOTHING: ReachResult = { drop: [], chunks: 0, dropped: [] };

/** The comparison key of a label name. */
export function nameKey(name: string): string {
  let k = name.startsWith('.') ? name.slice(1) : name;
  while (k.startsWith('core.')) k = k.slice(5);
  return k;
}

const TMP_REF = /^([0-9]+)([FB])$/;

interface Chunk {
  readonly start: number;
  end: number;
  readonly keys: string[];
  readonly refs: Set<string>;
  readonly tmpDefs: Set<string>;
  needsPrev: boolean;
  needsNext: boolean;
  hasIns: boolean;
  /** A label (of any kind: a PROC's LOCAL one, a temporary one) comes after the last instruction or data: control can arrive at the chunk's end and run on. */
  tailLabel: boolean;
  /** Never dropped: it pads to an address (a `DEFS` whose count is an expression), and what follows may depend on the padding. */
  pinned: boolean;
  /** The last instruction or data statement of the chunk. */
  last: { readonly kind: 'ins' | 'data'; readonly toks: readonly Tok[] } | null;
  /** The last instruction statement (skipping data after it). */
  lastIns: readonly Tok[] | null;
}

function newChunk(start: number): Chunk {
  return { start, end: start, keys: [], refs: new Set(), tmpDefs: new Set(), needsPrev: false, needsNext: false, hasIns: false, tailLabel: false, pinned: false, last: null, lastIns: null };
}

/** Whether control never continues past this instruction. */
function terminates(toks: readonly Tok[]): boolean {
  const m = toks[0];
  if (m === undefined || m.kind !== 'kw') return false;
  const rest = toks.slice(1);
  const comma = rest.some((t) => t.kind === 'op' && t.text === ',');
  switch (m.text) {
    case 'RET':
      return rest.length === 0;
    case 'RETI':
    case 'RETN':
      return true;
    case 'JP':
    case 'JR':
      return !comma;
    default:
      return false;
  }
}

/** Splits a token list on the statement separator `:`. */
function statements(toks: readonly Tok[]): Tok[][] {
  const out: Tok[][] = [[]];
  for (const t of toks) {
    if (t.kind === 'eol') break;
    if (t.kind === 'op' && t.text === ':') out.push([]);
    else (out[out.length - 1] as Tok[]).push(t);
  }
  return out.filter((s) => s.length > 0);
}

/**
 * Finds the lines of the unreachable chunks.
 * @param lines the preprocessed lines (text only)
 * @param regionStart index of the first line of the runtime and library region; everything before it is user code, kept whole,
 *   and every name in it is a root
 */
export function unreachable(lines: readonly string[], regionStart: number): ReachResult {
  const n = lines.length;
  if (regionStart < 0 || regionStart >= n) return NOTHING;

  const roots = new Set<string>();
  const addIds = (toks: readonly Tok[], into: Set<string>, local?: ReadonlySet<string>): void => {
    for (const t of toks) {
      if (t.kind !== 'id' || TMP_REF.test(t.text)) continue;
      if (local !== undefined && local.has(t.text)) continue;
      into.add(nameKey(t.text));
    }
  };

  // The user region: every name is a root.
  for (let i = 0; i < regionStart; i++) {
    const errs: LexError[] = [];
    addIds(lexLine(lines[i] as string, errs), roots);
  }

  const chunks: Chunk[] = [];
  const structural = new Array<boolean>(n).fill(false);
  let cur = newChunk(regionStart); // the head: lines before the first label
  chunks.push(cur);
  const procs: Array<{ locals: Set<string>; labels: string[] }> = [];

  for (let i = regionStart; i < n; i++) {
    const text = lines[i] as string;
    if (/\\[ \t]*$/.test(text)) return NOTHING; // a continuation line: not worth analysing
    if (text.trimStart().startsWith('#')) {
      structural[i] = true;
      continue;
    }
    const errs: LexError[] = [];
    const toks = lexLine(text, errs);
    if (errs.length > 0) return NOTHING;
    for (const st of statements(toks)) {
      const t0 = st[0] as Tok;
      const t1 = st[1];
      if (t0.kind === 'id' && t1 !== undefined && t1.kind === 'kw' && t1.text === 'EQU') {
        if (procs.length === 0) {
          // a constant of the file's own scope: always kept, and what it names is a root
          structural[i] = true;
          addIds(st.slice(2), roots);
        } else {
          // inside a PROC it is the chunk's: dropped with it (its LOCAL names would not exist), exported like a label unless LOCAL
          (procs[procs.length - 1] as { labels: string[] }).labels.push(t0.text);
          addIds(st.slice(2), cur.refs);
        }
        continue;
      }
      if ((t0.kind === 'id' || t0.kind === 'int') && st.length === 1) {
        // a label definition
        const name = t0.kind === 'id' ? t0.text : String(t0.value);
        if (t0.kind === 'int') {
          cur.tmpDefs.add(name);
          cur.tailLabel = true;
          continue;
        }
        if (procs.length === 0) {
          cur.end = i;
          cur = newChunk(i);
          chunks.push(cur);
          cur.keys.push(nameKey(name));
        } else {
          (procs[procs.length - 1] as { labels: string[] }).labels.push(name);
          cur.tailLabel = true;
        }
        continue;
      }
      if (t0.kind === 'kw') {
        switch (t0.text) {
          case 'PROC':
            structural[i] = true;
            procs.push({ locals: new Set(), labels: [] });
            continue;
          case 'ENDP': {
            structural[i] = true;
            const p = procs.pop();
            if (p !== undefined) for (const l of p.labels) if (!p.locals.has(l)) cur.keys.push(nameKey(l));
            continue;
          }
          case 'LOCAL':
            for (const t of st.slice(1)) if (t.kind === 'id') (procs[procs.length - 1]?.locals ?? new Set<string>()).add(t.text);
            continue;
          case 'ALIGN':
          case 'NAMESPACE':
          case 'END':
            structural[i] = true;
            addIds(st.slice(1), roots);
            continue;
          case 'ORG':
          case 'INCBIN':
            return NOTHING;
          case 'PUSH':
          case 'POP':
            if (t1 !== undefined && t1.kind === 'kw' && t1.text === 'NAMESPACE') {
              structural[i] = true;
              continue;
            }
            break;
          default:
            break;
        }
        const data = t0.text === 'DEFB' || t0.text === 'DEFW' || t0.text === 'DEFS';
        addIds(st.slice(1), cur.refs, undefined);
        // `DEFS (8 - (LABEL & 7)) & 7` aligns what follows: the chunk stays, or the alignment is lost
        if (t0.text === 'DEFS' && st.slice(1).some((t) => t.kind === 'id' || (t.kind === 'op' && t.text === '$'))) cur.pinned = true;
        for (const t of st) {
          const m = TMP_REF.exec(t.text);
          if (t.kind === 'id' && m !== null) {
            const num = m[1] as string;
            if (m[2] === 'B') {
              if (!cur.tmpDefs.has(num)) cur.needsPrev = true;
            } else {
              cur.needsNext = true; // an `f` reference may be satisfied inside the chunk; conservative either way
            }
          }
        }
        cur.tailLabel = false;
        cur.last = { kind: data ? 'data' : 'ins', toks: st };
        if (!data) {
          cur.hasIns = true;
          cur.lastIns = st;
        }
        continue;
      }
      return NOTHING; // a statement that is none of the above
    }
  }
  cur.end = n;
  if (procs.length > 0) return NOTHING;

  // Locals: a chunk's references to names that are LOCAL in its own PROCs were counted as ordinary names above; a local name
  // that equals an exported key elsewhere only keeps more (conservative), so nothing more is done here.

  const owners = new Map<string, number[]>();
  chunks.forEach((c, idx) => {
    for (const k of c.keys) {
      const list = owners.get(k);
      if (list === undefined) owners.set(k, [idx]);
      else list.push(idx);
    }
  });

  const dataOnly = (c: Chunk | undefined): boolean => c !== undefined && c.last !== null && c.lastIns === null;
  const falls = (c: Chunk, idx: number): boolean => {
    if (c.last === null) return idx !== 0; // an empty label run (aliases) runs on; the head has nothing before it
    // Data does not run on, but a table can be read across a label (`stk-zero`, `stk-one` ... indexed from the first): a kept
    // table keeps the table that follows it.
    // The same holds for a chunk of code that ends in a table (`ret` then `defb ...`): the table may be read on into the next.
    const tableRunsOn = c.last.kind === 'data' && (dataOnly(chunks[idx + 1]) || (chunks[idx + 1]?.last ?? null) === null);
    if (c.lastIns === null) return tableRunsOn;
    return tableRunsOn || c.tailLabel || !terminates(c.lastIns);
  };

  const reached = new Array<boolean>(chunks.length).fill(false);
  const work: number[] = [];
  const mark = (idx: number): void => {
    if (idx >= 0 && idx < chunks.length && !reached[idx]) {
      reached[idx] = true;
      work.push(idx);
    }
  };
  mark(0);
  chunks.forEach((c, idx) => {
    if (c.pinned) mark(idx);
  });
  for (const k of roots) for (const idx of owners.get(k) ?? []) mark(idx);
  while (work.length > 0) {
    const idx = work.pop() as number;
    const c = chunks[idx] as Chunk;
    for (const k of c.refs) for (const o of owners.get(k) ?? []) mark(o);
    if (falls(c, idx)) mark(idx + 1);
    if (c.needsPrev) mark(idx - 1);
    if (c.needsNext) mark(idx + 1);
  }

  const drop: Array<[number, number]> = [];
  const dropped: Array<{ labels: string[]; lines: number; ranges: Array<[number, number]> }> = [];
  chunks.forEach((c, idx) => {
    if (reached[idx]) return;
    let count = 0;
    const mine: Array<[number, number]> = [];
    for (let i = c.start; i < c.end; i++) {
      if (structural[i]) continue;
      count++;
      const last = drop[drop.length - 1];
      if (last !== undefined && last[1] === i) last[1] = i + 1;
      else drop.push([i, i + 1]);
      const m = mine[mine.length - 1];
      if (m !== undefined && m[1] === i) m[1] = i + 1;
      else mine.push([i, i + 1]);
    }
    dropped.push({ labels: c.keys, lines: count, ranges: mine });
  });
  return { drop, chunks: chunks.length, dropped };
}
