/** Codes 170-184: control flow. Owner: task L1-PCTRL. */
import type { CodeTable } from '../diagnostics.js';

export const PARSER_CONTROL_CODES = {
  E170: { severity: 'error', title: 'IF without THEN', hint: 'Write IF condition THEN statements.' },
  E171: { severity: 'error', title: 'Block never closed' },
  E172: { severity: 'error', title: 'NEXT, WEND or LOOP without its opening statement' },
  E173: { severity: 'error', title: 'NEXT variable does not match the FOR variable', hint: 'NEXT names the loop it closes. To close two loops at once, list the inner one first: NEXT j, i.' },
  E174: {
    severity: 'error',
    title: 'NEXT, WEND or LOOP inside a one-line IF',
    hint: 'A loop must end in the same block that opened it. Put the NEXT on its own line, or leave the loop early with EXIT FOR, EXIT WHILE or EXIT DO.',
  },
  E175: { severity: 'error', title: 'Block end or clause without its opening statement' },
  E176: { severity: 'error', title: 'NEXT names more loops than are open', hint: 'List only the loops that are open, innermost first.' },
  E177: { severity: 'error', title: 'EXIT or CONTINUE needs a target' },
  E178: { severity: 'error', title: 'Misplaced part of SELECT CASE' },
  // 179: retired (RESUME is compiled since L4-ERR)
  E180: { severity: 'error', title: 'Expected GOTO or GOSUB' },
  E181: { severity: 'error', title: 'ON BREAK needs STOP or CONT' },
  E182: { severity: 'error', title: 'RESUME needs NEXT, a line number or a label' },
  // 183-184: free for L1-PCTRL
} as const satisfies CodeTable;
