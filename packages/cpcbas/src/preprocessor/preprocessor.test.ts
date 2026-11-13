import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DiagnosticBag } from '../core/diagnostics.js';
import { SourceSet } from '../core/source.js';
import type { PreprocessResult, Token } from '../core/tokens.js';
import { IMPLEMENTED, predefinedMacros, preprocess } from './index.js';

interface Opts {
  includePaths?: string[];
  defines?: Record<string, string>;
  main?: string;
  library?: Record<string, string>;
}

function pp(files: Record<string, string>, opts: Opts = {}) {
  const sources = new SourceSet();
  const diagnostics = new DiagnosticBag();
  const tree = new Map(Object.entries(files));
  const main = opts.main ?? 'main.bas';
  const result: PreprocessResult = preprocess({
    sources,
    tree,
    main,
    includePaths: opts.includePaths ?? [],
    ...(opts.library ? { library: new Map(Object.entries(opts.library)) } : {}),
    defines: new Map(Object.entries(opts.defines ?? {})),
    diagnostics,
  });
  return { result, sources, diagnostics, codes: diagnostics.all().map((d) => d.code) };
}

const one = (text: string, opts: Opts = {}) => pp({ 'main.bas': text }, opts);

/** Token texts without Newline/EOF, joined with spaces. */
function words(tokens: readonly Token[]): string {
  return tokens
    .filter((t) => t.kind !== 'Newline' && t.kind !== 'EOF')
    .map((t) => (t.kind === 'String' ? `"${t.value}"` : t.text))
    .join(' ');
}

describe('preprocessor', () => {
  it('is marked implemented', () => {
    expect(IMPLEMENTED).toBe(true);
  });

  it('passes plain code through with one EOF', () => {
    const { result, codes } = one('PRINT 1\nx = 2');
    expect(codes).toEqual([]);
    expect(words(result.tokens)).toBe('PRINT 1 x = 2');
    expect(result.tokens.filter((t) => t.kind === 'EOF')).toHaveLength(1);
    expect(result.tokens[result.tokens.length - 1]!.kind).toBe('EOF');
    expect(result.mainFile).toBe(0);
  });

  it('a missing main file gives E003 and an empty stream', () => {
    const { result, codes } = pp({}, { main: 'nope.bas' });
    expect(codes).toEqual(['E003']);
    expect(result.tokens.map((t) => t.kind)).toEqual(['EOF']);
    expect(result.mainFile).toBeNull();
  });

  describe('include', () => {
    it('include relative and through include paths, with search order', () => {
      const files = {
        'game/main.bas': '#include "a.bas"\n#include <b.bas>\n#include "b.bas"\nPRINT 9',
        'game/a.bas': 'PRINT "a-near"',
        'lib/a.bas': 'PRINT "a-lib"',
        'game/b.bas': 'PRINT "b-near"',
        'lib/b.bas': 'PRINT "b-lib"',
        'lib2/b.bas': 'PRINT "b-lib2"',
      };
      const { result, sources, codes } = pp(files, { main: 'game/main.bas', includePaths: ['lib', 'lib2'] });
      expect(codes).toEqual([]);
      // "a.bas": including file's directory first. <b.bas>: include paths only, in order. "b.bas": near first.
      expect(words(result.tokens)).toBe('PRINT "a-near" PRINT "b-lib" PRINT "b-near" PRINT 9');
      expect(result.includes.map((i) => [i.requested, sources.get(i.file!).path, i.angle])).toEqual([
        ['"a.bas"', 'game/a.bas', false],
        ['<b.bas>', 'lib/b.bas', true],
        ['"b.bas"', 'game/b.bas', false],
      ]);
      expect(sources.get(result.includes[0]!.file!).origin).toBe('user');
      expect(sources.get(result.includes[1]!.file!).origin).toBe('library');
    });

    it('the bundled library is searched last: f, then stdlib/f; its files keep the <lib>/ prefix', () => {
      const library = { 'cpcbuild.bas': '#include once <cpcbuild/a.bas>', 'cpcbuild/a.bas': '#include "b.bas"\nPRINT 1', 'cpcbuild/b.bas': 'PRINT 2', 'stdlib/cpc.bas': 'PRINT 3' };
      const { result, sources, codes } = pp({ 'main.bas': '#include <cpcbuild.bas>\n#include "cpc.bas"' }, { library });
      expect(codes).toEqual([]);
      expect(result.includes.map((i) => [sources.get(i.file!).path, sources.get(i.file!).origin])).toEqual([
        ['<lib>/cpcbuild.bas', 'library'],
        ['<lib>/cpcbuild/a.bas', 'library'],
        ['<lib>/cpcbuild/b.bas', 'library'],
        ['<lib>/stdlib/cpc.bas', 'library'],
      ]);
      expect(words(result.tokens)).toBe('PRINT 2 PRINT 1 PRINT 3');
    });

    it('user files and include paths win over the bundled library', () => {
      const library = { 'x.bas': 'PRINT 1' };
      const near = pp({ 'main.bas': '#include "x.bas"', 'x.bas': 'PRINT 2' }, { library });
      expect(words(near.result.tokens)).toBe('PRINT 2');
      const viaPath = pp({ 'main.bas': '#include <x.bas>', 'inc/x.bas': 'PRINT 3' }, { library, includePaths: ['inc'] });
      expect(words(viaPath.result.tokens)).toBe('PRINT 3');
    });

    it('a library file cannot reach out of the library with ..', () => {
      const { codes } = pp({ 'main.bas': '#include <a.bas>', 'secret.bas': 'PRINT 9' }, { library: { 'a.bas': '#include "../secret.bas"' } });
      expect(codes).toContain('E120');
    });

    it('an #include inside an ASM block includes the file as ASM lines (conditionals still work)', () => {
      const files = { 'main.bas': 'ASM\n  nop\n#include "glue.asm"\nEND ASM\nPRINT 1', 'glue.asm': '; glue\nlbl: ld a, (ix+1)\n#ifdef FOO\n  defb "x"\n#endif\n' };
      const asmLines = (r: PreprocessResult): string[] => r.tokens.filter((t) => t.kind === 'AsmLine').map((t) => (t as { text: string }).text.trim());
      const plain = pp(files);
      expect(plain.codes).toEqual([]);
      expect(asmLines(plain.result)).toEqual(['nop', '; glue', 'lbl: ld a, (ix+1)']);
      expect(words(plain.result.tokens)).toMatch(/END ASM PRINT 1$/);
      expect(asmLines(pp(files, { defines: { FOO: '1' } }).result)).toEqual(['nop', '; glue', 'lbl: ld a, (ix+1)', 'defb "x"']);
    });
    it('a quoted include falls back to the include paths (library origin)', () => {
      const { result, sources, codes } = pp({ 'main.bas': '#include "x/y.bas"', 'lib/x/y.bas': 'PRINT 1' }, { includePaths: ['lib'] });
      expect(codes).toEqual([]);
      expect(sources.get(result.includes[0]!.file!).origin).toBe('library');
    });

    it('an include inside a library file stays library', () => {
      const { sources, result } = pp({ 'main.bas': '#include <a.bas>', 'lib/a.bas': '#include "b.bas"', 'lib/b.bas': 'PRINT 1' }, { includePaths: ['lib'] });
      expect(result.includes.map((i) => sources.get(i.file!).origin)).toEqual(['library', 'library']);
    });

    it('include once by resolved path, after any form; a plain include after once includes again', () => {
      const files = {
        'main.bas': [
          '#include once "u.bas"', // first: included
          '#include once <u.bas>', // same resolved path? no: lib/u.bas differs
          '#include once "./u.bas"', // same file as "u.bas": skipped
          '#include "u.bas"', // plain: included again
          '#include once "u.bas"', // skipped (already included by any form)
          '#include "p.bas"', // plain first
          '#include once "p.bas"', // skipped
        ].join('\n'),
        'u.bas': 'PRINT "u"',
        'lib/u.bas': 'PRINT "libu"',
        'p.bas': 'PRINT "p"',
      };
      const { result, codes } = pp(files, { includePaths: ['lib'] });
      expect(codes).toEqual([]);
      expect(words(result.tokens)).toBe('PRINT "u" PRINT "libu" PRINT "u" PRINT "p"');
      expect(result.includes.map((i) => i.skipped)).toEqual([false, false, true, false, true, false, true]);
      expect(result.includes[3]!.once).toBe(false);
    });

    it('include not found E120 at the file name', () => {
      const { diagnostics, result, sources } = one('PRINT 1\n#include "missing.bas"');
      const [d] = diagnostics.all();
      expect(d!.code).toBe('E120');
      expect(sources.text(d!.span)).toBe('"missing.bas"');
      expect(result.includes[0]).toMatchObject({ file: null, requested: '"missing.bas"' });
      const a = one('#include once <lib/nope.h>');
      expect(a.sources.text(a.diagnostics.all()[0]!.span)).toBe('<lib/nope.h>');
    });

    it('include cycle E121, but not with once', () => {
      const cyc = pp({ 'main.bas': '#include "a.bas"', 'a.bas': 'PRINT 1\n#include "main.bas"' });
      expect(cyc.codes).toEqual(['E121']);
      const self = pp({ 'main.bas': 'PRINT 1\n#include "main.bas"' });
      expect(self.codes).toEqual(['E121']);
      const ok = pp({ 'main.bas': '#include once "a.bas"', 'a.bas': 'PRINT 1\n#include once "main.bas"\n#include once "a.bas"' });
      expect(ok.codes).toEqual([]);
      expect(words(ok.result.tokens)).toBe('PRINT 1');
    });

    it('file ids in first-met order', () => {
      const files = {
        'main.bas': '#include "b.bas"\n#include "a.bas"\n#include "b.bas"',
        'a.bas': '#include "c.bas"',
        'b.bas': 'PRINT 1',
        'c.bas': 'PRINT 2',
      };
      const { sources, codes } = pp(files, { defines: { X: '1' } });
      expect(codes).toEqual([]);
      expect(sources.all().map((f) => f.path)).toEqual(['main.bas', 'b.bas', 'a.bas', 'c.bas', '<command line>']);
    });

    it('a newline ends the directive line even when the included file has none', () => {
      const { result } = one('#include "a.bas"\nPRINT 2', {});
      expect(result.tokens.length).toBeGreaterThan(0);
      const r = pp({ 'main.bas': '#include "a.bas"\nPRINT 2', 'a.bas': 'PRINT 1' });
      expect(r.result.tokens.map((t) => t.kind)).toEqual(['Keyword', 'Number', 'Newline', 'Newline', 'Keyword', 'Number', 'EOF']);
    });

    it('a malformed include is E130 at the #', () => {
      const { diagnostics, codes } = one('#include foo');
      expect(codes).toEqual(['E130']);
      expect(diagnostics.all()[0]!.span.start).toBe(0);
    });
  });

  describe('macros', () => {
    it('object and function macros, nested arguments, recursion guard', () => {
      const src = [
        '#define N 10',
        '#define ADD(a, b) ((a) + (b))',
        '#define TWICE(x) ADD(x, x)',
        '#define LOOPY LOOPY + 1',
        '#define A B',
        '#define B A',
        'x = N',
        'y = ADD(N, ADD(1, 2))',
        'z = TWICE(f(1, 2))',
        'w = LOOPY',
        'v = A',
        'u = ADD',
      ].join('\n');
      const { result, codes } = one(src);
      expect(codes).toEqual([]);
      const lines = words(result.tokens).split(/(?= x | y | z | w | v | u )/);
      expect(lines.map((l) => l.trim())).toEqual([
        'x = 10',
        'y = ( ( 10 ) + ( ( ( 1 ) + ( 2 ) ) ) )',
        'z = ( ( f ( 1 , 2 ) ) + ( f ( 1 , 2 ) ) )',
        'w = LOOPY + 1',
        'v = A',
        'u = ADD',
      ]);
    });

    it('a macro name used as an argument of itself is expanded in the argument', () => {
      const { result } = one('#define F(x) x+1\ny = F(F(1))');
      expect(words(result.tokens)).toBe('y = 1 + 1 + 1');
    });

    it('wrong argument count is E126 at the macro name', () => {
      const { diagnostics, sources } = one('#define F(a, b) a\nx = F(1)\ny = F(1, 2, 3)');
      const ds = diagnostics.all();
      expect(ds.map((d) => d.code)).toEqual(['E126', 'E126']);
      expect(sources.text(ds[0]!.span)).toBe('F');
    });

    it('an unclosed argument list is E126', () => {
      expect(one('#define F(a) a\nx = F(1').codes).toEqual(['E126']);
    });

    it('zero-parameter function macros', () => {
      const { result, codes } = one('#define Z() 7\nx = Z()');
      expect(codes).toEqual([]);
      expect(words(result.tokens)).toBe('x = 7');
    });

    it('expanded tokens point at the use', () => {
      const text = '#define K 5 + 6\nx = K\ny = M(1)';
      const { result, sources } = one(`#define M(a) a * 2\n${text.split('\n').slice(1).join('\n')}`.replace('#define K 5 + 6', ''));
      const toks = result.tokens.filter((t) => t.fromMacro);
      expect(toks.map((t) => t.text)).toEqual(['1', '*', '2']);
      for (const t of toks) expect(sources.text(t.span)).toBe('M(1)');
      const k = one('#define K 5 + 6\nx = K');
      const exp = k.result.tokens.filter((t) => t.fromMacro);
      expect(exp.map((t) => t.text)).toEqual(['5', '+', '6']);
      for (const t of exp) expect(k.sources.text(t.span)).toBe('K');
      expect(k.result.tokens.find((t) => t.text === 'x')!.fromMacro).toBeUndefined();
    });

    it('macro names are case-sensitive', () => {
      const { result, codes } = one('#define Foo 1\nx = Foo + foo + FOO\n#ifdef foo\ny\n#endif\n#ifdef Foo\nz\n#endif');
      expect(codes).toEqual([]);
      expect(words(result.tokens)).toBe('x = 1 + foo + FOO z');
    });

    it('#undef removes a macro; -D macros work', () => {
      const { result, codes, result: r2 } = one('x = A\n#undef A\ny = A', { defines: { A: '3' } });
      expect(codes).toEqual([]);
      expect(words(result.tokens)).toBe('x = 3 y = A');
      expect(r2.macros.has('A')).toBe(false);
    });

    it('W129 when redefined with a different body only', () => {
      expect(one('#define X 1\n#define X 1').codes).toEqual([]);
      expect(one('#define X 1\n#define X  1  ').codes).toEqual([]);
      expect(one('#define X 1\n#define X 2').codes).toEqual(['W129']);
      expect(one('#define X(a) a\n#define X(b) b').codes).toEqual(['W129']);
      expect(one('#define X 1', { defines: { X: '2' } }).codes).toEqual(['W129']);
    });

    it('a macro body can continue over lines', () => {
      const { result, codes } = one('#define F(a) _\n  a + 1\nx = F(2)');
      expect(codes).toEqual([]);
      expect(words(result.tokens)).toBe('x = 2 + 1');
    });

    it('result.macros holds the definitions', () => {
      const { result } = one('#define A 1\n#define F(x, y) x', { defines: { Z: 'q' } });
      expect([...result.macros.keys()].sort()).toEqual(['A', 'F', 'Z']);
      expect(result.macros.get('F')).toMatchObject({ params: ['x', 'y'], bodyText: 'x' });
      expect(result.macros.get('A')).toMatchObject({ params: null, bodyText: '1' });
    });

    it('does not expand in DATA, strings or suffixed names', () => {
      const { result } = one('#define A 1\nDATA A,2\nPRINT "A"\nx = A$');
      expect(words(result.tokens)).toContain('A$');
      expect(words(result.tokens)).toContain('"A"');
      expect(result.tokens.some((t) => t.kind === 'DataItem' && t.raw === 'A')).toBe(true);
    });

    it('malformed define is E130', () => {
      expect(one('#define').codes).toEqual(['E130']);
      expect(one('#define 1x').codes).toEqual(['E130']);
      expect(one('#define F(a, a) a').codes).toEqual(['E130']);
      expect(one('#undef').codes).toEqual(['E130']);
    });
  });

  describe('conditionals', () => {
    it('#if/#elif/#else nesting; skipped branches do not expand or include', () => {
      const src = [
        '#define A 1',
        '#ifdef A',
        'one',
        '  #ifndef A',
        '  two',
        '  #else',
        '  three',
        '  #endif',
        '#else',
        '  #include "missing.bas"',
        '  #define SKIPPED 1',
        '  #bogus',
        '  #error "no"',
        '#endif',
        '#if 0',
        'four',
        '#elif A == 1',
        'five',
        '#elif 1',
        'six',
        '#else',
        'seven',
        '#endif',
        '#ifdef SKIPPED',
        'bad',
        '#endif',
        '#if 0',
        '#if 1',
        'nested-in-dead',
        '#else',
        'nested-in-dead2',
        '#endif',
        '#else',
        'eight',
        '#endif',
      ].join('\n');
      const { result, codes } = one(src);
      expect(codes).toEqual([]);
      expect(words(result.tokens)).toBe('one three five eight');
      expect(result.includes).toEqual([]);
    });

    it('a skipped branch does not expand macros', () => {
      const { codes } = one('#define F(a) a\n#if 0\nx = F(1, 2)\n#endif');
      expect(codes).toEqual([]);
    });

    it('#if expression grammar', () => {
      const cases: Array<[string, boolean]> = [
        ['1', true],
        ['0', false],
        ['2 + 3 * 4 == 14', true],
        ['(2 + 3) * 4 = 20', true],
        ['7 / 2 == 3 && 7 % 4 == 3', true],
        ['1 <> 2', true],
        ['1 != 1', false],
        ['3 >= 3 && 3 <= 3 && 2 < 3 && 3 > 2', true],
        ['0 || 0', false],
        ['0 OR 1', true],
        ['1 and 0', false],
        ['NOT 0', true],
        ['NOT 1 = 2', true],
        ['!0', true],
        ['!1 == 0', true],
        ['-1 < 0', true],
        ['UNDEFINED', false],
        ['UNDEFINED == 0', true],
        ['defined(HAVE)', true],
        ['defined HAVE', true],
        ['defined(NOPE)', false],
        ['defined NOPE || defined(HAVE) && VAL > 2', true],
        ['!defined(NOPE)', true],
        ['VAL * 2 == 8', true],
        ['EMPTY', true],
        ['&H10 == 16 && 0x10 == 16 && &X11 == 3 && 0b11 == 3', true],
        ["1 'comment", true],
      ];
      for (const [expr, want] of cases) {
        const { result, codes } = one(`#define HAVE\n#define VAL 4\n#define EMPTY\n#if ${expr}\nyes\n#else\nno\n#endif`);
        expect(codes, expr).toEqual([]);
        expect(words(result.tokens), expr).toBe(want ? 'yes' : 'no');
      }
    });

    it('a macro value that is an expression is evaluated', () => {
      const { result } = one('#define W (2+3)\n#if W == 5\nyes\n#endif');
      expect(words(result.tokens)).toBe('yes');
    });

    it('bad #if expressions are E125 at the #', () => {
      for (const e of ['', '1 +', '(1', '1 2', '1 / 0', '"s"', '1 $ 2', 'F(1)']) {
        const { diagnostics, result } = one(`#define F(a) a\n#if ${e}\nyes\n#endif`);
        expect(diagnostics.all().map((d) => d.code), e).toEqual(['E125']);
        expect(diagnostics.all()[0]!.span.start).toBe('#define F(a) a\n'.length);
        expect(words(result.tokens)).toBe('');
      }
      expect(one('#if 0\n#elif 1 +\n#endif').codes).toEqual(['E125']);
    });

    it('E123 for unmatched #else, #elif, #endif and a second #else', () => {
      expect(one('#else').codes).toEqual(['E123']);
      expect(one('#elif 1').codes).toEqual(['E123']);
      expect(one('#endif').codes).toEqual(['E123']);
      expect(one('#if 1\n#else\n#else\n#endif').codes).toEqual(['E123']);
      expect(one('#if 1\n#else\n#elif 1\n#endif').codes).toEqual(['E123']);
    });

    it('E124 at the #if for a missing #endif, also at the end of an included file', () => {
      const a = one('x\n#ifdef A\ny');
      expect(a.codes).toEqual(['E124']);
      expect(a.diagnostics.all()[0]!.span.start).toBe(2);
      const b = pp({ 'main.bas': '#include "a.bas"\nz', 'a.bas': '#if 1\nq' });
      expect(b.codes).toEqual(['E124']);
      expect(b.diagnostics.all()[0]!.span.file).toBe(1);
      expect(words(b.result.tokens)).toBe('q z');
    });

    it('#ifdef needs one name', () => {
      expect(one('#ifdef\n#endif').codes).toEqual(['E130']);
    });

    it('conditionals work inside ASM blocks', () => {
      const { result, codes } = one('#define Z 1\nASM\n  nop\n#if Z\n  halt\n#else\n  di\n#endif\nEND ASM');
      expect(codes).toEqual([]);
      expect(result.tokens.filter((t) => t.kind === 'AsmLine').map((t) => t.text.trim())).toEqual(['nop', 'halt']);
    });
  });

  describe('messages and pass-through', () => {
    it('#error and #warning', () => {
      const { diagnostics, sources } = one('PRINT 1\n#error "stop here"\n#warning "careful ""now"""\n#warning raw text');
      const ds = diagnostics.all();
      expect(ds.map((d) => [d.code, d.message])).toEqual([
        ['E127', 'stop here'],
        ['W128', 'careful "now"'],
        ['W128', 'raw text'],
      ]);
      expect(sources.text(ds[0]!.span).startsWith('#error')).toBe(true);
      expect(one('#error').diagnostics.all()[0]!.message).toBe('#error');
    });

    it('an error in a skipped branch is not reported', () => {
      expect(one('#if 0\n#error "x"\n#endif').codes).toEqual([]);
    });

    it('pass-through directives survive in order', () => {
      const src = '#pragma explicit\nPRINT 1\n  #require "a.asm"\n#init start\n#line 20\n#pragma hidata = 0x8000\n#pragma push(explicit)\n#pragma pop(explicit)\n#pragma case_insensitive = TRUE';
      const { result, codes } = one(src);
      expect(codes).toEqual([]);
      const dirs = result.tokens.filter((t) => t.kind === 'Directive');
      expect(dirs.map((t) => (t.kind === 'Directive' ? t.name : ''))).toEqual(['pragma', 'require', 'init', 'line', 'pragma', 'pragma', 'pragma', 'pragma']);
      expect(result.tokens.map((t) => t.kind).indexOf('Directive')).toBe(0);
      expect(dirs[0]).toMatchObject({ rest: ' explicit' });
    });

    it('a #require inside a SUB stays inside it', () => {
      const { result } = one('SUB f()\n    #require "x.asm"\nEND SUB');
      expect(words(result.tokens)).toBe('SUB f ( ) #require "x.asm" END SUB'.replace('#require "x.asm"', '#require "x.asm"'));
    });

    it('malformed pass-through directives are E130', () => {
      expect(one('#pragma').codes).toEqual(['E130']);
      expect(one('#pragma push explicit').codes).toEqual(['E130']);
      expect(one('#pragma x =').codes).toEqual(['E130']);
      expect(one('#require x').codes).toEqual(['E130']);
      expect(one('#init').codes).toEqual(['E130']);
      expect(one('#init 1 2').codes).toEqual(['E130']);
      expect(one('#init .core.start').codes).toEqual([]);
    });

    it('unknown directives are E122 at the #', () => {
      const { diagnostics } = one('PRINT 1\n#bogus 3');
      expect(diagnostics.all().map((d) => d.code)).toEqual(['E122']);
      expect(diagnostics.all()[0]!.span.start).toBe(8);
    });
  });

  describe('built-in and predefined names', () => {
    it('__FILE__ and __LINE__', () => {
      const files = {
        'game/main.bas': 'PRINT __FILE__\nPRINT __LINE__\n#define L __LINE__\n\nx = L\n#include "inc.bas"\n#if __LINE__ == 7\nyes\n#endif',
        'game/inc.bas': '\ny = __FILE__ + STR$(__LINE__)',
      };
      const { result, codes } = pp(files, { main: 'game/main.bas' });
      expect(codes).toEqual([]);
      expect(words(result.tokens)).toBe('PRINT "game/main.bas" PRINT 2 x = 5 y = "game/inc.bas" + STR$ ( 2 ) yes');
      const f = result.tokens.find((t) => t.kind === 'String')!;
      expect(f.fromMacro).toBe(true);
    });

    it('predefinedMacros', () => {
      const m = predefinedMacros({ buildDate: '2026-11-07', version: '1.2.3' });
      expect([...m.entries()]).toEqual([
        ['__CPC__', '1'],
        ['__CPCBAS__', '1'],
        ['__VERSION__', '"1.2.3"'],
        ['__DATE__', '"2026-11-07"'],
      ]);
      const { result, codes } = one('PRINT __DATE__\n#ifdef __CPC__\nok\n#endif', { defines: Object.fromEntries(m) });
      expect(codes).toEqual([]);
      expect(words(result.tokens)).toBe('PRINT "2026-11-07" ok');
    });
  });

  describe('asm lines', () => {
    it('asm line macro expansion', () => {
      const src = [
        '#define PORT 0xBC00',
        '#define LDI(r, v) ld r, v',
        '#define TWO LDI(a, PORT)',
        'ASM',
        '  ld hl, PORT ; PORT stays in comments',
        '  LDI(b, 5 + 1)',
        '  TWO',
        '  ld a, 0FFh',
        '  ld hl, $PORT',
        '  ld hl, PORTAL',
        '  ld hl, .PORT',
        '  LDI (c, LDI(d, 1))',
        'END ASM',
      ].join('\n');
      const { result, codes } = one(src);
      expect(codes).toEqual([]);
      const lines = result.tokens.filter((t) => t.kind === 'AsmLine').map((t) => (t.kind === 'AsmLine' ? t.text : ''));
      expect(lines).toEqual([
        '  ld hl, 0xBC00 ; PORT stays in comments',
        '  ld b, 5 + 1',
        '  ld a, 0xBC00',
        '  ld a, 0FFh',
        '  ld hl, $PORT',
        '  ld hl, PORTAL',
        '  ld hl, .PORT',
        '  ld c, ld d, 1',
      ]);
      // The span still covers the original line.
      const first = result.tokens.find((t) => t.kind === 'AsmLine')!;
      expect(first.span.end - first.span.start).toBe('  ld hl, PORT ; PORT stays in comments'.length);
    });

    it('asm macro argument count is E126 at the line', () => {
      expect(one('#define F(a) a\nASM\n  F(1,2)\nEND ASM').codes).toEqual(['E126']);
    });
  });

  it('never throws on odd input', () => {
    const frags = ['#', '#include', '#include "', '#define F(', '#if (', '#else', '#endif', 'ASM\n', '#define A A(\nA(', '_\n', '#if defined(', "'", '"', '#pragma = ='];
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let n = 0; n < 200; n++) {
      let text = '';
      for (let k = 0; k < 8; k++) text += (frags[Math.floor(rnd() * frags.length)] as string) + (rnd() < 0.5 ? '\n' : ' ');
      expect(() => one(text, { defines: { A: 'A' } })).not.toThrow();
    }
  });
});

describe('the cpcbuild library preprocesses', () => {
  // `../cpcbuild` is a sibling of the repo (or of the worktrees folder's parent).
  const root = ['../../../../../cpcbuild/lib', '../../../../../../../cpcbuild/lib'].map((r) => join(__dirname, r)).find((r) => existsSync(join(r, 'cpcbuild.bas'))) ?? '';
  const libMain = join(root, 'cpcbuild.bas');
  it.skipIf(!existsSync(libMain))('includes match the directives, no errors', () => {
    const files: Record<string, string> = {};
    const walk = (dir: string, rel: string): void => {
      for (const name of readdirSync(dir).sort()) {
        const p = join(dir, name);
        const r = rel === '' ? name : `${rel}/${name}`;
        if (statSync(p).isDirectory()) walk(p, r);
        else if (/\.(bas|bi|inc|h)$/i.test(name)) files[`lib/${r}`] = readFileSync(p, 'utf8');
      }
    };
    walk(root, '');
    const sources = new SourceSet();
    const diagnostics = new DiagnosticBag();
    const result = preprocess({
      sources,
      tree: new Map(Object.entries(files)),
      main: 'lib/cpcbuild.bas',
      includePaths: ['lib'],
      defines: new Map([...predefinedMacros({ buildDate: '2026-11-07' }), ['CPC6128', '']]),
      diagnostics,
    });
    expect(diagnostics.all().filter((d) => d.severity === 'error')).toEqual([]);

    // Expected set: follow #include lines in active branches, computed with a naive scan.
    const expected = new Set<string>();
    const visit = (path: string): void => {
      const text = files[path];
      if (text === undefined) return;
      for (const m of text.matchAll(/^[ \t]*#include[ \t]+(?:once[ \t]+)?(?:"([^"]+)"|<([^>]+)>)/gim)) {
        const name = (m[1] ?? m[2]) as string;
        const cands = m[1] !== undefined ? [`${path.slice(0, path.lastIndexOf('/'))}/${name}`, `lib/${name}`] : [`lib/${name}`];
        const hit = cands.find((c) => files[c] !== undefined);
        if (hit && !expected.has(hit)) {
          expected.add(hit);
          visit(hit);
        }
      }
    };
    visit('lib/cpcbuild.bas');
    const got = new Set(result.includes.filter((i) => i.file !== null && !i.skipped).map((i) => sources.get(i.file!).path));
    expect([...got].sort()).toEqual([...expected].sort());
    expect(got.size).toBeGreaterThan(0);
    expect(result.tokens[result.tokens.length - 1]!.kind).toBe('EOF');
  });
});
