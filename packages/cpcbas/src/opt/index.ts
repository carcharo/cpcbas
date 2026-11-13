/**
 * The pass manager (L5-0): the optimisation levels, the pass lists of the three stages, and the
 * hooks that `pipeline.ts` and `codegen/generate.ts` call. The contract is docs/ir.md
 * "Optimisation"; a change to it is a contract change.
 *
 *   IR (lowered)  --IR passes-->  IR  --generate (CodegenOptions: register temps, template style)
 *   --code passes (per CodeUnit, all units at once)-->  AsmProgram  --link-->  LinkedAsm
 *   --link passes-->  LinkedAsm  --assemble-->
 *
 * Registration: each wave-1-3 task appends its own pass to one of `IR_PASSES`, `CODE_PASSES` or
 * `LINK_PASSES` (one line each; append-only, so parallel branches merge). Passes run in `order`,
 * then by name, so the position of a line in the array does not matter. A pass runs when its
 * `when(spec)` holds for the level and its name is not in `--opt-disable`.
 *
 * Pure: no file system, no clock, no randomness. `-O0` runs nothing and builds RC3's code.
 */

import type { DiagnosticBag } from '../core/diagnostics.js';
import type { Span } from '../core/source.js';
import { stripPass } from './strip.js';
import type { IrProgram } from '../ir/ir.js';
import { verifyIr } from '../ir/verify.js';
import type { CodegenOptions, CodeUnit, LinkedAsm, Target, TemplateStyle } from '../codegen/types.js';
import { PEEPHOLE_PASS } from './peephole/pass.js';
import { JR_PASS } from './jr.js';
import { TAILMERGE_PASS } from './tailmerge.js';
import { IR_CONST, IR_COPY, IR_DEAD, IR_STRENGTH } from '../ir/opt/index.js';

/** An optimisation level: the CLI's `-O0` .. `-O3` and `-Os`, the library's `optimize`. */
export type OptLevel = 0 | 1 | 2 | 3 | 's';

/** Every level, in the order the tables list them. */
export const OPT_LEVELS: readonly OptLevel[] = [0, 1, 2, 3, 's'];

/** The level when none is given (L5 question 1: `-O2`, the fork's default and the speed target's level). */
export const DEFAULT_OPT_LEVEL: OptLevel = 2;

/** What a level turns on. The passes read this, never the level itself, so `-Os` is "-O2 with short templates and size rules". */
export interface LevelSpec {
  readonly level: OptLevel;
  /** L5-TEMPS: temps handed over in the result registers, and compare-and-branch fusion. */
  readonly registerTemps: boolean;
  /** L5-PEEP: the fork's rules with OLEVEL at most this, then our own rules of the same level (0: the engine does not run). */
  readonly peephole: 0 | 1 | 2;
  /** L5-PEEP: unused generated labels are removed and the rules run a second time (the fork's `emit` at -O2). */
  readonly unusedLabels: boolean;
  /** L5-IR: the IR passes. */
  readonly irPasses: boolean;
  /** L5-CG: the template style. */
  readonly style: TemplateStyle;
  /** L5-CG and L5-PEEP: rules and helpers that trade speed for size (`jr`, the `-Os` helper calls). */
  readonly sizeRules: boolean;
  /** L5-STRIP: unreferenced runtime and library chunks are dropped. */
  readonly strip: boolean;
  /** L5-FLOW: basic blocks, the CPU-state model and the OLEVEL 3/4 rules. */
  readonly flow: boolean;
}

const O0: LevelSpec = {
  level: 0,
  registerTemps: false,
  peephole: 0,
  unusedLabels: false,
  irPasses: false,
  style: 'base',
  sizeRules: false,
  strip: false,
  flow: false,
};
const O1: LevelSpec = { ...O0, level: 1, registerTemps: true, peephole: 1, strip: true };
const O2: LevelSpec = { ...O1, level: 2, peephole: 2, unusedLabels: true, irPasses: true, style: 'fast' };
const O3: LevelSpec = { ...O2, level: 3, flow: true };
const OS: LevelSpec = { ...O2, level: 's', style: 'short', sizeRules: true };

/** The level table (docs/ir.md "Optimisation", "Levels"). */
export const LEVELS: Readonly<Record<string, LevelSpec>> = Object.freeze({ 0: O0, 1: O1, 2: O2, 3: O3, s: OS });

/** The spec of a level. */
export function levelSpec(level: OptLevel): LevelSpec {
  return LEVELS[String(level)] as LevelSpec;
}

/** Whether `x` is a level (the library's `optimize` comes from JavaScript callers too). */
export function isOptLevel(x: unknown): x is OptLevel {
  return x === 0 || x === 1 || x === 2 || x === 3 || x === 's';
}

// ---------------------------------------------------------------------------
// Passes
// ---------------------------------------------------------------------------

/** What an IR pass may read: IR passes are target-independent (the target is made after lowering). */
export interface IrPassEnv {
  readonly spec: LevelSpec;
  /** `--opt-trace`: a pass that changes lines writes `\t; opt <name>: <what>` comment lines next to them (code stage), so the totals are a count of those lines in `--asm`. */
  readonly trace: boolean;
  /** False for a name given to `--opt-disable` (a pass, a rule, or a feature). */
  enabled(name: string): boolean;
}

/** What a code or link pass may read. */
export interface PassEnv extends IrPassEnv {
  readonly target: Target;
}

interface PassBase {
  /** The `--opt-disable` name: lower case, `[a-z0-9][a-z0-9_-]*` (`peephole`, `ir-const`, `strip`; rule names such as `000_o1_push_pop`). */
  readonly name: string;
  /** Run order within the stage (the slots are listed at each array); ties run by name. */
  readonly order: number;
  /** Whether the level runs it. */
  when(spec: LevelSpec): boolean;
  /** Further `--opt-disable` names the pass answers to (the peephole's rule names); the pass checks them itself with `env.enabled`. */
  readonly names?: readonly string[];
}

/** An IR pass (L5-IR): a new program; the verifier runs after it, and a failure is E001 naming the pass. */
export interface IrPass extends PassBase {
  run(ir: IrProgram, env: IrPassEnv): IrProgram;
}

/** A code-stage pass (L5-PEEP, L5-FLOW, L5-CG's `jr`): new units, never a changed `quads` array, `opaque` and `boundary` lines kept in place. */
export interface CodePass extends PassBase {
  run(units: readonly CodeUnit[], env: PassEnv): readonly CodeUnit[];
}

/**
 * A link-stage pass (L5-STRIP): the linked text before it is assembled. A pass that needs the
 * assembled symbols assembles in its own `SourceSet` (the pipeline's is not touched). It may
 * add an optional field to `LinkedAsm` that `assemble` honours (its owner adds both, absent =
 * today's behaviour).
 */
export interface LinkPass extends PassBase {
  run(linked: LinkedAsm, env: PassEnv): LinkedAsm;
}

/** IR passes. Order slots: 100 constant and copy propagation, 200 repeated subexpressions, 300 cheaper equivalents, 400 dead code and unused temps (L5-IR). */
export const IR_PASSES: readonly IrPass[] = [IR_CONST, IR_COPY, IR_STRENGTH, IR_DEAD];

/** Code passes. Order slots: 100 peephole (L5-PEEP; it also runs unused-label removal and its second round), 300 flow (L5-FLOW, -O3), 800 -Os helpers (L5-CG), 900 `jr` (L5-CG; last, it measures distances). */
export const CODE_PASSES: readonly CodePass[] = [PEEPHOLE_PASS, JR_PASS, TAILMERGE_PASS];

/** Link passes. Order slots: 100 strip (L5-STRIP). */
export const LINK_PASSES: readonly LinkPass[] = [stripPass];

/**
 * Names `--opt-disable` takes besides the passes' names: the features of code generation.
 * `temps`: register temps (L5-TEMPS); `cmpjump`: compare-and-branch and condition fusion
 * (L5-TEMPS); `templates`: the level's template style, back to `base` (L5-CG).
 */
export const FEATURE_NAMES: readonly string[] = ['cmpjump', 'templates', 'temps'];

/** Every name `--opt-disable` accepts with the passes registered now, sorted. */
export function optNames(): string[] {
  const names = new Set(FEATURE_NAMES);
  for (const p of [...IR_PASSES, ...CODE_PASSES, ...LINK_PASSES]) {
    names.add(p.name);
    for (const n of p.names ?? []) names.add(n);
  }
  return [...names].sort();
}

const byOrder = <P extends PassBase>(passes: readonly P[]): P[] =>
  [...passes].sort((a, b) => a.order - b.order || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

// ---------------------------------------------------------------------------
// The optimiser of one compile
// ---------------------------------------------------------------------------

export interface OptimizerInput {
  /** `CompileOptions.optimize`; undefined means {@link DEFAULT_OPT_LEVEL}. Anything else that is not a level is E570. */
  readonly level?: unknown;
  /** `--opt-disable`; an unknown name is E571. */
  readonly disable?: readonly string[];
  /** `--opt-trace`. */
  readonly trace?: boolean;
  readonly diagnostics: DiagnosticBag;
  /** Where E570/E571 are reported (the main file). */
  readonly span: Span;
  /** The passes (tests); default the registered ones. */
  readonly passes?: { readonly ir?: readonly IrPass[]; readonly code?: readonly CodePass[]; readonly link?: readonly LinkPass[] };
}

/** The hooks of one compile. */
export interface Optimizer {
  readonly spec: LevelSpec;
  /** The IR stage (`pipeline.ts`, after the `ir` dump, before `generate`). */
  ir(ir: IrProgram): IrProgram;
  /** What `generate` takes (`GenerateInput.opt`): undefined at `-O0`, so `generate` takes RC3's path. */
  codegen(target: Target): CodegenOptions | undefined;
  /** The link stage (`pipeline.ts`, between `link` and `assemble`). */
  link(linked: LinkedAsm, target: Target): LinkedAsm;
}

/**
 * Builds the optimiser of one compile. Bad input is reported (E570 for the level, E571 for an
 * `--opt-disable` name) and the default level is used, so the caller stops on `bag.hasErrors` as
 * for any other error.
 */
export function makeOptimizer(input: OptimizerInput): Optimizer {
  const irPasses = byOrder(input.passes?.ir ?? IR_PASSES);
  const codePasses = byOrder(input.passes?.code ?? CODE_PASSES);
  const linkPasses = byOrder(input.passes?.link ?? LINK_PASSES);

  let level: OptLevel = DEFAULT_OPT_LEVEL;
  if (input.level !== undefined) {
    if (isOptLevel(input.level)) level = input.level;
    else input.diagnostics.report('E570', input.span, `optimisation level ${JSON.stringify(input.level)} is not 0, 1, 2, 3 or 's'`);
  }
  const spec = levelSpec(level);

  const known = new Set(FEATURE_NAMES);
  for (const p of [...irPasses, ...codePasses, ...linkPasses]) {
    known.add(p.name);
    for (const n of p.names ?? []) known.add(n);
  }
  const disabled = new Set<string>();
  for (const name of input.disable ?? []) {
    if (known.has(name)) disabled.add(name);
    else input.diagnostics.report('E571', input.span, `--opt-disable: '${name}' is not the name of a pass, rule or feature`);
  }
  const enabled = (name: string): boolean => !disabled.has(name);
  const trace = input.trace === true;
  const env = (target: Target): PassEnv => ({ spec, target, trace, enabled });
  const runs = (p: PassBase): boolean => p.when(spec) && enabled(p.name);

  return {
    spec,
    ir(ir) {
      let out = ir;
      for (const p of irPasses) {
        if (!runs(p)) continue;
        out = p.run(out, { spec, trace, enabled });
        const problems = verifyIr(out);
        if (problems.length > 0) {
          input.diagnostics.report('E001', input.span, `Internal compiler error: the IR failed verification after the optimiser pass '${p.name}': ${problems[0] as string}`);
          return ir;
        }
      }
      return out;
    },
    codegen(target) {
      if (spec.level === 0) return undefined;
      const e = env(target);
      return {
        registerTemps: spec.registerTemps && enabled('temps'),
        style: enabled('templates') ? spec.style : 'base',
        enabled,
        runCodePasses(units) {
          let out = units;
          for (const p of codePasses) if (runs(p)) out = p.run(out, e);
          return out;
        },
      };
    },
    link(linked, target) {
      let out = linked;
      const e = env(target);
      for (const p of linkPasses) if (runs(p)) out = p.run(out, e);
      return out;
    },
  };
}
