/**
 * The `.cpr` Plus cartridge writer: a RIFF "AMS!" file of 16 KB `cbNN` chunks, page 0 the boot stub
 * (it copies the image from the upper-ROM window at &C000 to RAM, pages the ROMs out, copies a
 * 14-byte tail to &C000 and jumps to the entry), pages 1..N the image.
 *
 * Provenance: adapted from CPC Game Studio's `mkcpr.ts` (MIT licence), itself a port of cpcbuild's
 * `tools/mkcpr.py`. Changes: errors are `PackError` values (codes 602-604) instead of exceptions;
 * the map-reading helper is dropped. Output is byte-identical to the Studio fixtures.
 */
import type { BuildCprFn, PackResult } from './types.js';

export const PAGE = 0x4000;
export const MAX_PAGES = 32;
const TAIL_ADDR = 0xc000;
export const RAM_TOP = 0xc000;

const hex4 = (v: number): string => v.toString(16).toUpperCase().padStart(4, '0');
const hex2 = (v: number): string => v.toString(16).toUpperCase().padStart(2, '0');
/** A 16-bit value as little-endian bytes. */
const w = (v: number): number[] => [v & 0xff, v >> 8];

/** The page-0 boot stub (Z80 bytes, the tail included) and its listing. */
export function buildStub(load: number, entry: number, length: number): { code: Uint8Array; listing: string[] } {
  const tail = [
    0x01, ...w(0x7fc0), 0xed, 0x49, //  ld bc,&7FC0 ; out (c),c  RAM configuration normal
    0x01, ...w(0x7f8d), 0xed, 0x49, //  ld bc,&7F8D ; out (c),c  lower ROM off too, mode 1
    0xc3, ...w(entry), //               jp entry
  ];
  const ins: Array<[number[], string]> = [
    [[0xf3], 'di'],
    [[0x01, ...w(0x7f81)], 'ld bc,&7F81        ; GA RMR: mode 1, lower and upper ROM on'],
    [[0xed, 0x49], 'out (c),c'],
  ];
  const npages = Math.floor((length + PAGE - 1) / PAGE);
  let dst = load;
  let left = length;
  for (let n = 1; n <= npages; n++) {
    const chunk = Math.min(PAGE, left);
    ins.push(
      [[0x01, ...w(0xdf80 + n)], `ld bc,&DF${hex2(0x80 + n)}        ; upper ROM = cartridge page ${n}`],
      [[0xed, 0x49], 'out (c),c'],
      [[0x21, ...w(0xc000)], 'ld hl,&C000'],
      [[0x11, ...w(dst)], `ld de,&${hex4(dst)}`],
      [[0x01, ...w(chunk)], `ld bc,&${hex4(chunk)}`],
      [[0xed, 0xb0], 'ldir'],
    );
    dst += chunk;
    left -= chunk;
  }
  ins.push([[0x01, ...w(0x7f89)], 'ld bc,&7F89        ; RMR: upper ROM off (lower still on)'], [[0xed, 0x49], 'out (c),c']);
  // the tail follows the 5 instructions below (3 + 3 + 3 + 2 + 3 = 14 bytes)
  const tailAt = ins.reduce((n, [b]) => n + b.length, 0) + 14;
  ins.push(
    [[0x21, ...w(tailAt)], `ld hl,&${hex4(tailAt)}        ; the tail (below)`],
    [[0x11, ...w(TAIL_ADDR)], 'ld de,&C000'],
    [[0x01, ...w(tail.length)], `ld bc,${tail.length}`],
    [[0xed, 0xb0], 'ldir'],
    [[0xc3, ...w(TAIL_ADDR)], 'jp &C000'],
  );
  const code: number[] = [];
  const listing: string[] = [];
  for (const [b, text] of ins) {
    listing.push(`${hex4(code.length)}  ${b.map(hex2).join(' ').padEnd(12)} ${text}`);
    code.push(...b);
  }
  if (code.length !== tailAt) throw new Error('internal error: the boot stub changed size');
  listing.push(`${hex4(tailAt)}  tail, copied to RAM at &C000 (${tail.length} bytes):`);
  listing.push('      01 C0 7F ED 49  ld bc,&7FC0 ; out (c),c   RAM configuration normal');
  listing.push('      01 8D 7F ED 49  ld bc,&7F8D ; out (c),c   lower ROM off too, mode 1');
  listing.push(`      C3 ${hex2(entry & 0xff)} ${hex2(entry >> 8)}        jp &${hex4(entry)}`);
  return { code: Uint8Array.from([...code, ...tail]), listing };
}

export const buildCpr: BuildCprFn = (input): PackResult<Uint8Array> => {
  const { image, loadAddress: load } = input;
  const entry = input.entryAddress ?? load;
  const fail = (code: 'E602' | 'E603' | 'E604', message: string): PackResult<never> => ({ ok: false, error: { code, message } });
  if (image.length === 0) return fail('E604', 'empty program image');
  const ok16 = (v: number): boolean => Number.isInteger(v) && v >= 0 && v <= 0xffff;
  if (!ok16(load) || !ok16(entry)) return fail('E603', 'load/entry must be 16-bit addresses');
  if (load + image.length > RAM_TOP) {
    return fail('E602', `program &${hex4(load)}-&${hex4(load + image.length - 1)} does not fit below &${hex4(RAM_TOP)}`);
  }
  const npages = Math.floor((image.length + PAGE - 1) / PAGE);
  if (1 + npages > MAX_PAGES) return fail('E602', 'too many cartridge pages');
  const pages: Uint8Array[] = [buildStub(load, entry, image.length).code, ...Array.from({ length: npages }, (_, i) => image.subarray(i * PAGE, (i + 1) * PAGE))];
  const bodyLen = 4 + pages.length * (PAGE + 8);
  const out = new Uint8Array(8 + bodyLen);
  const dv = new DataView(out.buffer);
  out.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  dv.setUint32(4, bodyLen, true);
  out.set([0x41, 0x4d, 0x53, 0x21], 8); // AMS!
  let p = 12;
  pages.forEach((data, n) => {
    out.set(Array.from(`cb${String(n).padStart(2, '0')}`, (c) => c.charCodeAt(0)), p);
    dv.setUint32(p + 4, PAGE, true);
    out.set(data, p + 8); // a short page stays zero-padded
    p += PAGE + 8;
  });
  return { ok: true, value: out };
};
