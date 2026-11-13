/**
 * L5-DIFF: the Studio-facing contract of every optimisation level. CPC
 * Game Studio reads the map file (memory view and source mapping), the `#line` lines of `--asm`, the JSON diagnostics and the
 * `--stage` dumps. For Lamplighter, `flow` and `err-trap` and for every level (-O0..-O3 and -Os):
 *
 * - the map has every user global, procedure and line label of the -O0 map (the names the Studio reads; temporaries `.T.n`,
 *   string literals `.S.n` and runtime or library chunks may go: stripping and temp removal are the optimiser's business);
 * - every `#line N "file"` in the asm (they mark the lines of user ASM blocks, which no pass touches) names a real line of a real
 *   source file (a user file, or a library file as `<lib>/...`), and the marks are exactly -O0's;
 * - the JSON diagnostics are the same as at -O0, for a program with warnings and for one with errors too;
 * - the token and AST dumps are the same, and the IR and asm dumps exist.
 *
 * While no pass exists every level is -O0's output and the whole file passes trivially; it fails when a pass drops a label the
 * Studio needs or leaves a `#line` pointing past the end of its file (a wrong pass is shown to fail in the L5-DIFF report).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile, diagnosticToJson } from '../src/index.js';
import type { CompileResult } from '../src/index.js';
import type { FileTree } from '../src/core/source.js';
import { OPT_LEVELS } from './opt-harness.js';
import type { Level } from './opt-harness.js';
import { libTree } from './runtime-tree.js';
import { repoRoot } from './z80sim/run.js';

interface Subject {
  readonly name: string;
  readonly files: FileTree;
  readonly main: string;
  readonly defines?: Record<string, string>;
  /** The program has ASM blocks, so its asm carries `#line` marks. */
  readonly hasAsm?: boolean;
}

const text = (path: string): string => readFileSync(path, 'latin1');

function tree(dir: string, skip: (rel: string) => boolean): Map<string, string | Uint8Array> {
  const files = new Map<string, string | Uint8Array>();
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      const rel = relative(dir, full).split('\\').join('/');
      if (skip(rel)) continue;
      if (e.isDirectory()) walk(full);
      else files.set(rel, /\.(bas|asm|txt|inc)$/i.test(e.name) ? text(full) : new Uint8Array(readFileSync(full)));
    }
  };
  walk(dir);
  return files;
}

const SUBJECTS: Subject[] = [
  { name: 'Lamplighter', files: tree(join(repoRoot, 'tests/games/lamplighter'), (rel) => rel === 'build' || rel.startsWith('tests/') || rel === 'tests'), main: 'main.bas', defines: { CPC6128: '' }, hasAsm: true },
  { name: 'flow', files: new Map([['flow.bas', text(join(repoRoot, 'tests/fork-diff/flow.bas'))], ['common.bas', text(join(repoRoot, 'tests/fork-diff/common.bas'))]]), main: 'flow.bas' },
  { name: 'err-trap', files: new Map([['err-trap.bas', text(join(repoRoot, 'tests/loco/err-trap.bas'))]]), main: 'err-trap.bas' },
  // a warning (W306: a SUB that is never called) and a program with labels, a SUB and a FUNCTION
  { name: 'warnings', files: new Map([['w.bas', 'SUB Unused()\nPRINT 1\nEND SUB\nFUNCTION F(a AS INTEGER) AS INTEGER\nRETURN a + 1\nEND FUNCTION\nDIM n AS INTEGER\nn = F(2)\nGOSUB Show\nASM\n  nop\n  nop\nEND ASM\nEND\nShow:\nPRINT n\nRETURN\n']]), main: 'w.bas', hasAsm: true },
];

// a call of a SUB with value arguments, one a FUNCTION call (as bare_sound's `BRng("name", Loud(), 9, 11)`): from -O1 the arguments
// before the call are not parked in spill slots, so the lowered IR differs from -O0's (the only way it may)
const PARKING: Subject = { name: 'parking', files: new Map([['p.bas', 'DIM n AS UINTEGER\nSUB Rng(t AS STRING, a AS UINTEGER, lo AS LONG, hi AS LONG)\nPRINT t; a; lo; hi\nEND SUB\nFUNCTION Loud() AS UINTEGER\nRETURN n\nEND FUNCTION\nRng("x", Loud(), 9, 11)\n']]), main: 'p.bas' };

const ERRORS: Subject = { name: 'errors', files: new Map([['e.bas', 'DIM a AS INTEGER\na = "x"\nPRINT undefinedfn(1)\nGOTO 999\n']]), main: 'e.bas' };

const LEVELS: readonly Level[] = [0, ...OPT_LEVELS];
const FULL = { map: true, asm: true } as const;
const STAGES = { dump: ['tokens', 'ast', 'ir', 'asm'] } as const;

const cache = new Map<string, CompileResult>();
/** One build per subject, level and kind of output (the tests below share them). */
function build(s: Subject, level: Level, extra: object = {}): CompileResult {
  const key = `${s.name}|${level}|${JSON.stringify(extra)}`;
  let r = cache.get(key);
  if (r === undefined) {
    r = compileOnce(s, level, extra);
    cache.set(key, r);
  }
  return r;
}

function compileOnce(s: Subject, level: Level, extra: object): CompileResult {
  return compile({
    files: s.files,
    main: s.main,
    defines: { __CPC_PRINTER_ECHO__: '', ...s.defines },
    runtime: libTree(),
    options: { optimize: level, ...extra },
  });
}

/** The names the Studio reads from a map: globals and arrays (`._x`), procedures and line labels (`.L.x`), and the region markers. */
const STUDIO_NAME = /^\.(_[\w.]*|L\.[\w.]+|core\.(__START_PROGRAM|__MAIN_PROGRAM__|__END_PROGRAM|ZXBASIC_USER_DATA|ZXBASIC_USER_DATA_END))$/;

function studioNames(map: string): Set<string> {
  const names = new Set<string>();
  for (const line of map.split('\n')) {
    const m = /^[0-9A-F]+: (\S+)$/.exec(line);
    if (m !== null && STUDIO_NAME.test(m[1]!)) names.add(m[1]!);
  }
  return names;
}

/** The (file, line) pairs of every `#line` in the asm. */
function lineMarks(asm: string): { file: string; line: number }[] {
  return [...asm.matchAll(/^\s*#line (\d+) "([^"]*)"/gm)].map((m) => ({ line: Number(m[1]), file: m[2]! }));
}

function sourceLines(s: Subject, file: string): number | undefined {
  let content: string | Uint8Array | undefined;
  if (file.startsWith('<lib>/')) content = libTree().get(file.slice('<lib>/'.length));
  else content = s.files.get(file) ?? s.files.get(file.replace(/^\.\//, ''));
  if (content === undefined) return undefined;
  return (typeof content === 'string' ? content : Buffer.from(content).toString('latin1')).split('\n').length;
}

/** What the Studio needs from one build, as the parts the checks read (a `CompileResult` has them all). */
type Outputs = Pick<CompileResult, 'map' | 'asm' | 'diagnostics' | 'sources'>;

const diagJson = (r: Outputs): string => JSON.stringify(r.diagnostics.map((d) => diagnosticToJson(d, r.sources)));

/**
 * The contract checks of one build against the subject's -O0 build, as a list of problems (empty: the contract holds). Pure,
 * so that the checks themselves are shown to fail on outputs that break the contract (R17; "the contract test itself" below).
 */
function contractProblems(s: Subject, base: Outputs, r: Outputs): string[] {
  const problems: string[] = [];
  const names = studioNames(r.map ?? '');
  const lost = [...studioNames(base.map ?? '')].filter((n) => !names.has(n));
  if (lost.length > 0) problems.push(`map: lost ${lost.slice(0, 5).join(', ')}`);
  const marks = lineMarks(r.asm ?? '');
  if (s.hasAsm === true && marks.length === 0) problems.push('#line: no marks in a program with ASM blocks');
  const bad = marks.filter((m) => {
    const n = sourceLines(s, m.file);
    return n === undefined || m.line < 1 || m.line > n;
  });
  if (bad.length > 0) problems.push(`#line: not a real source line: ${bad.slice(0, 3).map((m) => `${m.file}:${m.line}`).join(', ')}`);
  // a user ASM block is opaque: its lines, and so its marks, are -O0's exactly
  const key = (m: { file: string; line: number }): string => `${m.file}:${m.line}`;
  if (JSON.stringify(marks.map(key).sort()) !== JSON.stringify(lineMarks(base.asm ?? '').map(key).sort())) problems.push('#line: the marks differ from -O0');
  // and the bare `#line` that ends each block's attribution is kept as often
  const bare = (asm: string | undefined): number => (asm ?? '').split('\n').filter((l) => /^\s*#line\s*$/.test(l)).length;
  if (bare(r.asm) !== bare(base.asm)) problems.push(`#line: ${bare(r.asm)} bare marks against -O0's ${bare(base.asm)}`);
  if (diagJson(r) !== diagJson(base)) problems.push('diagnostics: the JSON differs from -O0');
  return problems;
}

describe.each(SUBJECTS)('Studio contract: $name', (s) => {
  const base = build(s, 0, FULL);
  const baseNames = studioNames(base.map ?? '');

  it('builds at -O0 and has the names the Studio reads', () => {
    expect(base.ok, base.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message).join('; ')).toBe(true);
    expect(baseNames.size).toBeGreaterThan(5);
    expect(baseNames.has('.core.__MAIN_PROGRAM__')).toBe(true);
  });

  it.each(LEVELS.map((l) => [l]))('-O%s: the map keeps every Studio name of -O0, every #line names a real source line and equals -O0\'s, the JSON diagnostics equal -O0\'s', (level) => {
    const r = build(s, level, FULL);
    expect(r.ok).toBe(true);
    expect(contractProblems(s, base, r)).toEqual([]);
  });

  it.each(LEVELS.map((l) => [l]))('-O%s: the --stage dumps: tokens, AST and IR equal -O0\'s, asm exists', (level) => {
    const want = build(s, 0, STAGES).stages;
    const got = build(s, level, STAGES).stages;
    expect(got?.tokens).toBe(want?.tokens);
    expect(got?.ast).toBe(want?.ast);
    // `ir` is the lowered IR of the level, before the IR passes; these subjects have no call whose arguments park differently, so
    // it equals -O0's (docs/ir.md "Optimisation"; the `parking` subject below covers the case); L5-IR adds `ir-opt`
    expect((got?.ir ?? '').length).toBeGreaterThan(0);
    expect(got?.ir).toBe(want?.ir);
    expect((got?.asm ?? '').length).toBeGreaterThan(0);
  });
});

describe('Studio contract: the ir dump of a call with a value argument that may call', () => {
  const ir = (level: Level): string => build(PARKING, level, STAGES).stages?.ir ?? '';
  it('builds at every level', () => {
    for (const level of LEVELS) expect(build(PARKING, level, STAGES).ok, `-O${level}`).toBe(true);
  });
  it('is the same at -O1, -O2, -O3 and -Os', () => {
    expect(ir(1).length).toBeGreaterThan(0);
    for (const level of [2, 3, 's'] as const) expect(ir(level), `-O${level}`).toBe(ir(1));
  });
  it('differs at -O0 (the subject covers the argument parking)', () => {
    expect(ir(0)).not.toBe(ir(1));
  });
});

describe('Studio contract: a program with errors', () => {
  const base = build(ERRORS, 0, FULL);
  it('fails at every level with the same diagnostics and produces no map', () => {
    expect(base.ok).toBe(false);
    const want = JSON.stringify(base.diagnostics.map((d) => diagnosticToJson(d, base.sources)));
    expect(JSON.parse(want).length).toBeGreaterThanOrEqual(2);
    for (const level of LEVELS) {
      const r = build(ERRORS, level, FULL);
      expect(r.ok, `-O${level}`).toBe(false);
      expect(JSON.stringify(r.diagnostics.map((d) => diagnosticToJson(d, r.sources))), `-O${level}`).toBe(want);
      expect(r.map, `-O${level}`).toBeUndefined();
    }
  });
});

describe('the contract test itself', () => {
  it('fails on outputs that break the contract: a lost label, a #line past the end of its file or moved, a changed diagnostic', () => {
    const s = SUBJECTS[3]!; // `warnings`: a SUB, a FUNCTION, a line label, an ASM block, a warning
    const base = build(s, 0, FULL);
    expect(contractProblems(s, base, base)).toEqual([]);
    const map = base.map ?? '';
    const fn = /^[0-9A-F]+: (\._f\S*)$/im.exec(map)?.[1] ?? /^[0-9A-F]+: (\._\S+)$/m.exec(map)![1]!;
    const lostMap = map.split('\n').filter((l) => !l.endsWith(` ${fn}`)).join('\n');
    expect(contractProblems(s, base, { ...base, map: lostMap })).toEqual([`map: lost ${fn}`]);
    const asm = base.asm ?? '';
    const first = lineMarks(asm)[0]!;
    const past = asm.replace(`#line ${first.line} "${first.file}"`, `#line 99 "${first.file}"`);
    expect(contractProblems(s, base, { ...base, asm: past })).toEqual([`#line: not a real source line: ${first.file}:99`, '#line: the marks differ from -O0']);
    const moved = asm.replace(`#line ${first.line} "${first.file}"`, `#line 1 "${first.file}"`);
    expect(contractProblems(s, base, { ...base, asm: moved })).toEqual(['#line: the marks differ from -O0']);
    const unended = asm.replace(/^\s*#line\s*$/m, '');
    expect(contractProblems(s, base, { ...base, asm: unended })[0]).toMatch(/^#line: \d+ bare marks against -O0's \d+$/);
    expect(contractProblems(s, base, { ...base, diagnostics: base.diagnostics.slice(1) })).toEqual(['diagnostics: the JSON differs from -O0']);
  });

  it('names a label that a map lost, and a #line past the end of its file', () => {
    const lost = studioNames('0040: ._a\n0041: .L.keep\n0042: .T.1\n');
    expect([...lost]).toEqual(['._a', '.L.keep']); // .T.n is not a Studio name
    const s = SUBJECTS[3]!;
    expect(sourceLines(s, 'w.bas')).toBe(18);
    expect(sourceLines(s, 'nope.bas')).toBeUndefined();
    expect(lineMarks('#line 99 "w.bas"\n  #line 2 "x.bas"')).toEqual([{ line: 99, file: 'w.bas' }, { line: 2, file: 'x.bas' }]);
  });
});
