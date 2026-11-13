import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FIRMWARE } from './firmware.gen.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** The jumpblocks: first and last entry address (entries are 3 bytes apart, with gaps allowed). */
const BLOCKS = [
  { name: 'high kernel', from: 0xb900, to: 0xb92a },
  { name: 'main', from: 0xbb00, to: 0xbd5b },
  { name: 'indirections', from: 0xbdcd, to: 0xbdf4 },
];

function parseNames(): Array<{ name: string; address: number; only6128: boolean }> {
  const out = [];
  for (const raw of readFileSync(join(REPO, 'tools', 'firmware-names.txt'), 'utf8').split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const m = /^([A-Z][A-Z0-9_]*) &([0-9A-F]{4})( \[6128\])?$/.exec(line);
    if (!m) throw new Error(`bad line: ${raw}`);
    out.push({ name: m[1] as string, address: parseInt(m[2] as string, 16), only6128: m[3] !== undefined });
  }
  return out;
}

function walkAsm(dir: string, acc: string[] = []): string[] {
  for (const f of readdirSync(dir).sort()) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walkAsm(p, acc);
    else if (f.endsWith('.asm')) acc.push(p);
  }
  return acc;
}

describe('FIRMWARE table', () => {
  const rows = parseNames();

  it('matches tools/firmware-names.txt, in file order', () => {
    expect([...FIRMWARE].map(([name, e]) => ({ name, address: e.address, only6128: e.only6128 }))).toEqual(rows);
  });

  it('is what tools/gen-firmware.py writes (--check)', () => {
    let ok = true;
    try {
      execFileSync('python3', [join(REPO, 'tools', 'gen-firmware.py'), '--check'], { stdio: 'pipe' });
    } catch {
      ok = false;
    }
    expect(ok).toBe(true);
  });

  it('has upper-case names, unique addresses, all inside &B900-&BDFF', () => {
    const addrs = new Set<number>();
    for (const [name, e] of FIRMWARE) {
      expect(name).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(e.address).toBeGreaterThanOrEqual(0xb900);
      expect(e.address).toBeLessThanOrEqual(0xbdff);
      expect(addrs.has(e.address), `${name} repeats an address`).toBe(false);
      addrs.add(e.address);
    }
    expect(addrs.size).toBe(FIRMWARE.size);
  });

  it('puts every entry in a jumpblock, on a 3-byte step from the block start', () => {
    for (const [name, e] of FIRMWARE) {
      const b = BLOCKS.find((x) => e.address >= x.from && e.address <= x.to);
      expect(b, `${name} is outside the jumpblocks`).toBeDefined();
      expect((e.address - (b?.from ?? 0)) % 3, `${name} is off the 3-byte step`).toBe(0);
    }
  });

  it('holds the known entries and the 6128-only ones', () => {
    expect(FIRMWARE.get('KM_WAIT_KEY')).toEqual({ address: 0xbb18, only6128: false });
    expect(FIRMWARE.get('MC_WAIT_FLYBACK')?.address).toBe(0xbd19);
    expect(FIRMWARE.get('KL_FIND_COMMAND')?.address).toBe(0xbcd4);
    expect(FIRMWARE.get('KL_BANK_SWITCH')).toEqual({ address: 0xbd5b, only6128: true });
    const only = [...FIRMWARE].filter(([, e]) => e.only6128).map(([n]) => n);
    expect(only).toEqual(expect.arrayContaining(['KM_SET_LOCKS', 'TXT_ASK_STATE', 'GRA_DEFAULT', 'SCR_SET_POSITION', 'MC_PRINT_TRANSLATION', 'KL_BANK_SWITCH']));
    expect(FIRMWARE.get('TXT_OUTPUT')?.only6128).toBe(false);
  });

  it('agrees with the runtime headers: every NAME next to a firmware address is the table entry at that address', () => {
    const byAddr = new Map([...FIRMWARE].map(([n, e]) => [e.address, n]));
    const seen = new Set<string>();
    for (const file of walkAsm(join(REPO, 'lib', 'runtime'))) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const m = /\$([0-9A-Fa-f]{4})\b[^;\n]*;\s*([A-Z]+_[A-Z0-9_]+)\b/.exec(line);
        if (!m) continue;
        const addr = parseInt(m[1] as string, 16);
        if (addr < 0xb900 || addr > 0xbdff) continue;
        const name = m[2] as string;
        expect(FIRMWARE.get(name)?.address, `${file}: ${name}`).toBe(addr);
        expect(byAddr.get(addr)).toBe(name);
        seen.add(name);
      }
    }
    expect(seen.size).toBeGreaterThan(8);
  });

  it('has every firmware name the runtime headers mention that is a real entry, at one address', () => {
    // Names such as TXT_COLS or SOUND_BLK are runtime labels, not entries: they are not in the table.
    const mentioned = new Set<string>();
    for (const file of walkAsm(join(REPO, 'lib', 'runtime'))) {
      for (const m of readFileSync(file, 'utf8').matchAll(/\b(?:KL|KM|TXT|GRA|SCR|CAS|SOUND|MC)_[A-Z0-9_]+\b/g)) mentioned.add(m[0]);
    }
    for (const name of ['KM_WAIT_KEY', 'KM_READ_CHAR', 'TXT_OUTPUT', 'SCR_SET_MODE', 'GRA_PLOT_ABSOLUTE', 'MC_PRINT_CHAR', 'SOUND_QUEUE', 'KL_TIME_PLEASE', 'CAS_IN_OPEN', 'KL_ROM_WALK']) {
      expect(mentioned.has(name), `${name} is no longer in the headers`).toBe(true);
      expect(FIRMWARE.has(name), name).toBe(true);
    }
  });
});
