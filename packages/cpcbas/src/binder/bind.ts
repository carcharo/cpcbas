/**
 * The binder proper: scopes, symbols, implicit declarations and resolutions.
 * Contract: sem/model.ts.
 */
import type {
  CallOrIndex,
  DefFnStmt,
  DimDecl,
  Expr,
  FnCall,
  ForStmt,
  JumpTarget,
  LValue,
  Name,
  Node,
  Param,
  ProcedureDecl,
  Program,
  SubCallStmt,
} from '../ast/ast.js';
import { children } from '../ast/walk.js';
import { FIRMWARE } from '../lang/firmware.gen.js';
import type { DiagnosticBag, DiagnosticCode } from '../core/diagnostics.js';
import type { Span } from '../core/source.js';
import {
  asScopeId,
  asSymbolId,
  globalLabel,
  identityKey,
  lineLabel,
  typeKey,
  type ArraySymbol,
  type BindInput,
  type BoundProgram,
  type ConstSymbol,
  type DefFnSymbol,
  type LabelSymbol,
  type ParamInfo,
  type ProcedureSymbol,
  type Scope,
  type ScopeId,
  type SemSymbol,
  type SymbolId,
  type VariableSymbol,
} from '../sem/model.js';
import { suffixType, type TypeName } from '../sem/types.js';
import { collect, type Collected } from './collect.js';
import { defaultType, editDistance, INITIAL_STATE, type BindState } from './state.js';

type Mut<T> = { -readonly [K in keyof T]: T[K] };
type MVar = Mut<VariableSymbol>;
type MProc = Mut<ProcedureSymbol>;

interface MScope {
  readonly id: ScopeId;
  readonly kind: 'global' | 'procedure';
  readonly owner: SymbolId | null;
  readonly parent: ScopeId | null;
  readonly names: Map<string, SymbolId>;
  readonly arrays: Map<string, SymbolId>;
  readonly procedures: Map<string, SymbolId>;
  /** Bases whose bare entry in `names` was set by a declaration (DIM, CONST, parameter), as opposed to recorded for an implicit use. */
  readonly stickyBare: Set<string>;
  /** The type each first letter was last used with unsuffixed by default, for W302. */
  readonly letterUse: Map<string, TypeName>;
  /** DEF FN scopes: names that are not parameters are globals. */
  readonly implicitGlobal: boolean;
}

type Access = 'read' | 'write' | 'rw' | 'addr';

const fmtType = (t: TypeName): string => t;

export function bindProgram(input: BindInput): BoundProgram {
  return new Binder(input).run();
}

class Binder {
  private readonly diag: DiagnosticBag;
  private readonly program: Program;
  private readonly c: Collected;
  private readonly symbols: SemSymbol[] = [];
  private readonly scopes: MScope[] = [];
  private readonly global: MScope;
  private cur: MScope;
  private curOwner: SymbolId | null = null;
  private state: BindState = INITIAL_STATE;
  private readonly res = {
    names: new Map<Name, SymbolId>(),
    callOrIndex: new Map<CallOrIndex, SymbolId>(),
    fnCalls: new Map<FnCall, SymbolId>(),
    subCalls: new Map<SubCallStmt, SymbolId>(),
    targets: new Map<JumpTarget, SymbolId>(),
    forVars: new Map<ForStmt, SymbolId>(),
  };
  private readonly globalIds: SymbolId[] = [];
  private readonly locals = new Map<SymbolId, SymbolId[]>();
  private readonly procIds = new Map<ProcedureDecl | DefFnStmt, SymbolId>();
  private readonly procScopes = new Map<ProcedureDecl | DefFnStmt, MScope>();
  private readonly labelMap = new Map<string, SymbolId>();
  private readonly labelData = new Map<SymbolId, number>();
  private readonly restoreIndex = new Map<JumpTarget, number>();
  private readonly firstRead = new Map<SymbolId, Span>();
  /** The suffix a variable was first written with (`x!`), for diagnostics. */
  private readonly suffixes = new Map<SymbolId, string>();
  /** Asm labels handed out to globals, to keep two identities of one user name apart. */
  private readonly labelsInUse = new Map<string, SymbolId>();
  /** The shared built-in constant of each firmware entry used so far (upper-case name to symbol). */
  private readonly firmwareConsts = new Map<string, SymbolId>();
  /** Procedures that lost the E202 duplicate check: they own no label. */
  private readonly duplicates = new Set<SymbolId>();

  constructor(private readonly input: BindInput) {
    this.diag = input.diagnostics;
    this.program = input.program;
    this.c = collect(input.program, input.diagnostics);
    this.global = this.newScope('global', null);
    this.cur = this.global;
  }

  // ---- infrastructure ------------------------------------------------------

  private report(code: DiagnosticCode, span: Span, message: string, hint?: string, related?: Array<{ span: Span; message: string }>): void {
    this.diag.report(code, span, message, hint, related);
  }

  private newScope(kind: 'global' | 'procedure', owner: SymbolId | null, implicitGlobal = false): MScope {
    const s: MScope = {
      id: asScopeId(this.scopes.length),
      kind,
      owner,
      parent: kind === 'global' ? null : asScopeId(0),
      names: new Map(),
      arrays: new Map(),
      procedures: new Map(),
      stickyBare: new Set(),
      letterUse: new Map(),
      implicitGlobal,
    };
    this.scopes.push(s);
    return s;
  }

  private nextId(): SymbolId {
    return asSymbolId(this.symbols.length);
  }

  private sym(id: SymbolId): SemSymbol {
    return this.symbols[id] as SemSymbol;
  }

  private enter(node: Node): void {
    const st = this.c.stateAt.get(node);
    if (st) this.state = st;
  }

  private defType(base: string): TypeName {
    return defaultType(this.state, base);
  }

  // ---- driver --------------------------------------------------------------

  run(): BoundProgram {
    this.declareProcedures();
    this.checkDeclares();
    this.declareLabels();
    this.state = INITIAL_STATE;
    const mainStmts = this.program.body.filter((s) => s.kind !== 'Procedure' && s.kind !== 'DefFn' && s.kind !== 'Declare');
    this.cur = this.global;
    this.hoist(mainStmts);
    this.state = INITIAL_STATE;
    for (const s of mainStmts) this.visit(s);
    for (const decl of this.c.procLikes) this.bindBody(decl);
    this.cur = this.global;
    this.checkAsmLabels();
    this.reportUnassigned();
    return this.finish();
  }

  private finish(): BoundProgram {
    const scopes: Scope[] = this.scopes.map((s) => ({
      id: s.id,
      kind: s.kind,
      owner: s.owner,
      parent: s.parent,
      names: s.names,
      arrays: s.arrays,
      procedures: s.procedures,
    }));
    const owners = (o: ProcedureDecl | null): SymbolId | null => (o === null ? null : (this.procIds.get(o) ?? null));
    return {
      program: this.program,
      symbols: this.symbols,
      scopes,
      globalScope: this.global.id,
      resolutions: this.res,
      procedures: this.c.procLikes.map((d) => this.procIds.get(d) as SymbolId),
      globals: this.globalIds,
      locals: this.locals,
      data: { items: this.c.data, restoreIndex: this.restoreIndex },
      requires: this.c.requires.map((r) => ({ path: r.path, span: r.span, owner: owners(r.owner) })),
      inits: this.c.inits,
      settings: this.c.settings,
      hidataAt: this.c.hidataAt,
      bareMetal: this.input.bareMetal,
    };
  }

  // ---- procedures and DEF FNs ---------------------------------------------

  private declareProcedures(): void {
    for (const decl of this.c.procLikes) {
      this.state = this.c.stateAt.get(decl) ?? this.state;
      if (decl.kind === 'Procedure') this.declareProcedure(decl);
      else this.declareDefFn(decl);
    }
  }

  /** A DECLARE needs a definition of the same kind and name (W305), and must agree with it (E213). */
  private checkDeclares(): void {
    for (const d of this.c.declares) {
      const def = this.c.procLikes.find((p): p is ProcedureDecl => p.kind === 'Procedure' && p.procKind === d.procKind && p.name.base === d.name.base);
      const id = def === undefined ? undefined : this.procIds.get(def);
      if (id === undefined) {
        this.report('W305', d.span, `DECLARE ${d.procKind} ${d.name.text} has no ${d.procKind} ${d.name.text} to declare`);
        continue;
      }
      const proc = this.sym(id) as ProcedureSymbol;
      this.state = this.c.stateAt.get(d) ?? this.state;
      const typeOf = (n: Name, ref: { name: TypeName } | null): TypeName => ref?.name ?? (n.suffix !== null ? suffixType(n.suffix) : this.defType(n.base));
      let why: string | null = null;
      if (d.params.length !== proc.params.length) why = `it has ${d.params.length} parameter${d.params.length === 1 ? '' : 's'}, the definition ${proc.params.length}`;
      else {
        d.params.forEach((p, i) => {
          const q = proc.params[i] as ParamInfo;
          if (why !== null) return;
          if (typeOf(p.name, p.type) !== q.type) why = `parameter ${i + 1} is ${typeOf(p.name, p.type)}, in the definition ${q.type}`;
          else if ((p.passing === 'BYREF') !== q.byref) why = `parameter ${i + 1} is ${p.passing === 'BYREF' ? 'BYREF' : 'BYVAL'}, in the definition ${q.byref ? 'BYREF' : 'BYVAL'}`;
          else if (p.isArray !== q.isArray) why = `parameter ${i + 1} is ${p.isArray ? 'an array' : 'not an array'}, in the definition ${q.isArray ? 'an array' : 'not an array'}`;
        });
        if (why === null && d.procKind === 'FUNCTION' && proc.returnType !== null && typeOf(d.name, d.returnType) !== proc.returnType) {
          why = `the result is ${typeOf(d.name, d.returnType)}, in the definition ${proc.returnType}`;
        }
      }
      if (why !== null) {
        this.report('E213', d.span, `DECLARE ${d.procKind} ${d.name.text} does not match its definition: ${why}`, 'Make the DECLARE the same as the definition.', [{ span: proc.span, message: 'defined here' }]);
      }
    }
  }

  private registerProcedure(base: string, name: Name, id: SymbolId): void {
    const existing = this.global.procedures.get(base);
    if (existing !== undefined) {
      this.duplicates.add(id);
      const first = this.sym(existing);
      this.report('E202', name.span, `'${name.text}' is already declared as a ${this.describe(first)}`, 'SUBs, FUNCTIONs and DEF FNs share one namespace; rename one.', [
        { span: first.span, message: 'first declared here' },
      ]);
      return;
    }
    this.global.procedures.set(base, id);
  }

  private describe(s: SemSymbol): string {
    switch (s.kind) {
      case 'procedure':
        return s.procKind;
      case 'deffn':
        return 'DEF FN';
      case 'variable':
        return 'variable';
      case 'array':
        return 'array';
      case 'const':
        return 'CONST';
      case 'label':
        return 'label';
    }
  }

  private declareProcedure(decl: ProcedureDecl): void {
    this.warnShadow(decl.name);
    const id = this.nextId();
    const scope = this.newScope('procedure', id);
    const isFn = decl.procKind === 'FUNCTION';
    const retType: TypeName | null = isFn ? this.typeOfDecl(decl.name, decl.returnType) : null;
    const proc: MProc = {
      kind: 'procedure',
      id,
      name: decl.name.text,
      base: decl.name.base,
      scope: this.global.id,
      span: decl.name.span,
      procKind: decl.procKind,
      params: [],
      returnType: retType,
      convention: decl.convention ?? 'STDCALL',
      bodyScope: scope.id,
      decl,
      declares: this.c.declares.filter((d) => d.procKind === decl.procKind && d.name.base === decl.name.base),
      resultVar: null,
      label: `_${decl.name.text}`,
    };
    this.symbols.push(proc);
    this.procIds.set(decl, id);
    this.procScopes.set(decl, scope);
    this.res.names.set(decl.name, id);
    this.registerProcedure(decl.name.base, decl.name, id);
    const locals: SymbolId[] = [];
    this.locals.set(id, locals);
    this.cur = scope;
    if (isFn && retType !== null) {
      const rid = this.nextId();
      const rv: MVar = {
        kind: 'variable',
        id: rid,
        name: decl.name.text,
        base: decl.name.base,
        scope: scope.id,
        span: decl.name.span,
        type: retType,
        typeKey: typeKey(retType),
        storage: 'local',
        declaredBy: 'result',
        decl: null,
        param: null,
        label: null,
        assigned: false,
        read: false,
      };
      this.symbols.push(rv);
      scope.names.set(identityKey(rv.base, rv.typeKey), rid);
      scope.names.set(rv.base, rid);
      scope.stickyBare.add(rv.base);
      proc.resultVar = rid;
      locals.push(rid);
    }
    const infos: ParamInfo[] = [];
    decl.params.forEach((p, index) => {
      const info = this.declareParam(p, index, scope);
      if (info) infos.push(info);
    });
    proc.params = infos;
    this.cur = this.global;
  }

  private declareParam(p: Param, index: number, scope: MScope): ParamInfo | null {
    const type = this.typeOfDecl(p.name, p.type);
    const key = identityKey(p.name.base, typeKey(type));
    const table = p.isArray ? scope.arrays : scope.names;
    const dupId = table.get(key) ?? (p.name.suffix === null ? table.get(p.name.base) : undefined);
    if (dupId !== undefined) {
      this.report('E202', p.name.span, `Parameter '${p.name.text}' is already declared in this procedure`, 'Give each parameter its own name.', [
        { span: this.sym(dupId).span, message: 'first declared here' },
      ]);
      return null;
    }
    this.warnShadow(p.name);
    const id = this.nextId();
    const byref = p.passing === 'BYREF';
    if (p.isArray) {
      const a: Mut<ArraySymbol> = {
        kind: 'array',
        id,
        name: p.name.text,
        base: p.name.base,
        scope: scope.id,
        span: p.span,
        element: type,
        typeKey: typeKey(type),
        storage: 'param',
        decl: null,
        bounds: [],
        init: null,
        param: { index, node: p },
        label: null,
      };
      this.symbols.push(a);
    } else {
      const v: MVar = {
        kind: 'variable',
        id,
        name: p.name.text,
        base: p.name.base,
        scope: scope.id,
        span: p.span,
        type,
        typeKey: typeKey(type),
        storage: 'param',
        declaredBy: 'param',
        decl: null,
        param: { index, byref, node: p },
        label: null,
        assigned: false,
        read: false,
      };
      this.symbols.push(v);
    }
    table.set(key, id);
    if (p.name.suffix === null) {
      table.set(p.name.base, id);
      if (!p.isArray) scope.stickyBare.add(p.name.base);
    }
    this.res.names.set(p.name, id);
    return { symbol: id, type, byref, isArray: p.isArray, default: p.default };
  }

  private declareDefFn(decl: DefFnStmt): void {
    const id = this.nextId();
    const scope = this.newScope('procedure', id, true);
    const retType = decl.name.suffix ? suffixType(decl.name.suffix) : this.defType(decl.name.base);
    const params: SymbolId[] = [];
    const def: Mut<DefFnSymbol> = {
      kind: 'deffn',
      id,
      name: decl.name.text,
      base: decl.name.base,
      scope: this.global.id,
      span: decl.name.span,
      params,
      returnType: retType,
      bodyScope: scope.id,
      decl,
      label: `_FN__${decl.name.text}`,
    };
    this.symbols.push(def);
    this.procIds.set(decl, id);
    this.procScopes.set(decl, scope);
    this.res.names.set(decl.name, id);
    this.registerProcedure(decl.name.base, decl.name, id);
    this.locals.set(id, []);
    decl.params.forEach((p, index) => {
      const type = p.suffix ? suffixType(p.suffix) : this.defType(p.base);
      const key = identityKey(p.base, typeKey(type));
      const dup = scope.names.get(key);
      if (dup !== undefined) {
        this.report('E202', p.span, `Parameter '${p.text}' is already declared in this DEF FN`, 'Give each parameter its own name.', [{ span: this.sym(dup).span, message: 'first declared here' }]);
        return;
      }
      const pid = this.nextId();
      const v: MVar = {
        kind: 'variable',
        id: pid,
        name: p.text,
        base: p.base,
        scope: scope.id,
        span: p.span,
        type,
        typeKey: typeKey(type),
        storage: 'param',
        declaredBy: 'param',
        decl: null,
        param: { index, byref: false, node: p },
        label: null,
        assigned: false,
        read: false,
      };
      this.symbols.push(v);
      scope.names.set(key, pid);
      if (!p.suffix) {
        scope.names.set(p.base, pid);
        scope.stickyBare.add(p.base);
      }
      this.res.names.set(p, pid);
      params.push(pid);
    });
  }

  private bindBody(decl: ProcedureDecl | DefFnStmt): void {
    const scope = this.procScopes.get(decl) as MScope;
    this.cur = scope;
    this.curOwner = this.procIds.get(decl) ?? null;
    this.state = this.c.stateAt.get(decl) ?? this.state;
    if (decl.kind === 'Procedure') {
      for (const p of decl.params) if (p.default) this.visit(p.default);
      this.hoist(decl.body);
      for (const s of decl.body) this.visit(s);
    } else {
      this.visit(decl.body);
    }
    this.cur = this.global;
    this.curOwner = null;
  }

  // ---- labels --------------------------------------------------------------

  private declareLabels(): void {
    for (const l of this.c.labels) {
      const n = l.node;
      const key = n.number !== null ? `#${n.number}` : (n.key as string);
      const existing = this.labelMap.get(key);
      if (existing !== undefined) {
        // A repeated line number is the parser's E145 (with the first line as related
        // information); the binder keeps the first and reports only repeated named labels.
        if (n.number === null) {
          this.report('E201', n.span, `Label '${n.name}' is defined twice`, 'Labels must be unique in the whole program; rename one.', [{ span: this.sym(existing).span, message: 'first defined here' }]);
        }
        continue;
      }
      const id = this.nextId();
      const owner = l.owner === null ? null : (this.procIds.get(l.owner) ?? null);
      const sym: Mut<LabelSymbol> = {
        kind: 'label',
        id,
        name: n.number !== null ? String(n.number) : (n.name as string),
        base: n.number !== null ? String(n.number) : (n.key as string),
        scope: this.global.id,
        span: n.span,
        number: n.number,
        node: n,
        owner,
        label: lineLabel(n),
      };
      this.symbols.push(sym);
      this.labelMap.set(key, id);
      this.labelData.set(id, l.dataIndex);
    }
  }

  /**
   * Resolves a jump target. `handler` (ON ERROR GOTO, RESUME, EVERY, AFTER; L4-ERR): the statement may stand
   * anywhere, but the target must be a label of the main program (the handler runs as main-program code), E214.
   */
  private jump(target: JumpTarget, kind: 'jump' | 'restore' | 'handler'): void {
    const key = target.kind === 'LineTarget' ? `#${target.number}` : target.key;
    const id = this.labelMap.get(key);
    if (id === undefined) {
      const hint = this.nearestHint(target);
      const msg = target.kind === 'LineTarget' ? `Line ${target.number} does not exist` : `Label '${target.name}' is not defined`;
      this.report('E200', target.span, msg, hint);
      return;
    }
    this.res.targets.set(target, id);
    const label = this.sym(id) as LabelSymbol;
    if (kind === 'restore') {
      this.restoreIndex.set(target, this.labelData.get(id) as number);
      return;
    }
    if (kind === 'handler') {
      if (label.owner !== null) {
        const what = target.kind === 'LineTarget' ? `line ${target.number}` : `label '${target.name}'`;
        this.report(
          'E214',
          target.span,
          `This handler target is ${what}, which is inside '${this.sym(label.owner).name}'`,
          'The target of ON ERROR GOTO, RESUME, EVERY and AFTER must be a line or label of the main program.',
          [{ span: label.span, message: 'defined here' }],
        );
      }
      return;
    }
    if (label.owner !== this.curOwner) {
      const into = label.owner !== null;
      const procName = this.sym((into ? label.owner : this.curOwner) as SymbolId).name;
      const what = target.kind === 'LineTarget' ? `line ${target.number}` : `label '${target.name}'`;
      this.report(
        'E207',
        target.span,
        into ? `This jump goes to ${what}, which is inside '${procName}'` : `This jump goes to ${what}, which is outside '${procName}'`,
        'GOTO and GOSUB must stay inside the main program or inside one procedure. Call a SUB, or move the label into this body.',
        [{ span: label.span, message: 'defined here' }],
      );
    }
  }

  private nearestHint(target: JumpTarget): string {
    if (target.kind === 'LineTarget') {
      let best: number | null = null;
      for (const key of this.labelMap.keys()) {
        if (!key.startsWith('#')) continue;
        const n = Number(key.slice(1));
        if (best === null || Math.abs(n - target.number) < Math.abs(best - target.number) || (Math.abs(n - target.number) === Math.abs(best - target.number) && n < best)) best = n;
      }
      return best === null ? `Add a line ${target.number}, or fix the number in the jump.` : `The nearest existing line is ${best}. Add line ${target.number} or change the jump.`;
    }
    let best: string | null = null;
    let bestD = 3;
    for (const key of this.labelMap.keys()) {
      if (key.startsWith('#')) continue;
      const d = editDistance(key, target.key);
      if (d < bestD) {
        best = key;
        bestD = d;
      }
    }
    return best === null ? `Define it with '${target.name}:' at the start of a line.` : `Did you mean '${best}'?`;
  }

  // ---- declarations (DIM, CONST) --------------------------------------------

  /** Declares the DIMs and CONSTs of a body before its statements are walked, so a use above a DIM still sees it. */
  private hoist(stmts: readonly Node[]): void {
    for (const s of stmts) this.hoistNode(s);
  }

  private hoistNode(node: Node): void {
    if (node.kind === 'Procedure') return;
    if (node.kind === 'Dim') {
      for (const d of node.decls) {
        this.enter(d);
        this.declareDim(d);
      }
      return;
    }
    if (node.kind === 'Const') {
      this.enter(node);
      this.declareConst(node);
      return;
    }
    for (const ch of children(node)) this.hoistNode(ch);
  }

  /** The type of a declared name: AS type, else suffix, else the default for its letter. */
  private typeOfDecl(name: Name, ref: { name: TypeName } | null): TypeName {
    if (name.suffix !== null && ref !== null && suffixType(name.suffix) !== ref.name) {
      this.report('E203', name.span, `'${name.text}${name.suffix}' ends in ${name.suffix} (${fmtType(suffixType(name.suffix))}) but is declared AS ${ref.name}`, `Remove the ${name.suffix}, or write AS ${suffixType(name.suffix)}.`);
    }
    if (ref !== null) return ref.name;
    if (name.suffix !== null) return suffixType(name.suffix);
    return this.defType(name.base);
  }

  private declareDim(d: DimDecl): void {
    const n = d.name;
    const scope = this.cur;
    const type = this.typeOfDecl(n, d.type);
    const key = identityKey(n.base, typeKey(type));
    const isGlobal = scope.kind === 'global';
    if (d.bounds.length > 0) {
      if (d.bounds.length > 4) this.report('E209', n.span, `'${n.text}' has ${d.bounds.length} dimensions; the most is 4`);
      const fn = this.global.procedures.get(n.base);
      if (fn !== undefined && (this.sym(fn) as ProcedureSymbol).procKind === 'FUNCTION') {
        this.report('E208', n.span, `'${n.text}' is both a FUNCTION and an array`, `Rename the array or the FUNCTION; both would be written ${n.text}(...).`, [{ span: this.sym(fn).span, message: 'FUNCTION declared here' }]);
      }
      const dup = scope.arrays.get(key) ?? (n.suffix === null && scope.arrays.has(n.base) ? scope.arrays.get(n.base) : undefined);
      if (dup !== undefined) {
        this.report('E202', n.span, `Array '${n.text}' is already declared`, 'Remove one DIM, or give the arrays different names.', [{ span: this.sym(dup).span, message: 'first declared here' }]);
        return;
      }
      this.warnShadow(n);
      const id = this.nextId();
      const a: Mut<ArraySymbol> = {
        kind: 'array',
        id,
        name: n.text,
        base: n.base,
        scope: scope.id,
        span: n.span,
        element: type,
        typeKey: typeKey(type),
        storage: isGlobal ? 'global' : 'local',
        decl: d,
        bounds: d.bounds,
        init: d.init !== null && d.init.kind === 'ArrayInit' ? d.init : null,
        param: null,
        label: isGlobal ? this.allocLabel(id, n, typeKey(type), true) : null,
      };
      this.symbols.push(a);
      scope.arrays.set(key, id);
      if (n.suffix === null) scope.arrays.set(n.base, id);
      this.res.names.set(n, id);
      this.track(id, isGlobal);
      return;
    }
    const dup = scope.names.get(key) ?? (n.suffix === null && scope.stickyBare.has(n.base) ? scope.names.get(n.base) : undefined);
    if (dup !== undefined) {
      this.report('E202', n.span, `'${n.text}' is already declared in this ${isGlobal ? 'program' : 'procedure'}`, 'Remove one declaration, or give them different names.', [
        { span: this.sym(dup).span, message: 'first declared here' },
      ]);
      return;
    }
    this.warnShadow(n);
    const id = this.nextId();
    const v: MVar = {
      kind: 'variable',
      id,
      name: n.text,
      base: n.base,
      scope: scope.id,
      span: n.span,
      type,
      typeKey: typeKey(type),
      storage: isGlobal ? 'global' : 'local',
      declaredBy: 'dim',
      decl: d,
      param: null,
      label: isGlobal ? this.allocLabel(id, n, typeKey(type), false) : null,
      assigned: false,
      read: false,
    };
    this.symbols.push(v);
    if (n.suffix !== null) this.suffixes.set(id, n.suffix);
    scope.names.set(key, id);
    if (n.suffix === null) {
      scope.names.set(n.base, id);
      scope.stickyBare.add(n.base);
    }
    this.res.names.set(n, id);
    this.track(id, isGlobal);
  }

  /**
   * The asm label of a global (sem/model.ts `globalLabel`). Two identities of one name that
   * would share a label (`a` as REAL after DEFREAL, and `a` as INTEGER after DEFINT) get the
   * type-suffixed form for the later one; a clash between different names is left for E210.
   */
  private allocLabel(id: SymbolId, n: Name, key: string, isArray: boolean): string {
    let label = globalLabel(n.text, n.suffix, isArray);
    const taken = this.labelsInUse.get(label);
    if (taken !== undefined && this.sym(taken).base === n.base) {
      const sfx = key === '%' ? '%' : key === '!' ? '!' : key === '$' ? '$' : null;
      label = sfx !== null ? globalLabel(n.text, sfx, isArray) : `${globalLabel(n.text, null, isArray)}__${key.toLowerCase()}`;
    }
    if (!this.labelsInUse.has(label)) this.labelsInUse.set(label, id);
    return label;
  }

  private track(id: SymbolId, isGlobal: boolean): void {
    if (isGlobal) this.globalIds.push(id);
    else (this.locals.get(this.cur.owner as SymbolId) as SymbolId[]).push(id);
  }

  private declareConst(c: { name: Name; type: { name: TypeName } | null; value: Expr; span: Span }): void {
    const n = c.name;
    const scope = this.cur;
    let declared: TypeName | null = null;
    if (c.type !== null || n.suffix !== null) declared = this.typeOfDecl(n, c.type);
    const key = declared !== null ? identityKey(n.base, typeKey(declared)) : null;
    const dup = (key !== null ? scope.names.get(key) : undefined) ?? (n.suffix === null && scope.stickyBare.has(n.base) ? scope.names.get(n.base) : undefined);
    if (dup !== undefined) {
      this.report('E202', n.span, `'${n.text}' is already declared`, 'Remove one declaration, or give them different names.', [{ span: this.sym(dup).span, message: 'first declared here' }]);
      return;
    }
    this.warnShadow(n);
    const id = this.nextId();
    const sym: Mut<ConstSymbol> = {
      kind: 'const',
      id,
      name: n.text,
      base: n.base,
      scope: scope.id,
      span: n.span,
      declaredType: declared,
      typeKey: declared !== null ? typeKey(declared) : null,
      value: c.value,
    };
    this.symbols.push(sym);
    if (key !== null) scope.names.set(key, id);
    if (n.suffix === null) {
      scope.names.set(n.base, id);
      scope.stickyBare.add(n.base);
    }
    this.res.names.set(n, id);
  }

  // ---- lookups ---------------------------------------------------------------

  private chain(): MScope[] {
    return this.cur === this.global ? [this.global] : [this.cur, this.global];
  }

  /** The scalar or constant an occurrence of `n` means, or undefined. `viaDefault` is true when the default type chose it. */
  private findScalar(n: Name): { id: SymbolId; viaDefault: boolean } | undefined {
    for (const sc of this.chain()) {
      if (n.suffix !== null) {
        const id = sc.names.get(n.base + n.suffix);
        if (id !== undefined) return { id, viaDefault: false };
        continue;
      }
      if (sc.stickyBare.has(n.base)) return { id: sc.names.get(n.base) as SymbolId, viaDefault: false };
      const id = sc.names.get(identityKey(n.base, typeKey(this.defType(n.base))));
      if (id !== undefined) return { id, viaDefault: true };
    }
    return undefined;
  }

  private findArray(n: Name): SymbolId | undefined {
    for (const sc of this.chain()) {
      if (n.suffix !== null) {
        const id = sc.arrays.get(n.base + n.suffix);
        if (id !== undefined) return id;
        continue;
      }
      const bare = sc.arrays.get(n.base);
      if (bare !== undefined) return bare;
      const id = sc.arrays.get(identityKey(n.base, typeKey(this.defType(n.base))));
      if (id !== undefined) return id;
    }
    return undefined;
  }

  /** W304 when a user declaration takes the name of a firmware entry (the user's name wins). */
  private warnShadow(n: Name): void {
    if (n.suffix !== null || !FIRMWARE.has(n.base.toUpperCase())) return;
    const fw = n.base.toUpperCase();
    this.report('W304', n.span, `'${n.text}' hides the firmware entry ${fw}`, `${fw} is a built-in constant (&${(FIRMWARE.get(fw)?.address ?? 0).toString(16).toUpperCase()}); rename yours to use both.`);
  }

  /** The built-in constant for an unsuffixed firmware name, created on first use. */
  private firmwareConst(n: Name): SymbolId | undefined {
    if (n.suffix !== null) return undefined;
    const key = n.base.toUpperCase();
    const entry = FIRMWARE.get(key);
    if (entry === undefined) return undefined;
    const have = this.firmwareConsts.get(key);
    if (have !== undefined) return have;
    const id = this.nextId();
    const text = `&${entry.address.toString(16).toUpperCase()}`;
    const sym: Mut<ConstSymbol> = {
      kind: 'const',
      id,
      name: key,
      base: n.base,
      scope: this.global.id,
      span: n.span,
      declaredType: 'UINTEGER',
      typeKey: typeKey('UINTEGER'),
      value: { kind: 'NumberLit', span: n.span, value: entry.address, text, radix: 16, isReal: false, suffix: null },
    };
    this.symbols.push(sym);
    this.firmwareConsts.set(key, id);
    return id;
  }

  private declareImplicit(n: Name, declaredBy: 'implicit' | 'for'): SymbolId {
    this.warnShadow(n);
    const type = n.suffix !== null ? suffixType(n.suffix) : this.defType(n.base);
    const target = this.cur.kind === 'global' || this.cur.implicitGlobal ? this.global : this.cur;
    const isGlobal = target === this.global;
    if (this.state.explicit) {
      this.report('E206', n.span, `'${n.text}${n.suffix ?? ''}' is used without being declared`, `Add DIM ${n.text}${n.suffix ?? ''}${n.suffix === null ? ` AS ${type}` : ''} before this line, or remove #pragma explicit.`);
    } else if (this.input.warnImplicit === true) {
      this.report('W300', n.span, `'${n.text}${n.suffix ?? ''}' is declared implicitly as ${type}`, `Add DIM ${n.text}${n.suffix ?? ''}${n.suffix === null ? ` AS ${type}` : ''} to declare it.`);
    }
    const id = this.nextId();
    const v: MVar = {
      kind: 'variable',
      id,
      name: n.text,
      base: n.base,
      scope: target.id,
      span: n.span,
      type,
      typeKey: typeKey(type),
      storage: isGlobal ? 'global' : 'local',
      declaredBy,
      decl: null,
      param: null,
      label: isGlobal ? this.allocLabel(id, n, typeKey(type), false) : null,
      assigned: false,
      read: false,
    };
    this.symbols.push(v);
    if (n.suffix !== null) this.suffixes.set(id, n.suffix);
    target.names.set(identityKey(n.base, v.typeKey), id);
    if (n.suffix === null && !target.names.has(n.base)) target.names.set(n.base, id);
    if (isGlobal) this.globalIds.push(id);
    else (this.locals.get(target.owner as SymbolId) as SymbolId[]).push(id);
    return id;
  }

  private mark(id: SymbolId, access: Access, span: Span): void {
    const s = this.sym(id);
    if (s.kind !== 'variable') return;
    const m = s as MVar;
    if (access === 'read' || access === 'rw' || access === 'addr') {
      m.read = true;
      if (!this.firstRead.has(id)) this.firstRead.set(id, span);
    }
    if (access === 'write' || access === 'rw' || access === 'addr') m.assigned = true;
  }

  // ---- uses ------------------------------------------------------------------

  private useName(n: Name, access: Access, declaredBy: 'implicit' | 'for' = 'implicit'): SymbolId {
    const found = this.findScalar(n);
    let id: SymbolId;
    if (found) {
      id = found.id;
      if (found.viaDefault) this.cur.letterUse.set(n.base.charAt(0), this.defType(n.base));
    } else {
      const proc = this.global.procedures.get(n.base);
      if (proc !== undefined && this.sym(proc).kind === 'procedure') {
        // A SUB or FUNCTION name read alone is a call (the checker refuses a SUB there); assigned
        // outside the FUNCTION's own body it is an error, not a new variable with the same label.
        if (access !== 'read') {
          const p = this.sym(proc) as ProcedureSymbol;
          this.report('E202', n.span, `'${n.text}' is a ${p.procKind}; a variable cannot have its name`, p.procKind === 'FUNCTION' ? `Assign the result inside FUNCTION ${p.name}, or rename the variable.` : 'Rename the variable.', [
            { span: p.span, message: `${p.procKind} declared here` },
          ]);
        }
        this.res.names.set(n, proc);
        return proc;
      }
      const fw = access === 'read' ? this.firmwareConst(n) : undefined;
      if (fw !== undefined) {
        this.res.names.set(n, fw);
        return fw;
      }
      id = this.declareImplicit(n, declaredBy);
      if (n.suffix === null) this.cur.letterUse.set(n.base.charAt(0), this.defType(n.base));
    }
    this.res.names.set(n, id);
    this.mark(id, access, n.span);
    return id;
  }

  private useLValue(t: LValue, access: Access): void {
    if (t.kind === 'Name') this.useName(t, access);
    else this.useCallOrIndex(t, true);
  }

  private visitArgs(args: readonly Expr[], params: readonly ParamInfo[] | null): void {
    args.forEach((a, i) => {
      const p = params?.[i];
      if (p?.isArray && a.kind === 'Name') {
        const arr = this.findArray(a);
        if (arr !== undefined) {
          this.res.names.set(a, arr);
          return;
        }
      }
      this.visit(a);
      if (p?.byref && a.kind === 'Name') {
        const id = this.res.names.get(a);
        if (id !== undefined) this.mark(id, 'write', a.span);
      }
    });
  }

  private useCallOrIndex(node: CallOrIndex, asTarget: boolean): void {
    const c = node.callee;
    const arr = this.findArray(c);
    if (arr !== undefined) {
      this.res.names.set(c, arr);
      this.res.callOrIndex.set(node, arr);
      this.visitArgs(node.args, null);
      return;
    }
    const pid = this.global.procedures.get(c.base);
    const proc = pid !== undefined ? this.sym(pid) : undefined;
    if (!asTarget && proc !== undefined && proc.kind === 'procedure') {
      this.res.names.set(c, proc.id);
      this.res.callOrIndex.set(node, proc.id);
      this.visitArgs(node.args, proc.params);
      return;
    }
    if (asTarget) {
      this.report('E204', c.span, `'${c.text}${c.suffix ?? ''}' is not an array`, `DIM the array first: DIM ${c.text}${c.suffix ?? ''}(10).`);
    } else {
      const extra = proc?.kind === 'deffn' ? ` A DEF FN is called as FN ${c.text}(...).` : '';
      this.report('E204', c.span, `'${c.text}${c.suffix ?? ''}' is not an array or a FUNCTION`, `DIM the array first: DIM ${c.text}${c.suffix ?? ''}(10).${extra}`);
    }
    this.visitArgs(node.args, null);
  }

  private useAddressOf(target: Name): void {
    const arr = this.findArray(target);
    if (arr !== undefined) {
      this.res.names.set(target, arr);
      return;
    }
    const found = this.findScalar(target);
    if (found) {
      this.res.names.set(target, found.id);
      this.mark(found.id, 'addr', target.span);
      return;
    }
    const pid = this.global.procedures.get(target.base);
    if (pid !== undefined) {
      this.res.names.set(target, pid);
      return;
    }
    const lab = this.labelMap.get(target.base);
    if (lab !== undefined) {
      this.res.names.set(target, lab);
      return;
    }
    this.useName(target, 'addr');
  }

  // ---- the walk --------------------------------------------------------------

  private visit(node: Node): void {
    this.enter(node);
    switch (node.kind) {
      case 'Name':
        this.useName(node, 'read');
        return;
      case 'CallOrIndex':
        this.useCallOrIndex(node, false);
        return;
      case 'AddressOf':
        if (node.index !== undefined) {
          const arr = this.findArray(node.target);
          if (arr !== undefined) this.res.names.set(node.target, arr);
          else this.report('E204', node.target.span, `'${node.target.text}${node.target.suffix ?? ''}' is not an array`, `DIM the array first: DIM ${node.target.text}${node.target.suffix ?? ''}(10).`);
          this.visitArgs(node.index, null);
          return;
        }
        this.useAddressOf(node.target);
        return;
      case 'FnCall': {
        const pid = this.global.procedures.get(node.name.base);
        const s = pid !== undefined ? this.sym(pid) : undefined;
        if (s?.kind === 'deffn') {
          this.res.names.set(node.name, s.id);
          this.res.fnCalls.set(node, s.id);
        } else {
          this.report('E205', node.name.span, `No DEF FN named '${node.name.text}'`, `Define it with DEF FN${node.name.text}(...) = ... or fix the spelling.`);
        }
        this.visitArgs(node.args, null);
        return;
      }
      case 'SubCall': {
        const pid = this.global.procedures.get(node.name.base);
        const s = pid !== undefined ? this.sym(pid) : undefined;
        if (s?.kind === 'procedure') {
          this.res.names.set(node.name, s.id);
          this.res.subCalls.set(node, s.id);
          this.visitArgs(node.args, s.params);
        } else {
          const extra = s?.kind === 'deffn' ? ' A DEF FN is called as FN name(...) inside an expression.' : '';
          this.report('E205', node.name.span, `'${node.name.text}' is not a SUB or FUNCTION`, `Define it with SUB ${node.name.text} ... END SUB, or fix the spelling.${extra}`);
          this.visitArgs(node.args, null);
        }
        return;
      }
      case 'BuiltinCall': {
        const first = node.args[0];
        if ((node.keyword === 'LBOUND' || node.keyword === 'UBOUND') && first !== undefined && first.kind === 'Name') {
          const arr = this.findArray(first);
          if (arr !== undefined) this.res.names.set(first, arr);
          else this.report('E204', first.span, `'${first.text}' is not an array`, `DIM the array first: DIM ${first.text}(10).`);
          for (const a of node.args.slice(1)) this.visit(a);
          return;
        }
        for (const ch of children(node)) this.visit(ch);
        return;
      }
      case 'Builtin': {
        // SAVE "name", A|P|B, ...: the file-type letter is a bare name, not a variable.
        const typeLetter = node.keyword === 'SAVE' ? node.args[1] : undefined;
        node.args.forEach((a, i) => {
          if (a === null) return;
          if (i === 1 && typeLetter === a && a.kind === 'Name' && a.suffix === null && /^[apb]$/.test(a.base)) return;
          this.visit(a);
        });
        if (node.stream) this.visit(node.stream);
        return;
      }
      case 'Let':
        this.useLValue(node.target, 'write');
        this.visit(node.value);
        return;
      case 'MidAssign':
        this.useLValue(node.target, 'rw');
        this.visit(node.start);
        if (node.length) this.visit(node.length);
        this.visit(node.value);
        return;
      case 'Read':
        for (const t of node.targets) this.useLValue(t, 'write');
        return;
      case 'Input':
        if (node.stream) this.visit(node.stream);
        for (const t of node.targets) this.useLValue(t, 'write');
        return;
      case 'Dim':
        for (const d of node.decls) {
          this.enter(d);
          for (const ch of [...d.bounds, d.init, d.at]) if (ch) this.visit(ch);
        }
        return;
      case 'Const':
        this.visit(node.value);
        return;
      case 'For': {
        const id = this.useName(node.variable, 'rw', 'for');
        this.res.forVars.set(node, id);
        this.visit(node.from);
        this.visit(node.to);
        if (node.step) this.visit(node.step);
        for (const s of node.body) this.visit(s);
        if (node.nextName) {
          const f = this.findScalar(node.nextName);
          if (f) this.res.names.set(node.nextName, f.id);
        }
        return;
      }
      case 'Goto':
      case 'Gosub':
        this.jump(node.target, 'jump');
        return;
      case 'OnGoto':
        this.visit(node.selector);
        for (const t of node.targets) this.jump(t, 'jump');
        return;
      case 'OnError':
        if (node.target) this.jump(node.target, 'handler');
        return;
      case 'Resume':
        if (node.target) this.jump(node.target, 'handler');
        return;
      case 'EveryAfter':
        this.visit(node.interval);
        if (node.timer) this.visit(node.timer);
        this.jump(node.target, 'handler');
        return;
      case 'Restore':
        if (node.target) this.jump(node.target, 'restore');
        return;
      case 'DefType':
        this.checkDefAfterUse(node);
        return;
      case 'Procedure':
      case 'DefFn':
      case 'Declare':
        return;
      default:
        for (const ch of children(node)) this.visit(ch);
    }
  }

  private checkDefAfterUse(node: { type: TypeName; ranges: ReadonlyArray<{ from: string; to: string }>; span: Span }): void {
    const late: string[] = [];
    for (const r of node.ranges) {
      if (r.from > r.to) continue;
      for (let code = r.from.charCodeAt(0); code <= r.to.charCodeAt(0); code++) {
        const letter = String.fromCharCode(code);
        const used = this.cur.letterUse.get(letter);
        if (used !== undefined) {
          if (used !== node.type) late.push(letter);
          this.cur.letterUse.delete(letter);
        }
      }
    }
    if (late.length > 0) {
      this.report('W302', node.span, `DEF${node.type === 'INTEGER' ? 'INT' : node.type === 'REAL' ? 'REAL' : 'STR'} comes after variables starting with ${late.join(', ')} were first used`, 'The variables keep the type they had; move the DEF statement before their first use.');
    }
  }

  // ---- checks at the end -------------------------------------------------------

  /** A symbol's name with the suffix it was first written with. */
  private spelled(s: SemSymbol): string {
    return `${s.name}${this.suffixes.get(s.id) ?? ''}`;
  }

  private checkAsmLabels(): void {
    const seen = new Map<string, SemSymbol>();
    for (const s of this.symbols) {
      if (s.kind === 'const' || s.kind === 'label' || this.duplicates.has(s.id)) continue;
      const label = s.label;
      if (label === null) continue;
      const first = seen.get(label);
      if (first === undefined) {
        seen.set(label, s);
        continue;
      }
      this.report('E210', s.span, `'${this.spelled(s)}' and '${this.spelled(first)}' both give the assembler label ${label}`, undefined, [{ span: first.span, message: 'first used here' }]);
    }
  }

  private reportUnassigned(): void {
    for (const s of this.symbols) {
      if (s.kind !== 'variable' || !s.read || s.assigned) continue;
      if (s.storage === 'param' || s.declaredBy === 'result' || s.declaredBy === 'for') continue;
      if (s.decl !== null && (s.decl.init !== null || s.decl.at !== null)) continue;
      this.report('W301', this.firstRead.get(s.id) ?? s.span, `'${this.spelled(s)}' is read but never assigned`);
    }
  }
}
