/** The reference assembler's `-M` map text (contract: asm/types.ts, FormatMapFn). */
import type { FormatMapFn } from './types.js';

/** `extra` are labels the compiler adds that no source line defines (`.__HIDATA_BACK_0`). */
export const formatMap: FormatMapFn = (result, extra = []) => {
  const lines: string[] = [];
  for (const s of extra) lines.push(`${s.value.toString(16).toUpperCase().padStart(4, '0')}: ${s.name}`);
  for (const s of result.symbolsByAddress) {
    if (s.inMap) {
      lines.push(`${s.value.toString(16).toUpperCase().padStart(4, '0')}: ${s.name}`);
    }
  }
  lines.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return lines.join('\n');
};
