/**
 * cpcbas: the CPC BASIC compiler as a library.
 *
 *   compile(input) -> result
 *
 * The library never touches a file system, a process or a clock: the host (the `cpcbas`
 * CLI, CPC Game Studio, a browser page) supplies every file in `input.files` (and the
 * runtime library in `input.runtime`) and gets bytes and diagnostics back.
 *
 * The whole pipeline is wired: front end, bind, check, lower, generate, link, assemble,
 * layout check and pack (`.bin`, `.dsk`, `.cpr`); `dump` returns the token, AST, IR and
 * asm text. What lowering or code generation does not support yet reports E002.
 */

import type { Diagnostic } from './core/diagnostics.js';
import type { SourceSet, FileTree } from './core/source.js';
import { runPipeline } from './pipeline.js';

export type { Diagnostic, DiagnosticCode, DiagnosticJson, Severity } from './core/diagnostics.js';
export { DiagnosticBag, diagnosticToJson, formatDiagnostic, CODES } from './core/diagnostics.js';
export type { FileContent, FileId, FileTree, Position, SourceFile, Span } from './core/source.js';
export { SourceSet, normalizePath } from './core/source.js';

export { migrate } from './migrate/migrate.js';
export type { MigrateDiagnostic, MigrateFileReport, MigrateOptions, MigrateReport, MigrateResult } from './migrate/migrate.js';
export { VERSION } from './version.js';
export type { OptLevel } from './opt/index.js';
export { DEFAULT_OPT_LEVEL, OPT_LEVELS, optNames } from './opt/index.js';
import type { OptLevel } from './opt/index.js';

/** Stages that can be dumped (`--stage`) or stopped after. */
export type Stage = 'tokens' | 'ast' | 'ir' | 'ir-opt' | 'asm';

/** What to produce. `none` runs the requested stages and returns diagnostics only. */
export type OutputFormat = 'bin' | 'dsk' | 'cpr' | 'none';

export interface CompileOptions {
  /** Code origin. Default &0040. */
  readonly org?: number;
  /** Heap size in bytes. Default 4768. */
  readonly heapSize?: number;
  /** Heap start address. Default: top-aligned below the private block (&9E00; bare mode &B800). */
  readonly heapAddress?: number;
  /**
   * The optimisation level: `0` .. `3` or `'s'` (the CLI's `-O0` .. `-O3`, `-Os`). Default 2. `0` builds exactly
   * RC3's code; another value is E570.
   */
  readonly optimize?: OptLevel;
  /** `--opt-disable`: passes, rules or features to turn off (to bisect a suspected optimiser bug); an unknown name is E571. */
  readonly optDisable?: readonly string[];
  /** `--opt-trace`: the code-stage passes write `; opt <name>: ...` comments into the `asm` output. The image does not change. */
  readonly optTrace?: boolean;
  /** Default `bin`. */
  readonly format?: OutputFormat;
  /** `.bin` with an AMSDOS header. Default true. */
  readonly amsdosHeader?: boolean;
  /** `--parse-only`: front end and semantic checks, no code generation. */
  readonly parseOnly?: boolean;
  /** Stages whose dumps to return in `result.stages`. */
  readonly dump?: readonly Stage[];
  /** `-W code`: warnings to disable (numbers or codes). */
  readonly disabledWarnings?: readonly (string | number)[];
  /** `-Werror`. */
  readonly warningsAsErrors?: boolean;
  /** `-Wimplicit`: warn (W300) at each implicit variable declaration (spec §4). Default false. */
  readonly warnImplicit?: boolean;
  /** `-M`: return the memory map text. */
  readonly map?: boolean;
  /** `--asm`: return the generated assembly text. */
  readonly asm?: boolean;
  /** AMSDOS name of the program on a `.dsk` (default: the main file's base name + `.BIN`). */
  readonly dskName?: string;
  /** Extra files for the `.dsk` (`--dsk-add NAME=path`, read by the host). */
  readonly dskFiles?: ReadonlyArray<{ readonly name: string; readonly data: Uint8Array }>;
  /**
   * The value of `__DATE__` (the host passes today's date, e.g. `"2026-11-07"`; deterministic
   * builds pass a fixed one). Default `"1970-01-01"`.
   */
  readonly buildDate?: string;
  /** A clock for `stats.timeMs` (the host passes `performance.now`). Without it, `timeMs` is 0. */
  readonly now?: () => number;
}

export interface CompileInput {
  /** User files. A `Map<string, string | Uint8Array>` works. */
  readonly files: FileTree;
  /** Path of the main file in `files`. */
  readonly main: string;
  /** `-I` directories (virtual paths in `files`). */
  readonly includePaths?: readonly string[];
  /** `-D NAME[=value]` (CPC464, CPC6128, PLUS, CPC_BAREMETAL ...). A name without a value is `""`. */
  readonly defines?: Readonly<Record<string, string>>;
  /**
   * The runtime library tree (the repo's `lib/`, paths relative to it: `runtime/print.asm`).
   * The CLI reads it from disk; a browser host passes a bundled copy. Required for code
   * generation (L2); not needed for `parseOnly`. It also holds the BASIC library
   * (`cpcbuild/display.bas`, `stdlib/cpc.bas`): `#include` searches it after the include paths.
   */
  readonly runtime?: FileTree;
  readonly options?: CompileOptions;
}

export interface CompileStats {
  readonly codeBytes: number;
  readonly dataBytes: number;
  readonly heapBytes: number;
  readonly timeMs: number;
}

export interface CompileResult {
  /** True when there are no errors (warnings allowed). */
  readonly ok: boolean;
  /** Sorted deterministically; format with `formatDiagnostic(d, result.sources)` or `diagnosticToJson`. */
  readonly diagnostics: readonly Diagnostic[];
  /** Every file read, for formatting diagnostics. */
  readonly sources: SourceSet;
  /** The program bytes (without AMSDOS header) and where they load and start. */
  readonly binary?: Uint8Array;
  readonly org?: number;
  readonly entry?: number;
  /** `.bin` with header, `.dsk` or `.cpr` bytes, per `options.format`. */
  readonly output?: Uint8Array;
  readonly map?: string;
  readonly asm?: string;
  /** Dumps of the stages asked for in `options.dump`. */
  readonly stages?: Partial<Record<Stage, string>>;
  readonly stats: CompileStats;
  /** Exit code the CLI should use: 0 ok, 1 errors, 5 memory-layout error (2, usage, is the CLI's own). */
  readonly exitCode: 0 | 1 | 5;
}

/** Compiles a program. Never throws for bad input; compiler bugs are reported as E001. */
export function compile(input: CompileInput): CompileResult {
  return runPipeline(input);
}
