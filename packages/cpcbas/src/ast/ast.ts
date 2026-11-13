/**
 * The abstract syntax tree of CPC BASIC: the parser's output, the binder's input.
 *
 * Rules:
 * - Every node is a plain object with a string `kind` (discriminant) and a `span`
 *   (core/source.ts) covering the source text it came from. Nodes from an included
 *   file have spans in that file. No classes, no parent pointers, no methods.
 * - The tree is syntax only. Names are not resolved (`a(1)` is a `CallOrIndex` until
 *   the binder knows whether `a` is an array or a FUNCTION); types are not checked;
 *   default types are not applied.
 * - Optional parts are `null`, never `undefined`, so a dump shows them.
 * - Comments and blank lines are not in the tree.
 * - A parse error produces a `BadStmt` / `BadExpr` so the tree stays usable for the LSP.
 *
 * `ast/walk.ts` (task L1-PRINT) gives an exhaustive child visitor; when you add a node
 * kind here, the walker and the printer must handle it (their `never` checks fail to
 * compile otherwise).
 */

import type { DiagnosticBag } from '../core/diagnostics.js';
import type { SourceSet, Span, FileId } from '../core/source.js';
import type { IncludeRecord, PreprocessResult, TypeSuffix } from '../core/tokens.js';

export interface NodeBase {
  readonly kind: string;
  readonly span: Span;
  /**
   * Present (true) only on the first label or statement of a physical line that has no line number, in a program
   * where some earlier line has one (so ERL is 0 there, not the last number; follow-up 80). The parser sets it
   * in `parseBlock`; programs with no line numbers never have it.
   */
  readonly unnumberedLine?: true;
}

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

/**
 * The whole program after preprocessing: one statement list in source order, with
 * included files' statements where their `#include` was. SUB/FUNCTION/DECLARE/DEF FN
 * appear in `body` at top level, where they were written; the main program is every
 * other top-level statement, in order.
 */
export interface Program extends NodeBase {
  readonly kind: 'Program';
  readonly body: Stmt[];
  readonly includes: readonly IncludeRecord[];
  readonly mainFile: FileId | null;
}

// ---------------------------------------------------------------------------
// Names, types, targets
// ---------------------------------------------------------------------------

/**
 * A name as written. Identity: `base` (lower case) plus `suffix`. Whether `a` and `a%`
 * are the same variable depends on DEFINT/DEFREAL/OPTION REAL and is the binder's job.
 */
export interface Name extends NodeBase {
  readonly kind: 'Name';
  /** As written, without the suffix (`Score`). */
  readonly text: string;
  /** Lower-cased `text` (`score`). */
  readonly base: string;
  readonly suffix: TypeSuffix | null;
}

/** Type names. FLOAT is normalised to REAL (`text` keeps the spelling). */
export type TypeName = 'UBYTE' | 'BYTE' | 'UINTEGER' | 'INTEGER' | 'ULONG' | 'LONG' | 'FIXED' | 'REAL' | 'STRING';

export interface TypeRef extends NodeBase {
  readonly kind: 'TypeRef';
  readonly name: TypeName;
  readonly text: string;
}

/** A GOTO/GOSUB/RESTORE/ON ... target: a line number or a label name. */
export type JumpTarget = LineTarget | LabelTarget;

export interface LineTarget extends NodeBase {
  readonly kind: 'LineTarget';
  readonly number: number;
}

export interface LabelTarget extends NodeBase {
  readonly kind: 'LabelTarget';
  readonly name: string;
  /** Lower-cased name. */
  readonly key: string;
}

/** Something that can be assigned to: a variable or an element (`a(i, j)`, resolved by the binder). */
export type LValue = Name | CallOrIndex;

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

export type Expr =
  | NumberLit
  | StringLit
  | Name
  | UnaryExpr
  | BinaryExpr
  | AddressOf
  | CallOrIndex
  | BuiltinCall
  | FnCall
  | BadExpr;

export interface NumberLit extends NodeBase {
  readonly kind: 'NumberLit';
  readonly value: number;
  readonly text: string;
  readonly radix: 2 | 10 | 16;
  readonly isReal: boolean;
  readonly suffix: '%' | '!' | null;
}

export interface StringLit extends NodeBase {
  readonly kind: 'StringLit';
  readonly value: string;
}

export type UnaryOp = '-' | '+' | 'NOT';

export interface UnaryExpr extends NodeBase {
  readonly kind: 'Unary';
  readonly op: UnaryOp;
  readonly operand: Expr;
}

/** Binary operators. `=>` and `=<` (Locomotive spellings) are stored as `>=` and `<=`. */
export type BinaryOp =
  | '^'
  | '*'
  | '/'
  | '\\'
  | 'MOD'
  | '+'
  | '-'
  | '<<'
  | '>>'
  | '='
  | '<>'
  | '<'
  | '>'
  | '<='
  | '>='
  | 'AND'
  | 'OR'
  | 'XOR';

export type ComparisonOp = '=' | '<>' | '<' | '>' | '<=' | '>=';

export interface BinaryExpr extends NodeBase {
  readonly kind: 'Binary';
  readonly op: BinaryOp;
  readonly left: Expr;
  readonly right: Expr;
}

/** `@name`: the address of a variable, array, label or procedure; `@name(i, j)` the address of an array element (`index`, absent otherwise). */
export interface AddressOf extends NodeBase {
  readonly kind: 'AddressOf';
  readonly target: Name;
  readonly index?: Expr[];
}

/** `name(args)`: an array element or a user FUNCTION call; the binder decides. */
export interface CallOrIndex extends NodeBase {
  readonly kind: 'CallOrIndex';
  readonly callee: Name;
  readonly args: Expr[];
}

/**
 * A built-in function from lang/keywords.ts (`LEFT$(a$, 2)`, `INKEY$`, `PEEK(UINTEGER, a)`,
 * `POS(#0)`, `CAST(UBYTE, x)`). `keyword` is the canonical name.
 */
export interface BuiltinCall extends NodeBase {
  readonly kind: 'BuiltinCall';
  readonly keyword: string;
  readonly args: Expr[];
  /** `#s` argument (POS, VPOS, COPYCHR$), or null. */
  readonly stream: Expr | null;
  /** Leading type argument (PEEK, CAST, SIZEOF), or null. */
  readonly typeArg: TypeRef | null;
  /** False for a call written without parentheses (`INKEY$`, `RND`). */
  readonly parens: boolean;
}

/** `FN name(args)`: a call of a DEF FN function. */
export interface FnCall extends NodeBase {
  readonly kind: 'FnCall';
  readonly name: Name;
  readonly args: Expr[];
}

export interface BadExpr extends NodeBase {
  readonly kind: 'BadExpr';
}

/** `{1, 2, {3, 4}}` after `=>` in a DIM. Not an expression elsewhere. */
export interface ArrayInit extends NodeBase {
  readonly kind: 'ArrayInit';
  readonly elements: Array<Expr | ArrayInit>;
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

export type Stmt =
  // program structure
  | LineLabel
  | LetStmt
  | MidAssignStmt
  | DimStmt
  | ConstStmt
  | DefTypeStmt
  | OptionStmt
  // control flow
  | IfStmt
  | ForStmt
  | WhileStmt
  | DoLoopStmt
  | SelectCaseStmt
  | ExitStmt
  | ContinueStmt
  | GotoStmt
  | GosubStmt
  | ReturnStmt
  | OnGotoStmt
  | OnBreakStmt
  | OnErrorStmt
  | ResumeStmt
  | ErrorStmt
  | EndStmt
  | StopStmt
  | EveryAfterStmt
  | CallStmt
  | RsxStmt
  | SubCallStmt
  // input/output and data
  | PrintStmt
  | InputStmt
  | WriteStmt
  | DataStmt
  | ReadStmt
  | RestoreStmt
  // procedures
  | ProcedureDecl
  | DeclareStmt
  | DefFnStmt
  // built-in statements (generic shape from lang/keywords.ts)
  | BuiltinStmt
  // modern layer
  | AsmStmt
  | PragmaStmt
  | RequireStmt
  | InitStmt
  // recovery
  | BadStmt;

/**
 * A line number or `label:` at the start of a line. It precedes the statements of its
 * line in the enclosing statement list (so labels inside a FOR body stay in that body).
 * ERL is the number of the last numbered LineLabel before a statement.
 */
export interface LineLabel extends NodeBase {
  readonly kind: 'LineLabel';
  /** For a line number. */
  readonly number: number | null;
  /** For a named label: as written, and lower-cased. */
  readonly name: string | null;
  readonly key: string | null;
}

/** `[LET] target = value`. */
export interface LetStmt extends NodeBase {
  readonly kind: 'Let';
  readonly target: LValue;
  readonly value: Expr;
  readonly explicitLet: boolean;
}

/** `MID$(target, start [, length]) = value`. */
export interface MidAssignStmt extends NodeBase {
  readonly kind: 'MidAssign';
  readonly target: LValue;
  readonly start: Expr;
  readonly length: Expr | null;
  readonly value: Expr;
}

/** `DIM d1 [, d2 ...]`. In `DIM a, b AS UBYTE` the same TypeRef node is set on both declarators. */
export interface DimStmt extends NodeBase {
  readonly kind: 'Dim';
  readonly decls: DimDecl[];
}

export interface DimDecl extends NodeBase {
  readonly kind: 'DimDecl';
  readonly name: Name;
  /** Upper bounds (arrays are 0-based); empty for a scalar. Up to 4 dimensions (checked later). */
  readonly bounds: Expr[];
  readonly type: TypeRef | null;
  /** `= expr` (scalar) or `=> {...}` (array). */
  readonly init: Expr | ArrayInit | null;
  readonly at: Expr | null;
}

/** `CONST name [AS type] = value`. */
export interface ConstStmt extends NodeBase {
  readonly kind: 'Const';
  readonly name: Name;
  readonly type: TypeRef | null;
  readonly value: Expr;
}

/** `DEFINT a-c, x` / `DEFREAL` / `DEFSTR`. Letters are lower case. */
export interface DefTypeStmt extends NodeBase {
  readonly kind: 'DefType';
  readonly type: 'INTEGER' | 'REAL' | 'STRING';
  readonly ranges: ReadonlyArray<{ readonly from: string; readonly to: string; readonly span: Span }>;
}

/** `OPTION name` (1.0: `OPTION REAL`). `name` upper case. */
export interface OptionStmt extends NodeBase {
  readonly kind: 'Option';
  readonly name: string;
}

/**
 * Both IF forms. `branches[0]` is the IF; later branches are ELSEIFs (block form only).
 * In the single-line form, `THEN 100` / `ELSE 200` become a GotoStmt with `implicit: true`.
 */
export interface IfStmt extends NodeBase {
  readonly kind: 'If';
  readonly form: 'line' | 'block';
  readonly branches: ReadonlyArray<{ readonly cond: Expr; readonly body: Stmt[]; readonly span: Span }>;
  readonly elseBody: Stmt[] | null;
}

/**
 * `FOR v = from TO to [STEP step] ... NEXT [v]`. Loops are structured: the NEXT that
 * closes a FOR is in the same statement list. `NEXT j, i` closes two loops: the inner
 * FOR gets `nextName` j, the outer i, both with the same `nextSpan`.
 */
export interface ForStmt extends NodeBase {
  readonly kind: 'For';
  readonly variable: Name;
  readonly from: Expr;
  readonly to: Expr;
  readonly step: Expr | null;
  readonly body: Stmt[];
  readonly nextName: Name | null;
  readonly nextSpan: Span;
}

export interface WhileStmt extends NodeBase {
  readonly kind: 'While';
  readonly cond: Expr;
  readonly body: Stmt[];
}

export interface LoopCond {
  readonly until: boolean;
  readonly expr: Expr;
  readonly span: Span;
}

/** `DO [WHILE|UNTIL c] ... LOOP [WHILE|UNTIL c]` (at most one of the two in practice; both are kept). */
export interface DoLoopStmt extends NodeBase {
  readonly kind: 'DoLoop';
  readonly pre: LoopCond | null;
  readonly post: LoopCond | null;
  readonly body: Stmt[];
}

export type CaseTest =
  | { readonly kind: 'CaseValue'; readonly span: Span; readonly value: Expr }
  | { readonly kind: 'CaseRange'; readonly span: Span; readonly from: Expr; readonly to: Expr }
  | { readonly kind: 'CaseIs'; readonly span: Span; readonly op: ComparisonOp; readonly value: Expr };

export interface CaseClause extends NodeBase {
  readonly kind: 'CaseClause';
  readonly tests: CaseTest[];
  readonly body: Stmt[];
}

export interface SelectCaseStmt extends NodeBase {
  readonly kind: 'SelectCase';
  readonly subject: Expr;
  readonly cases: CaseClause[];
  readonly elseBody: Stmt[] | null;
}

export interface ExitStmt extends NodeBase {
  readonly kind: 'Exit';
  readonly target: 'FOR' | 'WHILE' | 'DO' | 'SUB' | 'FUNCTION';
}

export interface ContinueStmt extends NodeBase {
  readonly kind: 'Continue';
  readonly target: 'FOR' | 'WHILE' | 'DO';
}

/** `GOTO t` (also `GO TO`). `implicit` for `THEN 100` / `ELSE 100`. */
export interface GotoStmt extends NodeBase {
  readonly kind: 'Goto';
  readonly target: JumpTarget;
  readonly implicit: boolean;
}

export interface GosubStmt extends NodeBase {
  readonly kind: 'Gosub';
  readonly target: JumpTarget;
}

/** `RETURN` (from GOSUB) or `RETURN expr` (from a FUNCTION). */
export interface ReturnStmt extends NodeBase {
  readonly kind: 'Return';
  readonly value: Expr | null;
}

/** `ON expr GOTO|GOSUB t1, t2, ...` (1-based). */
export interface OnGotoStmt extends NodeBase {
  readonly kind: 'OnGoto';
  readonly selector: Expr;
  readonly targets: JumpTarget[];
  readonly gosub: boolean;
}

export interface OnBreakStmt extends NodeBase {
  readonly kind: 'OnBreak';
  readonly action: 'STOP' | 'CONT';
}

/** `ON ERROR GOTO target`; `ON ERROR GOTO 0` has `target: null`. */
export interface OnErrorStmt extends NodeBase {
  readonly kind: 'OnError';
  readonly target: JumpTarget | null;
}

/** `RESUME` (`mode: 'same'`), `RESUME NEXT` (`'next'`) or `RESUME target` (`'target'`, with its jump target). */
export interface ResumeStmt extends NodeBase {
  readonly kind: 'Resume';
  readonly mode: 'same' | 'next' | 'target';
  readonly target: JumpTarget | null;
}

/** `ERROR n`. */
export interface ErrorStmt extends NodeBase {
  readonly kind: 'Error';
  readonly code: Expr;
}

export interface EndStmt extends NodeBase {
  readonly kind: 'End';
}

export interface StopStmt extends NodeBase {
  readonly kind: 'Stop';
}

/** `EVERY n [, timer] GOSUB t` / `AFTER n [, timer] GOSUB t`. */
export interface EveryAfterStmt extends NodeBase {
  readonly kind: 'EveryAfter';
  readonly every: boolean;
  readonly interval: Expr;
  readonly timer: Expr | null;
  readonly target: JumpTarget;
}

/** `CALL address [, args]`. */
export interface CallStmt extends NodeBase {
  readonly kind: 'Call';
  readonly address: Expr;
  readonly args: Expr[];
}

/** `|NAME [, args]`. `name` upper case without the bar. */
export interface RsxStmt extends NodeBase {
  readonly kind: 'Rsx';
  readonly name: string;
  readonly args: Expr[];
}

/** A user SUB called as a statement: `Foo 1, 2` or `Foo(1, 2)` or `Foo`. */
export interface SubCallStmt extends NodeBase {
  readonly kind: 'SubCall';
  readonly name: Name;
  readonly args: Expr[];
  readonly parens: boolean;
}

export type PrintItem =
  | { readonly kind: 'PrintExpr'; readonly span: Span; readonly expr: Expr }
  | { readonly kind: 'PrintSep'; readonly span: Span; readonly sep: ';' | ',' }
  | { readonly kind: 'PrintTab'; readonly span: Span; readonly column: Expr }
  | { readonly kind: 'PrintSpc'; readonly span: Span; readonly count: Expr }
  | { readonly kind: 'PrintUsing'; readonly span: Span; readonly format: Expr }
  | { readonly kind: 'PrintAt'; readonly span: Span; readonly row: Expr; readonly col: Expr };

/**
 * `PRINT [#s,] items` (and `?`). Items keep separators in order; a trailing `;` or `,` is an item.
 * Two items with no separator between them (`PRINT a "x" b`) are adjacent items, printed as if `;` stood there.
 */
export interface PrintStmt extends NodeBase {
  readonly kind: 'Print';
  readonly stream: Expr | null;
  readonly items: PrintItem[];
}

/** `WRITE [#s,] items` (L4-FILES): the items separated by commas, strings in quotes; `#9` is the output file. */
export interface WriteStmt extends NodeBase {
  readonly kind: 'Write';
  readonly stream: Expr | null;
  readonly items: Expr[];
}

/** `INPUT [#s,] ["prompt" ;|,] targets` and `LINE INPUT ...`. */
export interface InputStmt extends NodeBase {
  readonly kind: 'Input';
  readonly line: boolean;
  readonly stream: Expr | null;
  readonly prompt: StringLit | null;
  /** `;` shows "? " after the prompt, `,` does not (Locomotive); null without a prompt. */
  readonly promptSep: ';' | ',' | null;
  readonly targets: LValue[];
  /** `INPUT ;` / `LINE INPUT ;`: a semicolon right after the keyword keeps the cursor on the line after ENTER. */
  readonly keepCursor: boolean;
}

export interface DataValue extends NodeBase {
  readonly kind: 'DataValue';
  /** Trimmed raw text, or the string value when quoted. */
  readonly raw: string;
  readonly quoted: boolean;
}

export interface DataStmt extends NodeBase {
  readonly kind: 'Data';
  readonly values: DataValue[];
}

export interface ReadStmt extends NodeBase {
  readonly kind: 'Read';
  readonly targets: LValue[];
}

export interface RestoreStmt extends NodeBase {
  readonly kind: 'Restore';
  readonly target: JumpTarget | null;
}

export interface Param extends NodeBase {
  readonly kind: 'Param';
  readonly name: Name;
  readonly type: TypeRef | null;
  /** As written; null means the default (BYVAL). */
  readonly passing: 'BYVAL' | 'BYREF' | null;
  /** `a() AS UBYTE`: an array parameter. */
  readonly isArray: boolean;
  readonly default: Expr | null;
}

export type CallingConvention = 'FASTCALL' | 'STDCALL';

/** `SUB` / `FUNCTION` ... `END SUB` / `END FUNCTION`. Top level only (nesting is a parse error). */
export interface ProcedureDecl extends NodeBase {
  readonly kind: 'Procedure';
  readonly procKind: 'SUB' | 'FUNCTION';
  readonly name: Name;
  readonly params: Param[];
  readonly returnType: TypeRef | null;
  readonly convention: CallingConvention | null;
  readonly body: Stmt[];
  /** The span of the END SUB / END FUNCTION line. */
  readonly endSpan: Span;
}

/** `DECLARE SUB|FUNCTION ...` (accepted, not needed). */
export interface DeclareStmt extends NodeBase {
  readonly kind: 'Declare';
  readonly procKind: 'SUB' | 'FUNCTION';
  readonly name: Name;
  readonly params: Param[];
  readonly returnType: TypeRef | null;
  readonly convention: CallingConvention | null;
}

/** `DEF FN name(params) = expr`. */
export interface DefFnStmt extends NodeBase {
  readonly kind: 'DefFn';
  readonly name: Name;
  readonly params: Name[];
  readonly body: Expr;
}

/**
 * A statement whose syntax is a keyword plus arguments, described in lang/keywords.ts
 * (`form: 'builtin'`): MODE, INK, PEN, LOCATE, PLOT, SOUND, POKE, OUT, WAIT, BEEP, ...
 * `keyword` is the canonical (possibly multi-word) name: `GRAPHICS PEN`, `SPEED KEY`.
 * An omitted argument (`SOUND 1, 200, , 15`) is `null`.
 */
export interface BuiltinStmt extends NodeBase {
  readonly kind: 'Builtin';
  readonly keyword: string;
  readonly stream: Expr | null;
  readonly typeArg: TypeRef | null;
  readonly args: Array<Expr | null>;
  /**
   * ENV and ENT only, when present: indexes into `args` where a hardware section `=value, value`
   * starts (the `=` is not an argument). Absent when the statement has none.
   */
  readonly hardwareAt?: number[];
}

/** One raw line of an ASM block (macros expanded). Its span gives the file and line for `#line`. */
export interface AsmLine extends NodeBase {
  readonly kind: 'AsmLine';
  readonly text: string;
}

/**
 * `ASM` ... `END ASM`. `#require`/`#init`/`#pragma` lines inside the block become their
 * own statements next to it (before it, in source order); conditional directives have
 * already been applied.
 */
export interface AsmStmt extends NodeBase {
  readonly kind: 'Asm';
  readonly lines: AsmLine[];
}

/** `#pragma name = value`, `#pragma name` (flag), `#pragma push(name)`, `#pragma pop(name)`. `name` lower case; `value` raw text. */
export interface PragmaStmt extends NodeBase {
  readonly kind: 'Pragma';
  readonly op: 'set' | 'flag' | 'push' | 'pop';
  readonly name: string;
  readonly value: string | null;
}

/** `#require "file.asm"`: link an asm file from the library path. */
export interface RequireStmt extends NodeBase {
  readonly kind: 'Require';
  readonly path: string;
}

/** `#init label`: call `label` at start-up. */
export interface InitStmt extends NodeBase {
  readonly kind: 'Init';
  readonly label: string;
}

/** A statement the parser could not read (a diagnostic has been reported). */
export interface BadStmt extends NodeBase {
  readonly kind: 'BadStmt';
}

/** Every node kind (for walkers and printers). */
export type Node =
  | Program
  | Stmt
  | Expr
  | Name
  | TypeRef
  | JumpTarget
  | ArrayInit
  | DimDecl
  | CaseClause
  | Param
  | DataValue
  | AsmLine;

// ---------------------------------------------------------------------------
// Parser contract (src/parser/index.ts)
// ---------------------------------------------------------------------------

export interface ParseInput {
  readonly pp: PreprocessResult;
  readonly sources: SourceSet;
  readonly diagnostics: DiagnosticBag;
}

/** `parse(input)`: always returns a Program (with BadStmt/BadExpr where it could not read). Never throws for bad input. */
export type ParseFn = (input: ParseInput) => Program;
