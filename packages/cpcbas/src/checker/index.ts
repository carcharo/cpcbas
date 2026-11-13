/**
 * The checker (task L2-CHECK; contract: sem/model.ts, CheckFn). Types every expression,
 * makes conversions explicit, folds constants, checks lvalues, calls, EXIT/CONTINUE targets
 * and bare-mode limits, and gates the L2 subset (subset.ts).
 * `IMPLEMENTED` gates the tests that need a real checker.
 */
import type { CheckFn } from '../sem/model.js';
import { checkProgram } from './check.js';

export const IMPLEMENTED = true;

export { checkProgram, type CheckOptions } from './check.js';

export const check: CheckFn = (input) => checkProgram(input, { subset: true });
