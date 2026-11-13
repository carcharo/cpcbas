/** The Lamplighter program (the largest golden fixture) assembles in under a second. */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assemble, flatten } from '../src/asm/index.js';
import { SourceSet } from '../src/core/source.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('assembler speed', () => {
  it('assembles lamplighter_plus (478 KB of asm) in under 1 s', () => {
    const text = readFileSync(join(repo, 'tests/asm-golden/programs/lamplighter_plus.asm'), 'latin1');
    const expected = readFileSync(join(repo, 'tests/asm-golden/programs/lamplighter_plus.bin'));
    const sources = new SourceSet();
    const entry = sources.add('lamplighter_plus.asm', text, 'generated');
    // Host timing is allowed in tests; the library itself never reads a clock.
    const t0 = performance.now();
    const result = assemble({ sources, entry, resolveInclude: () => undefined, options: { initMode: 'zxbasm' } });
    const ms = performance.now() - t0;
    expect(result.ok).toBe(true);
    expect(flatten(result.segments).bytes.length).toBe(expected.length);
    expect(ms).toBeLessThan(1000);
  });
});
