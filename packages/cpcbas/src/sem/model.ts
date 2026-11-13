/**
 * The semantic model: what the binder builds from the AST and the checker completes.
 * Contract for phase L2; readers are the checker, the IR lowering, and
 * later the language server (hover, definitions, references).
 *
 * Shape:
 * - The AST stays as the parser made it. Semantic facts live in side tables keyed by AST
 *   node identity (`Map<Node, ...>`). Nothing here mutates the AST.
 * - Symbols are plain objects in one array, addressed by {@link SymbolId} (their index), so
 *   iteration order is declaration order and deterministic.
 * - Optional facts are `null`, never `undefined`.
 *
 * Phases:
 * - {@link BoundProgram} (binder, `src/binder/`): scopes, symbols with their declared or
 *   default types, every name use resolved to a symbol, labels and line numbers, DATA,
 *   `#require`/`#init`, pragmas. No expression types yet.
 * - {@link CheckedProgram} (checker, `src/checker/`): expression types, implicit
 *   conversions, folded constants, array bounds and DIM AT addresses as numbers, EXIT and
 *   CONTINUE targets. A program with checker errors is never lowered.
 *
 * Rules the binder applies (spec §3, §4, §7):
 * see the doc comments of {@link VariableSymbol}, {@link Scope} and {@link BindInput}.
 */

import type {
  CallOrIndex,
  ContinueStmt,
  DataStmt,
  DataValue,
  DeclareStmt,
  DefFnStmt,
  DimDecl,
  ExitStmt,
  Expr,
  ArrayInit,
  FnCall,
  ForStmt,
  JumpTarget,
  LineLabel,
  Name,
  Param,
  ProcedureDecl,
  Program,
  SubCallStmt,
  CallingConvention,
  WhileStmt,
  DoLoopStmt,
} from '../ast/ast.js';
import type { DiagnosticBag } from '../core/diagnostics.js';
import type { SourceSet, Span } from '../core/source.js';
import type { TypeName } from './types.js';

export type SymbolId = number & { readonly __symbolId: unique symbol };
export type ScopeId = number & { readonly __scopeId: unique symbol };

export function asSymbolId(n: number): SymbolId {
  return n as SymbolId;
}
export function asScopeId(n: number): ScopeId {
  return n as ScopeId;
}

/**
 * The type part of a variable's identity:
 * `%`, `!`, `$` for the suffixed forms and for unsuffixed names whose type is INTEGER,
 * REAL or STRING; the type name for other DIMmed types (`DIM a AS UBYTE` is `a` + `UBYTE`).
 * `a`, `a%`, `a!` and `a$` are four variables, as in Locomotive, unless DEF* or a DIM
 * makes the unsuffixed `a` one of them.
 */
export type TypeKey = '%' | '!' | '$' | Exclude<TypeName, 'INTEGER' | 'REAL' | 'STRING'>;

/** The {@link TypeKey} of a type. */
export function typeKey(t: TypeName): TypeKey {
  if (t === 'INTEGER') return '%';
  if (t === 'REAL') return '!';
  if (t === 'STRING') return '$';
  return t;
}

/** A compile-time value. Numbers are exact JS numbers already wrapped to `type` (sem/types.ts `wrap`). */
export interface ConstValue {
  readonly type: TypeName;
  readonly value: number | string;
}

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------

/**
 * Two levels only (spec §3, §7): the global scope (the main program, top-level DIMs,
 * CONSTs, procedures, labels) and one scope per SUB/FUNCTION/DEF FN (its parameters and
 * locals). Lookup inside a procedure tries the procedure's scope, then the global one.
 */
export interface Scope {
  readonly id: ScopeId;
  readonly kind: 'global' | 'procedure';
  /** The SUB/FUNCTION/DEF FN that owns the scope; null for the global scope. */
  readonly owner: SymbolId | null;
  readonly parent: ScopeId | null;
  /**
   * Scalars and constants. Keys:
   * - identity keys `base + typeKey` for `%`, `!`, `$` (`a%`, `a$`) and `base + ':' + type`
   *   for the other DIM types (`a:UBYTE`);
   * - the bare `base` (`a`): which symbol an unsuffixed use of `a` means in this scope. A DIM
   *   or CONST without a suffix sets it; otherwise an unsuffixed use means the identity of
   *   the default type for its first letter (DEFINT/DEFREAL/DEFSTR ranges, OPTION REAL, else
   *   INTEGER), which the binder resolves and records here.
   */
  readonly names: ReadonlyMap<string, SymbolId>;
  /** Arrays, keyed like `names` (arrays have their own namespace, as in Locomotive: `a` and `a(5)` may both exist). */
  readonly arrays: ReadonlyMap<string, SymbolId>;
  /** SUBs, FUNCTIONs and DEF FNs by lower-cased base name (global scope only; empty elsewhere). A FUNCTION and an array of the same name are an error. */
  readonly procedures: ReadonlyMap<string, SymbolId>;
}

/** Lookup key of a variable or constant identity (see {@link Scope.names}). */
export function identityKey(base: string, key: TypeKey): string {
  return key === '%' || key === '!' || key === '$' ? `${base}${key}` : `${base}:${key}`;
}

// ---------------------------------------------------------------------------
// Symbols
// ---------------------------------------------------------------------------

interface SymbolBase {
  readonly id: SymbolId;
  /** The name as first declared (DIM, SUB, the first use of an implicit variable): case kept, suffix dropped. */
  readonly name: string;
  /** Lower-cased base name. */
  readonly base: string;
  readonly scope: ScopeId;
  /** The declaring node's span (or the first use, for implicit variables). */
  readonly span: Span;
}

/**
 * A scalar variable.
 * - `global`: DIMmed at top level, or implicitly declared in the main program (anywhere in
 *   it, so a procedure written before the main code still sees the global). Storage is a
 *   label in the data area.
 * - `local`: DIMmed in a procedure, or implicitly declared there when no global of that
 *   identity exists. Storage is in the procedure's frame.
 * - `param`: a SUB/FUNCTION/DEF FN parameter.
 * Implicit declaration: any use declares (Locomotive reads an unset variable as 0 or "").
 * Under `#pragma explicit` an undeclared use is an error instead.
 */
export interface VariableSymbol extends SymbolBase {
  readonly kind: 'variable';
  readonly type: TypeName;
  readonly typeKey: TypeKey;
  readonly storage: 'global' | 'local' | 'param';
  readonly declaredBy: 'dim' | 'implicit' | 'for' | 'param' | 'result';
  /** The DIM declarator, when declared by DIM. */
  readonly decl: DimDecl | null;
  /** For parameters. */
  readonly param: { readonly index: number; readonly byref: boolean; readonly node: Param | Name } | null;
  /** Asm label for globals (see {@link globalLabel}); null for locals and parameters. */
  readonly label: string | null;
  /** Assigned anywhere (LET, FOR, READ, INPUT, BYREF argument, MID$ statement, `@` taken). */
  readonly assigned: boolean;
  /** Read anywhere. */
  readonly read: boolean;
}

/** A DIMmed array (arrays must be DIMmed: spec §4). Bounds are folded by the checker. */
export interface ArraySymbol extends SymbolBase {
  readonly kind: 'array';
  readonly element: TypeName;
  readonly typeKey: TypeKey;
  readonly storage: 'global' | 'local' | 'param';
  readonly decl: DimDecl | null;
  /** Upper-bound expressions as written (0-based arrays); empty for an array parameter. */
  readonly bounds: readonly Expr[];
  readonly init: ArrayInit | null;
  readonly param: { readonly index: number; readonly node: Param } | null;
  readonly label: string | null;
}

/** `CONST name [AS type] = value`. The checker folds the value ({@link CheckedProgram.constValues}). */
export interface ConstSymbol extends SymbolBase {
  readonly kind: 'const';
  /** Declared type, or null to take the value's type. */
  readonly declaredType: TypeName | null;
  readonly typeKey: TypeKey | null;
  readonly value: Expr;
}

export interface ParamInfo {
  /** The parameter's VariableSymbol or ArraySymbol in the procedure scope. */
  readonly symbol: SymbolId;
  readonly type: TypeName;
  readonly byref: boolean;
  readonly isArray: boolean;
  readonly default: Expr | null;
}

/** A SUB or FUNCTION. */
export interface ProcedureSymbol extends SymbolBase {
  readonly kind: 'procedure';
  readonly procKind: 'SUB' | 'FUNCTION';
  readonly params: readonly ParamInfo[];
  /** FUNCTION result type (declared, or by the name's suffix, or the default type); null for a SUB. */
  readonly returnType: TypeName | null;
  readonly convention: CallingConvention;
  /** The procedure's own scope. */
  readonly bodyScope: ScopeId;
  readonly decl: ProcedureDecl;
  readonly declares: readonly DeclareStmt[];
  /** For a FUNCTION: the variable that `name = value` assigns inside the body. */
  readonly resultVar: SymbolId | null;
  /** Asm label, `_` + the declared spelling (`_SetInk`), as the reference compiler and the library's asm expect. */
  readonly label: string;
}

/** `DEF FN name(params) = expr`. Parameters and result typed by suffix or the default type (spec §7). */
export interface DefFnSymbol extends SymbolBase {
  readonly kind: 'deffn';
  readonly params: readonly SymbolId[];
  readonly returnType: TypeName;
  readonly bodyScope: ScopeId;
  readonly decl: DefFnStmt;
  readonly label: string;
}

/**
 * A line number or a named label. Line numbers and labels are program-wide unique (a
 * duplicate is an error). A jump must stay inside the main program or inside one
 * procedure body; RESTORE may name any line.
 */
export interface LabelSymbol extends SymbolBase {
  readonly kind: 'label';
  /** The line number, or null for a named label. */
  readonly number: number | null;
  readonly node: LineLabel;
  /** The procedure whose body holds it; null for the main program. */
  readonly owner: SymbolId | null;
  /** Asm label (`.L.100`, `.L.name`: see {@link lineLabel}). */
  readonly label: string;
}

export type SemSymbol = VariableSymbol | ArraySymbol | ConstSymbol | ProcedureSymbol | DefFnSymbol | LabelSymbol;

// ---------------------------------------------------------------------------
// Labels in the generated asm
// ---------------------------------------------------------------------------

/**
 * Asm label of a global variable or array:
 * `_` + the declared spelling for unsuffixed names typed by DIM or the default type
 * (`_score`, as the reference compiler, so library asm keeps working), plus `__i`, `__r`,
 * `__s` for names written with `%`, `!`, `$`, plus `__a` for an array. The binder reports a
 * clash between two symbols that map to the same label (a user name containing `__`).
 */
export function globalLabel(spelling: string, suffix: '%' | '!' | '$' | null, isArray: boolean): string {
  const s = suffix === '%' ? '__i' : suffix === '!' ? '__r' : suffix === '$' ? '__s' : '';
  return `_${spelling}${s}${isArray ? '__a' : ''}`;
}

/** Asm label of a BASIC line number or named label: `.L.100`, `.L.name` (lower-cased). */
export function lineLabel(target: { readonly number: number | null; readonly key: string | null }): string {
  return target.number !== null ? `.L.${target.number}` : `.L.${target.key as string}`;
}

// ---------------------------------------------------------------------------
// Program-wide facts the binder collects
// ---------------------------------------------------------------------------

/** One DATA item, program-wide in file order (spec §3). */
export interface DataItem {
  readonly index: number;
  readonly value: DataValue;
  readonly stmt: DataStmt;
}

export interface DataTable {
  readonly items: readonly DataItem[];
  /**
   * For each RESTORE target: the index of the first DATA item in a statement at or after
   * that line (Locomotive), or `items.length` when there is none. `RESTORE` alone is 0.
   */
  readonly restoreIndex: ReadonlyMap<JumpTarget, number>;
}

/** `#require "file.asm"`: link an asm file from the library path. In a procedure body, `owner` is the procedure. */
export interface RequireEntry {
  readonly path: string;
  readonly span: Span;
  readonly owner: SymbolId | null;
}

export interface InitEntry {
  readonly label: string;
  readonly span: Span;
}

/** Build settings the source sets (`#pragma`, `OPTION`). Options from the host win over pragmas. */
export interface SourceSettings {
  readonly explicit: boolean;
  readonly optionReal: boolean;
  readonly org: number | null;
  readonly heapSize: number | null;
  readonly heapAddress: number | null;
  readonly hidata: number | null;
}

// ---------------------------------------------------------------------------
// Binder contract (src/binder/index.ts)
// ---------------------------------------------------------------------------

export interface BindInput {
  readonly program: Program;
  readonly sources: SourceSet;
  readonly diagnostics: DiagnosticBag;
  /** `CPC_BAREMETAL` defined (bare-metal mode). The binder records it; the checker refuses firmware-only features. */
  readonly bareMetal: boolean;
  /** Report each implicit declaration (W300). Default false; the CLI's `-Wimplicit` sets it. */
  readonly warnImplicit?: boolean;
}

/** Resolutions of name uses to symbols. Every use the binder could resolve is here; an unresolved use has had a diagnostic. */
export interface Resolutions {
  /** Every `Name` node that denotes a variable, constant, array (as in `@a`, an array argument), procedure or DEF FN, including declarators (DIM, FOR, params). */
  readonly names: ReadonlyMap<Name, SymbolId>;
  /** `a(i)`: an array element (ArraySymbol) or a FUNCTION call (ProcedureSymbol). */
  readonly callOrIndex: ReadonlyMap<CallOrIndex, SymbolId>;
  readonly fnCalls: ReadonlyMap<FnCall, SymbolId>;
  readonly subCalls: ReadonlyMap<SubCallStmt, SymbolId>;
  /** GOTO/GOSUB/ON/RESTORE/EVERY/AFTER/ON ERROR targets to LabelSymbols. */
  readonly targets: ReadonlyMap<JumpTarget, SymbolId>;
  /** FOR loops to their loop variable (the FOR's `variable` is also in `names`). */
  readonly forVars: ReadonlyMap<ForStmt, SymbolId>;
}

/**
 * The `#pragma hidata` in force at a DIM declarator: its address and the run it belongs to. A run
 * starts at each setting of `hidata` (a `#pragma hidata = addr` or a `pop`); the initialised global
 * arrays of one run are placed one after another from `address` (the fork's HIDATA cursor).
 */
export interface HidataAt {
  readonly address: number;
  readonly run: number;
}

export interface BoundProgram {
  readonly program: Program;
  readonly symbols: readonly SemSymbol[];
  readonly scopes: readonly Scope[];
  readonly globalScope: ScopeId;
  readonly resolutions: Resolutions;
  /** Procedures and DEF FNs in source order. */
  readonly procedures: readonly SymbolId[];
  /** Global variables and arrays in declaration order (the data area's order). */
  readonly globals: readonly SymbolId[];
  /** Per procedure (and DEF FN): its locals in declaration order (frame order). */
  readonly locals: ReadonlyMap<SymbolId, readonly SymbolId[]>;
  readonly data: DataTable;
  readonly requires: readonly RequireEntry[];
  readonly inits: readonly InitEntry[];
  readonly settings: SourceSettings;
  /** The `#pragma hidata = addr` in force at each DIM declarator (absent when none is; `hidata = 0` ends it). L3-ARR-LOWER. */
  readonly hidataAt: ReadonlyMap<DimDecl, HidataAt>;
  readonly bareMetal: boolean;
}

/** `bind(input)`: never throws for bad input; always returns a BoundProgram (with what it could resolve). */
export type BindFn = (input: BindInput) => BoundProgram;

// ---------------------------------------------------------------------------
// Checker contract (src/checker/index.ts)
// ---------------------------------------------------------------------------

/** Loops and procedures an EXIT or CONTINUE leaves or restarts. */
export type LoopNode = ForStmt | WhileStmt | DoLoopStmt | ProcedureDecl;

export interface CheckInput {
  readonly bound: BoundProgram;
  readonly sources: SourceSet;
  readonly diagnostics: DiagnosticBag;
}

export interface CheckedProgram {
  readonly bound: BoundProgram;
  /** The type of every expression node the checker accepted (after its own rules, before `coercions`). */
  readonly exprTypes: ReadonlyMap<Expr, TypeName>;
  /** Expressions whose value is known at compile time, folded with run-time semantics (wrapping, integer `/`). */
  readonly constants: ReadonlyMap<Expr, ConstValue>;
  /**
   * Implicit conversions: the value of the expression (of type `exprTypes.get(e)`) is
   * converted to this type before its parent uses it (operand promotion, assignment,
   * arguments, AND/OR/XOR/NOT on reals, PRINT and CALL argument rules). Absent = no conversion.
   */
  readonly coercions: ReadonlyMap<Expr, TypeName>;
  /** Folded CONST values. */
  readonly constValues: ReadonlyMap<SymbolId, ConstValue>;
  /** Folded array upper bounds, per dimension (0-based arrays: `n + 1` elements). */
  readonly arrayBounds: ReadonlyMap<SymbolId, readonly number[]>;
  /** Folded `DIM ... AT address`. */
  readonly atAddresses: ReadonlyMap<SymbolId, number>;
  /** Folded scalar DIM initialisers (`DIM a AS UBYTE = 3`) and array initialisers in element order. */
  readonly initialValues: ReadonlyMap<SymbolId, readonly ConstValue[]>;
  /** EXIT and CONTINUE statements to the loop or procedure they act on. */
  readonly loopTargets: ReadonlyMap<ExitStmt | ContinueStmt, LoopNode>;
  /** Statements the checker refused (reported); the lowering never sees a program with errors. */
  readonly ok: boolean;
}

/** `check(input)`: never throws for bad input. */
export type CheckFn = (input: CheckInput) => CheckedProgram;
