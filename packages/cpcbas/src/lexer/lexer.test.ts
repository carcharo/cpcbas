import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DiagnosticBag } from '../core/diagnostics.js';
import { SourceSet } from '../core/source.js';
import type { LexOptions, Token } from '../core/tokens.js';
import { IMPLEMENTED, lex } from './index.js';

function run(text: string, options?: LexOptions) {
  const sources = new SourceSet();
  const file = sources.add('t.bas', text);
  const diag = new DiagnosticBag();
  const tokens = lex(file, diag, options);
  return { tokens, diag, sources, file };
}

/** Tokens without the trailing EOF. */
function toks(text: string, options?: LexOptions): Token[] {
  const { tokens } = run(text, options);
  return tokens.slice(0, -1);
}

function kinds(text: string, options?: LexOptions): string[] {
  return toks(text, options).map((t) => t.kind);
}

function codes(text: string): string[] {
  return run(text)
    .diag.all()
    .map((d) => d.code);
}

describe('lexer', () => {
  it('is marked implemented', () => {
    expect(IMPLEMENTED).toBe(true);
  });

  it('lexes every number form', () => {
    const cases: Array<[string, number, 2 | 10 | 16, boolean, '%' | '!' | null]> = [
      ['3', 3, 10, false, null],
      ['255', 255, 10, false, null],
      ['4294967295', 4294967295, 10, false, null],
      ['1.5', 1.5, 10, true, null],
      ['.5', 0.5, 10, true, null],
      ['2.', 2, 10, true, null],
      ['1E3', 1000, 10, true, null],
      ['2.5E-2', 0.025, 10, true, null],
      ['1e+2', 100, 10, true, null],
      ['&FF', 255, 16, false, null],
      ['&HFF', 255, 16, false, null],
      ['&hff', 255, 16, false, null],
      ['0xFF', 255, 16, false, null],
      ['0XFF', 255, 16, false, null],
      ['&X1010', 10, 2, false, null],
      ['0b1010', 10, 2, false, null],
      ['5%', 5, 10, false, '%'],
      ['5!', 5, 10, false, '!'],
      ['1.5!', 1.5, 10, true, '!'],
      ['&FF%', 255, 16, false, '%'],
    ];
    for (const [src, value, radix, isReal, suffix] of cases) {
      // After `x=` so that the number is not a line number.
      const { tokens, diag } = run(`x=${src}`);
      expect(diag.size, src).toBe(0);
      const t = tokens[2];
      expect(t).toMatchObject({ kind: 'Number', value, radix, isReal, suffix, text: src, span: { start: 2, end: 2 + src.length } });
    }
  });

  it('reports $FF as E950 at 1:1', () => {
    const { diag, sources, tokens } = run('$FF');
    const d = diag.all();
    expect(d).toHaveLength(1);
    expect(d[0]?.code).toBe('E950');
    expect(d[0]?.hint).toContain('&FF');
    expect(sources.position(d[0]!.span.file, d[0]!.span.start)).toMatchObject({ line: 1, col: 1 });
    expect(tokens[0]?.kind).toBe('Invalid');
  });

  it('reports malformed numbers (E104) and big ones (E105)', () => {
    expect(codes('x=&X12')).toEqual(['E104']);
    expect(codes('x=&X')).toEqual(['E104']);
    expect(codes('x=&')).toEqual(['E104']);
    expect(codes('x=&HZ')).toEqual(['E104']);
    expect(codes('x=1E')).toEqual(['E104']);
    expect(codes('x=1E+')).toEqual(['E104']);
    expect(codes('x=0b102')).toEqual(['E104']);
    expect(codes('x=0xZZ')).toEqual(['E104']);
    expect(codes('x=0bZ')).toEqual(['E104']);
    expect(codes('x=0b2')).toEqual(['E104']);
    expect(codes('x=0 b')).toEqual([]);
    expect(codes('x=4294967296')).toEqual([]);
    expect(codes('x=99999999999%')).toEqual(['E105']);
    expect(codes('x=&H100000000')).toEqual(['E105']);
    expect(codes('x=1E999')).toEqual(['E105']);
    expect(codes('x=99999999999999999999.5')).toEqual([]);
    // A real may be large; an exponent letter that starts a word is not an exponent.
    expect(kinds('x=2ELSE')).toEqual(['Identifier', '=', 'Number', 'Keyword']);
    const bad = toks('x=&X12')[2];
    expect(bad).toMatchObject({ kind: 'Invalid', text: '&X12' });
  });

  it('strings', () => {
    const t = toks('a$="He said ""hi"""')[2];
    expect(t).toMatchObject({ kind: 'String', value: 'He said "hi"', closed: true, text: '"He said ""hi"""' });
    expect(toks('a$=""')[2]).toMatchObject({ kind: 'String', value: '', closed: true });

    const { tokens, diag } = run('PRINT "Hello\nPRINT 1');
    expect(tokens[1]).toMatchObject({ kind: 'String', value: 'Hello', closed: false, span: { start: 6, end: 12 } });
    expect(tokens[2]?.kind).toBe('Newline');
    const d = diag.all();
    expect(d.map((x) => x.code)).toEqual(['W102']);
    expect(d[0]?.severity).toBe('warning');
    // Unclosed at the end of the file.
    const last = run('PRINT "x');
    expect(last.tokens[1]).toMatchObject({ kind: 'String', closed: false });
    expect(last.tokens[2]?.kind).toBe('EOF');
  });

  it('keywords are case-insensitive and canonical', () => {
    for (const src of ['print', 'Print', 'PRINT']) {
      expect(toks(src)[0]).toMatchObject({ kind: 'Keyword', keyword: 'PRINT', text: src });
    }
    expect(toks('?')[0]).toMatchObject({ kind: 'Keyword', keyword: 'PRINT', text: '?' });
    expect(toks('x=str$(1)')[2]).toMatchObject({ kind: 'Keyword', keyword: 'STR$', text: 'str$' });
    expect(toks('x$=inkey$')[2]).toMatchObject({ kind: 'Keyword', keyword: 'INKEY$' });
    expect(toks('x$=Copychr$(#0)')[2]).toMatchObject({ kind: 'Keyword', keyword: 'COPYCHR$' });
    expect(kinds('LINE INPUT a$')).toEqual(['Keyword', 'Keyword', 'Identifier']);

    const r = run('mode$');
    expect(r.diag.all().map((d) => d.code)).toEqual(['E107']);
    expect(r.diag.all()[0]?.hint).toBeDefined();
    expect(run('PRINT%').diag.all().map((d) => d.code)).toEqual(['E107']);
  });

  it('identifiers keep case in name and fold it in key', () => {
    expect(toks('Score$')[0]).toMatchObject({ kind: 'Identifier', name: 'Score', suffix: '$', key: 'score$', text: 'Score$' });
    expect(toks('Lives%')[0]).toMatchObject({ name: 'Lives', suffix: '%', key: 'lives%' });
    expect(toks('x_1!')[0]).toMatchObject({ name: 'x_1', suffix: '!', key: 'x_1!' });
    expect(toks('Plain')[0]).toMatchObject({ suffix: null, key: 'plain' });
    expect(toks('x=over')[2]).toMatchObject({ kind: 'Identifier', name: 'over' });
    expect(toks('x=List')[2]).toMatchObject({ kind: 'Identifier', key: 'list' });
    expect(codes('over=1: list=2')).toEqual([]);
  });

  it('FN glued to a name is the keyword FN, then the name', () => {
    const t = toks('DEF FNdouble(x)=x*2: y=FNdouble(3)+fnName$(a$)');
    expect(t.slice(0, 4)).toMatchObject([
      { kind: 'Keyword', keyword: 'DEF' },
      { kind: 'Keyword', keyword: 'FN', text: 'FN', span: { start: 4, end: 6 }, spaceBefore: true },
      { kind: 'Identifier', name: 'double', suffix: null, key: 'double', text: 'double', span: { start: 6, end: 12 }, spaceBefore: false },
      { kind: '(' },
    ]);
    const call = t.findIndex((x, i) => i > 4 && x.kind === 'Keyword' && x.keyword === 'FN');
    expect(t[call + 1]).toMatchObject({ kind: 'Identifier', name: 'double' });
    expect(t.at(-5)).toMatchObject({ kind: 'Keyword', keyword: 'FN', text: 'fn' });
    expect(t.at(-4)).toMatchObject({ kind: 'Identifier', name: 'Name', suffix: '$', key: 'name$', text: 'Name$' });
    // The spaced form, FN alone, FN followed by a digit, and a name that only contains FN.
    expect(kinds('y = FN double(3)')).toEqual(['Identifier', '=', 'Keyword', 'Identifier', '(', 'Number', ')']);
    expect(toks('x=FN')[2]).toMatchObject({ kind: 'Keyword', keyword: 'FN' });
    expect(toks('x=FN1')[2]).toMatchObject({ kind: 'Identifier', name: 'FN1' });
    expect(toks('x=leFNa')[2]).toMatchObject({ kind: 'Identifier', name: 'leFNa' });
    // At the start of a line FNa: is not a label.
    expect(kinds('FNa: x')).toEqual(['Keyword', 'Identifier', ':', 'Identifier']);
    expect(codes('DEF FNd(x)=x: PRINT FNd(1)')).toEqual([]);
  });

  it('a connecting word glued to digits is the word, then the number', () => {
    for (const w of ['TO', 'THEN', 'ELSE', 'STEP', 'GOTO', 'GOSUB']) {
      const t = toks(`x=${w}10`);
      expect(t[2], w).toMatchObject({ kind: 'Keyword', keyword: w, text: w });
      expect(t[3], w).toMatchObject({ kind: 'Number', value: 10, text: '10' });
    }
    expect(kinds('FOR i=1TO3')).toEqual(['Keyword', 'Identifier', '=', 'Number', 'Keyword', 'Number']);
    expect(toks('x=to1')[2]).toMatchObject({ kind: 'Keyword', keyword: 'TO' });
    // Names keep their digits, also when they start with a reserved word.
    expect(toks('x=end2')[2]).toMatchObject({ kind: 'Identifier', name: 'end2' });
    expect(toks('x=a1')[2]).toMatchObject({ kind: 'Identifier', name: 'a1' });
    expect(toks('x=to1$')[2]).toMatchObject({ kind: 'Identifier', name: 'to1', suffix: '$' });
  });

  it('a whole number beyond ULONG is a real; hex and integer-suffixed ones are still E105', () => {
    const { tokens, diag } = run('x=123456789012');
    expect(diag.size).toBe(0);
    expect(tokens[2]).toMatchObject({ kind: 'Number', value: 123456789012, isReal: true, suffix: null });
    expect(codes('x=4294967295')).toEqual([]);
    expect(toks('x=4294967295')[2]).toMatchObject({ isReal: false });
    expect(codes('x=&H100000000')).toEqual(['E105']);
    expect(codes('x=99999999999%')).toEqual(['E105']);
  });

  it('>< is <>', () => {
    expect(toks('a >< b')[1]).toMatchObject({ kind: '<>', text: '><' });
  });

  it('marks the token after a line comment', () => {
    expect(toks("IF a THEN ' c\nx")[3]).toMatchObject({ kind: 'Newline', commentBefore: true });
    expect(run('IF a THEN REM c').tokens[3]).toMatchObject({ kind: 'EOF', commentBefore: true });
    expect(toks('IF a THEN\nx')[3]).not.toHaveProperty('commentBefore');
  });

  it('line numbers and labels only at line start', () => {
    const a = toks('10 GOTO 10');
    expect(a.map((t) => t.kind)).toEqual(['LineNumber', 'Keyword', 'Number']);
    expect(a[0]).toMatchObject({ value: 10, lineStart: true, span: { start: 0, end: 2 } });
    expect(a[2]).toMatchObject({ kind: 'Number', value: 10, lineStart: false });

    const b = toks('again: PRINT');
    expect(b[0]).toMatchObject({ kind: 'Label', name: 'again', key: 'again', text: 'again:', span: { start: 0, end: 6 } });
    expect(b[1]).toMatchObject({ kind: 'Keyword', spaceBefore: true });

    expect(kinds('PRINT 10')).toEqual(['Keyword', 'Number']);
    expect(kinds('a: b')).toEqual(['Label', 'Identifier']);
    expect(kinds('x=1: a: b')).toEqual(['Identifier', '=', 'Number', ':', 'Identifier', ':', 'Identifier']);
    // Suffix, reserved word, or a blank before the colon: not a label.
    expect(kinds('a$: b')).toEqual(['Identifier', ':', 'Identifier']);
    expect(kinds('PRINT: b')).toEqual(['Keyword', ':', 'Identifier']);
    expect(kinds('a : b')).toEqual(['Identifier', ':', 'Identifier']);
    // Soft words can be labels; a real or a suffixed number is not a line number.
    expect(kinds('list: x')).toEqual(['Label', 'Identifier']);
    expect(kinds('1.5 x')).toEqual(['Number', 'Identifier']);
    expect(kinds('5% x')).toEqual(['Number', 'Identifier']);
    expect(kinds('  20 PRINT\n30 PRINT')).toEqual(['LineNumber', 'Keyword', 'Newline', 'LineNumber', 'Keyword']);
  });

  it('comments and continuation', () => {
    expect(kinds("PRINT 1 ' hello\nPRINT 2")).toEqual(['Keyword', 'Number', 'Newline', 'Keyword', 'Number']);
    expect(kinds('REM nothing here : PRINT\nPRINT')).toEqual(['Newline', 'Keyword']);
    expect(kinds('rem')).toEqual([]);
    expect(kinds('REMARK=1')).toEqual(['Identifier', '=', 'Number']);
    expect(kinds("/' a\nb\nc '/ PRINT")).toEqual(['Keyword']);
    expect(toks("PRINT /' x '/ 1")[1]).toMatchObject({ kind: 'Number', spaceBefore: true });
    // Newlines inside a block comment give no Newline token.
    expect(kinds("PRINT 1 /' a\nb '/\nPRINT 2")).toEqual(['Keyword', 'Number', 'Newline', 'Keyword', 'Number']);

    const unclosed = run("PRINT /' never closed");
    expect(unclosed.diag.all().map((d) => d.code)).toEqual(['E103']);

    // Continuation.
    const c = toks('PRINT 1, _\n   2\nPRINT 3');
    expect(c.map((t) => t.kind)).toEqual(['Keyword', 'Number', ',', 'Number', 'Newline', 'Keyword', 'Number']);
    expect(c[3]).toMatchObject({ lineStart: false, spaceBefore: true });
    expect(c[5]).toMatchObject({ lineStart: true });
    expect(kinds("PRINT 1 _ ' note\n+ 2")).toEqual(['Keyword', 'Number', '+', 'Number']);
    expect(kinds('PRINT 1 _\r\n+ 2')).toEqual(['Keyword', 'Number', '+', 'Number']);
    // A number after a continuation is not a line number.
    expect(kinds('PRINT _\n10')).toEqual(['Keyword', 'Number']);
    // `_` inside a name is a name character; `_` not at the end of a line is an error.
    expect(kinds('a_b = 1')).toEqual(['Identifier', '=', 'Number']);
    expect(codes('PRINT _ 1')).toEqual(['E101']);
    // A name may start with `_` (the predefined macros); a lone `_` mid-line is still E101.
    expect(toks('PRINT __FILE__; __LINE__')).toMatchObject([
      { kind: 'Keyword' },
      { kind: 'Identifier', name: '__FILE__', key: '__file__', span: { start: 6, end: 14 } },
      { kind: ';' },
      { kind: 'Identifier', name: '__LINE__' },
    ]);
    expect(kinds('x = _a + 1')).toEqual(['Identifier', '=', 'Identifier', '+', 'Number']);
    expect(codes('x = _ + 1')).toEqual(['E101']);
    expect(codes('PRINT 1 _')).toEqual(['E108']);
    expect(codes('PRINT 1 _\n')).toEqual(['E108']);
    // The `_` comes back as Invalid, so the parser does not also report the unfinished statement.
    expect(toks('x = 1 + _').at(-1)).toMatchObject({ kind: 'Invalid', text: '_', span: { start: 8, end: 9 } });

    // keepComments.
    const kc = toks("10 REM hi\nPRINT 'x\n/' b\nc '/ 1", { keepComments: true });
    const comments = kc.filter((t) => t.kind === 'Comment');
    expect(comments).toMatchObject([
      { style: 'rem', text: 'REM hi', body: ' hi' },
      { style: 'apostrophe', text: "'x", body: 'x' },
      { style: 'block', text: "/' b\nc '/", body: ' b\nc ' },
    ]);
    // The token stream is otherwise the same, comments only added.
    const noC = toks("10 REM hi\nPRINT 'x\n/' b\nc '/ 1").map((t) => t.kind);
    expect(kc.filter((t) => t.kind !== 'Comment').map((t) => t.kind)).toEqual(noC);
  });

  it('data items are raw', () => {
    const t = toks('DATA hello world, "a,b", 3 :PRINT');
    expect(t.map((x) => x.kind)).toEqual(['Keyword', 'DataItem', 'DataItem', 'DataItem', ':', 'Keyword']);
    expect(t[1]).toMatchObject({ raw: 'hello world', quoted: false, text: 'hello world', span: { start: 5, end: 16 } });
    expect(t[2]).toMatchObject({ raw: 'a,b', quoted: true, text: '"a,b"' });
    expect(t[3]).toMatchObject({ raw: '3', quoted: false });
    expect(t[5]).toMatchObject({ keyword: 'PRINT' });

    expect(toks('DATA 1,,2').map((x) => (x.kind === 'DataItem' ? x.raw : x.kind))).toEqual(['Keyword', '1', '', '2']);
    expect(toks('DATA 1,').map((x) => (x.kind === 'DataItem' ? x.raw : x.kind))).toEqual(['Keyword', '1', '']);
    expect(toks('DATA &FF, -1.5, a:b').map((x) => (x.kind === 'DataItem' ? x.raw : x.kind))).toEqual(['Keyword', '&FF', '-1.5', 'a', ':', 'Identifier']);
    expect(kinds('DATA 1\nDATA 2')).toEqual(['Keyword', 'DataItem', 'Newline', 'Keyword', 'DataItem']);
    // Quoted items: doubled quotes, unclosed string, junk after the close.
    expect(toks('DATA "a""b"')[1]).toMatchObject({ raw: 'a"b' });
    expect(codes('DATA "abc')).toEqual(['W102']);
    expect(codes('DATA "a" x, 1')).toEqual(['E109']);
    // ' is data, not a comment.
    expect(toks("DATA a'b")[1]).toMatchObject({ raw: "a'b" });
  });

  it('asm blocks are raw lines, directives still lexed', () => {
    const src = 'ASM\n  ld a,1 ; x\n#ifdef CPC_BAREMETAL\n  halt\n#endif\n\nEND ASM\nPRINT 1';
    const { tokens, diag, file } = run(src);
    expect(diag.size).toBe(0);
    expect(tokens.map((t) => t.kind)).toEqual([
      'Keyword', 'Newline', 'AsmLine', 'Directive', 'AsmLine', 'Directive', 'AsmLine', 'Keyword', 'Keyword', 'Newline', 'Keyword', 'Number', 'EOF',
    ]);
    expect(tokens[2]).toMatchObject({ text: '  ld a,1 ; x', span: { start: 4, end: 16 } });
    expect(tokens[3]).toMatchObject({ name: 'ifdef', rest: ' CPC_BAREMETAL', lineStart: true });
    expect(tokens[4]).toMatchObject({ text: '  halt' });
    expect(tokens[6]).toMatchObject({ text: '' });
    expect(tokens[7]).toMatchObject({ keyword: 'END', lineStart: true });
    expect(tokens[8]).toMatchObject({ keyword: 'ASM' });
    for (const t of tokens) expect(file.text.slice(t.span.start, t.span.end)).toBe(t.text);

    // Lower case, extra blanks and a trailing comment on END ASM.
    expect(kinds("asm\nnop\n  end   asm ' done")).toEqual(['Keyword', 'Newline', 'AsmLine', 'Keyword', 'Keyword']);
    // `ASM` with something after it on the line does not start a block.
    expect(kinds('ASM nop')).toEqual(['Keyword', 'Identifier']);
    // Comment after ASM.
    expect(kinds("ASM ' go\nnop\nEND ASM")).toEqual(['Keyword', 'Newline', 'AsmLine', 'Keyword', 'Keyword']);

    // Unclosed: E106 at the ASM keyword.
    const bad = run('PRINT 1\nASM\n ld a,1\n');
    const d = bad.diag.all();
    expect(d.map((x) => x.code)).toEqual(['E106']);
    expect(bad.sources.position(bad.file.id, d[0]!.span.start)).toMatchObject({ line: 2, col: 1 });
    expect(d[0]?.span.end).toBe(d[0]!.span.start + 3);
    expect(run('ASM').diag.all().map((x) => x.code)).toEqual(['E106']);
    expect(bad.tokens.at(-1)?.kind).toBe('EOF');
  });

  it('rsx', () => {
    expect(toks('|DISC')[0]).toMatchObject({ kind: 'Rsx', name: 'DISC', text: '|DISC' });
    const t = toks('|era,"x"');
    expect(t.map((x) => x.kind)).toEqual(['Rsx', ',', 'String']);
    expect(t[0]).toMatchObject({ name: 'ERA' });
    expect(codes('| x')).toEqual(['E101']);
  });

  it('directives', () => {
    const t = toks('#include once <cpcbuild/sprites.bas>\nPRINT');
    expect(t.map((x) => x.kind)).toEqual(['Directive', 'Newline', 'Keyword']);
    expect(t[0]).toMatchObject({
      name: 'include',
      rest: ' once <cpcbuild/sprites.bas>',
      text: '#include once <cpcbuild/sprites.bas>',
      lineStart: true,
      restSpan: { start: 8, end: 36 },
    });
    const d = toks('  #define X 1')[0];
    expect(d).toMatchObject({ kind: 'Directive', name: 'define', rest: ' X 1', spaceBefore: true, lineStart: true, span: { start: 2, end: 13 } });
    expect(toks('#IfDef Foo')[0]).toMatchObject({ name: 'ifdef' });
    expect(toks('#bogus x')[0]).toMatchObject({ kind: 'Directive', name: 'bogus' });
    // Continuation joins lines.
    const c = toks('#define F(a) _\n  a+1\nPRINT');
    expect(c.map((x) => x.kind)).toEqual(['Directive', 'Newline', 'Keyword']);
    expect(c[0]).toMatchObject({ rest: ' F(a) _\n  a+1' });
    // `#` elsewhere is punctuation.
    expect(kinds('PRINT #1, 2')).toEqual(['Keyword', '#', 'Number', ',', 'Number']);
    expect(kinds('x=1: #define')).toEqual(['Identifier', '=', 'Number', ':', '#', 'Identifier']);
    // `#` with no name.
    expect(kinds('#1')).toEqual(['#', 'Number']);
  });

  it('punctuation, longest first', () => {
    const src = '( ) , ; : # @ + - * / \\ ^ = <> < > <= >= =< => << >> { }';
    const want = src.split(' ');
    const got = toks(`x ${src}`).slice(1);
    expect(got.map((t) => t.kind)).toEqual(want);
    expect(kinds('a<=b<>c>=d<<2>>1')).toEqual(['Identifier', '<=', 'Identifier', '<>', 'Identifier', '>=', 'Identifier', '<<', 'Number', '>>', 'Number']);
    expect(kinds('a=>b')).toEqual(['Identifier', '=>', 'Identifier']);
    expect(kinds('a<b')).toEqual(['Identifier', '<', 'Identifier']);
  });

  it('newlines, spaceBefore and lineStart', () => {
    const t = toks('a=1\n\n  b=2\r\nc\rd');
    expect(t.map((x) => x.kind)).toEqual([
      'Identifier', '=', 'Number', 'Newline', 'Newline', 'Identifier', '=', 'Number', 'Newline', 'Identifier', 'Newline', 'Identifier',
    ]);
    expect(t[0]).toMatchObject({ lineStart: true, spaceBefore: false });
    expect(t[1]).toMatchObject({ lineStart: false, spaceBefore: false });
    expect(t[4]).toMatchObject({ lineStart: true, text: '\n' });
    expect(t[5]).toMatchObject({ lineStart: true, spaceBefore: true });
    expect(t[8]).toMatchObject({ text: '\r\n' });
    expect(t[10]).toMatchObject({ text: '\r' });
    expect(t[11]).toMatchObject({ lineStart: true });
    // Comment-only and blank lines still give a Newline.
    expect(kinds("' c\n\nREM x\n")).toEqual(['Newline', 'Newline', 'Newline']);
  });

  it('reports unusable characters and goes on', () => {
    const r = run('a = ~ 1 ` b');
    expect(r.diag.all().map((d) => d.code)).toEqual(['E101', 'E101']);
    expect(r.tokens.map((t) => t.kind)).toEqual(['Identifier', '=', 'Invalid', 'Number', 'Invalid', 'Identifier', 'EOF']);
    expect(codes('a % b')).toEqual(['E101']);
    expect(codes('x = é')).toEqual(['E101']);
    expect(codes('x = $')).toEqual(['E101']);
    // A surrogate pair is one invalid token.
    const e = run('x=😀');
    expect(e.tokens[2]).toMatchObject({ kind: 'Invalid', text: '😀' });
  });

  it('ends with exactly one EOF at the end of the file', () => {
    const r = run('PRINT 1\n');
    expect(r.tokens.filter((t) => t.kind === 'EOF')).toHaveLength(1);
    expect(r.tokens.at(-1)).toMatchObject({ kind: 'EOF', span: { start: 8, end: 8 }, text: '' });
    expect(run('').tokens).toHaveLength(1);
  });

  it('range lexing', () => {
    const text = '10 PRINT 20\n30 GOTO 40\nlab: x';
    const start = text.indexOf('30');
    const end = text.indexOf('\nlab');
    const { tokens, diag, file } = run(text, { range: { start, end } });
    // Let a second run on the full text compare spans.
    expect(diag.size).toBe(0);
    expect(tokens.map((t) => t.kind)).toEqual(['Number', 'Keyword', 'Number', 'EOF']);
    expect(tokens[0]).toMatchObject({ value: 30, span: { start, end: start + 2 }, lineStart: false });
    expect(tokens[2]).toMatchObject({ value: 40, span: { start: text.indexOf('40'), end: end } });
    expect(tokens[3]).toMatchObject({ kind: 'EOF', span: { start: end, end } });
    expect(file.text.slice(tokens[1]!.span.start, tokens[1]!.span.end)).toBe('GOTO');
    // The range stops at `end`: no label, nothing past it, directive not recognised first.
    const lab = run('lab: x', { range: { start: 0, end: 4 } });
    expect(lab.tokens.map((t) => t.kind)).toEqual(['Identifier', ':', 'EOF']);
    expect(run('#define X 1', { range: { start: 0, end: 11 } }).tokens.map((t) => t.kind)).toEqual(['#', 'Identifier', 'Identifier', 'Number', 'EOF']);
    // A second line inside the range is line-initial again.
    expect(run('a\n20 b', { range: { start: 0, end: 6 } }).tokens.map((t) => t.kind)).toEqual(['Identifier', 'Newline', 'LineNumber', 'Identifier', 'EOF']);
    // `#define` body use: tokens after the name.
    const def = '#define TWICE(x) x*2';
    const body = run(def, { range: { start: 17, end: def.length } });
    expect(body.tokens.map((t) => t.kind)).toEqual(['Identifier', '*', 'Number', 'EOF']);
    expect(body.tokens[0]).toMatchObject({ span: { start: 17, end: 18 } });
  });

  it('positions survive CRLF and tabs', () => {
    const text = 'PRINT 1\r\n\tx = 2\n  \r  y\rz = "a"\n';
    const { tokens, sources, file } = run(text);
    const pos = (t: Token) => {
      const p = sources.position(file.id, t.span.start);
      return `${p.line}:${p.col}`;
    };
    const want: Array<[string, string]> = [
      ['PRINT', '1:1'], ['1', '1:7'], ['\r\n', '1:8'],
      ['x', '2:2'], ['=', '2:4'], ['2', '2:6'], ['\n', '2:7'],
      ['\r', '3:3'],
      ['y', '4:3'], ['\r', '4:4'],
      ['z', '5:1'], ['=', '5:3'], ['"a"', '5:5'], ['\n', '5:8'],
    ];
    const got = tokens.slice(0, -1).map((t): [string, string] => [t.text, pos(t)]);
    expect(got).toEqual(want);
    for (const t of tokens) expect(text.slice(t.span.start, t.span.end)).toBe(t.text);
  });

  it('never throws', () => {
    let seed = 0x2f6e2b1;
    const rnd = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const alphabet = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).concat(['\n', '\t', '\r', '\n', '"', '_', '\'', '&', '$']);
    const frag = ['DATA ', 'ASM\n', 'END ASM', "/'", "'/", '#define ', ' _\n', 'REM ', '&X', '0b', '1E', '|', 'PRINT '];
    for (let n = 0; n < 2000; n++) {
      const len = Math.floor(rnd() * 80);
      let s = '';
      for (let i = 0; i < len; i++) {
        s += rnd() < 0.1 ? frag[Math.floor(rnd() * frag.length)]! : alphabet[Math.floor(rnd() * alphabet.length)]!;
      }
      const { tokens, file } = run(s);
      expect(tokens.at(-1)?.kind).toBe('EOF');
      expect(tokens.filter((t) => t.kind === 'EOF')).toHaveLength(1);
      let last = 0;
      for (const t of tokens) {
        expect(t.span.start).toBeGreaterThanOrEqual(last);
        expect(t.span.end).toBeGreaterThanOrEqual(t.span.start);
        last = t.span.end;
        if (t.kind !== 'Comment') expect(file.text.slice(t.span.start, t.span.end)).toBe(t.text);
      }
      // Ranges and keepComments do not throw either.
      const a = Math.floor(rnd() * (s.length + 1));
      const b = a + Math.floor(rnd() * (s.length - a + 1));
      const sources = new SourceSet();
      const f = sources.add('r.bas', s);
      expect(lex(f, new DiagnosticBag(), { keepComments: true, range: { start: a, end: b } }).at(-1)?.kind).toBe('EOF');
    }
  });

  it('is deterministic', () => {
    const src = "10 PRINT \"x\": DATA 1,2\nASM\nnop\nEND ASM\n#define A 1\n' c";
    expect(run(src).tokens).toEqual(run(src).tokens);
  });

  // The cpcbuild repository is a sibling of this one (or of the main checkout, from a worktree).
  const speedText = ((): string | undefined => {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 8; i++) {
      dir = dirname(dir);
      try {
        return readFileSync(join(dir, 'cpcbuild/games/lamplighter/game.bas'), 'utf8');
      } catch {
        // try one level up
      }
    }
    return undefined;
  })();

  it.skipIf(speedText === undefined)('speed', () => {
    const text = speedText as string;
    const lines = text.split('\n');
    const parts: string[] = [];
    let total = 0;
    while (total < 10000) {
      parts.push(text);
      total += lines.length;
    }
    const big = parts.join('\n');
    const sources = new SourceSet();
    const file = sources.add('big.bas', big);
    lex(file, new DiagnosticBag()); // warm up
    const t0 = performance.now();
    const out = lex(file, new DiagnosticBag());
    const ms = performance.now() - t0;
    expect(out.length).toBeGreaterThan(1000);
    expect(ms).toBeLessThan(200);
  });
});
