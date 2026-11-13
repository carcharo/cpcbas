/** Codes 100-119 (lexer) and 950-959 (Boriel lexical forms). Owner: task L1-LEX. */
import type { CodeTable } from '../diagnostics.js';

export const LEXER_CODES = {
  E101: { severity: 'error', title: 'Unexpected character' },
  W102: { severity: 'warning', title: 'String not closed; closed at the end of the line', hint: 'Add the closing ".' },
  E103: { severity: 'error', title: 'Block comment not closed', hint: "Close it with '/." },
  E104: { severity: 'error', title: 'Malformed number' },
  E105: { severity: 'error', title: 'Number too large' },
  E106: { severity: 'error', title: 'ASM block not closed', hint: 'End it with END ASM on a line of its own.' },
  E107: { severity: 'error', title: 'Reserved word used as a name' },
  E108: { severity: 'error', title: 'Line continuation at the end of the file', hint: 'Remove the _, or put the rest of the statement on the next line.' },
  E109: { severity: 'error', title: 'Unexpected text after a quoted DATA item', hint: 'Put a comma between DATA items.' },
  // 110-119: free for L1-LEX
  E950: { severity: 'error', title: "Boriel's $ hex prefix is not accepted", hint: 'Write &FF (or &HFF, 0xFF).' },
  // 951-959: free for L1-LEX
} as const satisfies CodeTable;
