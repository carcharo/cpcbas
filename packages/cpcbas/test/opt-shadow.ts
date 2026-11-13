/**
 * L5-DIFF: the two development switches of `runSource` (test/compile-helper.ts), kept apart so that the harness does not
 * import the helper.
 *
 * - `CPCBAS_OPT_RECORD=<file>`: every program a `*-run.test.ts` runs through `runSource` (and that needs no `setup` hook, so
 *   it can be replayed) is appended to <file> as one JSON line. `npm run opt:corpus` rewrites test/opt-corpus.json this way.
 * - `CPCBAS_OPT_SHADOW=1` (with `CPCBAS_OPT_LEVELS=2,s` to narrow the levels): the program is also built and run at every
 *   optimised level, and a difference from -O0 throws inside the test that ran it. A program with a `setup` hook is replayed
 *   without it and is skipped when that stops it ending at -O0.
 */
import { appendFileSync } from 'node:fs';
import { compareLevels, levelsFromEnv } from './opt-harness.js';
import type { Program } from './opt-harness.js';
import type { RunOptions } from './z80sim/run.js';

export interface CorpusEntry {
  readonly src: string;
  readonly keys?: string;
  readonly maxTStates?: number;
}

export function shadowOrRecord(text: string, run: RunOptions): void {
  const record = process.env['CPCBAS_OPT_RECORD'];
  const shadow = process.env['CPCBAS_OPT_SHADOW'];
  if (record === undefined && shadow === undefined) return;
  const replayable = run.setup === undefined && (run.keys === undefined || typeof run.keys === 'string');
  if (record !== undefined && replayable) {
    const entry: CorpusEntry = {
      src: text,
      ...(typeof run.keys === 'string' ? { keys: run.keys } : {}),
      ...(run.maxTStates !== undefined ? { maxTStates: run.maxTStates } : {}),
    };
    appendFileSync(record, `${JSON.stringify(entry)}\n`);
  }
  if (shadow !== undefined && shadow !== '') {
    const p: Program = { name: 'shadow', files: text, ...(typeof run.keys === 'string' ? { keys: run.keys } : {}), ...(run.maxTStates !== undefined ? { maxTStates: run.maxTStates } : {}) };
    const v = compareLevels(p, levelsFromEnv());
    if (v.kind === 'fail') throw new Error(`optimisation differential: ${v.detail}\n--- program\n${text}`);
  }
}
