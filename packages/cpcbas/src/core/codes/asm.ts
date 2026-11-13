/** Codes 520-569 and 580-599: assembler source, directives, symbols, asm preprocessor. Owner: task L2-ASM. (570-579 are the optimiser's, codes/codegen.ts; L5-0.) */
import type { CodeTable } from '../diagnostics.js';

export const ASM_CODES = {
  E520: { severity: 'error', title: 'Undefined label' },
  E521: { severity: 'error', title: 'Duplicate label' },
  E522: { severity: 'error', title: 'Asm syntax error' },
  // 523: unused (a missing asm include is the asm preprocessor's E560)
  E524: { severity: 'error', title: 'Illegal character in asm source' },
  E525: { severity: 'error', title: 'ORG out of range', hint: 'The CPC address space is 0 to 65535.' },
  E526: { severity: 'error', title: 'ALIGN value must be greater than 1' },
  E527: { severity: 'error', title: 'Division by zero' },
  E528: { severity: 'error', title: 'Circular definition', hint: 'A name cannot be defined in terms of itself.' },
  E529: { severity: 'error', title: 'ENDP without PROC' },
  E530: { severity: 'error', title: 'Missing ENDP', hint: 'Add ENDP to close the PROC.' },
  E531: { severity: 'error', title: 'LOCAL label is never defined in its PROC' },
  E532: { severity: 'error', title: 'No namespace to pop', hint: 'Every pop namespace needs an earlier push namespace.' },
  E533: { severity: 'error', title: 'Too many arguments for DEFS', hint: 'Write DEFS count or DEFS count, value.' },
  E534: { severity: 'error', title: 'INCBIN is not supported', hint: 'Write the bytes with DEFB, or include them as data in BASIC.' },
  E535: { severity: 'error', title: 'Code runs past address 65535' },
  E536: { severity: 'error', title: 'Expression is not a whole number' },
  E537: { severity: 'error', title: 'Output overlaps earlier output', hint: 'Two ORG blocks (or a #pragma hidata block and the program) write the same addresses; move one of them.' },
  W540: { severity: 'warning', title: 'Label already declared LOCAL' },
  // 541-559: free for L2-ASM
  // 560-579: asm preprocessor (owner: L2-ASMPP)
  E560: { severity: 'error', title: 'Include file not found', hint: 'Check the name and the include path; "name" also searches the including file\'s directory.' },
  E561: { severity: 'error', title: '#error directive reached' },
  W562: { severity: 'warning', title: '#warning directive reached' },
  E563: { severity: 'error', title: 'Unknown preprocessor directive' },
  E564: { severity: 'error', title: 'Malformed preprocessor directive' },
  E565: { severity: 'error', title: '#else or #endif without a matching #if' },
  E566: { severity: 'error', title: '#if, #ifdef or #ifndef is not closed', hint: 'Add #endif.' },
  E567: { severity: 'error', title: 'Includes nested too deeply', hint: 'A file probably includes itself; use #include once.' },
  E568: { severity: 'error', title: 'Function-like #define is not supported in asm', hint: 'Use an object-like #define (a name and a value).' },
  E569: { severity: 'error', title: 'Bad #if expression' },
  // 570-579: free for L2-ASMPP
  // 580-599: free for L2-ASM
} as const satisfies CodeTable;
