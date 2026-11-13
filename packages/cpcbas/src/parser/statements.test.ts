import { afterEach, describe, expect, it } from 'vitest';
import { exprOf, parseSource, sexp } from '../../test/parse-helpers.js';
import type { IfStmt, Stmt } from '../ast/ast.js';
import { unparse } from '../ast/unparse.js';
import { DiagnosticBag } from '../core/diagnostics.js';
import { SourceSet } from '../core/source.js';
import { lex } from '../lexer/index.js';
import { controlParsers } from './control.js';
import { declarationParsers } from './declarations.js';
import { IMPLEMENTED, parse } from './index.js';
import { createContext } from './statements.js';
import { statementParsers } from './stmts.js';
import type { StatementParser } from './types.js';

function kinds(text: string): string[] {
  return parseSource(text).program.body.map((s) => s.kind);
}

describe('parser is marked implemented', () => {
  it('flag and empty tables', () => {
    expect(IMPLEMENTED).toBe(true);
    expect(Object.keys(declarationParsers)).toContain('DIM');
    expect(Object.keys(controlParsers)).toContain('IF');
    expect(Object.keys(statementParsers)).toContain('PRINT');
  });
  it('an empty file is an empty program', () => {
    const p = parseSource('');
    expect(p.program.body).toEqual([]);
    expect(p.where).toEqual([]);
    expect(parseSource("' just a comment\n\n").program.body).toEqual([]);
  });
});

describe('unnumberedLine (follow-up 80)', () => {
  const marked = (text: string): string[] => parseSource(text).program.body.map((s) => `${s.kind}${s.unnumberedLine === true ? '*' : ''}`);
  it('marks the first item of a line with no number once some earlier line has one', () => {
    expect(marked('10 a = 1\nb = 2: c = 3\n20 d = 4\nlabel: e = 5\n: f = 6')).toEqual(['LineLabel', 'Let', 'Let*', 'Let', 'LineLabel', 'Let', 'LineLabel*', 'Let', 'Let*']);
  });
  it('marks nothing in a program with no line numbers, or before the first one', () => {
    expect(marked('a = 1\nb = 2')).toEqual(['Let', 'Let']);
    expect(marked('a = 1\n10 b = 2')).toEqual(['Let', 'LineLabel', 'Let']);
  });
  it('marks statements of a multi-line block on their own lines, not those of a one-line IF', () => {
    expect(parseSource('10 IF x THEN y = 1\n20 IF x THEN\n  y = 2\nEND IF').program.body.filter((s) => s.kind === 'If').map((s) => s.unnumberedLine === true)).toEqual([false, false]);
    const multi = parseSource('20 IF x THEN\n  y = 2\nEND IF').program.body.find((s) => s.kind === 'If') as IfStmt;
    expect(multi.branches[0]?.body.map((s) => `${s.kind}${s.unnumberedLine === true ? '*' : ''}`)).toEqual(['Let*']);
  });
});

describe('labels and line numbers become LineLabel', () => {
  it('line numbers precede the statements of their line', () => {
    const p = parseSource('10 a = 1\n20 b = 2\n30');
    expect(p.where).toEqual([]);
    expect(p.program.body.map((s) => s.kind)).toEqual(['LineLabel', 'Let', 'LineLabel', 'Let', 'LineLabel']);
    const l = p.program.body[0];
    expect(l?.kind === 'LineLabel' && [l.number, l.name, l.key]).toEqual([10, null, null]);
    expect(p.sources.text(l?.span as never)).toBe('10');
  });
  it('named labels keep their name and key', () => {
    const p = parseSource('Start: a = 1\nloop2:\n b = 2');
    expect(p.where).toEqual([]);
    const [l1, , l2] = p.program.body;
    expect(l1?.kind === 'LineLabel' && [l1.number, l1.name, l1.key]).toEqual([null, 'Start', 'start']);
    expect(l2?.kind === 'LineLabel' && [l2.name, l2.key]).toEqual(['loop2', 'loop2']);
    expect(p.sources.text(l1?.span as never)).toBe('Start:');
  });
  it('statements on one line are separated by colons', () => {
    expect(kinds('a = 1 : b = 2 :: c = 3 :')).toEqual(['Let', 'Let', 'Let']);
  });
  it('the last line may end at EOF without a Newline', () => {
    expect(parseSource('a = 1').where).toEqual([]);
  });
});

describe('duplicate line number E145 with related', () => {
  it('points at the second use and relates to the first', () => {
    const p = parseSource('10 a = 1\n20 b = 2\n10 c = 3');
    expect(p.where).toEqual(['3:1 E145']);
    const d = p.diag.all()[0];
    expect(d?.message).toBe('Duplicate line number 10');
    const rel = d?.related?.[0];
    expect(rel && p.sources.position(rel.span.file, rel.span.start)).toMatchObject({ line: 1, col: 1 });
    expect(p.program.body.filter((s) => s.kind === 'LineLabel')).toHaveLength(3);
  });
  it('does not stop the parse', () => {
    expect(kinds('10 a = 1\n10 b = 2')).toEqual(['LineLabel', 'Let', 'LineLabel', 'Let']);
  });
});

describe('assignment vs SubCall vs CallOrIndex', () => {
  const first = (text: string): Stmt => {
    const p = parseSource(text);
    expect(p.where).toEqual([]);
    return p.program.body[0] as Stmt;
  };
  it('a = 1', () => {
    const s = first('a = 1');
    expect(s.kind).toBe('Let');
    if (s.kind === 'Let') {
      expect(s.explicitLet).toBe(false);
      expect(s.target.kind).toBe('Name');
      expect(sexp(s.value)).toBe('1');
    }
  });
  it('a(1) = 2 assigns to an element', () => {
    const s = first('a(1, i) = 2');
    expect(s.kind).toBe('Let');
    if (s.kind === 'Let') expect(s.target.kind === 'CallOrIndex' && s.target.args).toHaveLength(2);
  });
  it('LET is optional and recorded', () => {
    const s = first('LET a$ = "x"');
    expect(s.kind === 'Let' && s.explicitLet).toBe(true);
    const t = first('let b(2) = 1');
    expect(t.kind === 'Let' && t.target.kind).toBe('CallOrIndex');
  });
  it('Foo 1, 2 is a SubCall without parentheses', () => {
    const s = first('Foo 1, 2');
    expect(s.kind).toBe('SubCall');
    if (s.kind === 'SubCall') {
      expect(s.name.text).toBe('Foo');
      expect(s.parens).toBe(false);
      expect(s.args.map(sexp)).toEqual(['1', '2']);
    }
  });
  it('Foo(1, 2) is a SubCall with parentheses', () => {
    const s = first('Foo(1, 2)');
    expect(s.kind === 'SubCall' && [s.parens, s.args.length]).toEqual([true, 2]);
  });
  it('Foo and Foo() are SubCalls with no arguments', () => {
    const a = first('Foo');
    expect(a.kind === 'SubCall' && [a.parens, a.args.length]).toEqual([false, 0]);
    const b = first('Foo()');
    expect(b.kind === 'SubCall' && [b.parens, b.args.length]).toEqual([true, 0]);
  });
  it('a parenthesis that starts the first argument', () => {
    const s = first('Foo (1 + 2) * 3, 4');
    expect(s.kind === 'SubCall' && [s.parens, s.args.map(sexp)]).toEqual([false, ['(* (+ 1 2) 3)', '4']]);
    const t = first('Foo (1), 2');
    expect(t.kind === 'SubCall' && [t.parens, t.args.length]).toEqual([false, 2]);
  });
  it('arguments can be names, strings, functions and signed numbers', () => {
    const s = first('Foo a, "s", LEN(a$), -1, @buf, NOT x');
    expect(s.kind === 'SubCall' && s.args.length).toBe(6);
    const t = first('Foo -1');
    expect(t.kind === 'SubCall' && t.args.length).toBe(1);
  });
  it('a SubCall followed by another statement on the line', () => {
    expect(kinds('Foo 1 : Bar(2) : Baz')).toEqual(['SubCall', 'SubCall', 'SubCall']);
  });
  it('spans', () => {
    const p = parseSource('  Foo 1, 22\n  a(1) = 5');
    const [s1, s2] = p.program.body;
    expect(p.sources.text(s1?.span as never)).toBe('Foo 1, 22');
    expect(p.sources.text(s2?.span as never)).toBe('a(1) = 5');
  });
  it('a name followed by an operator is not a statement', () => {
    expect(parseSource('a + 1').where).toEqual(['1:3 E141']);
    expect(parseSource('a )').where).toEqual(['1:3 E141']);
  });
  it('round-trips through unparse', () => {
    const p = parseSource('10 a = 1 + 2 * 3\nFoo 1, a$\nb(1) = 2\nLET c = 1');
    expect(unparse(p.program)).toContain('LET c = 1');
    expect(unparse(p.program)).toContain('b(1) = 2');
  });
});

describe('one diagnostic per bad statement, parse continues on the next line', () => {
  it('several errors in one statement give one diagnostic', () => {
    const p = parseSource('x = (1 + * 2 ) ) )\ny = 3');
    expect(p.codes).toHaveLength(1);
    expect(p.program.body.map((s) => s.kind)).toEqual(['Let', 'Let']);
  });
  it('each bad line reports once', () => {
    const p = parseSource('x = 1 +\ny = 2\nz = * 3\nw = 4');
    expect(p.where).toEqual(['1:8 E142', '3:5 E142']);
    expect(p.program.body.map((s) => s.kind)).toEqual(['Let', 'Let', 'Let', 'Let']);
  });
  it('resynchronises at a colon', () => {
    const p = parseSource('x = 1 + : y = 2');
    expect(p.where).toEqual(['1:9 E142']);
    expect(p.program.body.map((s) => s.kind)).toEqual(['Let', 'Let']);
  });
  it('a keyword that no table handles is unexpected, once', () => {
    const p = parseSource('THEN 1, 2, 3\na = 1');
    expect(p.where).toEqual(['1:1 E141']);
    expect(p.program.body.map((s) => s.kind)).toEqual(['BadStmt', 'Let']);
    const bad = p.program.body[0];
    expect(p.sources.text(bad?.span as never)).toBe('THEN 1, 2, 3');
  });
  it('a function used as a statement gets a hint', () => {
    const p = parseSource('LEN(a$)');
    expect(p.where).toEqual(['1:1 E141']);
    expect(p.diag.all()[0]?.hint).toContain('function');
  });
  it('text that is not a statement at all', () => {
    expect(parseSource('= 3\na = 1').where).toEqual(['1:1 E141']);
    expect(parseSource('"hi"\na = 1').where).toEqual(['1:1 E141']);
    expect(parseSource('(1)\na = 1').where).toEqual(['1:1 E141']);
  });
  it('a lexer error is not reported twice', () => {
    const p = parseSource('x = 1 ~ 2\ny = ~\nz = 3');
    expect(p.codes).toEqual(['E101', 'E101']);
    expect(p.program.body.map((s) => s.kind)).toEqual(['Let', 'Let', 'Let']);
    expect(parseSource('~ a = 1\nb = 2').codes).toEqual(['E101']);
  });
  it('never throws on garbage', () => {
    const junk = ['', '(((', ')))', ':::', '\n\n', '10', 'a(', 'a(,)', 'LET', 'LET =', 'x = ,', '@', 'FN', 'x = FN', '"unclosed', '|', '#', 'DATA', '1 2 3'];
    for (const j of junk) expect(() => parseSource(j)).not.toThrow();
    expect(() => parseSource(`${'a = (1\n'.repeat(500)}`)).not.toThrow();
  });
});

describe('parseBlock and terminators', () => {
  function ctxFor(text: string) {
    const sources = new SourceSet();
    const file = sources.add('t.bas', text);
    const diag = new DiagnosticBag();
    const tokens = lex(file, diag, {});
    return { ctx: createContext(tokens, diag, sources), diag, sources };
  }

  it('stops at a terminator and leaves the cursor on it', () => {
    const { ctx, diag } = ctxFor('a = 1\nb = 2 : c = 3\nEND IF\nd = 4');
    const terms = [['ELSE'], ['END', 'IF']];
    const r = ctx.parseBlock(terms);
    expect(r.body.map((s) => s.kind)).toEqual(['Let', 'Let', 'Let']);
    expect(r.matched).toBe(1);
    expect(ctx.cursor.atSeq(['END', 'IF'])).toBe(true);
    const span = ctx.takeTerminator(terms, r);
    expect(ctx.sources.text(span)).toBe('END IF');
    expect(ctx.parseBlock([]).body.map((s) => s.kind)).toEqual(['Let']);
    expect(diag.all()).toEqual([]);
  });
  it('the terminator may follow a colon, and CASE may follow ":" on the same line', () => {
    const { ctx } = ctxFor('a = 1 : CASE 1');
    const r = ctx.parseBlock([['CASE'], ['END', 'SELECT']]);
    expect(r.matched).toBe(0);
    expect(r.body).toHaveLength(1);
  });
  it('a terminator right after a statement without a separator ends the statement (IF ... ELSE)', () => {
    const { ctx, diag } = ctxFor('a = 1 ELSE b = 2');
    const r = ctx.parseBlock([['ELSE']], { line: true });
    expect(r.matched).toBe(0);
    expect(r.body).toHaveLength(1);
    expect(diag.all()).toEqual([]);
  });
  it('END alone is not the terminator END IF', () => {
    const { ctx } = ctxFor('x = 1\nEND IF');
    const r = ctx.parseBlock([['END', 'IF']]);
    expect(r.matched).toBe(0);
  });
  it('reports matched -1 at the end of the file (unclosed block)', () => {
    const { ctx } = ctxFor('a = 1\nb = 2\n');
    const r = ctx.parseBlock([['NEXT']]);
    expect(r.matched).toBe(-1);
    expect(r.body).toHaveLength(2);
  });
  it('single-line mode stops at the Newline without consuming it', () => {
    const { ctx } = ctxFor('a = 1 : b = 2\nc = 3');
    const r = ctx.parseBlock([['ELSE']], { line: true });
    expect(r.body).toHaveLength(2);
    expect(r.matched).toBe(-1);
    expect(ctx.cursor.at('Newline')).toBe(true);
  });
  it('a block ends at a terminator of an enclosing block, without eating it', () => {
    const { ctx } = ctxFor('a = 1\nEND IF\nb = 2');
    const outerTerms = [['END', 'IF']];
    ctx.cursor.pushTerminators(outerTerms);
    const inner = ctx.parseBlock([['NEXT']]);
    ctx.cursor.popTerminators();
    expect(inner.matched).toBe(-1);
    expect(ctx.cursor.atSeq(['END', 'IF'])).toBe(true);
  });
  it('line labels inside a block stay in that block', () => {
    const { ctx } = ctxFor('10 a = 1\n20 NEXT\n30 b = 2');
    const r = ctx.parseBlock([['NEXT']]);
    expect(r.body.map((s) => s.kind)).toEqual(['LineLabel', 'Let', 'LineLabel']);
    expect(r.matched).toBe(0);
  });
  it('statements inside a block that go wrong resynchronise within the block', () => {
    const { ctx, diag } = ctxFor('a = (1\nb = 2\nEND IF');
    const r = ctx.parseBlock([['END', 'IF']]);
    expect(r.body.map((s) => s.kind)).toEqual(['Let', 'Let']);
    expect(r.matched).toBe(0);
    expect(diag.all().map((d) => d.code)).toEqual(['E143']);
  });
});

describe('dispatch through the tables', () => {
  const added: Array<[Record<string, StatementParser>, string, StatementParser | undefined]> = [];
  const put = (table: unknown, key: string, p: StatementParser): void => {
    const t = table as Record<string, StatementParser>;
    added.push([t, key, t[key]]);
    t[key] = p;
  };
  afterEach(() => {
    // Undo in reverse order and put back what a real table had under the key.
    for (const [t, k, old] of added.splice(0).reverse()) {
      if (old) t[k] = old;
      else delete t[k];
    }
  });

  /** A toy single-line IF, to test the context the way PCTRL will use it. */
  function installToyIf(): void {
    put(controlParsers, 'IF', (ctx) => {
      const c = ctx.cursor;
      const start = c.next().span;
      const cond = ctx.parseExpr();
      if (!c.expectKw('THEN')) return ctx.badStmt(start);
      const then = ctx.parseBlock([['ELSE']], { line: true });
      let elseBody: Stmt[] | null = null;
      if (then.matched === 0) {
        ctx.takeTerminator([['ELSE']], then);
        elseBody = ctx.parseBlock([['ELSE']], { line: true }).body;
      }
      const node: IfStmt = {
        kind: 'If',
        span: c.spanFrom(start),
        form: 'line',
        branches: [{ cond, body: then.body, span: start }],
        elseBody,
      };
      return node;
    });
  }

  it('a keyword goes to the table that has it', () => {
    put(statementParsers, 'END', (ctx) => {
      const t = ctx.cursor.next();
      return { kind: 'End', span: t.span };
    });
    expect(kinds('END\na = 1')).toEqual(['End', 'Let']);
  });
  it('parsers in all three tables are found', () => {
    const mk = (kind: 'End' | 'Stop'): StatementParser => (ctx) => ({ kind, span: ctx.cursor.next().span });
    put(declarationParsers, 'END', mk('End'));
    put(controlParsers, 'STOP', mk('Stop'));
    expect(kinds('END : STOP')).toEqual(['End', 'Stop']);
  });
  it('a dangling ELSE binds to the nearest single-line IF', () => {
    installToyIf();
    const p = parseSource('IF a THEN IF b THEN c = 1 ELSE d = 2');
    expect(p.where).toEqual([]);
    const outer = p.program.body[0] as IfStmt;
    expect(outer.elseBody).toBeNull();
    const inner = outer.branches[0]?.body[0] as IfStmt;
    expect(inner.kind).toBe('If');
    expect(inner.elseBody).toHaveLength(1);
  });
  it(': ELSE works and ELSE ends at the line end', () => {
    installToyIf();
    const p = parseSource('IF a THEN b = 1 : ELSE c = 2\nd = 3');
    expect(p.where).toEqual([]);
    expect(p.program.body.map((s) => s.kind)).toEqual(['If', 'Let']);
    const i = p.program.body[0] as IfStmt;
    expect(i.elseBody).toHaveLength(1);
  });
  it('a stray ELSE is E144 after a statement and E175 at the start', () => {
    expect(parseSource('a = 1 ELSE b = 2').where).toEqual(['1:7 E144']);
    expect(parseSource('ELSE b = 2').where).toEqual(['1:1 E175']);
  });
  it('a bad condition in a line IF reports once and the parse goes on', () => {
    installToyIf();
    const p = parseSource('IF a = THEN b = 1\nc = 2');
    expect(p.codes).toEqual(['E142']);
    expect(p.program.body.map((s) => s.kind)).toEqual(['If', 'Let']);
  });
  it('a soft word at the start of a statement reaches its parser, but not when assigned', () => {
    put(statementParsers, 'LIST', (ctx) => {
      const t = ctx.cursor.next();
      ctx.error('E141', t.span, 'LIST is an interpreter command');
      return ctx.badStmt(t.span);
    });
    expect(parseSource('LIST').where).toEqual(['1:1 E141']);
    expect(parseSource('list = 3').where).toEqual([]);
    expect(kinds('list = 3')).toEqual(['Let']);
  });
  it('a soft-word parser may decline with null', () => {
    put(statementParsers, 'OVER', () => null);
    expect(kinds('over 1')).toEqual(['SubCall']);
  });
  it('RSX and directive tokens use their own keys', () => {
    put(statementParsers, '|', (ctx) => {
      const t = ctx.cursor.next();
      return { kind: 'Rsx', span: t.span, name: t.kind === 'Rsx' ? t.name : '', args: [] };
    });
    expect(kinds('|DISC')).toEqual(['Rsx']);
    expect(parseSource('|DISC').where).toEqual([]);
    put(statementParsers, '#pragma', (ctx) => {
      const t = ctx.cursor.next();
      return { kind: 'Pragma', span: t.span, op: 'flag', name: 'x', value: null };
    });
    expect(kinds('#pragma explicit')).toEqual(['Pragma']);
  });
  it('a parser that returns without progress cannot hang the loop', () => {
    put(statementParsers, 'END', () => ({ kind: 'End', span: { file: 0 as never, start: 0, end: 0 } }));
    const p = parseSource('END END END');
    expect(p.program.body.length).toBeGreaterThan(0);
  });
  it('statements nested too deeply are an error, not a stack overflow', () => {
    installToyIf();
    const p = parseSource(`${'IF a THEN '.repeat(1000)}b = 1`);
    expect(p.codes).toContain('E151');
  });
});

describe('parse() result', () => {
  it('fills includes, mainFile and a span over the main file', () => {
    const p = parseSource('a = 1\n');
    expect(p.program.mainFile).toBe(p.program.span.file);
    expect(p.program.span).toMatchObject({ start: 0, end: 6 });
  });
  it('works with no main file', () => {
    const sources = new SourceSet();
    const diag = new DiagnosticBag();
    const prog = parse({ pp: { tokens: [], includes: [], macros: new Map(), mainFile: null }, sources, diagnostics: diag });
    expect(prog.body).toEqual([]);
    expect(diag.all()).toEqual([]);
  });
  it('expressions in statements use the same grammar', () => {
    expect(exprOf('a AND b')).toBe('(AND a b)');
  });
});
