/** L6-PKG: `cpcbas asm` and `cpcbas dsk`, with an in-memory io. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run, type CliIo } from '../bin/cli.js';
import { readDsk } from './runtime-tree.js';
import { repoRoot } from './z80sim/run.js';

function memIo(files: Record<string, string | Uint8Array> = {}) {
  const fs = new Map<string, Uint8Array>();
  for (const [k, v] of Object.entries(files)) fs.set(k, typeof v === 'string' ? new TextEncoder().encode(v) : v);
  const written = new Map<string, Uint8Array>();
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    readFile: (p) => fs.get(p),
    writeFile: (p, b) => void written.set(p, b),
    stdout: (t) => void out.push(t),
    stderr: (t) => void err.push(t),
    cwd: '/work',
  };
  return { io, written, out: () => out.join(''), err: () => err.join('') };
}

describe('cpcbas asm', () => {
  const SRC = '  org 0x4000\nstart: ld a, 1\n  ld (0C000h), a\n  ret\nend_: defb "hi", 0\n';

  it('assembles a stand-alone source to the flat image and writes the map', async () => {
    const t = memIo({ 'loader.asm': SRC });
    expect(await run(['asm', 'loader.asm', '-o', 'loader.bin', '-M', 'loader.map'], t.io)).toBe(0);
    expect(t.err()).toBe('');
    expect([...(t.written.get('loader.bin') as Uint8Array)]).toEqual([0x3e, 1, 0x32, 0x00, 0xc0, 0xc9, 0x68, 0x69, 0]);
    expect(new TextDecoder().decode(t.written.get('loader.map'))).toBe('4000: .start\n4006: .end_');
  });

  it('an assembler error exits 1 with the diagnostic and writes nothing', async () => {
    const t = memIo({ 'bad.asm': '  org 0x4000\n  ld a, nosuchlabel\n  frobnicate\n' });
    expect(await run(['asm', 'bad.asm', '-o', 'bad.bin'], t.io)).toBe(1);
    expect(t.err()).toMatch(/error/);
    expect(t.err()).toContain('bad.asm');
    expect(t.written.size).toBe(0);
  });

  it('usage errors exit 2; a missing file exits 1', async () => {
    expect(await run(['asm'], memIo().io)).toBe(2);
    const noOut = memIo({ 'a.asm': SRC });
    expect(await run(['asm', 'a.asm'], noOut.io)).toBe(2);
    expect(noOut.err()).toContain('-o OUT.bin is needed');
    expect(await run(['asm', 'a.asm', 'b.asm', '-o', 'x'], memIo().io)).toBe(2);
    expect(await run(['asm', 'a.asm', '-o', 'x', '--bogus'], memIo().io)).toBe(2);
    const missing = memIo();
    expect(await run(['asm', 'nope.asm', '-o', 'x'], missing.io)).toBe(1);
    expect(missing.err()).toContain("cannot read 'nope.asm'");
  });

  it("assembles Lamplighter's loader_plus.asm to the image of the disc loader (171 bytes at &9E00)", async () => {
    const path = 'tests/games/lamplighter/loader_plus.asm';
    const t = memIo({ [path]: readFileSync(join(repoRoot, path)) });
    expect(await run(['asm', path, '-o', 'l.bin', '-M', 'l.map'], t.io)).toBe(0);
    expect((t.written.get('l.bin') as Uint8Array).length).toBe(171);
    expect(new TextDecoder().decode(t.written.get('l.map'))).toMatch(/^9E00: \.start$/m);
  });
});

describe('cpcbas dsk', () => {
  it('packs files with AMSDOS headers: load and entry addresses, EXEC defaulting to LOAD', async () => {
    const t = memIo({ 'a.raw': 'abc', 'b.raw': new Uint8Array(1300).fill(7) });
    expect(await run(['dsk', '-o', 'out.dsk', 'a.bin=a.raw@&4000', 'b.bin=b.raw@0x9E00:0x9E10'], t.io)).toBe(0);
    const dsk = t.written.get('out.dsk') as Uint8Array;
    expect(dsk.length).toBe(256 + 40 * (256 + 9 * 512));
    const files = readDsk(dsk);
    expect(files.map((f) => f.name)).toEqual(['A.BIN', 'B.BIN']);
    const [a, b] = files as [(typeof files)[0], (typeof files)[0]];
    const word = (d: Uint8Array, at: number): number => (d[at] as number) | ((d[at + 1] as number) << 8);
    expect(a.data[18]).toBe(2); // binary
    expect(word(a.data, 21)).toBe(0x4000);
    expect(word(a.data, 26)).toBe(0x4000);
    expect(word(b.data, 21)).toBe(0x9e00);
    expect(word(b.data, 26)).toBe(0x9e10);
    expect(Buffer.from(a.data.subarray(128, 131)).toString()).toBe('abc');
    expect(b.data.length).toBeGreaterThanOrEqual(128 + 1300);
  });

  it('usage errors exit 2; a missing file exits 1', async () => {
    expect(await run(['dsk', 'x=y@0'], memIo().io)).toBe(2);
    expect(await run(['dsk', '-o', 'o.dsk'], memIo().io)).toBe(2);
    const bad = memIo();
    expect(await run(['dsk', '-o', 'o.dsk', 'nofile'], bad.io)).toBe(2);
    expect(bad.err()).toContain("'nofile' is not NAME=FILE@LOAD[:EXEC]");
    expect(await run(['dsk', '-o', 'o.dsk', 'a.bin=a.raw@zzz'], memIo().io)).toBe(2);
    const missing = memIo();
    expect(await run(['dsk', '-o', 'o.dsk', 'a.bin=a.raw@0x4000'], missing.io)).toBe(1);
    expect(missing.err()).toContain("cannot read 'a.raw'");
    expect(missing.written.size).toBe(0);
  });

  it('a file the disc cannot hold is reported as an error', async () => {
    const t = memIo({ 'big.raw': new Uint8Array(400_000) });
    expect(await run(['dsk', '-o', 'o.dsk', 'big.bin=big.raw@0x4000'], t.io)).toBe(1);
    expect(t.err()).toMatch(/error E?\d+/);
    expect(t.written.size).toBe(0);
  });
});

describe('--help', () => {
  it('lists the subcommands', async () => {
    const t = memIo();
    expect(await run(['--help'], t.io)).toBe(0);
    expect(t.out()).toContain('cpcbas asm SRC.asm -o OUT.bin [-M MAP]');
    expect(t.out()).toContain('cpcbas dsk -o OUT.dsk NAME=FILE@LOAD[:EXEC]...');
  });
});
