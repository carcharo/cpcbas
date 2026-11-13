/**
 * The `peephole` code pass (L5-PEEP, order slot 100): the rules (OLEVEL up to the level's `peephole`),
 * then at `-O2`, `-Os` and `-O3` unused-label removal and a second round of the rules (the fork's
 * `emit` does the same: `remove_unused_labels`, then `_output_join` again; follow-up 74's reading of
 * which labels count as referenced is docs/ir.md "Labels").
 *
 * `--opt-disable peephole` turns the whole pass off, `labels` the label removal, and a rule's name
 * (its file's stem) that rule. `--opt-trace` writes `\t; opt <name>: <what>` after each change.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { CodeLine, CodeUnit } from '../../codegen/types.js';
import type { CodePass, PassEnv } from '../index.js';
import { applyRules, makeCtx, newStats, type EngineStats } from './engine.js';
import { RULE_SOURCES } from './rules.gen.js';
import { parseRule, type Rule } from './rule-parser.js';

let parsed: readonly Rule[] | undefined;

/** Every rule, parsed once, in the order the engine tries them: by OFLAG, then by name (the fork sorts by OFLAG only, and `os.listdir` breaks its ties). */
export function allRules(): readonly Rule[] {
  parsed ??= RULE_SOURCES.map((s) => parseRule(s.name, s.text)).sort((a, b) => a.flag - b.flag || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return parsed;
}

/** The rules a level runs (`peephole` 1 or 2), minus the ones `enabled` turns off. */
export function rulesFor(level: number, enabled: (name: string) => boolean = () => true): Rule[] {
  return allRules().filter((r) => r.level <= level && enabled(r.name));
}

const GENERATED_LABEL = /^\.T\.\d+:$/;
const LABEL_REF = /\.T\.\d+(?!\d)/g;

/** Removes the generated `.T.<n>` labels that no other line of any unit names. */
export function removeUnusedLabels(units: readonly CodeUnit[], trace: boolean, stats?: EngineStats): CodeUnit[] {
  const refs = new Map<string, number>();
  for (const u of units) {
    for (const l of u.lines) {
      const t = l.text.trim();
      if (l.kind === 'code' && (GENERATED_LABEL.test(t) || t.startsWith(';'))) continue; // a definition, or a comment (trace lines name labels)
      for (const m of t.matchAll(LABEL_REF)) refs.set(m[0], (refs.get(m[0]) ?? 0) + 1);
    }
  }
  const procedures = new Set(units.flatMap((u) => (u.procedure === null ? [] : [u.procedure])));
  return units.map((u) => {
    const lines: CodeLine[] = [];
    let changed = false;
    for (const l of u.lines) {
      const t = l.text.trim();
      if (l.kind === 'code' && GENERATED_LABEL.test(t)) {
        const label = t.slice(0, -1);
        if (!refs.has(label) && !procedures.has(label)) {
          changed = true;
          stats?.hits.set('labels', (stats.hits.get('labels') ?? 0) + 1);
          if (trace) lines.push({ text: `\t; opt labels: ${label}`, kind: 'code', quad: l.quad });
          continue;
        }
      }
      lines.push(l);
    }
    return changed ? { ...u, lines } : u;
  });
}

/** The rules, then (when the level removes labels) the label removal and a second round. */
export function runPeephole(units: readonly CodeUnit[], env: PassEnv, stats: EngineStats = newStats()): readonly CodeUnit[] {
  const rules = rulesFor(env.spec.peephole, env.enabled);
  const ctx = makeCtx(rules, env.trace, stats);
  let out = rules.length === 0 ? units : units.map((u) => applyRules(u, ctx));
  if (env.spec.unusedLabels) {
    if (env.enabled('labels')) out = removeUnusedLabels(out, env.trace, stats);
    if (rules.length > 0) out = out.map((u) => applyRules(u, ctx));
  }
  return out;
}

/** The pass as registered in `CODE_PASSES`. */
export const PEEPHOLE_PASS: CodePass = {
  name: 'peephole',
  order: 100,
  when: (spec) => spec.peephole > 0,
  names: [...RULE_SOURCES.map((s) => s.name), 'labels'],
  run: (units, env) => runPeephole(units, env),
};
