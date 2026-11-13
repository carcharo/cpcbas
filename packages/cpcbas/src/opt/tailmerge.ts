/**
 * The `tailmerge` code pass (L5-CG, order slot 800, `-Os`): shared exit sequences. Two runs of instructions that end in the
 * same unconditional transfer (`ret`, `jp L`, `jr L`, `jp (hl)`) and share a tail of identical instructions can share it: one copy
 * keeps the tail and gets a label, the others replace the tail by `jp label`. The code that runs is the same instruction for
 * instruction, whatever the registers hold, so no analysis is needed; Lamplighter's `RETURN "text"` (a frame address, a call and
 * a jump, 13 bytes, twelve times in one FUNCTION) and the STDCALL `leave` of every procedure with the same arguments are the
 * cases the size set shows.
 *
 * What a tail may hold: `code` lines that are instructions the assembler's table can size, and comments (a trace line moves with
 * the lines around it). A label, a `boundary`, an `opaque` line or a line the table cannot size ends the run, so nothing moves across
 * a statement start or an ASM block and a jump never lands inside a tail; a tail does not hold the event poll's `call`
 * (docs/ir.md "Statement boundaries stay where they are"). The kept copy is the middle one of the group, so that the
 * `jr` pass, which runs after, reaches more of the jumps. A merge is made only when it saves bytes (a `jp` is 3 bytes).
 *
 * `--opt-disable tailmerge` turns it off; `--opt-trace` writes `\t; opt tailmerge: <bytes> shared` after the label and each jump.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { CodeLine, CodeUnit } from '../codegen/types.js';
import type { CodePass, PassEnv } from './index.js';
import { labelOf, lineSize } from './z80size.js';

const JP_BYTES = 3;
const MAX_ROUNDS = 12;

const UNCONDITIONAL = /^(?:ret|reti|retn|jp\s+\((?:hl|ix|iy)\)|(?:jp|jr)\s+[A-Za-z_.][\w.$]*)$/;
const EXCLUDED = /__EVENT_POLL/;

/** One run of instructions ending in an unconditional transfer: the instruction lines' indexes in their unit, and their text. */
interface Run {
  readonly unit: number;
  readonly at: readonly number[];
  readonly keys: readonly string[];
}

interface Node {
  readonly children: Map<string, Node>;
  readonly runs: number[];
  readonly depth: number;
  readonly bytes: number;
}

const sizeCache = new Map<string, number | null>();
function sizeOf(key: string): number | null {
  let s = sizeCache.get(key);
  if (s === undefined) {
    s = lineSize(`\t${key}`);
    sizeCache.set(key, s);
  }
  return s;
}

const isComment = (t: string): boolean => t.trimStart().startsWith(';');

function findRuns(units: readonly CodeUnit[]): Run[] {
  const runs: Run[] = [];
  units.forEach((u, unit) => {
    let at: number[] = [];
    let keys: string[] = [];
    const flush = (): void => {
      at = [];
      keys = [];
    };
    u.lines.forEach((l, i) => {
      if (l.kind !== 'code') return flush();
      const t = l.text.trim();
      if (isComment(l.text)) return;
      if (labelOf(l.text) !== null || sizeOf(t) === null) return flush();
      at.push(i);
      keys.push(t);
      if (UNCONDITIONAL.test(t)) {
        if (at.length > 1) runs.push({ unit, at, keys });
        flush();
      }
    });
  });
  return runs;
}

interface Candidate {
  readonly node: Node;
  readonly saving: number;
}

function candidates(runs: readonly Run[]): Candidate[] {
  const root: Node = { children: new Map(), runs: [], depth: 0, bytes: 0 };
  const all: Node[] = [];
  runs.forEach((run, r) => {
    let node = root;
    for (let k = run.keys.length - 1; k >= 0; k--) {
      const key = run.keys[k] as string;
      if (EXCLUDED.test(key)) break;
      let next = node.children.get(key);
      if (next === undefined) {
        next = { children: new Map(), runs: [], depth: node.depth + 1, bytes: node.bytes + (sizeOf(key) as number) };
        node.children.set(key, next);
        all.push(next);
      }
      next.runs.push(r);
      node = next;
    }
  });
  const out: Candidate[] = [];
  for (const node of all) {
    if (node.runs.length < 2) continue;
    const saving = (node.runs.length - 1) * (node.bytes - JP_BYTES);
    if (saving > 0) out.push({ node, saving });
  }
  // the biggest saving first; ties: the longer tail, then the earlier run (the order of `all` is the order of insertion)
  return out.sort((a, b) => b.saving - a.saving || b.node.depth - a.node.depth);
}

function maxLabel(units: readonly CodeUnit[]): number {
  let max = -1;
  for (const u of units) for (const l of u.lines) for (const m of l.text.matchAll(/\.T\.(\d+)/g)) max = Math.max(max, Number(m[1]));
  return max;
}

/** What one round did, for the tests and the trace. */
export interface TailStats {
  merges: number;
  bytes: number;
}

/** The pass over every unit. */
export function runTailMerge(units: readonly CodeUnit[], env: PassEnv, stats: TailStats = { merges: 0, bytes: 0 }): readonly CodeUnit[] {
  let current = units;
  let next = maxLabel(units) + 1;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const runs = findRuns(current);
    const used = new Set<number>();
    const edits = new Map<number, Array<{ first: number; last: number; label: string; keeper: boolean; saved: number }>>();
    let any = false;
    for (const { node, saving } of candidates(runs)) {
      if (node.runs.some((r) => used.has(r))) continue;
      // members in program order (unit, then position): the middle one keeps the tail
      const members = [...node.runs].sort((a, b) => (runs[a] as Run).unit - (runs[b] as Run).unit || (runs[a] as Run).at[0]! - (runs[b] as Run).at[0]!);
      const label = `.T.${next++}`;
      const keeper = members[Math.floor(members.length / 2)] as number;
      for (const r of members) {
        used.add(r);
        const run = runs[r] as Run;
        const first = run.at[run.at.length - node.depth] as number;
        const last = run.at[run.at.length - 1] as number;
        const list = edits.get(run.unit) ?? [];
        list.push({ first, last, label, keeper: r === keeper, saved: saving });
        edits.set(run.unit, list);
      }
      stats.merges++;
      stats.bytes += saving;
      any = true;
    }
    if (!any) break;
    current = current.map((u, i) => {
      const list = edits.get(i);
      if (list === undefined) return u;
      const lines: CodeLine[] = [...u.lines];
      for (const e of list.sort((a, b) => b.first - a.first)) {
        const quad = (lines[e.first] as CodeLine).quad;
        if (e.keeper) {
          const trace: CodeLine[] = env.trace ? [{ text: `\t; opt tailmerge: ${e.label} kept (${e.saved} bytes saved by the group)`, kind: 'code', quad }] : [];
          lines.splice(e.first, 0, { text: `${e.label}:`, kind: 'code', quad }, ...trace);
        } else {
          const trace: CodeLine[] = env.trace ? [{ text: `\t; opt tailmerge: jp ${e.label}`, kind: 'code', quad }] : [];
          lines.splice(e.first, e.last - e.first + 1, { text: `\tjp ${e.label}`, kind: 'code', quad }, ...trace);
        }
      }
      return { ...u, lines };
    });
  }
  return current;
}

/** The pass as registered in `CODE_PASSES`. */
export const TAILMERGE_PASS: CodePass = {
  name: 'tailmerge',
  order: 800,
  when: (spec) => spec.sizeRules,
  run: (units, env) => runTailMerge(units, env),
};
