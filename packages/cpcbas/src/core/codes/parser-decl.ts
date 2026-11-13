/** Codes 160-169 (declarations, procedures) and 970-979 (Boriel statements/declarations). Owner: task L1-PDECL. */
import type { CodeTable } from '../diagnostics.js';

export const PARSER_DECL_CODES = {
  E160: { severity: 'error', title: 'Procedures cannot be nested', hint: 'Close the outer SUB or FUNCTION with END SUB or END FUNCTION first; define every procedure at the top level.' },
  E161: { severity: 'error', title: 'SUB or FUNCTION is never closed' },
  E162: { severity: 'error', title: 'Wrong end of procedure', hint: 'END SUB closes a SUB and END FUNCTION closes a FUNCTION.' },
  E163: { severity: 'error', title: 'Missing closing brace in an initialiser', hint: 'Add the missing }.' },
  E164: { severity: 'error', title: 'Bad letter range', hint: 'Write single letters, for example DEFINT a-c, x.' },
  E165: { severity: 'error', title: 'Unknown OPTION', hint: 'The only option is OPTION REAL.' },
  E166: { severity: 'error', title: 'A SUB has no result type', hint: 'Use FUNCTION name(...) AS type for a procedure that returns a value.' },
  // 167-169: free for L1-PDECL
  E970: { severity: 'error', title: 'Array bounds are 0-based', hint: 'Write the highest index: DIM a(5) has elements 0 to 5.' },
  E971: { severity: 'error', title: 'TYPE is not in 1.0', hint: 'Use arrays instead of records.' },
  E972: { severity: 'error', title: 'PRIVATE is not in 1.0', hint: 'Remove PRIVATE; every SUB and FUNCTION is visible to the whole program.' },
  // 973-979: free for L1-PDECL
} as const satisfies CodeTable;
