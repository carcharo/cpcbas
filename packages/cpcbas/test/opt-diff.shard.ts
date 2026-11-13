/** L5-DIFF layer 1, one shard: every program of `shardOf(index, count)` at -O0 and at each optimised level (see opt-harness.ts). */
import { describe, expect, it } from 'vitest';
import { compareLevels, levelsFromEnv } from './opt-harness.js';
import { shardOf } from './opt-programs.js';

export function defineShard(index: number, count: number): void {
  const levels = levelsFromEnv();
  describe(`simulator differential, shard ${index + 1}/${count}`, () => {
    for (const p of shardOf(index, count)) {
      it(`${p.name} at -O0 and ${levels.map((l) => `-O${l}`).join(' ')} agree`, () => {
        const v = compareLevels(p, levels);
        expect(v.kind === 'fail' ? `${p.name}: ${v.detail}` : '').toBe('');
        // the longest program (swap32) takes about 1 s alone at four levels; the default 5 s is too close under the full suite's load (R19, fu 183c)
      }, 30_000);
    }
  });
}
