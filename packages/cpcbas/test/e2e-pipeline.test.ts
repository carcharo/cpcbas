/**
 * The pipeline half of the L2-E2E smoke test, without an emulator: the committed compiler output
 * tests/e2e/hello.asm assembles and packs onto a disc without diagnostics. The emulator half is
 * tools/e2e-smoke.py (see tests/e2e/README.md).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assemble, flatten } from '../src/asm/index.js';
import type { IncludeResolver } from '../src/asm/types.js';
import { SourceSet, dirname as vdirname, joinPath, normalizePath } from '../src/core/source.js';
import { buildDsk } from '../src/pack/index.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const runtimeDir = join(repo, 'lib/runtime');

function walk(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (statSync(join(dir, name)).isDirectory()) out.push(...walk(join(dir, name), `${prefix}${name}/`));
    else out.push(`${prefix}${name}`);
  }
  return out;
}

const known = new Set(walk(runtimeDir));
const resolveInclude: IncludeResolver = (name, fromPath, angle) => {
  const candidates: string[] = [];
  if (!angle && fromPath.startsWith('lib/runtime/')) {
    candidates.push(joinPath(vdirname(fromPath).slice('lib/runtime'.length + 1), name));
  }
  candidates.push(normalizePath(name));
  for (const rel of candidates) {
    if (known.has(rel)) return { path: `lib/runtime/${rel}`, text: readFileSync(join(runtimeDir, rel), 'latin1') };
  }
  return undefined;
};

describe('e2e hello: assemble and pack', () => {
  const sources = new SourceSet();
  const entry = sources.add(
    'tests/e2e/hello.asm',
    readFileSync(join(repo, 'tests/e2e/hello.asm'), 'latin1'),
    'generated',
  );
  const result = assemble({ sources, entry, resolveInclude, options: { initMode: 'zxbasm' } });

  it('assembles without diagnostics', () => {
    expect(result.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('starts at the origin the dsk loads and runs it at', () => {
    const image = flatten(result.segments);
    expect(image.bytes.length).toBeGreaterThan(1000);
    expect(result.symbols.get('.core.__START_PROGRAM')?.value).toBe(image.org);
    expect(image.org).toBe(0x40);
  });

  it('packs onto a disc as HELLO.BIN without error', () => {
    const image = flatten(result.segments);
    const dsk = buildDsk([
      { name: 'HELLO.BIN', data: image.bytes, loadAddress: image.org, entryAddress: image.org, fileType: 2 },
    ]);
    expect(dsk.ok).toBe(true);
    if (!dsk.ok) return;
    // standard 40-track, 1-side, 9 x 512-byte image: 256-byte disc header + 40 x (256 + 9 x 512)
    expect(dsk.value.length).toBe(256 + 40 * (256 + 9 * 512));
    expect(new TextDecoder('latin1').decode(dsk.value.subarray(0, 8))).toBe('MV - CPC');
  });
});
