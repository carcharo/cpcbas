/**
 * The binder (task L2-BIND; contract: sem/model.ts, BindFn). Scopes, symbols, implicit
 * declarations, DEF* ranges, procedures, labels, DATA, constants and build settings.
 * `IMPLEMENTED` gates the tests that need a real binder.
 */
import type { BindFn } from '../sem/model.js';
import { bindProgram } from './bind.js';

export const IMPLEMENTED = true;

export const bind: BindFn = (input) => bindProgram(input);
