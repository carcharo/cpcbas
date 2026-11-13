import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildAmsdosHeader, buildCpr, buildDsk, IMPLEMENTED } from './index.js';
import { buildStub } from './cpr.js';
import type { DskFile } from './index.js';

const FX = fileURLToPath(new URL('../../../../tests/pack/', import.meta.url));
const read = (p: string): Uint8Array => new Uint8Array(readFileSync(FX + p));

interface DskCase {
  files: { name: string; length: number; seed: number; load: number; entry: number }[];
  error?: string;
}
const dskCases = JSON.parse(readFileSync(FX + 'dsk/cases.json', 'utf8')) as Record<string, DskCase>;
const gen = (length: number, seed: number): Uint8Array => Uint8Array.from({ length }, (_, i) => (i * 7 + seed) & 0xff);
const toFiles = (c: DskCase): DskFile[] => c.files.map((s) => ({ name: s.name, data: gen(s.length, s.seed), loadAddress: s.load, entryAddress: s.entry }));

describe('amsdos header', () => {
  it('amsdos header matches mkdsk.py (fields and checksum)', () => {
    // The reference header is the first 128 bytes of block 2 (logical sector 4, physical slot 8 of track 0).
    const ref = read('dsk/len_1024.dsk').subarray(256 + 0x100 + 8 * 512, 256 + 0x100 + 8 * 512 + 128);
    const mine = buildAmsdosHeader({ name: 'B1024.BIN', length: 896, loadAddress: 0x4000, entryAddress: 0x4000 });
    expect(mine.ok && Buffer.from(mine.value).equals(Buffer.from(ref))).toBe(true);
    const h = buildAmsdosHeader({ name: 'game.bin', length: 0x12345, loadAddress: 0x1234, entryAddress: 0x5678 });
    if (!h.ok) throw new Error('header');
    const v = h.value;
    expect(v.length).toBe(128);
    expect(Buffer.from(v.subarray(1, 12)).toString('latin1')).toBe('GAME    BIN');
    expect(v[0x12]).toBe(2);
    expect([v[0x15], v[0x16]]).toEqual([0x34, 0x12]);
    expect([v[0x18], v[0x19]]).toEqual([0x45, 0x23]);
    expect([v[0x1a], v[0x1b]]).toEqual([0x78, 0x56]);
    expect([v[0x40], v[0x41], v[0x42]]).toEqual([0x45, 0x23, 0x01]);
    let sum = 0;
    for (let i = 0; i < 67; i++) sum += v[i]!;
    expect([v[0x43], v[0x44]]).toEqual([sum & 0xff, (sum >> 8) & 0xff]);
  });

  it('rejects empty and non-ASCII names with E601', () => {
    const base = { length: 1, loadAddress: 0, entryAddress: 0 };
    expect(buildAmsdosHeader({ ...base, name: '.bin' })).toMatchObject({ ok: false, error: { code: 'E601' } });
    expect(buildAmsdosHeader({ ...base, name: 'é.bin' })).toMatchObject({ ok: false, error: { code: 'E601' } });
  });
});

describe('dsk', () => {
  for (const [name, c] of Object.entries(dskCases)) {
    if (c.error !== undefined) continue;
    it(`dsk matches mkdsk.py on ${name}`, () => {
      const r = buildDsk(toFiles(c), { creator: 'mkdsk.py' });
      if (!r.ok) throw new Error(r.error.message);
      expect(Buffer.from(r.value).equals(Buffer.from(read(`dsk/${name}.dsk`)))).toBe(true);
    });
  }

  it('dsk default creator is cpcbas', () => {
    const r = buildDsk([]);
    if (!r.ok) throw new Error('dsk');
    expect(Buffer.from(r.value.subarray(0x22, 0x30))).toEqual(Buffer.from('cpcbas\0\0\0\0\0\0\0\0'));
    expect(r.value.length).toBe(256 + 40 * (256 + 9 * 512));
  });

  it('rejects a long creator', () => {
    expect(buildDsk([], { creator: 'x'.repeat(15) })).toMatchObject({ ok: false, error: { code: 'E603' } });
  });

  it('header none stores raw bytes', () => {
    const data = gen(1000, 9);
    const r = buildDsk([{ name: 'raw.dat', data, header: 'none' }]);
    if (!r.ok) throw new Error('dsk');
    // Block 2 is logical sectors 4 and 5; read through the skew: slot of logical L is SKEW.indexOf(L).
    const skew = [0, 5, 1, 6, 2, 7, 3, 8, 4];
    const sector = (logical: number): Uint8Array => {
      const slot = skew.indexOf(logical);
      const off = 256 + 0x100 + slot * 512;
      return r.value.subarray(off, off + 512);
    };
    expect(Buffer.from([...sector(4), ...sector(5)].slice(0, 1000))).toEqual(Buffer.from(data));
    // directory entry: RC = ceil(1000/128) = 8, first block 2
    const dir = sector(0);
    expect(dir[0x0f]).toBe(8);
    expect(dir[0x10]).toBe(2);
  });

  it('disc exactly full is accepted; one byte more gives E600 with the reference text', () => {
    for (const [name, c] of Object.entries(dskCases)) {
      if (!name.startsWith('disc_')) continue;
      const r = buildDsk(toFiles(c), { creator: 'mkdsk.py' });
      if (c.error === undefined) expect(r.ok).toBe(true);
      else expect(r).toEqual({ ok: false, error: { code: 'E600', message: c.error } });
    }
    expect(dskCases['disc_over']?.error).toContain('disk full');
  });

  it('disc full on directory entries gives E600', () => {
    const files: DskFile[] = Array.from({ length: 65 }, (_, i) => ({ name: `F${i}.X`, data: new Uint8Array(1), header: 'none' }));
    const r = buildDsk(files);
    expect(r).toMatchObject({ ok: false, error: { code: 'E600' } });
  });
});

describe('cpr', () => {
  const cases = JSON.parse(readFileSync(FX + 'cpr/cases.json', 'utf8')) as Record<string, { load: number; entry: number; summary: string }>;
  for (const [name, c] of Object.entries(cases)) {
    it(`cpr matches the Studio fixtures: ${name}`, () => {
      const image = read(`cpr/${name}.bin`);
      const r = buildCpr({ image, loadAddress: c.load, entryAddress: c.entry });
      if (!r.ok) throw new Error(r.error.message);
      expect(Buffer.from(r.value).equals(Buffer.from(read(`cpr/${name}.cpr`)))).toBe(true);
      expect(buildStub(c.load, c.entry, image.length).listing.join('\n') + '\n').toBe(Buffer.from(read(`cpr/${name}.lst`)).toString('utf8'));
    });
  }

  it('the entry defaults to the load address', () => {
    const r = buildCpr({ image: read('cpr/tiny.bin'), loadAddress: 0x40 });
    expect(r.ok && Buffer.from(r.value).equals(Buffer.from(read('cpr/tiny.cpr')))).toBe(true);
  });

  it('errors are PackError values', () => {
    expect(buildCpr({ image: new Uint8Array(0), loadAddress: 0x40 })).toEqual({ ok: false, error: { code: 'E604', message: 'empty program image' } });
    expect(buildCpr({ image: new Uint8Array(1), loadAddress: 0x10000 })).toEqual({ ok: false, error: { code: 'E603', message: 'load/entry must be 16-bit addresses' } });
    expect(buildCpr({ image: new Uint8Array(1), loadAddress: 0x40, entryAddress: -1 })).toMatchObject({ ok: false, error: { code: 'E603' } });
    expect(buildCpr({ image: new Uint8Array(0xc000), loadAddress: 0x40 })).toEqual({
      ok: false,
      error: { code: 'E602', message: 'program &0040-&C03F does not fit below &C000' },
    });
  });
});

it('pack is implemented', () => {
  expect(IMPLEMENTED).toBe(true);
});
