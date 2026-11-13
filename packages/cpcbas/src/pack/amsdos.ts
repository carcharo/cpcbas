/**
 * The 128-byte AMSDOS file header. Byte-identical to the fork's `tools/cpc/mkdsk.py`
 * (`build_amsdos_header`).
 */
import type { AmsdosHeaderFields, BuildAmsdosHeaderFn, PackResult } from './types.js';
import { AMSDOS_BINARY } from './types.js';

export const AMSDOS_HEADER_SIZE = 128;
const CHECKSUM_RANGE = 67; // bytes 0..66 are summed

/**
 * Splits a name into the 8-byte and 3-byte upper-case, space-padded fields, as mkdsk.py does:
 * trim, upper-case, split at the last dot, truncate to 8 and 3.
 */
export function amsdosNameParts(name: string): PackResult<{ base: Uint8Array; ext: Uint8Array }> {
  const bad = (why: string): PackResult<never> => ({ ok: false, error: { code: 'E601', message: `invalid AMSDOS file name ${JSON.stringify(name)}: ${why}` } });
  const upper = name.trim().toUpperCase();
  // eslint-disable-next-line no-control-regex
  if (!/^[\x00-\x7f]*$/.test(upper)) return bad('only ASCII characters are allowed');
  const dot = upper.lastIndexOf('.');
  const base = (dot >= 0 ? upper.slice(0, dot) : upper).slice(0, 8);
  const ext = (dot >= 0 ? upper.slice(dot + 1) : '').slice(0, 3);
  if (base === '') return bad('the name is empty');
  const field = (s: string, n: number): Uint8Array => {
    const out = new Uint8Array(n).fill(0x20);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  };
  return { ok: true, value: { base: field(base, 8), ext: field(ext, 3) } };
}

const invalid = (message: string): PackResult<never> => ({ ok: false, error: { code: 'E603', message } });

export const buildAmsdosHeader: BuildAmsdosHeaderFn = (f: AmsdosHeaderFields) => {
  const parts = amsdosNameParts(f.name);
  if (!parts.ok) return parts;
  const user = f.user ?? 0;
  const fileType = f.fileType ?? AMSDOS_BINARY;
  if (!Number.isInteger(f.length) || f.length < 0 || f.length > 0xffffff) return invalid(`AMSDOS file length ${f.length} is outside 0..16777215`);
  if (!Number.isInteger(user) || user < 0 || user > 255) return invalid(`AMSDOS user number ${user} is outside 0..255`);

  const h = new Uint8Array(AMSDOS_HEADER_SIZE);
  h[0x00] = user;
  h.set(parts.value.base, 0x01);
  h.set(parts.value.ext, 0x09);
  h[0x12] = fileType;
  const load = f.loadAddress & 0xffff;
  const entry = f.entryAddress & 0xffff;
  h[0x15] = load & 0xff;
  h[0x16] = load >> 8;
  h[0x18] = f.length & 0xff;
  h[0x19] = (f.length >> 8) & 0xff;
  h[0x1a] = entry & 0xff;
  h[0x1b] = entry >> 8;
  h[0x40] = f.length & 0xff;
  h[0x41] = (f.length >> 8) & 0xff;
  h[0x42] = (f.length >> 16) & 0xff;
  let sum = 0;
  for (let i = 0; i < CHECKSUM_RANGE; i++) sum += h[i]!;
  sum &= 0xffff;
  h[0x43] = sum & 0xff;
  h[0x44] = sum >> 8;
  return { ok: true, value: h };
};
