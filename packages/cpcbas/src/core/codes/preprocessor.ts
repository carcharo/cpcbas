/** Codes 120-139: preprocessor. Owner: task L1-PP. */
import type { CodeTable } from '../diagnostics.js';

export const PREPROCESSOR_CODES = {
  E120: { severity: 'error', title: 'Include file not found' },
  E121: { severity: 'error', title: 'Include cycle' },
  E122: { severity: 'error', title: 'Unknown preprocessor directive' },
  E123: { severity: 'error', title: '#else, #elif or #endif without #if' },
  E124: { severity: 'error', title: '#if without #endif' },
  E125: { severity: 'error', title: 'Invalid #if expression' },
  E126: { severity: 'error', title: 'Wrong number of macro arguments' },
  E127: { severity: 'error', title: '#error' },
  W128: { severity: 'warning', title: '#warning' },
  W129: { severity: 'warning', title: 'Macro redefined' },
  E130: { severity: 'error', title: 'Malformed directive' },
  // 131-139: free for L1-PP
} as const satisfies CodeTable;
