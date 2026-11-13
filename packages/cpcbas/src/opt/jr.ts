/**
 * The `jr` code pass (L5-CG, order slot 900, `-Os`): `jp L`, `jp z|nz|c|nc, L` become `jr` where the target label is in
 * the same unit and in reach (docs/ir.md "`-Os`"). Each line is sized exactly with the assembler's instruction table
 * (`z80size.ts`; a size never depends on a symbol's value), so the decision needs no layout. A span that holds a line the
 * table cannot size (a `defb`, a macro, `$`) keeps `jp`. A conversion only shrinks distances, so the pass repeats until
 * nothing changes and a converted jump stays in range. `jp po/pe/p/m` have no `jr` form.
 *
 * `--opt-disable jr` turns it off; `--opt-trace` writes `\t; opt jr: <the jump>` after each converted line.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { CodeLine, CodeUnit } from '../codegen/types.js';
import type { CodePass, PassEnv } from './index.js';
import { labelOf, lineSize } from './z80size.js';

const JP = /^\tjp\s+(?:(z|nz|c|nc)\s*,\s*)?([A-Za-z_.][\w.$]*)\s*$/;

/** Reach of a `jr`: the displacement is counted from the end of the 2-byte instruction. */
const FORWARD = 127;
const BACKWARD = 128;

/** Hits of the last run, for the tests' totals (name -> count), per unit run. */
export interface JrStats {
  converted: number;
}

function convertUnit(u: CodeUnit, trace: boolean, stats: JrStats): CodeUnit {
  let lines = u.lines;
  if (!lines.some((l) => l.kind === 'code' && JP.test(l.text))) return u;
  let changed = false;
  for (;;) {
    const n = lines.length;
    // address of the start of each line (relative), and the first line of each label
    const at = new Array<number>(n + 1);
    const known = new Array<number>(n + 1); // number of lines before i whose size is unknown
    const sizes = new Array<number | null>(n);
    const labels = new Map<string, number>();
    let addr = 0;
    let unknown = 0;
    for (let i = 0; i < n; i++) {
      const l = lines[i] as CodeLine;
      at[i] = addr;
      known[i] = unknown;
      if (l.kind === 'boundary') {
        sizes[i] = 0;
        continue;
      }
      const s = lineSize(l.text);
      sizes[i] = s;
      if (s === null) unknown++;
      else addr += s;
      const lab = labelOf(l.text);
      if (lab !== null && !labels.has(lab)) labels.set(lab, i);
    }
    at[n] = addr;
    known[n] = unknown;
    const out: CodeLine[] = [];
    let round = 0;
    for (let i = 0; i < n; i++) {
      const l = lines[i] as CodeLine;
      const m = l.kind === 'code' ? JP.exec(l.text) : null;
      const target = m === null ? undefined : labels.get(m[2] as string);
      if (m === null || target === undefined) {
        out.push(l);
        continue;
      }
      const cond = m[1];
      let ok: boolean;
      if (target > i) {
        // the bytes between the end of the jump (a 2-byte `jr` replaces a 3-byte `jp`) and the label
        ok = known[target] === known[i + 1] && (at[target] as number) - ((at[i] as number) + 3) <= FORWARD;
      } else {
        ok = known[i] === known[target] && (at[i] as number) - (at[target] as number) + 2 <= BACKWARD;
      }
      if (!ok) {
        out.push(l);
        continue;
      }
      const text = `\tjr ${cond === undefined ? '' : `${cond}, `}${m[2] as string}`;
      out.push({ ...l, text });
      if (trace) out.push({ text: `\t; opt jr: ${l.text.trim()}`, kind: 'code', quad: l.quad });
      round++;
    }
    if (round === 0) break;
    stats.converted += round;
    changed = true;
    lines = out;
  }
  return changed ? { ...u, lines } : u;
}

/** The `jr` pass over every unit (a jump never crosses units). */
export function runJr(units: readonly CodeUnit[], env: PassEnv, stats: JrStats = { converted: 0 }): readonly CodeUnit[] {
  return units.map((u) => convertUnit(u, env.trace, stats));
}

/** The pass as registered in `CODE_PASSES`. */
export const JR_PASS: CodePass = {
  name: 'jr',
  order: 900,
  when: (spec) => spec.sizeRules,
  run: (units, env) => runJr(units, env),
};
