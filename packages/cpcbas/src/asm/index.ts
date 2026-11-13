/**
 * The assembler (tasks L2-ENC, L2-ASMPP and L2-ASM replace these stubs; each owns its own module and re-exports it here). Contract: asm/types.ts.
 * `IMPLEMENTED` gates the golden suite (test/asm-golden.test.ts); L2-ASM sets it to true.
 */
export type * from './types.js';

export const IMPLEMENTED = true;

export { encode } from './z80/encode.js';

export { preprocessAsm } from './preprocess.js';

export { assemble } from './assemble.js';
export { flatten } from './image.js';
export { formatMap } from './map.js';
