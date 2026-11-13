/**
 * Test helper: BASIC source through the whole library pipeline (front end, bind, check,
 * lower, generate, link, assemble) and onto the test Z80, for the lowering tests. Test code
 * only; the real driver is `compile()` (L2-WIRE).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { bind } from '../src/binder/index.js';
import { checkProgram } from '../src/checker/index.js';
import { generate, link, makeTarget } from '../src/codegen/index.js';
import { DiagnosticBag } from '../src/core/diagnostics.js';
import { SourceSet } from '../src/core/source.js';
import { lower } from '../src/ir/index.js';
import type { IrProgram } from '../src/ir/ir.js';
import type { SourceSettings } from '../src/sem/model.js';
import { printIr } from '../src/ir/print.js';
import { verifyIr } from '../src/ir/verify.js';
import { runFrontEnd } from '../src/pipeline.js';
import { assembleAndRun, repoRoot } from './z80sim/run.js';
import type { AssembledRun, RunOptions } from './z80sim/run.js';
import { shadowOrRecord } from './opt-shadow.js';

function loadTree(): Map<string, string> {
  const tree = new Map<string, string>();
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, `${prefix}${name}/`);
      else if (name.endsWith('.asm')) tree.set(`${prefix}${name}`, readFileSync(full, 'latin1'));
    }
  };
  walk(join(repoRoot, 'lib/runtime'), 'runtime/');
  walk(join(repoRoot, 'lib/loco'), 'loco/');
  return tree;
}

let cachedTree: Map<string, string> | undefined;
const tree = (): Map<string, string> => (cachedTree ??= loadTree());

export interface Lowered {
  readonly ir: IrProgram;
  readonly irText: string;
  readonly problems: readonly string[];
  /** Every diagnostic up to and including lowering, as `CODE message`. */
  readonly diagnostics: readonly string[];
  readonly sources: SourceSet;
  readonly bag: DiagnosticBag;
  /** The `#pragma org`/`heap_size`/`heap_address` settings, passed to the target as `compile()` does. */
  readonly settings: SourceSettings;
}

/** Front end, bind, check and lower. */
/** `subset: false` lifts the L2 subset gate (VAL is outside it until L2-CG-REAL). */
export function lowerSource(text: string, files: Record<string, string> = {}, subset = true): Lowered {
  const sources = new SourceSet();
  const bag = new DiagnosticBag();
  const map = new Map<string, string>([['t.bas', text], ...Object.entries(files)]);
  const { program } = runFrontEnd({ files: map, main: 't.bas' }, sources, bag);
  const bound = bind({ program, sources, diagnostics: bag, bareMetal: false });
  const checked = checkProgram({ bound, sources, diagnostics: bag }, { subset });
  const errorsSoFar = bag.hasErrors;
  const ir = errorsSoFar ? { main: [], procedures: [], globals: [], strings: [], data: [], requires: [], inits: [] } : lower({ checked, diagnostics: bag });
  return {
    ir,
    irText: printIr(ir),
    problems: errorsSoFar ? [] : verifyIr(ir),
    diagnostics: bag.all().map((d) => `${d.code} ${d.message}`),
    sources,
    bag,
    settings: bound.settings,
  };
}

export interface Built extends Lowered {
  /** The linked asm text, or '' when there were errors. */
  readonly asm: string;
  readonly defines: ReadonlyMap<string, string>;
}

/** `lowerSource` plus generate and link. */
export function buildSource(text: string, defines: Record<string, string> = {}, subset = true): Built {
  const low = lowerSource(text, {}, subset);
  const target = makeTarget({ defines: { __CPC_PRINTER_ECHO__: '1', ...defines }, settings: low.settings });
  if (low.bag.hasErrors) return { ...low, asm: '', defines: target.asmDefines };
  const generated = generate({ ir: low.ir, target, diagnostics: low.bag, sources: low.sources });
  if (low.bag.hasErrors) return { ...low, diagnostics: low.bag.all().map((d) => `${d.code} ${d.message}`), asm: '', defines: target.asmDefines };
  const linked = link({ asm: generated, target, runtime: tree(), sources: low.sources, diagnostics: low.bag });
  return { ...low, diagnostics: low.bag.all().map((d) => `${d.code} ${d.message}`), asm: linked.text, defines: target.asmDefines };
}

/** The loco files as virtual includes for the assembler (it reads lib/runtime from disk itself). */
function locoFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, text] of tree()) if (path.startsWith('loco/')) out[path] = text;
  return out;
}

/** Builds and runs a program on the test Z80 with the printer echo on. */
export function runSource(text: string, run: RunOptions = {}, subset = true): AssembledRun & { readonly built: Built } {
  const built = buildSource(text, {}, subset);
  if (built.asm === '') throw new Error(`build failed:\n${built.diagnostics.join('\n')}`);
  const r = assembleAndRun(built.asm, { defines: built.defines, files: locoFiles(), maxTStates: 400_000_000, ...run });
  // L5-DIFF: CPCBAS_OPT_RECORD=<file> appends the program to the corpus of test/opt-diff.test.ts; CPCBAS_OPT_SHADOW=1
  // also runs it at every optimisation level and fails the calling test when an outcome differs from -O0's
  shadowOrRecord(text, run);
  return Object.assign(r, { built });
}

const END_MARKER = '\x04END\n';

/** The harness normaliser (tools/loco-diff.py `normalise`) over a printer capture; null without the END marker. */
export function normalise(raw: string): string | null {
  if (!raw.includes(END_MARKER)) return null;
  let text = raw.slice(0, raw.indexOf(END_MARKER)).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (text.endsWith('Ready')) text = text.slice(0, -'Ready'.length);
  if (text !== '' && !text.endsWith('\n')) text += '\n';
  return text
    .split(/(?<=\n)/)
    .map((line) => (line.startsWith('~') ? '~\n' : line))
    .join('');
}

/** tools/loco-diff.py's real rule (`transcripts_match`, programs listed under "real" in tests/loco/compare.json). */
const NUMBER = /(-?(?:\d+\.?\d*|\.\d+)(?:E[+-]\d+)?)/;

/** Two number texts within one unit of their 8th significant digit. */
export function numbersAgree(a: string, b: string, digits = 8): boolean {
  const x = Number(a);
  const y = Number(b);
  if (x === y) return true;
  const big = Math.max(Math.abs(x), Math.abs(y));
  return Math.abs(x - y) <= 10 ** (Math.floor(Math.log10(big)) - digits + 1) * (1 + 1e-12);
}

function linesMatch(want: string, got: string): boolean {
  if (want === got) return true;
  const w = want.split(NUMBER);
  const g = got.split(NUMBER);
  return w.length === g.length && w.every((a, i) => (i % 2 === 0 ? a === g[i] : numbersAgree(a, g[i] as string)));
}

/** Whole transcripts under the rule: 'exact' (byte for byte) or 'real' (numbers to 8 significant digits). */
export function transcriptsMatch(want: string, got: string, rule: 'exact' | 'real' = 'exact'): boolean {
  if (rule === 'exact') return want === got;
  const w = want.split('\n');
  const g = got.split('\n');
  return w.length === g.length && w.every((line, i) => linesMatch(line, g[i] as string));
}
