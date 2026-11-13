/**
 * The code generator's contract: IR quads to asm text over the reused runtime, and the
 * link step that wraps the program in the CPC prologue and epilogue.
 *
 * Pipeline:
 *   IrProgram --generate--> AsmProgram --link--> LinkedAsm (one asm text) --assemble--> segments
 *   --layout check--> binary, map --pack--> .bin / .dsk / .cpr
 *
 * Templates: one function per quad op and IR type, collected in {@link TemplateTable}s
 * that each task owns (`codegen/int.ts` for u8..i32, `codegen/flow.ts` for control and
 * procedures, `codegen/str.ts`, `codegen/real.ts`), merged by `codegen/index.ts`. A
 * template returns asm lines and records the runtime files it needs through
 * {@link EmitContext.requires}; it never writes `#include` itself.
 *
 * Asm text conventions (as the reference compiler's output, which our assembler reads
 * byte-identically): an instruction or directive line starts with a tab (`\tld a, 1`); a
 * label is `name:` at column 0; an EQU is `name EQU value` at column 0; comments `;`.
 * Runtime labels are fully qualified (`.core.__PRINTSTR`). Generated local labels come
 * from {@link EmitContext.newLabel} (`.T.0`, `.T.1`, ...), user line labels from
 * sem/model.ts `lineLabel`, variables from `globalLabel`.
 */

import type { DiagnosticBag } from '../core/diagnostics.js';
import type { FileTree, SourceSet, Span } from '../core/source.js';
import type { IncludeResolver } from '../asm/types.js';
import type { IrProcedure, IrProgram, Quad } from '../ir/ir.js';
import type { RequireSet } from './requires.js';
import type { MemoryMap } from './memory-map.js';

export type Mode = 'firmware' | 'bare';

/** Everything about the build that changes the generated code. Built by `makeTarget` (codegen/target.ts). */
export interface Target {
  readonly mode: Mode;
  readonly org: number;
  readonly heapSize: number;
  /** Where the heap starts (default: top-aligned below `map.codeLimit`, as the reference). */
  readonly heapAddress: number;
  readonly map: MemoryMap;
  /**
   * Names defined for the asm preprocessor and the assembler: the user's `-D` names (so
   * `CPC_BAREMETAL`, `__CPC_PRINTER_ECHO__`, `CPC464`... reach the runtime) plus the
   * compiler's own: `CPC_INKEY_BUFFERED` in firmware mode (spec decision 6: INKEY$ reads the
   * firmware key buffer). Sorted by name when iterated.
   */
  readonly asmDefines: ReadonlyMap<string, string>;
}

/** What a template may use. */
export interface EmitContext {
  readonly target: Target;
  readonly requires: RequireSet;
  /** A fresh local label, unique in the program (`.T.<n>`). */
  newLabel(): string;
  /** The procedure being generated, or null for the main program. */
  readonly procedure: IrProcedure | null;
  /** `IrProgram.checkBreak` (false when absent): what a `stmt` quad emits. */
  readonly checkBreak: boolean;
  readonly diagnostics: DiagnosticBag;
  /** The template style of the level (L5-CG); absent means `base`, RC3's templates. */
  readonly style?: TemplateStyle;
}

/**
 * Turns one quad into asm lines. Pure apart from `ctx.requires` and `ctx.newLabel`.
 *
 * `form` is the template-operand protocol of L5-TEMPS (below, {@link TempForm}). Absent, or
 * {@link STACK_FORM}, the template emits its **stack form**: every temp operand is popped and the
 * result is pushed, exactly the lines RC3 emitted. `-O0` only ever uses the stack form, so the
 * stack form of a template must never change. A table that wraps its templates (int.ts `build`)
 * passes `form` through.
 */
export type Template = (q: Quad, ctx: EmitContext, form?: TempForm) => readonly string[];

// ---------------------------------------------------------------------------
// The template-operand protocol (L5-0 for L5-TEMPS; docs/ir.md "Optimisation")
// ---------------------------------------------------------------------------

/**
 * Where the temps of one quad are at its edges. A temp is "in the result registers" when the
 * quad before left it there instead of pushing it: A for `u8`/`i8` (F undefined), HL for
 * `u16`/`i16`/`str` (an owned string stays owned), DEHL for `u32`/`i32`/`f16`, A E D C B for `f`
 * (docs/ir.md "Types"). Nothing else is handed over: the receiving template may assume no other
 * register, no flag and nothing about the alternate set. The stack below is exactly what the
 * stack form would see after popping that operand.
 *
 * The generate driver decides the form of every quad before emitting it (one quad of look-ahead):
 * quad i hands its result to quad i+1 when (1) i's `dst` is a temp t, (2) i+1 is the next quad of
 * the same body (nothing between, not even a `comment`), (3) t is the operand i+1 pops first: `b`
 * when `b` is a temp, else `a` (for `poke`, `out` and `astore` too: the value `b` before the
 * address `a`; `aaddr`'s unnamed `dims` never), (4) the register-form table
 * ({@link RegisterFormTable}) says that i's key can leave its result and that i+1's key can take
 * that operand, and (5) the level has register temps on and `--opt-disable temps` is not given.
 * Because temps are LIFO and never cross a label, jump or statement, only the operand popped
 * first can be adjacent; a template that needs the operands in other registers (b in DE, the REAL
 * in the alternate set) moves it itself (`ex de, hl`, `exx`): a producer never targets any
 * register but the result registers.
 */
export interface TempForm {
  /** The temp operand that arrives in the result registers ('a' or 'b'), or null: every temp operand is on the stack. */
  readonly inRegs: 'a' | 'b' | null;
  /** The quad's result is left in the result registers for the next quad: the template omits its push. */
  readonly resultInRegs: boolean;
}

/** The stack form: what `-O0` emits, and what a missing `form` means. */
export const STACK_FORM: TempForm = Object.freeze({ inRegs: null, resultInRegs: false });

/** What a template key's register form supports. A key that is not in the table has the stack form only. */
export interface RegisterForms {
  /** It can leave its result in the result registers (`resultInRegs`). */
  readonly result: boolean;
  /** The temp operands it can take from the result registers (`inRegs`). */
  readonly operands: readonly ('a' | 'b')[];
}

/** Register-form capabilities by template key (the same keys as {@link TemplateTable}). */
export type RegisterFormTable = Readonly<Record<string, RegisterForms>>;

/** A comparison quad (`eq ne lt le gt ge`). */
export type CompareQuad = Extract<Quad, { readonly op: 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge' }>;

/** Where a fused compare-and-branch goes: to `label` when the comparison is true (`jnz`) or false (`jz`); it falls through otherwise. */
export interface BranchTarget {
  readonly when: 'true' | 'false';
  readonly label: string;
}

/**
 * A comparison fused with the `jz`/`jnz` that tests its result, keyed `cmpjump:<op>:<type>`
 * (`cmpjump:lt:i16`, `cmpjump:eq:str`; the type is the comparison's operand type). It emits no
 * boolean: the comparison's flags branch directly. The driver fuses quad i (a comparison whose
 * `dst` is temp t) with quad i+1 (`jz`/`jnz` whose `a` is t) when the key exists, the level has
 * register temps on, and `--opt-disable cmpjump` is not given. `form.inRegs` is the comparison's
 * own operand from quad i-1; `form.resultInRegs` is always false. Without the key the pair is
 * emitted as two quads (with the register form between them when both keys allow it).
 */
export type CompareJumpTemplate = (cmp: CompareQuad, branch: BranchTarget, ctx: EmitContext, form: TempForm) => readonly string[];

export type CompareJumpTable = Readonly<Record<string, CompareJumpTemplate>>;

/** The template style a level asks for (L5-CG): `base` is RC3's, `fast` the -O2 forms, `short` the -Os forms. */
export type TemplateStyle = 'base' | 'fast' | 'short';

// ---------------------------------------------------------------------------
// The code stage (what the AsmProgram passes see; docs/ir.md "Optimisation")
// ---------------------------------------------------------------------------

/**
 * One line of generated code, tagged for the code-stage passes.
 * - `code`: a template's line. Passes may change, move or remove it within the rules.
 * - `opaque`: a line of an `asm` quad (user or internal, with its `#line` lines) or of the `stmt`
 *   template (the ESC check). Never matched, changed, moved or removed; no pattern window
 *   contains one, and a window may not end directly before one (the block reads every register).
 * - `boundary`: a statement start (the `stmt` quad), no text. No window spans it and no fact
 *   about a register or a global survives it.
 */
export interface CodeLine {
  readonly text: string;
  readonly kind: 'code' | 'opaque' | 'boundary';
  /** Index in {@link CodeUnit.quads} of the quad whose template emitted the line (a fused pair: the comparison's). */
  readonly quad: number;
}

/** The generated code of the main program or of one procedure. */
export interface CodeUnit {
  /** The procedure's label, or null for the main program. */
  readonly procedure: string | null;
  /** The IR the lines came from (read only: a code pass never changes the IR). */
  readonly quads: readonly Quad[];
  readonly lines: readonly CodeLine[];
}

/** What a level changes in code generation; built by the pass manager (`src/opt/index.ts`), absent = `-O0`. */
export interface CodegenOptions {
  /** L5-TEMPS: the register forms and compare-and-branch fusion (false at -O0). */
  readonly registerTemps: boolean;
  /** L5-CG: the template style. */
  readonly style: TemplateStyle;
  /** Whether a feature or pass named for `--opt-disable` is on (`temps`, `cmpjump`, `templates`, ...). */
  enabled(name: string): boolean;
  /** The code-stage passes, run over every unit after all are emitted. Must return the units unchanged when it has nothing to do. */
  runCodePasses(units: readonly CodeUnit[]): readonly CodeUnit[];
}

/**
 * Templates by key: `op:type` for typed ops (`add:i16`, `store:str`, `jz:u8`), `op` for
 * untyped ones (`label`, `jump`, `call`, `enter`). A `cast` is keyed by both types,
 * `cast:<from>-><to>` (`cast:u8->i16`, `cast:f->i16`, `cast:i16->str`), so each table owns
 * the conversions out of or into its own types without colliding: the integer table has the
 * 36 integer-to-integer keys, L2-CG-REAL the ones with `f`/`f16` on either side, L2-CG-STR
 * the ones with `str`. Lookup tries the full key, then `op`; a missing template is E002
 * ("`op` on `type` is not implemented yet") at the quad's span.
 */
export type TemplateTable = Readonly<Record<string, Template>>;

/** The lookup key of a quad: `op:type` when the quad has a type, else `op`. */
export function templateKey(q: Quad): string {
  if (q.op === 'cast') return `cast:${q.from}->${q.type}`;
  return 'type' in q ? `${q.op}:${q.type}` : q.op;
}

/** The generated user program in the sections the link step places (layout in docs/ir.md, "Program layout"). */
export interface AsmProgram {
  /** Global variables and arrays: between `.core.ZXBASIC_USER_DATA` and `.core.ZXBASIC_USER_DATA_END`. */
  readonly data: readonly string[];
  /** The main program: after `.core.__MAIN_PROGRAM__`, ending with the END sequence. */
  readonly main: readonly string[];
  /** Procedure bodies, in source order. */
  readonly procedures: readonly string[];
  /** String constants and the DATA table. */
  readonly constants: readonly string[];
  /** Runtime files to link (`print.asm`, `loco/text.asm`), sorted, unique; includes `#require` paths and the forced files. */
  readonly requires: readonly string[];
  /** `#init` labels from the source, in source order (the link step adds the runtime's own). */
  readonly inits: readonly string[];
  /** `IrProgram.requireSpans` passed through: a missing file named here is E421 at its `#require`. */
  readonly requireSpans?: ReadonlyMap<string, Span>;
}

export interface GenerateInput {
  readonly ir: IrProgram;
  readonly target: Target;
  readonly diagnostics: DiagnosticBag;
  /** Template tables to use instead of the merged `TEMPLATES` of codegen/index.ts (tests). */
  readonly templates?: readonly TemplateTable[];
  /** The source registry, for the `#line n "path"` an `asm` quad emits before each line; without it no `#line` is written. */
  readonly sources?: SourceSet;
  /** The level's code generation options (`src/opt/index.ts` `Optimizer.codegen`); absent = `-O0`: stack forms, base templates, no code passes. */
  readonly opt?: CodegenOptions;
}

/** `generate(input)`: never throws for bad input; a missing template is E002. */
export type GenerateFn = (input: GenerateInput) => AsmProgram;

export interface LinkInput {
  readonly asm: AsmProgram;
  readonly target: Target;
  /** The runtime tree (`CompileInput.runtime`: paths relative to the repo's `lib/`). */
  readonly runtime: FileTree;
  readonly sources: SourceSet;
  readonly diagnostics: DiagnosticBag;
}

/**
 * The whole program as one asm text, ready for `assemble` (initMode `collect`):
 *
 *   org <org>
 *   .core.CPC_PRIV_BASE EQU ...  (and CPC_PRIV_SIZE, CPC_STACK_TOP, CPC_MEM_TOP)
 *   .core.__START_PROGRAM:
 *   di / ld sp, .core.CPC_STACK_TOP / call <each init, sorted as strings> / jp .core.__MAIN_PROGRAM__
 *   .core.ZXBASIC_USER_DATA:  heap EQUs (when the heap is in use)  user-data length EQUs
 *   <data>  .core.ZXBASIC_USER_DATA_END:  .core.__MAIN_PROGRAM__:  <main>  <procedures>  <constants>
 *   #include once <each require>
 *   END .core.__START_PROGRAM
 *
 * as the reference CPC backend's emit_prologue/emit_epilogue (docs/ir.md has the exact
 * text). The inits are the source's `#init` labels plus every `#init` the linked runtime
 * files contain (found by running the asm preprocessor over the requires), as the
 * reference collects them.
 */
export interface LinkedAsm {
  readonly text: string;
  /** Every init label called by the prologue, in call order. */
  readonly inits: readonly string[];
  /** The heap EQUs were emitted (a heap-using file is linked, or `.core.__MEM_INIT` is an init): the layout check's `heapInUse`. */
  readonly heapInUse: boolean;
  /** Resolves `#include` for the assembler: `runtime/<name>` first, then `<name>` under the lib root (our own `loco/` files). */
  readonly resolveInclude: IncludeResolver;
  /** L5-STRIP: preprocessed lines the assembler leaves out (runtime chunks nothing reachable names); absent = none. As `AssembleOptions.dropLines`. */
  readonly dropLines?: { readonly total: number; readonly ranges: ReadonlyArray<readonly [number, number]> };
}

/** `link(input)`: never throws for bad input; a missing `#require` file is E421 at the `#require`, any other missing runtime file E420. */
export type LinkFn = (input: LinkInput) => LinkedAsm;
