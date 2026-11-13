/**
 * Statement lowering: control flow, assignment and the dispatch to PRINT, the built-in
 * statements and the features later tasks own (pending.ts). A `stmt` quad starts every
 * executable statement with the line number in force; line labels and named labels become
 * `label` quads (`.L.100`, `.L.name`).
 *
 * Control-flow shapes (spec §6; the reference compiler's visit_FOR, visit_WHILE, visit_IF):
 * - IF: `jz` to the next branch, a `jump` to the end after each branch;
 * - FOR: from, limit and step are evaluated once, in source order; the limit and a
 *   non-constant step live in hidden globals; the loop jumps to its test first, so an
 *   empty range runs zero times; NEXT adds the step, then the test is `<=` (step >= 0) or
 *   `>=` (step < 0), decided at compile time for a constant step and by the sign of the
 *   step at run time otherwise (always `<=` for unsigned variables); with a step of +1 or
 *   -1 and a limit the increment could wrap past (a variable, or 255 for a UBYTE), NEXT
 *   tests `>=` / `<=` before the increment instead (`preTest`);
 * - WHILE / DO test at the top, the post-condition of DO at the bottom;
 * - SELECT CASE: the subject is stored once in a hidden global of the common type the
 *   checker chose; each test is a comparison that jumps into its clause body;
 * - EXIT and CONTINUE jump to the labels recorded when the loop was lowered.
 * No temp is ever live across a label: every condition is consumed by its `jz`/`jnz`.
 */
import type { CaseClause, DimStmt, DoLoopStmt, Expr, ForStmt, IfStmt, LetStmt, SelectCaseStmt, Stmt, WhileStmt } from '../../ast/ast.js';
import { InternalError } from '../../core/diagnostics.js';
import type { Span } from '../../core/source.js';
import { fits, integerRange, irType, type IrType, type TypeName } from '../../sem/types.js';
import type { CompareOp, Operand } from '../ir.js';
import { arrayOf, storeElement } from './array.js';
import { erlMarked, erlMarkTest, statementEnd, statementStart } from './boundary.js';
import { lowerBuiltinStmt, lowerCall, lowerMidAssign } from './builtins.js';
import type { LowerCtx, Val } from './context.js';
import { lowerAfter, lowerDiEi, lowerEvery, pollEmptyLoop } from './events.js';
import { lowerError, lowerOnError, lowerResume, returnCheck } from './errors.js';
import { castTo, immOf, lowerExpr, materialize, mayCall } from './expr.js';
import { lowerWrite } from './files.js';
import { lowerInput, lowerOnBreak } from './keys.js';
import { lowerRead, lowerRestore, lowerReturnValue, lowerSubCall } from './pending.js';
import { lowerProcReturn, noteProcGosub } from './proc.js';
import { lowerPrint } from './print.js';

/** Statements that generate no code of their own (declarations, settings, directives, tables). */
const NO_CODE: ReadonlySet<Stmt['kind']> = new Set<Stmt['kind']>([
  'Const',
  'DefType',
  'Option',
  'Declare',
  'Pragma',
  'Require',
  'Init',
  'Data',
  'Procedure',
  'DefFn',
  'BadStmt',
]);

export function lowerStmts(ctx: LowerCtx, list: readonly Stmt[]): void {
  for (const s of list) {
    lowerStmt(ctx, s);
    statementEnd(ctx, s);
  }
}

export function lowerStmt(ctx: LowerCtx, s: Stmt): void {
  // Follow-up 80: the first item of a line with no number resets the line (ERL 0, "Break" without "in n").
  if (s.unnumberedLine === true) ctx.lineNumber = null;
  if (s.kind === 'LineLabel') {
    if (s.number !== null) ctx.lineNumber = s.number;
    const sym = ctx.labelOfLine(s);
    if (sym !== undefined) ctx.b.label(sym.label, s.span);
    return;
  }
  if (s.kind === 'Dim') {
    lowerDimInit(ctx, s);
    return;
  }
  if (NO_CODE.has(s.kind)) return;
  const b = ctx.b;
  b.stmt(ctx.lineNumber, s.span);
  statementStart(ctx, s);
  switch (s.kind) {
    case 'Let':
      lowerLet(ctx, s);
      return;
    case 'If':
      lowerIf(ctx, s);
      return;
    case 'For':
      lowerFor(ctx, s);
      return;
    case 'While':
      lowerWhile(ctx, s);
      return;
    case 'DoLoop':
      lowerDo(ctx, s);
      return;
    case 'SelectCase':
      lowerSelect(ctx, s);
      return;
    case 'Exit':
    case 'Continue': {
      const node = ctx.checked.loopTargets.get(s);
      if (node === undefined) throw new InternalError('lowering: EXIT or CONTINUE without a target');
      if (node.kind === 'Procedure') {
        if (ctx.procExit === null) ctx.notYet(s.span, 'EXIT SUB / EXIT FUNCTION (procedures)');
        else b.jump(ctx.procExit, s.span);
        return;
      }
      const labels = ctx.loops.get(node);
      if (labels === undefined) throw new InternalError('lowering: a loop target outside its loop');
      b.jump(s.kind === 'Exit' ? labels.exit : labels.cont, s.span);
      return;
    }
    case 'Goto':
      b.jump(ctx.targetLabel(s.target), s.span);
      return;
    case 'Gosub':
      if (ctx.procExit !== null) noteProcGosub(ctx);
      b.gosub(ctx.targetLabel(s.target), s.span);
      return;
    case 'EveryAfter':
      if (s.every) lowerEvery(ctx, s);
      else lowerAfter(ctx, s);
      return;
    case 'Return':
      // A RETURN alone ends a GOSUB, in a procedure too (L3-GOSUB; EXIT SUB leaves the procedure).
      if (s.value === null && ctx.procExit !== null) lowerProcReturn(ctx, s.span);
      else if (s.value === null) {
        returnCheck(ctx, s.span); // L4-ERR (follow-up 52): error 3 when no GOSUB is pending
        b.retsub(s.span);
      }
      else lowerReturnValue(ctx, s.value);
      return;
    case 'OnGoto': {
      const v = lowerExpr(ctx, s.selector);
      if (v === null) return;
      if (s.gosub && ctx.procExit !== null) noteProcGosub(ctx);
      const sel = castTo(ctx, v, 'u16', s.selector.span);
      // A selector outside 0..255 is error 5 (Locomotive); 0 and values above n fall through.
      b.fparam('u16', sel.o, s.span);
      const checked = b.rtcall('.core.__LOCO_ARG255', 'u16', s.span) as Operand;
      b.jtable(
        checked,
        s.targets.map((t) => ctx.targetLabel(t)),
        s.gosub,
        s.span,
      );
      return;
    }
    case 'End':
      b.end(immOf(0, 'u16').o, s.span);
      return;
    case 'Stop':
      lowerStop(ctx, s.span);
      return;
    case 'Call':
      lowerCall(ctx, s);
      return;
    case 'SubCall':
      lowerSubCall(ctx, s);
      return;
    case 'Print':
      lowerPrint(ctx, s);
      return;
    case 'Builtin':
      if (s.keyword === 'DI' || s.keyword === 'EI') lowerDiEi(ctx, s);
      else lowerBuiltinStmt(ctx, s);
      return;
    case 'MidAssign':
      lowerMidAssign(ctx, s);
      return;
    case 'Asm':
      b.asm(
        s.lines.map((l) => ({ text: l.text, span: l.span })),
        s.span,
      );
      return;
    case 'OnError':
      lowerOnError(ctx, s);
      return;
    case 'Resume':
      lowerResume(ctx, s);
      return;
    case 'Error':
      lowerError(ctx, s);
      return;
    case 'Read':
      lowerRead(ctx, s);
      return;
    case 'Restore':
      lowerRestore(ctx, s);
      return;
    case 'Input':
      lowerInput(ctx, s);
      return;
    case 'Write':
      lowerWrite(ctx, s);
      return;
    case 'OnBreak':
      lowerOnBreak(ctx, s);
      return;
    default:
      ctx.notYet(s.span, s.kind);
  }
}

// ---------------------------------------------------------------------------

function lowerLet(ctx: LowerCtx, s: LetStmt): void {
  if (s.target.kind !== 'Name') {
    lowerElementLet(ctx, s);
    return;
  }
  const id = ctx.checked.bound.resolutions.names.get(s.target);
  const sym = id === undefined ? undefined : ctx.sym(id);
  if (sym?.kind !== 'variable') throw new InternalError('lowering: an assignment to something that is not a variable');
  const dst = ctx.varOperand(sym, s.target.span);
  const v = lowerExpr(ctx, s.value);
  if (dst === null || v === null) return;
  ctx.b.store(irType(sym.type), dst, castTo(ctx, v, irType(sym.type), s.value.span).o, s.span);
}

/**
 * A local `DIM x AS T = <expression>`: an assignment at the DIM's place in the body, constant or not, each
 * time it is reached (follow-up 66). A constant is
 * also stored when the procedure is entered (proc.ts), which is the zero fill. Globals never get here: a
 * non-constant global initial value is E243.
 */
function lowerDimInit(ctx: LowerCtx, s: DimStmt): void {
  if (ctx.frameAlloc === null) return;
  for (const d of s.decls) {
    if (d.init === null || d.init.kind === 'ArrayInit') continue;
    const id = ctx.checked.bound.resolutions.names.get(d.name);
    const sym = id === undefined ? undefined : ctx.sym(id);
    if (sym?.kind !== 'variable') continue;
    const dst = ctx.varOperand(sym, d.name.span);
    ctx.b.stmt(ctx.lineNumber, d.span);
    statementStart(ctx, s);
    const v = lowerExpr(ctx, d.init);
    if (dst === null || v === null) continue;
    ctx.b.store(irType(sym.type), dst, castTo(ctx, v, irType(sym.type), d.init.span).o, d.span);
  }
}

/** STOP: "Break in <line>" on a fresh line (just "Break" with no line number in the program), then the exit without END's closing of the files (follow-up 127). */
function lowerStop(ctx: LowerCtx, span: Span): void {
  if (ctx.lineNumber === null) {
    ctx.b.rtcall('.core.__LOCO_STOP', null, span);
  } else {
    ctx.b.fparam('u16', immOf(ctx.lineNumber, 'u16').o, span);
    ctx.b.rtcall('.core.__LOCO_STOPAT', null, span);
  }
  ctx.b.asm([{ text: '\tjp .core.__CPC_END', span }], span, true);
  ctx.b.end(immOf(0, 'u16').o, span);
}

/** `a(i, j) = value`: the element target of an assignment (src/ir/lower/array.ts). */
function lowerElementLet(ctx: LowerCtx, s: LetStmt): void {
  const target = s.target;
  if (target.kind !== 'CallOrIndex') throw new InternalError('lowering: an assignment to something that is not a variable or element');
  const arr = arrayOf(ctx, target);
  if (arr === null) throw new InternalError('lowering: an assignment to a call');
  storeElement(ctx, arr, target.args, s.span, () => {
    const v = lowerExpr(ctx, s.value);
    return v === null ? null : castTo(ctx, v, irType(arr.element), s.value.span);
  });
}

/** Evaluates `e` and jumps to `label` when it is zero (`jz`) or non-zero (`jnz`); false after an error. */
function condJump(ctx: LowerCtx, e: Expr, op: 'jz' | 'jnz', label: string): boolean {
  const v = lowerExpr(ctx, e);
  if (v === null) return false;
  if (op === 'jz') ctx.b.jz(v.t, v.o, label, e.span);
  else ctx.b.jnz(v.t, v.o, label, e.span);
  return true;
}

function lowerIf(ctx: LowerCtx, s: IfStmt): void {
  const b = ctx.b;
  const end = ctx.newLabel();
  s.branches.forEach((br, i) => {
    const next = ctx.newLabel();
    if (!condJump(ctx, br.cond, 'jz', next)) return;
    lowerStmts(ctx, br.body);
    if (i < s.branches.length - 1 || s.elseBody !== null) b.jump(end, br.span);
    b.label(next, br.span);
  });
  if (s.elseBody !== null) lowerStmts(ctx, s.elseBody);
  b.label(end, s.span);
}

function lowerWhile(ctx: LowerCtx, s: WhileStmt): void {
  const b = ctx.b;
  const top = ctx.newLabel();
  const exit = ctx.newLabel();
  const line = ctx.lineNumber;
  const marked = erlMarked(ctx, s); // a program without ON ERROR GOTO keeps its code and labels as they were
  const back = marked ? ctx.newLabel() : top;
  b.label(top, s.span);
  if (!condJump(ctx, s.cond, 'jz', exit)) return;
  ctx.loops.set(s, { cont: back, exit });
  lowerStmts(ctx, s.body);
  ctx.loops.delete(s);
  // the test of the next pass belongs to this line, not to the body's last statement (follow-up 81)
  if (marked) b.label(back, s.span);
  pollEmptyLoop(ctx, s.body, s.span);
  erlMarkTest(ctx, s, line);
  b.jump(top, s.span);
  b.label(exit, s.span);
}

function lowerDo(ctx: LowerCtx, s: DoLoopStmt): void {
  const b = ctx.b;
  const top = ctx.newLabel();
  const cont = ctx.newLabel();
  const exit = ctx.newLabel();
  const line = ctx.lineNumber;
  b.label(top, s.span);
  // WHILE c leaves when c is zero; UNTIL c leaves when c is non-zero.
  if (s.pre !== null && !condJump(ctx, s.pre.expr, s.pre.until ? 'jnz' : 'jz', exit)) return;
  ctx.loops.set(s, { cont, exit });
  lowerStmts(ctx, s.body);
  ctx.loops.delete(s);
  b.label(cont, s.span);
  // the test (the post condition, or the pre condition of the next pass) belongs to the loop, not to the body's last statement
  // (follow-up 81): a post condition is on the LOOP line, which ends the body's lines; a pre condition on the DO line
  pollEmptyLoop(ctx, s.body, s.span);
  if (s.post !== null || s.pre !== null) erlMarkTest(ctx, s, s.post !== null ? ctx.lineNumber : line);
  if (s.post === null) b.jump(top, s.span);
  else if (!condJump(ctx, s.post.expr, s.post.until ? 'jz' : 'jnz', top)) return;
  b.label(exit, s.span);
}

function lowerFor(ctx: LowerCtx, s: ForStmt): void {
  const b = ctx.b;
  const vid = ctx.checked.bound.resolutions.forVars.get(s);
  const vsym = vid === undefined ? undefined : ctx.sym(vid);
  if (vsym?.kind !== 'variable') throw new InternalError('lowering: a FOR without its variable');
  const t = irType(vsym.type);
  const variable = ctx.varOperand(vsym, s.variable.span);
  if (variable === null) return;

  // Evaluate from, limit and step in source order; the stores below run in reverse (LIFO).
  let from = lowerExpr(ctx, s.from);
  if (from === null) return;
  if (from.o.k !== 'imm' && from.o.k !== 'temp' && (mayCall(ctx, s.to) || (s.step !== null && mayCall(ctx, s.step)))) from = materialize(ctx, from, s.span);
  const limit = lowerExpr(ctx, s.to);
  if (limit === null) return;
  const step = s.step === null ? immOf(1, t) : lowerExpr(ctx, s.step);
  if (step === null) return;
  const stepConst = s.step === null ? 1 : (ctx.checked.constants.get(s.step)?.value ?? null);
  const constStep = typeof stepConst === 'number' ? stepConst : null;

  const limitOp: Operand = limit.o.k === 'imm' ? limit.o : ctx.scratch(t);
  const stepOp: Operand = step.o.k === 'imm' ? step.o : ctx.scratch(t);
  if (stepOp !== step.o) b.store(t, stepOp, step.o, s.span);
  if (limitOp !== limit.o) b.store(t, limitOp, limit.o, s.span);
  b.store(t, variable, from.o, s.span);

  const body = ctx.newLabel();
  const cont = ctx.newLabel();
  const test = ctx.newLabel();
  const exit = ctx.newLabel();
  b.jump(test, s.span);
  b.label(body, s.span);
  ctx.loops.set(s, { cont, exit });
  lowerStmts(ctx, s.body);
  ctx.loops.delete(s);
  b.label(cont, s.span);
  pollEmptyLoop(ctx, s.body, s.span);
  erlMarkTest(ctx, s, ctx.lineNumber); // the NEXT's line, which ends the body's lines (follow-up 81)
  const loopWhile = (op: CompareOp): void => {
    b.jnz('i16', b.compare(op, t, variable, limitOp, s.span), body, s.span);
  };
  if (preTest(vsym.type, limitOp, constStep)) {
    // Step +1 or -1 with a limit the increment could wrap past (FOR b AS UBYTE = 0 TO 255):
    // test the value before the increment (has it reached the limit?), then increment, so
    // the variable still ends one step past the limit as in Locomotive; when the test said
    // "not yet" the new value is inside the range and the body runs without a second test.
    const done = b.compare(constStep === 1 ? 'ge' : 'le', t, variable, limitOp, s.span);
    b.store(t, variable, b.add(t, variable, stepOp, s.span), s.span);
    b.jnz('i16', done, exit, s.span);
    b.jump(body, s.span);
    b.label(test, s.span);
    loopWhile(constStep === 1 ? 'le' : 'ge');
    b.label(exit, s.span);
    return;
  }
  // `up`: loop while the variable is below the limit (a positive step); the sign of a variable step of a signed type decides at run time.
  const branches = (loop: (op: CompareOp) => void): void => {
    if (constStep !== null) {
      loop(constStep < 0 ? 'ge' : 'le');
    } else if (t === 'u8' || t === 'u16' || t === 'u32') {
      loop('le');
    } else {
      const up = ctx.newLabel();
      b.jz('i16', b.compare('lt', t, stepOp, immOf(0, t).o, s.span), up, s.span);
      loop('ge');
      b.jump(exit, s.span);
      b.label(up, s.span);
      loop('le');
    }
  };
  const w = wideType(vsym.type);
  if (w !== null && (constStep === null || Number.isInteger(constStep)) && !(limit.o.k === 'imm' && constStep !== null && fits(limit.o.value + constStep, vsym.type))) {
    // An 8- or 16-bit variable and a step (or limit) that could carry the sum past the type: add in the
    // next wider type, store the narrowed sum, and test the wide sum against the limit, so the loop
    // ends instead of wrapping. The first test (the jump to `test`) compares the start value as is.
    const vw = castTo(ctx, { o: variable, t }, w, s.span);
    const sw = constStep !== null ? immOf(constStep, w) : castTo(ctx, { o: stepOp, t }, w, s.span);
    const sum = ctx.scratch(w);
    b.store(w, sum, b.add(w, vw.o, sw.o, s.span), s.span);
    b.store(t, variable, castTo(ctx, { o: sum, t: w }, t, s.span).o, s.span);
    const wideLimit = (): Operand => (limit.o.k === 'imm' ? immOf(limit.o.value, w).o : castTo(ctx, { o: limitOp, t }, w, s.span).o);
    branches((op) => b.jnz('i16', b.compare(op, w, sum, wideLimit(), s.span), body, s.span));
    b.jump(exit, s.span);
    b.label(test, s.span);
    branches(loopWhile);
    b.label(exit, s.span);
    return;
  }
  b.store(t, variable, b.add(t, variable, stepOp, s.span), s.span);
  b.label(test, s.span);
  branches(loopWhile);
  b.label(exit, s.span);
}

/** The type a FOR over an 8- or 16-bit integer variable adds in so the sum cannot wrap; null for the other types (32-bit loops wrap, as documented). */
function wideType(type: TypeName): IrType | null {
  const r = integerRange(type);
  if (r === null) return null;
  return r.max - r.min < 256 ? 'i16' : r.max - r.min < 65536 ? 'i32' : null;
}

/**
 * Whether a FOR needs the test before the increment: an integer variable, a constant step of
 * +1 or -1, and a limit that is not a constant with limit + step inside the type (a constant
 * limit away from the edge keeps the shorter test-after-increment shape). Other steps near the
 * edge of the type take the wider-sum shape in `lowerFor`.
 */
function preTest(type: TypeName, limit: Operand, step: number | null): step is 1 | -1 {
  if (step !== 1 && step !== -1) return false;
  if (integerRange(type) === null) return false;
  return limit.k !== 'imm' || !fits(limit.value + step, type);
}

function lowerSelect(ctx: LowerCtx, s: SelectCaseStmt): void {
  const b = ctx.b;
  if (ctx.typeOf(s.subject) === 'STRING') {
    lowerSelectStr(ctx, s);
    return;
  }
  const subject = lowerExpr(ctx, s.subject);
  if (subject === null) return;
  const t: IrType = subject.t;
  const slot = ctx.scratch(t);
  b.store(t, slot, subject.o, s.span);
  const end = ctx.newLabel();
  const value = (e: Expr): Val | null => {
    const v = lowerExpr(ctx, e);
    return v === null ? null : castTo(ctx, v, t, e.span);
  };
  for (const clause of s.cases) {
    const bodyLabel = ctx.newLabel();
    const nextLabel = ctx.newLabel();
    if (!lowerCaseTests(ctx, clause, slot, t, value, bodyLabel)) return;
    b.jump(nextLabel, clause.span);
    b.label(bodyLabel, clause.span);
    lowerStmts(ctx, clause.body);
    b.jump(end, clause.span);
    b.label(nextLabel, clause.span);
  }
  if (s.elseBody !== null) lowerStmts(ctx, s.elseBody);
  b.label(end, s.span);
}

/**
 * SELECT CASE on a string: the subject is evaluated once into an owned copy in a scratch slot
 * (a temp is taken, a variable copied), and each CASE compares the slot with `eq`/`ne`/`lt`... on
 * `str` (a computed CASE value is freed by the comparison). The slot is freed and cleared on entry
 * to the clause body that runs, to the ELSE part, or after the last clause when nothing matched.
 * The subject is dead once a body starts, so no EXIT, GOTO, RETURN or END SELECT inside a body
 * can leak it, and a frame slot needs no freeing on the way out.
 */
function lowerSelectStr(ctx: LowerCtx, s: SelectCaseStmt): void {
  const b = ctx.b;
  const subject = lowerExpr(ctx, s.subject);
  if (subject === null) return;
  const slot = ctx.scratch('str');
  b.store('str', slot, subject.o, s.span);
  // `store` of "" would only shrink the block to a 2-byte empty string (__STRASSIGN), and a frame
  // slot is not freed on leaving: free it, then clear the pointer (a raw word store, no realloc)
  const release = (span: Span): void => {
    b.fparam('str', slot, span);
    b.rtcall('.core.__MEM_FREE', null, span);
    b.store('u16', slot, immOf(0, 'u16').o, span);
  };
  const end = ctx.newLabel();
  const value = (e: Expr): Val | null => {
    const v = lowerExpr(ctx, e);
    return v === null ? null : castTo(ctx, v, 'str', e.span);
  };
  for (const clause of s.cases) {
    const bodyLabel = ctx.newLabel();
    const nextLabel = ctx.newLabel();
    if (!lowerCaseTests(ctx, clause, slot, 'str', value, bodyLabel)) return;
    b.jump(nextLabel, clause.span);
    b.label(bodyLabel, clause.span);
    release(clause.span);
    lowerStmts(ctx, clause.body);
    b.jump(end, clause.span);
    b.label(nextLabel, clause.span);
  }
  release(s.span);
  if (s.elseBody !== null) lowerStmts(ctx, s.elseBody);
  b.label(end, s.span);
}

function lowerCaseTests(ctx: LowerCtx, clause: CaseClause, slot: Operand, t: IrType, value: (e: Expr) => Val | null, bodyLabel: string): boolean {
  const b = ctx.b;
  for (const test of clause.tests) {
    let hit: Operand;
    if (test.kind === 'CaseValue') {
      const v = value(test.value);
      if (v === null) return false;
      hit = b.compare('eq', t, slot, v.o, test.span);
    } else if (test.kind === 'CaseIs') {
      const v = value(test.value);
      if (v === null) return false;
      const op = ({ '=': 'eq', '<>': 'ne', '<': 'lt', '>': 'gt', '<=': 'le', '>=': 'ge' } as const)[test.op];
      hit = b.compare(op, t, slot, v.o, test.span);
    } else {
      const lo = value(test.from);
      if (lo === null) return false;
      const ge = b.compare('ge', t, slot, lo.o, test.span);
      const hi = value(test.to);
      if (hi === null) return false;
      const le = b.compare('le', t, slot, hi.o, test.span);
      hit = b.and('i16', ge, le, test.span);
    }
    b.jnz('i16', hit, bodyLabel, test.span);
  }
  return true;
}
