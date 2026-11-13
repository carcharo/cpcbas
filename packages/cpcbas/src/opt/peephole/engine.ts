/**
 * The peephole engine (L5-PEEP): applies rules to the generated code of the units, the way the fork's
 * `_output_join` does (a sliding window: after a rule fires, the scan resumes `maxLen` instructions
 * back), under the contract of docs/ir.md "The rules every pass keeps":
 *
 * - a window is consecutive `code` lines of one unit: never a `boundary` or `opaque` line, never a
 *   directive (`DEFB`, `DEFW`: the inline table of a jump), and it may not end directly before an
 *   `opaque` line (an ASM block may read any register);
 * - comment lines (`\t; ...`) are skipped by the matcher and kept, after the replacement;
 * - a label line is matched only by a pattern line that is itself a label (`$2:`);
 * - no rule line, after a rule fired, carries a different `quad` than the line it came from, except
 *   that a new line takes the quad of the last window line.
 *
 * `$0` (all registers dead after the window) and `$00` (the template key of the last line's quad) are
 * set for the rule's IF, see expr.ts.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Ported from the fork's engine.py and backend/main.py `_output_join`, © Copyright 2008-2024 José Manuel Rodríguez de la Rosa and contributors.
 * See the file CONTRIBUTORS.md of zxbasic (https://github.com/boriel-basic/zxbasic) for copyright details.
 */

import type { CodeLine, CodeUnit } from '../../codegen/types.js';
import { templateKey } from '../../codegen/types.js';
import { evaluate, isTrue, type Value } from './expr.js';
import type { Rule } from './rule-parser.js';

const DIRECTIVE = /^(?:defb|defw|defs|defm|db|dw|ds|dm|org|equ|include|incbin|align)\b/i;
const LABEL = /^[^\s;]+:$/;
/** Quads that leave no value in a register: the last line of one ends a statement's work. */
const NO_RESULT_OPS = new Set(['store', 'poke', 'astore', 'out']);

const isComment = (l: CodeLine): boolean => l.kind === 'code' && l.text.trimStart().startsWith(';');
/** A line a rule may match: a `code` line that is an instruction or a label. */
const matchable = (l: CodeLine): boolean => {
  if (l.kind !== 'code') return false;
  const t = l.text.trim();
  return t !== '' && !t.startsWith(';') && !t.startsWith('#') && !DIRECTIVE.test(t);
};

/** What a run of the engine counted (the pass writes the same facts as trace lines). */
export interface EngineStats {
  /** Rule name to the number of times it fired. */
  readonly hits: Map<string, number>;
  /** Candidate windows an `opaque` line refused, by the kind of line: `asm-internal`, `asm-user`, `stmt`. Counted only with `trace`. */
  readonly refused: Map<string, number>;
}

export function newStats(): EngineStats {
  return { hits: new Map(), refused: new Map() };
}

interface Ctx {
  readonly rules: readonly Rule[];
  readonly maxLen: number;
  readonly trace: boolean;
  readonly stats: EngineStats;
  /** Refusals already counted (a second round meets the same ones). */
  readonly seenRefusals: Set<string>;
}

const inc = (m: Map<string, number>, k: string): void => void m.set(k, (m.get(k) ?? 0) + 1);

/** The kind of an opaque line, from the quad that emitted it. */
function opaqueKind(unit: CodeUnit, l: CodeLine): string {
  const q = unit.quads[l.quad];
  if (q === undefined || q.op !== 'asm') return 'stmt';
  return q.internal === true ? 'asm-internal' : 'asm-user';
}

/** Whether every register is dead after `lines[end]`: a jump, or the last line of a quad that leaves no value (docs/ir.md "A dead register"). */
function deadAfter(unit: CodeUnit, lines: readonly CodeLine[], end: number): boolean {
  const last = lines[end] as CodeLine;
  const t = last.text.trim();
  if (/^(?:jp|jr)\s/.test(t) && !t.includes('(')) return true;
  const q = unit.quads[last.quad];
  if (q === undefined || !NO_RESULT_OPS.has(q.op)) return false;
  for (let i = end + 1; i < lines.length; i++) {
    const n = lines[i] as CodeLine;
    if (isComment(n)) continue;
    return n.kind !== 'code' || n.quad !== last.quad;
  }
  return true;
}

function quadKey(unit: CodeUnit, l: CodeLine): string {
  const q = unit.quads[l.quad];
  return q === undefined ? '' : templateKey(q);
}

interface Window {
  /** Indices (into the line array) of the non-comment lines, starting at the window's first line. */
  readonly idx: number[];
  /** What follows the last collected line: the next non-comment line, if any. */
  readonly after: CodeLine | undefined;
}

/** Collects up to `max` matchable lines from `start`, skipping comments; `through` lets `opaque` lines in (for the refusal count). */
function collect(lines: readonly CodeLine[], start: number, max: number, through: boolean): Window {
  const idx: number[] = [];
  let i = start;
  for (; i < lines.length && idx.length < max; i++) {
    const l = lines[i] as CodeLine;
    if (isComment(l)) continue;
    if (matchable(l) || (through && l.kind === 'opaque')) idx.push(i);
    else break;
  }
  let after: CodeLine | undefined;
  for (let j = idx.length > 0 ? (idx[idx.length - 1] as number) + 1 : i; j < lines.length; j++) {
    const l = lines[j] as CodeLine;
    if (isComment(l)) continue;
    after = l;
    break;
  }
  return { idx, after };
}

interface Fired {
  readonly rule: Rule;
  readonly texts: string[];
  readonly out: string[];
  readonly last: number;
}

/** Tries the rules at `start`; the first that matches fires. */
function tryAt(unit: CodeUnit, lines: CodeLine[], start: number, ctx: Ctx, pending: Pending[]): Fired | null {
  const w = collect(lines, start, ctx.maxLen, false);
  if (w.idx.length === 0) return null;
  const texts = w.idx.map((i) => (lines[i] as CodeLine).text.trim());
  for (const rule of ctx.rules) {
    const n = rule.replace.length;
    if (n > texts.length) continue;
    const vars = rule.replace.match(texts);
    if (vars === null) continue;
    let ok = true;
    for (let k = 0; k < n; k++) {
      if (LABEL.test(texts[k] as string) !== (rule.replace.patterns[k] as { isLabel: boolean }).isLabel) ok = false;
    }
    if (!ok) continue;
    const last = w.idx[n - 1] as number;
    vars.set('$0', deadAfter(unit, lines, last) ? '1' : '');
    vars.set('$00', quadKey(unit, lines[last] as CodeLine));
    for (const d of rule.defines) vars.set(d.name, text(evaluate(d.expr, vars)));
    if (!isTrue(evaluate(rule.cond, vars))) continue;
    // The window may not end directly before an `opaque` line.
    const next = n === w.idx.length ? w.after : (lines[w.idx[n] as number] as CodeLine);
    if (next !== undefined && next.kind === 'opaque') {
      refuse(unit, lines, ctx, rule, texts.slice(0, n), last, next, pending);
      continue;
    }
    return { rule, texts: texts.slice(0, n), out: rule.with.filter(vars), last };
  }
  return null;
}

const text = (v: Value): string => (typeof v === 'string' ? v : v.map(text).join(','));

/** Records a candidate window that an opaque line refused: counted, and with `trace` written as `; opt-refused`. */
function refuse(unit: CodeUnit, lines: readonly CodeLine[], ctx: Ctx, rule: Rule, texts: string[], last: number, opaque: CodeLine, pending: Pending[]): void {
  if (!ctx.trace) return;
  const key = `${unit.procedure ?? ''}|${rule.name}|${(lines[last] as CodeLine).quad}|${opaque.quad}|${texts.join(' / ')}`;
  if (ctx.seenRefusals.has(key)) return;
  ctx.seenRefusals.add(key);
  inc(ctx.stats.refused, opaqueKind(unit, opaque));
  const quad = (lines[last] as CodeLine).quad;
  pending.push({ at: last + 1, line: { text: `\t; opt-refused ${rule.name}: ${texts.join(' / ')} (${opaqueKind(unit, opaque)})`, kind: 'code', quad } });
}

/** A refusal comment to insert at `at` once the scan at this position is done (inserting at once would shift the window's indices). */
interface Pending {
  readonly at: number;
  readonly line: CodeLine;
}

function flush(lines: CodeLine[], pending: Pending[]): void {
  for (const p of [...pending].reverse()) lines.splice(p.at, 0, p.line);
}

/** The windows that contain an `opaque` line: counted (with `trace`) but never applied. */
function shadowScan(unit: CodeUnit, lines: CodeLine[], start: number, ctx: Ctx, pending: Pending[]): void {
  const w = collect(lines, start, ctx.maxLen, true);
  if (w.idx.length === 0 || !w.idx.some((i) => (lines[i] as CodeLine).kind === 'opaque')) return;
  if ((lines[start] as CodeLine).kind === 'opaque') return;
  const texts = w.idx.map((i) => (lines[i] as CodeLine).text.trim());
  for (const rule of ctx.rules) {
    const n = rule.replace.length;
    if (n > texts.length) continue;
    const covered = w.idx.slice(0, n);
    const opaque = covered.map((i) => lines[i] as CodeLine).find((l) => l.kind === 'opaque');
    if (opaque === undefined) continue;
    const vars = rule.replace.match(texts);
    if (vars === null) continue;
    let ok = true;
    for (let k = 0; k < n; k++) if (LABEL.test(texts[k] as string) !== (rule.replace.patterns[k] as { isLabel: boolean }).isLabel) ok = false;
    if (!ok) continue;
    const last = w.idx[n - 1] as number;
    vars.set('$0', deadAfter(unit, lines, last) ? '1' : '');
    vars.set('$00', quadKey(unit, lines[last] as CodeLine));
    try {
      for (const d of rule.defines) vars.set(d.name, text(evaluate(d.expr, vars)));
      if (!isTrue(evaluate(rule.cond, vars))) continue;
    } catch {
      continue;
    }
    refuse(unit, lines, ctx, rule, texts.slice(0, n), last, opaque, pending);
    return;
  }
}

/** The index to resume at after a rule fired at `start`: `maxLen` instructions back. */
function resumeFrom(lines: readonly CodeLine[], start: number, maxLen: number): number {
  let j = start;
  let count = 0;
  while (j > 0 && count < maxLen) {
    const prev = lines[j - 1] as CodeLine;
    if (prev.kind !== 'code') break;
    j--;
    if (!isComment(prev)) count++;
  }
  return j;
}

/** New line `text` for a rule's output: instructions get the tab, labels none; the quad is that of the window line with the same text, else of its last line. */
function newLines(unit: CodeUnit, window: CodeLine[], out: readonly string[]): CodeLine[] {
  void unit;
  const last = window[window.length - 1] as CodeLine;
  const free = window.map((l) => ({ l, used: false }));
  return out.map((t) => {
    const src = free.find((f) => !f.used && f.l.text.trim() === t);
    if (src !== undefined) src.used = true;
    return { text: LABEL.test(t) ? t : `\t${t}`, kind: 'code' as const, quad: (src?.l ?? last).quad };
  });
}

/** Applies the rules to one unit until none fires. */
export function applyRules(unit: CodeUnit, ctx: Ctx): CodeUnit {
  const lines = [...unit.lines];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i] as CodeLine;
    if (!matchable(l)) {
      i++;
      continue;
    }
    const pending: Pending[] = [];
    const fired = tryAt(unit, lines, i, ctx, pending);
    if (fired === null) {
      if (ctx.trace) shadowScan(unit, lines, i, ctx, pending);
      flush(lines, pending);
      i++;
      continue;
    }
    flush(lines, pending);
    // The window's lines, with the comments between them.
    const w = collect(lines, i, fired.rule.replace.length, false);
    const first = w.idx[0] as number;
    const last = fired.last;
    const span = lines.slice(first, last + 1);
    const real = w.idx.slice(0, fired.rule.replace.length).map((k) => lines[k] as CodeLine);
    const comments = span.filter(isComment);
    const repl = newLines(unit, real, fired.out);
    if (ctx.trace) {
      repl.push(...comments);
      repl.push({ text: `\t; opt ${fired.rule.name}: ${fired.texts.join(' / ')}`, kind: 'code', quad: (lines[last] as CodeLine).quad });
    } else repl.push(...comments);
    lines.splice(first, last - first + 1, ...repl);
    inc(ctx.stats.hits, fired.rule.name);
    i = resumeFrom(lines, first, ctx.maxLen);
  }
  return { ...unit, lines };
}

export function makeCtx(rules: readonly Rule[], trace: boolean, stats: EngineStats = newStats()): Ctx {
  return { rules, maxLen: Math.max(1, ...rules.map((r) => r.replace.length)), trace, stats, seenRefusals: new Set() };
}

export type EngineCtx = Ctx;
