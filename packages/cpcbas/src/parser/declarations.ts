/**
 * Statement table of L1-PDECL: DIM, CONST, DEFINT/DEFREAL/DEFSTR, OPTION, SUB, FUNCTION,
 * DECLARE, DEF FN, and the dropped Boriel forms TYPE and PRIVATE (soft words).
 */

import type {
  ArrayInit,
  CallingConvention,
  ConstStmt,
  DeclareStmt,
  DefFnStmt,
  DefTypeStmt,
  DimDecl,
  DimStmt,
  Expr,
  Name,
  NumberLit,
  OptionStmt,
  Param,
  ProcedureDecl,
  TypeRef,
} from '../ast/ast.js';
import type { Span } from '../core/source.js';
import type { Cursor } from './cursor.js';
import type { ParserContext, StatementParser, StatementParsers } from './types.js';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

// ---- small helpers -----------------------------------------------------------

/** How many procedures are being parsed, per parse (keyed by the cursor, which lives as long as the parse). */
const procDepth = new WeakMap<Cursor, number>();

const skipNewlines = (c: Cursor): void => {
  while (c.at('Newline')) c.next();
};

function emptyName(at: Span): Name {
  return { kind: 'Name', span: { ...at, end: at.start }, text: '', base: '', suffix: null };
}

// ---- DIM ---------------------------------------------------------------------

/** `{1, 2, {3, 4}}`. Newlines are allowed anywhere inside the braces. Null after a diagnostic. */
function parseArrayInit(ctx: ParserContext): ArrayInit | null {
  const c = ctx.cursor;
  const open = c.next();
  const elements: Array<Expr | ArrayInit> = [];
  skipNewlines(c);
  for (;;) {
    skipNewlines(c);
    let el: Expr | ArrayInit | null;
    const t = c.peek();
    if (t.kind === '{') el = parseArrayInit(ctx);
    else if (t.kind === 'LineNumber' && (c.at(',', 1) || c.at('}', 1) || c.at('Newline', 1))) {
      // A number that starts a physical line inside the braces reads as a line number.
      c.next();
      const lit: NumberLit = { kind: 'NumberLit', span: t.span, value: t.value, text: t.text, radix: 10, isReal: false, suffix: null };
      el = lit;
    } else {
      el = ctx.parseExpr();
      if (el.kind === 'BadExpr') el = null;
    }
    if (!el) return null;
    elements.push(el);
    skipNewlines(c);
    if (!c.accept(',')) break;
    skipNewlines(c);
    if (c.at('}')) break;
  }
  if (!c.accept('}')) {
    ctx.error('E163', open.span, 'Missing closing brace for this {');
    return null;
  }
  return { kind: 'ArrayInit', span: c.spanFrom(open.span), elements };
}

/** `(b1, b2, ...)` after a DIM name. Null after a diagnostic. */
function parseBounds(ctx: ParserContext): Expr[] | null {
  const c = ctx.cursor;
  const open = c.next();
  const bounds: Expr[] = [];
  for (;;) {
    const e = ctx.parseExpr();
    if (e.kind === 'BadExpr') return null;
    bounds.push(e);
    if (c.atKw('TO')) {
      ctx.error('E970', c.peek().span, 'Array bounds are 0-based: write DIM a(5), not DIM a(1 TO 5)');
      return null;
    }
    if (!c.accept(',')) break;
  }
  if (!c.accept(')')) {
    ctx.error('E143', open.span, 'Missing closing parenthesis for this (', "Add the missing ')'.");
    return null;
  }
  return bounds;
}

const parseDim: StatementParser = (ctx) => {
  const c = ctx.cursor;
  const kw = c.next();
  const decls: Array<Mutable<DimDecl>> = [];
  let untyped: Array<Mutable<DimDecl>> = [];
  for (;;) {
    const name = ctx.parseName();
    if (!name) return ctx.badStmt(kw.span);
    let bounds: Expr[] = [];
    if (c.at('(')) {
      const b = parseBounds(ctx);
      if (!b) return ctx.badStmt(kw.span);
      bounds = b;
    }
    let type: TypeRef | null = null;
    if (c.acceptKw('AS')) {
      type = ctx.parseTypeRef();
      if (!type) return ctx.badStmt(kw.span);
    }
    let init: Expr | ArrayInit | null = null;
    if (c.at('=') || c.at('=>')) {
      c.next();
      skipNewlines(c);
      if (c.at('{')) {
        init = parseArrayInit(ctx);
        if (!init) return ctx.badStmt(kw.span);
      } else {
        init = ctx.parseExpr();
        if (init.kind === 'BadExpr') return ctx.badStmt(kw.span);
      }
    }
    let at: Expr | null = null;
    if (c.acceptKw('AT')) {
      at = ctx.parseExpr();
      if (at.kind === 'BadExpr') return ctx.badStmt(kw.span);
    }
    const decl: Mutable<DimDecl> = { kind: 'DimDecl', span: c.spanFrom(name.span), name, bounds, type, init, at };
    decls.push(decl);
    if (type) {
      // `DIM a, b AS UBYTE`: the names before the AS that had no type share this one.
      for (const d of untyped) d.type = type;
      untyped = [];
    } else untyped.push(decl);
    if (!c.accept(',')) break;
  }
  const node: DimStmt = { kind: 'Dim', span: c.spanFrom(kw.span), decls };
  return node;
};

// ---- CONST, DEFxxx, OPTION -----------------------------------------------------

const parseConst: StatementParser = (ctx) => {
  const c = ctx.cursor;
  const kw = c.next();
  const name = ctx.parseName();
  if (!name) return ctx.badStmt(kw.span);
  let type: TypeRef | null = null;
  if (c.acceptKw('AS')) {
    type = ctx.parseTypeRef();
    if (!type) return ctx.badStmt(kw.span);
  }
  if (!c.expect('=', "'=' and the value of the constant")) return ctx.badStmt(kw.span);
  const value = ctx.parseExpr();
  if (value.kind === 'BadExpr') return ctx.badStmt(kw.span);
  const node: ConstStmt = { kind: 'Const', span: c.spanFrom(kw.span), name, type, value };
  return node;
};

const DEF_TYPES: Readonly<Record<string, DefTypeStmt['type']>> = { DEFINT: 'INTEGER', DEFREAL: 'REAL', DEFSTR: 'STRING' };

/** One letter (an unsuffixed identifier of length 1), lower case; null after E164. */
function parseLetter(ctx: ParserContext): { letter: string; span: Span } | null {
  const c = ctx.cursor;
  const t = c.peek();
  if (t.kind !== 'Identifier' || t.suffix !== null || t.name.length !== 1 || !/^[A-Za-z]$/.test(t.name)) {
    if (t.kind === 'Invalid') c.errorHere('E164');
    else ctx.error('E164', t.span, `Expected a single letter, found ${c.describe(t)}`);
    return null;
  }
  c.next();
  return { letter: t.name.toLowerCase(), span: t.span };
}

const parseDefType: StatementParser = (ctx) => {
  const c = ctx.cursor;
  const kw = c.next();
  const type = DEF_TYPES[kw.kind === 'Keyword' ? kw.keyword : ''] ?? 'INTEGER';
  const ranges: Array<{ from: string; to: string; span: Span }> = [];
  for (;;) {
    const from = parseLetter(ctx);
    if (!from) return ctx.badStmt(kw.span);
    let to = from;
    if (c.accept('-')) {
      const t = parseLetter(ctx);
      if (!t) return ctx.badStmt(kw.span);
      to = t;
      if (to.letter < from.letter) {
        ctx.error('E164', c.spanFrom(from.span), `The range ${from.letter}-${to.letter} runs backwards`);
        return ctx.badStmt(kw.span);
      }
    }
    ranges.push({ from: from.letter, to: to.letter, span: c.spanFrom(from.span) });
    if (!c.accept(',')) break;
  }
  const node: DefTypeStmt = { kind: 'DefType', span: c.spanFrom(kw.span), type, ranges };
  return node;
};

const parseOption: StatementParser = (ctx) => {
  const c = ctx.cursor;
  const kw = c.next();
  const t = c.peek();
  if (t.kind === 'Keyword' && t.keyword === 'REAL') {
    c.next();
    const node: OptionStmt = { kind: 'Option', span: c.spanFrom(kw.span), name: 'REAL' };
    return node;
  }
  if (t.kind === 'Invalid') c.errorHere('E165');
  else if (c.atSeparator()) ctx.error('E165', kw.span, 'OPTION needs a name');
  else ctx.error('E165', t.span, `Unknown option ${c.describe(t)}`);
  return ctx.badStmt(kw.span);
};

// ---- SUB, FUNCTION, DECLARE ----------------------------------------------------

/** `(p1, p2 AS type = default, a() AS type)`; the parentheses are optional when there are no parameters. Null after a diagnostic. */
function parseParams(ctx: ParserContext): Param[] | null {
  const c = ctx.cursor;
  const params: Param[] = [];
  if (!c.at('(')) return params;
  const open = c.next();
  if (!c.accept(')')) {
    for (;;) {
      const start = c.peek().span;
      let passing: Param['passing'] = null;
      if (c.acceptKw('BYVAL')) passing = 'BYVAL';
      else if (c.acceptKw('BYREF')) passing = 'BYREF';
      const name = ctx.parseName();
      if (!name) return null;
      let isArray = false;
      if (c.at('(')) {
        c.next();
        if (!c.expect(')', "')' (an array parameter is written name() AS type)")) return null;
        isArray = true;
      }
      let type: TypeRef | null = null;
      if (c.acceptKw('AS')) {
        type = ctx.parseTypeRef();
        if (!type) return null;
      }
      let def: Expr | null = null;
      if (c.accept('=')) {
        def = ctx.parseExpr();
        if (def.kind === 'BadExpr') return null;
      }
      params.push({ kind: 'Param', span: c.spanFrom(start), name, type, passing, isArray, default: def });
      if (!c.accept(',')) break;
    }
    if (!c.accept(')')) {
      if (c.peek().kind === 'Invalid') c.errorHere('E143');
      else ctx.error('E143', open.span, 'Missing closing parenthesis for this (', "Add the missing ')'.");
      return null;
    }
  }
  return params;
}

interface Header {
  readonly procKind: 'SUB' | 'FUNCTION';
  readonly name: Name;
  readonly params: Param[];
  readonly returnType: TypeRef | null;
  readonly convention: CallingConvention | null;
  /** False when the header had an error (already reported and the line skipped). */
  readonly ok: boolean;
}

/** The header after `SUB`/`FUNCTION`/`DECLARE SUB`: the cursor is at the keyword SUB or FUNCTION. */
function parseHeader(ctx: ParserContext): Header {
  const c = ctx.cursor;
  const kw = c.next();
  const procKind = kw.kind === 'Keyword' && kw.keyword === 'FUNCTION' ? 'FUNCTION' : 'SUB';
  let convention: CallingConvention | null = null;
  if (c.acceptKw('FASTCALL')) convention = 'FASTCALL';
  else if (c.acceptKw('STDCALL')) convention = 'STDCALL';
  let name = ctx.parseName();
  let ok = name !== null;
  if (!name) name = emptyName(c.peek().span);
  let params: Param[] = [];
  let returnType: TypeRef | null = null;
  if (ok) {
    const p = parseParams(ctx);
    if (p) params = p;
    else ok = false;
  }
  if (ok && c.atKw('AS')) {
    const asTok = c.next();
    returnType = ctx.parseTypeRef();
    if (!returnType) ok = false;
    else if (procKind === 'SUB') {
      ctx.error('E166', asTok.span, 'A SUB has no result type');
      ok = false;
    }
  }
  if (!ok) c.resync();
  return { procKind, name, params, returnType, convention, ok };
}

const parseProcedure: StatementParser = (ctx) => {
  const c = ctx.cursor;
  const kw = c.peek();
  const depth = procDepth.get(c) ?? 0;
  if (depth > 0) {
    ctx.error('E160', kw.span, `${kw.text.toUpperCase()} inside a procedure: procedures are not nested`);
  } else if (c.blockDepth > 1) {
    // Spec section 3: procedures are defined at the top level only, never inside IF, FOR or another block.
    ctx.error('E160', kw.span, `${kw.text.toUpperCase()} inside a block: procedures are defined at the top level only`, `Move the whole ${kw.text.toUpperCase()} ... END ${kw.text.toUpperCase()} out of the block, to the top level of the file.`);
  }
  const h = parseHeader(ctx);
  const closers: readonly string[][] = [['END', 'SUB'], ['END', 'FUNCTION']];
  const own = h.procKind === 'SUB' ? 0 : 1;
  procDepth.set(c, depth + 1);
  let block;
  try {
    block = ctx.parseBlock(closers);
  } finally {
    procDepth.set(c, depth);
  }
  let endSpan: Span;
  if (block.matched < 0) {
    ctx.error('E161', kw.span, `${h.procKind} never closed (expected END ${h.procKind})`, `Add END ${h.procKind} after the last statement.`);
    const p = c.prevSpan;
    endSpan = { ...p, start: p.end };
  } else {
    endSpan = ctx.takeTerminator(closers, block);
    if (block.matched !== own) {
      ctx.error('E162', endSpan, `END ${closers[block.matched]?.[1] ?? ''} does not close a ${h.procKind}`, `Close this ${h.procKind} with END ${h.procKind}.`);
    }
  }
  const node: ProcedureDecl = {
    kind: 'Procedure',
    span: c.spanFrom(kw.span),
    procKind: h.procKind,
    name: h.name,
    params: h.params,
    returnType: h.returnType,
    convention: h.convention,
    body: block.body,
    endSpan,
  };
  return node;
};

const parseDeclare: StatementParser = (ctx) => {
  const c = ctx.cursor;
  const kw = c.next();
  if (!c.atKw('SUB') && !c.atKw('FUNCTION')) {
    c.unexpected('SUB or FUNCTION', 'Write DECLARE SUB name(...) or DECLARE FUNCTION name(...) AS type.');
    return ctx.badStmt(kw.span);
  }
  const h = parseHeader(ctx);
  if (!h.ok) return ctx.badStmt(kw.span);
  const node: DeclareStmt = {
    kind: 'Declare',
    span: c.spanFrom(kw.span),
    procKind: h.procKind,
    name: h.name,
    params: h.params,
    returnType: h.returnType,
    convention: h.convention,
  };
  return node;
};

// ---- DEF FN ------------------------------------------------------------------

const parseDef: StatementParser = (ctx) => {
  const c = ctx.cursor;
  const kw = c.next();
  if (!c.acceptKw('FN')) {
    c.unexpected('FN', 'Write DEF FN name(params) = expression.');
    return ctx.badStmt(kw.span);
  }
  const name = ctx.parseName();
  if (!name) return ctx.badStmt(kw.span);
  const params: Name[] = [];
  if (c.at('(')) {
    const open = c.next();
    if (!c.accept(')')) {
      for (;;) {
        const p = ctx.parseName();
        if (!p) return ctx.badStmt(kw.span);
        params.push(p);
        if (!c.accept(',')) break;
      }
      if (!c.accept(')')) {
        ctx.error('E143', open.span, 'Missing closing parenthesis for this (', "Add the missing ')'.");
        return ctx.badStmt(kw.span);
      }
    }
  }
  if (!c.expect('=', "'=' and the body of the function")) return ctx.badStmt(kw.span);
  const body = ctx.parseExpr();
  if (body.kind === 'BadExpr') return ctx.badStmt(kw.span);
  const node: DefFnStmt = { kind: 'DefFn', span: c.spanFrom(kw.span), name, params, body };
  return node;
};

// ---- dropped forms -----------------------------------------------------------

/** `TYPE name ... END TYPE`: one diagnostic, and the whole block is skipped when it is closed. */
const parseType: StatementParser = (ctx) => {
  const c = ctx.cursor;
  const kw = c.next();
  ctx.error('E971', kw.span, 'TYPE is not in 1.0: use arrays');
  for (let n = 0; c.peek(n).kind !== 'EOF'; n++) {
    const t = c.peek(n);
    const nx = c.peek(n + 1);
    // END TYPE starts its line, possibly after a line number or label (`30 END TYPE`).
    const pk = n > 0 ? c.peek(n - 1).kind : null;
    const lineStart = t.lineStart || pk === 'LineNumber' || pk === 'Label';
    if (lineStart && c.atKw('END', n) && nx.kind === 'Identifier' && nx.name.toUpperCase() === 'TYPE') {
      for (let i = 0; i < n + 2; i++) c.next();
      break;
    }
  }
  return ctx.badStmt(kw.span);
};

/** `PRIVATE SUB ...`: reported, then the procedure is read as if PRIVATE were not there. */
const parsePrivate: StatementParser = (ctx) => {
  const c = ctx.cursor;
  const kw = c.next();
  if (c.atKw('SUB') || c.atKw('FUNCTION')) {
    // Reported without the one-per-statement limit, so an error in the procedure itself
    // (an unclosed SUB, a nested one) is still reported.
    ctx.report('E972', kw.span, 'PRIVATE is not in 1.0');
    return parseProcedure(ctx);
  }
  ctx.error('E972', kw.span, 'PRIVATE is not in 1.0');
  return ctx.badStmt(kw.span);
};

export const declarationParsers: StatementParsers = {
  DIM: parseDim,
  CONST: parseConst,
  DEFINT: parseDefType,
  DEFREAL: parseDefType,
  DEFSTR: parseDefType,
  OPTION: parseOption,
  SUB: parseProcedure,
  FUNCTION: parseProcedure,
  DECLARE: parseDeclare,
  DEF: parseDef,
  TYPE: parseType,
  PRIVATE: parsePrivate,
};
