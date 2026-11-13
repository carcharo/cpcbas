/** Codes 400-419: memory-layout check. Owner: task L2-LAYOUT. */
import type { CodeTable } from '../diagnostics.js';

export const LAYOUT_CODES = {
  E400: {
    severity: 'error',
    title: 'Code or data overlaps a reserved range',
    hint: 'Move the program (--org) or the data (#pragma hidata) out of the range, or drop the library that reserves it.',
  },
  E401: {
    severity: 'error',
    title: 'Code or data ends past the memory limit',
    hint: 'Make the program smaller, or move the data to a lower address; the private runtime block (firmware) or the stack (bare metal) starts at the limit.',
  },
  E402: {
    severity: 'error',
    title: 'Code or data overlaps the heap',
    hint: 'Lower the origin or shrink the program, or move the heap (--heap-address, --heap).',
  },
  E403: {
    severity: 'error',
    title: 'The heap overlaps a reserved range',
    hint: 'Move the heap (--heap-address) or make it smaller (--heap).',
  },
  E404: {
    severity: 'error',
    title: 'Origin below the lowest usable address',
    hint: 'Use an origin (--org, #pragma org) of 0x0040 or higher.',
  },
  E405: {
    severity: 'error',
    title: 'Code or data overlaps the AMSDOS file buffers',
    hint: 'A program that uses files gives AMSDOS 2 KB under the private block for the input stream and 2 KB more for the output stream: make the program smaller, or move the data lower.',
  },
  E406: {
    severity: 'error',
    title: 'The heap overlaps the AMSDOS file buffers',
    hint: 'Move the heap (--heap-address) below the file buffers or make it smaller (--heap); without --heap-address it is placed below them.',
  },
  // 407-419: free for L2-LAYOUT
} as const satisfies CodeTable;
