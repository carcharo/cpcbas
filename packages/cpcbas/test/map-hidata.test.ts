/** L6-PKG: the map's `.__HIDATA_BACK_0` (the reference's label; the Studio's memory report and Starfall's build script read it). */
import { describe, expect, it } from 'vitest';
import { compile } from '../src/index.js';
import { libTree } from './runtime-tree.js';

function mapOf(src: string): string[] {
  const r = compile({ files: new Map([['main.bas', src]]), main: 'main.bas', runtime: libTree(), options: { format: 'bin', map: true } });
  expect(r.ok).toBe(true);
  return (r.map ?? '').split('\n');
}

const addr = (line: string): number => parseInt(line.slice(0, 4), 16);

describe('.__HIDATA_BACK_0 in the map', () => {
  it('is the first address after the low segment when a hidata block exists', () => {
    const lines = mapOf('#pragma hidata = &8000\nDIM t(3) AS UBYTE => {1,2,3,4}\nDIM u(2) AS UBYTE => {5,6,7}\nPRINT t(0)\n');
    const back = lines.filter((l) => l.endsWith(': .__HIDATA_BACK_0'));
    expect(back).toHaveLength(1);
    const a = addr(back[0] as string);
    const low = lines.filter((l) => !l.endsWith('.__HIDATA_BACK_0') && addr(l) < 0x8000).map(addr);
    expect(a).toBeGreaterThan(Math.max(...low) - 1);
    expect(a).toBeLessThan(0x8000);
    expect(a).toBeGreaterThanOrEqual(0x40);
    // the high data stays where it was put
    expect(lines).toContain('8000: ._t__a.__DATA__');
    // the lines stay sorted
    expect([...lines].sort()).toEqual(lines);
  });

  it('is absent without hidata', () => {
    const lines = mapOf('DIM t(3) AS UBYTE => {1,2,3,4}\nPRINT t(0)\n');
    expect(lines.some((l) => l.includes('__HIDATA_BACK_0'))).toBe(false);
  });
});
