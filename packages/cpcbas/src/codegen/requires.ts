/**
 * REQUIRES: the runtime files a program links. A template that calls a runtime routine
 * goes through {@link RequireSet.call}, which records the file that defines the label
 * (the reference backend's `runtime_call`), so a file is linked only when something
 * uses it. Files are emitted as `#include once <file>` lines, sorted.
 */

import { InternalError } from '../core/diagnostics.js';
import { runtimeLabelFile } from '../runtime/labels.js';

/**
 * Files that, when linked, need the heap (the reference's MEMINITS): their presence makes
 * the prologue emit the heap EQUs and the layout check consider the heap.
 */
export const MEMINITS: readonly string[] = [
  'loadstr.asm',
  'mem/alloc.asm',
  'storestr.asm',
  'storestr2.asm',
  'strcat.asm',
  'strcpy.asm',
  'string.asm',
  'strslice.asm',
];

/** Files every program links (the CPC backend forces bootstrap.asm). */
export const FORCED_FILES: readonly string[] = ['bootstrap.asm'];

export class RequireSet {
  private readonly files = new Set<string>(FORCED_FILES);

  /**
   * `\tcall <label>` and the file that defines it. An unknown label is a template bug
   * (InternalError): add the label to the runtime table, or use {@link file} plus a
   * plain `call` for a label of a file that is linked anyway.
   */
  call(label: string): string {
    this.label(label);
    return `\tcall ${label}`;
  }

  /** Records the file of a runtime label without emitting anything (for `jp label`, `ld hl, label`). */
  label(label: string): void {
    const file = runtimeLabelFile(label);
    if (file === undefined) throw new InternalError(`unknown runtime label ${label}`);
    this.files.add(file);
  }

  /** Records a file directly (`fwcall.asm` for the firmware gate, a `#require`d file). */
  file(path: string): void {
    this.files.add(path);
  }

  has(path: string): boolean {
    return this.files.has(path);
  }

  /** The files, sorted by code point (deterministic `#include` order). */
  sorted(): string[] {
    return [...this.files].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  /** Whether a linked file needs the heap (see {@link MEMINITS}). */
  needsHeap(): boolean {
    return MEMINITS.some((f) => this.files.has(f));
  }
}
