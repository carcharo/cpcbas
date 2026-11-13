/**
 * Runtime labels to the files that define them: the imported runtime's table
 * (labels.gen.ts, generated from the reference compiler) plus our own Locomotive layer
 * under lib/loco (loco-labels.ts, written by hand). Code generation asks here which file
 * to link for a label.
 */

import { RUNTIME_LABEL_FILES } from './labels.gen.js';
import { LOCO_LABEL_FILES } from './loco-labels.js';

/** The file under the lib root that defines `label` (`print.asm` is lib/runtime/print.asm; `loco/text.asm` is lib/loco/text.asm), or undefined. */
export function runtimeLabelFile(label: string): string | undefined {
  return LOCO_LABEL_FILES[label] ?? RUNTIME_LABEL_FILES[label];
}
