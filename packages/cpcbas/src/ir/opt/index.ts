/** The IR passes (L5-IR) and the dump helper for `--stage ir-opt`. Registered in `src/opt/index.ts`. */
export { IR_CONST, IR_COPY } from './propagate.js';
export { IR_STRENGTH } from './strength.js';
export { IR_DEAD } from './dead.js';
export { irOptTrace } from './util.js';
