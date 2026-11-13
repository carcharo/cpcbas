/** compile(): the front-end pipeline (lex, preprocess, parse), dumps, defines and E001/E002. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compile, formatDiagnostic, VERSION, type CompileInput } from '../src/index.js';

const one = (text: string, extra: Partial<CompileInput> = {}, options: CompileInput['options'] = { parseOnly: true }) =>
  compile({ files: new Map([['a.bas', text]]), main: 'a.bas', options, ...extra });

describe('compile() front end', () => {
  it('VERSION matches package.json', () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });

  it('parseOnly on a good program is ok and stops after the parser', () => {
    const r = one('PRINT 1');
    expect(r.ok).toBe(true);
    expect(r.exitCode).toBe(0);
    expect(r.diagnostics).toEqual([]);
    expect(r.binary).toBeUndefined();
  });

  it('a syntax error is reported with file:line:col', () => {
    const r = one('PRINT 1\nx = 1 2');
    expect(r.ok).toBe(false);
    expect(r.exitCode).toBe(1);
    expect(formatDiagnostic(r.diagnostics[0] as never, r.sources)).toMatch(/^a\.bas:2:7: error E144: /);
  });

  it('dumps tokens and ast', () => {
    const r = one('x = 1', {}, { parseOnly: true, dump: ['tokens', 'ast'] });
    expect(r.stages?.tokens).toContain('Identifier');
    expect(r.stages?.ast).toMatch(/^Program /);
  });

  it('a dump of tokens or ast alone does not ask for code generation', () => {
    expect(one('x = 1', {}, { dump: ['ast'] }).ok).toBe(true);
  });

  it('a build without the runtime tree reports E004 after the checks', () => {
    const r = one('PRINT 1', {}, {});
    expect(r.diagnostics.map((d) => d.code)).toEqual(['E004']);
    expect(r.exitCode).toBe(1);
  });

  it('predefined names: __CPC__, __CPCBAS__, __VERSION__ and __DATE__ from the options', () => {
    const r = one('PRINT __CPC__; __CPCBAS__; __VERSION__; __DATE__', {}, { parseOnly: true, buildDate: '2026-11-07', dump: ['tokens'] });
    expect(r.ok).toBe(true);
    expect(r.stages?.tokens).toContain(`"${VERSION}"`);
    expect(r.stages?.tokens).toContain('"2026-11-07"');
    expect(one('PRINT __DATE__', {}, { parseOnly: true, dump: ['tokens'] }).stages?.tokens).toContain('"1970-01-01"');
  });

  it('-D names reach #if, and a numeric value at the start of a statement is a number', () => {
    const r = one('#if defined(PLUS)\nPRINT N\n#endif\nPRINT N', { defines: { PLUS: '', N: '7' } }, { parseOnly: true, dump: ['tokens'] });
    expect(r.ok).toBe(true);
    expect(r.stages?.tokens).not.toContain('LineNumber');
  });

  it('-W disables a warning and -Werror turns it into an error', () => {
    expect(one('PRINT "abc', {}, { parseOnly: true, disabledWarnings: [102] }).diagnostics).toEqual([]);
    const r = one('PRINT "abc', {}, { parseOnly: true, warningsAsErrors: true });
    expect(r.ok).toBe(false);
  });

  it('a missing main file is E003', () => {
    const r = compile({ files: new Map(), main: 'nope.bas', options: { parseOnly: true } });
    expect(r.diagnostics.map((d) => d.code)).toEqual(['E003']);
  });

  it('an internal exception becomes E001 and compile() does not throw', () => {
    const bad = {
      get: () => {
        throw new Error('boom');
      },
      has: () => {
        throw new Error('boom');
      },
    };
    const r = compile({ files: bad, main: 'a.bas', options: { parseOnly: true } });
    expect(r.ok).toBe(false);
    expect(r.diagnostics.map((d) => d.code)).toEqual(['E001']);
    expect(r.diagnostics[0]?.message).toContain('boom');
  });

  it('stats.timeMs uses the host clock only when given', () => {
    let t = 0;
    expect(one('PRINT 1', {}, { parseOnly: true, now: () => (t += 5) }).stats.timeMs).toBe(5);
    expect(one('PRINT 1').stats.timeMs).toBe(0);
  });
});

describe('dropped Sinclair forms in expressions (parse-only)', () => {
  it.each([
    ['x = ATTR(1, 1)', 'E961'],
    ['a$ = SCREEN$(1, 1)', 'E961'],
    ['x = USR 32768', 'E961'],
    ['b$ = a$(2 TO 4)', 'E962'],
  ])('%s gives %s at the word', (src, code) => {
    expect(one(src).diagnostics.map((d) => d.code)).toEqual([code]);
  });

  it('the same words stay usable as plain variables', () => {
    expect(one('usr = 3\nPRINT usr\nattr = usr + 1').diagnostics).toEqual([]);
  });
});
