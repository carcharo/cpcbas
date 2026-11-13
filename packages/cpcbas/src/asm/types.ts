/**
 * The Z80 assembler's public contract.
 *
 * The assembler reads the dialect the CPC runtime is written in (the dialect of the
 * reference assembler, Boriel's zxbasm): labels (`name:`, and `NAME EQU value` without a
 * colon), `PROC`/`ENDP`/`LOCAL`, `EQU`, `DEFB`/`DB`/`DEFM`, `DEFW`/`DW`, `DEFS`/`DS`,
 * `ORG`, `ALIGN`, `END [label]`, `NAMESPACE`, `push namespace X`/`pop namespace`,
 * temporary labels (`1:` with `1f`/`1b`), `$` for the current address, numbers in
 * decimal, `nnh`, `$nn`, `0xnn`, `%0101`, `0b0101`, character constants, and a small
 * preprocessor (`#include once <f>`/`"f"`, `#define`/`#undef`, `#ifdef`/`#ifndef`/
 * `#else`/`#endif`, `#if`, `#error`, `#init label`, `#line n "file"`). Z80 only (no Z80N).
 * `INCBIN` is not used by the runtime and may be left unimplemented (E-code with a hint).
 *
 * Contract: same input, same bytes as the reference assembler (golden tests in
 * tests/asm-golden), deterministic, pure (files come through `resolveInclude`).
 *
 * The assembler is in three layers, so they can be built in parallel:
 * - `z80/encode.ts` ({@link EncodeFn}): one instruction with evaluated operands -> bytes;
 * - `preprocess.ts` ({@link AsmPreprocessFn}): includes, defines, conditionals, `#init`,
 *   `#line` -> a flat list of attributed lines;
 * - `assemble.ts` ({@link AssembleFn}): lines -> symbols, passes, segments, map; calls
 *   the other two.
 */

import type { Diagnostic, DiagnosticBag, DiagnosticCode } from '../core/diagnostics.js';
import type { SourceFile, SourceSet, Span } from '../core/source.js';

// ---------------------------------------------------------------------------
// Encoder layer
// ---------------------------------------------------------------------------

export type Reg8 = 'A' | 'B' | 'C' | 'D' | 'E' | 'H' | 'L' | 'I' | 'R' | 'IXH' | 'IXL' | 'IYH' | 'IYL';
export type Reg16 = 'AF' | "AF'" | 'BC' | 'DE' | 'HL' | 'SP' | 'IX' | 'IY';
export type Condition = 'NZ' | 'Z' | 'NC' | 'C' | 'PO' | 'PE' | 'P' | 'M';

/**
 * An operand after parsing and (in pass 2) evaluation.
 * - `C` is always given as `{ kind: 'reg8', reg: 'C' }`; the encoder reads it as the carry
 *   condition for JP/JR/CALL/RET.
 * - `(ix)` is `{ kind: 'index', disp: 0 }`.
 * - `(c)` for IN/OUT is `{ kind: 'regIndirect', reg: 'C' }`.
 * - A bare `F` in `IN F,(C)` is `{ kind: 'flags' }`.
 * - In pass 1, unknown values are 0 with `pending: true`: the encoder must return the
 *   right *size* regardless (no Z80 instruction's size depends on a value), and must not
 *   report range errors for pending values.
 */
export type Operand =
  | { readonly kind: 'reg8'; readonly reg: Reg8 }
  | { readonly kind: 'reg16'; readonly reg: Reg16 }
  | { readonly kind: 'cond'; readonly cond: Exclude<Condition, 'C'> }
  | { readonly kind: 'flags' }
  | { readonly kind: 'imm'; readonly value: number; readonly pending?: boolean }
  | { readonly kind: 'mem'; readonly address: number; readonly pending?: boolean }
  | { readonly kind: 'regIndirect'; readonly reg: 'BC' | 'DE' | 'HL' | 'SP' | 'IX' | 'IY' | 'C' }
  | { readonly kind: 'index'; readonly reg: 'IX' | 'IY'; readonly disp: number; readonly pending?: boolean };

export interface EncodeRequest {
  /** Upper-case mnemonic (`LD`, `JR`, `EX`, `SLL`). */
  readonly mnemonic: string;
  readonly operands: readonly Operand[];
  /** Address of the instruction's first byte (for JR/DJNZ offsets). */
  readonly pc: number;
}

export type EncodeResult =
  | { readonly ok: true; readonly bytes: readonly number[]; readonly warnings?: ReadonlyArray<{ code: DiagnosticCode; message: string }> }
  | { readonly ok: false; readonly code: DiagnosticCode; readonly message: string };

/** `encode(request)`: pure, table-driven; never throws for bad input. */
export type EncodeFn = (request: EncodeRequest) => EncodeResult;

// ---------------------------------------------------------------------------
// Asm preprocessor layer (asm/preprocess.ts, task L2-ASMPP)
// ---------------------------------------------------------------------------

/** One logical asm line after preprocessing. */
export interface AsmSourceLine {
  /** The line's text with `#define` names expanded and the comment kept. */
  readonly text: string;
  /** The physical line in the file it was read from (main text or an include). */
  readonly span: Span;
  /** From the most recent `#line n "file"` before it, advanced by one per line; null when none. */
  readonly attribution: { readonly path: string; readonly line: number } | null;
}

export interface AsmPreprocessInput {
  readonly sources: SourceSet;
  readonly entry: SourceFile;
  readonly resolveInclude: IncludeResolver;
  readonly defines?: ReadonlyMap<string, string>;
  readonly diagnostics: DiagnosticBag;
}

export interface AsmPreprocessResult {
  /** All lines of the program in order, includes pasted in (`#include once` skips a file already included). */
  readonly lines: readonly AsmSourceLine[];
  /** `#init` labels in the order met (quotes removed, as the reference assembler strips them). */
  readonly inits: ReadonlyArray<{ readonly label: string; readonly span: Span }>;
}

/** `preprocessAsm(input)`: never throws for bad input. */
export type AsmPreprocessFn = (input: AsmPreprocessInput) => AsmPreprocessResult;

// ---------------------------------------------------------------------------
// Assembler layer
// ---------------------------------------------------------------------------

/** A file the include resolver found. `path` is normalised; it is registered in the SourceSet by the assembler. */
export interface ResolvedFile {
  readonly path: string;
  readonly text: string;
}

/**
 * Resolves `#include [once] <name>` (angle) or `"name"` from the file `fromPath`.
 * The compiler's resolver searches the runtime library tree (lib/runtime, then lib/...)
 * and, for `"name"`, the including file's directory first.
 */
export type IncludeResolver = (name: string, fromPath: string, angle: boolean) => ResolvedFile | undefined;

export interface AssembleOptions {
  /**
   * Honour `#line n "file"`: later diagnostics are attributed to that file and line
   * (when the file is in the SourceSet; otherwise to the asm line, with the `#line`
   * location named in the message). Default true.
   */
  readonly lineAttribution?: boolean;
  /**
   * `#init label` handling.
   * - `collect` (default, used by the compiler): labels are returned in `inits`; the
   *   compiler's prologue calls them.
   * - `zxbasm`: as the reference assembler run on its own: after the last byte it appends
   *   `CALL label` for each init in order, then `JP` to the `END` label (or to the lowest
   *   ORG when there is none), and the entry becomes the address of the first CALL. Used
   *   by the golden tests.
   */
  readonly initMode?: 'collect' | 'zxbasm';
  /** Names defined before the first line (`#ifdef CPC_BAREMETAL`), like `-D`. */
  readonly defines?: ReadonlyMap<string, string>;
  /** Produce the per-line listing. Default false. */
  readonly listing?: boolean;
  /**
   * Lines of the preprocessed program to leave out (L5-STRIP): half-open index ranges into the preprocessed line list,
   * and the list's length they were computed for. A length that does not match means the ranges are stale and are ignored
   * (nothing is dropped). Absent: every line is assembled.
   */
  readonly dropLines?: { readonly total: number; readonly ranges: ReadonlyArray<readonly [number, number]> };
}

export interface AssembleInput {
  /** Registry for diagnostics: the entry text and every included file are added here. */
  readonly sources: SourceSet;
  /** The main asm text (compiler output, or a file under test), already registered or registered by the assembler. */
  readonly entry: SourceFile;
  readonly resolveInclude: IncludeResolver;
  readonly options?: AssembleOptions;
}

/** A contiguous run of assembled bytes starting at `org`. Segments are sorted by `org` and never overlap. */
export interface Segment {
  readonly org: number;
  readonly bytes: Uint8Array;
}

export interface AsmSymbol {
  /** Fully qualified name as the reference map prints it (`.core.__PRINT`, `._v`). */
  readonly name: string;
  readonly value: number;
  readonly kind: 'label' | 'equ';
  /** `local` for labels declared LOCAL inside a PROC and for temporary labels; they are not in the map. */
  readonly scope: 'global' | 'local';
  /**
   * True when the reference assembler's `-M` map lists this symbol: a global label defined
   * at an address (`name:`), not an EQU constant and not a local or temporary label. The
   * assembler decides this, so readers ({@link FormatMapFn}, the layout check, CPC Game
   * Studio's map view) never re-derive the rule from `kind` and `scope`.
   */
  readonly inMap: boolean;
  /** Where it was defined. */
  readonly span: Span;
}

export interface ListingLine {
  readonly address: number;
  readonly bytes: readonly number[];
  readonly span: Span;
  readonly text: string;
}

export interface AssembleResult {
  readonly ok: boolean;
  readonly segments: readonly Segment[];
  /** Symbols by fully qualified name; iterate `symbolsByAddress` for a stable order. */
  readonly symbols: ReadonlyMap<string, AsmSymbol>;
  /** All symbols sorted by value, then name (code-point order). */
  readonly symbolsByAddress: readonly AsmSymbol[];
  /** `#init` labels in the order met (initMode `collect`). */
  readonly inits: readonly string[];
  /** The `END label` value, or with initMode `zxbasm` the appended init block; null when none. */
  readonly entry: number | null;
  readonly diagnostics: readonly Diagnostic[];
  readonly listing?: readonly ListingLine[];
}

/** `assemble(input)`: never throws for bad input. */
export type AssembleFn = (input: AssembleInput) => AssembleResult;

/**
 * The flat image the reference assembler writes as `.bin`: from the lowest address to the
 * highest assembled byte, gaps filled with 0. (Implemented in asm/image.ts by task L2-ASM.)
 */
export type FlattenFn = (segments: readonly Segment[]) => { readonly org: number; readonly bytes: Uint8Array };

/**
 * The reference assembler's `-M` map text, byte for byte: one `%04X: name` line (upper-case
 * hex) per symbol with `inMap` set (global address labels; not EQU constants, not PROC-local
 * labels), the lines sorted as strings by code point (as Python's `sorted`), joined with
 * `\n`, no trailing newline. CPC Game Studio's map reader parses this format.
 */
export type FormatMapFn = (result: AssembleResult, extra?: readonly { readonly name: string; readonly value: number }[]) => string;
