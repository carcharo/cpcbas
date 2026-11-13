/**
 * The intermediate representation: typed quads over a value stack, in the shape of the
 * reference compiler's backend so the reused runtime's conventions carry over unchanged.
 * Contract for phase L2; the prose reference with examples is docs/ir.md. Change both
 * together, and the printer (`ir/print.ts`) and verifier (`ir/verify.ts`) with them.
 *
 * Evaluation model (as the reference backend):
 * - A `temp` operand is a value on the Z80 stack. The quad that defines it (its `dst`)
 *   pushes it; the one quad that uses it pops it. Temps are used exactly once, in LIFO
 *   order (the verifier checks this), and never live across a label, a jump or a statement
 *   boundary. They may stay live across a `call` or `rtcall`: the callee's frame is above
 *   them, and STDCALL's `leave` removes only the callee's own parameters (`PRINT a + f(3)`
 *   keeps `a` on the stack under the call).
 * - Results in registers follow the runtime's conventions (compiler-design §3): u8/i8 in
 *   A, u16/i16/str in HL, u32/i32 and f16 in DEHL, f in A E D C B. A template that consumes
 *   a temp pops it into those registers; `fparam` and `rtcall` hand values over in them.
 * - Comparisons always produce INTEGER -1 (true) or 0 (false) (spec §5); their `type` is
 *   the operand type. AND, OR, XOR and NOT are bitwise on integer types.
 * - A `str` temp is owned: a fresh heap string the consumer must store (taking ownership) or
 *   free. A `str` global, frame or `strconst` operand is borrowed.
 *
 * Determinism: labels and temp numbers are allocated in lowering order; nothing iterates
 * an unordered collection.
 */

import type { DiagnosticBag } from '../core/diagnostics.js';
import type { Span } from '../core/source.js';
import type { CheckedProgram } from '../sem/model.js';
import type { IrType } from '../sem/types.js';

export type { IrType } from '../sem/types.js';

// ---------------------------------------------------------------------------
// Operands
// ---------------------------------------------------------------------------

/**
 * - `imm`: a constant. Integers as their two's-complement value in the quad's type; FIXED
 *   and REAL as the JS number (the template encodes it: 16.16, or the 5-byte format).
 * - `temp`: a stack value (see the module comment). `id` is unique per procedure.
 * - `global`: the memory at an asm label (`_score`), read or written in the quad's type.
 * - `frame`: the memory at `(ix + offset)` in the current procedure's frame (parameters at
 *   positive offsets, locals at negative ones; frame layout in docs/ir.md). `byref`: the
 *   slot holds the address of the value (BYREF parameters); the template dereferences it.
 * - `addr`: the address of a label as an immediate (`@x`, a jump table entry, a string
 *   constant's label), optionally plus a constant offset.
 * - `frameaddr`: the address `ix + offset` (`@local`, a BYREF argument of a local).
 * - `strconst`: the address of string constant `id` in {@link IrProgram.strings} (borrowed).
 */
export type Operand =
  | { readonly k: 'imm'; readonly value: number }
  | { readonly k: 'temp'; readonly id: number }
  | { readonly k: 'global'; readonly label: string }
  | { readonly k: 'frame'; readonly offset: number; readonly byref?: boolean }
  | { readonly k: 'addr'; readonly label: string; readonly offset?: number }
  | { readonly k: 'frameaddr'; readonly offset: number }
  | { readonly k: 'strconst'; readonly id: number };

// ---------------------------------------------------------------------------
// Quads
// ---------------------------------------------------------------------------

/** Two-operand arithmetic and bitwise ops: `dst = a op b`, all of `type`. */
export type BinaryOp =
  | 'add'
  | 'sub'
  | 'mul'
  /** Integer types: integer division truncating towards zero; f16/f: exact division. Division by zero: runtime error 11. */
  | 'div'
  /** Integer remainder, sign of the dividend (spec §5). */
  | 'mod'
  /** f only: `a ^ b`. */
  | 'pow'
  | 'and'
  | 'or'
  | 'xor'
  /** `a << b` (b is u8). */
  | 'shl'
  /** `a >> b`: arithmetic on signed types, logical on unsigned (spec §5). */
  | 'shr'
  /** String concatenation (`type` str): an owned result. */
  | 'concat';

/** Comparisons: `dst` (i16) = -1 when `a op b` holds, else 0. `type` is the operands' type (str compares by codes, shorter is less). */
export type CompareOp = 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge';

/** One-operand ops: `dst = op a`, of `type`. `not` is bitwise. */
export type UnaryOp = 'neg' | 'not' | 'abs';

export type Quad =
  // ---- values -----------------------------------------------------------
  /**
   * `dst` (temp) = `a` (imm, global, frame, addr, frameaddr, strconst). For str: `dst` is an
   * owned copy of a borrowed `a` (`__LOADSTR`; the empty string `imm` 0 needs none), so prefer
   * the variable or constant as a direct operand where the consuming quad accepts one.
   */
  | { readonly op: 'load'; readonly type: IrType; readonly dst: Operand; readonly a: Operand; readonly span: Span | null }
  /** `dst` (global or frame) = `a`. For str: an owned temp is stored without copying; any other source is copied. The old string is freed. */
  | { readonly op: 'store'; readonly type: IrType; readonly dst: Operand; readonly a: Operand; readonly span: Span | null }
  | { readonly op: BinaryOp; readonly type: IrType; readonly dst: Operand; readonly a: Operand; readonly b: Operand; readonly span: Span | null }
  | { readonly op: CompareOp; readonly type: IrType; readonly dst: Operand; readonly a: Operand; readonly b: Operand; readonly span: Span | null }
  | { readonly op: UnaryOp; readonly type: IrType; readonly dst: Operand; readonly a: Operand; readonly span: Span | null }
  /** `dst` (of `type`) = `a` (of `from`) converted: integer widening by sign, narrowing by truncation; real/fixed to integer truncates towards zero (spec §4). */
  | { readonly op: 'cast'; readonly type: IrType; readonly from: IrType; readonly dst: Operand; readonly a: Operand; readonly span: Span | null }
  // ---- memory -----------------------------------------------------------
  /** `dst` = the `type` value at address `a` (PEEK). */
  | { readonly op: 'peek'; readonly type: IrType; readonly dst: Operand; readonly a: Operand; readonly span: Span | null }
  /** Store `b` (of `type`) at address `a` (POKE). */
  | { readonly op: 'poke'; readonly type: IrType; readonly a: Operand; readonly b: Operand; readonly span: Span | null }
  /** `dst` (u8) = IN port `a` (u16). */
  | { readonly op: 'in'; readonly type: 'u8'; readonly dst: Operand; readonly a: Operand; readonly span: Span | null }
  /** OUT port `a` (u16), value `b` (u8). */
  | { readonly op: 'out'; readonly type: 'u8'; readonly a: Operand; readonly b: Operand; readonly span: Span | null }
  /**
   * `dst` (u16 temp) = address of an element of array `array`, whose descriptor is: an `addr`
   * (a global array's label), a `frameaddr` (a local array: the descriptor is in the frame), or a
   * `frame` slot holding the descriptor's address (an array parameter). The `dims` index temps
   * (u16, pushed first index first) are popped (`__ARRAY`). Elements of `type`. Constant indexes
   * of a global array need no `aaddr`: the lowering uses `addr` `<label>.__DATA__` plus the offset
   * (`ir/arrays.ts` `elementOffset`). docs/ir.md, "Arrays".
   */
  | { readonly op: 'aaddr'; readonly type: IrType; readonly dst: Operand; readonly array: Operand; readonly dims: number; readonly span: Span | null }
  /** `dst` = the `type` value at the element address `a` (a u16 temp from `aaddr`). */
  | { readonly op: 'aload'; readonly type: IrType; readonly dst: Operand; readonly a: Operand; readonly span: Span | null }
  /** Store `b` at the element address `a` (str: as `store`). */
  | { readonly op: 'astore'; readonly type: IrType; readonly a: Operand; readonly b: Operand; readonly span: Span | null }
  // ---- control ------------------------------------------------------------
  | { readonly op: 'label'; readonly label: string; readonly span: Span | null }
  | { readonly op: 'jump'; readonly label: string; readonly span: Span | null }
  /** Jump when `a` (of `type`) is zero (`jz`) or non-zero (`jnz`). Any numeric type (spec §5: any non-zero value is true). */
  | { readonly op: 'jz' | 'jnz'; readonly type: IrType; readonly a: Operand; readonly label: string; readonly span: Span | null }
  /** ON `a` GOTO/GOSUB: `a` (u16, 1-based, spec §6) selects `labels[a - 1]`; out of range falls through. `gosub` calls instead of jumping. */
  | { readonly op: 'jtable'; readonly a: Operand; readonly labels: readonly string[]; readonly gosub: boolean; readonly span: Span | null }
  /** GOSUB `label` (a `call`). */
  | { readonly op: 'gosub'; readonly label: string; readonly span: Span | null }
  /** RETURN from a GOSUB (a `ret`). */
  | { readonly op: 'retsub'; readonly span: Span | null }
  /** END: the program's single exit (firmware: `jp .core.__CPC_END`). `a` is the exit code (u16), 0 for END. */
  | { readonly op: 'end'; readonly a: Operand; readonly span: Span | null }
  // ---- procedures ---------------------------------------------------------
  /** Push argument `a` of `type` for a STDCALL call (u8/i8 take 2 bytes, as the reference: `push af`). */
  | { readonly op: 'param'; readonly type: IrType; readonly a: Operand; readonly span: Span | null }
  /**
   * Put `a` in the result registers for a FASTCALL procedure or a runtime routine. Must be the
   * last quad before the `call`/`rtcall`. For `str` it also sets A to the free flag: 1 when `a`
   * is a temp (owned: the routine frees it), 0 for a variable or a `strconst` (borrowed).
   */
  | { readonly op: 'fparam'; readonly type: IrType; readonly a: Operand; readonly span: Span | null }
  /**
   * Call a user procedure. `argBytes`: the bytes its `param`s pushed (the callee removes
   * them: STDCALL). `ret`: the result type and `dst` (a temp pushed with the result), or
   * null for a SUB.
   */
  | { readonly op: 'call'; readonly label: string; readonly argBytes: number; readonly ret: IrType | null; readonly dst: Operand | null; readonly span: Span | null }
  /**
   * Call a runtime routine (`.core.__PRINTSTR`). Inputs are in registers from a preceding
   * `fparam` (or an internal `asm` quad, see docs/ir.md "Internal asm"), or on the stack per the routine's own
   * convention. The routine's file is linked (REQUIRES). `ret`/`dst` as for `call`.
   */
  | { readonly op: 'rtcall'; readonly label: string; readonly ret: IrType | null; readonly dst: Operand | null; readonly span: Span | null }
  /**
   * Procedure entry: frame of `localBytes` bytes below IX (0: no frame, for a FASTCALL procedure
   * without locals). In a FASTCALL procedure with a frame, a negative `params[0].offset` is the
   * local slot `enter` stores the register argument into (docs/ir.md, "Calling conventions").
   */
  | { readonly op: 'enter'; readonly localBytes: number; readonly span: Span | null }
  /** FUNCTION result: `a` of `type` into the result registers, then jump to the procedure's `leave`. */
  | { readonly op: 'ret'; readonly type: IrType; readonly a: Operand; readonly label: string; readonly span: Span | null }
  /**
   * Procedure exit: restore the frame, drop `argBytes` (even: u8 arguments are pushed as words) of
   * STDCALL arguments, `ret`. It does not free string locals or parameters: the template has no
   * types for the slots, so the lowering frees them before the leave label.
   */
  | { readonly op: 'leave'; readonly argBytes: number; readonly convention: 'STDCALL' | 'FASTCALL'; readonly span: Span | null }
  // ---- other --------------------------------------------------------------
  /**
   * Inline assembly, emitted verbatim. From an ASM block (spec §10): each line is preceded by
   * `#line` for its span, so an assembler error in it is the user's, and a bare `#line` after
   * the block ends the attribution. `internal: true` marks the lowering's own few lines for what
   * the IR has no quad for (docs/ir.md, "Internal asm"): no `#line`, so an assembler error in
   * them is a compiler bug (E001), like one in a template.
   */
  | {
      readonly op: 'asm';
      readonly lines: readonly { readonly text: string; readonly span: Span }[];
      readonly span: Span | null;
      readonly internal?: true;
    }
  /**
   * Start of a BASIC source statement (for ERL, ON BREAK and event polling). Emits nothing unless
   * `IrProgram.checkBreak` is set (docs/ir.md, "Statement boundaries"); the event poll is an `rtcall` quad
   * that the statement-boundary hooks emit.
   * `number`: the line number in force, or null.
   */
  | { readonly op: 'stmt'; readonly number: number | null; readonly span: Span }
  /** A comment in the asm dump (`; text`); no code. */
  | { readonly op: 'comment'; readonly text: string; readonly span: Span | null };

export type QuadOp = Quad['op'];

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

/**
 * A global variable or array in the data area, in declaration order. The lowering's own tables
 * (a local array's dimension and UBOUND tables) are globals too: scalars of `size` bytes with `init`.
 */
export interface IrGlobal {
  readonly label: string;
  /** Element type (scalars: the type). */
  readonly type: IrType;
  /**
   * Bytes reserved in the data area: the scalar's size; for an array the descriptor (8) plus the
   * elements, or the descriptor alone with `at` or `hidata` (docs/ir.md, "Arrays"; the dimension and
   * UBOUND tables come on top: `ir/arrays.ts`).
   */
  readonly size: number;
  /** Initial bytes (little-endian, the runtime's formats; for an array, the elements in order), or null for zeros. */
  readonly init: Uint8Array | null;
  /** `DIM ... AT address`: no storage; a scalar's label, or an array's element label (`<label>.__DATA__`), is an EQU. */
  readonly at: number | null;
  /** For arrays: element count per dimension (upper bound + 1). Empty for scalars. */
  readonly dims: readonly number[];
  /**
   * For an initialised global array under `#pragma hidata` (L3): the address its elements are
   * assembled at, in their own block outside the data area (the fork's HIDATA cursor). Optional.
   */
  readonly hidata?: number;
}

/** A string constant: emitted as the runtime's string format (DEFW length, then the bytes). */
export interface IrString {
  readonly id: number;
  readonly label: string;
  /** Latin-1 code units 0..255. */
  readonly bytes: Uint8Array;
}

/** One DATA item, encoded as read_restore.asm expects (docs/ir.md, "DATA"). */
export interface IrDataItem {
  /** The label of a line that RESTORE can name, placed before this item; null otherwise. */
  readonly label: string | null;
  readonly type: IrType;
  /** Number value, or string bytes for `str`. */
  readonly value: number | Uint8Array;
  /**
   * The item's text as written, for a numeric item whose text is not the canonical decimal of its
   * value (`007`, `&FF`, `1.50`, an empty item): a READ into a string variable gives this text.
   * Absent for `str` items and for items whose canonical text is what was written.
   */
  readonly spelling?: Uint8Array;
}

/** A SUB, FUNCTION or DEF FN body. */
export interface IrProcedure {
  readonly label: string;
  readonly convention: 'STDCALL' | 'FASTCALL';
  readonly params: readonly { readonly type: IrType; readonly offset: number; readonly byref: boolean }[];
  readonly ret: IrType | null;
  /** Starts with `label`/`enter`, ends with the leave label and `leave`. */
  readonly body: readonly Quad[];
}

export interface IrProgram {
  /** The main program; ends with `end`. */
  readonly main: readonly Quad[];
  readonly procedures: readonly IrProcedure[];
  readonly globals: readonly IrGlobal[];
  readonly strings: readonly IrString[];
  readonly data: readonly IrDataItem[];
  /** `#require` files (paths as written, resolved in the runtime tree) and `#init` labels from the source, in source order. */
  readonly requires: readonly string[];
  readonly inits: readonly string[];
  /**
   * Where each `#require` path was first written (BoundProgram.requires), so the link step
   * reports a missing file as E421 at the `#require`. Optional: hand-built IR leaves it out,
   * and a missing file without a span is E420.
   */
  readonly requireSpans?: ReadonlyMap<string, Span>;
  /** `ON BREAK STOP` is in force: each `stmt` checks ESC (`.core.CHECK_BREAK`). Optional, default false. */
  readonly checkBreak?: boolean;
}

// ---------------------------------------------------------------------------
// Lowering contract (src/ir/index.ts)
// ---------------------------------------------------------------------------

export interface LowerInput {
  readonly checked: CheckedProgram;
  readonly diagnostics: DiagnosticBag;
  /** From -O1: argument spill slots only where the evaluation order needs them (L5-GAP); default false (-O0's code). */
  readonly minimalSpills?: boolean;
}

/** `lower(input)`: a checked program without errors to IR. A construct it cannot lower yet is E002 at its span. Never throws for bad input. */
export type LowerFn = (input: LowerInput) => IrProgram;

/** `printIr(program)`: the `--stage ir` dump (deterministic text, format in docs/ir.md). */
export type PrintIrFn = (program: IrProgram) => string;

/** `verifyIr(program)`: structural checks (temps defined once, used once, LIFO; labels defined once and every jump target defined). Returns problems as text; empty when sound. */
export type VerifyIrFn = (program: IrProgram) => readonly string[];
