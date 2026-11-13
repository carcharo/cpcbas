/**
 * L5-CG: the integer, REAL, array and string template suites again with the `short` template style (and register temps), so every
 * operand-kind and value table checks the level's forms against the same model as the stack forms (test/temps-env.ts).
 */
import { setStyle } from '../../test/temps-env.js';

setStyle('short');
await import('./int.test.js');
await import('./real.test.js');
await import('./array.test.js');
await import('./str.test.js');
await import('./temps.test.js');
