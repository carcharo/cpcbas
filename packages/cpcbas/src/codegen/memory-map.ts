/**
 * The CPC memory map, for firmware and bare-metal mode. The single source of these
 * numbers in cpcbas: the prologue emits them as EQUs (`.core.CPC_PRIV_BASE` ...) so the
 * runtime never hard-codes them, and the layout check reads its limits from here.
 *
 * Values are the reference CPC backend's (its memory-map constants and `_layout()`),
 * proven on the 464, 664, 6128 and the Plus:
 *
 *   firmware mode                          bare-metal mode (-D CPC_BAREMETAL)
 *   &0000-&003F  restarts, vectors         same
 *   &0040 ->     code + data (--org)       same
 *   ...  -&9DFF  heap, top-aligned         code + data + heap up to &B7FF
 *   &9E00-&A1FF  private runtime block     &B800-&BBFF stack
 *   &A200-&A5FF  stack                     &BC00-&BFFF private runtime block
 *   &A67B        boot HIMEM with AMSDOS    &BFFF memory top
 *   &C000-&FFFF  screen                    screen
 *
 * File buffers (L4-FILES, firmware mode only): a program that uses files gives AMSDOS a 2 KB
 * buffer per stream, directly under the private block: the input stream's (OPENIN, LOAD, CAT,
 * CHAIN) at &9600-&9DFF and, when the output stream is used as well (OPENOUT, PRINT #9, WRITE #9,
 * SAVE), the output stream's at &8E00-&95FF; a program with the output stream alone has it at
 * &9600. The default heap ends below them, and code and data must too (layout errors E405, E406).
 * Buffers are 2 KB because AMSDOS wants that much; they must lie outside the lower ROM and the
 * screen (&C000 up), which anywhere under &9E00 does.
 */

/** A range reserved only when the program defines `label` (a library that needs it). */
export interface ReservedRange {
  readonly label: string;
  readonly start: number;
  /** Exclusive. */
  readonly end: number;
  /** Completes "reserved because ..." in the layout message. */
  readonly reason: string;
}

export interface MemoryMap {
  readonly privBase: number;
  readonly privSize: number;
  /** SP is set here by the prologue. */
  readonly stackTop: number;
  readonly memTop: number;
  /** Code and data must end at or below this (exclusive bound: the first address that may not be used). */
  readonly codeLimit: number;
  /** The lowest origin. */
  readonly minCode: number;
  readonly minCodeReason: string;
  readonly reserved: readonly ReservedRange[];
}

const RESERVED: readonly ReservedRange[] = [
  {
    label: '.core.__CPC_RESERVE_4000',
    start: 0x4000,
    end: 0x8000,
    reason: 'the program uses a library that reserves it (such as a double-buffered back screen)',
  },
];

export const FIRMWARE_MAP: MemoryMap = {
  privBase: 0x9e00,
  privSize: 0x400,
  stackTop: 0xa600,
  memTop: 0xa67b,
  codeLimit: 0x9e00,
  minCode: 0x0040,
  minCodeReason: '$0000-$003F hold the restarts and interrupt vectors',
  reserved: RESERVED,
};

export const BARE_MAP: MemoryMap = {
  privBase: 0xbc00,
  privSize: 0x400,
  stackTop: 0xbc00,
  memTop: 0xbfff,
  codeLimit: 0xb800,
  minCode: 0x0040,
  minCodeReason: '$0000-$003F hold the restarts and interrupt vectors',
  reserved: RESERVED,
};

/** One AMSDOS file buffer, in bytes (L4-FILES). */
export const FILE_BUFFER_SIZE = 0x800;

/** The bytes under the private block that a program's file buffers take (0, 2 KB or 4 KB; firmware mode only). */
export function fileBufferBytes(input: boolean, output: boolean): number {
  return (input ? FILE_BUFFER_SIZE : 0) + (output ? FILE_BUFFER_SIZE : 0);
}

/** Default code origin (both modes). */
export const DEFAULT_ORG = 0x0040;

/** Default heap size in bytes (the reference's 4768, "a bit more than 4K"). */
export const DEFAULT_HEAP_SIZE = 4768;

/** The memory-map EQU lines the prologue emits, in the reference's order and spelling. */
export function memoryMapEqus(map: MemoryMap): readonly string[] {
  return [
    `\t.core.CPC_PRIV_BASE EQU ${map.privBase}`,
    `\t.core.CPC_PRIV_SIZE EQU ${map.privSize}`,
    `\t.core.CPC_STACK_TOP EQU ${map.stackTop}`,
    `\t.core.CPC_MEM_TOP EQU ${map.memTop}`,
  ];
}
