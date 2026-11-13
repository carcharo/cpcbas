/**
 * Helpers that build AST nodes by hand, with dummy spans, for tests that run
 * before (or without) the parser.
 */

import { asFileId } from '../src/core/source.js';
import type { Span } from '../src/core/source.js';
import type {
  ArrayInit,
  BinaryExpr,
  BinaryOp,
  CallOrIndex,
  Expr,
  JumpTarget,
  Name,
  Node,
  NumberLit,
  Program,
  Stmt,
  StringLit,
  TypeName,
  TypeRef,
  UnaryExpr,
  UnaryOp,
} from '../src/ast/ast.js';
import type { TypeSuffix } from '../src/core/tokens.js';

export const SPAN: Span = { file: asFileId(0), start: 0, end: 0 };

export function span(start: number, end: number): Span {
  return { file: asFileId(0), start, end };
}

export function num(value: number, text: string = String(value)): NumberLit {
  return { kind: 'NumberLit', span: SPAN, value, text, radix: 10, isReal: text.includes('.'), suffix: null };
}

export function str(value: string): StringLit {
  return { kind: 'StringLit', span: SPAN, value };
}

export function name(text: string, suffix: TypeSuffix | null = null): Name {
  return { kind: 'Name', span: SPAN, text, base: text.toLowerCase(), suffix };
}

export function type(typeName: TypeName, text: string = typeName): TypeRef {
  return { kind: 'TypeRef', span: SPAN, name: typeName, text };
}

export function bin(op: BinaryOp, left: Expr, right: Expr): BinaryExpr {
  return { kind: 'Binary', span: SPAN, op, left, right };
}

export function un(op: UnaryOp, operand: Expr): UnaryExpr {
  return { kind: 'Unary', span: SPAN, op, operand };
}

export function idx(callee: string, ...args: Expr[]): CallOrIndex {
  return { kind: 'CallOrIndex', span: SPAN, callee: name(callee), args };
}

export function line(n: number): JumpTarget {
  return { kind: 'LineTarget', span: SPAN, number: n };
}

export function label(text: string): JumpTarget {
  return { kind: 'LabelTarget', span: SPAN, name: text, key: text.toLowerCase() };
}

export function arrayInit(...elements: Array<Expr | ArrayInit>): ArrayInit {
  return { kind: 'ArrayInit', span: SPAN, elements };
}

export function let_(target: Name | CallOrIndex, value: Expr, explicitLet = false): Stmt {
  return { kind: 'Let', span: SPAN, target, value, explicitLet };
}

export function printStmt(...exprs: Expr[]): Stmt {
  return { kind: 'Print', span: SPAN, stream: null, items: exprs.map((expr) => ({ kind: 'PrintExpr' as const, span: SPAN, expr })) };
}

export function program(...body: Stmt[]): Program {
  return { kind: 'Program', span: SPAN, body, includes: [], mainFile: asFileId(0) };
}

/** `Let` of `x = <expr>` wrapped in a program: handy for expression round trips. */
export function assign(expr: Expr): Program {
  return program(let_(name('x'), expr));
}

/**
 * One instance of every node kind in ast.ts, keyed by kind. The `Record` type makes the
 * set exhaustive: adding a kind to `Node` makes this fail to compile until it has an entry.
 * Instances also use every variant of the inline records (CASE tests, PRINT items).
 */
export function everyKind(): Record<Node['kind'], Node> {
  const shared = type('UBYTE');
  const a = name('a');
  const one = num(1);
  const goto10: Stmt = { kind: 'Goto', span: SPAN, target: line(10), implicit: false };
  const bodyLet = let_(a, one);
  return {
    Program: { kind: 'Program', span: SPAN, body: [bodyLet], includes: [], mainFile: asFileId(0) },
    Name: name('Score', '$'),
    TypeRef: type('REAL', 'FLOAT'),
    LineTarget: line(100),
    LabelTarget: label('Start'),
    NumberLit: num(255, '&FF'),
    StringLit: str('say "hi"'),
    Unary: un('-', a),
    Binary: bin('+', a, one),
    AddressOf: { kind: 'AddressOf', span: SPAN, target: a, index: [one] },
    CallOrIndex: idx('t', one, num(2)),
    BuiltinCall: { kind: 'BuiltinCall', span: SPAN, keyword: 'PEEK', args: [num(100)], stream: null, typeArg: type('UINTEGER'), parens: true },
    FnCall: { kind: 'FnCall', span: SPAN, name: name('sq'), args: [num(3)] },
    BadExpr: { kind: 'BadExpr', span: SPAN },
    ArrayInit: arrayInit(num(1), arrayInit(num(2), num(3))),
    LineLabel: { kind: 'LineLabel', span: SPAN, number: 10, name: null, key: null },
    Let: let_(a, bin('*', a, num(2)), true),
    MidAssign: { kind: 'MidAssign', span: SPAN, target: name('s', '$'), start: one, length: num(2), value: str('xy') },
    Dim: {
      kind: 'Dim',
      span: SPAN,
      decls: [
        { kind: 'DimDecl', span: SPAN, name: name('p'), bounds: [], type: shared, init: null, at: null },
        { kind: 'DimDecl', span: SPAN, name: name('q'), bounds: [num(9)], type: shared, init: null, at: null },
      ],
    },
    DimDecl: { kind: 'DimDecl', span: SPAN, name: name('buf'), bounds: [num(255)], type: type('UBYTE'), init: null, at: num(32768, '&8000') },
    Const: { kind: 'Const', span: SPAN, name: name('max'), type: type('INTEGER'), value: num(10) },
    DefType: { kind: 'DefType', span: SPAN, type: 'REAL', ranges: [{ from: 'a', to: 'h', span: SPAN }, { from: 'x', to: 'x', span: SPAN }] },
    Option: { kind: 'Option', span: SPAN, name: 'REAL' },
    If: {
      kind: 'If',
      span: SPAN,
      form: 'block',
      branches: [
        { cond: bin('>', a, one), body: [bodyLet], span: SPAN },
        { cond: bin('<', a, one), body: [goto10], span: SPAN },
      ],
      elseBody: [bodyLet],
    },
    For: {
      kind: 'For',
      span: SPAN,
      variable: name('i'),
      from: one,
      to: num(10),
      step: num(2),
      body: [bodyLet],
      nextName: name('i'),
      nextSpan: SPAN,
    },
    While: { kind: 'While', span: SPAN, cond: bin('<', a, num(5)), body: [bodyLet] },
    DoLoop: {
      kind: 'DoLoop',
      span: SPAN,
      pre: { until: false, expr: bin('<', a, num(5)), span: SPAN },
      post: { until: true, expr: bin('>', a, num(9)), span: SPAN },
      body: [bodyLet],
    },
    SelectCase: {
      kind: 'SelectCase',
      span: SPAN,
      subject: a,
      cases: [
        {
          kind: 'CaseClause',
          span: SPAN,
          tests: [
            { kind: 'CaseValue', span: SPAN, value: one },
            { kind: 'CaseRange', span: SPAN, from: num(3), to: num(9) },
            { kind: 'CaseIs', span: SPAN, op: '>', value: num(10) },
          ],
          body: [bodyLet],
        },
      ],
      elseBody: [goto10],
    },
    CaseClause: {
      kind: 'CaseClause',
      span: SPAN,
      tests: [{ kind: 'CaseValue', span: SPAN, value: num(7) }],
      body: [bodyLet],
    },
    Exit: { kind: 'Exit', span: SPAN, target: 'FOR' },
    Continue: { kind: 'Continue', span: SPAN, target: 'WHILE' },
    Goto: goto10,
    Gosub: { kind: 'Gosub', span: SPAN, target: label('Sub1') },
    Return: { kind: 'Return', span: SPAN, value: one },
    OnGoto: { kind: 'OnGoto', span: SPAN, selector: a, targets: [line(10), label('Two')], gosub: true },
    OnBreak: { kind: 'OnBreak', span: SPAN, action: 'STOP' },
    OnError: { kind: 'OnError', span: SPAN, target: label('Oops') },
    Resume: { kind: 'Resume', span: SPAN, mode: 'target', target: label('Fix') },
    Error: { kind: 'Error', span: SPAN, code: num(5) },
    End: { kind: 'End', span: SPAN },
    Stop: { kind: 'Stop', span: SPAN },
    EveryAfter: { kind: 'EveryAfter', span: SPAN, every: true, interval: num(50), timer: num(1), target: label('Tick') },
    Call: { kind: 'Call', span: SPAN, address: num(48000), args: [a] },
    Rsx: { kind: 'Rsx', span: SPAN, name: 'DISC', args: [one] },
    SubCall: { kind: 'SubCall', span: SPAN, name: name('Foo'), args: [one, num(2)], parens: false },
    Print: {
      kind: 'Print',
      span: SPAN,
      stream: one,
      items: [
        { kind: 'PrintAt', span: SPAN, row: one, col: num(2) },
        { kind: 'PrintSep', span: SPAN, sep: ';' },
        { kind: 'PrintUsing', span: SPAN, format: str('##') },
        { kind: 'PrintSep', span: SPAN, sep: ';' },
        { kind: 'PrintTab', span: SPAN, column: num(10) },
        { kind: 'PrintSpc', span: SPAN, count: num(3) },
        { kind: 'PrintExpr', span: SPAN, expr: a },
        { kind: 'PrintSep', span: SPAN, sep: ',' },
      ],
    },
    Write: { kind: 'Write', span: SPAN, stream: num(9), items: [str('a'), name('n')] },
    Input: { kind: 'Input', span: SPAN, line: true, stream: null, prompt: str('Name'), promptSep: ';', keepCursor: false, targets: [name('n', '$')] },
    Data: {
      kind: 'Data',
      span: SPAN,
      values: [
        { kind: 'DataValue', span: SPAN, raw: '1', quoted: false },
        { kind: 'DataValue', span: SPAN, raw: 'a b', quoted: true },
      ],
    },
    DataValue: { kind: 'DataValue', span: SPAN, raw: 'x y', quoted: false },
    Read: { kind: 'Read', span: SPAN, targets: [a, idx('t', one)] },
    Restore: { kind: 'Restore', span: SPAN, target: line(10) },
    Param: { kind: 'Param', span: SPAN, name: name('v'), type: type('UBYTE'), passing: 'BYREF', isArray: false, default: null },
    Procedure: {
      kind: 'Procedure',
      span: SPAN,
      procKind: 'FUNCTION',
      name: name('Twice'),
      params: [{ kind: 'Param', span: SPAN, name: name('v'), type: type('INTEGER'), passing: null, isArray: false, default: num(1) }],
      returnType: type('INTEGER'),
      convention: 'FASTCALL',
      body: [{ kind: 'Return', span: SPAN, value: bin('*', name('v'), num(2)) }],
      endSpan: SPAN,
    },
    Declare: {
      kind: 'Declare',
      span: SPAN,
      procKind: 'SUB',
      name: name('Draw'),
      params: [{ kind: 'Param', span: SPAN, name: name('tiles'), type: type('UBYTE'), passing: null, isArray: true, default: null }],
      returnType: null,
      convention: null,
    },
    DefFn: { kind: 'DefFn', span: SPAN, name: name('sq'), params: [name('x')], body: bin('*', name('x'), name('x')) },
    Builtin: { kind: 'Builtin', span: SPAN, keyword: 'SOUND', stream: null, typeArg: null, args: [one, num(200), null, num(15)] },
    Asm: { kind: 'Asm', span: SPAN, lines: [{ kind: 'AsmLine', span: SPAN, text: '    ld a, 1' }] },
    AsmLine: { kind: 'AsmLine', span: SPAN, text: '    ret' },
    Pragma: { kind: 'Pragma', span: SPAN, op: 'set', name: 'org', value: '32768' },
    Require: { kind: 'Require', span: SPAN, path: 'sprites.asm' },
    Init: { kind: 'Init', span: SPAN, label: 'setup' },
    BadStmt: { kind: 'BadStmt', span: SPAN },
  };
}
