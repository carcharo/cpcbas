/** Codes 500-519: Z80 instruction encoding. Owner: task L2-ENC. */
import type { CodeTable } from '../diagnostics.js';

export const ASM_ENCODE_CODES = {
  E500: { severity: 'error', title: 'Unknown instruction' },
  E501: { severity: 'error', title: 'Invalid operands for this instruction' },
  E502: { severity: 'error', title: 'Relative jump out of range', hint: 'Use JP, which reaches any address.' },
  E503: { severity: 'error', title: 'Index displacement out of range' },
  W504: { severity: 'warning', title: 'Value will be truncated' },
  // 505-519: free for L2-ENC
} as const satisfies CodeTable;
