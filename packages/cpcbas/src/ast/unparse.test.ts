import { describe, expect, it } from 'vitest';
import { SPAN, assign, bin, everyKind, idx, label, let_, line, name, num, printStmt, program, str, type, un } from '../../test/ast-builders.js';
import type { Expr, Node, Stmt } from './ast.js';
import { unparse, unparseExpr, unparseNode } from './unparse.js';

const a = name('a');
const b = name('b');
const c = name('c');

describe('unparse covers every node kind', () => {
  const expected: Record<Node['kind'], string> = {
    Program: 'a = 1',
    Name: 'Score$',
    TypeRef: 'FLOAT',
    LineTarget: '100',
    LabelTarget: 'Start',
    NumberLit: '&FF',
    StringLit: '"say ""hi"""',
    Unary: '-a',
    Binary: 'a + 1',
    AddressOf: '@a(1)',
    CallOrIndex: 't(1, 2)',
    BuiltinCall: 'PEEK(UINTEGER, 100)',
    FnCall: 'FN sq(3)',
    BadExpr: '<bad>',
    ArrayInit: '{1, {2, 3}}',
    LineLabel: '10',
    Let: 'LET a = a * 2',
    MidAssign: 'MID$(s$, 1, 2) = "xy"',
    Dim: 'DIM p, q(9) AS UBYTE',
    DimDecl: 'buf(255) AS UBYTE AT &8000',
    Const: 'CONST max AS INTEGER = 10',
    DefType: 'DEFREAL a-h, x',
    Option: 'OPTION REAL',
    If: 'IF a > 1 THEN\n  a = 1\nELSEIF a < 1 THEN\n  GOTO 10\nELSE\n  a = 1\nEND IF',
    For: 'FOR i = 1 TO 10 STEP 2\n  a = 1\nNEXT i',
    While: 'WHILE a < 5\n  a = 1\nWEND',
    DoLoop: 'DO WHILE a < 5\n  a = 1\nLOOP UNTIL a > 9',
    SelectCase: 'SELECT CASE a\n  CASE 1, 3 TO 9, IS > 10\n    a = 1\n  CASE ELSE\n    GOTO 10\nEND SELECT',
    CaseClause: 'CASE 7\n  a = 1',
    Exit: 'EXIT FOR',
    Continue: 'CONTINUE WHILE',
    Goto: 'GOTO 10',
    Gosub: 'GOSUB Sub1',
    Return: 'RETURN 1',
    OnGoto: 'ON a GOSUB 10, Two',
    OnBreak: 'ON BREAK STOP',
    OnError: 'ON ERROR GOTO Oops',
    Resume: 'RESUME Fix',
    Error: 'ERROR 5',
    End: 'END',
    Stop: 'STOP',
    EveryAfter: 'EVERY 50, 1 GOSUB Tick',
    Call: 'CALL 48000, a',
    Rsx: '|DISC, 1',
    SubCall: 'Foo 1, 2',
    Print: 'PRINT #1, AT 1, 2; USING "##"; TAB(10) SPC(3) a,',
    Write: 'WRITE #9, "a", n',
    Input: 'LINE INPUT "Name"; n$',
    Data: 'DATA 1, "a b"',
    DataValue: 'x y',
    Read: 'READ a, t(1)',
    Restore: 'RESTORE 10',
    Param: 'BYREF v AS UBYTE',
    Procedure: 'FUNCTION FASTCALL Twice(v AS INTEGER = 1) AS INTEGER\n  RETURN v * 2\nEND FUNCTION',
    Declare: 'DECLARE SUB Draw(tiles() AS UBYTE)',
    DefFn: 'DEF FN sq(x) = x * x',
    Builtin: 'SOUND 1, 200, , 15',
    Asm: 'ASM\n    ld a, 1\nEND ASM',
    AsmLine: '    ret',
    Pragma: '#pragma org = 32768',
    Require: '#require "sprites.asm"',
    Init: '#init setup',
    BadStmt: 'REM <bad statement>',
  };

  const set = everyKind();
  for (const kind of Object.keys(set) as Array<Node['kind']>) {
    it(kind, () => {
      expect(unparseNode(set[kind])).toBe(expected[kind]);
    });
  }
});

describe('unparse parenthesises by precedence', () => {
  const text = (e: Expr): string => unparseExpr(e);

  it('(a + b) * c needs parentheses, a + b * c does not', () => {
    expect(text(bin('*', bin('+', a, b), c))).toBe('(a + b) * c');
    expect(text(bin('+', a, bin('*', b, c)))).toBe('a + b * c');
  });

  it('-(2 ^ 2) is -2 ^ 2 (^ binds tighter), (-2) ^ 2 keeps its parentheses', () => {
    expect(text(un('-', bin('^', num(2), num(2))))).toBe('-2 ^ 2');
    expect(text(bin('^', un('-', num(2)), num(2)))).toBe('(-2) ^ 2');
  });

  it('NOT a = b is NOT (a = b); (NOT a) = b keeps its parentheses', () => {
    expect(text(un('NOT', bin('=', a, b)))).toBe('NOT a = b');
    expect(text(bin('=', un('NOT', a), b))).toBe('(NOT a) = b');
    expect(text(un('NOT', bin('AND', a, b)))).toBe('NOT (a AND b)');
  });

  it('a AND (b OR c) keeps its parentheses, (a AND b) OR c loses them', () => {
    expect(text(bin('AND', a, bin('OR', b, c)))).toBe('a AND (b OR c)');
    expect(text(bin('OR', bin('AND', a, b), c))).toBe('a AND b OR c');
  });

  it('is left-associative: a - (b - c) keeps parentheses, (a - b) - c loses them', () => {
    expect(text(bin('-', a, bin('-', b, c)))).toBe('a - (b - c)');
    expect(text(bin('-', bin('-', a, b), c))).toBe('a - b - c');
    expect(text(bin('^', bin('^', num(2), num(3)), num(2)))).toBe('2 ^ 3 ^ 2');
    expect(text(bin('^', num(2), bin('^', num(3), num(2))))).toBe('2 ^ (3 ^ 2)');
  });

  it('covers each level against its neighbours', () => {
    expect(text(bin('+', bin('<<', a, b), c))).toBe('(a << b) + c');
    expect(text(bin('<<', bin('+', a, b), c))).toBe('a + b << c');
    expect(text(bin('=', bin('<<', a, b), c))).toBe('a << b = c');
    expect(text(bin('<<', bin('=', a, b), c))).toBe('(a = b) << c');
    expect(text(bin('XOR', bin('OR', a, b), c))).toBe('a OR b XOR c');
    expect(text(bin('OR', a, bin('XOR', b, c)))).toBe('a OR (b XOR c)');
    expect(text(bin('MOD', a, bin('+', b, c)))).toBe('a MOD (b + c)');
    expect(text(bin('\\', bin('*', a, b), c))).toBe('a * b \\ c');
    expect(text(bin('*', bin('\\', a, b), c))).toBe('(a \\ b) * c');
    expect(text(bin('\\', a, bin('*', b, c)))).toBe('a \\ b * c');
    expect(text(bin('MOD', bin('\\', a, b), c))).toBe('a \\ b MOD c');
    expect(text(bin('\\', bin('MOD', a, b), c))).toBe('(a MOD b) \\ c');
    expect(text(bin('MOD', a, bin('\\', b, c)))).toBe('a MOD b \\ c');
    expect(text(bin('\\', a, bin('\\', b, c)))).toBe('a \\ (b \\ c)');
    expect(text(bin('*', bin('MOD', a, b), c))).toBe('(a MOD b) * c');
  });

  it('unary signs: -a * b, -(a * b), - -a, a * -b, 2 ^ (-1)', () => {
    expect(text(bin('*', un('-', a), b))).toBe('-a * b');
    expect(text(un('-', bin('*', a, b)))).toBe('-(a * b)');
    expect(text(un('-', bin('+', a, b)))).toBe('-(a + b)');
    expect(text(un('-', un('-', a)))).toBe('-(-a)');
    expect(text(bin('*', a, un('-', b)))).toBe('a * -b');
    expect(text(bin('^', num(2), un('-', num(1))))).toBe('2 ^ (-1)');
    expect(text(un('-', un('NOT', a)))).toBe('-(NOT a)');
    expect(text(un('NOT', un('NOT', a)))).toBe('NOT NOT a');
  });

  it('arguments and indexes are not wrapped', () => {
    expect(text(idx('t', bin('+', a, b), un('-', c)))).toBe('t(a + b, -c)');
    expect(text(bin('*', idx('t', a), { kind: 'AddressOf', span: SPAN, target: b }))).toBe('t(a) * @b');
    expect(text({ kind: 'AddressOf', span: SPAN, target: b })).toBe('@b');
  });
});

describe('unparse layout', () => {
  it('ends a program with a newline, one statement per line, empty program is empty', () => {
    expect(unparse(program())).toBe('');
    expect(unparse(program(let_(a, num(1)), printStmt(str('x'), a)))).toBe('a = 1\nPRINT "x" a\n');
  });

  it('indents two spaces per block level, labels in column 0', () => {
    const outer = everyKind().For as Extract<Node, { kind: 'For' }>;
    const inner = { ...outer, nextName: null, variable: name('j') };
    const label10: Stmt = { kind: 'LineLabel', span: SPAN, number: null, name: 'Again', key: 'again' };
    const nested = { ...outer, body: [label10, inner] };
    expect(unparse(program(nested))).toBe(
      'FOR i = 1 TO 10 STEP 2\nAgain:\n  FOR j = 1 TO 10 STEP 2\n    a = 1\n  NEXT\nNEXT i\n',
    );
  });

  it('single-line IF uses : between statements, THEN/ELSE line numbers for implicit GOTO', () => {
    const implicit = (n: number): Stmt => ({ kind: 'Goto', span: SPAN, target: line(n), implicit: true });
    const cond = bin('>', a, num(1));
    const ifLine = (body: Stmt[], elseBody: Stmt[] | null): Stmt => ({
      kind: 'If',
      span: SPAN,
      form: 'line',
      branches: [{ cond, body, span: SPAN }],
      elseBody,
    });
    expect(unparse(program(ifLine([implicit(100)], [implicit(200)])))).toBe('IF a > 1 THEN 100 ELSE 200\n');
    expect(unparse(program(ifLine([let_(b, num(1)), printStmt(b)], [{ kind: 'End', span: SPAN }])))).toBe(
      'IF a > 1 THEN b = 1 : PRINT b ELSE END\n',
    );
    expect(unparse(program(ifLine([{ kind: 'Goto', span: SPAN, target: label('Top'), implicit: false }], null)))).toBe(
      'IF a > 1 THEN GOTO Top\n',
    );
  });

  it('DIM shares one type across declarators only when they share the TypeRef', () => {
    const shared = type('UBYTE');
    const d = (n: string, t: typeof shared | null): Extract<Stmt, { kind: 'Dim' }>['decls'][number] => ({
      kind: 'DimDecl',
      span: SPAN,
      name: name(n),
      bounds: [],
      type: t,
      init: null,
      at: null,
    });
    const dim = (...decls: ReturnType<typeof d>[]): Stmt => ({ kind: 'Dim', span: SPAN, decls });
    expect(unparse(program(dim(d('a', shared), d('b', shared))))).toBe('DIM a, b AS UBYTE\n');
    expect(unparse(program(dim(d('a', type('UBYTE')), d('b', type('UBYTE')))))).toBe('DIM a AS UBYTE, b AS UBYTE\n');
    const withInit = { ...d('a', shared), init: num(1) };
    expect(unparse(program(dim(withInit, d('b', shared))))).toBe('DIM a AS UBYTE = 1, b AS UBYTE\n');
    const arr = { ...d('t', shared), bounds: [num(3)], init: everyKind().ArrayInit as never };
    expect(unparse(program(dim(arr)))).toBe('DIM t(3) AS UBYTE => {1, {2, 3}}\n');
  });

  it('prints built-ins with streams, type arguments and omitted arguments', () => {
    const builtin = (keyword: string, stream: Expr | null, typeArg: ReturnType<typeof type> | null, args: Array<Expr | null>): Stmt => ({
      kind: 'Builtin',
      span: SPAN,
      keyword,
      stream,
      typeArg,
      args,
    });
    expect(unparse(program(builtin('CLS', num(1), null, []), builtin('PEN', num(1), null, [num(2)]), builtin('MODE', null, null, [num(1)])))).toBe(
      'CLS #1\nPEN #1, 2\nMODE 1\n',
    );
    expect(unparse(program(builtin('POKE', null, type('UINTEGER'), [a, num(1)]), builtin('GRAPHICS PEN', null, null, [null, num(1)]), builtin('BEEP', null, null, [])))).toBe(
      'POKE UINTEGER, a, 1\nGRAPHICS PEN , 1\nBEEP\n',
    );
    const pos: Expr = { kind: 'BuiltinCall', span: SPAN, keyword: 'POS', args: [], stream: num(0), typeArg: null, parens: true };
    const inkey: Expr = { kind: 'BuiltinCall', span: SPAN, keyword: 'INKEY$', args: [], stream: null, typeArg: null, parens: false };
    expect(unparseExpr(bin('+', pos, inkey))).toBe('POS(#0) + INKEY$');
  });

  it('prints SUB calls with and without parentheses, RSX with no arguments, RETURN without value', () => {
    const sub = (parens: boolean, args: Expr[]): Stmt => ({ kind: 'SubCall', span: SPAN, name: name('Foo'), args, parens });
    expect(unparse(program(sub(false, []), sub(true, []), sub(true, [num(1)]), { kind: 'Rsx', span: SPAN, name: 'ERA', args: [] }, { kind: 'Return', span: SPAN, value: null }))).toBe(
      'Foo\nFoo()\nFoo(1)\n|ERA\nRETURN\n',
    );
  });

  it('prints INPUT forms, ON ERROR GOTO 0, DEF FN with no parameters, and directive flavours', () => {
    const input = (over: object): Stmt => ({ ...(everyKind().Input as Extract<Stmt, { kind: 'Input' }>), ...over }) as Stmt;
    expect(unparse(program(input({ line: false, prompt: null, promptSep: null, stream: num(1) }), input({ line: false, promptSep: ',' })))).toBe(
      'INPUT #1, n$\nINPUT "Name", n$\n',
    );
    const pragma = (op: 'flag' | 'push' | 'pop'): Stmt => ({ kind: 'Pragma', span: SPAN, op, name: 'explicit', value: null });
    expect(unparse(program({ kind: 'OnError', span: SPAN, target: null }, { kind: 'DefFn', span: SPAN, name: name('k'), params: [], body: num(3) }, pragma('flag'), pragma('push'), pragma('pop')))).toBe(
      'ON ERROR GOTO 0\nDEF FN k = 3\n#pragma explicit\n#pragma push(explicit)\n#pragma pop(explicit)\n',
    );
  });

  it('assign() round trip helper prints an expression statement', () => {
    expect(unparse(assign(bin('+', num(1), num(2))))).toBe('x = 1 + 2\n');
  });
});
