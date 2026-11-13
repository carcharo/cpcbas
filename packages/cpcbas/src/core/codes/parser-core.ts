/** Codes 140-159 (parser core, expressions) and 960-969 (Boriel operators). Owner: task L1-PCORE. */
import type { CodeTable } from '../diagnostics.js';

export const PARSER_CORE_CODES = {
  E140: { severity: 'error', title: 'Syntax error' },
  E141: { severity: 'error', title: 'Unexpected token' },
  E142: { severity: 'error', title: 'Expected an expression' },
  E143: { severity: 'error', title: 'Missing closing parenthesis' },
  E144: { severity: 'error', title: 'Expected end of statement' },
  E145: { severity: 'error', title: 'Duplicate line number' },
  E146: { severity: 'error', title: 'TAB and SPC only work inside PRINT', hint: 'Use SPACE$(n) for a run of spaces anywhere else.' },
  E147: { severity: 'error', title: 'Wrong number of arguments' },
  E148: { severity: 'error', title: 'Expected a line number or a label' },
  E149: { severity: 'error', title: 'Expected a type name', hint: 'The types are UBYTE, BYTE, UINTEGER, INTEGER, ULONG, LONG, FIXED, REAL and STRING.' },
  E150: { severity: 'error', title: 'Expected a variable', hint: 'Write a variable name, or an array element such as a(i).' },
  E151: { severity: 'error', title: 'Statements are nested too deeply' },
  E152: {
    severity: 'error',
    title: 'A reserved word cannot be a name',
    hint: 'Choose another name. Every keyword of the language is reserved, the Locomotive BASIC ones included.',
  },
  // 153-159: free for L1-PCORE
  E960: { severity: 'error', title: 'bAND, bOR, bXOR and bNOT are not CPC BASIC', hint: 'AND, OR, XOR and NOT are already bitwise.' },
  E961: { severity: 'error', title: 'A dropped Sinclair function' },
  E962: {
    severity: 'error',
    title: 'String slicing is not CPC BASIC',
    hint: 'Use MID$(s$, start, length). Slices count from 0, so a$(2 TO 4) is MID$(a$, 3, 3).',
  },
  // 963-969: free for L1-PCORE
} as const satisfies CodeTable;
