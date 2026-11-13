/**
 * Output writers: the AMSDOS file header, the `.dsk` disc image writer and the `.cpr`
 * Plus cartridge writer. Pure functions from bytes to bytes.
 *
 * References they must match byte for byte (golden tests):
 * - AMSDOS header and DSK: the fork's `tools/cpc/mkdsk.py` (standard "MV - CPCEMU" image,
 *   AMSDOS Data format: 40 tracks, 1 side, 9 x 512-byte sectors C1..C9 with the skew
 *   C1 C6 C2 C7 C3 C8 C4 C9 C5, 1 KB blocks, 64 directory entries, filler &E5). The
 *   creator field is an option so a golden test can ask for mkdsk.py's own (`"mkdsk.py"`).
 * - CPR: CPC Game Studio's `mkcpr.ts` (itself a port of cpcbuild's `tools/mkcpr.py`).
 *
 * Errors are reported as {@link PackError} values (code + message), not thrown; the
 * caller turns them into diagnostics (codes 600-699).
 */

import type { DiagnosticCode } from '../core/diagnostics.js';

/** AMSDOS file types. The compiler writes binaries (2). */
export type AmsdosFileType = 0 | 1 | 2;
export const AMSDOS_BASIC: AmsdosFileType = 0;
export const AMSDOS_PROTECTED_BASIC: AmsdosFileType = 1;
export const AMSDOS_BINARY: AmsdosFileType = 2;

export interface AmsdosHeaderFields {
  /** 8.3 name, any case (`"game.bin"`); upper-cased, truncated to 8 + 3 and space-padded, as mkdsk.py does. */
  readonly name: string;
  /** Length of the data that follows the header (24-bit real length; the 16-bit field is its low word). */
  readonly length: number;
  readonly loadAddress: number;
  readonly entryAddress: number;
  /** Default 0. */
  readonly user?: number;
  /** Default {@link AMSDOS_BINARY}. */
  readonly fileType?: AmsdosFileType;
}

export interface PackError {
  readonly code: DiagnosticCode;
  readonly message: string;
}

export type PackResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: PackError };

/** The 128-byte AMSDOS header (checksum at &43 over bytes 0..66). */
export type BuildAmsdosHeaderFn = (fields: AmsdosHeaderFields) => PackResult<Uint8Array>;

/** One file to put on a disc. */
export interface DskFile {
  /** AMSDOS 8.3 name. */
  readonly name: string;
  readonly data: Uint8Array;
  /** `amsdos` (default): an AMSDOS header is prepended, as mkdsk.py always does. `none`: the bytes are stored as they are (data files). */
  readonly header?: 'amsdos' | 'none';
  readonly loadAddress?: number;
  readonly entryAddress?: number;
  readonly user?: number;
  readonly fileType?: AmsdosFileType;
}

export interface DskOptions {
  /** Disc format; only the AMSDOS Data format in 1.0. */
  readonly format?: 'data';
  /** Up to 14 ASCII characters for the image's creator field, NUL-padded. Default `"cpcbas"`. */
  readonly creator?: string;
}

/** Files are written in the order given (directory entries and blocks allocated in that order, as mkdsk.py). */
export type BuildDskFn = (files: readonly DskFile[], options?: DskOptions) => PackResult<Uint8Array>;

export interface CprInput {
  /** The bare-metal program image (flat bytes from `loadAddress`). */
  readonly image: Uint8Array;
  readonly loadAddress: number;
  /** Default: `loadAddress`. */
  readonly entryAddress?: number;
}

/** `.cpr` RIFF "AMS!" with 16 KB `cbNN` chunks: page 0 the boot stub, pages 1..N the image. */
export type BuildCprFn = (input: CprInput) => PackResult<Uint8Array>;
