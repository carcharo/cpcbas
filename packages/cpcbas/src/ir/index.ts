/**
 * IR lowering, printer and verifier (tasks L2-IRKIT and L2-LOWER replace these stubs;
 * contract: ir/ir.ts and docs/ir.md). `IMPLEMENTED` gates the tests that need lowering.
 */
import type { LowerFn } from './ir.js';
import { lowerProgram } from './lower/index.js';

export type * from './ir.js';
export { printIr } from './print.js';
export { verifyIr } from './verify.js';

export const IMPLEMENTED = true;

export const lower: LowerFn = lowerProgram;
