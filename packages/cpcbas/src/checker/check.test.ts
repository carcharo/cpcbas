import { describe, expect, it } from 'vitest';
import type { BinaryExpr, Expr, LetStmt, Stmt } from '../ast/ast.js';
import { walk } from '../ast/walk.js';
import { DiagnosticBag } from '../core/diagnostics.js';
import { SourceSet } from '../core/source.js';
import { bind } from '../binder/index.js';
import { runFrontEnd } from '../pipeline.js';
import type { CheckedProgram, ConstValue } from '../sem/model.js';
import { IMPLEMENTED, check, checkProgram } from './index.js';

interface Run {
  readonly checked: CheckedProgram;
  /** `line:col CODE` of every diagnostic, front end and binder included. */
  readonly where: string[];
  readonly stmts: Stmt[];
}

function run(text: string, opts: { bare?: boolean; subset?: boolean } = {}): Run {
  const sources = new SourceSet();
  const diag = new DiagnosticBag();
  const { program } = runFrontEnd({ files: new Map([['t.bas', text]]), main: 't.bas' }, sources, diag);
  const bound = bind({
    program,
    sources,
    diagnostics: diag,
    bareMetal: opts.bare ?? false,
  });
  const input = { bound, sources, diagnostics: diag };
  const checked = opts.subset === false ? checkProgram(input, { subset: false }) : check(input);
  const where = diag.all().map((d) => {
    const p = sources.position(d.span.file, d.span.start);
    return `${p.line}:${p.col} ${d.code}`;
  });
  return { checked, where, stmts: program.body };
}

/** Diagnostics ignoring warnings the test is not about. */
const errs = (r: Run): string[] => r.where.filter((w) => !/ W30\d$/.test(w));
const later = (text: string, bare = false): Run => run(text, { subset: false, bare });

/** The value expression of the nth top-level LET. */
function letValue(r: Run, n = 0): Expr {
  const lets = r.stmts.filter((s): s is LetStmt => s.kind === 'Let');
  return (lets[n] as LetStmt).value;
}
const typeOf = (r: Run, e: Expr): string | undefined => r.checked.exprTypes.get(e);
const constOf = (r: Run, e: Expr): ConstValue | undefined => r.checked.constants.get(e);

describe('checker basics', () => {
  it('is implemented and ok for a clean program', () => {
    expect(IMPLEMENTED).toBe(true);
    const r = run('a = 1: b$ = "x"\nPRINT a; b$');
    expect(errs(r)).toEqual([]);
    expect(r.checked.ok).toBe(true);
  });
});

describe('types and promotion', () => {
  it('literals take literalType; PRINT 1 < 2 is INTEGER', () => {
    const r = run('a = 40000: b = 1.5: c = &FFFF: d = 70000\nPRINT 1 < 2');
    expect(['INTEGER', 'UINTEGER', 'ULONG'].includes(typeOf(r, letValue(r, 0)) as string)).toBe(true);
    expect(typeOf(r, letValue(r, 0))).toBe('UINTEGER');
    expect(typeOf(r, letValue(r, 1))).toBe('REAL');
    expect(constOf(r, letValue(r, 2))).toEqual({ type: 'INTEGER', value: -1 });
    expect(typeOf(r, letValue(r, 3))).toBe('ULONG');
    const pr = r.stmts.find((s) => s.kind === 'Print');
    if (pr?.kind !== 'Print' || pr.items[0]?.kind !== 'PrintExpr') throw new Error('no print');
    expect(typeOf(r, pr.items[0].expr)).toBe('INTEGER');
    expect(constOf(r, pr.items[0].expr)).toEqual({
      type: 'INTEGER',
      value: -1,
    });
  });

  it('b + 1 is UBYTE and b + 300 is INTEGER for b AS UBYTE', () => {
    const r = run('DIM b AS UBYTE\nx = b + 1\ny = b + 300\nz = 1 + b');
    expect(errs(r)).toEqual([]);
    expect(typeOf(r, letValue(r, 0))).toBe('UBYTE');
    expect(typeOf(r, letValue(r, 1))).toBe('INTEGER');
    expect(typeOf(r, letValue(r, 2))).toBe('UBYTE');
    const lit = (letValue(r, 0) as BinaryExpr).right;
    expect(r.checked.coercions.get(lit)).toBe('UBYTE');
    const big = (letValue(r, 1) as BinaryExpr).left;
    expect(r.checked.coercions.get(big)).toBe('INTEGER');
  });

  it('promotion order and coercion records', () => {
    const r = run('DIM u AS UINTEGER, i AS INTEGER, l AS LONG, f AS FIXED, x AS REAL\na = u + i\nb = i + l\nc = l + f\nd = f + x');
    // UINTEGER with INTEGER: LONG holds both (mixed 16-bit signedness)
    expect(typeOf(r, letValue(r, 0))).toBe('LONG');
    expect(typeOf(r, letValue(r, 1))).toBe('LONG');
    expect(typeOf(r, letValue(r, 2))).toBe('FIXED');
    expect(typeOf(r, letValue(r, 3))).toBe('REAL');
    expect(r.checked.coercions.get((letValue(r, 0) as BinaryExpr).left)).toBe('LONG');
    expect(r.checked.coercions.get((letValue(r, 0) as BinaryExpr).right)).toBe('LONG');
  });

  it('mixed 16-bit signedness: a literal that does not fit INTEGER widens to LONG', () => {
    const r = run(
      'DIM u AS UINTEGER, i AS INTEGER, b AS BYTE\na = i + 40000\nc = i + 1\nd = u + 1\ne = u + -1\nf = b + u\ng = u < i\nh = 32767 + 40000\nCONST k = 1000\nm = k + 40000',
    );
    expect(typeOf(r, letValue(r, 0))).toBe('LONG');
    expect(r.checked.coercions.get((letValue(r, 0) as BinaryExpr).left)).toBe('LONG');
    expect(typeOf(r, letValue(r, 1))).toBe('INTEGER');
    expect(typeOf(r, letValue(r, 2))).toBe('UINTEGER');
    expect(typeOf(r, letValue(r, 3))).toBe('LONG');
    expect(typeOf(r, letValue(r, 4))).toBe('LONG');
    expect(r.checked.coercions.get((letValue(r, 5) as BinaryExpr).left)).toBe('LONG');
    expect(constOf(r, letValue(r, 6))).toEqual({ type: 'LONG', value: 72767 });
    expect(constOf(r, letValue(r, 7))).toEqual({ type: 'LONG', value: 41000 });
  });

  it('mixed 32-bit signedness: ULONG with a signed type is LONG in either order (follow-up 29)', () => {
    const r = run(
      'DIM w AS ULONG, i AS INTEGER, b AS BYTE, l AS LONG, u AS UBYTE\na = w + i\nc = i + w\nd = w + b\ne = l + w\nf = MIN(w, i)\ng = MIN(i, w)\nh = w + 1\nk = w + -1\nm = w + u',
    );
    expect(errs(r)).toEqual([]);
    for (const n of [0, 1, 2, 3, 4, 5, 7]) expect(typeOf(r, letValue(r, n))).toBe('LONG');
    expect(r.checked.coercions.get((letValue(r, 0) as BinaryExpr).left)).toBe('LONG');
    expect(typeOf(r, letValue(r, 6))).toBe('ULONG');
    expect(typeOf(r, letValue(r, 8))).toBe('ULONG');
  });

  it('/ is integer division on integers and real otherwise', () => {
    const r = run('DIM x AS REAL\na = 7 / 2\nb = x / 2\nDIM f AS FIXED\nc = f / 2');
    expect(constOf(r, letValue(r, 0))).toEqual({ type: 'INTEGER', value: 3 });
    expect(typeOf(r, letValue(r, 1))).toBe('REAL');
    expect(typeOf(r, letValue(r, 2))).toBe('FIXED');
  });

  it('^ is always REAL (user decision 2026-11-08; Locomotive prints 2^30 as 1.07374E+09), constants fold to a REAL constant', () => {
    const r = run('DIM n AS INTEGER\na = 2 ^ 3\nb = n ^ 2\nc = 2 ^ -1\nd = 2 ^ 20\ne = 2 ^ 30');
    expect(constOf(r, letValue(r, 0))).toEqual({ type: 'REAL', value: 8 });
    expect(typeOf(r, letValue(r, 0))).toBe('REAL');
    expect(typeOf(r, letValue(r, 1))).toBe('REAL');
    expect(r.checked.coercions.get((letValue(r, 1) as BinaryExpr).left)).toBe('REAL');
    expect(constOf(r, letValue(r, 2))).toEqual({ type: 'REAL', value: 0.5 });
    expect(constOf(r, letValue(r, 3))).toEqual({ type: 'REAL', value: 1048576 });
    expect(constOf(r, letValue(r, 4))).toEqual({ type: 'REAL', value: 1073741824 });
  });

  it('DIM t(2^8) and CONST n AS INTEGER = 2^8 keep working with a REAL ^', () => {
    const r = run('CONST n AS INTEGER = 2 ^ 8\nDIM t(2 ^ 8) AS UBYTE\nDIM u(n) AS UBYTE');
    expect(errs(r)).toEqual([]);
    const k = r.checked.bound.symbols.findIndex((x) => x.name === 'n');
    expect(r.checked.constValues.get(k as never)).toEqual({ type: 'INTEGER', value: 256 });
  });

  it('unary minus on unsigned gives the next signed type', () => {
    const r = run('DIM b AS UBYTE, u AS UINTEGER, l AS ULONG\na = -b\nc = -u\nd = -l');
    expect(typeOf(r, letValue(r, 0))).toBe('INTEGER');
    expect(typeOf(r, letValue(r, 1))).toBe('LONG');
    expect(typeOf(r, letValue(r, 2))).toBe('LONG');
  });

  it('a negative literal is typed by its value: -32768 is INTEGER', () => {
    const r = run('a = -32768: b = -40000');
    expect(constOf(r, letValue(r, 0))).toEqual({
      type: 'INTEGER',
      value: -32768,
    });
    expect(constOf(r, letValue(r, 1))).toEqual({ type: 'LONG', value: -40000 });
  });

  it('comparisons and logic are INTEGER, AND/OR/XOR/NOT bitwise', () => {
    const r = run('a = 10 AND 6: b = 10 OR 6: c = 10 XOR 6: d = NOT 0: e = 3 > 2 AND 1 < 2');
    expect(constOf(r, letValue(r, 0))?.value).toBe(2);
    expect(constOf(r, letValue(r, 1))?.value).toBe(14);
    expect(constOf(r, letValue(r, 2))?.value).toBe(12);
    expect(constOf(r, letValue(r, 3))?.value).toBe(-1);
    expect(constOf(r, letValue(r, 4))?.value).toBe(-1);
  });

  it('AND on a real converts it to INTEGER with W242', () => {
    const r = run('x! = 1.5\ny = x! AND 3');
    expect(errs(r)).toEqual(['2:5 W242']);
    expect(r.checked.coercions.get((letValue(r, 1) as BinaryExpr).left)).toBe('INTEGER');
    expect(r.checked.ok).toBe(true);
  });

  it('\\ and MOD on reals warn and convert', () => {
    const r = run('x! = 7.5\ny = x! \\ 2\nz = x! MOD 2');
    expect(errs(r)).toEqual(['2:5 W242', '3:5 W242']);
  });

  it('shifts keep the left type', () => {
    const r = run('DIM b AS UBYTE\na = b << 1\nc = 1 << 4\nd = -16 >> 2');
    expect(typeOf(r, letValue(r, 0))).toBe('UBYTE');
    expect(constOf(r, letValue(r, 1))).toEqual({ type: 'INTEGER', value: 16 });
    expect(constOf(r, letValue(r, 2))?.value).toBe(-4);
  });

  it('string + and comparisons', () => {
    const r = run('a$ = "ab" + "cd"\nb = "a" < "b"\nc = a$ = "x"');
    expect(errs(r)).toEqual([]);
    expect(constOf(r, letValue(r, 0))).toEqual({
      type: 'STRING',
      value: 'abcd',
    });
    expect(constOf(r, letValue(r, 1))?.value).toBe(-1);
    expect(typeOf(r, letValue(r, 2))).toBe('INTEGER');
  });

  it('E230: string with number, string minus, string condition', () => {
    expect(errs(run('a$ = "x" + 1'))).toEqual(['1:6 E230']);
    expect(errs(run('x = 1 + "a"'))).toEqual(['1:5 E230']);
    expect(errs(run('a$ = "x" - "y"'))).toEqual(['1:6 E230']);
    expect(errs(run('a$ = "x"\nIF a$ THEN PRINT 1'))).toEqual(['2:4 E230']);
    expect(errs(run('a$ = "x"\nWHILE a$\nWEND'))).toEqual(['2:7 E230']);
    expect(errs(run('x = 1: x = "a"'))).toEqual(['1:12 E230']);
    expect(errs(run('a$ = 5'))).toEqual(['1:6 E230']);
    expect(errs(run('x = -"a"'))).toEqual(['1:6 E230']);
  });

  it('passing: IF with a number, a numeric condition', () => {
    expect(errs(run('a = 1\nIF a THEN PRINT 1'))).toEqual([]);
  });
});

describe('constants and folding', () => {
  it('CONST k = 7 \\ 2 * 3 is 1 (* binds tighter than \\); -7 MOD 3 is -1', () => {
    const r = run('CONST k = 7 \\ 2 * 3\nCONST m = -7 MOD 3\nCONST n = 7 MOD -3\nCONST p = 2 + 3 MOD 2 * 5\nCONST q = 9 MOD 4 \\ 2');
    const vals = [...r.checked.constValues.values()];
    expect(vals).toEqual([
      { type: 'INTEGER', value: 1 },
      { type: 'INTEGER', value: -1 },
      { type: 'INTEGER', value: 1 },
      { type: 'INTEGER', value: 5 },
      { type: 'INTEGER', value: 1 },
    ]);
  });

  it('&FFFF + 1 folds to 0 in INTEGER; wrapping', () => {
    const r = run('a = &FFFF + 1\nb = 32767 + 1\nc = 200 * 200');
    expect(constOf(r, letValue(r, 0))).toEqual({ type: 'INTEGER', value: 0 });
    expect(constOf(r, letValue(r, 1))).toEqual({
      type: 'INTEGER',
      value: -32768,
    });
    expect(constOf(r, letValue(r, 2))).toEqual({
      type: 'INTEGER',
      value: 200 * 200 - 65536,
    });
  });

  it('truncating division', () => {
    const r = run('a = -7 \\ 2: b = 7 \\ -2: c = -7 / 2');
    expect(constOf(r, letValue(r, 0))?.value).toBe(-3);
    expect(constOf(r, letValue(r, 1))?.value).toBe(-3);
    expect(constOf(r, letValue(r, 2))?.value).toBe(-3);
  });

  it('CONST uses other CONSTs, even declared later, and conversions', () => {
    const r = run('CONST a = b + 1\nCONST b = 4\nCONST c AS UBYTE = 300\nCONST s$ = "x" + "y"');
    expect(errs(r)).toEqual([]);
    const byName = (n: string): ConstValue | undefined => r.checked.constValues.get(r.checked.bound.symbols.findIndex((x) => x.name === n) as never);
    expect(byName('a')).toEqual({ type: 'INTEGER', value: 5 });
    expect(byName('b')).toEqual({ type: 'INTEGER', value: 4 });
    expect(byName('c')).toEqual({ type: 'UBYTE', value: 44 });
    expect(byName('s')).toEqual({ type: 'STRING', value: 'xy' });
  });

  it('E243 for a non-constant CONST; cycles are E243 once', () => {
    expect(errs(run('x = 1\nCONST c = x + 1'))).toEqual(['2:11 E243']);
    expect(errs(run('CONST a = b\nCONST b = a'))).toEqual(['1:7 E243']);
  });

  it('CONST of built-in functions of constants (values from the manual and measured on the interpreter)', () => {
    const cases: [string, ConstValue][] = [
      ['ABS(-3)', { type: 'INTEGER', value: 3 }],
      ['SGN(-5)', { type: 'INTEGER', value: -1 }],
      ['SGN(0)', { type: 'INTEGER', value: 0 }],
      ['MIN(3, 1, 2)', { type: 'INTEGER', value: 1 }],
      ['MAX(3, 1, 2)', { type: 'INTEGER', value: 3 }],
      ['CINT(2.5)', { type: 'INTEGER', value: 3 }],
      ['CINT(-2.5)', { type: 'INTEGER', value: -3 }],
      ['UNT(&H8000)', { type: 'INTEGER', value: -32768 }],
      ['LEN("abc")', { type: 'UINTEGER', value: 3 }],
      ['ASC("A")', { type: 'UBYTE', value: 65 }],
      ['CHR$(65)', { type: 'STRING', value: 'A' }],
      ['LEFT$("hello", 2)', { type: 'STRING', value: 'he' }],
      ['RIGHT$("hello", 3)', { type: 'STRING', value: 'llo' }],
      ['MID$("hello", 2, 3)', { type: 'STRING', value: 'ell' }],
      ['MID$("hello", 4)', { type: 'STRING', value: 'lo' }],
      ['SPACE$(3)', { type: 'STRING', value: '   ' }],
      ['STRING$(3, "x")', { type: 'STRING', value: 'xxx' }],
      ['STRING$(2, 65)', { type: 'STRING', value: 'AA' }],
      ['STR$(5)', { type: 'STRING', value: ' 5' }],
      ['STR$(-5)', { type: 'STRING', value: '-5' }],
    ];
    for (const [expr, want] of cases) {
      const r = run(`CONST k = ${expr}`);
      expect(errs(r), expr).toEqual([]);
      const id = r.checked.bound.symbols.findIndex((x) => x.name === 'k');
      expect(r.checked.constValues.get(id as never), expr).toEqual(want);
    }
  });

  it('a built-in call the run-time routine rejects, or text this fold does not produce, is not a constant (E243)', () => {
    for (const expr of ['ASC("")', 'CHR$(256)', 'LEFT$("a", -1)', 'MID$("abc", 0)', 'STR$(1.5)', 'CINT(40000.5)']) {
      expect(errs(run(`CONST k = ${expr}`)), expr).toEqual(['1:11 E243']);
    }
  });

  it('E235 for a constant zero divisor', () => {
    expect(errs(run('x = 5 / 0'))).toEqual(['1:9 E235']);
    expect(errs(run('x = 5\ny = x \\ 0'))).toEqual(['2:9 E235']);
    expect(errs(run('x = 5 MOD (3 - 3)'))).toEqual(['1:12 E235']);
    expect(errs(run('x = 5 / 2'))).toEqual([]);
  });

  it('E234 for a % literal outside INTEGER', () => {
    expect(errs(run('x = 40000%'))).toEqual(['1:5 E234']);
    expect(errs(run('x = 32767%: y = -32768%'))).toEqual([]);
  });

  it('CAST and SIZEOF fold', () => {
    const r = run('a = CAST(UBYTE, 300)\nb = SIZEOF(LONG)\nc = SIZEOF(REAL)');
    expect(constOf(r, letValue(r, 0))).toEqual({ type: 'UBYTE', value: 44 });
    expect(constOf(r, letValue(r, 1))?.value).toBe(4);
    expect(constOf(r, letValue(r, 2))?.value).toBe(5);
    expect(errs(run('a$ = CAST(STRING, 1)'))).toEqual(['1:19 E230']);
  });

  it('DIM bounds, AT addresses and initialisers are folded (beyond the subset)', () => {
    const r = later('CONST n = 3\nDIM a(n, 2 * 2) AS UBYTE\nDIM b(2) AS INTEGER => {1, 2, 70000}\nDIM c AS UBYTE = 300 AT &8000');
    expect(errs(r)).toEqual([]);
    const syms = r.checked.bound.symbols;
    const id = (name: string): number => syms.findIndex((s) => s.name === name);
    expect(r.checked.arrayBounds.get(id('a') as never)).toEqual([3, 4]);
    expect(r.checked.arrayBounds.get(id('b') as never)).toEqual([2]);
    expect(r.checked.initialValues.get(id('b') as never)?.map((v) => v.value)).toEqual([1, 2, 70000 - 65536]);
    expect(r.checked.initialValues.get(id('c') as never)).toEqual([{ type: 'UBYTE', value: 44 }]);
    expect(r.checked.atAddresses.get(id('c') as never)).toBe(0x8000);
  });

  it('E233 for a bad bound, E243 for a non-constant AT, E246 for too many values', () => {
    expect(errs(later('n = 3\nDIM a(n)'))).toEqual(['2:7 E233']);
    expect(errs(later('DIM a(-1)'))).toEqual(['1:7 E233']);
    expect(errs(later('DIM a("x")'))).toEqual(['1:7 E233']);
    expect(errs(later('n = 3\nDIM c AS UBYTE AT n'))).toEqual(['2:19 E243']);
    expect(errs(later('DIM a(1) AS UBYTE => {1, 2, 3}'))).toEqual(['1:22 E246']);
    expect(errs(later('x = 1\nDIM c AS UBYTE = x'))).toEqual(['2:18 E243']);
  });
});

describe('lvalues', () => {
  it('E232 for CONST, FUNCTION name outside its body, call', () => {
    expect(errs(run('CONST k = 1\nk = 2'))).toEqual(['2:1 E232']);
    expect(errs(run('FUNCTION f() AS INTEGER\nf = 1\nEND FUNCTION\nf = 2'))).toEqual(['4:1 E202']);
    expect(errs(run('FUNCTION f() AS INTEGER\nf = 1\nEND FUNCTION\nx = f()'))).toEqual([]);
    expect(errs(run('CONST k = 1\nREAD k\nDATA 1'))).toEqual(['2:6 E232']);
    expect(errs(run('FOR i = 1 TO 2: NEXT'))).toEqual([]);
  });
});

describe('procedures and calls', () => {
  const sub = 'SUB p(a AS INTEGER, BYREF b AS INTEGER, c AS INTEGER = 5)\nEND SUB\n';
  it('E231 argument count, defaults allowed', () => {
    expect(errs(run(`${sub}x = 0: p 1, x`))).toEqual([]);
    expect(errs(run(`${sub}x = 0: p 1, x, 2`))).toEqual([]);
    expect(errs(run(`${sub}x = 0: p 1`))).toEqual(['3:8 E231']);
    expect(errs(run(`${sub}x = 0: p 1, x, 2, 3`))).toEqual(['3:8 E231']);
  });

  it('E236 BYREF argument', () => {
    expect(errs(run(`${sub}p 1, 2`))).toEqual(['3:6 E236']);
    expect(errs(run(`${sub}x! = 1: p 1, x!`))).toEqual(['3:14 E236']);
    expect(errs(run(`${sub}x = 1: p 1, x`))).toEqual([]);
  });

  it('E239 SUB in an expression, FUNCTION as a statement', () => {
    expect(errs(run('SUB s()\nEND SUB\nx = s()'))).toEqual(['3:5 E239']);
    expect(errs(run('FUNCTION f() AS INTEGER\nf = 1\nEND FUNCTION\nf'))).toEqual(['4:1 E239']);
  });

  it('argument types are checked and converted', () => {
    const r = run('SUB p(a AS UBYTE, s AS STRING)\nEND SUB\np 7, "x"\np "x", "y"\np 1, 2');
    expect(errs(r)).toEqual(['4:3 E230', '5:6 E230']);
  });

  it('FUNCTION results: RETURN value, name assignment, wrong type', () => {
    const ok = 'FUNCTION f(a AS INTEGER) AS LONG\nRETURN a * 2\nEND FUNCTION\nx = f(3)';
    const r = run(ok);
    expect(errs(r)).toEqual([]);
    expect(typeOf(r, letValue(r, 0))).toBe('LONG');
    expect(errs(run('FUNCTION f() AS INTEGER\nRETURN "a"\nEND FUNCTION'))).toEqual(['2:8 E230']);
  });

  it('GOSUB inside a procedure is allowed; E251 for RETURN alone in a procedure with no GOSUB', () => {
    expect(errs(run('SUB s()\nGOSUB 10\nEXIT SUB\n10 RETURN\nEND SUB'))).toEqual([]);
    expect(errs(run('FUNCTION f() AS INTEGER\nON 1 GOSUB 10\nEXIT FUNCTION\n10 RETURN\nEND FUNCTION'))).toEqual([]);
    expect(errs(run('SUB s()\nIF 1 THEN RETURN\nEND SUB'))).toEqual(['2:11 E251']);
    expect(errs(run('FUNCTION f() AS INTEGER\nRETURN\nEND FUNCTION'))).toEqual(['2:1 E251']);
    // the GOSUB may come after the RETURN; one in another procedure does not count
    expect(errs(run('SUB s()\nIF 0 THEN RETURN\nGOSUB 10\nEXIT SUB\n10 RETURN\nEND SUB'))).toEqual([]);
    expect(errs(run('SUB a()\nGOSUB 10\nEXIT SUB\n10 RETURN\nEND SUB\nSUB b()\nRETURN\nEND SUB'))).toEqual(['7:1 E251']);
    expect(errs(run('GOSUB 10\nEND\n10 RETURN\nSUB s()\nEXIT SUB\nEND SUB'))).toEqual([]);
  });

  it('E238 RETURN with a value outside a FUNCTION', () => {
    expect(errs(run('GOSUB 10\nEND\n10 RETURN 5'))).toEqual(['3:4 E238']);
    expect(errs(run('SUB s()\nRETURN 1\nEND SUB'))).toEqual(['2:1 E238']);
    expect(errs(run('GOSUB 10\nEND\n10 RETURN'))).toEqual([]);
  });

  it('DEF FN: count and types', () => {
    const def = 'DEF FNdbl(x) = x * 2\nDEF FNs$(a$) = a$ + "!"\n';
    expect(errs(run(`${def}y = FNdbl(3)`))).toEqual([]);
    expect(errs(run(`${def}y = FNdbl(3, 4)`))).toEqual(['3:5 E231']);
    expect(errs(run(`${def}y = FNdbl("a")`))).toEqual(['3:11 E230']);
    expect(errs(run(`${def}y = FNs$("a")`))).toEqual(['3:5 E230']);
    expect(errs(run(`${def}b$ = FNs$("a")`))).toEqual([]);
  });

  it('E240 array index count (beyond the subset)', () => {
    expect(errs(later('DIM a(3, 3)\nx = a(1)'))).toEqual(['2:5 E240']);
    expect(errs(later('DIM a(3, 3)\nx = a(1, 2)'))).toEqual([]);
    expect(errs(later('DIM a(3)\na(1, 2) = 5'))).toEqual(['2:1 E240']);
    expect(errs(later('DIM a(3)\nx = a("q")'))).toEqual(['2:7 E230']);
  });
});

describe('EXIT and CONTINUE', () => {
  it('finds the enclosing block and records it', () => {
    const r = run('FOR i = 1 TO 3\nWHILE 1\nEXIT WHILE\nWEND\nCONTINUE FOR\nNEXT');
    expect(errs(r)).toEqual([]);
    const targets = [...r.checked.loopTargets.entries()].map(([s, t]) => `${s.kind}->${t.kind}`);
    expect(targets).toEqual(['Exit->While', 'Continue->For']);
  });

  it('E237 without a matching block', () => {
    expect(errs(run('EXIT FOR'))).toEqual(['1:1 E237']);
    expect(errs(run('WHILE 1\nEXIT FOR\nWEND'))).toEqual(['2:1 E237']);
    expect(errs(run('SUB s()\nEXIT FUNCTION\nEND SUB'))).toEqual(['2:1 E237']);
    expect(errs(run('SUB s()\nEXIT SUB\nEND SUB'))).toEqual([]);
    expect(errs(run('DO\nCONTINUE WHILE\nLOOP'))).toEqual(['2:1 E237']);
  });
});

describe('CALL', () => {
  it('converts arguments to UINTEGER and accepts @var', () => {
    const r = run('a = 5: s$ = "x"\nCALL &8000, 1, a, @s$, 70000, 1.5');
    expect(errs(r)).toEqual([]);
    const call = r.stmts.find((s) => s.kind === 'Call');
    if (call?.kind !== 'Call') throw new Error('no call');
    expect(r.checked.coercions.get(call.address)).toBe('UINTEGER');
    expect(r.checked.coercions.get(call.args[1] as Expr)).toBe('UINTEGER');
    expect(r.checked.coercions.get(call.args[4] as Expr)).toBe('UINTEGER');
  });

  it('a string expression is a CALL argument (a descriptor, built by the lowering since L3-ADDR)', () => {
    expect(errs(run('s$ = "x"\nCALL &8000, s$'))).toEqual([]);
    expect(errs(run('CALL &8000, "x"'))).toEqual([]);
    expect(errs(run('s$ = "x"\nCALL &8000, @s$'))).toEqual([]);
    expect(errs(run('CALL &8000, "x"', { subset: false }))).toEqual([]);
  });

  it('firmware range: allowed in firmware mode, E271 in bare mode; other addresses fine', () => {
    expect(errs(run('CALL &BB18'))).toEqual([]);
    expect(errs(run('CALL &BB18', { bare: true }))).toEqual(['1:6 E271']);
    expect(errs(run('CALL &BD19', { bare: true }))).toEqual(['1:6 E271']);
    expect(errs(run('CALL &B900', { bare: true }))).toEqual(['1:6 E271']);
    expect(errs(run('CALL &B8FF', { bare: true }))).toEqual([]);
    expect(errs(run('CALL &BE00', { bare: true }))).toEqual([]);
    expect(errs(run('a = &BB18\nCALL a', { bare: true }))).toEqual([]);
  });
});

describe('bare mode', () => {
  it('SOUND is E270 at SOUND (and not E002)', () => {
    const r = run('SOUND 1, 100', { bare: true });
    expect(errs(r)).toEqual(['1:1 E270']);
    expect(r.checked.ok).toBe(false);
  });

  it('SOUND in firmware mode compiles (L4-SOUND)', () => {
    expect(errs(run('SOUND 1, 100'))).toEqual([]);
  });

  it('the E270 hint comes from the keyword note', () => {
    const sources = new SourceSet();
    const diag = new DiagnosticBag();
    const { program } = runFrontEnd({ files: new Map([['t.bas', 'SOUND 1, 100']]), main: 't.bas' }, sources, diag);
    check({
      bound: bind({ program, sources, diagnostics: diag, bareMetal: true }),
      sources,
      diagnostics: diag,
    });
    const d = diag.all().find((x) => x.code === 'E270');
    expect(d?.hint).toContain('music/sfx library');
    expect(d?.message).toContain('SOUND');
  });

  it('firmware functions are E270; the text statements compile in bare mode too (L2-BARE)', () => {
    expect(errs(run('x = SQ(1)', { bare: true }))).toEqual(['1:5 E270']);
    expect(errs(run('LOCATE 1, 1\nMODE 1\nCLS\nPEN 1\nPAPER 0\nBORDER 2', { bare: true }))).toEqual([]);
    expect(errs(run('x = POS(#0)\ny = VPOS(#0)', { bare: true }))).toEqual([]);
    expect(errs(run('LOCATE 1, 1\nMODE 1\nCLS\nx = POS(#0)'))).toEqual([]);
  });

  it('RSX statements are E272 in bare mode', () => {
    expect(errs(run('|DISC', { bare: true }))).toEqual(['1:1 E272']);
  });
});

describe('the L2 subset gate', () => {
  it('statements and functions outside it are E002 at the keyword', () => {
    expect(errs(run('x$ = HEX$(255)\ns$ = "ab"\nMID$(s$, 1, 1) = "x"'))).toEqual([]);
    expect(errs(run('|MYCMD'))).toEqual(['1:1 E002']);
    expect(errs(run('EVERY 50 GOSUB 10\n10 RETURN'))).toEqual([]); // compiled since L4-EVENTS
  });

  it('PRINT #9 passes since L4-FILES; arrays, local arrays and array parameters pass (L3-ARR-PROC)', () => {
    expect(errs(run('DIM a(3)'))).toEqual([]);
    expect(errs(run('SUB s()\nDIM a(3)\nEND SUB'))).toEqual([]);
    expect(errs(run('SUB s(a() AS INTEGER)\nEND SUB'))).toEqual([]);
    expect(errs(run('PRINT #9, "x"'))).toEqual([]);
    expect(errs(run('PRINT #0, "x"'))).toEqual([]);
  });

  it('streams, windows, SYMBOL, ZONE, WIDTH, PRINT USING and COPYCHR$ compile (L4-TEXT)', () => {
    expect(errs(run('PRINT USING "###"; 5'))).toEqual([]);
    expect(errs(run('PRINT #1, "x"\nPRINT #8, "x"\nLOCATE #1, 1, 1\nCLS #2\nPEN #3, 1\nPAPER #4, 0'))).toEqual([]);
    expect(errs(run('WINDOW 1, 20, 1, 5\nWINDOW #1, 1, 20, 1, 5\nWINDOW SWAP 1, 2\nWINDOW SWAP 1\nTAG\nTAG #1\nTAGOFF #1'))).toEqual([]);
    expect(errs(run('SYMBOL AFTER 200\nSYMBOL 250, 1, 2, 3\nZONE 5\nWIDTH 80'))).toEqual([]);
    expect(errs(run('x$ = COPYCHR$(#0)\ny = POS(#8)\nz = VPOS(#3)\ns = 2\nPRINT #s, "x"\ny = POS(#s)'))).toEqual([]);
  });

  it('a stream that cannot be used here is E262; SYMBOL AFTER wants one constant; PRINT USING wants a value (L4-TEXT)', () => {
    expect(errs(run('PRINT #10, "x"'))).toEqual(['1:8 E262']);
    expect(errs(run('LOCATE #8, 1, 1'))).toEqual(['1:9 E262']);
    expect(errs(run('x$ = COPYCHR$(#8)'))).toEqual(['1:16 E262']);
    expect(errs(run('x = VPOS(#8)'))).toEqual(['1:11 E262']);
    expect(errs(run('x = POS(#9)'))).toEqual([]);
    expect(errs(run('x = VPOS(#9)'))).toEqual(['1:11 E262']);
    expect(errs(run('INPUT #8, a$'))).toEqual(['1:8 E262']);
    expect(errs(run('n = 5\nSYMBOL AFTER n'))).toEqual(['2:14 E263']);
    expect(errs(run('SYMBOL AFTER 257'))).toEqual(['1:14 E263']);
    expect(errs(run('SYMBOL AFTER 200\nSYMBOL AFTER 200'))).toEqual([]);
    expect(errs(run('SYMBOL AFTER 200\nSYMBOL AFTER 100'))).toEqual(['2:14 E264']);
    expect(errs(run('PRINT USING "###"'))).toEqual(['1:7 E265']);
    expect(errs(run('PRINT USING "###";'))).toEqual(['1:7 E265']);
  });

  it('the streams 1-9 and the window statements are E270 in a bare build (L4-TEXT)', () => {
    expect(errs(run('PRINT #1, "x"', { bare: true }))).toEqual(['1:8 E270']);
    expect(errs(run('PRINT #8, "x"', { bare: true }))).toEqual(['1:8 E270']);
    expect(errs(run('LOCATE #2, 1, 1', { bare: true }))).toEqual(['1:9 E270']);
    expect(errs(run('x = POS(#1)', { bare: true }))).toEqual(['1:10 E270']);
    expect(errs(run('WINDOW 1, 2, 3, 4', { bare: true }))).toEqual(['1:1 E270']);
    expect(errs(run('TAG', { bare: true }))).toEqual(['1:1 E270']);
    expect(errs(run('x$ = COPYCHR$(#0)', { bare: true }))).toEqual(['1:6 E270']);
    expect(errs(run('WIDTH 80', { bare: true }))).toEqual(['1:1 E270']);
    expect(errs(run('PRINT #0, "x"\ns = 0\nPRINT #s, "y"\nx = POS(#0)', { bare: true }))).toEqual([]);
    expect(errs(run('SYMBOL AFTER 200\nSYMBOL 250, 1\nZONE 5\nPRINT USING "##"; 5', { bare: true }))).toEqual([]);
  });

  it('everything listed in the subset passes', () => {
    const prog = [
      'OPTION REAL',
      'DEFINT a-c',
      'CONST k = 3',
      'DIM n AS UBYTE = 5',
      'DEF FNf(x) = x + 1',
      'a = 1: s$ = "hi"',
      'IF a THEN PRINT s$; k, TAB(3); SPC(2)',
      'FOR i = 1 TO 3 STEP 1: NEXT',
      'WHILE a < 3: a = a + 1: WEND',
      'DO WHILE a < 5: a = a + 1: LOOP',
      'SELECT CASE a',
      'CASE 1, 2',
      'CASE 3 TO 5',
      'CASE IS > 5',
      'CASE ELSE',
      'END SELECT',
      'ON a GOSUB 100, 100',
      'LOCATE 1, 2: MODE 1: PEN 1: PAPER 0: BORDER 1: CLS: POKE &C000, 1',
      'x = PEEK(&C000) + LEN(s$) + ASC(s$) + SGN(a) + ABS(a) + MIN(a, 3) + MAX(a, 3)',
      't$ = LEFT$(s$, 1) + RIGHT$(s$, 1) + MID$(s$, 1, 1) + CHR$(65) + STR$(a) + SPACE$(2) + STRING$(2, "x") + INKEY$',
      'y = CINT(1.5) + UNT(5) + CAST(INTEGER, 2.5) + SIZEOF(INTEGER) + FNf(1)',
      'z = POS(#0) + VPOS(#0) + INSTR(s$, "i") + INSTR(2, s$, "i")',
      'u$ = UPPER$(s$) + LOWER$(s$)',
      'RESTORE: READ a: DATA 1',
      'CALL &8000, 1',
      'GOTO 200',
      '100 RETURN',
      '200 END',
    ].join('\n');
    const r = run(prog);
    expect(errs(r)).toEqual([]);
  });

  it('check() keeps L3 checks reachable through checkProgram', () => {
    expect(errs(later('DIM a(3)\na(1) = 2'))).toEqual([]);
  });
});

describe('SELECT CASE', () => {
  it('string subject with number case is E230; common type is recorded', () => {
    expect(errs(run('a$ = "x"\nSELECT CASE a$\nCASE 1\nEND SELECT'))).toEqual(['3:6 E230']);
    const r = run('DIM b AS UBYTE\nSELECT CASE b\nCASE 1, 300\nEND SELECT');
    const sel = r.stmts.find((s) => s.kind === 'SelectCase');
    if (sel?.kind !== 'SelectCase') throw new Error('no select');
    expect(r.checked.coercions.get(sel.subject)).toBe('INTEGER');
  });
});

describe('unreachable code', () => {
  it('W320 after GOTO/END without a label; a label or declaration resets', () => {
    expect(errs(run('GOTO 10\nPRINT 1\n10 END'))).toEqual(['2:1 W320']);
    expect(errs(run('GOTO 10\n10 PRINT 1\nEND'))).toEqual([]);
    expect(errs(run('END\nDATA 1\nSUB s()\nEND SUB'))).toEqual([]);
    expect(errs(run('FOR i = 1 TO 2\nEXIT FOR\nPRINT i\nNEXT'))).toEqual(['3:1 W320']);
  });
});

describe('robustness', () => {
  it('never throws on programs the binder rejects', () => {
    for (const t of ['x = y(1)', 'FOO 1, 2', 'x = FNnone(1)', 'DIM a$ AS INTEGER', 'GOTO 99', 'x = ', 'IF THEN', 'a(1) = 2', '@']) {
      expect(() => run(t)).not.toThrow();
    }
  });

  it('walks every statement kind without exceptions (beyond the subset)', () => {
    const t = [
      'DIM a(2) AS INTEGER',
      'INPUT "p"; x, a(1)',
      's$ = "abc": MID$(s$, 1, 1) = "x"',
      'ON ERROR GOTO 10',
      'EVERY 5, 1 GOSUB 10',
      'ERROR 3',
      'PRINT USING "#"; 1; AT 1, 2',
      '|X, 1',
      'SOUND 1, 2',
      '10 RETURN',
    ].join('\n');
    expect(() => later(t)).not.toThrow();
  });

  it('exprTypes covers every accepted expression of a mixed program', () => {
    const r = run('a = 1: b = a * 2 + 3: PRINT b > a; "x" + "y"');
    let n = 0;
    walk(
      {
        kind: 'Program',
        body: r.stmts,
        includes: [],
        mainFile: null,
        span: { file: 0 as never, start: 0, end: 0 },
      },
      (node) => {
        if (node.kind === 'Binary' || node.kind === 'NumberLit' || node.kind === 'StringLit') {
          n++;
          expect(r.checked.exprTypes.has(node as Expr)).toBe(true);
        }
      },
    );
    expect(n).toBeGreaterThan(5);
  });
});
