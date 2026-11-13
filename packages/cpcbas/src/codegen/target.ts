/**
 * Builds the {@link Target} from the host's options, the source's pragmas and the defines,
 * with the reference CPC backend's defaults (codegen/memory-map.ts). Options from the host
 * win over `#pragma` values.
 */

import type { SourceSettings } from '../sem/model.js';
import { BARE_MAP, DEFAULT_HEAP_SIZE, DEFAULT_ORG, FIRMWARE_MAP, fileBufferBytes } from './memory-map.js';
import type { Target } from './types.js';

export interface TargetInput {
  readonly org?: number;
  readonly heapSize?: number;
  readonly heapAddress?: number;
  /** L4-FILES: which AMSDOS file buffers the program uses (the default heap ends below them; `-D __LOCO_FILE_IN` tells fileout.asm). */
  readonly fileBuffers?: { readonly input: boolean; readonly output: boolean };
  /** The user's `-D` names (CompileInput.defines). */
  readonly defines?: Readonly<Record<string, string>>;
  /** From the binder; null fields mean "not set in the source". */
  readonly settings?: Pick<SourceSettings, 'org' | 'heapSize' | 'heapAddress'>;
}

export function makeTarget(input: TargetInput): Target {
  const defines = input.defines ?? {};
  const bare = Object.prototype.hasOwnProperty.call(defines, 'CPC_BAREMETAL');
  const map = bare ? BARE_MAP : FIRMWARE_MAP;
  const org = input.org ?? input.settings?.org ?? DEFAULT_ORG;
  const heapSize = input.heapSize ?? input.settings?.heapSize ?? DEFAULT_HEAP_SIZE;
  const buffers = bare ? 0 : fileBufferBytes(input.fileBuffers?.input === true, input.fileBuffers?.output === true);
  const heapAddress = input.heapAddress ?? input.settings?.heapAddress ?? map.codeLimit - buffers - heapSize;
  const asm = new Map<string, string>();
  for (const name of Object.keys(defines).sort()) asm.set(name, defines[name] as string);
  if (!bare && !asm.has('CPC_INKEY_BUFFERED')) asm.set('CPC_INKEY_BUFFERED', '');
  if (!bare && input.fileBuffers?.input === true) asm.set('__LOCO_FILE_IN', '');
  if (!bare && input.fileBuffers?.output === true) asm.set('__LOCO_FILE_OUT', ''); // END closes the open files (follow-up 127)
  // A heap allocation that fails raises Memory full (error 7) instead of returning an empty or truncated string (follow-up 50).
  if (!asm.has('__MEMORY_CHECK__')) asm.set('__MEMORY_CHECK__', '');
  const sorted = new Map([...asm.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return { mode: bare ? 'bare' : 'firmware', org, heapSize, heapAddress, map, asmDefines: sorted };
}
