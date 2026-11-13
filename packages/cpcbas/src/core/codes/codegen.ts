/**
 * Codes 420-449: code generation and linking (missing runtime file, #require, #init). Owner: task L2-CG-LINK.
 * Codes 570-571: the optimiser's options (L5-0; `src/opt/index.ts`). The optimiser reports its internal errors as E001.
 */
import type { CodeTable } from '../diagnostics.js';

export const CODEGEN_CODES = {
  E420: {
    severity: 'error',
    title: 'Runtime file not found',
    hint: 'The runtime library tree does not contain this file; check that the library is installed and complete.',
  },
  E421: {
    severity: 'error',
    title: '#require file not found',
    hint: 'The path is looked up in the runtime library as runtime/<path>, then <path> (our loco/ files); check the spelling, such as "print.asm".',
  },
  E422: {
    severity: 'error',
    title: '#init routine is not defined',
    hint: 'Define the label in an ASM block or a #require d file, or remove the #init.',
  },
  E570: {
    severity: 'error',
    title: 'Unknown optimisation level',
    hint: "The level is 0, 1, 2, 3 or 's' (the CLI's -O0 .. -O3 and -Os); leave it out for the default, -O2.",
  },
  E571: {
    severity: 'error',
    title: 'Unknown optimisation pass name',
    hint: 'A name for --opt-disable is a pass, a rule or a feature (temps, cmpjump, templates, ...); docs/optimisation.md lists them.',
  },
  E574: {
    severity: 'error',
    title: 'Syntax error in a peephole rule file',
    hint: 'Raised by tools/gen-rules.mjs, not by a compile: a rules/*.opt file has a malformed region, scalar or IF expression, or no SPDX line.',
  },
  E575: {
    severity: 'error',
    title: 'Error in a peephole rule',
    hint: 'Raised by tools/gen-rules.mjs, not by a compile: a rule binds a variable twice, uses one it does not bind, or names a function that does not exist.',
  },
} as const satisfies CodeTable;
