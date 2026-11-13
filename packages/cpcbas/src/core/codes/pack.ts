/** Codes 600-699: AMSDOS header, DSK and CPR writers. Owner: task L2-PACK. */
import type { CodeTable } from '../diagnostics.js';

export const PACK_CODES = {
  E600: { severity: 'error', title: 'Disc full' },
  E601: { severity: 'error', title: 'Invalid AMSDOS file name', hint: 'Use an 8.3 name in ASCII letters and digits, such as GAME.BIN.' },
  E602: { severity: 'error', title: 'Program does not fit in a cartridge' },
  E603: { severity: 'error', title: 'Invalid output option' },
  E604: { severity: 'error', title: 'Empty program image' },
  // 605-699: free for L2-PACK
} as const satisfies CodeTable;
