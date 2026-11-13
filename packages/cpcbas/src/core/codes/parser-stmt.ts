/**
 * Codes 185-199 (other statements, ASM blocks, directives), 900-949 (Sinclair forms)
 * and 980-999 (Locomotive forms that do not apply to a compiler or are not in 1.0).
 * Owner: task L1-PSTMT.
 */
import type { CodeTable } from '../diagnostics.js';

export const PARSER_STMT_CODES = {
  E185: { severity: 'error', title: 'Too many parameters', hint: 'CALL and RSX commands pass at most 32 parameters.' },
  E186: {
    severity: 'error',
    title: 'A directive inside an ASM block is not supported',
    hint: 'Write #pragma, #require and #init before the ASM line.',
  },
  E187: { severity: 'error', title: 'Malformed directive' },
  E188: { severity: 'error', title: 'The zxnext pragma is not available', hint: 'CPC BASIC does not target the ZX Spectrum Next.' },
  W189: { severity: 'warning', title: '#line has no effect in BASIC source', hint: '#line only matters inside generated assembler.' },
  E190: { severity: 'error', title: 'LINE INPUT reads one variable', hint: 'Write LINE INPUT [#s,] [prompt;] a$.' },
  E191: { severity: 'error', title: 'WRITE has a separator with no item after it', hint: 'Locomotive stops with Operand missing: write WRITE [#s,] item, item.' },
  // 192-199: free for L1-PSTMT (192 is L4-FILES', unused)
  E900: { severity: 'error', title: 'Dropped Sinclair statement' },
  E901: {
    severity: 'error',
    title: 'INK n needs a colour',
    hint: 'To set the text colour use PEN n; INK n, c sets the colour of pen n.',
  },
  // 904-949: free for L1-PSTMT
  E980: { severity: 'error', title: 'Interpreter command: not applicable in a compiler' },
  E981: { severity: 'error', title: 'Not in 1.0' },
  // 982-999: free for L1-PSTMT
} as const satisfies CodeTable;
