/**
 * The checker proper: types every expression, makes conversions explicit, folds constants,
 * checks lvalues, procedure calls and EXIT/CONTINUE targets, refuses what bare mode cannot
 * do, and gates the L2 subset (subset.ts). Contract: sem/model.ts (CheckFn).
 * Rules: spec sections 4, 5, 7, 18.
 */
import type {
  ArrayInit,
  BinaryExpr,
  BuiltinCall,
  CallOrIndex,
  CallStmt,
  DimDecl,
  Expr,
  FnCall,
  ForStmt,
  LValue,
  Name,
  NumberLit,
  Param,
  PrintStmt,
  ProcedureDecl,
  Stmt,
  SubCallStmt,
  UnaryExpr,
} from '../ast/ast.js';
import type { DiagnosticBag, DiagnosticCode } from '../core/diagnostics.js';
import type { Span } from '../core/source.js';
import { keywordOf } from '../lang/keywords.js';
import type {
  ArraySymbol,
  CheckInput,
  CheckedProgram,
  ConstSymbol,
  ConstValue,
  DefFnSymbol,
  LoopNode,
  ProcedureSymbol,
  SemSymbol,
  SymbolId,
} from '../sem/model.js';
import { fits, isInteger, literalType, literalValue, promote, sizeOf, type TypeName } from '../sem/types.js';
import { FN_SIGS, STMT_SIGS, type ArgKind } from './builtins.js';
import { convertConst, foldBinary, foldBuiltin, foldUnary } from './fold.js';
import { SUBSET_BUILTIN_STMTS, SUBSET_FUNCTIONS, SUBSET_STMT_KINDS } from './subset.js';

export interface CheckOptions {
  /** Apply the L2 subset gate (E002 outside it). On for `check`; tests of later-phase rules turn it off. */
  readonly subset: boolean;
}

type LoopStmt = ForStmt | Extract<Stmt, { kind: 'While' | 'DoLoop' }>;

interface Ctx {
  readonly proc: ProcedureDecl | null;
  readonly loops: LoopStmt[];
}

const NON_EXECUTABLE: ReadonlySet<Stmt['kind']> = new Set<Stmt['kind']>([
  'LineLabel',
  'Data',
  'Procedure',
  'Declare',
  'DefFn',
  'Dim',
  'Const',
  'DefType',
  'Option',
  'Pragma',
  'Require',
  'Init',
  'BadStmt',
]);

/** The statements of L4-FILES whose arguments `fileStmt` checks. */
const FILE_STMTS: ReadonlySet<string> = new Set(['OPENIN', 'OPENOUT', 'CHAIN', 'LOAD', 'SAVE']);

const TERMINATORS: ReadonlySet<Stmt['kind']> = new Set<Stmt['kind']>(['Goto', 'End', 'Stop', 'Return', 'Exit', 'Continue']);

const SIGNED_OF: Readonly<Partial<Record<TypeName, TypeName>>> = {
  UBYTE: 'INTEGER',
  UINTEGER: 'LONG',
  ULONG: 'LONG',
};

export function checkProgram(input: CheckInput, options: CheckOptions): CheckedProgram {
  return new Checker(input, options).run();
}

class Checker {
  private readonly bound: CheckInput['bound'];
  private readonly diag: DiagnosticBag;
  private readonly res: CheckInput['bound']['resolutions'];
  private readonly bare: boolean;
  /** The value of the first SYMBOL AFTER (L4-TEXT: a program has one). */
  private symbolAfter: number | null = null;
  private readonly exprTypes = new Map<Expr, TypeName>();
  private readonly constants = new Map<Expr, ConstValue>();
  private readonly coercions = new Map<Expr, TypeName>();
  private readonly constValues = new Map<SymbolId, ConstValue>();
  private readonly arrayBounds = new Map<SymbolId, readonly number[]>();
  private readonly atAddresses = new Map<SymbolId, number>();
  private readonly initialValues = new Map<SymbolId, readonly ConstValue[]>();
  private readonly loopTargets = new Map<Extract<Stmt, { kind: 'Exit' | 'Continue' }>, LoopNode>();
  private readonly constBusy = new Set<SymbolId>();
  private readonly constBad = new Set<SymbolId>();
  private errors = 0;
  private ctx: Ctx = { proc: null, loops: [] };
  /** The procedure being checked has a GOSUB / ON ... GOSUB; its RETURN statements without a value. */
  private procHasGosub = false;
  private procBareReturns: Span[] = [];

  constructor(
    input: CheckInput,
    private readonly options: CheckOptions,
  ) {
    this.bound = input.bound;
    this.diag = input.diagnostics;
    this.res = input.bound.resolutions;
    this.bare = input.bound.bareMetal;
  }

  run(): CheckedProgram {
    this.stmts(this.bound.program.body);
    return {
      bound: this.bound,
      exprTypes: this.exprTypes,
      constants: this.constants,
      coercions: this.coercions,
      constValues: this.constValues,
      arrayBounds: this.arrayBounds,
      atAddresses: this.atAddresses,
      initialValues: this.initialValues,
      loopTargets: this.loopTargets,
      ok: this.errors === 0,
    };
  }

  // ---- infrastructure -------------------------------------------------------------

  private report(code: DiagnosticCode, span: Span, message: string, hint?: string): void {
    if (!code.startsWith('W')) this.errors++;
    this.diag.report(code, span, message, hint);
  }

  private sym(id: SymbolId): SemSymbol {
    return this.bound.symbols[id] as SemSymbol;
  }

  private kwSpan(span: Span, word: string): Span {
    return {
      file: span.file,
      start: span.start,
      end: Math.min(span.end, span.start + word.length),
    };
  }

  private gate(span: Span, what: string): void {
    this.report('E002', span, `${what} is not implemented yet`, 'It is planned for a later release; leave it out for now.');
  }

  private setConst(e: Expr, c: ConstValue): void {
    this.constants.set(e, c);
  }

  private coerce(e: Expr, to: TypeName): void {
    const from = this.exprTypes.get(e);
    if (from !== undefined && from !== to) this.coercions.set(e, to);
  }

  private mismatch(span: Span, message: string, hint?: string): void {
    this.report('E230', span, message, hint);
  }

  /** A numeric expression; E230 for a STRING. */
  private numExpr(e: Expr, what: string): TypeName | null {
    const t = this.expr(e);
    if (t === null) return null;
    if (t === 'STRING') {
      this.mismatch(e.span, `${what} must be a number, not a STRING`, 'Convert the text with VAL, or use a numeric expression.');
      return null;
    }
    return t;
  }

  private strExpr(e: Expr, what: string): TypeName | null {
    const t = this.expr(e);
    if (t === null) return null;
    if (t !== 'STRING') {
      this.mismatch(e.span, `${what} must be a STRING, not a number`, 'Convert the number with STR$, or use a STRING expression.');
      return null;
    }
    return t;
  }

  /** A number used as an integer: FIXED and REAL are converted to INTEGER. */
  private intExpr(e: Expr, what: string): void {
    const t = this.numExpr(e, what);
    if (t !== null && !isInteger(t)) this.coerce(e, 'INTEGER');
  }

  /** Checks that `value` (of type `from`) can be stored in `to`, and records the conversion. */
  private assignable(value: Expr, from: TypeName | null, to: TypeName, what: string): boolean {
    if (from === null) return false;
    if ((from === 'STRING') !== (to === 'STRING')) {
      this.mismatch(
        value.span,
        `Cannot ${what}: a ${from} does not fit a ${to}`,
        from === 'STRING' ? 'Convert the text with VAL.' : 'Convert the number with STR$.',
      );
      return false;
    }
    this.coerce(value, to);
    return true;
  }

  // ---- statements -----------------------------------------------------------------

  private stmts(list: readonly Stmt[]): void {
    let dead = false;
    for (const s of list) {
      if (s.kind === 'LineLabel') {
        dead = false;
        continue;
      }
      if (dead && !NON_EXECUTABLE.has(s.kind)) {
        this.report(
          'W320',
          s.span,
          'This statement can never run',
          'It follows GOTO, END, STOP, RETURN, EXIT or CONTINUE with no line number or label in between.',
        );
        dead = false;
      }
      this.stmt(s);
      if (TERMINATORS.has(s.kind)) dead = true;
    }
  }

  private stmtWord(s: Stmt): string {
    switch (s.kind) {
      case 'Builtin':
        return s.keyword;
      case 'Print':
        return 'PRINT';
      case 'Input':
        return s.line ? 'LINE INPUT' : 'INPUT';
      case 'MidAssign':
        return 'MID$';
      case 'OnBreak':
        return 'ON BREAK';
      case 'OnError':
        return 'ON ERROR';
      case 'Resume':
        return 'RESUME';
      case 'Error':
        return 'ERROR';
      case 'Stop':
        return 'STOP';
      case 'EveryAfter':
        return s.every ? 'EVERY' : 'AFTER';
      case 'Rsx':
        return `|${s.name}`;
      case 'SelectCase':
        return 'SELECT';
      case 'DoLoop':
        return 'DO';
      case 'OnGoto':
        return 'ON';
      default:
        return s.kind.toUpperCase();
    }
  }

  /** Bare-mode refusals and the subset gate for a statement. False: it was refused, do not look inside. */
  private admit(s: Stmt): boolean {
    const word = this.stmtWord(s);
    const kw = this.kwSpan(s.span, word);
    if (s.kind === 'Rsx' && this.bare) {
      this.report('E272', kw, `|${s.name} is an RSX command and is not available in bare mode`);
      return false;
    }
    if (s.kind === 'Write' && this.bare) {
      this.report('E270', kw, 'WRITE needs the firmware and is not available in bare mode', 'A bare build has no files; WRITE to a screen stream needs the firmware too.');
      return false;
    }
    if (s.kind === 'Builtin') {
      const entry = keywordOf(s.keyword, 'statement');
      if (this.bare && entry?.status === 'firmware') {
        this.report('E270', kw, `${s.keyword} needs the firmware and is not available in bare mode`, entry.note ?? undefined);
        return false;
      }
      if (this.bare && !this.bareGraphicsArgs(s)) return false;
    }
    if (!this.options.subset) return true;
    if (s.kind === 'Builtin') {
      const known = SUBSET_BUILTIN_STMTS.has(s.keyword);
      if (!known) {
        this.gate(kw, s.keyword);
        return false;
      }
      return true;
    }
    if (!SUBSET_STMT_KINDS.has(s.kind)) {
      this.gate(kw, word);
      return false;
    }
    return true;
  }

  /**
   * L4-GFX: the arguments of a graphics statement that only the firmware can do (E270 in a bare build): the window part of
   * ORIGIN, the ink mode of PLOT, PLOTR, MOVE, MOVER, DRAW and DRAWR (a literal 0, a normal write, is what a bare build
   * does anyway), and the background mode of GRAPHICS PEN. False: it was refused.
   */
  private bareGraphicsArgs(s: Extract<Stmt, { kind: 'Builtin' }>): boolean {
    let at: Expr | null | undefined;
    let what: string;
    switch (s.keyword) {
      case 'ORIGIN':
        at = s.args.length > 2 ? (s.args[2] ?? null) : undefined;
        what = "ORIGIN's window";
        break;
      case 'GRAPHICS PEN':
        at = s.args[1];
        what = "GRAPHICS PEN's background mode";
        break;
      case 'PLOT':
      case 'PLOTR':
      case 'MOVE':
      case 'MOVER':
      case 'DRAW':
      case 'DRAWR':
        at = s.args[3];
        if (at !== undefined && at !== null && at.kind === 'NumberLit' && at.value === 0) at = undefined;
        what = `The ink mode of ${s.keyword}`;
        break;
      default:
        return true;
    }
    if (at === undefined) return true;
    this.report('E270', at === null ? s.span : at.span, `${what} needs the firmware and is not available in bare mode`, 'Remove it, or build in firmware mode.');
    return false;
  }

  private stmt(s: Stmt): void {
    if (!this.admit(s)) return;
    switch (s.kind) {
      case 'LineLabel':
      case 'DefType':
      case 'Option':
      case 'Gosub':
        this.gosubInProcedure();
        return;
      case 'OnBreak':
        this.onBreak(s);
        return;
      case 'Goto':
      case 'Restore':
      case 'End':
      case 'Stop':
      case 'OnError':
      case 'Resume':
      case 'Data':
      case 'Declare':
      case 'Asm':
      case 'Pragma':
      case 'Require':
      case 'Init':
      case 'BadStmt':
        return;
      case 'Let': {
        const tt = this.lvalue(s.target, 'assign');
        const vt = this.expr(s.value);
        if (tt !== null) this.assignable(s.value, vt, tt, 'assign');
        return;
      }
      case 'MidAssign': {
        const tt = this.lvalue(s.target, 'assign');
        if (tt !== null && tt !== 'STRING') this.mismatch(s.target.span, 'MID$ changes a STRING variable', 'Use a variable whose name ends in $.');
        this.intExpr(s.start, 'The MID$ start');
        if (s.length) this.intExpr(s.length, 'The MID$ length');
        this.strExpr(s.value, 'The replacement');
        return;
      }
      case 'Dim':
        for (const d of s.decls) this.dimDecl(d);
        return;
      case 'Const': {
        const id = this.res.names.get(s.name);
        const sym = id !== undefined ? this.sym(id) : undefined;
        if (sym?.kind === 'const') this.constOf(sym);
        else this.expr(s.value);
        return;
      }
      case 'If':
        for (const b of s.branches) {
          this.numExpr(b.cond, 'The IF condition');
          this.stmts(b.body);
        }
        if (s.elseBody) this.stmts(s.elseBody);
        return;
      case 'For':
        this.forStmt(s);
        return;
      case 'While':
        this.numExpr(s.cond, 'The WHILE condition');
        this.inLoop(s, s.body);
        return;
      case 'DoLoop':
        if (s.pre) this.numExpr(s.pre.expr, 'The loop condition');
        if (s.post) this.numExpr(s.post.expr, 'The loop condition');
        this.inLoop(s, s.body);
        return;
      case 'SelectCase':
        this.selectCase(s);
        return;
      case 'Exit':
      case 'Continue':
        this.exitContinue(s);
        return;
      case 'Return':
        this.returnStmt(s);
        return;
      case 'OnGoto':
        this.numExpr(s.selector, 'The ON selector');
        if (s.gosub) this.gosubInProcedure();
        return;
      case 'Error':
        this.intExpr(s.code, 'The error number');
        return;
      case 'EveryAfter':
        this.intExpr(s.interval, 'The interval');
        if (s.timer) this.intExpr(s.timer, 'The timer number');
        return;
      case 'Call':
        this.callStmt(s);
        return;
      case 'Rsx':
        for (const a of s.args) this.expr(a);
        return;
      case 'SubCall':
        this.subCall(s);
        return;
      case 'Print':
        this.printStmt(s);
        return;
      case 'Write':
        if (s.stream) {
          this.intExpr(s.stream, 'The stream');
          this.streamCheck(s.stream, 'WRITE', 8, true);
        }
        for (const it of s.items) this.expr(it);
        return;
      case 'Input':
        if (s.stream) {
          this.intExpr(s.stream, 'The stream');
          this.streamCheck(s.stream, s.line ? 'LINE INPUT' : 'INPUT', 7, true);
        }
        if (s.prompt !== null && s.prompt.value.length > 255) this.report('E267', s.prompt.span, `The ${s.line ? 'LINE INPUT' : 'INPUT'} prompt is longer than 255 characters`);
        for (const t of s.targets) {
          const tt = this.lvalue(t, 'read into');
          if (s.line && tt !== null && tt !== 'STRING') this.report('E266', t.span, `LINE INPUT reads into a string variable, not ${/^[AEIOU]/.test(tt) ? 'an' : 'a'} ${tt}`);
        }
        return;
      case 'Read':
        for (const t of s.targets) this.lvalue(t, 'read into');
        return;
      case 'Procedure':
        this.procedure(s);
        return;
      case 'DefFn':
        this.defFn(s);
        return;
      case 'Builtin':
        this.builtinStmt(s);
        return;
    }
  }

  /** ON BREAK STOP needs the firmware's key manager: a bare build refuses it (L4-KEYS). CONT is always fine: a bare build has no break key to ignore. */
  private onBreak(s: Extract<Stmt, { kind: 'OnBreak' }>): void {
    if (this.bare && s.action === 'STOP') this.report('E270', this.kwSpan(s.span, 'ON BREAK'), 'ON BREAK STOP needs the firmware and is not available in bare mode');
  }

  private inLoop(loop: LoopStmt, body: readonly Stmt[]): void {
    this.ctx.loops.push(loop);
    this.stmts(body);
    this.ctx.loops.pop();
  }

  private forStmt(s: ForStmt): void {
    const id = this.res.forVars.get(s);
    const sym = id !== undefined ? this.sym(id) : undefined;
    let vt: TypeName | null = null;
    if (sym?.kind === 'variable') {
      vt = sym.type;
      this.exprTypes.set(s.variable, vt);
      if (vt === 'STRING') {
        this.mismatch(s.variable.span, 'The FOR variable must be a number', 'Use a numeric variable.');
        vt = null;
      }
    }
    const parts: Array<[Expr, string]> = [
      [s.from, 'The FOR start'],
      [s.to, 'The FOR limit'],
    ];
    if (s.step) parts.push([s.step, 'The FOR step']);
    for (const [e, what] of parts) {
      const t = this.numExpr(e, what);
      if (t !== null && vt !== null) this.coerce(e, vt);
    }
    this.inLoop(s, s.body);
  }

  private selectCase(s: Extract<Stmt, { kind: 'SelectCase' }>): void {
    const st = this.expr(s.subject);
    const values: Expr[] = [];
    for (const c of s.cases) {
      for (const t of c.tests) {
        if (t.kind === 'CaseRange') values.push(t.from, t.to);
        else values.push(t.value);
      }
    }
    const types = values.map((v) => this.expr(v));
    for (const c of s.cases) this.stmts(c.body);
    if (s.elseBody) this.stmts(s.elseBody);
    if (st === null) return;
    const isStr = st === 'STRING';
    let ok = true;
    values.forEach((v, i) => {
      const t = types[i] ?? null;
      if (t !== null && (t === 'STRING') !== isStr) {
        this.mismatch(v.span, `A CASE value of type ${t} cannot be compared with a ${st} subject`, isStr ? 'Use a text value.' : 'Use a number.');
        ok = false;
      }
    });
    if (!ok || isStr) return;
    // One common type for the subject and every value, so the lowering compares in it.
    const nums = [s.subject, ...values];
    const common = this.commonOf(
      nums,
      nums.map((e) => this.exprTypes.get(e) ?? 'INTEGER'),
    );
    for (const e of nums) this.coerce(e, common);
  }

  private exitContinue(s: Extract<Stmt, { kind: 'Exit' | 'Continue' }>): void {
    const want = s.target;
    const verb = s.kind === 'Exit' ? 'EXIT' : 'CONTINUE';
    if (want === 'SUB' || want === 'FUNCTION') {
      if (this.ctx.proc !== null && this.ctx.proc.procKind === want) this.loopTargets.set(s, this.ctx.proc);
      else this.report('E237', s.span, `${verb} ${want} outside a ${want}`);
      return;
    }
    const kind = want === 'FOR' ? 'For' : want === 'WHILE' ? 'While' : 'DoLoop';
    for (let i = this.ctx.loops.length - 1; i >= 0; i--) {
      const l = this.ctx.loops[i] as LoopStmt;
      if (l.kind === kind) {
        this.loopTargets.set(s, l);
        return;
      }
    }
    this.report('E237', s.span, `${verb} ${want} has no enclosing ${want} loop`);
  }

  /** GOSUB and ON ... GOSUB are allowed inside a SUB or FUNCTION (L3-GOSUB); a bare RETURN there needs one (E251, checked at the procedure's end). */
  private gosubInProcedure(): void {
    if (this.ctx.proc !== null) this.procHasGosub = true;
  }

  private returnStmt(s: Extract<Stmt, { kind: 'Return' }>): void {
    if (s.value === null) {
      if (this.ctx.proc !== null) this.procBareReturns.push(s.span);
      return;
    }
    const vt = this.expr(s.value);
    const p = this.ctx.proc;
    if (p === null || p.procKind !== 'FUNCTION') {
      this.report('E238', s.span, 'RETURN with a value is only allowed inside a FUNCTION');
      return;
    }
    const id = this.res.names.get(p.name);
    const sym = id !== undefined ? this.sym(id) : undefined;
    if (sym?.kind === 'procedure' && sym.returnType !== null) this.assignable(s.value, vt, sym.returnType, `return this from FUNCTION ${p.name.text}`);
  }

  private printStmt(s: PrintStmt): void {
    if (s.stream) {
      this.intExpr(s.stream, 'The stream');
      this.streamCheck(s.stream, 'PRINT', 8, true);
    }
    let usingAt: Span | null = null;
    let usingItems = 0;
    for (const it of s.items) {
      switch (it.kind) {
        case 'PrintExpr':
          this.expr(it.expr);
          if (usingAt !== null) usingItems++;
          break;
        case 'PrintSep':
          break;
        case 'PrintTab':
          this.intExpr(it.column, 'The TAB column');
          break;
        case 'PrintSpc':
          this.intExpr(it.count, 'The SPC count');
          break;
        case 'PrintUsing':
          this.strExpr(it.format, 'The USING format');
          usingAt = this.kwSpan(it.span, 'USING');
          break;
        case 'PrintAt':
          this.intExpr(it.row, 'The row');
          this.intExpr(it.col, 'The column');
          break;
      }
    }
    if (usingAt !== null && usingItems === 0) this.report('E265', usingAt, 'PRINT USING has no value to print');
  }

  /**
   * A constant stream (L4-TEXT, L4-FILES): 0-`highest`, and #9 (the output file) where `file` says it can be used; in a
   * bare build only #0 (E270, naming the statement and the stream). A stream that is not a constant is checked when it runs.
   */
  private streamCheck(stream: Expr, what: string, highest: number, file: boolean): void {
    const c = this.constants.get(stream);
    if (c === undefined || typeof c.value !== 'number' || !Number.isInteger(c.value) || c.value === 0) return;
    const n = c.value;
    if (n < 0 || (n > highest && !(file && n === 9))) {
      this.report('E262', stream.span, `${what} cannot use stream #${n}`);
      return;
    }
    this.bareStream(stream, what, n);
  }

  /** In a bare build only the text screen exists: any stream but #0 needs the firmware (E270). True when it reported. */
  private bareStream(stream: Expr, what: string, n: number): boolean {
    if (!this.bare) return false;
    this.report('E270', stream.span, `${what} on stream #${n} needs the firmware and is not available in bare mode`, 'A bare build has the one text window, #0.');
    return true;
  }

  private callStmt(s: CallStmt): void {
    const at = this.numExpr(s.address, 'The CALL address');
    if (at !== null) this.coerce(s.address, 'UINTEGER');
    const c = this.constants.get(s.address);
    if (this.bare && c !== undefined && typeof c.value === 'number') {
      const a = Math.trunc(c.value) & 0xffff;
      if (a >= 0xb900 && a <= 0xbdff) {
        this.report('E271', s.address.span, `CALL &${a.toString(16).toUpperCase()} is a firmware call and is not available in bare mode`);
      }
    }
    s.args.forEach((a) => {
      const t = this.expr(a);
      if (t === null) return;
      // A STRING argument is passed as the address of a 3-byte descriptor the lowering builds
      // (spec section 18, review R6).
      if (t === 'STRING') return;
      this.coerce(a, 'UINTEGER');
    });
  }

  private builtinStmt(s: Extract<Stmt, { kind: 'Builtin' }>): void {
    if (FILE_STMTS.has(s.keyword)) {
      this.fileStmt(s);
      return;
    }
    if (s.stream) {
      this.intExpr(s.stream, 'The stream');
      this.streamCheck(s.stream, s.keyword, 7, false);
    }
    if (s.keyword === 'SYMBOL AFTER') {
      const a = s.args[0];
      if (a && this.numExpr(a, 'The SYMBOL AFTER limit') !== null) {
        const c = this.constants.get(a);
        if (c === undefined || typeof c.value !== 'number' || !Number.isInteger(c.value) || c.value < 0 || c.value > 256) {
          this.report('E263', a.span, 'SYMBOL AFTER needs a constant between 0 and 256');
        } else if (this.symbolAfter !== null && this.symbolAfter !== c.value) {
          this.report('E264', a.span, `SYMBOL AFTER ${c.value} differs from the SYMBOL AFTER ${this.symbolAfter} before it`);
        } else {
          this.symbolAfter = c.value;
        }
      }
      return;
    }
    if (s.keyword === 'POKE') {
      const [addr, value] = s.args;
      const target: TypeName = s.typeArg?.name ?? 'UBYTE';
      if (target === 'STRING' && s.typeArg) this.mismatch(s.typeArg.span, 'POKE cannot store a STRING', 'Name a numeric type.');
      if (addr && this.numExpr(addr, 'The POKE address') !== null) this.coerce(addr, 'UINTEGER');
      if (value) {
        const vt = this.numExpr(value, 'The POKE value');
        if (vt !== null && target !== 'STRING') this.coerce(value, target);
      }
      return;
    }
    if (s.keyword === 'MEMORY') {
      const a = s.args[0];
      if (a && this.numExpr(a, 'The MEMORY address') !== null) {
        this.coerce(a, 'UINTEGER');
        if (!this.constants.has(a)) this.notConstant(a.span, 'The MEMORY address');
      }
      return;
    }
    const sig = STMT_SIGS[s.keyword];
    s.args.forEach((a, i) => {
      if (a === null) return;
      this.argOfKind(a, sig?.[i] ?? null, `Argument ${i + 1} of ${s.keyword}`);
    });
    this.soundStmt(s);
  }

  /**
   * L4-FILES: OPENIN, OPENOUT, CHAIN, LOAD and SAVE. The name is a string (E281 when a constant name is empty: AMSDOS
   * answers "Bad command"); an address or length that is a constant has to fit 16 bits (E280); SAVE writes a binary
   * file, so it needs `B`, an address and a length (E279: a compiled program has no BASIC text to save).
   */
  private fileStmt(s: Extract<Stmt, { kind: 'Builtin' }>): void {
    const name = s.args[0];
    if (name) {
      if (this.strExpr(name, `The file name of ${s.keyword}`) !== null) {
        const c = this.constants.get(name);
        if (c !== undefined && c.value === '') this.report('E281', name.span, `The file name of ${s.keyword} is empty`);
      }
    }
    const number = (a: Expr | null | undefined, what: string, lo: number): void => {
      if (!a) return;
      if (this.numExpr(a, what) === null) return;
      const c = this.constants.get(a);
      if (c !== undefined && typeof c.value === 'number' && (c.value < lo || c.value > 65535)) {
        this.report('E280', a.span, `${what} is ${c.value}: it must be between ${lo} and 65535`);
      }
    };
    if (s.keyword === 'LOAD') {
      number(s.args[1], 'The LOAD address', -32768);
      return;
    }
    if (s.keyword !== 'SAVE') return;
    const type = s.args[1];
    const letter = type && type.kind === 'Name' && type.suffix === null ? type.base : null;
    if (type === undefined || type === null || letter !== 'b') {
      this.report(
        'E279',
        type?.span ?? this.kwSpan(s.span, 'SAVE'),
        letter === 'a' || letter === 'p' ? `SAVE "name", ${letter.toUpperCase()} saves BASIC text, which a compiled program does not have` : 'SAVE needs the file type B and the memory to write',
        'Write SAVE "name", B, address, length [, entry].',
      );
      return;
    }
    if (s.args.length < 4 || s.args[2] == null || s.args[3] == null) {
      this.report('E279', s.span, 'SAVE "name", B needs an address and a length', 'Write SAVE "name", B, address, length [, entry].');
      return;
    }
    number(s.args[2], 'The SAVE address', -32768);
    number(s.args[3], 'The SAVE length', 0);
    number(s.args[4], 'The SAVE entry address', -32768);
  }

  /**
   * L4-SOUND: what is known at compile time about SOUND, ENV, ENT, RELEASE and BEEP. ENV and ENT
   * sections are 3 values (steps, size, pause) or `=` and 2 values, at most 5 (E273; Locomotive
   * raises Syntax error at run time); a constant that Locomotive's integer reader refuses is
   * Overflow (E274); BEEP's constants have the reference compiler's ranges (E275).
   */
  private soundStmt(s: Extract<Stmt, { kind: 'Builtin' }>): void {
    const num = (a: Expr | null | undefined): number | null => {
      const c = a === null || a === undefined ? undefined : this.constants.get(a);
      return c !== undefined && typeof c.value === 'number' ? c.value : null;
    };
    switch (s.keyword) {
      case 'SOUND':
      case 'RELEASE':
      case 'ENV':
      case 'ENT': {
        s.args.forEach((a, i) => {
          const v = num(a);
          if (a === null || v === null) return;
          const top = s.keyword === 'SOUND' && i === 2 ? 32767 : 65535;
          if (Math.round(v) < -32768 || Math.round(v) > top) this.report('E274', a.span, `${v} does not fit in 16 bits (up to ${top} here)`);
        });
        if (s.keyword === 'ENV' || s.keyword === 'ENT') {
          const hw = new Set(s.hardwareAt ?? []);
          let i = 1;
          let sections = 0;
          let ok = s.args.length > 0;
          while (ok && i < s.args.length) {
            i += hw.has(i) ? 2 : 3;
            sections++;
          }
          if (ok && (i !== s.args.length || sections > 5)) ok = false;
          if (!ok) {
            const why = sections > 5 ? 'at most 5 sections' : 'sections of 3 values, or of `=` and 2 values';
            this.report('E273', s.args[1]?.span ?? s.span, `${s.keyword} takes ${why}`);
          }
        }
        return;
      }
      case 'BEEP': {
        const [d, p] = [num(s.args[0]), num(s.args[1])];
        if (d !== null && (d < 0 || d > 10)) this.report('E275', (s.args[0] as Expr).span, `BEEP duration ${d} is not between 0 and 10 seconds`);
        if (p !== null && (Math.trunc(p) < -60 || Math.trunc(p) > 127)) this.report('E275', (s.args[1] as Expr).span, `BEEP pitch ${p} is not between -60 and 127`);
        return;
      }
    }
  }

  private argOfKind(a: Expr, kind: ArgKind | null, what: string): void {
    switch (kind) {
      case 'int':
        this.intExpr(a, what);
        return;
      case 'num':
        this.numExpr(a, what);
        return;
      case 'str':
        this.strExpr(a, what);
        return;
      case 'addr':
        if (this.numExpr(a, what) !== null) this.coerce(a, 'UINTEGER');
        return;
      case 'strOrInt': {
        const t = this.expr(a);
        if (t !== null && t !== 'STRING' && !isInteger(t)) this.coerce(a, 'INTEGER');
        return;
      }
      default:
        this.expr(a);
    }
  }

  // ---- declarations ---------------------------------------------------------------

  private dimDecl(d: DimDecl): void {
    const id = this.res.names.get(d.name);
    const sym = id !== undefined ? this.sym(id) : undefined;
    if (sym?.kind === 'array') {
      this.arrayDecl(d, sym);
      return;
    }
    for (const b of d.bounds) this.expr(b);
    if (sym?.kind !== 'variable') {
      if (d.init && d.init.kind !== 'ArrayInit') this.expr(d.init);
      if (d.at) this.expr(d.at);
      return;
    }
    if (d.init !== null && d.init.kind !== 'ArrayInit') {
      const vt = this.expr(d.init);
      if (this.assignable(d.init, vt, sym.type, `initialise ${sym.name}`)) {
        const c = this.constants.get(d.init);
        const conv = c ? convertConst(c, sym.type) : null;
        if (conv) this.initialValues.set(sym.id, [conv]);
        else if (sym.storage === 'global') this.notConstant(d.init.span, 'A global initial value');
      }
    }
    if (d.at) this.atAddress(d.at, sym.id);
  }

  private atAddress(at: Expr, id: SymbolId): void {
    const t = this.numExpr(at, 'The AT address');
    if (t === null) return;
    const c = this.constants.get(at);
    if (!c || typeof c.value !== 'number' || !Number.isInteger(c.value)) {
      this.notConstant(at.span, 'The AT address');
      return;
    }
    this.coerce(at, 'UINTEGER');
    this.atAddresses.set(id, c.value & 0xffff);
  }

  private notConstant(span: Span, what: string): void {
    this.report('E243', span, `${what} must be a constant expression`);
  }

  private arrayDecl(d: DimDecl, sym: ArraySymbol): void {
    const bounds: number[] = [];
    let good = true;
    for (const b of d.bounds) {
      const t = this.expr(b);
      const c = this.constants.get(b);
      if (t === null) {
        good = false;
        continue;
      }
      if (t === 'STRING' || !c || typeof c.value !== 'number' || !Number.isInteger(c.value) || c.value < 0) {
        this.report('E233', b.span, 'An array bound must be a non-negative integer constant');
        good = false;
        continue;
      }
      bounds.push(c.value);
    }
    if (good && bounds.length > 0) this.arrayBounds.set(sym.id, bounds);
    if (d.at) this.atAddress(d.at, sym.id);
    if (d.at !== null && d.init !== null && d.init.kind === 'ArrayInit') {
      this.report('E247', d.init.span, 'An array placed with AT cannot have an initial list', 'Placing data at an address when the program loads is what #pragma hidata is for; or fill the array with assignments or POKEs.');
    }
    if (d.init !== null && d.init.kind === 'ArrayInit') {
      const values: ConstValue[] = [];
      this.flattenInit(d.init, sym.element, values);
      if (good && bounds.length > 0) this.initShape(d.init, bounds.map((u) => u + 1), 0);
      if (good && bounds.length > 0) {
        const total = bounds.reduce((n, b) => n * (b + 1), 1);
        if (values.length > total) this.report('E246', d.init.span, `${values.length} initial values for ${total} elements`);
      }
      this.initialValues.set(sym.id, values);
    } else if (d.init !== null) {
      this.expr(d.init);
    }
  }

  /**
   * Shape of a nested initial list (follow-up 45). A list written flat (no inner lists) may be shorter
   * than the array and is padded with zeros, as before. A list with inner lists must match the
   * dimensions: every list at dimension `d` below the first has exactly `counts[d]` elements, a list of
   * lists exists only above the last dimension, and a list of numbers only at the last.
   */
  private initShape(init: ArrayInit, counts: readonly number[], depth: number): void {
    const inner = init.elements.filter((e): e is ArrayInit => e.kind === 'ArrayInit');
    if (inner.length === 0) {
      if (depth > 0 && depth < counts.length - 1 && init.elements.length > 0) {
        this.report('E246', init.span, `A list of numbers where ${counts.length - 1 - depth} more level${counts.length - 1 - depth === 1 ? '' : 's'} of lists ${counts.length - 1 - depth === 1 ? 'is' : 'are'} expected`, 'Nest one {...} per dimension, or write the whole array as one flat list.');
      }
      if (depth > 0 && init.elements.length !== counts[depth]) {
        this.report('E246', init.span, `Dimension ${depth + 1} of the list has ${init.elements.length} element${init.elements.length === 1 ? '' : 's'}, but the array has ${counts[depth]}`);
      }
      return;
    }
    if (depth >= counts.length - 1) {
      this.report('E246', init.span, `The list is nested deeper than the array's ${counts.length} dimension${counts.length === 1 ? '' : 's'}`);
      return;
    }
    if (inner.length !== init.elements.length) {
      this.report('E246', init.span, 'A list cannot mix numbers and inner lists', 'Nest one {...} per dimension, or write the whole array as one flat list.');
      return;
    }
    if (depth > 0 && init.elements.length !== counts[depth]) {
      this.report('E246', init.span, `Dimension ${depth + 1} of the list has ${init.elements.length} element${init.elements.length === 1 ? '' : 's'}, but the array has ${counts[depth]}`);
    }
    for (const e of inner) this.initShape(e, counts, depth + 1);
  }

  private flattenInit(init: ArrayInit, element: TypeName, out: ConstValue[]): void {
    for (const e of init.elements) {
      if (e.kind === 'ArrayInit') {
        this.flattenInit(e, element, out);
        continue;
      }
      const t = this.expr(e);
      if (!this.assignable(e, t, element, 'initialise an element')) continue;
      const c = this.constants.get(e);
      const conv = c ? convertConst(c, element) : null;
      if (conv) out.push(conv);
      else this.notConstant(e.span, 'An array initial value');
    }
  }

  /** The folded value of a CONST, typing its expression the first time. */
  private constOf(s: ConstSymbol): ConstValue | null {
    const cached = this.constValues.get(s.id);
    if (cached) return cached;
    if (this.constBad.has(s.id)) return null;
    if (this.constBusy.has(s.id)) {
      this.report('E243', s.span, `CONST ${s.name} is defined in terms of itself`);
      this.constBad.add(s.id);
      return null;
    }
    this.constBusy.add(s.id);
    const t = this.expr(s.value);
    this.constBusy.delete(s.id);
    if (t === null) {
      this.constBad.add(s.id);
      return null;
    }
    const c = this.constants.get(s.value);
    if (!c) {
      this.notConstant(s.value.span, `The value of CONST ${s.name}`);
      this.constBad.add(s.id);
      return null;
    }
    let result = c;
    if (s.declaredType !== null) {
      if (!this.assignable(s.value, t, s.declaredType, `give CONST ${s.name} this value`)) {
        this.constBad.add(s.id);
        return null;
      }
      result = convertConst(c, s.declaredType) ?? c;
    }
    this.constValues.set(s.id, result);
    return result;
  }

  private procedure(p: ProcedureDecl): void {
    const saved = this.ctx;
    this.ctx = { proc: p, loops: [] };
    const id = this.res.names.get(p.name);
    const psym = id !== undefined ? this.sym(id) : undefined;
    p.params.forEach((param, i) => this.paramDecl(param, psym?.kind === 'procedure' ? (psym.params[i]?.type ?? null) : null));
    this.procHasGosub = false;
    this.procBareReturns = [];
    this.stmts(p.body);
    if (!this.procHasGosub) {
      for (const span of this.procBareReturns) {
        this.report('E251', span, `RETURN alone in ${p.procKind} ${p.name.text}, which has no GOSUB`, `Leave with EXIT ${p.procKind}${p.procKind === 'FUNCTION' ? ', or RETURN a value' : ''}; a RETURN alone ends a GOSUB.`);
      }
    }
    this.ctx = saved;
  }

  private paramDecl(p: Param, type: TypeName | null): void {
    if (p.default === null) return;
    const t = this.expr(p.default);
    if (t === null) return;
    if (!this.constants.has(p.default)) {
      this.notConstant(p.default.span, `The default of ${p.name.text}`);
      return;
    }
    if (type !== null) this.assignable(p.default, t, type, `use this default for ${p.name.text}`);
  }

  private defFn(s: Extract<Stmt, { kind: 'DefFn' }>): void {
    const id = this.res.names.get(s.name);
    const sym = id !== undefined ? this.sym(id) : undefined;
    const bt = this.expr(s.body);
    if (sym?.kind === 'deffn') this.assignable(s.body, bt, sym.returnType, `define FN ${s.name.text} with this`);
  }

  // ---- lvalues ----------------------------------------------------------------------

  private lvalue(t: LValue, verb: string): TypeName | null {
    if (t.kind === 'Name') {
      const id = this.res.names.get(t);
      if (id === undefined) return null;
      const s = this.sym(id);
      switch (s.kind) {
        case 'variable':
          this.exprTypes.set(t, s.type);
          return s.type;
        case 'const':
          this.report('E232', t.span, `'${t.text}' is a CONST and cannot be changed`, 'Use a variable, or remove the assignment.');
          return null;
        case 'procedure':
          // The binder resolves a SUB or FUNCTION name written as a target outside the
          // FUNCTION's own body to the procedure and has already reported E202 there.
          return null;
        case 'deffn':
          this.report(
            'E232',
            t.span,
            `'${t.text}' is a DEF FN, not a variable`,
            'A DEF FN gets its value from its expression; assign to a variable with another name.',
          );
          return null;
        default:
          this.report('E232', t.span, `Cannot ${verb} '${t.text}'`);
          return null;
      }
    }
    const id = this.res.callOrIndex.get(t);
    if (id === undefined) {
      for (const a of t.args) this.expr(a);
      return null;
    }
    const s = this.sym(id);
    if (s.kind === 'array') {
      const et = this.element(t, s);
      this.exprTypes.set(t, et);
      return et;
    }
    for (const a of t.args) this.expr(a);
    this.report(
      'E232',
      t.span,
      `A call of '${t.callee.text}' cannot be ${verb === 'assign' ? 'assigned to' : 'read into'}`,
      'Assign to a variable or an array element.',
    );
    return null;
  }

  private element(e: CallOrIndex, a: ArraySymbol): TypeName {
    return this.indexes(e.span, e.args, a);
  }

  /** The indexes of `a(args)` or `@a(args)`: integers, one per dimension, a constant one inside the bounds (spec §8 has no run-time check). */
  private indexes(span: Span, args: readonly Expr[], a: ArraySymbol): TypeName {
    for (const idx of args) this.intExpr(idx, 'An array index');
    if (a.param === null && a.bounds.length !== args.length) {
      this.report(
        'E240',
        span,
        `'${a.name}' has ${a.bounds.length} dimension${a.bounds.length === 1 ? '' : 's'}, but ${args.length} ${args.length === 1 ? 'index is' : 'indexes are'} given`,
      );
      return a.element;
    }
    const bounds = this.arrayBounds.get(a.id);
    if (bounds !== undefined && bounds.length === args.length) {
      args.forEach((idx, i) => {
        const c = this.constants.get(idx);
        const v = c === undefined || typeof c.value !== 'number' ? null : isInteger(c.type) ? c.value : (convertConst(c, 'INTEGER')?.value ?? null);
        const upper = bounds[i] as number;
        if (typeof v === 'number' && (v < 0 || v > upper)) {
          this.report('E248', idx.span, `Index ${v} is outside the bounds of '${a.name}' (0 to ${upper}${bounds.length > 1 ? `, dimension ${i + 1}` : ''})`);
        }
      });
    }
    return a.element;
  }

  /**
   * LBOUND / UBOUND of an array whose bounds are constants: a constant. The dimension left out is
   * dimension 1; 0 is the number of dimensions; a dimension the array
   * does not have gives 0, as the runtime's `__LBOUND` / `__UBOUND` do. Every array is 0-based.
   */
  private foldBound(e: BuiltinCall, bounds: readonly number[], dim: Expr | undefined): void {
    let d = 1;
    if (dim !== undefined) {
      const c = this.constants.get(dim);
      if (c === undefined || typeof c.value !== 'number') {
        this.notConstant(dim.span, `The dimension of ${e.keyword} of an array`);
        return;
      }
      d = Math.trunc(c.value);
    }
    const value = d === 0 ? bounds.length : d < 0 || d > bounds.length ? 0 : e.keyword === 'LBOUND' ? 0 : (bounds[d - 1] as number);
    this.setConst(e, { type: 'UINTEGER', value });
  }

  // ---- expressions -------------------------------------------------------------------

  private expr(e: Expr): TypeName | null {
    const t = this.exprInner(e);
    if (t !== null) this.exprTypes.set(e, t);
    return t;
  }

  private exprInner(e: Expr): TypeName | null {
    switch (e.kind) {
      case 'NumberLit':
        return this.literal(e, false);
      case 'StringLit':
        this.setConst(e, { type: 'STRING', value: e.value });
        return 'STRING';
      case 'Name':
        return this.nameExpr(e);
      case 'Unary':
        return this.unary(e);
      case 'Binary':
        return this.binary(e);
      case 'AddressOf':
        return this.addressOf(e);
      case 'CallOrIndex':
        return this.callOrIndex(e);
      case 'BuiltinCall':
        return this.builtinCall(e);
      case 'FnCall':
        return this.fnCall(e);
      case 'BadExpr':
        return null;
    }
  }

  private literal(e: NumberLit, negated: boolean): TypeName {
    const t = literalType(e);
    if (e.suffix === '%') {
      const v = negated ? -e.value : e.value;
      if (e.radix === 10 && (v < -32768 || v > 32767)) this.report('E234', e.span, `${e.text} does not fit an INTEGER (-32768 to 32767)`);
    }
    this.setConst(e, { type: t, value: literalValue(e) });
    return t;
  }

  private nameExpr(n: Name): TypeName | null {
    const id = this.res.names.get(n);
    if (id === undefined) return null;
    const s = this.sym(id);
    switch (s.kind) {
      case 'variable':
        return s.type;
      case 'const': {
        const c = this.constOf(s);
        if (!c) return null;
        this.setConst(n, c);
        return c.type;
      }
      case 'procedure':
        return this.procCall(n.span, s, [], n.text);
      case 'array':
        this.report('E240', n.span, `'${n.text}' is an array and needs an index`, `Write ${n.text}(index), or @${n.text} for its address.`);
        return null;
      default:
        this.report('E230', n.span, `'${n.text}' cannot be used as a value`);
        return null;
    }
  }

  /** Whether `e` is a plain untyped numeric literal (or its negation) that adopts the other operand's type. */
  private adoptable(e: Expr): boolean {
    if (e.kind === 'NumberLit') return e.suffix === null && !e.isReal && this.constants.has(e);
    if (e.kind === 'Unary' && (e.op === '-' || e.op === '+')) return this.adoptable(e.operand);
    return false;
  }

  /** The common type of numeric operands: promotion, where an untyped literal that fits adopts the others' type. */
  private commonOf(exprs: readonly Expr[], types: readonly TypeName[]): TypeName {
    let t: TypeName | null = null;
    exprs.forEach((e, i) => {
      if (!this.adoptable(e)) t = t === null ? (types[i] as TypeName) : promote(t, types[i] as TypeName);
    });
    if (t === null) {
      let all: TypeName | null = null;
      for (const x of types) all = all === null ? x : promote(all, x);
      return all ?? 'INTEGER';
    }
    let result: TypeName = t;
    exprs.forEach((e, i) => {
      if (!this.adoptable(e)) return;
      const c = this.constants.get(e);
      if (c && typeof c.value === 'number' && fits(c.value, result)) return;
      result = promote(result, types[i] as TypeName);
    });
    return result;
  }

  private unary(e: UnaryExpr): TypeName | null {
    const o = e.operand;
    if (e.op === '-' && o.kind === 'NumberLit' && o.radix === 10) {
      this.exprTypes.set(o, this.literal(o, true));
      const v = -o.value;
      const t: TypeName = o.isReal || o.suffix === '!' ? 'REAL' : o.suffix === '%' ? 'INTEGER' : v >= -32768 ? 'INTEGER' : v >= -0x80000000 ? 'LONG' : 'REAL';
      this.setConst(e, { type: t, value: v });
      return t;
    }
    const ot = this.expr(o);
    if (ot === null) return null;
    if (ot === 'STRING') {
      this.mismatch(o.span, `${e.op === 'NOT' ? 'NOT' : `Unary ${e.op}`} needs a number, not a STRING`, 'Use a numeric expression.');
      return null;
    }
    let rt: TypeName = ot;
    if (e.op === 'NOT') {
      if (!isInteger(ot)) {
        this.report('W242', o.span, `A ${ot} value is converted to INTEGER for NOT`);
        rt = 'INTEGER';
      }
    } else if (e.op === '-') {
      rt = SIGNED_OF[ot] ?? ot;
    }
    if (rt !== ot) this.coerce(o, rt);
    const c = this.constants.get(o);
    if (c) {
      const cv = convertConst(c, rt);
      const f = cv ? foldUnary(e.op, cv) : null;
      if (f) this.setConst(e, f);
    }
    return rt;
  }

  private binary(e: BinaryExpr): TypeName | null {
    const { op, left, right } = e;
    const lt = this.expr(left);
    const rt = this.expr(right);
    if (lt === null || rt === null) return null;
    const ls = lt === 'STRING';
    const rs = rt === 'STRING';
    const isCmp = op === '=' || op === '<>' || op === '<' || op === '>' || op === '<=' || op === '>=';
    if (ls || rs) {
      if (ls && rs && (op === '+' || isCmp)) {
        this.foldPair(e, 'STRING');
        return isCmp ? 'INTEGER' : 'STRING';
      }
      if (ls !== rs)
        this.mismatch(e.span, `Cannot use ${op} between a ${lt} and a ${rt}`, 'Convert one side: STR$ turns a number into text, VAL turns text into a number.');
      else this.mismatch(e.span, `${op} does not work on STRINGs`, 'Only + and the comparisons work on text.');
      return null;
    }
    if (op === '^') return this.power(e);
    if (op === '<<' || op === '>>') return this.shift(e, lt, rt);

    const intOnly = op === 'AND' || op === 'OR' || op === 'XOR' || op === '\\' || op === 'MOD';
    let lt2 = lt;
    let rt2 = rt;
    if (intOnly) {
      if (!isInteger(lt)) {
        this.report('W242', left.span, `A ${lt} value is converted to INTEGER for ${op}`);
        lt2 = 'INTEGER';
      }
      if (!isInteger(rt)) {
        this.report('W242', right.span, `A ${rt} value is converted to INTEGER for ${op}`);
        rt2 = 'INTEGER';
      }
    }
    const common = this.commonOf([left, right], [lt2, rt2]);
    this.coerce(left, common);
    this.coerce(right, common);
    const result: TypeName = isCmp ? 'INTEGER' : common;
    if (op === '/' || op === '\\' || op === 'MOD') {
      const c = this.constants.get(right);
      if (c && typeof c.value === 'number' && c.value === 0) {
        this.report('E235', right.span, `Division by zero in ${op === '/' ? 'a division' : op}`);
        return result;
      }
    }
    this.foldPair(e, common);
    return result;
  }

  /** Folds `e` when both operands are constants; both are converted to `opType` first. */
  private foldPair(e: BinaryExpr, opType: TypeName): void {
    const a = this.constants.get(e.left);
    const b = this.constants.get(e.right);
    if (!a || !b) return;
    const x = convertConst(a, opType);
    const y = convertConst(b, opType);
    if (!x || !y) return;
    const f = foldBinary(e.op, x, y, opType);
    if (f !== null && f !== 'div0') this.setConst(e, f);
  }

  private power(e: BinaryExpr): TypeName {
    const a = this.constants.get(e.left);
    const b = this.constants.get(e.right);
    this.coerce(e.left, 'REAL');
    this.coerce(e.right, 'REAL');
    if (a && b) {
      const x = convertConst(a, 'REAL');
      const y = convertConst(b, 'REAL');
      const f = x && y ? foldBinary('^', x, y, 'REAL') : null;
      if (f !== null && f !== 'div0') this.setConst(e, f);
    }
    return 'REAL';
  }

  private shift(e: BinaryExpr, lt: TypeName, rt: TypeName): TypeName {
    let lt2 = lt;
    if (!isInteger(lt)) {
      this.report('W242', e.left.span, `A ${lt} value is converted to INTEGER for ${e.op}`);
      lt2 = 'INTEGER';
      this.coerce(e.left, lt2);
    }
    if (!isInteger(rt)) {
      this.report('W242', e.right.span, `A ${rt} value is converted to INTEGER for ${e.op}`);
      this.coerce(e.right, 'INTEGER');
    }
    const a = this.constants.get(e.left);
    const b = this.constants.get(e.right);
    if (a && b) {
      const x = convertConst(a, lt2);
      const y = convertConst(b, 'INTEGER');
      const f = x && y ? foldBinary(e.op, x, y, lt2) : null;
      if (f !== null && f !== 'div0') this.setConst(e, f);
    }
    return lt2;
  }

  private addressOf(e: Extract<Expr, { kind: 'AddressOf' }>): TypeName {
    const id = this.res.names.get(e.target);
    const s = id !== undefined ? this.sym(id) : undefined;
    if (s?.kind === 'const') this.report('E232', e.target.span, `'${e.target.text}' is a CONST and has no address`, 'Use a variable.');
    if (e.index !== undefined) {
      if (s?.kind === 'array') this.indexes(e.span, e.index, s);
      else for (const a of e.index) this.expr(a);
    }
    return 'UINTEGER';
  }

  private callOrIndex(e: CallOrIndex): TypeName | null {
    const id = this.res.callOrIndex.get(e);
    if (id === undefined) {
      for (const a of e.args) this.expr(a);
      return null;
    }
    const s = this.sym(id);
    if (s.kind === 'array') return this.element(e, s);
    if (s.kind === 'procedure') return this.procCall(e.span, s, e.args, e.callee.text);
    for (const a of e.args) this.expr(a);
    return null;
  }

  private fnCall(e: FnCall): TypeName | null {
    const id = this.res.fnCalls.get(e);
    if (id === undefined) {
      for (const a of e.args) this.expr(a);
      return null;
    }
    const s = this.sym(id) as DefFnSymbol;
    if (e.args.length !== s.params.length) {
      this.report('E231', e.span, `FN ${e.name.text} takes ${s.params.length} argument${s.params.length === 1 ? '' : 's'}, not ${e.args.length}`);
    }
    e.args.forEach((a, i) => {
      const t = this.expr(a);
      const pid = s.params[i];
      const p = pid !== undefined ? this.sym(pid) : undefined;
      if (p?.kind === 'variable') this.assignable(a, t, p.type, `pass this to ${p.name} of FN ${e.name.text}`);
    });
    return s.returnType;
  }

  /** A call of a SUB or FUNCTION used as a value (a FUNCTION; a SUB is E239). */
  private procCall(span: Span, s: ProcedureSymbol, args: readonly Expr[], name: string): TypeName | null {
    this.procArgs(span, s, args, name);
    if (s.procKind === 'SUB' || s.returnType === null) {
      this.report('E239', span, `'${name}' is a SUB and has no value`, `Call it as a statement: ${name} ..., or make it a FUNCTION.`);
      return null;
    }
    return s.returnType;
  }

  private subCall(s: SubCallStmt): void {
    const id = this.res.subCalls.get(s);
    if (id === undefined) {
      for (const a of s.args) this.expr(a);
      return;
    }
    const p = this.sym(id) as ProcedureSymbol;
    this.procArgs(s.span, p, s.args, s.name.text);
    if (p.procKind === 'FUNCTION') {
      this.report(
        'E239',
        s.name.span,
        `'${s.name.text}' is a FUNCTION and its value is discarded`,
        `Use the value: x = ${s.name.text}(...), or turn it into a SUB.`,
      );
    }
  }

  private procArgs(span: Span, p: ProcedureSymbol, args: readonly Expr[], name: string): void {
    let required = 0;
    p.params.forEach((q, i) => {
      if (q.default === null) required = i + 1;
    });
    if (args.length < required || args.length > p.params.length) {
      const want = required === p.params.length ? `${required}` : `${required} to ${p.params.length}`;
      this.report('E231', span, `${name} takes ${want} argument${want === '1' ? '' : 's'}, not ${args.length}`);
    }
    args.forEach((a, i) => {
      const q = p.params[i];
      if (q?.isArray) {
        const id = a.kind === 'Name' ? this.res.names.get(a) : undefined;
        const arr = id !== undefined ? this.sym(id) : undefined;
        if (arr?.kind !== 'array' || arr.element !== q.type) this.report('E236', a.span, `Argument ${i + 1} of ${name} must be an array of ${q.type}`);
        return;
      }
      const t = this.expr(a);
      if (!q || t === null) return;
      if (q.byref) {
        const id = a.kind === 'Name' ? this.res.names.get(a) : a.kind === 'CallOrIndex' ? this.res.callOrIndex.get(a) : undefined;
        const target = id !== undefined ? this.sym(id) : undefined;
        const ok = (target?.kind === 'variable' && a.kind === 'Name') || (target?.kind === 'array' && a.kind === 'CallOrIndex');
        if (!ok) this.report('E236', a.span, `Argument ${i + 1} of ${name} is BYREF and must be a variable or array element`);
        else if (t !== q.type) this.report('E236', a.span, `Argument ${i + 1} of ${name} is BYREF ${q.type}, but this is a ${t}`);
        return;
      }
      this.assignable(a, t, q.type, `pass this as argument ${i + 1} of ${name}`);
    });
  }

  // ---- built-in functions --------------------------------------------------------------

  private builtinCall(e: BuiltinCall): TypeName | null {
    const entry = keywordOf(e.keyword, 'function');
    const kw = this.kwSpan(e.span, e.keyword);
    if (this.bare && entry?.status === 'firmware') {
      this.report('E270', kw, `${e.keyword} needs the firmware and is not available in bare mode`, entry.note ?? undefined);
    } else if (this.options.subset) {
      if (!SUBSET_FUNCTIONS.has(e.keyword) && e.keyword !== 'TAB' && e.keyword !== 'SPC') this.gate(kw, e.keyword);
    }
    if (e.stream) {
      this.intExpr(e.stream, 'The stream');
      this.streamCheck(e.stream, e.keyword, e.keyword === 'POS' ? 8 : 7, e.keyword === 'POS');
    }
    const args = e.args;
    const sig = FN_SIGS[e.keyword];
    switch (e.keyword) {
      case 'PEEK': {
        const a = args[0];
        if (a && this.numExpr(a, 'The PEEK address') !== null) this.coerce(a, 'UINTEGER');
        if (e.typeArg?.name === 'STRING') this.mismatch(e.typeArg.span, 'PEEK cannot read a STRING', 'Name a numeric type.');
        return e.typeArg && e.typeArg.name !== 'STRING' ? e.typeArg.name : 'UBYTE';
      }
      case 'CAST': {
        const a = args[0];
        const to = e.typeArg?.name;
        if (!a || !to) return null;
        const t = this.expr(a);
        if (t === null) return null;
        if ((t === 'STRING') !== (to === 'STRING')) {
          this.mismatch(
            a.span,
            `CAST cannot convert a ${t} to ${to}`,
            t === 'STRING' ? 'Use VAL to turn text into a number.' : 'Use STR$ to turn a number into text.',
          );
          return null;
        }
        const c = this.constants.get(a);
        const conv = c ? convertConst(c, to) : null;
        if (conv) this.setConst(e, conv);
        return to;
      }
      case 'SIZEOF': {
        if (e.typeArg) {
          this.setConst(e, { type: 'UINTEGER', value: sizeOf(e.typeArg.name) });
        } else if (args[0]) {
          const a = args[0];
          const t = this.expr(a);
          const id = a.kind === 'Name' ? this.res.names.get(a) : undefined;
          const s = id !== undefined ? this.sym(id) : undefined;
          if (t !== null && s?.kind === 'variable') this.setConst(e, { type: 'UINTEGER', value: sizeOf(t) });
        }
        return 'UINTEGER';
      }
      case 'LBOUND':
      case 'UBOUND': {
        // The array argument is a bare name the binder resolved to the array: it has no value of its own.
        const [arr, dim] = args;
        const id = arr?.kind === 'Name' ? this.res.names.get(arr) : undefined;
        if (arr && (id === undefined || this.sym(id).kind !== 'array')) this.expr(arr);
        if (dim) this.intExpr(dim, 'The dimension');
        const sym = id !== undefined ? this.sym(id) : undefined;
        const bounds = sym?.kind === 'array' ? this.arrayBounds.get(sym.id) : undefined;
        if (bounds !== undefined) this.foldBound(e, bounds, dim);
        return 'UINTEGER';
      }
      case 'MIN':
      case 'MAX': {
        const types = args.map((a) => this.numExpr(a, `Each ${e.keyword} argument`));
        if (types.some((t) => t === null)) return null;
        const common = this.commonOf(args, types as TypeName[]);
        for (const a of args) this.coerce(a, common);
        this.foldBuiltin(e, common);
        return common;
      }
      case 'ABS':
      case 'INT':
      case 'FIX': {
        const a = args[0];
        if (!a) return null;
        const t = this.numExpr(a, `The ${e.keyword} argument`);
        if (e.keyword === 'ABS' && t !== null) this.foldBuiltin(e, t);
        return t;
      }
      case 'ROUND': {
        // a REAL result for every argument type; n may be a REAL (the interpreter rounds it)
        const a = args[0];
        if (!a) return null;
        const t = this.numExpr(a, 'The ROUND argument');
        if (args[1]) this.numExpr(args[1], 'The number of places');
        return t === null ? null : 'REAL';
      }
      default:
        args.forEach((a, i) => {
          const kind = sig ? (sig[Math.min(i, sig.length - 1)] ?? null) : null;
          this.argOfKind(a, kind, `Argument ${i + 1} of ${e.keyword}`);
        });
    }
    const r = entry?.returns;
    if (r === undefined) return null;
    if (r === 'numeric') {
      const a = args[0];
      return a ? (this.exprTypes.get(a) ?? null) : null;
    }
    if (r === 'cast') return e.typeArg?.name ?? null;
    this.foldBuiltin(e, r);
    return r;
  }

  /** Gives a built-in call of constant arguments its constant value (CONST k = ABS(-3)); see `foldBuiltin`. */
  private foldBuiltin(e: BuiltinCall, rt: TypeName): void {
    const cs = e.args.map((a) => this.constants.get(a));
    if (cs.length === 0 || cs.some((c) => c === undefined)) return;
    const f = foldBuiltin(e.keyword, cs as ConstValue[], rt);
    if (f) this.setConst(e, f);
  }
}
