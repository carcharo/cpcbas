/** The flat image the reference assembler writes as `.bin` (contract: asm/types.ts, FlattenFn). */
import type { FlattenFn, Segment } from './types.js';

export const flatten: FlattenFn = (segments: readonly Segment[]) => {
  if (segments.length === 0) return { org: 0, bytes: new Uint8Array(0) };
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of segments) {
    lo = Math.min(lo, s.org);
    hi = Math.max(hi, s.org + s.bytes.length);
  }
  const bytes = new Uint8Array(hi - lo);
  for (const s of segments) bytes.set(s.bytes, s.org - lo);
  return { org: lo, bytes };
};
