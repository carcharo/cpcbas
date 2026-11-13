import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DiagnosticBag } from '../core/diagnostics.js';
import { SourceSet, normalizePath, dirname as vdirname } from '../core/source.js';
import { preprocessAsm } from './preprocess.js';
import type { IncludeResolver } from './types.js';

interface Call {
  name: string;
  from: string;
  angle: boolean;
}

function run(main: string, files: Record<string, string> = {}, defines?: Record<string, string>) {
  const sources = new SourceSet();
  const entry = sources.add('main.asm', main, 'generated');
  const diagnostics = new DiagnosticBag();
  const calls: Call[] = [];
  const resolveInclude: IncludeResolver = (name, from, angle) => {
    calls.push({ name, from, angle });
    const candidates = angle ? [name] : [normalizePath(`${vdirname(from)}/${name}`), name];
    for (const c of candidates) {
      const text = files[c];
      if (text !== undefined) return { path: c, text };
    }
    return undefined;
  };
  const result = preprocessAsm({
    sources,
    entry,
    resolveInclude,
    diagnostics,
    ...(defines ? { defines: new Map(Object.entries(defines)) } : {}),
  });
  return { result, diagnostics: diagnostics.all(), calls, texts: result.lines.map((l) => l.text), sources };
}

describe('preprocessAsm', () => {
  it('include once pastes each file once, in order', () => {
    const r = run('a\n#include once <x.asm>\nb\n#include once <y.asm>\n#include once <x.asm>\nc', {
      'x.asm': 'x1\n#include once <y.asm>\nx2',
      'y.asm': 'y1',
    });
    expect(r.diagnostics).toEqual([]);
    expect(r.texts).toEqual(['a', 'x1', 'y1', 'x2', 'b', 'c']);
  });

  it('plain include pastes again, and a self-include is stopped', () => {
    const r = run('#include <x.asm>\n#include <x.asm>', { 'x.asm': 'x' });
    expect(r.texts).toEqual(['x', 'x']);
    const loop = run('#include "main.asm"', { 'main.asm': '#include "main.asm"' });
    expect(loop.diagnostics.map((d) => d.code)).toContain('E567');
  });

  it('angle and quoted includes go to the resolver with the right flag', () => {
    const r = run('#include <a.asm>\n#include once "b.asm"', { 'a.asm': 'a', 'b.asm': 'b' });
    expect(r.calls).toEqual([
      { name: 'a.asm', from: 'main.asm', angle: true },
      { name: 'b.asm', from: 'main.asm', angle: false },
    ]);
    expect(r.texts).toEqual(['a', 'b']);
  });

  it('ifdef branches with defines from options', () => {
    const src = '#ifdef CPC_BAREMETAL\nbare\n#else\nfirm\n#endif\n#ifndef CPC_BAREMETAL\nn1\n#endif\n#if defined(X) && Y == 2\nif1\n#else\nif0\n#endif';
    expect(run(src).texts).toEqual(['firm', 'n1', 'if0']);
    expect(run(src, {}, { CPC_BAREMETAL: '1', X: '', Y: '2' }).texts).toEqual(['bare', 'if1']);
    const nested = run('#ifdef A\n#ifdef B\nab\n#else\na\n#endif\n#else\n#ifdef B\nb\n#endif\n#endif', {}, { B: '1' });
    expect(nested.texts).toEqual(['b']);
  });

  it('defines expand as whole words outside comments and strings', () => {
    const r = run(
      '#define x 9\n#define _str 1\n#define N 0x10 ; note\nld a,_str\nld b,N+_str2 ; _str\ndefm "_str", \'x\'\nld a,1Fh\nld c,_str_x\n#undef _str\nld a,_str',
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.texts).toEqual(['ld a,1', 'ld b,0x10+_str2 ; _str', 'defm "_str", \'x\'', 'ld a,1Fh', 'ld c,_str_x', 'ld a,_str']);
  });

  it('expands nested defines and survives a self-reference', () => {
    const r = run('#define A B\n#define B 3\n#define R R+1\nld a,A\nld b,R');
    expect(r.texts).toEqual(['ld a,3', 'ld b,R+1']);
  });

  it('#init collects labels in order, quotes stripped', () => {
    const r = run('#init .core.A\n#init ".core.B"\nnop\n#init C ; why');
    expect(r.diagnostics).toEqual([]);
    expect(r.result.inits.map((i) => i.label)).toEqual(['.core.A', '.core.B', 'C']);
    expect(r.texts).toEqual(['nop']);
  });

  it('#line sets attribution and advances per line', () => {
    const r = run('before\n#line 10 "game.bas"\nx\ny\n#ifdef NO\nz\n#endif\nw\n#line 3\nv');
    const attr = r.result.lines.map((l) => l.attribution);
    expect(attr).toEqual([
      null,
      { path: 'game.bas', line: 10 },
      { path: 'game.bas', line: 11 },
      { path: 'game.bas', line: 15 },
      { path: 'game.bas', line: 3 },
    ]);
    expect(r.result.lines[1]?.span.start).toBe(r.sources.byPath('main.asm')?.text.indexOf('x'));
  });

  it('a bare #line ends the attribution', () => {
    const r = run('#line 10 "game.bas"\nx\n#line\ny\n#line   ; a comment\nz');
    expect(r.result.lines.map((l) => l.attribution)).toEqual([{ path: 'game.bas', line: 10 }, null, null]);
    expect(r.diagnostics).toEqual([]);
  });

  it('an include has its own attribution; the parent resumes', () => {
    const r = run('#line 5 "p.bas"\n#include <i.asm>\nafter', { 'i.asm': 'inc' });
    expect(r.result.lines.map((l) => l.attribution)).toEqual([null, { path: 'p.bas', line: 6 }]);
  });

  it('#error E561 with the message', () => {
    const r = run('#ifdef NO\n#error "not seen"\n#endif\n#error "stop here, it\'s bad"');
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]).toMatchObject({ code: 'E561', message: "stop here, it's bad" });
    const w = run('#warning careful');
    expect(w.diagnostics[0]).toMatchObject({ code: 'W562', message: 'careful' });
  });

  it('include not found at the directive', () => {
    const r = run('nop\n#include <missing.asm>\nret');
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]).toMatchObject({ code: 'E560' });
    expect(r.diagnostics[0]?.message).toContain('missing.asm');
    expect(r.diagnostics[0]?.span).toMatchObject({ start: 4, end: 26 });
    expect(r.texts).toEqual(['nop', 'ret']);
  });

  it('reports malformed and unbalanced directives without throwing', () => {
    const codes = (s: string): string[] => run(s).diagnostics.map((d) => d.code);
    expect(codes('#bogus')).toEqual(['E563']);
    expect(codes('#endif')).toEqual(['E565']);
    expect(codes('#ifdef A\n#else\n#else\n#endif')).toEqual(['E565']);
    expect(codes('#ifdef A\nnop')).toEqual(['E566']);
    expect(codes('#include foo')).toEqual(['E564']);
    expect(codes('#define F(x) x')).toEqual(['E568']);
    expect(codes('#if 1 +\n#endif')).toEqual(['E569']);
    expect(codes('#init')).toEqual(['E564']);
  });

  it('directives must start in column 1; comment lines are never scanned', () => {
    const r = run('  #define X 1\n; #define Y 2\n#define Z 3\nld a,X ; Z\nld a,Y');
    expect(r.texts).toEqual(['  #define X 1', '; #define Y 2', 'ld a,X ; Z', 'ld a,Y']);
  });

  it('is deterministic', () => {
    const a = run('#define A 1\nld a,A\n#init x', {});
    const b = run('#define A 1\nld a,A\n#init x', {});
    expect(a.result).toEqual(b.result);
  });
});

// ---------------------------------------------------------------------------
// Runtime smoke test over lib/runtime (skipped when the library is absent)
// ---------------------------------------------------------------------------

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const runtimeDir = join(repo, 'lib/runtime');

function smoke(defines: Record<string, string>) {
  const sources = new SourceSet();
  const diagnostics = new DiagnosticBag();
  const resolveInclude: IncludeResolver = (name, from, angle) => {
    const candidates = angle ? [name] : [normalizePath(`${vdirname(from)}/${name}`), name];
    for (const c of candidates) {
      const full = join(runtimeDir, c);
      if (existsSync(full)) return { path: c, text: readFileSync(full, 'latin1') };
    }
    return undefined;
  };
  const entry = sources.add('print.asm', readFileSync(join(runtimeDir, 'print.asm'), 'latin1'), 'runtime');
  const result = preprocessAsm({ sources, entry, resolveInclude, diagnostics, defines: new Map(Object.entries(defines)) });
  return { result, diagnostics: diagnostics.all(), sources };
}

describe.skipIf(!existsSync(join(runtimeDir, 'print.asm')))('runtime smoke', () => {
  it('print.asm preprocesses cleanly in the firmware variant', () => {
    const r = smoke({});
    expect(r.diagnostics).toEqual([]);
    expect(r.result.lines.length).toBeGreaterThan(100);
    expect(r.result.lines.some((l) => /^\s*#/.test(l.text))).toBe(false);
    expect(r.sources.all().length).toBeGreaterThan(3);
  });

  it('print.asm preprocesses cleanly in the bare (CPC_BAREMETAL) variant', () => {
    const fw = smoke({});
    const bare = smoke({ CPC_BAREMETAL: '1' });
    expect(bare.diagnostics).toEqual([]);
    expect(bare.result.lines.some((l) => /^\s*#/.test(l.text))).toBe(false);
    expect(bare.result.lines.map((l) => l.text)).not.toEqual(fw.result.lines.map((l) => l.text));
  });

  it('read_restore.asm expands its type-code defines as operands', () => {
    const sources = new SourceSet();
    const diagnostics = new DiagnosticBag();
    const entry = sources.add('read_restore.asm', readFileSync(join(runtimeDir, 'read_restore.asm'), 'latin1'), 'runtime');
    const resolveInclude: IncludeResolver = (name) => {
      const full = join(runtimeDir, name);
      return existsSync(full) ? { path: name, text: readFileSync(full, 'latin1') } : undefined;
    };
    const r = preprocessAsm({ sources, entry, resolveInclude, diagnostics });
    expect(diagnostics.all()).toEqual([]);
    expect(r.lines.some((l) => /\b_(str|i8|u16|flt)\b/.test(l.text.split(';')[0] ?? ''))).toBe(false);
  });

  it('every runtime file preprocesses without errors, firmware and bare', () => {
    const all: string[] = [];
    const walk = (rel: string): void => {
      for (const n of readdirSync(join(runtimeDir, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const r = rel ? `${rel}/${n.name}` : n.name;
        if (n.isDirectory()) walk(r);
        else if (n.name.endsWith('.asm')) all.push(r);
      }
    };
    walk('');
    expect(all.length).toBeGreaterThan(100);
    for (const defs of [{}, { CPC_BAREMETAL: '1' }]) {
      for (const f of all) {
        const sources = new SourceSet();
        const diagnostics = new DiagnosticBag();
        const entry = sources.add(f, readFileSync(join(runtimeDir, f), 'latin1'), 'runtime');
        const resolveInclude: IncludeResolver = (name, from, angle) => {
          for (const c of angle ? [name] : [normalizePath(`${vdirname(from)}/${name}`), name]) {
            if (existsSync(join(runtimeDir, c))) return { path: c, text: readFileSync(join(runtimeDir, c), 'latin1') };
          }
          return undefined;
        };
        preprocessAsm({ sources, entry, resolveInclude, diagnostics, defines: new Map(Object.entries(defs)) });
        expect(diagnostics.all().map((d) => `${f}: ${d.code} ${d.message}`)).toEqual([]);
      }
    }
  });
});
