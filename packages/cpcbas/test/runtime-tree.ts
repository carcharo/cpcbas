/** Test helper: the repo's lib/ as a virtual runtime tree (the CLI's --runtime, read eagerly), and a minimal AMSDOS-data .dsk reader. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './z80sim/run.js';

let cached: Map<string, string> | undefined;

/** `runtime/*.asm`, `loco/*.asm` and the rest of lib/ (the .asm and the BASIC library's .bas, as the CLI's --runtime reads it), keyed by path relative to lib/. */
export function libTree(): Map<string, string> {
  if (cached) return cached;
  const tree = new Map<string, string>();
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, `${prefix}${name}/`);
      else if (/\.(asm|bas)$/.test(name)) tree.set(`${prefix}${name}`, readFileSync(full, 'latin1'));
    }
  };
  walk(join(repoRoot, 'lib'), '');
  cached = tree;
  return tree;
}

export interface DskEntry {
  readonly name: string;
  /** The file's bytes as stored (with the AMSDOS header when it has one). */
  readonly data: Uint8Array;
}

/** Files of a standard 40 x 9 x 512 image (first extent of each name only is enough for small files; all extents are joined). */
export function readDsk(dsk: Uint8Array): DskEntry[] {
  const sector = (logical: number): Uint8Array => {
    const track = Math.floor(logical / 9);
    const trackStart = 256 + track * (256 + 9 * 512);
    // The track info lists the sector IDs in physical order; find the one whose C is 0xC1 + (logical % 9).
    const want = 0xc1 + (logical % 9);
    for (let i = 0; i < 9; i++) {
      if (dsk[trackStart + 0x18 + 8 * i + 2] === want) return dsk.subarray(trackStart + 256 + i * 512, trackStart + 256 + (i + 1) * 512);
    }
    throw new Error(`sector ${logical} not found`);
  };
  const block = (n: number): Uint8Array => {
    const out = new Uint8Array(1024);
    out.set(sector(2 * n), 0);
    out.set(sector(2 * n + 1), 512);
    return out;
  };
  const dir = new Uint8Array(2048);
  dir.set(block(0), 0);
  dir.set(block(1), 1024);
  const files = new Map<string, { chunks: Uint8Array[]; order: number }>();
  for (let e = 0; e < 64; e++) {
    const d = dir.subarray(e * 32, e * 32 + 32);
    if (d[0] === 0xe5) continue;
    const name = `${String.fromCharCode(...d.subarray(1, 9)).trimEnd()}.${String.fromCharCode(...d.subarray(9, 12).map((c) => c & 0x7f)).trimEnd()}`;
    const extent = d[12] as number;
    const records = d[15] as number;
    const f = files.get(name) ?? { chunks: [], order: files.size };
    const bytes: number[] = [];
    for (let i = 16; i < 32 && (d[i] as number) !== 0; i++) bytes.push(...block(d[i] as number));
    const used = records * 128;
    f.chunks[extent] = Uint8Array.from(bytes.slice(0, extent === 0 && records === 0x80 ? bytes.length : Math.min(bytes.length, used || bytes.length)));
    files.set(name, f);
  }
  return [...files.entries()]
    .sort((a, b) => a[1].order - b[1].order)
    .map(([name, f]) => {
      const total = f.chunks.reduce((n, c) => n + (c?.length ?? 0), 0);
      const data = new Uint8Array(total);
      let at = 0;
      for (const c of f.chunks) if (c) { data.set(c, at); at += c.length; }
      return { name, data };
    });
}
