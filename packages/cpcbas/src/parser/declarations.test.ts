import { describe, expect, it } from 'vitest';
import { parseSource, sexp } from '../../test/parse-helpers.js';
import type { ArrayInit, ConstStmt, DeclareStmt, DefFnStmt, DefTypeStmt, DimStmt, OptionStmt, ProcedureDecl, Stmt } from '../ast/ast.js';

function ok(text: string): Stmt[] {
  const p = parseSource(text);
  expect(p.where).toEqual([]);
  return p.program.body.filter((s) => s.kind !== 'LineLabel');
}

function dim(text: string): DimStmt {
  const s = ok(text)[0];
  expect(s?.kind).toBe('Dim');
  return s as DimStmt;
}

function proc(text: string): ProcedureDecl {
  const s = ok(text)[0];
  expect(s?.kind).toBe('Procedure');
  return s as ProcedureDecl;
}

const init = (e: unknown): string => {
  const a = e as ArrayInit;
  return a.kind === 'ArrayInit' ? `{${a.elements.map(init).join(' ')}}` : sexp(e as never);
};

describe('DIM', () => {
  it('a scalar with and without a type', () => {
    const d = dim('DIM lives AS UBYTE');
    expect(d.decls).toHaveLength(1);
    expect(d.decls[0]?.name.text).toBe('lives');
    expect(d.decls[0]?.type?.name).toBe('UBYTE');
    expect(d.decls[0]?.bounds).toEqual([]);
    expect(dim('DIM x').decls[0]?.type).toBeNull();
  });
  it('FLOAT is REAL and keeps its spelling', () => {
    const t = dim('DIM a AS FLOAT').decls[0]?.type;
    expect([t?.name, t?.text]).toEqual(['REAL', 'FLOAT']);
  });
  it('suffixed names', () => {
    const d = dim('DIM s$, n%, r!');
    expect(d.decls.map((x) => x.name.suffix)).toEqual(['$', '%', '!']);
  });
  it('DIM a, b AS UBYTE shares one TypeRef', () => {
    const d = dim('DIM a, b AS UBYTE');
    expect(d.decls[0]?.type).not.toBeNull();
    expect(d.decls[0]?.type).toBe(d.decls[1]?.type);
  });
  it('a type only reaches the names before it that had none', () => {
    const d = dim('DIM p AS UBYTE, q, r AS INTEGER, z');
    expect(d.decls.map((x) => x.type?.name ?? null)).toEqual(['UBYTE', 'INTEGER', 'INTEGER', null]);
    expect(d.decls[1]?.type).toBe(d.decls[2]?.type);
  });
  it('separate AS per name gives separate TypeRefs', () => {
    const d = dim('DIM x AS INTEGER, y AS INTEGER');
    expect(d.decls[0]?.type).not.toBe(d.decls[1]?.type);
  });
  it('bounds: one to four and more', () => {
    expect(dim('DIM buf(255) AS UBYTE').decls[0]?.bounds.map(sexp)).toEqual(['255']);
    expect(dim('DIM m(3, 4) AS INTEGER').decls[0]?.bounds.map(sexp)).toEqual(['3', '4']);
    expect(dim('DIM c(2, 2, 2, 2) AS UBYTE').decls[0]?.bounds).toHaveLength(4);
    expect(dim('DIM c(1, 1, 1, 1, 1)').decls[0]?.bounds).toHaveLength(5);
    expect(dim('DIM a(n + 1)').decls[0]?.bounds.map(sexp)).toEqual(['(+ n 1)']);
  });
  it('= expr', () => {
    const d = dim('DIM scale AS REAL = 1.5 * 2').decls[0];
    expect(d?.init && sexp(d.init as never)).toBe('(* 1.5 2)');
    expect(d?.type?.name).toBe('REAL');
  });
  it('=> {...}, flat', () => {
    const d = dim('DIM t(3) AS UBYTE => {1, 2, 3, 4}').decls[0];
    expect(d?.init && init(d.init)).toBe('{1 2 3 4}');
  });
  it('=> {...}, nested', () => {
    const d = dim('DIM g(1, 1) AS UBYTE => {{1, 2}, {3, 4}}').decls[0];
    expect(d?.init && init(d.init)).toBe('{{1 2} {3 4}}');
  });
  it('=> {...} with strings and a trailing comma', () => {
    const d = dim('DIM w(2) AS STRING => {"ONE", "TWO", "THREE",}').decls[0];
    expect(d?.init && init(d.init)).toBe('{"ONE" "TWO" "THREE"}');
  });
  it('=> {...} over several lines, with a trailing newline before the brace', () => {
    const d = dim('DIM t(5) AS UBYTE => {\n  1, 2,\n  3, 4,\n  5, 6\n}\na = 1').decls[0];
    expect(d?.init && init(d.init)).toBe('{1 2 3 4 5 6}');
  });
  it('a continuation line inside the braces', () => {
    const d = dim('DIM t(3) AS UBYTE => {1, 2, _\n   3, 4}').decls[0];
    expect(d?.init && init(d.init)).toBe('{1 2 3 4}');
  });
  it('a number that starts a line inside the braces is a value, not a line number', () => {
    const d = dim('DIM t(3) AS UBYTE => {1, 2,\n3, 4}').decls[0];
    expect(d?.init && init(d.init)).toBe('{1 2 3 4}');
  });
  it('an expression that starts a line inside the braces is read whole (R23)', () => {
    const p = parseSource('DIM t(3) AS UBYTE => {1,\n3 + 1, 2 * 2,\n5 - 1}');
    expect(p.where).toEqual([]);
    const d = (p.program.body[0] as DimStmt).decls[0];
    expect(d?.init && init(d.init)).toBe('{1 (+ 3 1) (* 2 2) (- 5 1)}');
  });
  it('AT address', () => {
    const d = dim('DIM screen_ram(255) AS UBYTE AT &C000').decls[0];
    expect(d?.at && sexp(d.at)).toBe('&C000');
    expect(d?.bounds).toHaveLength(1);
    expect(dim('DIM v AS UINTEGER AT &BE00').decls[0]?.at).not.toBeNull();
  });
  it('a mix of forms in one DIM', () => {
    const d = dim('DIM p AS UBYTE, q(5) AS INTEGER, z AS STRING');
    expect(d.decls.map((x) => [x.name.text, x.bounds.length, x.type?.name])).toEqual([
      ['p', 0, 'UBYTE'],
      ['q', 1, 'INTEGER'],
      ['z', 0, 'STRING'],
    ]);
  });
  it('spans: the statement, each declarator, and the type', () => {
    const p = parseSource('DIM a(3) AS UBYTE, b');
    const d = p.program.body[0] as DimStmt;
    expect(p.sources.text(d.span)).toBe('DIM a(3) AS UBYTE, b');
    expect(d.decls.map((x) => p.sources.text(x.span))).toEqual(['a(3) AS UBYTE', 'b']);
    expect(p.sources.text(d.decls[0]?.type?.span as never)).toBe('UBYTE');
  });
  it('DIM inside a SUB stays in the body', () => {
    const s = proc('SUB F()\n DIM i AS UBYTE\nEND SUB');
    expect(s.body.map((x) => x.kind)).toEqual(['Dim']);
  });
});

describe('DIM errors', () => {
  it('DIM a(1 TO 5) is E970 at the TO', () => {
    const p = parseSource('DIM a(1 TO 5) AS UBYTE\na = 1');
    expect(p.where).toEqual(['1:9 E970']);
    expect(p.program.body.map((s) => s.kind)).toEqual(['BadStmt', 'Let']);
  });
  it('one diagnostic, and the parse goes on with the next line', () => {
    const p = parseSource('DIM a AS\nDIM b AS UBYTE');
    expect(p.where).toEqual(['1:9 E149']);
    expect(p.program.body.map((s) => s.kind)).toEqual(['BadStmt', 'Dim']);
  });
  it('a missing name', () => {
    expect(parseSource('DIM 5').where).toEqual(['1:5 E141']);
    expect(parseSource('DIM a,').where).toEqual(['1:7 E141']);
  });
  it('an unclosed bound parenthesis is E143 at the (', () => {
    expect(parseSource('DIM a(3 AS UBYTE').where).toEqual(['1:6 E143']);
  });
  it('an unclosed initialiser brace is E163 at the {', () => {
    expect(parseSource('DIM t(2) => {1, 2').where).toEqual(['1:13 E163']);
  });
  it('a bad initialiser value', () => {
    expect(parseSource('DIM t(2) => {1, *}').where).toEqual(['1:17 E142']);
  });
});

describe('CONST', () => {
  it('with and without a type', () => {
    const [a, b] = ok('CONST ScreenWidth = 80\nCONST MaxLives AS UBYTE = 5') as ConstStmt[];
    expect([a?.name.text, a?.type, a && sexp(a.value)]).toEqual(['ScreenWidth', null, '80']);
    expect([b?.name.text, b?.type?.name, b && sexp(b.value)]).toEqual(['MaxLives', 'UBYTE', '5']);
  });
  it('a constant expression', () => {
    const [a] = ok('CONST BitMask AS UBYTE = &H0F OR &H30') as ConstStmt[];
    expect(a && sexp(a.value)).toBe('(OR &H0F &H30)');
  });
  it('errors', () => {
    expect(parseSource('CONST x 5').where).toEqual(['1:9 E141']);
    expect(parseSource('CONST x =').where).toEqual(['1:10 E142']);
    expect(parseSource('CONST = 5').where).toEqual(['1:7 E141']);
  });
});

describe('DEFINT, DEFREAL, DEFSTR', () => {
  it('ranges and single letters', () => {
    const [a, b, c] = ok('DEFINT i-n\nDEFREAL a-h, x\nDEFSTR s, t-v') as DefTypeStmt[];
    expect([a?.type, a?.ranges.map((r) => `${r.from}-${r.to}`)]).toEqual(['INTEGER', ['i-n']]);
    expect([b?.type, b?.ranges.map((r) => `${r.from}-${r.to}`)]).toEqual(['REAL', ['a-h', 'x-x']]);
    expect([c?.type, c?.ranges.map((r) => `${r.from}-${r.to}`)]).toEqual(['STRING', ['s-s', 't-v']]);
  });
  it('letters are lower case and ranges carry spans', () => {
    const p = parseSource('DEFINT A-C, Q');
    const d = p.program.body[0] as DefTypeStmt;
    expect(d.ranges.map((r) => [r.from, r.to, p.sources.text(r.span)])).toEqual([
      ['a', 'c', 'A-C'],
      ['q', 'q', 'Q'],
    ]);
  });
  it('errors: not a letter, a long name, a backwards range, a suffix', () => {
    expect(parseSource('DEFINT 5').where).toEqual(['1:8 E164']);
    expect(parseSource('DEFINT abc').where).toEqual(['1:8 E164']);
    expect(parseSource('DEFINT z-a').where).toEqual(['1:8 E164']);
    expect(parseSource('DEFINT a$').where).toEqual(['1:8 E164']);
    expect(parseSource('DEFINT a-').where).toEqual(['1:10 E164']);
  });
});

describe('OPTION', () => {
  it('OPTION REAL', () => {
    const [o] = ok('OPTION REAL') as OptionStmt[];
    expect(o?.name).toBe('REAL');
  });
  it('anything else is E165', () => {
    expect(parseSource('OPTION BASE 1').where).toEqual(['1:8 E165']);
    expect(parseSource('OPTION').where).toEqual(['1:1 E165']);
  });
});

describe('SUB and FUNCTION', () => {
  it('a SUB with no parameters, with and without parentheses', () => {
    const s = proc('SUB Chirp()\n a = 1\nEND SUB');
    expect(s.procKind).toBe('SUB');
    expect(s.name.text).toBe('Chirp');
    expect(s.params).toEqual([]);
    expect(s.returnType).toBeNull();
    expect(s.convention).toBeNull();
    expect(proc('SUB Chirp\nEND SUB').params).toEqual([]);
  });
  it('parameters: plain, BYVAL, BYREF, default', () => {
    const p = parseSource('SUB Copy(BYVAL ch AS UBYTE, BYREF dest AS UBYTE, count AS UINTEGER = 16, raw)\nEND SUB');
    expect(p.where).toEqual([]);
    const s = p.program.body[0] as ProcedureDecl;
    expect(s.params.map((x) => [x.name.text, x.passing, x.type?.name ?? null, x.isArray, x.default && sexp(x.default)])).toEqual([
      ['ch', 'BYVAL', 'UBYTE', false, null],
      ['dest', 'BYREF', 'UBYTE', false, null],
      ['count', null, 'UINTEGER', false, '16'],
      ['raw', null, null, false, null],
    ]);
    expect(p.sources.text(s.params[0]?.span as never)).toBe('BYVAL ch AS UBYTE');
    expect(p.sources.text(s.params[2]?.span as never)).toBe('count AS UINTEGER = 16');
  });
  it('an array parameter is name() AS type', () => {
    const s = proc('SUB SumAll(values() AS UBYTE, n AS UINTEGER)\nEND SUB');
    expect(s.params.map((x) => [x.name.text, x.isArray])).toEqual([['values', true], ['n', false]]);
    expect(s.params[0]?.type?.name).toBe('UBYTE');
  });
  it('FASTCALL and STDCALL before the name', () => {
    expect(proc('SUB FASTCALL SetBorder(c AS UBYTE)\nEND SUB').convention).toBe('FASTCALL');
    expect(proc('SUB STDCALL Wait2(frames AS UBYTE)\nEND SUB').convention).toBe('STDCALL');
    const f = proc('FUNCTION FASTCALL Peek8(a AS UINTEGER) AS UBYTE\nEND FUNCTION');
    expect([f.convention, f.name.text]).toEqual(['FASTCALL', 'Peek8']);
  });
  it('FUNCTION with AS type', () => {
    const f = proc('FUNCTION Add(a AS INTEGER, b AS INTEGER) AS INTEGER\n Add = a + b\nEND FUNCTION');
    expect(f.procKind).toBe('FUNCTION');
    expect(f.returnType?.name).toBe('INTEGER');
    expect(f.params).toHaveLength(2);
    expect(f.body.map((s) => s.kind)).toEqual(['Let']);
  });
  it('FUNCTION without AS type parses (type defaults later)', () => {
    const f = proc('FUNCTION Twice(n AS INTEGER)\n Twice = n * 2\nEND FUNCTION');
    expect(f.procKind).toBe('FUNCTION');
    expect(f.returnType).toBeNull();
  });
  it('a suffixed FUNCTION name', () => {
    expect(proc('FUNCTION Name$(n)\nEND FUNCTION').name.suffix).toBe('$');
  });
  it('the body is a statement list and the spans cover the whole procedure', () => {
    const text = 'SUB Plot2(x, y)\n  a = 1\n  b = 2\nEND SUB';
    const p = parseSource(text);
    expect(p.where).toEqual([]);
    const s = p.program.body[0] as ProcedureDecl;
    expect(s.body.filter((x) => x.kind !== 'LineLabel').map((x) => x.kind)).toEqual(['Let', 'Let']);
    expect(p.sources.text(s.span)).toBe(text);
    expect(p.sources.text(s.endSpan)).toBe('END SUB');
  });
  it('procedures at the top level sit in the program body, with the main program around them', () => {
    const p = parseSource('a = 1\nSUB F()\nEND SUB\nb = 2\nFUNCTION G() AS UBYTE\nEND FUNCTION');
    expect(p.where).toEqual([]);
    expect(p.program.body.map((s) => s.kind)).toEqual(['Let', 'Procedure', 'Let', 'Procedure']);
  });
  it('END FUNCTION on one line after a colon', () => {
    expect(ok('SUB F() : a = 1 : END SUB')[0]?.kind).toBe('Procedure');
  });
  it('unclosed SUB reported at SUB', () => {
    const p = parseSource('a = 1\nSUB Hello()\n  b = 2\n');
    expect(p.where).toEqual(['2:1 E161']);
    expect(p.diag.all()[0]?.message).toBe('SUB never closed (expected END SUB)');
    const s = p.program.body.find((x) => x.kind === 'Procedure') as ProcedureDecl;
    expect(s.body.filter((x) => x.kind === 'Let')).toHaveLength(1);
  });
  it('unclosed FUNCTION reported at FUNCTION', () => {
    expect(parseSource('FUNCTION Twice(n AS INTEGER) AS INTEGER\n a = 1\n').where).toEqual(['1:1 E161']);
  });
  it('the wrong END is E162 at the END and closes the procedure', () => {
    const p = parseSource('SUB F()\nEND FUNCTION\nPRINT 1');
    expect(p.where[0]).toBe('2:1 E162');
    expect(p.codes).toEqual(['E162']);
  });
  it('a nested SUB is E160 at the inner SUB, and nothing else is reported', () => {
    const p = parseSource('SUB Outer()\n  SUB Inner()\n    a = 1\n  END SUB\nEND SUB\nb = 2');
    expect(p.where).toEqual(['2:3 E160']);
    const outer = p.program.body[0] as ProcedureDecl;
    expect(outer.body.filter((x) => x.kind !== 'LineLabel').map((x) => x.kind)).toEqual(['Procedure']);
    expect(p.program.body.map((s) => s.kind)).toEqual(['Procedure', 'Let']);
  });
  it('a FUNCTION inside a SUB is E160 too', () => {
    expect(parseSource('SUB A()\nFUNCTION B() AS UBYTE\nEND FUNCTION\nEND SUB').where).toEqual(['2:1 E160']);
  });
  it('a procedure inside any other block is E160 at the SUB (top level only, R23)', () => {
    for (const [src, at] of [
      ['IF a THEN\n  SUB F()\n  END SUB\nEND IF', '2:3'],
      ['FOR i = 1 TO 2\nFUNCTION G() AS UBYTE\nEND FUNCTION\nNEXT', '2:1'],
      ['WHILE 1\n  SUB F()\n  END SUB\nWEND', '2:3'],
      ['IF a THEN SUB F()', '1:11'],
    ] as const) {
      const p = parseSource(src);
      expect(p.where, src).toContain(`${at} E160`);
      expect(p.diag.all().find((d) => d.code === 'E160')?.message, src).toContain('top level');
    }
    expect(parseSource('IF a THEN\n  PRINT 1\nEND IF\nSUB F()\nEND SUB').where).toEqual([]);
  });
  it('a reserved word as a procedure, parameter or DIM name is E152 with a hint (R23)', () => {
    for (const [src, at] of [
      ['SUB Pause()\nEND SUB', '1:5'],
      ['SUB Paint(line AS UBYTE)\nEND SUB', '1:11'],
      ['DIM fill AS UBYTE', '1:5'],
      ['CONST Mode = 1', '1:7'],
    ] as const) {
      const p = parseSource(src);
      expect(p.where[0], src).toBe(`${at} E152`);
      const d = p.diag.all()[0];
      expect(d?.message, src).toMatch(/is a reserved word and cannot be used as a name$/);
      expect(d?.hint, src).toContain('Choose another name');
    }
    expect(parseSource('SUB Pause()\nEND SUB').diag.all()[0]?.hint).toContain('myPause');
  });
  it('after a procedure, nesting is allowed to be checked again', () => {
    expect(parseSource('SUB A()\nEND SUB\nSUB B()\nEND SUB').where).toEqual([]);
  });
  it('a SUB with a result type is E166 at the AS', () => {
    const p = parseSource('SUB F() AS UBYTE\nEND SUB');
    expect(p.where).toEqual(['1:9 E166']);
    expect(p.codes).toEqual(['E166']);
  });
  it('a header error is one diagnostic and the body is still read', () => {
    const p = parseSource('SUB F(a AS)\n  b = 1\nEND SUB\nc = 2');
    expect(p.where).toEqual(['1:11 E149']);
    expect(p.program.body.map((s) => s.kind)).toEqual(['Procedure', 'Let']);
  });
  it('more header errors', () => {
    expect(parseSource('SUB\nEND SUB').where).toEqual(['1:4 E141']);
    expect(parseSource('SUB F(a\nEND SUB').where).toEqual(['1:6 E143']);
    expect(parseSource('SUB F(a() AS UBYTE, 5)\nEND SUB').where).toEqual(['1:21 E141']);
    expect(parseSource('SUB F(a(3) AS UBYTE)\nEND SUB').where).toEqual(['1:9 E141']);
  });
});

describe('DECLARE', () => {
  it('SUB and FUNCTION forms', () => {
    const [a, b] = ok('DECLARE SUB Later(n AS UBYTE)\nDECLARE FUNCTION Soon(n AS UBYTE) AS UBYTE') as DeclareStmt[];
    expect([a?.procKind, a?.name.text, a?.params.length, a?.returnType]).toEqual(['SUB', 'Later', 1, null]);
    expect([b?.procKind, b?.name.text, b?.returnType?.name]).toEqual(['FUNCTION', 'Soon', 'UBYTE']);
  });
  it('a calling convention and an array parameter', () => {
    const [d] = ok('DECLARE SUB FASTCALL Wipe(buf() AS UBYTE)') as DeclareStmt[];
    expect(d?.convention).toBe('FASTCALL');
    expect(d?.params[0]?.isArray).toBe(true);
  });
  it('DECLARE alone or with something else is E141', () => {
    expect(parseSource('DECLARE').where).toEqual(['1:8 E141']);
    expect(parseSource('DECLARE DIM x').where).toEqual(['1:9 E141']);
  });
  it('does not open a block', () => {
    const p = parseSource('DECLARE SUB F()\na = 1\nSUB F()\nEND SUB');
    expect(p.where).toEqual([]);
    expect(p.program.body.map((s) => s.kind)).toEqual(['Declare', 'Let', 'Procedure']);
  });
});

describe('DEF FN', () => {
  it('name, parameters and body', () => {
    const [a, b] = ok('DEF FN Dist(dx, dy) = SQR(dx * dx + dy * dy)\nDEF FN Full$(a$, b$) = a$ + " " + b$') as DefFnStmt[];
    expect([a?.name.text, a?.params.map((x) => x.text), a && sexp(a.body)]).toEqual([
      'Dist',
      ['dx', 'dy'],
      '(SQR (+ (* dx dx) (* dy dy)))',
    ]);
    expect([b?.name.text, b?.name.suffix, b?.params.map((x) => x.suffix)]).toEqual(['Full', '$', ['$', '$']]);
  });
  it('glued FN names, the Locomotive way', () => {
    const p = parseSource('10 DEF FNdouble(x)=x*2\n20 DEF FNname$(a$)=UPPER$(a$)+"!"');
    expect(p.where).toEqual([]);
    const defs = p.program.body.filter((s) => s.kind === 'DefFn') as DefFnStmt[];
    expect(defs.map((d) => [d.name.text, d.name.suffix])).toEqual([['double', null], ['name', '$']]);
  });
  it('no parameters, with or without parentheses', () => {
    const [a, b] = ok('DEF FN One() = 1\nDEF FN Two = 2') as DefFnStmt[];
    expect([a?.params, b?.params]).toEqual([[], []]);
  });
  it('span covers the whole definition', () => {
    const p = parseSource('DEF FN Double(x) = x * 2');
    expect(p.sources.text(p.program.body[0]?.span as never)).toBe('DEF FN Double(x) = x * 2');
  });
  it('errors', () => {
    expect(parseSource('DEF x = 1').where).toEqual(['1:5 E141']);
    expect(parseSource('DEF FN = 1').where).toEqual(['1:8 E141']);
    expect(parseSource('DEF FN F(x) 5').where).toEqual(['1:13 E141']);
    expect(parseSource('DEF FN F(x) =').where).toEqual(['1:14 E142']);
    expect(parseSource('DEF FN F(x = 1').where).toEqual(['1:9 E143']);
  });
});

describe('dropped forms', () => {
  it('TYPE is E971 at TYPE', () => {
    const p = parseSource("' c\nTYPE Point\na = 1");
    expect(p.where).toEqual(['2:1 E971']);
    expect(p.diag.all()[0]?.message).toBe('TYPE is not in 1.0: use arrays');
  });
  it('a whole TYPE block is skipped after one diagnostic', () => {
    const p = parseSource('TYPE Point\n  x AS INTEGER\n  y AS INTEGER\nEND TYPE\na = 1');
    expect(p.where).toEqual(['1:1 E971']);
    expect(p.program.body.map((s) => s.kind)).toEqual(['BadStmt', 'Let']);
  });
  it('a TYPE block in a numbered listing is skipped too (R23)', () => {
    const p = parseSource('10 TYPE p\n20 a AS UBYTE\n30 END TYPE\n40 PRINT 1');
    expect(p.where).toEqual(['1:4 E971']);
    expect(p.program.body.filter((s) => s.kind !== 'LineLabel').map((s) => s.kind)).toEqual(['BadStmt', 'Print']);
  });
  it('type as a variable still works', () => {
    expect(ok('type = 3')[0]?.kind).toBe('Let');
  });
  it('PRIVATE SUB is E972 at PRIVATE and the SUB is still read', () => {
    const p = parseSource('PRIVATE SUB Hidden()\n  a = 1\nEND SUB');
    expect(p.where).toEqual(['1:1 E972']);
    expect(p.program.body.map((s) => s.kind)).toEqual(['Procedure']);
  });
  it('an error in the PRIVATE procedure itself is still reported (R23)', () => {
    expect(parseSource('PRIVATE SUB F()\nPRINT 1').where).toEqual(['1:1 E972', '1:9 E161']);
  });
  it('PRIVATE FUNCTION and PRIVATE alone', () => {
    expect(parseSource('PRIVATE FUNCTION F() AS UBYTE\nEND FUNCTION').where).toEqual(['1:1 E972']);
    expect(parseSource('PRIVATE x').where).toEqual(['1:1 E972']);
  });
  it('private as a variable still works', () => {
    expect(ok('private = 1')[0]?.kind).toBe('Let');
  });
});
