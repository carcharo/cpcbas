/**
 * The memory-layout check's contract: after assembly, before any output is written, check
 * that the program fits the CPC's memory map (reference: the fork's post-assembly check,
 * `check_memory_layout`, and the CPC backend's limits; codegen/memory-map.ts has the numbers).
 *
 * Checks, each one diagnostic with the reference's message text (codes in
 * core/codes/layout.ts, owned by task L2-LAYOUT):
 * - for every segment (the first is "compiled code+data", later ones "data placed at"):
 *   - overlap with a reserved range whose label the program defines:
 *     `<what> <span> overlaps 0x4000-0x7FFF, reserved because <reason>`;
 *   - end past the mode's code limit:
 *     `<what> ends at 0x%04X, past this architecture's memory limit of 0x%04X`;
 *   - overlap with the heap, when the heap is in use:
 *     `<what> <span> overlaps the heap (0x%04X-0x%04X)` (+ for data segments
 *     `: move the data, or the heap (--heap-address, --heap)`);
 * - with file buffers (`fileBufferBytes` > 0): code or data ending inside them is E405 (`<what> ... ends at 0x%04X,
 *   inside the 2 KB file buffers (0x%04X-0x%04X)`), the heap overlapping them E406;
 * - the heap overlapping a reserved range:
 *   `the heap (0x%04X-0x%04X) overlaps 0x%04X-0x%04X, reserved because <reason>`;
 * - an origin below the lowest usable address:
 *   `origin 0x%04X is below this architecture's lowest usable address of 0x%04X ($0000-$003F hold the restarts and interrupt vectors)`.
 * `<span>` is `(0x%04X-0x%04X)` for the first segment and `0x%04X-0x%04X` for the others
 * (inclusive end). Any layout error makes the CLI exit with 5.
 */

import type { DiagnosticBag } from '../core/diagnostics.js';
import type { Span } from '../core/source.js';
import type { MemoryMap } from '../codegen/memory-map.js';

export interface LayoutInput {
  readonly map: MemoryMap;
  /** Assembled segments as `[start, end)`, the main program first (asm `segments` order by org; the first is the one at the origin). */
  readonly segments: ReadonlyArray<{ readonly start: number; readonly end: number }>;
  /** From the link step (`LinkedAsm.heapInUse`). */
  readonly heapInUse: boolean;
  readonly heapAddress: number;
  readonly heapSize: number;
  /** L4-FILES: the bytes of AMSDOS file buffers under the private block (0 when the program uses no file; `fileBufferBytes` in codegen/memory-map.ts). */
  readonly fileBufferBytes?: number;
  /** Names of every global symbol the program defines (labels and EQUs: `AsmSymbol.scope === 'global'`), for the reserved-range labels. */
  readonly globalLabels: ReadonlySet<string>;
  /** Where layout diagnostics point: the start of the main file (a layout error has no source position). */
  readonly span: Span;
  readonly diagnostics: DiagnosticBag;
}

/** `checkLayout(input)`: reports into `input.diagnostics`; returns true when the layout is sound. */
export type CheckLayoutFn = (input: LayoutInput) => boolean;
