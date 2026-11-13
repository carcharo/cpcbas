/**
 * The lowering context: what every lowering function shares (the checker's tables, the
 * builder of the body being lowered, the string pool, hidden variables, labels).
 *
 * Extension points for the tasks that follow:
 * - L2-PROC replaces `pending.ts` (procedures, DEF FN, calls) and sets `slots` / `procExit`
 *   while it lowers a body;
 * - L2-DATA replaces the DATA functions of `pending.ts`;
 * - L2-CG-STR adds `strings.ts` and registers its built-ins in `builtins.ts`.
 */
import { IrBuilder } from '../builder.js';
import type { IrGlobal, IrProgram, IrString, IrType, Operand, Quad } from '../ir.js';
import type { Expr, JumpTarget, LineLabel } from '../../ast/ast.js';
import type { DiagnosticBag } from '../../core/diagnostics.js';
import { InternalError } from '../../core/diagnostics.js';
import type { Span } from '../../core/source.js';
import type { CheckedProgram, LabelSymbol, LoopNode, SemSymbol, SymbolId, VariableSymbol } from '../../sem/model.js';
import { irSize, irType, type TypeName } from '../../sem/types.js';

/** A lowered value: where it is and its IR type (conversions already applied). */
export interface Val {
  readonly o: Operand;
  readonly t: IrType;
}

/** The labels EXIT and CONTINUE of a loop jump to. */
export interface LoopLabels {
  readonly cont: string;
  readonly exit: string;
}

export class LowerCtx {
  /** The builder of the body being lowered (a fresh one per body: temp ids restart). */
  b = new IrBuilder();
  /** The number of the last numbered line label before the statement being lowered. */
  lineNumber: number | null = null;
  /** EXIT / CONTINUE targets of the loops being lowered. */
  readonly loops = new Map<LoopNode, LoopLabels>();
  /** L2-PROC: frame operands of the current procedure's locals and parameters. */
  readonly slots = new Map<SymbolId, Operand>();
  /** L2-PROC: the label EXIT SUB / EXIT FUNCTION jumps to while a procedure is lowered. */
  procExit: string | null = null;
  /** L2-PROC: allocates a frame slot in the procedure being lowered; null in the main program. */
  frameAlloc: ((type: IrType) => Operand) | null = null;

  /** L5-GAP: from -O1 a call's arguments are parked only where the evaluation order needs it (proc.ts). */
  minimalSpills = false;

  private labels = 0;
  private hiddenCount = 0;
  private readonly hiddenGlobals: IrGlobal[] = [];
  private readonly stringList: IrString[] = [];
  private readonly stringIds = new Map<string, number>();
  private readonly extraRequires: string[] = [];
  private readonly lineLabelOf = new Map<LineLabel, LabelSymbol>();

  constructor(
    readonly checked: CheckedProgram,
    readonly diagnostics: DiagnosticBag,
  ) {
    for (const s of checked.bound.symbols) if (s.kind === 'label') this.lineLabelOf.set(s.node, s);
  }

  // ---- reporting -------------------------------------------------------------------

  /** E002 "X is not implemented yet" at `span`. */
  notYet(span: Span, what: string): void {
    this.diagnostics.report('E002', span, `${what} is not implemented yet`, 'It is planned for a later release; leave it out for now.');
  }

  // ---- the checker's tables ----------------------------------------------------------

  sym(id: SymbolId): SemSymbol {
    return this.checked.bound.symbols[id] as SemSymbol;
  }

  /** The type the checker gave `e` (before its coercion). */
  typeOf(e: Expr): TypeName {
    const t = this.checked.exprTypes.get(e);
    if (t === undefined) throw new InternalError(`lowering: expression at ${e.span.start} has no type`);
    return t;
  }

  /** The IR type of `e` after the checker's recorded conversion. */
  coercedType(e: Expr): IrType {
    return irType(this.checked.coercions.get(e) ?? this.typeOf(e));
  }

  /** The asm label of a jump target. */
  targetLabel(t: JumpTarget): string {
    const id = this.checked.bound.resolutions.targets.get(t);
    const s = id === undefined ? undefined : this.sym(id);
    if (s === undefined || s.kind !== 'label') throw new InternalError('lowering: unresolved jump target');
    return s.label;
  }

  /** The label symbol a LineLabel node declares, or undefined. */
  labelOfLine(l: LineLabel): LabelSymbol | undefined {
    return this.lineLabelOf.get(l);
  }

  /** The storage of a variable, or null (after E002) when it is not a main-program global. */
  varOperand(s: VariableSymbol, span: Span): Operand | null {
    const slot = this.slots.get(s.id);
    if (slot !== undefined) return slot;
    if (s.storage === 'global' && s.label !== null) return { k: 'global', label: s.label };
    this.notYet(span, `The local variable or parameter '${s.name}' (procedures)`);
    return null;
  }

  // ---- labels, hidden variables, strings -------------------------------------------------

  /** A fresh IR label `.T.<n>`, unique in the program (builders restart their own counters, so the context owns this one). */
  newLabel(): string {
    return `.T.${this.labels++}`;
  }

  /** A hidden global of `type` (a FOR limit, a SELECT subject, a spill slot): `.V.<n>`. */
  hidden(type: IrType): Operand {
    const label = `.V.${this.hiddenCount++}`;
    this.hiddenGlobals.push({ label, type, size: irSize(type), init: null, at: null, dims: [] });
    return { k: 'global', label };
  }

  /**
   * A scratch slot that lives across the statement being lowered (a FOR limit or step, a
   * SELECT subject, a value read twice): a frame slot inside a procedure, so recursion and
   * re-entry through another procedure keep their own copy (follow-up 28), else a hidden
   * global. Code that names the slot in `asm` text needs a label: it uses `hidden`.
   */
  scratch(type: IrType): Operand {
    return this.frameAlloc !== null ? this.frameAlloc(type) : this.hidden(type);
  }

  /** A hidden global holding constant bytes (the tables of a local array, its initial list): `.V.<n>`. */
  hiddenBytes(bytes: Uint8Array): string {
    const label = `.V.${this.hiddenCount++}`;
    this.hiddenGlobals.push({ label, type: 'u8', size: bytes.length, init: bytes, at: null, dims: [] });
    return label;
  }

  hiddenList(): readonly IrGlobal[] {
    return this.hiddenGlobals;
  }

  /** The id of the string constant with these characters (one per distinct text). */
  stringId(text: string): number {
    const known = this.stringIds.get(text);
    if (known !== undefined) return known;
    const id = this.stringList.length;
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
    this.stringList.push({ id, label: `.S.${id}`, bytes });
    this.stringIds.set(text, id);
    return id;
  }

  stringsList(): readonly IrString[] {
    return this.stringList;
  }

  /** Runtime files the lowered code needs beyond the source's `#require`s (`fwcall.asm` for a firmware CALL). */
  require(file: string): void {
    if (!this.extraRequires.includes(file)) this.extraRequires.push(file);
  }

  requiresList(): readonly string[] {
    return this.extraRequires;
  }

  // ---- bodies -----------------------------------------------------------------------

  /** Starts a new body (main or one procedure) with a fresh builder. */
  startBody(): void {
    this.b = new IrBuilder();
  }

  finishBody(): Quad[] {
    return this.b.take();
  }
}

export type { IrProgram };
