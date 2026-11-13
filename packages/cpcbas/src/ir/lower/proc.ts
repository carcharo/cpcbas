/**
 * SUB, FUNCTION and DEF FN (task L2-PROC; docs/ir.md, "Calling conventions").
 *
 * Frame of a procedure (IX-relative, as the `enter`/`leave` templates build it):
 * - STDCALL parameters from `(ix+4)` upwards, the first nearest the frame; every parameter
 *   takes its size rounded up to a pushed word (UBYTE/BYTE 2 bytes with the value at
 *   `+1`, a BYREF parameter 2 bytes holding an address, REAL 6 bytes with the value at
 *   `+1`); `leave`'s `argBytes` is their sum, always even;
 * - locals from `(ix-1)` downwards in `bound.locals` order (a FUNCTION's result variable
 *   first), zeroed by `enter`, then the slot of a FASTCALL procedure's register argument,
 *   then the spill slots a call with several argument calls needs;
 * - a FASTCALL procedure takes its first parameter in the result registers. When the body
 *   reads it (or it is a BYVAL string, which the procedure must free) `enter` stores it in a
 *   local slot and `params[0].offset` is that slot; otherwise the offset is 0.
 *
 * Ownership of strings:
 * - a BYVAL STRING parameter is owned by the callee (the caller's `param`/`fparam` hands over
 *   a fresh copy, or the temp itself), so the callee frees it; a BYREF one is borrowed;
 * - owned string locals and BYVAL string parameters are freed (`fparam` of the slot, then
 *   `.core.__MEM_FREE`) after the exit label and before the leave label, on every path that
 *   reaches it (falling off the end, EXIT SUB/FUNCTION, RETURN);
 * - a FUNCTION's result lives in its result variable. At the exit label the other string
 *   slots are freed first, then the result pointer moves into the result registers
 *   (`load u16` of the slot, `ret str` of that temp: no copy), so the result variable is
 *   never freed. DEF FN computes its value into an owned temp, frees its string parameters,
 *   then returns the temp.
 *
 * Calls: arguments are pushed last first (the first ends up nearest the frame), so they are
 * evaluated last first as the reference compiler does. Only when two or more arguments are
 * values and one of them can run a procedure (which could change what another one reads) are
 * they evaluated left to right, each but the last parked in a spill slot (a frame slot in a
 * procedure, a hidden global in the main program) and pushed from there; an owned string
 * moves through the slot as a raw pointer. From -O1 (`LowerCtx.minimalSpills`) an argument is parked only when it
 * reads state and a later argument may change state, fail or read something volatile, or the other way round (`argEffects`). A BYVAL STRING argument is always owned when it is
 * passed (`param` copies a variable, a temp is handed over); for a FASTCALL first parameter
 * the lowering makes the copy itself so the callee can always free it.
 */
import type {
  CallOrIndex,
  Expr,
  FnCall,
  Name,
  SubCallStmt,
} from "../../ast/ast.js";
import { InternalError } from "../../core/diagnostics.js";
import type { Span } from "../../core/source.js";
import { convertConst } from "../../checker/fold.js";
import type {
  ArraySymbol,
  DefFnSymbol,
  ProcedureSymbol,
  SymbolId,
  VariableSymbol,
} from "../../sem/model.js";
import { irSize, irType, type IrType, type TypeName } from "../../sem/types.js";
import { ARRAY_DESCRIPTOR_BYTES } from "../arrays.js";
import type { IrProcedure, Operand } from "../ir.js";
import type { LowerCtx, Val } from "./context.js";
import {
  allocLocalArray,
  descriptorAddress,
  freeLocalArray,
  layoutOf,
  lowerElementAddress,
  type LocalArray,
} from "./array.js";
import { castTo, immOf, lowerExpr, mayCall } from "./expr.js";
import { reachableProcedures } from "./reach.js";
import { lowerStmts } from "./stmt.js";

/** The frame limit of IX addressing (docs/ir.md, "Frame size"). */
const MAX_LOCAL_BYTES = 128;
const MAX_ARG_END = 127;

interface ProcState {
  /** Bytes of locals allocated so far (the frame grows while the body is lowered). */
  localBytes: number;
  /** The FUNCTION's result variable slot and type, or null. */
  result: { readonly slot: Operand; readonly type: IrType } | null;
  /** A RETURN with a value was lowered in this body. */
  returned?: boolean;
  /** The body has a GOSUB, ON ... GOSUB or a bare RETURN: it needs a real frame (L3-GOSUB). */
  needsFrame?: boolean;
  /** Quad indexes of the `fparam` that carries the frame bytes to a bare RETURN's check (patched at the end). */
  returnChecks?: number[];
}

const states = new WeakMap<LowerCtx, ProcState>();

/** A callee as the call lowering sees it. */
interface Callee {
  readonly label: string;
  readonly name: string;
  readonly convention: "STDCALL" | "FASTCALL";
  readonly params: readonly CalleeParam[];
  readonly ret: IrType | null;
}

interface CalleeParam {
  readonly type: IrType;
  readonly byref: boolean;
  readonly isArray: boolean;
  readonly typeName: TypeName;
  readonly default: Expr | null;
}

/** Bytes a parameter takes on the stack, and where its value sits inside them. */
function stackShape(
  type: IrType,
  byref: boolean,
): { readonly size: number; readonly at: number } {
  if (byref) return { size: 2, at: 0 };
  switch (type) {
    case "u8":
    case "i8":
      return { size: 2, at: 1 };
    case "f":
      return { size: 6, at: 1 };
    default:
      return { size: irSize(type), at: 0 };
  }
}

function frameOffset(o: Operand | undefined): number {
  if (o === undefined || o.k !== "frame")
    throw new InternalError("lowering: a parameter without a frame slot");
  return o.offset;
}

function allocLocal(st: ProcState, size: number): number {
  st.localBytes += size;
  return -st.localBytes;
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

/** SUB, FUNCTION and DEF FN bodies, in `bound.procedures` order. */
export function lowerProcedures(ctx: LowerCtx): IrProcedure[] {
  const out: IrProcedure[] = [];
  const reached = reachableProcedures(ctx.checked);
  for (const id of ctx.checked.bound.procedures) {
    if (!reached.has(id)) continue; // not compiled (L3-FIX); it was still bound and checked
    const s = ctx.sym(id);
    let p: IrProcedure | null = null;
    if (s.kind === "procedure") p = lowerProcedure(ctx, s);
    else if (s.kind === "deffn") p = lowerDefFn(ctx, s);
    if (p !== null) out.push(p);
  }
  return out;
}

function beginBody(ctx: LowerCtx): ProcState {
  ctx.startBody();
  ctx.slots.clear();
  ctx.loops.clear();
  // A body starts on no line: its own line numbers set it, never the main program's last one (R16; STOP's and
  // ON BREAK STOP's "Break in n" in a SUB declared above the numbered lines).
  ctx.lineNumber = null;
  const st: ProcState = { localBytes: 0, result: null };
  states.set(ctx, st);
  ctx.frameAlloc = (t) => ({ k: "frame", offset: allocLocal(st, irSize(t)) });
  return st;
}

function endBody(ctx: LowerCtx): void {
  ctx.slots.clear();
  ctx.procExit = null;
  ctx.frameAlloc = null;
  states.delete(ctx);
}

/** Gives the STDCALL parameters their offsets; returns the argument bytes, or null when the frame is too big. */
function layoutStack(
  ctx: LowerCtx,
  ids: readonly { id: SymbolId; byref: boolean }[],
  span: Span,
): number | null {
  let cursor = 4;
  for (const { id, byref } of ids) {
    const v = ctx.sym(id);
    // An array parameter is the address of a descriptor: a pushed word, like a BYREF one.
    const shape = v.kind === "array" ? { size: 2, at: 0 } : stackShape(irType((v as VariableSymbol).type), byref);
    const offset = cursor + shape.at;
    ctx.slots.set(
      id,
      byref ? { k: "frame", offset, byref: true } : { k: "frame", offset },
    );
    cursor += shape.size;
    if (cursor - 1 > MAX_ARG_END) {
      ctx.notYet(
        span,
        "A procedure with more than 123 bytes of parameters (frames are limited to 128 bytes)",
      );
      return null;
    }
  }
  return cursor - 4;
}

function freeSlot(ctx: LowerCtx, slot: Operand, span: Span): void {
  ctx.b.fparam("str", slot, span);
  ctx.b.rtcall(".core.__MEM_FREE", null, span);
}

function lowerProcedure(ctx: LowerCtx, s: ProcedureSymbol): IrProcedure | null {
  const span = s.decl.span;
  const st = beginBody(ctx);
  const b = ctx.b;
  const fast = s.convention === "FASTCALL";
  const exitLabel = `${s.label}__exit`;
  const leaveLabel = `${s.label}__leave`;
  ctx.procExit = exitLabel;

  b.label(s.label, span);
  const enterAt = b.quads.length;
  b.enter(0, span);

  // Parameters.
  const owned: Operand[] = []; // string slots to free on the way out
  const params: { type: IrType; offset: number; byref: boolean }[] = [];
  const stackParams: { id: SymbolId; byref: boolean }[] = [];
  let ok = true;
  for (const [i, p] of s.params.entries()) {
    const v = ctx.sym(p.symbol);
    if (p.isArray ? v.kind !== "array" : v.kind !== "variable") {
      ctx.notYet(v.span, "This kind of parameter");
      ok = false;
    } else if (!(fast && i === 0))
      stackParams.push({ id: p.symbol, byref: p.byref });
  }
  if (!ok) {
    endBody(ctx);
    return null;
  }

  // Locals (the result variable first), then the FASTCALL argument slot.
  const locals = ctx.checked.bound.locals.get(s.id) ?? [];
  const initial: { slot: Operand; id: SymbolId; type: IrType }[] = [];
  const arrays: LocalArray[] = []; // local arrays: allocated on entry, freed on every exit
  for (const id of locals) {
    const v = ctx.sym(id);
    if (v.kind === "array") {
      if (ctx.checked.atAddresses.has(id)) {
        ctx.notYet(v.span, "A local array with AT");
        ok = false;
      } else if (ctx.checked.arrayBounds.has(id)) {
        // the descriptor lives in the frame; the elements are allocated on the heap on entry
        const layout = layoutOf(ctx, v);
        const offset = allocLocal(st, ARRAY_DESCRIPTOR_BYTES);
        ctx.slots.set(id, { k: "frame", offset });
        arrays.push({ sym: v, offset, layout });
      }
      continue;
    }
    if (v.kind !== "variable") {
      ctx.notYet(v.span, "This kind of local");
      ok = false;
      continue;
    }
    if (ctx.checked.atAddresses.has(id)) {
      ctx.notYet(v.span, "A local variable with AT");
      ok = false;
      continue;
    }
    const t = irType(v.type);
    const slot: Operand = { k: "frame", offset: allocLocal(st, irSize(t)) };
    ctx.slots.set(id, slot);
    if (id === s.resultVar) st.result = { slot, type: t };
    else {
      if (t === "str") owned.push(slot);
      if (v.decl !== null) initial.push({ slot, id, type: t });
    }
  }
  if (!ok) {
    endBody(ctx);
    return null;
  }
  if (fast && s.params.length > 0) {
    const p = s.params[0] as (typeof s.params)[number];
    const av = ctx.sym(p.symbol);
    if (av.kind === "array") {
      // the descriptor address arrives in HL: keep it in a slot
      const offset = allocLocal(st, 2);
      ctx.slots.set(p.symbol, { k: "frame", offset });
      params.push({ type: "u16", offset, byref: false });
    } else {
    const v = av as VariableSymbol;
    const t = irType(v.type);
    {
      const needSlot = v.read || v.assigned || (t === "str" && !p.byref);
      let offset = 0;
      if (needSlot) {
        offset = allocLocal(st, p.byref ? 2 : irSize(t));
        ctx.slots.set(
          p.symbol,
          p.byref
            ? { k: "frame", offset, byref: true }
            : { k: "frame", offset },
        );
        if (t === "str" && !p.byref) owned.push({ k: "frame", offset });
      }
      params.push({ type: t, offset, byref: p.byref });
    }
    }
  }
  const argBytes = layoutStack(ctx, stackParams, span);
  if (argBytes === null) {
    endBody(ctx);
    return null;
  }
  s.params.forEach((p, i) => {
    if (fast && i === 0) return;
    const av = ctx.sym(p.symbol);
    if (av.kind === "array") {
      params.push({ type: "u16", offset: frameOffset(ctx.slots.get(p.symbol)), byref: false });
      return;
    }
    const v = av as VariableSymbol;
    const t = irType(v.type);
    const slot = ctx.slots.get(p.symbol) as Operand;
    params.push({ type: t, offset: frameOffset(slot), byref: p.byref });
    if (t === "str" && !p.byref) owned.push(slot);
  });

  // Local arrays: elements on the heap, descriptors filled, initial lists copied.
  for (const l of arrays) allocLocalArray(ctx, l, l.sym.span);

  // Initial values of local DIMs (the other locals start at zero).
  for (const { slot, id, type } of initial) {
    const c = ctx.checked.initialValues.get(id)?.[0];
    if (c === undefined) continue;
    if (typeof c.value === "string")
      b.store("str", slot, { k: "strconst", id: ctx.stringId(c.value) }, span);
    else if (c.value !== 0) b.store(type, slot, immOf(c.value, type).o, span);
  }

  lowerStmts(ctx, s.decl.body);

  // A FUNCTION that never assigns or reads its result and has no RETURN value, but has an ASM block
  // of its own (not the lowering's internal asm lines), returns what the ASM left in the registers
  // (the reference compiler's rule; the library's asm functions rely on it): no result is loaded from
  // the frame. Any other FUNCTION without a RETURN still returns 0.
  const rv = s.resultVar !== null ? ctx.sym(s.resultVar) : null;
  const inRegisters =
    st.result !== null &&
    rv !== null &&
    rv.kind === "variable" &&
    !rv.assigned &&
    !rv.read &&
    st.returned !== true &&
    b.quads.slice(enterAt).some((q) => q.op === "asm" && q.internal !== true);

  // The exit: free the owned strings, move the result into the registers, leave.
  b.label(exitLabel, s.decl.endSpan);
  const keep = inRegisters && (owned.length > 0 || arrays.length > 0);
  const endSpan = s.decl.endSpan;
  // The result registers (A, HL, DEHL, or A E D C B for a REAL) survive the freeing of string parameters.
  if (keep) b.asm(["\tpush af", "\tpush bc", "\tpush de", "\tpush hl"].map((text) => ({ text, span: endSpan })), endSpan, true);
  for (const slot of owned) freeSlot(ctx, slot, s.decl.endSpan);
  for (const l of arrays) freeLocalArray(ctx, l, s.decl.endSpan);
  if (keep) b.asm(["\tpop hl", "\tpop de", "\tpop bc", "\tpop af"].map((text) => ({ text, span: endSpan })), endSpan, true);
  if (st.result !== null && !inRegisters) {
    if (st.result.type === "str")
      b.ret(
        "str",
        b.load("u16", st.result.slot, s.decl.endSpan),
        leaveLabel,
        s.decl.endSpan,
      );
    else b.ret(st.result.type, st.result.slot, leaveLabel, s.decl.endSpan);
  }
  b.label(leaveLabel, s.decl.endSpan);
  b.leave(argBytes, fast ? "FASTCALL" : "STDCALL", s.decl.endSpan);

  if (st.localBytes > MAX_LOCAL_BYTES) {
    ctx.notYet(
      span,
      "A procedure with more than 128 bytes of locals (frames are limited to 128 bytes)",
    );
    endBody(ctx);
    return null;
  }
  finishGosubFrame(ctx, st);
  b.quads[enterAt] = { op: "enter", localBytes: st.localBytes, span };
  const body = ctx.finishBody();
  endBody(ctx);
  return {
    label: s.label,
    convention: s.convention,
    params,
    ret: s.returnType === null ? null : irType(s.returnType),
    body,
  };
}

function lowerDefFn(ctx: LowerCtx, s: DefFnSymbol): IrProcedure | null {
  const span = s.decl.span;
  const st = beginBody(ctx);
  const b = ctx.b;
  const leaveLabel = `${s.label}__leave`;
  b.label(s.label, span);
  const enterAt = b.quads.length;
  b.enter(0, span);

  const argBytes = layoutStack(
    ctx,
    s.params.map((id) => ({ id, byref: false })),
    span,
  );
  if (argBytes === null) {
    endBody(ctx);
    return null;
  }
  const params = s.params.map((id) => {
    const v = ctx.sym(id) as VariableSymbol;
    return {
      type: irType(v.type),
      offset: frameOffset(ctx.slots.get(id)),
      byref: false,
    };
  });

  const ret = irType(s.returnType);
  let v = lowerExpr(ctx, s.decl.body);
  if (v === null) {
    endBody(ctx);
    return null;
  }
  v = castTo(ctx, v, ret, s.decl.body.span);
  // A string that is not a temp is borrowed (possibly from a parameter about to be freed): own it first.
  if (ret === "str" && v.o.k !== "temp")
    v = { o: b.load("str", v.o, s.decl.body.span), t: "str" };
  for (const id of s.params) {
    const p = ctx.sym(id) as VariableSymbol;
    if (p.type === "STRING")
      freeSlot(ctx, ctx.slots.get(id) as Operand, s.decl.body.span);
  }
  b.ret(ret, v.o, leaveLabel, s.decl.body.span);
  b.label(leaveLabel, s.decl.span);
  b.leave(argBytes, "STDCALL", s.decl.span);

  b.quads[enterAt] = { op: "enter", localBytes: st.localBytes, span };
  const body = ctx.finishBody();
  endBody(ctx);
  return { label: s.label, convention: "STDCALL", params, ret, body };
}

/** `RETURN value` inside a FUNCTION: store it in the result variable, then go to the exit. */
export function lowerReturnValue(ctx: LowerCtx, e: Expr): void {
  const st = states.get(ctx);
  if (st === undefined || st.result === null || ctx.procExit === null) {
    ctx.notYet(e.span, "RETURN with a value outside a FUNCTION");
    return;
  }
  st.returned = true;
  const v = lowerExpr(ctx, e);
  if (v === null) return;
  ctx.b.store(
    st.result.type,
    st.result.slot,
    castTo(ctx, v, st.result.type, e.span).o,
    e.span,
  );
  ctx.b.jump(ctx.procExit, e.span);
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

function procCallee(s: ProcedureSymbol): Callee {
  return {
    label: s.label,
    name: s.name,
    convention: s.convention,
    params: s.params.map((p) => ({
      type: irType(p.type),
      byref: p.byref,
      isArray: p.isArray,
      typeName: p.type,
      default: p.default,
    })),
    ret: s.returnType === null ? null : irType(s.returnType),
  };
}

function fnCallee(ctx: LowerCtx, s: DefFnSymbol): Callee {
  return {
    label: s.label,
    name: `FN ${s.name}`,
    convention: "STDCALL",
    params: s.params.map((id) => {
      const v = ctx.sym(id) as VariableSymbol;
      return {
        type: irType(v.type),
        byref: false,
        isArray: false,
        typeName: v.type,
        default: null,
      };
    }),
    ret: irType(s.returnType),
  };
}

type Item =
  | { readonly kind: "val"; readonly e: Expr; readonly p: CalleeParam }
  | { readonly kind: "ref"; readonly e: Expr; readonly p: CalleeParam }
  | { readonly kind: "arr"; readonly e: Expr; readonly p: CalleeParam }
  | { readonly kind: "const"; readonly e: Expr; readonly p: CalleeParam };

/** A constant default as an operand of the parameter's type. */
function constVal(ctx: LowerCtx, e: Expr, p: CalleeParam): Val {
  const c = ctx.checked.constants.get(e);
  if (c === undefined)
    throw new InternalError(
      "lowering: a parameter default that was not folded",
    );
  const conv = convertConst(c, p.typeName) ?? c;
  if (typeof conv.value === "string")
    return { o: { k: "strconst", id: ctx.stringId(conv.value) }, t: "str" };
  return immOf(conv.value, p.type);
}

/** The address of the variable passed to a BYREF parameter, as a u16 operand; null after E002. */
function refVal(ctx: LowerCtx, e: Expr): Val | null {
  if (e.kind === "CallOrIndex") {
    // an array element: its address (constant for a global array with constant indexes)
    const id = ctx.checked.bound.resolutions.callOrIndex.get(e);
    const a = id === undefined ? undefined : ctx.sym(id);
    if (a?.kind !== "array")
      throw new InternalError("lowering: a BYREF argument that is not an array element");
    return lowerElementAddress(ctx, a, e.args, e.span);
  }
  if (e.kind !== "Name") {
    ctx.notYet(e.span, "A BYREF argument that is not a variable or an element");
    return null;
  }
  const id = ctx.checked.bound.resolutions.names.get(e);
  const s = id === undefined ? undefined : ctx.sym(id);
  if (s?.kind !== "variable")
    throw new InternalError(
      "lowering: a BYREF argument that is not a variable",
    );
  const slot = ctx.slots.get(s.id);
  if (slot !== undefined && slot.k === "frame") {
    // A BYREF slot already holds the address: pass it on.
    if (slot.byref === true)
      return {
        o: ctx.b.load("u16", { k: "frame", offset: slot.offset }, e.span),
        t: "u16",
      };
    return { o: { k: "frameaddr", offset: slot.offset }, t: "u16" };
  }
  if (s.storage === "global" && s.label !== null)
    return { o: { k: "addr", label: s.label }, t: "u16" };
  ctx.notYet(e.span, `Passing '${s.name}' by reference`);
  return null;
}

/** The descriptor address of the array an argument names, as a u16 operand; null after an error. */
function arrayArg(ctx: LowerCtx, e: Expr): Val | null {
  const id = e.kind === "Name" ? ctx.checked.bound.resolutions.names.get(e) : undefined;
  const a = id === undefined ? undefined : ctx.sym(id);
  if (a?.kind !== "array")
    throw new InternalError("lowering: an array argument that is not an array");
  return descriptorAddress(ctx, a as ArraySymbol, e.span);
}

/** Whether `e` reads no variable, array element or procedure result: a literal or a folded constant. */
function isInert(ctx: LowerCtx, e: Expr): boolean {
  return e.kind === "StringLit" || e.kind === "NumberLit" || ctx.checked.constants.get(e) !== undefined;
}

/** Whether `e` is a constant or a plain read of a scalar variable: it changes nothing, cannot fail and reads nothing volatile. */
function isQuiet(ctx: LowerCtx, e: Expr): boolean {
  if (isInert(ctx, e)) return true;
  if (e.kind !== "Name") return false;
  const id = ctx.checked.bound.resolutions.names.get(e);
  return id !== undefined && ctx.sym(id).kind === "variable";
}

/**
 * R20: what an argument's evaluation can do, for the -O1 spill rule. `reads`: it reads state another argument could change
 * (anything but a constant; a BYREF array element reads its indexes). `acts`: it may change state, raise an error or read
 * something that changes by itself (a procedure call, RND, INKEY$, TESTR, a division, an element's bounds, a string that
 * grows, ...): everything but a constant or a plain variable read. A BYREF scalar and an array argument are addresses
 * that nothing changes.
 */
function argEffects(ctx: LowerCtx, it: Item): { reads: boolean; acts: boolean } {
  if (it.kind === "const" || it.kind === "arr") return { reads: false, acts: false };
  if (it.kind === "ref") {
    const element = it.e.kind !== "Name";
    return { reads: element, acts: element };
  }
  return { reads: !isInert(ctx, it.e), acts: !isQuiet(ctx, it.e) };
}

/** A spill slot for a value of `type` (strings travel as raw pointers). */
function spillSlot(
  ctx: LowerCtx,
  type: IrType,
): { slot: Operand; type: IrType } {
  const t: IrType = type === "str" ? "u16" : type;
  return { slot: ctx.scratch(t), type: t };
}

interface CallResult {
  readonly ok: boolean;
  readonly val: Val | null;
}

/** Evaluates the arguments, pushes them and emits the call. */
function emitCall(
  ctx: LowerCtx,
  callee: Callee,
  args: readonly Expr[],
  span: Span,
): CallResult {
  const b = ctx.b;
  const fail: CallResult = { ok: false, val: null };
  const fast = callee.convention === "FASTCALL" && callee.params.length > 0;

  // The argument of each parameter: the one written, else the (constant) default.
  const items: Item[] = [];
  for (let i = 0; i < callee.params.length; i++) {
    const p = callee.params[i] as CalleeParam;
    const written = args[i];
    if (p.isArray) {
      if (written === undefined) {
        ctx.notYet(span, `An omitted array argument of ${callee.name}`);
        return fail;
      }
      items.push({ kind: "arr", e: written, p });
    } else if (written !== undefined)
      items.push({ kind: p.byref ? "ref" : "val", e: written, p });
    else if (p.default !== null && !p.byref)
      items.push({ kind: "const", e: p.default, p });
    else {
      ctx.notYet(span, `An omitted BYREF argument of ${callee.name}`);
      return fail;
    }
  }

  const vals = items.filter((it) => it.kind === "val");
  const ordered = vals.length >= 2 && vals.some((it) => mayCall(ctx, it.e));
  const n = items.length;
  const parked = new Map<
    number,
    { slot: Operand; type: IrType; str: boolean }
  >();
  const evaluated = new Map<number, Val>();

  /** The value of item `i` as an operand (evaluating it, or reloading it from its slot). */
  const value = (i: number): Val | null => {
    const it = items[i] as Item;
    const spilled = parked.get(i);
    if (spilled !== undefined)
      return { o: b.load(spilled.type, spilled.slot, span), t: it.p.type };
    const done = evaluated.get(i);
    if (done !== undefined) return done;
    if (it.kind === "const") return constVal(ctx, it.e, it.p);
    if (it.kind === "ref") return refVal(ctx, it.e);
    if (it.kind === "arr") return arrayArg(ctx, it.e);
    const v = lowerExpr(ctx, it.e);
    return v === null ? null : castTo(ctx, v, it.p.type, it.e.span);
  };

  if (ordered) {
    // From -O1: a value argument is parked only when it reads state and a later argument (of any kind) acts, or it acts
    // and a later one reads state (argEffects). Any two arguments left unparked then commute with each other and with
    // the parked ones, so evaluating them when they are pushed (last first) is observably -O0's left-to-right order:
    // the same values, side effects and first error (R20: RND, a BYREF element and ON ERROR showed the first rule's gaps).
    const effects = items.map((it) => argEffects(ctx, it));
    const needsSlot = (i: number): boolean => {
      if (!ctx.minimalSpills) return true;
      const me = effects[i] as { reads: boolean; acts: boolean };
      const later = effects.slice(i + 1);
      return (me.reads && later.some((l) => l.acts)) || (me.acts && later.some((l) => l.reads));
    };
    for (let i = 0; i < n; i++) {
      const it = items[i] as Item;
      if (it.kind !== "val" || !needsSlot(i)) continue;
      let v = value(i);
      if (v === null) return fail;
      if (v.o.k !== "imm" && i !== n - 1) {
        if (v.t === "str" && v.o.k !== "temp")
          v = { o: b.load("str", v.o, it.e.span), t: "str" };
        const sp = spillSlot(ctx, v.t);
        b.store(sp.type, sp.slot, v.o, it.e.span);
        parked.set(i, { ...sp, str: v.t === "str" });
      } else evaluated.set(i, v);
    }
  }

  let argBytes = 0;
  for (let i = n - 1; i >= (fast ? 1 : 0); i--) {
    const it = items[i] as Item;
    const v = value(i);
    if (v === null) return fail;
    const word = it.kind === "ref" || it.kind === "arr";
    b.param(word ? "u16" : it.p.type, v.o, span);
    argBytes += stackShape(it.p.type, word).size;
  }
  if (fast) {
    const it = items[0] as Item;
    let v = value(0);
    if (v === null) return fail;
    // A BYVAL string is handed to the callee owned: it always frees it.
    if (it.kind !== "ref" && it.kind !== "arr" && it.p.type === "str" && v.o.k !== "temp")
      v = { o: b.load("str", v.o, span), t: "str" };
    b.fparam(it.kind === "ref" || it.kind === "arr" ? "u16" : it.p.type, v.o, span);
  }
  if (argBytes % 2 !== 0)
    throw new InternalError("lowering: an odd number of argument bytes");

  if (callee.ret === null) {
    b.call(callee.label, argBytes, null, span);
    return { ok: true, val: null };
  }
  const dst = b.call(callee.label, argBytes, callee.ret, span) as Operand;
  return { ok: true, val: { o: dst, t: callee.ret } };
}

/** A SUB called as a statement. A FUNCTION there is the checker's E239 (Locomotive has no such form). */
export function lowerSubCall(ctx: LowerCtx, s: SubCallStmt): void {
  const id = ctx.checked.bound.resolutions.subCalls.get(s);
  const sym = id === undefined ? undefined : ctx.sym(id);
  if (sym?.kind !== "procedure")
    throw new InternalError("lowering: a SUB call without its procedure");
  if (sym.returnType !== null)
    throw new InternalError(
      "lowering: a FUNCTION called as a statement (the checker reports E239)",
    );
  emitCall(ctx, procCallee(sym), s.args, s.span);
}

/** A FUNCTION call, a FN call or a bare procedure name used as a value. */
export function lowerCallExpr(
  ctx: LowerCtx,
  e: CallOrIndex | FnCall | Name | Expr,
): Val | null {
  const res = ctx.checked.bound.resolutions;
  let id: SymbolId | undefined;
  let args: readonly Expr[] = [];
  if (e.kind === "CallOrIndex") {
    id = res.callOrIndex.get(e);
    args = e.args;
  } else if (e.kind === "FnCall") {
    id = res.fnCalls.get(e);
    args = e.args;
  } else if (e.kind === "Name") id = res.names.get(e);
  const sym = id === undefined ? undefined : ctx.sym(id);
  if (sym?.kind === "procedure") {
    const r = emitCall(ctx, procCallee(sym), args, e.span);
    return r.val;
  }
  if (sym?.kind === "deffn")
    return emitCall(ctx, fnCallee(ctx, sym), args, e.span).val;
  throw new InternalError("lowering: a call that is not a procedure");
}

// ---------------------------------------------------------------------------
// GOSUB and RETURN inside a procedure (L3-GOSUB)
//
// A GOSUB pushes its return address on the machine stack below the frame, IX stays as it is, so
// the subroutine sees the locals. At every statement boundary of a procedure the stack pointer is
// the frame's bottom (IX - localBytes) when no GOSUB is pending, so a bare RETURN is checked by
// comparing the two (`__LOCO_GOSUBCHK`: error 3 "Unexpected RETURN" when equal): no counter, no cost
// per GOSUB. The exit label's `leave` restores SP from IX, which unwinds pending GOSUBs; the frees of
// the exit run first, with the extra return addresses still on the stack, which they do not touch.
// ---------------------------------------------------------------------------

/** A GOSUB or ON ... GOSUB in a procedure body: the procedure needs a frame (IX) even without locals. */
export function noteProcGosub(ctx: LowerCtx): void {
  const st = states.get(ctx);
  if (st !== undefined) st.needsFrame = true;
}

/** `RETURN` alone in a procedure: error 3 when no GOSUB is pending, else return to the GOSUB's caller. */
export function lowerProcReturn(ctx: LowerCtx, span: Span): void {
  const st = states.get(ctx);
  if (st === undefined) throw new InternalError("lowering: a procedure RETURN without a procedure body");
  st.needsFrame = true;
  const b = ctx.b;
  b.fparam("u16", immOf(0, "u16").o, span);
  (st.returnChecks ??= []).push(b.quads.length - 1);
  b.rtcall(".core.__LOCO_GOSUBCHK", null, span);
  b.retsub(span);
}

/** Before the frame size is final: a body with GOSUBs gets a frame, the checks learn its bytes. */
function finishGosubFrame(ctx: LowerCtx, st: ProcState): void {
  if (st.needsFrame === true && st.localBytes === 0) allocLocal(st, 2);
  for (const i of st.returnChecks ?? []) {
    const q = ctx.b.quads[i];
    if (q === undefined || q.op !== "fparam") throw new InternalError("lowering: a lost RETURN check");
    ctx.b.quads[i] = { ...q, a: immOf(st.localBytes, "u16").o };
  }
}
