/**
 * Codes 200-229 (names, declarations, labels) and 300-319 (unused, implicit). Owner: task
 * L2-BIND (add codes in these ranges).
 */
import type { CodeTable } from '../diagnostics.js';

export const BINDER_CODES = {
  E200: { severity: 'error', title: 'Undefined line number or label', hint: 'Add the line or label, or fix the number or spelling in the jump.' },
  E201: { severity: 'error', title: 'Duplicate label', hint: 'Labels must be unique in the whole program; rename one. (A repeated line number is the parser\'s E145.)' },
  E202: { severity: 'error', title: 'Duplicate declaration', hint: 'Remove one of the declarations, or give them different names.' },
  E203: { severity: 'error', title: 'Suffix contradicts the declared type', hint: 'Remove the suffix, or make the AS type agree with it.' },
  E204: { severity: 'error', title: 'Not an array or a FUNCTION', hint: 'DIM the array first: DIM name(10).' },
  E205: { severity: 'error', title: 'Undefined SUB, FUNCTION or DEF FN', hint: 'Define it with SUB, FUNCTION or DEF FN, or fix the spelling.' },
  E206: { severity: 'error', title: 'Variable used without DIM under #pragma explicit', hint: 'DIM the variable first, or remove #pragma explicit.' },
  E207: { severity: 'error', title: 'Jump into or out of a procedure', hint: 'GOTO and GOSUB must stay inside the main program or inside one procedure; call a SUB instead.' },
  E208: { severity: 'error', title: 'A FUNCTION and an array have the same name', hint: 'Both would be written name(...); rename one.' },
  E209: { severity: 'error', title: 'More than 4 dimensions', hint: 'Arrays have at most 4 dimensions.' },
  E210: { severity: 'error', title: 'Two names give the same assembler label', hint: 'Rename one; names containing two underscores can collide with the labels the compiler makes (a% becomes _a__i).' },
  E211: { severity: 'error', title: 'Bad value for a pragma', hint: 'Write a whole number in decimal, &H hex or 0x hex (0 to 65535).' },
  E212: { severity: 'error', title: '#pragma pop without a matching push', hint: 'Write #pragma push(name) first.' },
  E213: { severity: 'error', title: 'DECLARE does not match the definition', hint: 'The parameters (count, types, BYREF or BYVAL) and the result type must be the same as in the SUB or FUNCTION.' },
  E214: { severity: 'error', title: 'Handler target must be a main-program label', hint: 'The target of ON ERROR GOTO, RESUME, EVERY and AFTER is main-program code: put the label outside any SUB or FUNCTION.' },
  W300: { severity: 'warning', title: 'Variable declared implicitly', hint: 'DIM the variable, or turn this warning off.' },
  W301: { severity: 'warning', title: 'Variable is read but never assigned', hint: 'Assign it a value, or remove it.' },
  W302: { severity: 'warning', title: 'DEF statement after the variable was first used', hint: 'Put DEFINT, DEFREAL and DEFSTR before the first use of the variables they cover.' },
  W303: { severity: 'warning', title: 'Unknown pragma ignored', hint: 'The pragmas are explicit, org, heap_size, heap_address and hidata.' },
  W304: { severity: 'warning', title: 'A declaration hides a firmware entry name', hint: 'The name is a built-in constant for a firmware entry; your declaration wins here. Rename it to use the entry.' },
  W305: { severity: 'warning', title: 'DECLARE without a definition', hint: 'Define the SUB or FUNCTION, or remove the DECLARE.' },
  W306: { severity: 'warning', title: 'Procedure is never called; it is not compiled', hint: 'Call it, take its address with @name, or remove it. Procedures nothing reaches are left out of the program.' },
} as const satisfies CodeTable;
