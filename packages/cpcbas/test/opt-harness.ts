/**
 * L5-DIFF, the shared harness of the simulator differential tests (layers 1 and 2 of the correctness guard).
 *
 * A program is built through `compile()` at -O0 and at each optimisation level, the asm of each level is assembled and run on
 * the test Z80, and the outcomes must agree: the printer transcript, how the run stopped, and the final bytes of the data
 * region (`.core.ZXBASIC_USER_DATA` to the first hidden global `.V.0`, or to `.core.ZXBASIC_USER_DATA_END`: the program's variables). T-states are recorded, never
 * compared for equality (an optimised level may only be bounded: it must not run for ever).
 *
 * The optimiser is reached only through `compile({ options: { optimize } })`, so L5-0's pass manager needs no change here. A
 * level whose text and image equal -O0's is not run again (the simulator is deterministic).
 *
 * What runs is `compile()`'s own image (`binary`, `org`, `entry`, the data region from the map), so a link pass that changes the
 * image without changing the `--asm` text (L5-STRIP's dropped chunks) is tested as built. The test-only fault hook
 * (`withAsmHook`) rewrites the asm text of the optimised levels before assembly: while it is set the text is assembled instead
 * (the image of `compile()` cannot carry the rewrite). It exists to show that the layers fail when an optimiser is wrong;
 * production code has no such switch.
 */
import { assembleText, runImage } from './z80sim/run.js';
import type { RunOptions } from './z80sim/run.js';
import { compile, formatDiagnostic, type OptLevel } from '../src/index.js';
import { makeTarget } from '../src/codegen/index.js';
import { libTree } from './runtime-tree.js';

/** `-O0`..`-O3` and `-Os`: the library's `OptLevel`. */
export type Level = OptLevel;
/** The optimised levels (everything but -O0). */
export const OPT_LEVELS: readonly Level[] = [1, 2, 3, 's'];

/** `CPCBAS_OPT_LEVELS=2,s` narrows the levels; empty or unset is every optimised level. */
export function levelsFromEnv(env: string | undefined = process.env['CPCBAS_OPT_LEVELS']): readonly Level[] {
  if (env === undefined || env.trim() === '') return OPT_LEVELS;
  return parseLevels(env);
}

export function parseLevels(text: string): Level[] {
  return text.split(',').map((t) => {
    const s = t.trim().toLowerCase().replace(/^-?o/, '');
    if (s === 's') return 's';
    if (s === '0' || s === '1' || s === '2' || s === '3') return Number(s) as Level;
    throw new Error(`bad optimisation level "${t}" (0, 1, 2, 3 or s)`);
  });
}

/** A program the harness can build and run: source text (one file, `t.bas`) and the sim's options. */
export interface Program {
  readonly name: string;
  /** The files, main first by `main`; a plain string is one file `t.bas`. */
  readonly files: string | ReadonlyMap<string, string>;
  readonly main?: string;
  readonly defines?: Readonly<Record<string, string>>;
  /** Keys typed ahead, as `RunOptions.keys`. */
  readonly keys?: string;
  /** Files on the fake disc before the run (name, text as Latin-1): a program's `REM LOCO-DISK: NAME=path` headers. */
  readonly disc?: Readonly<Record<string, string>>;
  readonly maxTStates?: number;
  /**
   * False when the data region holds addresses of code (a program that copies the restart area, whose vectors point into the
   * runtime): a pass that moves code changes them legitimately. The transcript and the way the run stopped are still compared.
   */
  readonly compareData?: boolean;
  /** The program keeps a code or heap address in its globals (`x = @label`, a string passed to CALL) or reads code bytes: the data region moves with the code, so only the transcript is compared. */
  readonly layoutDependent?: boolean;
  /**
   * The program measures time (the 300 Hz clock, frame counts, T-states per call) and prints or stores what it measured: a faster
   * level legitimately reads other numbers. Compared instead: how the run stopped, the firmware record, and the program's own
   * verdicts (its `PASS name` / `FAIL name` lines and its `DONE`, each reduced to the first two words, so the check that flips is
   * named); the other transcript lines and the data region (the counters) are not compared.
   */
  readonly timing?: boolean;
  /** With `timing`: checks whose verdict itself depends on the speed (a tolerance band around a measured duration); not compared. */
  readonly speedChecks?: readonly string[];
  /**
   * The program's string variables hold heap pointers, and an optimised level legitimately allocates in another order (L5-GAP's
   * argument spills keep fewer temporary strings alive, so a later block lands a few bytes elsewhere). The data region is
   * compared without the string variables' pointers (`Outcome.strSlots`; R20: the other variables still count), and the heap's
   * free bytes at the end are compared (the sum of the free list): a temporary that is not freed, or a block freed twice,
   * changes it. The transcript is compared as always.
   */
  readonly heapOrder?: boolean;
}

export interface Outcome {
  readonly printer: string;
  readonly stopped: string;
  /** The data region's final bytes, as hex. */
  readonly data: string;
  readonly tstates: number;
  /** Bytes on the heap's free list when the run ended (only for a program with `heapOrder`). */
  readonly heapFree?: number;
  /** Byte offsets in `data` of the string variables' heap pointers (labels `..__s`, two bytes each; only with `heapOrder`). */
  readonly strSlots?: readonly number[];
  /**
   * What the machine's firmware recorded: the calls it only logs (graphics, key-manager setters, matrices: `Cpc.gfx`), the
   * AMSDOS's calls and the files on the disc afterwards. Compared like the transcript (L5-SIMFW); optional for a literal.
   */
  readonly calls?: string;
}

/** The firmware-side record of a finished run, as `Outcome.calls`. */
export function callsOf(r: { readonly cpc: { readonly gfx: readonly string[]; readonly disc: { readonly log: readonly string[]; readonly files: ReadonlyMap<string, { readonly data: readonly number[] }> } } }): string {
  const files = [...r.cpc.disc.files].sort(([a], [b]) => (a < b ? -1 : 1)).map(([n, f]) => `${n}=${Buffer.from(f.data).toString('hex')}`);
  return [...r.cpc.gfx, '-- disc', ...r.cpc.disc.log, '-- files', ...files].join('\n');
}

export type AsmHook = (asm: string, level: Level) => string;
let hook: AsmHook | null = null;

/** Test-only: runs `body` with `fn` rewriting every optimised level's asm before assembly. */
export function withAsmHook<T>(fn: AsmHook, body: () => T): T {
  const saved = hook;
  hook = fn;
  try {
    return body();
  } finally {
    hook = saved;
  }
}

/** The deliberately wrong "pass": deletes the first store of a register pair to a user variable, `ld (_x), hl`. */
export const dropFirstStore: AsmHook = (asm) => {
  const lines = asm.split('\n');
  const i = lines.findIndex((l) => /^\s*ld \(_[A-Za-z_]\w*\), hl\s*$/.test(l));
  if (i < 0) return asm;
  lines.splice(i, 1);
  return lines.join('\n');
};

function fileMap(p: Program): { files: Map<string, string>; main: string } {
  if (typeof p.files === 'string') return { files: new Map([['t.bas', p.files]]), main: 't.bas' };
  return { files: new Map(p.files), main: p.main ?? 't.bas' };
}

/** The image `compile()` built, as the harness runs it. */
export interface BuiltImage {
  readonly bytes: Uint8Array;
  readonly org: number;
  readonly entry: number;
  /** The data region (`.core.ZXBASIC_USER_DATA` to `.core.ZXBASIC_USER_DATA_END`), when the map has both. */
  readonly data: { readonly from: number; readonly to: number } | null;
  /** `.core.ZXBASIC_MEM_HEAP`, the heap's header (free list at +2), when the map has it. */
  readonly heap?: number;
  /** The string variables' pointer slots, as offsets in the data region (`Outcome.strSlots`). */
  readonly strSlots?: readonly number[];
}

export interface Built {
  /** The asm text at this level (after the hook, for an optimised level); '' with errors. */
  readonly asm: string;
  readonly errors: readonly string[];
  /** compile()'s image; absent while a fault hook rewrites the text (then `asm` is what runs). */
  readonly image?: BuiltImage;
}

/** Front end to linked asm at `level` (no assembly: cheap enough to run at every level of every program). */
export function asmAt(p: Program, level: Level): Built {
  const { files, main } = fileMap(p);
  const r = compile({
    files,
    main,
    defines: { __CPC_PRINTER_ECHO__: '', ...p.defines },
    runtime: libTree(),
    options: { asm: true, map: true, optimize: level },
  });
  const errors = r.diagnostics.filter((d) => d.severity === 'error').map((d) => formatDiagnostic(d, r.sources));
  const asm = r.asm ?? '';
  if (errors.length > 0 || asm === '') return { asm: '', errors };
  // CPCBAS_OPT_BUG=1 (a demonstration, never set by a script or by CI) installs the wrong pass for the whole run, to show
  // that the whole of layers 1 and 2 fails: `CPCBAS_OPT_BUG=1 npx vitest run packages/cpcbas/test/opt-diff`
  const active = hook ?? (process.env['CPCBAS_OPT_BUG'] === undefined ? null : dropFirstStore);
  if (active !== null) return { asm: level !== 0 ? active(asm, level) : asm, errors };
  if (r.binary === undefined || r.org === undefined || r.entry === undefined) return { asm: '', errors: [...errors, 'compile() gave no image'] };
  const addr = (name: string): number | undefined => {
    const m = new RegExp(`^([0-9A-F]+): \\.?${name.replace(/\./g, '\\.')}$`, 'm').exec(r.map ?? '');
    return m === null ? undefined : parseInt(m[1] as string, 16);
  };
  const from = addr('core.ZXBASIC_USER_DATA');
  // the compiler's hidden globals (`.V.<n>`: FOR limits, SELECT subjects, argument spill slots) follow the program's variables;
  // an optimised level may need fewer of them (L5-GAP's spill slots), so the comparison stops at the first one
  const end = addr('core.ZXBASIC_USER_DATA_END');
  const hidden = addr('V.0');
  const to = end !== undefined && hidden !== undefined && from !== undefined && hidden >= from && hidden <= end ? hidden : end;
  // the heap's address is an EQU in the asm text, not a label of the map (R20: reading it from the map found nothing, so
  // `heapOrder` compared undefined with undefined)
  const heapEqu = /^\.core\.ZXBASIC_MEM_HEAP EQU (\d+)$/m.exec(asm);
  const heap = heapEqu !== null ? Number(heapEqu[1]) : addr('core.ZXBASIC_MEM_HEAP');
  const strSlots = from === undefined || to === undefined ? [] : stringSlots([...(r.map ?? '').matchAll(/^([0-9A-F]+): (\S+)$/gm)].map((m) => [m[2] as string, parseInt(m[1] as string, 16)]), from, to);
  return { asm, errors, image: { bytes: r.binary, org: r.org, entry: r.entry, data: from !== undefined && to !== undefined && to >= from ? { from, to } : null, ...(heap !== undefined ? { heap } : {}), strSlots } };
}

/** The offsets in the data region `from..to` of the string variables (a scalar STRING's label ends in `__s`; it holds a heap pointer). */
function stringSlots(labels: Iterable<[string, number]>, from: number, to: number): number[] {
  const out = new Set<number>();
  for (const [name, a] of labels) if (/__s$/.test(name) && a >= from && a + 2 <= to) out.add(a - from);
  return [...out].sort((x, y) => x - y);
}

/** The library's asm that a linked text includes by path (the loco and cpcbuild routines): the text route of the fault hook needs them. */
const locoFiles = (): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [path, text] of libTree()) if ((path.startsWith('loco/') || path.startsWith('cpcbuild/')) && path.endsWith('.asm')) out[path] = text;
  return out;
};

/** The assembler's defines for a built program, as `compile()` derives them (the target's, plus the printer echo that ends a run at RST 0). */
function asmDefinesFor(asm: string, p: Program): Map<string, string> {
  const target = makeTarget({
    defines: { __CPC_PRINTER_ECHO__: '', ...p.defines },
    fileBuffers: { input: asm.includes('loco/file.asm'), output: asm.includes('loco/fileout.asm') },
  });
  return new Map(target.asmDefines);
}

/** The assembled bytes of asm text (the same image `runAsmText` runs), for the harness's own test. */
export function assembleForCheck(asm: string, p: Program): Uint8Array {
  return assembleText(asm, { defines: asmDefinesFor(asm, p), files: locoFiles() }).bytes;
}

/** The simulator's options for a program: its typed keys and the files it finds on the disc. */
function runOptions(p: Program, maxTStates: number): RunOptions {
  const disc = p.disc;
  return {
    maxTStates,
    ...(p.keys !== undefined ? { keys: p.keys } : {}),
    ...(disc !== undefined ? { setup: (cpc) => Object.entries(disc).forEach(([name, text]) => cpc.disc.put(name, text)) } : {}),
  };
}

/** The bytes on the heap's free list (header at `heap`: the first free block's address at +2; a block holds its size, then the next block's address). */
function heapFreeBytes(mem: Uint8Array, heap: number): number {
  const w = (a: number): number => (mem[a] as number) | ((mem[a + 1] as number) << 8);
  let total = 0;
  for (let p = w(heap + 2), guard = 0; p !== 0 && guard < 100000; p = w(p + 2), guard++) total += w(p);
  return total;
}

/** Assembles and runs asm text; `maxTStates` bounds the run. Throws when the asm does not assemble. */
export function runAsmText(asm: string, p: Program, maxTStates: number): Outcome {
  const image = assembleText(asm, { defines: asmDefinesFor(asm, p), files: locoFiles() });
  const r = runImage(image.bytes, image.org, image.entry, runOptions(p, maxTStates));
  const sym = (name: string): number | undefined => (image.symbols.get(name) ?? image.symbols.get(`.${name}`))?.value;
  const from = sym('.core.ZXBASIC_USER_DATA');
  // the same cut as asmAt's (R20): the program's variables, up to the first hidden global when there is one
  const end = sym('.core.ZXBASIC_USER_DATA_END');
  const hidden = sym('V.0');
  const to = end !== undefined && hidden !== undefined && from !== undefined && hidden >= from && hidden <= end ? hidden : end;
  const data = from !== undefined && to !== undefined && to >= from ? Buffer.from(r.memory.slice(from, to)).toString('hex') : '';
  const heap = sym('.core.ZXBASIC_MEM_HEAP');
  const strSlots = from === undefined || to === undefined ? [] : stringSlots([...image.symbols].map(([n, v]) => [n, v.value] as [string, number]), from, to);
  return { printer: r.printer, stopped: r.stopped, data, tstates: r.tstates, calls: callsOf(r), ...(p.heapOrder === true && heap !== undefined ? { heapFree: heapFreeBytes(r.memory, heap), strSlots } : {}) };
}

/** Runs the image `compile()` built (what a user gets); `maxTStates` bounds the run. */
export function runBuilt(b: Built, p: Program, maxTStates: number): Outcome {
  if (b.image === undefined) return runAsmText(b.asm, p, maxTStates);
  const r = runImage(b.image.bytes, b.image.org, b.image.entry, runOptions(p, maxTStates));
  const d = b.image.data;
  const data = d !== null ? Buffer.from(r.memory.slice(d.from, d.to)).toString('hex') : '';
  const heap = b.image.heap;
  return { printer: r.printer, stopped: r.stopped, data, tstates: r.tstates, calls: callsOf(r), ...(p.heapOrder === true && heap !== undefined ? { heapFree: heapFreeBytes(r.memory, heap), strSlots: b.image.strSlots ?? [] } : {}) };
}

/** Whether two builds are the same program: the same text, and (when `compile()`'s image is run) the same image. */
export function sameBuild(a: Built, b: Built): boolean {
  if (a.asm !== b.asm) return false;
  if (a.image === undefined || b.image === undefined) return a.image === b.image;
  return a.image.org === b.image.org && a.image.entry === b.image.entry && Buffer.from(a.image.bytes).equals(Buffer.from(b.image.bytes));
}

export const DEFAULT_MAX_TSTATES = 400_000_000;

export interface Verdict {
  /** Why the program is not a failure: ok, skipped (does not build or does not end at -O0) or a mismatch text. */
  readonly kind: 'ok' | 'skipped' | 'fail';
  readonly detail: string;
  /** Levels that were assembled and run (the rest emitted -O0's asm). */
  readonly ran: readonly Level[];
  readonly t0: number;
}

/** First difference between two outcomes, or null. */
export function diffOutcomes(a: Outcome, b: Outcome, compareData = true, timing = false, speedChecks: readonly string[] = [], heapOrder = false): string | null {
  if (a.stopped !== b.stopped) return `stopped ${a.stopped} at -O0 but ${b.stopped}`;
  if (timing) {
    const va = verdictLines(a.printer, speedChecks);
    const vb = verdictLines(b.printer, speedChecks);
    if (va !== vb) return `check verdicts differ\n--- -O0\n${show(va)}\n--- optimised\n${show(vb)}`;
    compareData = false;
  } else if (a.printer !== b.printer) return `transcript differs\n--- -O0\n${show(a.printer)}\n--- optimised\n${show(b.printer)}`;
  if ((a.calls ?? '') !== (b.calls ?? '')) return `firmware calls differ\n--- -O0\n${show(a.calls ?? '')}\n--- optimised\n${show(b.calls ?? '')}`;
  if (heapOrder) {
    if (a.heapFree !== b.heapFree) return `heap free bytes differ at the end: ${a.heapFree} at -O0, ${b.heapFree} optimised (a temporary string not freed, or freed twice)`;
    // the string variables' pointers may differ; every other byte of the variables is compared (R20)
    a = { ...a, data: maskSlots(a.data, a.strSlots ?? []) };
    b = { ...b, data: maskSlots(b.data, b.strSlots ?? []) };
  }
  if (compareData && a.data !== b.data) {
    let i = 0;
    while (i < a.data.length && a.data[i] === b.data[i]) i++;
    return `data region differs at byte ${i >> 1} of ${a.data.length >> 1} (-O0 ${a.data.slice(i & ~1, (i & ~1) + 8)}, optimised ${b.data.slice(i & ~1, (i & ~1) + 8)})`;
  }
  return null;
}

/** `data` (hex) with the two bytes at each offset of `slots` blanked. */
function maskSlots(data: string, slots: readonly number[]): string {
  let out = data;
  for (const o of slots) if (2 * o + 4 <= out.length) out = `${out.slice(0, 2 * o)}----${out.slice(2 * o + 4)}`;
  return out;
}

/** A timing program's verdicts: its `PASS name`, `FAIL name` and `DONE` lines reduced to the first two words (the numbers measured are not compared). */
function verdictLines(printer: string, speedChecks: readonly string[]): string {
  return printer
    .split('\n')
    .filter((l) => /^(PASS|FAIL|DONE)\b/.test(l))
    .map((l) => l.split(/\s+/).slice(0, 2).join(' '))
    .filter((l) => !speedChecks.includes(l.split(' ')[1] ?? ''))
    .join('\n');
}

const show = (s: string): string => JSON.stringify(s.length > 600 ? `${s.slice(0, 600)}...` : s);

/** Builds `p` at -O0 and at each of `levels`, runs the ones whose asm differs, and compares them with -O0. */
export function compareLevels(p: Program, levels: readonly Level[] = OPT_LEVELS, opts: { readonly requireRun?: boolean } = {}): Verdict {
  const base = asmAt(p, 0);
  if (base.asm === '') return { kind: 'skipped', detail: `does not build at -O0: ${base.errors[0] ?? ''}`, ran: [], t0: 0 };
  const built = new Map<Level, Built>();
  for (const level of levels) {
    const b = asmAt(p, level);
    if (b.asm === '') return { kind: 'fail', detail: `-O${level} does not build: ${b.errors[0] ?? '(no asm)'}`, ran: [], t0: 0 };
    built.set(level, b);
  }
  const differing = levels.filter((l) => !sameBuild(built.get(l)!, base));
  // nothing to run: every level emitted -O0's text (wave 0, or a program no pass touches). `requireRun` (the fuzzer) still
  // runs -O0 and reports a program that does not end there as 'skipped': a program the generator should not have made.
  if (differing.length === 0 && opts.requireRun !== true) return { kind: 'ok', detail: '', ran: [], t0: 0 };
  const limit = p.maxTStates ?? DEFAULT_MAX_TSTATES;
  let o0: Outcome;
  try {
    o0 = runBuilt(base, p, limit);
  } catch (e) {
    // the simulator does not model something the program calls (an unhandled firmware address): not a program to compare
    return { kind: 'skipped', detail: `-O0 cannot run: ${(e as Error).message.split('\n')[0]}`, ran: [], t0: 0 };
  }
  if (o0.stopped !== 'rst0') return { kind: 'skipped', detail: `-O0 stops with ${o0.stopped}\n${show(o0.printer)}`, ran: [], t0: o0.tstates };
  const ran: Level[] = [];
  for (const level of differing) {
    ran.push(level);
    let o: Outcome;
    try {
      // an optimised program may be slower than -O0 by a little, never by this much: a run-away is a failure, found fast
      o = runBuilt(built.get(level)!, p, Math.min(limit, o0.tstates * 4 + 2_000_000));
    } catch (e) {
      return { kind: 'fail', detail: `-O${level}: ${(e as Error).message.split('\n').slice(0, 3).join(' | ')}`, ran, t0: o0.tstates };
    }
    const why = diffOutcomes(o0, o, p.compareData !== false && p.layoutDependent !== true, p.timing === true, p.speedChecks, p.heapOrder === true);
    if (why !== null) return { kind: 'fail', detail: `-O${level}: ${why}`, ran, t0: o0.tstates };
  }
  return { kind: 'ok', detail: '', ran, t0: o0.tstates };
}
