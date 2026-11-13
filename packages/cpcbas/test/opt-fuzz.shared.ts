/**
 * L5-DIFF layer 2: the fuzzer's shared part (test/opt-fuzz.test.ts and its shards). About 200 random terminating programs per `npm test` run (fixed seeds, 1..200), each built at
 * -O0 and at every optimised level and run on the test Z80; the outcomes must agree. A failure is shrunk and printed with its
 * seed, so that `npm run fuzz:opt -- 1 <seed>` repeats it.
 *
 * `npm run fuzz:opt` runs it with random seeds (development): CPCBAS_FUZZ_SEED is the first seed, CPCBAS_FUZZ_COUNT how many.
 * CPCBAS_OPT_LEVELS narrows the levels (`2,s`).
 */
import { describe, expect, it } from 'vitest';
import { generate, render } from './fuzz/gen.js';
import type { FuzzProgram } from './fuzz/gen.js';
import { shrink } from './fuzz/shrink.js';
import { compareLevels, levelsFromEnv } from './opt-harness.js';
import type { Level, Program } from './opt-harness.js';

const FIRST = Number(process.env['CPCBAS_FUZZ_SEED'] ?? 1);
const COUNT = Number(process.env['CPCBAS_FUZZ_COUNT'] ?? 200);
const levels = levelsFromEnv();

const asProgram = (p: FuzzProgram): Program => ({ name: `fuzz seed ${p.seed}`, files: render(p) });

/** One program: the generator's own contract (it builds and ends at -O0), then the differential. null when all is well. */
function check(p: FuzzProgram, lv: readonly Level[], requireRun: boolean): string | null {
  const v = compareLevels(asProgram(p), lv, { requireRun });
  if (v.kind === 'ok') return null;
  return `${v.kind}: ${v.detail}`;
}

/** The failure of `seed`, shrunk, as a message; null when it passes. */
export function findFailure(seed: number, lv: readonly Level[] = levels): string | null {
  const p = generate(seed);
  const why = check(p, lv, true);
  if (why === null) return null;
  const small = shrink(p, (q) => compareLevels(asProgram(q), lv).kind === 'fail');
  const text = render(small);
  const kept = compareLevels(asProgram(small), lv).detail;
  return `seed ${seed}: ${why.split('\n')[0]}\nshrunk to ${text.split('\n').length - 1} lines (from ${render(p).split('\n').length - 1}):\n${text}\n${kept}\nrepeat: npm run fuzz:opt -- 1 ${seed}${lv === levels ? '' : ' ' + lv.join(',')}`;
}

/** Shard `index` of `count` of the seeds FIRST..FIRST+COUNT-1: one test file each, so that the workers share the run. */
export function defineFuzzShard(index: number, count: number): void {
  describe(`fuzzer, shard ${index + 1}/${count}: seeds ${FIRST}..${FIRST + COUNT - 1}`, () => {
    it('every program builds and ends at -O0 and agrees at every level', () => {
      const failures: string[] = [];
      for (let seed = FIRST + index; seed < FIRST + COUNT; seed += count) {
        const f = findFailure(seed);
        if (f !== null) {
          failures.push(f);
          if (failures.length >= 3) break;
        }
      }
      expect(failures.join('\n\n')).toBe('');
    }, 120_000);
  });
}

