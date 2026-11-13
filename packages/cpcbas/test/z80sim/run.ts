/**
 * Helpers around the test Z80 and fake CPC: run an image, or assemble a snippet with our own
 * assembler over lib/runtime and run that. Test code only.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assemble, flatten } from '../../src/asm/index.js';
import type { AsmSymbol, IncludeResolver } from '../../src/asm/types.js';
import { formatDiagnostic } from '../../src/core/diagnostics.js';
import { SourceSet, dirname as vdirname, joinPath, normalizePath } from '../../src/core/source.js';
import { Cpc } from './cpc.js';
import type { CpcOptions } from './cpc.js';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const runtimeDir = join(repoRoot, 'lib/runtime');

export type StopReason = 'rst0' | 'limit' | 'halt' | 'waitkey';

export interface RunOptions extends CpcOptions {
  /** Keys typed ahead: they appear once the program first asks for one (after the bootstrap's flush). */
  keys?: string | readonly number[];
  /** Stop after this many T-states (default 20 million = 5 emulated seconds). */
  maxTStates?: number;
  /** Initial stack pointer for images that do not set their own (default &B800). */
  sp?: number;
  /** Called with the machine before the first instruction (poke memory, add hooks, ...). */
  setup?: (cpc: Cpc) => void;
}

export interface RunResult {
  /** Everything sent to TXT OUTPUT (bytes as Latin-1 characters). */
  screen: string;
  /** The text screen rows (right-trimmed). */
  rows: string[];
  /** Everything sent to the printer through MC PRINT CHAR. */
  printer: string;
  cpc: Cpc;
  cpu: Cpc['cpu'];
  memory: Uint8Array;
  stopped: StopReason;
  tstates: number;
  instructions: number;
}

/** Runs the machine from its current state until RST 0, HALT with interrupts off, a key wait or the limit. */
export function runCpc(cpc: Cpc, options: RunOptions = {}): RunResult {
  const cpu = cpc.cpu;
  const limit = cpu.t + (options.maxTStates ?? 20_000_000);
  cpu.stop = null;
  while (cpu.stop === null && cpu.t < limit) cpu.step();
  const stopped = (cpu.stop ?? 'limit') as StopReason;
  return {
    screen: cpc.transcript,
    rows: cpc.rows,
    printer: cpc.printer,
    cpc,
    cpu,
    memory: cpu.mem,
    stopped,
    tstates: cpu.t,
    instructions: cpu.instructions,
  };
}

/** Loads `bytes` at `org` into a fresh CPC, starts at `entry` with interrupts off, and runs. */
export function runImage(bytes: Uint8Array, org: number, entry: number, options: RunOptions = {}): RunResult {
  const cpc = new Cpc(options);
  cpc.cpu.load(bytes, org);
  cpc.cpu.pc = entry;
  cpc.cpu.sp = options.sp ?? 0xb800;
  if (options.keys !== undefined) cpc.typeAhead(options.keys);
  options.setup?.(cpc);
  return runCpc(cpc, options);
}

// ---------- assembling over lib/runtime ----------

function walk(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (statSync(join(dir, name)).isDirectory()) out.push(...walk(join(dir, name), `${prefix}${name}/`));
    else out.push(`${prefix}${name}`);
  }
  return out;
}

let knownRuntime: Set<string> | undefined;

/** Include resolver over lib/runtime (the model is tools/e2e-assemble.mjs). */
export const resolveRuntime: IncludeResolver = (name, fromPath, angle) => {
  knownRuntime ??= new Set(walk(runtimeDir));
  const candidates: string[] = [];
  if (!angle && fromPath.startsWith('lib/runtime/')) {
    candidates.push(joinPath(vdirname(fromPath).slice('lib/runtime'.length + 1), name));
  }
  candidates.push(normalizePath(name));
  for (const rel of candidates) {
    if (knownRuntime.has(rel)) return { path: `lib/runtime/${rel}`, text: readFileSync(join(runtimeDir, rel), 'latin1') };
  }
  return undefined;
};

export interface AssembledImage {
  org: number;
  bytes: Uint8Array;
  /** `.core.__START_PROGRAM` when defined, else the image origin. */
  entry: number;
  symbols: ReadonlyMap<string, AsmSymbol>;
  /** Address of a label, with or without the leading dot (throws when undefined). */
  addr(label: string): number;
}

export interface AssembleOptions {
  /** `-D name[=value]` style defines. */
  defines?: Record<string, string> | ReadonlyMap<string, string>;
  /** Entry label (default `.core.__START_PROGRAM`, else the lowest origin). */
  entryLabel?: string;
  /** Extra virtual files for `#include`, by path relative to lib/runtime, tried before the real ones. */
  files?: Record<string, string>;
  path?: string;
  /** L5-STRIP's `AssembleOptions.dropLines`: preprocessed lines to leave out. */
  dropLines?: { readonly total: number; readonly ranges: ReadonlyArray<readonly [number, number]> };
}

/** Assembles `asmText` with cpcbas's own assembler; throws with formatted diagnostics on any problem. */
export function assembleText(asmText: string, options: AssembleOptions = {}): AssembledImage {
  const sources = new SourceSet();
  const entry = sources.add(options.path ?? 'snippet.asm', asmText, 'generated');
  const defines =
    options.defines instanceof Map
      ? options.defines
      : new Map<string, string>(Object.entries((options.defines ?? {}) as Record<string, string>));
  const files = options.files ?? {};
  const resolver: IncludeResolver = (name, from, angle) => {
    const key = normalizePath(name);
    if (key in files) return { path: `virtual/${key}`, text: files[key] };
    return resolveRuntime(name, from, angle);
  };
  const result = assemble({ sources, entry, resolveInclude: resolver, options: { defines, ...(options.dropLines !== undefined ? { dropLines: options.dropLines } : {}) } });
  const problems = result.diagnostics.filter((d) => d.severity !== 'note');
  if (!result.ok || problems.length > 0) {
    throw new Error(`assembly failed:\n${problems.map((d) => formatDiagnostic(d, sources)).join('\n')}`);
  }
  const image = flatten(result.segments);
  const lookup = (label: string): AsmSymbol | undefined => result.symbols.get(label) ?? result.symbols.get(`.${label}`);
  const start = lookup(options.entryLabel ?? '.core.__START_PROGRAM');
  return {
    org: image.org,
    bytes: image.bytes,
    entry: start ? start.value : image.org,
    symbols: result.symbols,
    addr(label: string): number {
      const s = lookup(label);
      if (!s) throw new Error(`undefined label ${label}`);
      return s.value;
    },
  };
}

export interface AssembledRun extends RunResult {
  image: AssembledImage;
  /** Byte / word (little endian) at a label. */
  byteAt(label: string, offset?: number): number;
  wordAt(label: string, offset?: number): number;
}

/** Assembles `asmText` over lib/runtime and runs it from its entry. */
export function assembleAndRun(asmText: string, options: AssembleOptions & RunOptions = {}): AssembledRun {
  const image = assembleText(asmText, options);
  const run = runImage(image.bytes, image.org, image.entry, options);
  return Object.assign(run, {
    image,
    byteAt: (label: string, offset = 0) => run.memory[image.addr(label) + offset],
    wordAt: (label: string, offset = 0) => {
      const a = image.addr(label) + offset;
      return run.memory[a] | (run.memory[a + 1] << 8);
    },
  });
}

export interface ProgramOptions {
  /** Assembly placed after `.core.__MAIN_PROGRAM__:`; falls through to the clean END. */
  body: string;
  /** Data and extra labels placed after the program (before the runtime). */
  data?: string;
  /** Runtime files to include (paths under lib/runtime), besides the bootstrap and error handling. */
  include?: readonly string[];
  /** Initialise the heap (`#include <mem/heapinit.asm>`, `call __MEM_INIT`). */
  heap?: boolean;
}

/**
 * A complete firmware-mode program in the shape the compiler emits (tests/e2e/hello.asm): the
 * memory-map EQUs, the prologue with the bootstrap call, `body`, a jump to `__CPC_END`, then
 * `data` and the runtime includes. Run it with `__CPC_PRINTER_ECHO__` defined to end with the
 * marker line and RST 0 without waiting for a key.
 */
export function wrapProgram(opts: ProgramOptions): string {
  const lines = [
    'org 64',
    '.core.CPC_PRIV_BASE EQU 40448',
    '.core.CPC_PRIV_SIZE EQU 1024',
    '.core.CPC_STACK_TOP EQU 42496',
    '.core.CPC_MEM_TOP EQU 42619',
    '.core.ZXBASIC_HEAP_SIZE EQU 4768',
    '.core.ZXBASIC_MEM_HEAP EQU 35680',
    '.core.__START_PROGRAM:',
    '  di',
    '  ld sp, .core.CPC_STACK_TOP',
    '  call .core.CPC_INIT_00_BOOTSTRAP',
  ];
  if (opts.heap) lines.push('  call .core.__MEM_INIT');
  lines.push('  jp .core.__MAIN_PROGRAM__', '.core.__MAIN_PROGRAM__:', opts.body, '.core.__END_PROGRAM:', '  jp .core.__CPC_END');
  if (opts.data) lines.push(opts.data);
  if (opts.heap) lines.push('#include once <mem/heapinit.asm>');
  lines.push('#include once <bootstrap.asm>');
  for (const f of opts.include ?? []) lines.push(`#include once <${f}>`);
  return `${lines.join('\n')}\n`;
}

/** Assembles `wrapProgram(opts)` and runs it (printer echo on, so END stops cleanly at RST 0). */
export function runProgram(opts: ProgramOptions, run: RunOptions = {}): AssembledRun {
  return assembleAndRun(wrapProgram(opts), { defines: { __CPC_PRINTER_ECHO__: '1' }, ...run });
}
