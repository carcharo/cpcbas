/**
 * L5-TEMPS: the integer, REAL, array and string template suites again, with register temps on (test/temps-env.ts). Their tables of
 * operand kinds (immediate, temp, global, frame, BYREF) and values put a loaded temp next to every consumer, so each register form
 * is checked against the model the stack form is. The suites are imported here, after the switch, so this file runs them once.
 */
import { setTempsOn } from '../../test/temps-env.js';

setTempsOn(true);
await import('./int.test.js');
await import('./real.test.js');
await import('./array.test.js');
await import('./str.test.js');
