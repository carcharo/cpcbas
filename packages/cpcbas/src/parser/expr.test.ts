import { describe, expect, it } from 'vitest';
import { exprOf, parseSource, sexp } from '../../test/parse-helpers.js';
import { keywordOf } from '../lang/keywords.js';
import { unparseExpr } from '../ast/unparse.js';

describe('precedence table', () => {
  // Each row: a source whose tree shows which of two adjacent levels binds tighter.
  const rows: Array<[string, string]> = [
    // XOR < OR
    ['a XOR b OR c', '(XOR a (OR b c))'],
    ['a OR b XOR c', '(XOR (OR a b) c)'],
    // OR < AND
    ['a OR b AND c', '(OR a (AND b c))'],
    ['a AND b OR c', '(OR (AND a b) c)'],
    // AND < NOT
    ['a AND NOT b', '(AND a (NOT b))'],
    ['NOT a AND b', '(AND (NOT a) b)'],
    // NOT < comparison
    ['NOT a = b', '(NOT (= a b))'],
    ['NOT a < b + 1', '(NOT (< a (+ b 1)))'],
    // comparison < shift
    ['a = b << c', '(= a (<< b c))'],
    ['a >> b <> c', '(<> (>> a b) c)'],
    // shift < additive
    ['a << b + c', '(<< a (+ b c))'],
    ['a + b >> c', '(>> (+ a b) c)'],
    // additive < multiplicative
    ['a + b * c', '(+ a (* b c))'],
    ['a * b - c', '(- (* a b) c)'],
    ['a - b MOD c', '(- a (MOD b c))'],
    ['a + b \\ c', '(+ a (\\ b c))'],
    // MOD < \ < * / (Locomotive: 2 + 3 MOD 2 * 5 is 2 + (3 MOD (2 * 5)))
    ['a MOD b \\ c', '(MOD a (\\ b c))'],
    ['a \\ b MOD c', '(MOD (\\ a b) c)'],
    ['a \\ b * c', '(\\ a (* b c))'],
    ['a * b \\ c', '(\\ (* a b) c)'],
    ['a / b \\ c / d', '(\\ (/ a b) (/ c d))'],
    ['a MOD b * c', '(MOD a (* b c))'],
    ['2 + 3 MOD 2 * 5', '(+ 2 (MOD 3 (* 2 5)))'],
    ['a \\ b \\ c', '(\\ (\\ a b) c)'],
    ['a MOD b MOD c', '(MOD (MOD a b) c)'],
    // multiplicative < unary
    ['-a * b', '(* (u- a) b)'],
    ['a / -b', '(/ a (u- b))'],
    ['+a MOD b', '(MOD (u+ a) b)'],
    // unary < ^
    ['-a ^ b', '(u- (^ a b))'],
    ['a ^ b * c', '(* (^ a b) c)'],
    // same level associates to the left
    ['a - b - c', '(- (- a b) c)'],
    ['a / b * c', '(* (/ a b) c)'],
    ['a AND b AND c', '(AND (AND a b) c)'],
    ['a = b = c', '(= (= a b) c)'],
    // parentheses override
    ['(a + b) * c', '(* (+ a b) c)'],
    ['a * (b OR c)', '(* a (OR b c))'],
  ];
  for (const [src, tree] of rows) {
    it(src, () => {
      const p = parseSource(`x = ${src}`);
      expect(p.where).toEqual([]);
      expect(exprOf(src)).toBe(tree);
    });
  }

  it('round-trips through unparse', () => {
    const p = parseSource('x = a + b * (c - d) ^ 2 AND NOT e = f');
    const s = p.program.body[0];
    if (s?.kind !== 'Let') throw new Error('not a Let');
    const again = parseSource(`x = ${unparseExpr(s.value)}`).program.body[0];
    if (again?.kind !== 'Let') throw new Error('not a Let');
    expect(sexp(again.value)).toBe(sexp(s.value));
  });
});

describe('comparison spellings', () => {
  it('stores => and =< as >= and <=', () => {
    expect(exprOf('a => b')).toBe('(>= a b)');
    expect(exprOf('a =< b')).toBe('(<= a b)');
    expect(exprOf('a >= b')).toBe('(>= a b)');
    expect(exprOf('a <= b')).toBe('(<= a b)');
    expect(exprOf('a <> b')).toBe('(<> a b)');
    expect(exprOf('a < b')).toBe('(< a b)');
    expect(exprOf('a > b')).toBe('(> a b)');
    expect(exprOf('a = b')).toBe('(= a b)');
  });
});

describe('unary minus and ^', () => {
  it('^ is left-associative', () => {
    expect(exprOf('2 ^ 3 ^ 2')).toBe('(^ (^ 2 3) 2)');
  });
  it('-2^2 is -(2^2)', () => {
    expect(exprOf('-2 ^ 2')).toBe('(u- (^ 2 2))');
  });
  it('the exponent may carry a sign', () => {
    expect(exprOf('2 ^ -1')).toBe('(^ 2 (u- 1))');
    expect(exprOf('2 ^ +x ^ 3')).toBe('(^ (^ 2 (u+ x)) 3)');
  });
  it('signs stack', () => {
    expect(exprOf('- -a')).toBe('(u- (u- a))');
    expect(exprOf('a - -b')).toBe('(- a (u- b))');
  });
});

describe('NOT binds below comparison', () => {
  it('takes a whole comparison as its operand', () => {
    expect(exprOf('NOT a = b AND c')).toBe('(AND (NOT (= a b)) c)');
    expect(exprOf('NOT NOT a')).toBe('(NOT (NOT a))');
    expect(exprOf('1 + NOT a = b')).toBe('(+ 1 (NOT (= a b)))');
  });
});

describe('primaries', () => {
  it('literals, names, elements, @ and FN', () => {
    expect(exprOf('12')).toBe('12');
    expect(exprOf('&FF')).toBe('&FF');
    expect(exprOf('"say ""hi"""')).toBe('"say \\"hi\\""');
    expect(exprOf('Score$')).toBe('Score$');
    expect(exprOf('t(1, i + 1)')).toBe('(call t 1 (+ i 1))');
    expect(exprOf('t()')).toBe('(call t)');
    expect(exprOf('@buf')).toBe('(@ buf)');
    expect(exprOf('FN cube(3)')).toBe('(FN cube 3)');
    expect(exprOf('FN pi2')).toBe('(FN pi2)');
    expect(exprOf('FN area(w, h) + 1')).toBe('(+ (FN area w h) 1)');
  });
  it('a name alone is a Name and name(args) is a CallOrIndex', () => {
    const s = parseSource('x = a\ny = a(1)').program.body;
    expect(s.map((n) => (n.kind === 'Let' ? n.value.kind : n.kind))).toEqual(['Name', 'CallOrIndex']);
  });
  it('spans cover the source text', () => {
    const p = parseSource('x = FN f(1) + PEEK(UBYTE, 5)');
    const s = p.program.body[0];
    if (s?.kind !== 'Let' || s.value.kind !== 'Binary') throw new Error('shape');
    expect(p.sources.text(s.value.left.span)).toBe('FN f(1)');
    expect(p.sources.text(s.value.right.span)).toBe('PEEK(UBYTE, 5)');
    expect(p.sources.text(s.value.span)).toBe('FN f(1) + PEEK(UBYTE, 5)');
  });
});

describe('builtins: parens rules, type arguments, streams, arity errors at the right column', () => {
  it('parentheses required, optional or absent', () => {
    expect(exprOf('LEN(a$)')).toBe('(LEN a$)');
    expect(exprOf('INKEY$')).toBe('(INKEY$)');
    expect(exprOf('TIME')).toBe('(TIME)');
    expect(exprOf('PI * 2')).toBe('(* (PI) 2)');
    expect(exprOf('ERR + ERL')).toBe('(+ (ERR) (ERL))');
    expect(exprOf('RND')).toBe('(RND)');
    expect(exprOf('RND(1)')).toBe('(RND 1)');
    expect(exprOf('RND()')).toBe('(RND)');
    expect(exprOf('RND * 10')).toBe('(* (RND) 10)');
    const parens = (src: string): boolean | null => {
      const s = parseSource(`x = ${src}`).program.body[0];
      return s?.kind === 'Let' && s.value.kind === 'BuiltinCall' ? s.value.parens : null;
    };
    expect(parens('RND')).toBe(false);
    expect(parens('RND(1)')).toBe(true);
    expect(parens('INKEY$')).toBe(false);
  });

  it('a type argument when the first thing in the parentheses is a type name', () => {
    expect(exprOf('PEEK(UINTEGER, a)')).toBe('(PEEK UINTEGER a)');
    expect(exprOf('PEEK(a)')).toBe('(PEEK a)');
    expect(exprOf('CAST(UBYTE, x + 1)')).toBe('(CAST UBYTE (+ x 1))');
    expect(exprOf('SIZEOF(UBYTE)')).toBe('(SIZEOF UBYTE)');
    expect(exprOf('SIZEOF(v)')).toBe('(SIZEOF v)');
    const s = parseSource('x = CAST(FLOAT, 1)').program.body[0];
    if (s?.kind !== 'Let' || s.value.kind !== 'BuiltinCall') throw new Error('shape');
    expect(s.value.typeArg?.name).toBe('REAL');
    expect(s.value.typeArg?.text).toBe('FLOAT');
  });

  it('#stream for POS, VPOS and COPYCHR$', () => {
    expect(exprOf('POS(#0)')).toBe('(POS #0)');
    expect(exprOf('VPOS(#2)')).toBe('(VPOS #2)');
    expect(exprOf('COPYCHR$(#1 + 1)')).toBe('(COPYCHR$ #(+ 1 1))');
    expect(parseSource('x = POS(0)').where).toEqual(['1:9 E141']);
  });

  it('every function in the table parses at its minimum and maximum argument count', () => {
    const fns = ['ABS', 'LEFT$', 'MID$', 'INSTR', 'HEX$', 'ROUND', 'MIN', 'MAX', 'LBOUND', 'RND', 'INKEY', 'TEST', 'STR$'];
    for (const f of fns) {
      const e = keywordOf(f, 'function');
      if (!e?.args) throw new Error(`no table entry for ${f}`);
      for (const n of [e.args.min, Math.min(e.args.max, e.args.min + 3)]) {
        const args = Array.from({ length: n }, (_, i) => String(i + 1)).join(', ');
        const p = parseSource(`x = ${f}(${args})`);
        expect(p.where, `${f} with ${n} args`).toEqual([]);
      }
    }
  });

  it('argument-count errors are reported at the function name, with the syntax as the hint', () => {
    const few = parseSource('a$ = LEFT$("abc")');
    expect(few.where).toEqual(['1:6 E147']);
    expect(few.diag.all()[0]?.message).toBe('LEFT$ takes 2 arguments, 1 given');
    expect(few.diag.all()[0]?.hint).toBe('Syntax: LEFT$(s$, n)');
    const many = parseSource('x = SIN(1, 2)');
    expect(many.where).toEqual(['1:5 E147']);
    expect(many.diag.all()[0]?.message).toBe('SIN takes 1 argument, 2 given');
    expect(parseSource('x = 1 + MID$(a$)').where).toEqual(['1:9 E147']);
    expect(parseSource('x = RND(1, 2)').where).toEqual(['1:5 E147']);
    expect(parseSource('x = POS(#0, 1)').where).toEqual(['1:5 E147']);
    expect(parseSource('x = LEN()').where).toEqual(['1:5 E147']);
  });

  it('MIN and MAX arity comes from the table', () => {
    const min = keywordOf('MIN', 'function')?.args?.min ?? 1;
    if (min > 0) {
      const args = Array.from({ length: min - 1 }, (_, i) => String(i + 1)).join(', ');
      expect(parseSource(`x = MIN(${args})`).where).toEqual(['1:5 E147']);
    }
    expect(parseSource('x = MIN(1, 2, 3, 4)').where).toEqual([]);
  });

  it('a function that needs parentheses without them is reported once', () => {
    expect(parseSource('x = LEN a$').where).toEqual(['1:9 E141']);
  });

  it('TAB and SPC outside PRINT are E146', () => {
    expect(parseSource('x = TAB(3)').where).toEqual(['1:5 E146']);
  });

  it('an unclosed ( in a call is reported at the (', () => {
    expect(parseSource('x = LEN(a$').where).toEqual(['1:8 E143']);
    expect(parseSource('x = t(1, 2').where).toEqual(['1:6 E143']);
  });
});

describe('bAND gives E960 and parses on', () => {
  it('maps the Boriel words to the CPC ones', () => {
    const p = parseSource('x = a bAND b');
    expect(p.where).toEqual(['1:7 E960']);
    expect(p.diag.all()[0]?.message).toBe('bAND is not CPC BASIC: use AND');
    const s = p.program.body[0];
    if (s?.kind !== 'Let') throw new Error('shape');
    expect(sexp(s.value)).toBe('(AND a b)');
    expect(parseSource('x = a BOR b').where).toEqual(['1:7 E960']);
    expect(exprOf('a bor b bxor c')).toBe('(XOR (OR a b) c)');
    const n = parseSource('x = bNOT a');
    expect(n.where).toEqual(['1:5 E960']);
    expect(exprOf('bNOT a = b')).toBe('(NOT (= a b))');
  });
  it('the words stay usable as variable names', () => {
    expect(parseSource('bnot = 3\nx = bnot\ny = bnot + 1').where).toEqual([]);
    expect(parseSource('band = 1').where).toEqual([]);
  });
  it('does not stop the statement list', () => {
    const p = parseSource('x = a bAND b\ny = 2');
    expect(p.program.body.map((s) => s.kind)).toEqual(['Let', 'Let']);
  });
});

describe('expression errors', () => {
  it('missing operand', () => {
    const p = parseSource('x = 3 + * 4');
    expect(p.where).toEqual(['1:9 E142']);
  });
  it('stray close parenthesis', () => {
    expect(parseSource('x = 3 + 4)').where).toEqual(['1:10 E144']);
  });
  it('two values in a row', () => {
    expect(parseSource('x = 1 2').where).toEqual(['1:7 E144']);
  });
  it('unbalanced open parenthesis at the (', () => {
    expect(parseSource('x = (3 + 4').where).toEqual(['1:5 E143']);
  });
  it('nothing after =', () => {
    const p = parseSource('x =\ny = 2');
    expect(p.where).toEqual(['1:4 E142']);
    expect(p.program.body.map((s) => s.kind)).toEqual(['Let', 'Let']);
  });
  it('a keyword where a value belongs', () => {
    expect(parseSource('x = THEN').where).toEqual(['1:5 E142']);
  });
  it('@ needs a name', () => {
    expect(parseSource('x = @5').where).toEqual(['1:6 E141']);
    // a line number has no @ form (Locomotive has none; spec: @ of a label): the hint says to label the line
    expect(parseSource('x = @5').diag.all()[0]?.hint).toContain('put a label on the line');
  });
  it('stays quiet on tokens the lexer already reported', () => {
    const p = parseSource('x = 3 + ~ 4');
    expect(p.codes).toEqual(['E101']);
  });
  it('very deep nesting reports an error and does not throw', () => {
    const p = parseSource(`x = ${'('.repeat(5000)}1${')'.repeat(5000)}`);
    expect(p.codes).toContain('E151');
    const q = parseSource(`x = ${'-'.repeat(5000)}1`);
    expect(q.codes).toContain('E151');
    const r = parseSource(`x = ${'NOT '.repeat(5000)}1`);
    expect(r.codes).toContain('E151');
  });
});

describe('compatibility forms inside expressions (R23)', () => {
  it('ATTR(, SCREEN$( and USR n are E961 at the name, with the hint, one diagnostic each', () => {
    for (const [src, at, word] of [
      ['x = ATTR(1, 1)', '1:5', 'ATTR'],
      ['a$ = SCREEN$(1, 1)', '1:6', 'SCREEN$'],
      ['x = USR 32768', '1:5', 'USR'],
      ['x = USR(32768) + 1', '1:5', 'USR'],
      ['x = 1 + usr @code', '1:9', 'USR'],
      ['PRINT attr(2, 3); "x"', '1:7', 'ATTR'],
    ] as const) {
      const p = parseSource(src);
      expect(p.where, src).toEqual([`${at} E961`]);
      const d = p.diag.all()[0];
      expect(d?.message, src).toContain(word);
      expect(d?.hint, src).toBe(keywordOf(word, 'function')?.hint);
    }
  });
  it('the dropped words alone are still variables', () => {
    expect(parseSource('attr = 1\nx = attr + usr\nusr = 2: PRINT usr').where).toEqual([]);
    expect(exprOf('attr + 1')).toBe('(+ attr 1)');
  });
  it('a TO inside a subscript or call is E962 at the TO, hint MID$', () => {
    for (const [src, at] of [
      ['b$ = a$(2 TO 4)', '1:11'],
      ['b$ = a$( TO 4)', '1:10'],
      ['b$ = a$(2 TO )', '1:11'],
      ['PRINT a$(1, 2 TO 3)', '1:15'],
      ['a$(1 TO 2) = "x"', '1:6'],
    ] as const) {
      const p = parseSource(src);
      expect(p.where, src).toEqual([`${at} E962`]);
      expect(p.diag.all()[0]?.hint, src).toContain('MID$');
    }
  });
  it('TO keeps its meaning outside parentheses', () => {
    expect(parseSource('FOR i = a(1) TO b(2)\nNEXT').where).toEqual([]);
  });
  it('a reserved word assigned to is E152, not a generic error', () => {
    for (const src of ['test = 1', 'fill = 3', 'mode = 1', 'line = 2']) {
      const p = parseSource(src);
      expect(p.where, src).toEqual(['1:1 E152']);
    }
    expect(parseSource('FOR time = 1 TO 2\nNEXT').where[0]).toBe('1:5 E152');
    expect(parseSource('INPUT frame').where).toEqual(['1:7 E152']);
  });
});
