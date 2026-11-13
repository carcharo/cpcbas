/**
 * Code generation and linking (tasks L2-CG-* replace these stubs; contract:
 * codegen/types.ts). `IMPLEMENTED` gates the tests that need code generation.
 * Template tables are merged here: each template task appends its import and its table
 * to TEMPLATES (append-only edit).
 */
import { ARRAY_REGISTER_FORMS, ARRAY_TEMPLATES } from './array.js';
import { FLOW_REGISTER_FORMS, FLOW_TEMPLATES } from './flow.js';
import { generateWith } from './generate.js';
import { INT_COMPARE_JUMPS, INT_REGISTER_FORMS, INT_TEMPLATES } from './int.js';
import { REAL_COMPARE_JUMPS, REAL_REGISTER_FORMS, REAL_TEMPLATES } from './real.js';
import { STR_COMPARE_JUMPS, STR_REGISTER_FORMS, STR_TEMPLATES } from './str.js';
import type { CompareJumpTable, GenerateFn, RegisterFormTable, TemplateTable } from './types.js';

export type * from './types.js';
export { makeTarget } from './target.js';
export { RequireSet, MEMINITS, FORCED_FILES } from './requires.js';
export { FIRMWARE_MAP, BARE_MAP, DEFAULT_ORG, DEFAULT_HEAP_SIZE, memoryMapEqus } from './memory-map.js';
export { link } from './link.js';

export const IMPLEMENTED = true;

/** Every template, by key (codegen/types.ts, TemplateTable). Later tables do not override earlier keys: a duplicate key is a bug the test suite catches. */
export const TEMPLATES: readonly TemplateTable[] = [INT_TEMPLATES, FLOW_TEMPLATES, STR_TEMPLATES, REAL_TEMPLATES, ARRAY_TEMPLATES];

/**
 * Register forms by template key (L5-TEMPS, codegen/types.ts `RegisterFormTable`): which templates can leave a result in the
 * result registers and take a temp operand from them. Each table file adds its own (append-only, like TEMPLATES).
 */
export const REGISTER_FORMS: RegisterFormTable = { ...INT_REGISTER_FORMS, ...FLOW_REGISTER_FORMS, ...REAL_REGISTER_FORMS, ...ARRAY_REGISTER_FORMS, ...STR_REGISTER_FORMS };

/** Compare-and-branch templates by `cmpjump:<op>:<type>` (L5-TEMPS). */
export const COMPARE_JUMPS: CompareJumpTable = { ...INT_COMPARE_JUMPS, ...REAL_COMPARE_JUMPS, ...STR_COMPARE_JUMPS };

/** Tests that pass their own templates get stack forms only (the tables above describe the shipped templates). */
export const generate: GenerateFn = (input) => (input.templates === undefined ? generateWith(input, TEMPLATES, REGISTER_FORMS, COMPARE_JUMPS) : generateWith(input, TEMPLATES));
