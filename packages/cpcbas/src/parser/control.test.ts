import { describe, expect, it } from 'vitest';
import { parseSource, sexp } from '../../test/parse-helpers.js';
import type {
  CaseClause,
  DoLoopStmt,
  EveryAfterStmt,
  ForStmt,
  GotoStmt,
  IfStmt,
  OnErrorStmt,
  OnGotoStmt,
  SelectCaseStmt,
  Stmt,
  WhileStmt,
} from '../ast/ast.js';
import type { Span } from '../core/source.js';

/** Statements of a program, without LineLabels, plus the diagnostics as `line:col CODE`. */
function parse(text: string): { body: Stmt[]; where: string[]; text: (s: Span) => string } {
  const p = parseSource(text);
  return {
    body: p.program.body.filter((s) => s.kind !== 'LineLabel'),
    where: p.where,
    text: (s) => p.sources.text(s),
  };
}

function one<T extends Stmt>(text: string, kind: T['kind']): T {
  const r = parse(text);
  expect(r.where).toEqual([]);
  expect(r.body).toHaveLength(1);
  const s = r.body[0] as Stmt;
  expect(s.kind).toBe(kind);
  return s as T;
}

describe('IF, single-line form', () => {
  it('THEN statements', () => {
    const s = one<IfStmt>('IF a = 1 THEN b = 2 : c = 3', 'If');
    expect(s.form).toBe('line');
    expect(s.branches).toHaveLength(1);
    expect(sexp(s.branches[0]!.cond)).toBe('(= a 1)');
    expect(s.branches[0]!.body.map((x) => x.kind)).toEqual(['Let', 'Let']);
    expect(s.elseBody).toBeNull();
  });
  it('THEN stmts ELSE stmts', () => {
    const s = one<IfStmt>('IF a THEN b = 1 ELSE c = 2 : d = 3', 'If');
    expect(s.branches[0]!.body).toHaveLength(1);
    expect(s.elseBody?.map((x) => x.kind)).toEqual(['Let', 'Let']);
  });
  it('single-line IF THEN number is an implicit Goto', () => {
    const s = one<IfStmt>('IF a THEN 100', 'If');
    const g = s.branches[0]!.body[0] as GotoStmt;
    expect(g.kind).toBe('Goto');
    expect(g.implicit).toBe(true);
    expect(g.target).toMatchObject({ kind: 'LineTarget', number: 100 });
  });
  it('THEN 100 ELSE 200 gives two implicit Gotos', () => {
    const s = one<IfStmt>('IF a THEN 100 ELSE 200', 'If');
    expect((s.branches[0]!.body[0] as GotoStmt).implicit).toBe(true);
    const e = s.elseBody?.[0] as GotoStmt;
    expect(e).toMatchObject({ kind: 'Goto', implicit: true, target: { number: 200 } });
  });
  it('THEN GOTO label is an explicit Goto', () => {
    const s = one<IfStmt>('IF a THEN GOTO Done ELSE GOTO 100', 'If');
    expect((s.branches[0]!.body[0] as GotoStmt).implicit).toBe(false);
    expect(s.branches[0]!.body[0]).toMatchObject({ target: { kind: 'LabelTarget', key: 'done' } });
    expect(s.elseBody?.[0]).toMatchObject({ kind: 'Goto', implicit: false });
  });
  it(': ELSE works', () => {
    const s = one<IfStmt>('IF a THEN b = 1 : ELSE c = 2', 'If');
    expect(s.branches[0]!.body).toHaveLength(1);
    expect(s.elseBody).toHaveLength(1);
  });
  it('a dangling ELSE binds to the nearest IF', () => {
    const s = one<IfStmt>('IF a THEN IF b THEN x = 1 ELSE x = 2', 'If');
    expect(s.elseBody).toBeNull();
    const inner = s.branches[0]!.body[0] as IfStmt;
    expect(inner.form).toBe('line');
    expect(inner.elseBody).toHaveLength(1);
  });
  it('ELSE after an inner ELSE belongs to the outer IF', () => {
    const s = one<IfStmt>('IF a THEN IF b THEN x = 1 ELSE x = 2 ELSE x = 3', 'If');
    expect(s.elseBody).toHaveLength(1);
    expect((s.branches[0]!.body[0] as IfStmt).elseBody).toHaveLength(1);
  });
  it('the IF ends at the end of the line', () => {
    const r = parse('IF a THEN b = 1\nc = 2');
    expect(r.where).toEqual([]);
    expect(r.body.map((s) => s.kind)).toEqual(['If', 'Let']);
  });
  it('a missing THEN is reported at the next token', () => {
    const r = parse('IF x > 1 PRINT "big"\ny = 1');
    expect(r.where).toEqual(['1:10 E170']);
    expect(r.body.map((s) => s.kind)).toEqual(['BadStmt', 'Let']);
  });
  it('a bad condition reports once', () => {
    const r = parse('IF a = THEN b = 1\nc = 2');
    expect(r.where).toEqual(['1:8 E142']);
    expect(r.body).toHaveLength(2);
  });
});

describe('IF, block form', () => {
  it('block vs line IF is decided by what follows THEN', () => {
    expect(one<IfStmt>('IF a THEN\n  b = 1\nEND IF', 'If').form).toBe('block');
    expect(one<IfStmt>('IF a THEN b = 1', 'If').form).toBe('line');
    expect(one<IfStmt>("IF a THEN ' nothing here\n  b = 1\nEND IF", 'If').form).toBe('block');
    // A comment after THEN opens a block IF, so a typed-in `IF a THEN REM text` is unclosed.
    const u = parseSource('IF a THEN REM nothing');
    expect(u.where).toEqual(['1:1 E171']);
    expect(u.diag.all()[0]?.hint).toContain('A comment after THEN opens a block IF');
    expect(one<IfStmt>('IF a THEN b = 1 ELSE REM nothing', 'If').elseBody).toEqual([]);
  });
  it('IF cond GOTO target: THEN left out', () => {
    const s = one<IfStmt>('IF a > b GOTO 100 ELSE 200', 'If');
    expect(s.form).toBe('line');
    expect(s.branches[0]?.body.map((x) => x.kind)).toEqual(['Goto']);
    expect(s.elseBody?.map((x) => x.kind)).toEqual(['Goto']);
    expect(one<IfStmt>('IF a GOTO 5', 'If').elseBody).toBeNull();
    expect(one<IfStmt>('IF a GO TO done', 'If').branches).toHaveLength(1);
    expect(parseSource('IF a GOSUB 5').where).toEqual(['1:6 E170']);
  });
  it('ELSEIF branches and ELSE', () => {
    const s = one<IfStmt>(
      'IF a = 1 THEN\n x = 1\nELSEIF a = 2 THEN\n x = 2\n y = 2\nELSEIF a = 3 THEN\n x = 3\nELSE\n x = 4\nEND IF',
      'If',
    );
    expect(s.branches.map((b) => sexp(b.cond))).toEqual(['(= a 1)', '(= a 2)', '(= a 3)']);
    expect(s.branches.map((b) => b.body.length)).toEqual([1, 2, 1]);
    expect(s.elseBody).toHaveLength(1);
  });
  it('nesting, with a line IF inside a block', () => {
    const s = one<IfStmt>('IF a THEN\n IF b THEN\n  x = 1\n ELSE\n  x = 2\n END IF\n IF c THEN y = 1\nEND IF', 'If');
    const [inner, line] = s.branches[0]!.body as IfStmt[];
    expect(inner?.form).toBe('block');
    expect(inner?.elseBody).toHaveLength(1);
    expect(line?.form).toBe('line');
  });
  it('the span covers IF to END IF', () => {
    const r = parse('IF a THEN\n b = 1\nEND IF\nc = 2');
    expect(r.text((r.body[0] as Stmt).span)).toBe('IF a THEN\n b = 1\nEND IF');
  });
  it('unclosed IF reported at IF', () => {
    const r = parse('x = 1\nIF x = 1 THEN\n  y = 1\nz = 2');
    expect(r.where).toEqual(['2:1 E171']);
  });
  it('unclosed IF after ELSE is reported at IF', () => {
    expect(parse('IF x THEN\n y = 1\nELSE\n z = 2').where).toEqual(['1:1 E171']);
  });
  it('ELSE IF in a block IF hints at ELSEIF', () => {
    const r = parseSource('IF a THEN\n x = 1\nELSE IF b THEN\n x = 2\nEND IF');
    expect(r.where).toEqual(['1:1 E171']);
    expect(r.diag.all()[0]?.hint).toBe('Write ELSEIF as one word.');
    expect(parseSource('IF x THEN\n y = 1\nELSE\n z = 2').diag.all()[0]?.hint).toContain('END IF');
  });
  it('a missing THEN after ELSEIF is reported once', () => {
    const r = parse('IF a THEN\n x = 1\nELSEIF b\n x = 2\nEND IF');
    expect(r.where).toEqual(['3:9 E170']);
  });
  it('a second ELSE and a stray END IF are reported', () => {
    expect(parse('IF a THEN\n x = 1\nELSE\n x = 2\nELSE\n x = 3\nEND IF').where).toEqual(['5:1 E175']);
    expect(parse('n = 1\nEND IF').where).toEqual(['2:1 E175']);
  });
});

describe('FOR / NEXT', () => {
  it('FOR with STEP, body and named NEXT', () => {
    const s = one<ForStmt>('FOR i = 10 TO 1 STEP -1\n x = i\nNEXT i', 'For');
    expect(s.variable.text).toBe('i');
    expect(sexp(s.from)).toBe('10');
    expect(sexp(s.to)).toBe('1');
    expect(s.step && sexp(s.step)).toBe('(u- 1)');
    expect(s.body).toHaveLength(1);
    expect(s.nextName?.text).toBe('i');
  });
  it('NEXT without a name, and on the FOR line', () => {
    const s = one<ForStmt>('FOR i = 1 TO 3 : x = i : NEXT', 'For');
    expect(s.nextName).toBeNull();
    expect(s.step).toBeNull();
    expect(s.body).toHaveLength(1);
  });
  it('typed loop variable', () => {
    const s = one<ForStmt>('FOR x! = 0 TO 1 STEP 0.25 : NEXT x!', 'For');
    expect(s.variable.suffix).toBe('!');
    expect(s.nextName?.suffix).toBe('!');
  });
  it('NEXT j, i closes both with shared span', () => {
    const r = parse('FOR i = 0 TO 3\n FOR j = 0 TO 3\n  x = 1\nNEXT j, i\ny = 2');
    expect(r.where).toEqual([]);
    expect(r.body.map((s) => s.kind)).toEqual(['For', 'Let']);
    const outer = r.body[0] as ForStmt;
    const inner = outer.body.find((s) => s.kind === 'For') as ForStmt;
    expect(outer.body.filter((s) => s.kind !== 'LineLabel')).toHaveLength(1);
    expect(inner.nextName?.text).toBe('j');
    expect(outer.nextName?.text).toBe('i');
    expect(inner.nextSpan).toEqual(outer.nextSpan);
    expect(r.text(outer.nextSpan)).toBe('NEXT j, i');
    expect(r.text(outer.span)).toBe('FOR i = 0 TO 3\n FOR j = 0 TO 3\n  x = 1\nNEXT j, i');
  });
  it('NEXT k, j, i closes three loops', () => {
    const r = parse('FOR i = 1 TO 2\nFOR j = 1 TO 2\nFOR k = 1 TO 2\nNEXT k, j, i');
    expect(r.where).toEqual([]);
    const a = r.body[0] as ForStmt;
    const b = a.body[0] as ForStmt;
    const c = b.body[0] as ForStmt;
    expect([a.nextName?.text, b.nextName?.text, c.nextName?.text]).toEqual(['i', 'j', 'k']);
    expect(a.nextSpan).toEqual(c.nextSpan);
  });
  it('two NEXT statements on one line close two loops', () => {
    const r = parse('FOR i = 0 TO 3\nFOR j = 0 TO 3\nNEXT : NEXT');
    expect(r.where).toEqual([]);
    expect(r.body).toHaveLength(1);
  });
  it('statements after NEXT j, i stay outside both loops', () => {
    const r = parse('FOR i = 0 TO 1 : FOR j = 0 TO 1 : NEXT j, i : x = 1');
    expect(r.where).toEqual([]);
    expect(r.body.map((s) => s.kind)).toEqual(['For', 'Let']);
  });
  it('NEXT mismatch is reported at the variable', () => {
    const r = parse('FOR i = 1 TO 3\n x = i\nNEXT j');
    expect(r.where).toEqual(['3:6 E173']);
    expect(r.body.map((s) => s.kind)).toEqual(['For']);
  });
  it('NEXT j, i mismatch on the outer name', () => {
    expect(parse('FOR i = 1 TO 3\nFOR j = 1 TO 3\nNEXT j, k').where).toEqual(['3:9 E173']);
  });
  it('NEXT with more names than open loops', () => {
    const r = parse('FOR i = 1 TO 3\nNEXT i, j\nx = 1');
    expect(r.where).toEqual(['2:9 E176']);
    expect(r.body.map((s) => s.kind)).toEqual(['For', 'Let']);
  });
  it('NEXT without FOR', () => {
    const r = parse('x = 1\nNEXT i\ny = 2');
    expect(r.where).toEqual(['2:1 E172']);
    expect(r.body.map((s) => s.kind)).toEqual(['Let', 'BadStmt', 'Let']);
  });
  it('unstructured NEXT inside a one-line IF', () => {
    const r = parse('FOR i = 1 TO 10\n  IF i > 5 THEN NEXT\nNEXT');
    expect(r.where).toEqual(['2:17 E174']);
    expect(r.body.map((s) => s.kind)).toEqual(['For']);
  });
  it('unstructured NEXT after ELSE', () => {
    const r = parse('FOR i = 1 TO 10\n  IF i > 5 THEN x = 1 ELSE NEXT\nNEXT');
    expect(r.where).toEqual(['2:28 E174']);
  });
  it('unclosed FOR reported at FOR', () => {
    expect(parse('FOR i = 1 TO 10\n  x = i\ny = 1').where).toEqual(['1:1 E171']);
  });
  it('an unclosed FOR does not eat the END IF around it', () => {
    const r = parse('IF a THEN\n FOR i = 1 TO 2\n x = 1\nEND IF\ny = 1');
    expect(r.where).toEqual(['2:2 E171']);
    expect(r.body.map((s) => s.kind)).toEqual(['If', 'Let']);
  });
  it('a bad header reports once and the loop is still read', () => {
    const r = parse('FOR i 1 TO 3\n x = 1\nNEXT\ny = 2');
    expect(r.where).toEqual(['1:7 E141']);
    expect(r.body.map((s) => s.kind)).toEqual(['For', 'Let']);
  });
  it('FOR without TO', () => {
    expect(parse('FOR i = 1\nNEXT').where).toEqual(['1:10 E141']);
  });
});

describe('WHILE / WEND, DO / LOOP', () => {
  it('WHILE', () => {
    const s = one<WhileStmt>('WHILE n > 0\n n = n - 1\nWEND', 'While');
    expect(sexp(s.cond)).toBe('(> n 0)');
    expect(s.body).toHaveLength(1);
  });
  it('WHILE on one line', () => {
    expect(one<WhileStmt>('WHILE INKEY$ = "" : WEND', 'While').body).toHaveLength(0);
  });
  it('WEND without WHILE', () => {
    expect(parse('n = 1\nWEND').where).toEqual(['2:1 E172']);
  });
  it('unclosed WHILE reported at WHILE', () => {
    expect(parse('n = 1\nWHILE n > 0\n n = n - 1').where).toEqual(['2:1 E171']);
  });
  it('plain DO', () => {
    const s = one<DoLoopStmt>('DO\n n = n + 1\nLOOP', 'DoLoop');
    expect([s.pre, s.post]).toEqual([null, null]);
    expect(s.body).toHaveLength(1);
  });
  it('DO WHILE / DO UNTIL', () => {
    const w = one<DoLoopStmt>('DO WHILE n > 0\nLOOP', 'DoLoop');
    expect(w.pre).toMatchObject({ until: false });
    expect(sexp(w.pre!.expr)).toBe('(> n 0)');
    expect(one<DoLoopStmt>('DO UNTIL n >= 10\nLOOP', 'DoLoop').pre).toMatchObject({ until: true });
  });
  it('LOOP WHILE / LOOP UNTIL', () => {
    const w = one<DoLoopStmt>('DO\nLOOP WHILE n > 5', 'DoLoop');
    expect(w.post).toMatchObject({ until: false });
    expect(w.pre).toBeNull();
    expect(one<DoLoopStmt>('DO : LOOP UNTIL INKEY(47) = 0', 'DoLoop').post).toMatchObject({ until: true });
  });
  it('nesting', () => {
    const s = one<DoLoopStmt>('DO\n WHILE n < 100\n  n = n * 2\n WEND\nLOOP UNTIL n > 50', 'DoLoop');
    expect(s.body[0]?.kind).toBe('While');
  });
  it('LOOP without DO and unclosed DO', () => {
    expect(parse('n = 1\nLOOP').where).toEqual(['2:1 E172']);
    expect(parse('DO\n n = n + 1\nx = 1').where).toEqual(['1:1 E171']);
  });
  it('unstructured WEND and LOOP inside a one-line IF', () => {
    expect(parse('WHILE a\n IF b THEN WEND\nWEND').where).toEqual(['2:12 E174']);
    expect(parse('DO\n IF b THEN LOOP\nLOOP').where).toEqual(['2:12 E174']);
  });
});

describe('SELECT CASE', () => {
  const sel = (text: string): SelectCaseStmt => one<SelectCaseStmt>(text, 'SelectCase');
  it('values, lists, ranges and CASE ELSE', () => {
    const s = sel('SELECT CASE k\n CASE 49\n x = 1\n CASE 50, 51, 53\n x = 2\n CASE 65 TO 90\n x = 3\n CASE ELSE\n x = 4\nEND SELECT');
    expect(sexp(s.subject)).toBe('k');
    expect(s.cases.map((c) => c.tests.map((t) => t.kind))).toEqual([['CaseValue'], ['CaseValue', 'CaseValue', 'CaseValue'], ['CaseRange']]);
    expect(s.cases.map((c) => c.body.length)).toEqual([1, 1, 1]);
    expect(s.elseBody).toHaveLength(1);
  });
  it('SELECT CASE IS forms', () => {
    const s = sel('SELECT CASE k\n CASE IS > 200\n CASE IS <= 8\n CASE IS = 3\n CASE IS <> 0\n CASE IS >= 4\n CASE IS < 1\nEND SELECT');
    const ops = s.cases.map((c) => (c.tests[0] as { op: string }).op);
    expect(ops).toEqual(['>', '<=', '=', '<>', '>=', '<']);
    const first = (s.cases[0] as CaseClause).tests[0];
    expect(first?.kind === 'CaseIs' && sexp(first.value)).toBe('200');
  });
  it('IS with the Locomotive spellings => and =<', () => {
    const s = sel('SELECT CASE k\n CASE IS => 4\n CASE IS =< 2\nEND SELECT');
    expect(s.cases.map((c) => (c.tests[0] as { op: string }).op)).toEqual(['>=', '<=']);
  });
  it('string values and ranges', () => {
    const s = sel('SELECT CASE a$\n CASE "Y", "y"\n CASE "A" TO "Z"\nEND SELECT');
    expect(s.cases.map((c) => c.tests.length)).toEqual([2, 1]);
    expect(s.cases[1]?.tests[0]?.kind).toBe('CaseRange');
  });
  it('mixed test forms in one CASE list', () => {
    const s = sel('SELECT CASE k\n CASE 1, 3 TO 5, IS > 9\nEND SELECT');
    expect(s.cases[0]?.tests.map((t) => t.kind)).toEqual(['CaseValue', 'CaseRange', 'CaseIs']);
  });
  it('CASE after a colon, on the SELECT line and between statements', () => {
    const r = parse('SELECT CASE k : CASE 1, 3 TO 5, IS > 9\n x = 1\n CASE 2 : x = 2 : CASE ELSE : x = 3\nEND SELECT');
    expect(r.where).toEqual([]);
    const s = r.body[0] as SelectCaseStmt;
    expect(s.cases.map((c) => c.body.length)).toEqual([1, 1]);
    expect(s.elseBody).toHaveLength(1);
  });
  it('nested SELECT', () => {
    const s = sel('SELECT CASE k\n CASE IS = 3\n SELECT CASE a$\n CASE "A"\n x = 1\n END SELECT\n CASE IS >= 4\n x = 2\nEND SELECT');
    expect(s.cases).toHaveLength(2);
    expect(s.cases[0]?.body[0]?.kind).toBe('SelectCase');
  });
  it('line labels in a CASE body stay in it', () => {
    const r = parse('SELECT CASE k\n CASE 1\n10 x = 1\nEND SELECT');
    expect(r.where).toEqual([]);
  });
  it('a SELECT with no CASE is allowed', () => {
    expect(sel('SELECT CASE k\nEND SELECT').cases).toEqual([]);
  });
  it('unclosed SELECT reported at SELECT', () => {
    expect(parse('SELECT CASE k\n CASE 1\n x = 1\ny = 2').where).toEqual(['1:1 E171']);
  });
  it('misplaced parts', () => {
    expect(parse('SELECT CASE k\n x = 1\n CASE 1\nEND SELECT').where).toEqual(['2:2 E178']);
    expect(parse('SELECT CASE k\n CASE ELSE\n CASE 1\nEND SELECT').where).toEqual(['3:2 E178']);
    expect(parse('SELECT k\n CASE 1\nEND SELECT').where).toEqual(['1:8 E178']);
    expect(parse('CASE 1').where).toEqual(['1:1 E175']);
    expect(parse('x = 1\nEND SELECT').where).toEqual(['2:1 E175']);
  });
  it('a bad test reports once and the clause body is still read', () => {
    const r = parse('SELECT CASE k\n CASE IS 4\n x = 1\n CASE 2\nEND SELECT');
    expect(r.where).toEqual(['2:10 E141']);
    expect((r.body[0] as SelectCaseStmt).cases).toHaveLength(2);
  });
});

describe('EXIT, CONTINUE and jumps', () => {
  it('EXIT and CONTINUE with a target', () => {
    for (const t of ['FOR', 'WHILE', 'DO', 'SUB', 'FUNCTION']) expect(one('EXIT ' + t, 'Exit')).toMatchObject({ target: t });
    for (const t of ['FOR', 'WHILE', 'DO']) expect(one('CONTINUE ' + t, 'Continue')).toMatchObject({ target: t });
  });
  it('EXIT and CONTINUE need a valid target', () => {
    expect(parse('EXIT').where).toEqual(['1:5 E177']);
    expect(parse('CONTINUE SUB').where).toEqual(['1:10 E177']);
    expect(parse('EXIT x').where).toEqual(['1:6 E177']);
  });
  it('EXIT FOR inside a one-line IF in a loop', () => {
    const r = parse('FOR i = 1 TO 9\n IF i > 5 THEN EXIT FOR\nNEXT');
    expect(r.where).toEqual([]);
  });
  it('GOTO and GOSUB take line numbers and labels', () => {
    expect(one('GOTO 100', 'Goto')).toMatchObject({ implicit: false, target: { kind: 'LineTarget', number: 100 } });
    expect(one('GOTO Done', 'Goto')).toMatchObject({ target: { kind: 'LabelTarget', key: 'done' } });
    expect(one('GOSUB 1000', 'Gosub')).toMatchObject({ target: { number: 1000 } });
    expect(one('GOSUB ShowTitle', 'Gosub')).toMatchObject({ target: { name: 'ShowTitle' } });
  });
  it('GO TO and GO SUB are soft words', () => {
    const g = parse('GO TO Finish');
    expect(g.where).toEqual([]);
    expect(g.body[0]).toMatchObject({ kind: 'Goto', implicit: false });
    expect(g.text((g.body[0] as Stmt).span)).toBe('GO TO Finish');
    expect(one('GO SUB 1000', 'Gosub')).toMatchObject({ target: { number: 1000 } });
  });
  it('GO stays a name when it is not GO TO / GO SUB', () => {
    expect(one('go = 3', 'Let')).toMatchObject({ kind: 'Let' });
    expect(parse('GO').body[0]?.kind).toBe('SubCall');
  });
  it('a bad jump target is E148', () => {
    expect(parse('GOTO "x"').where).toEqual(['1:6 E148']);
    expect(parse('GOTO').where).toEqual(['1:5 E148']);
  });
  it('RETURN with and without a value', () => {
    expect(one('RETURN', 'Return')).toMatchObject({ value: null });
    const r = one<Stmt & { value: never }>('RETURN a + 1', 'Return');
    expect(sexp(r.value)).toBe('(+ a 1)');
    const line = one<IfStmt>('IF a THEN RETURN ELSE x = 1', 'If');
    expect(line.branches[0]?.body[0]).toMatchObject({ kind: 'Return', value: null });
    expect(line.elseBody).toHaveLength(1);
  });
});

describe('ON, ERROR, END, STOP, EVERY, AFTER', () => {
  it('ON expr GOTO / GOSUB lists', () => {
    const g = one<OnGotoStmt>('ON level GOTO 100, 200, Hard', 'OnGoto');
    expect(g.gosub).toBe(false);
    expect(sexp(g.selector)).toBe('level');
    expect(g.targets.map((t) => t.kind)).toEqual(['LineTarget', 'LineTarget', 'LabelTarget']);
    const s = one<OnGotoStmt>('ON n + 1 GOSUB 1000, ShowTitle', 'OnGoto');
    expect(s.gosub).toBe(true);
    expect(sexp(s.selector)).toBe('(+ n 1)');
    expect(one<OnGotoStmt>('ON n GO TO 1, 2', 'OnGoto').targets).toHaveLength(2);
  });
  it('ON needs GOTO or GOSUB and a target list', () => {
    expect(parse('ON n PRINT').where).toEqual(['1:6 E180']);
    expect(parse('ON n GOTO 1,').where).toEqual(['1:13 E148']);
  });
  it('ON BREAK STOP | CONT', () => {
    expect(one('ON BREAK STOP', 'OnBreak')).toMatchObject({ action: 'STOP' });
    expect(one('ON BREAK CONT', 'OnBreak')).toMatchObject({ action: 'CONT' });
    expect(parse('ON BREAK GOTO 1').where).toEqual(['1:10 E181']);
  });
  it('ON ERROR GOTO label', () => {
    const s = one<OnErrorStmt>('ON ERROR GOTO Handler', 'OnError');
    expect(s.target).toMatchObject({ kind: 'LabelTarget', key: 'handler' });
    expect(one<OnErrorStmt>('ON ERROR GOTO 500', 'OnError').target).toMatchObject({ number: 500 });
  });
  it('ON ERROR GOTO 0', () => {
    expect(one<OnErrorStmt>('ON ERROR GOTO 0', 'OnError').target).toBeNull();
    expect(parse('ON ERROR 5').where).toEqual(['1:10 E180']);
  });
  it('ERROR n', () => {
    const s = one<Stmt & { code: never }>('ERROR 5 + 2', 'Error');
    expect(sexp(s.code)).toBe('(+ 5 2)');
    expect(parse('ERROR').where).toEqual(['1:6 E142']);
  });
  it('END and STOP', () => {
    expect(parse('END : STOP').body.map((s) => s.kind)).toEqual(['End', 'Stop']);
    expect(parse('IF a THEN END ELSE STOP').where).toEqual([]);
  });
  it('END IF / END SELECT / END SUB without their opener', () => {
    expect(parse('END SUB').where).toEqual(['1:1 E175']);
    expect(parse('END FUNCTION').where).toEqual(['1:1 E175']);
    expect(parse('x = 1\nEND\ny = 2').where).toEqual([]);
  });
  it('EVERY and AFTER, with and without a timer', () => {
    const e = one<EveryAfterStmt>('EVERY 50 GOSUB Tick', 'EveryAfter');
    expect(e).toMatchObject({ every: true, timer: null, target: { key: 'tick' } });
    const t = one<EveryAfterStmt>('EVERY 25, 1 GOSUB 1000', 'EveryAfter');
    expect(sexp(t.timer!)).toBe('1');
    expect(t.target).toMatchObject({ number: 1000 });
    const a = one<EveryAfterStmt>('AFTER 10, 2 GO SUB TimeUp', 'EveryAfter');
    expect(a).toMatchObject({ every: false });
    expect(sexp(a.interval)).toBe('10');
    expect(parse('AFTER 10 GOTO 5').where).toEqual(['1:10 E180']);
  });
});

describe('RESUME', () => {
  it('parses the three forms (L4-ERR)', () => {
    const forms: Array<[string, string, string | null]> = [
      ['RESUME', 'same', null],
      ['RESUME NEXT', 'next', null],
      ['RESUME 100', 'target', 'LineTarget'],
      ['RESUME Handler', 'target', 'LabelTarget'],
    ];
    for (const [text, mode, target] of forms) {
      const r = parse(text + '\nx = 1');
      expect(r.where).toEqual([]);
      expect(r.body.map((s) => s.kind)).toEqual(['Resume', 'Let']);
      expect(r.body[0]).toMatchObject({ mode });
      expect((r.body[0] as { target: { kind: string } | null }).target?.kind ?? null).toBe(target);
    }
  });
  it('RESUME ends at a colon or an ELSE, and NEXT inside a loop does not close the loop', () => {
    const r = parse('FOR i = 1 TO 2\n RESUME NEXT\nNEXT');
    expect(r.where).toEqual([]);
    expect(r.body.map((s) => s.kind)).toEqual(['For']);
    expect(parse('IF a THEN RESUME ELSE RESUME NEXT').where).toEqual([]);
    expect(parse('RESUME: x = 1').body.map((s) => s.kind)).toEqual(['Resume', 'Let']);
  });
  it('RESUME followed by something else is E182', () => {
    const r = parse('RESUME "x"\nx = 1');
    expect(r.where).toEqual(['1:8 E182']);
    expect(r.body.map((s) => s.kind)).toEqual(['BadStmt', 'Let']);
  });
});

describe('never throws', () => {
  it('survives truncated input of every control statement', () => {
    const sources = [
      'IF', 'IF a', 'IF a THEN', 'IF a THEN\nELSEIF', 'FOR', 'FOR i', 'FOR i =', 'FOR i = 1 TO', 'FOR i = 1 TO 2 STEP', 'NEXT', 'NEXT i,',
      'WHILE', 'DO WHILE', 'LOOP UNTIL', 'SELECT', 'SELECT CASE', 'SELECT CASE a\nCASE', 'SELECT CASE a\nCASE IS', 'EXIT', 'ON', 'ON BREAK',
      'ON ERROR', 'ON ERROR GOTO', 'ON a GOTO', 'EVERY', 'EVERY 1 GOSUB', 'AFTER 1,', 'GO', 'GO TO', 'END', 'RESUME', 'RETURN',
    ];
    for (const s of sources) expect(() => parseSource(s)).not.toThrow();
  });
});
