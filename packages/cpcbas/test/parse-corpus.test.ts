/**
 * The permanent parse-corpus runner (phase L1 milestone): the whole front end over
 * tests/parse-corpus. See tests/parse-corpus/README.md.
 *
 * - every valid/ file gives only the diagnostics its .expect lists;
 * - every errors/ case gives exactly its .expect (line:col and code);
 * - parse(unparse(parse(x))) equals parse(x) up to spans, for every valid file;
 * - printAst of every valid file matches the committed snapshot in test/__snapshots__/ast/.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Program } from '../src/ast/ast.js';
import { printAst } from '../src/ast/print.js';
import { unparse } from '../src/ast/unparse.js';
import { DiagnosticBag } from '../src/core/diagnostics.js';
import { SourceSet } from '../src/core/source.js';
import { compile } from '../src/index.js';
import { runFrontEnd } from '../src/pipeline.js';
import { basFiles, corpusTree, expectations, INCLUDE_PATHS } from './corpus-files.js';

const tree = corpusTree();
const SNAP = fileURLToPath(new URL('./__snapshots__/ast/', import.meta.url));

/** Files whose round trip fails for a known parser/unparser reason: path -> named reason. */
const ROUND_TRIP_SKIP = new Map<string, string>();

function diagnosticsOf(main: string): string[] {
  const r = compile({ files: tree, main, includePaths: INCLUDE_PATHS, options: { parseOnly: true } });
  return r.diagnostics.map((d) => {
    const p = r.sources.position(d.span.file, d.span.start);
    return `${p.line}:${p.col} ${d.code}`;
  });
}

function parseFiles(files: Map<string, string>, main: string): { program: Program; sources: SourceSet; errors: number } {
  const sources = new SourceSet();
  const bag = new DiagnosticBag();
  const { program } = runFrontEnd({ files, main, includePaths: INCLUDE_PATHS }, sources, bag);
  return { program, sources, errors: bag.all().filter((d) => d.severity === 'error').length };
}

const VALID = [...basFiles('valid'), ...basFiles('valid/inc')];
const ERRORS = basFiles('errors');

describe('parse corpus: valid programs', () => {
  it.each(VALID)('%s gives only its expected diagnostics', (path) => {
    expect(diagnosticsOf(path)).toEqual(expectations(path));
  });
});

describe('parse corpus: error cases', () => {
  it.each(ERRORS)('%s reports exactly its expectations', (path) => {
    const expected = expectations(path);
    expect(expected.length).toBeGreaterThan(0);
    for (const e of expected) expect(e).toMatch(/^\d+:\d+ [EW]\d{3}$/);
    expect(diagnosticsOf(path)).toEqual(expected);
  });
});

describe('parse corpus: round trip', () => {
  it.each(VALID)('%s: parse(unparse(parse(x))) equals parse(x) up to spans', (path) => {
    const skip = ROUND_TRIP_SKIP.get(path);
    if (skip !== undefined) return;
    const first = parseFiles(tree, path);
    const text = unparse(first.program);
    const second = parseFiles(new Map([['round.bas', text]]), 'round.bas');
    // Compare the statements: includes and file ids are not part of the shape.
    const shape = (p: { program: Program; sources: SourceSet }): string => printAst({ ...p.program, includes: [], mainFile: null }, p.sources);
    expect(second.errors).toBe(0);
    expect(shape(second)).toBe(shape(first));
  });
});

describe('round trip: SUB calls without parentheses (follow-up 6)', () => {
  const head = 'SUB Foo(x AS INTEGER)\nEND SUB\n';
  it.each(['Foo (1 + 2) * 3', 'Foo -1', 'Foo (1), 2', 'Foo', 'Foo 1 + 2', 'Foo (1)'])('%s', (call) => {
    const first = parseFiles(new Map([['a.bas', `${head}${call}\n`]]), 'a.bas');
    const second = parseFiles(new Map([['b.bas', unparse(first.program)]]), 'b.bas');
    const shape = (p: { program: Program; sources: SourceSet }): string => printAst({ ...p.program, includes: [], mainFile: null }, p.sources);
    expect(second.errors).toBe(first.errors);
    expect(shape(second)).toBe(shape(first));
  });
});

describe('parse corpus: AST snapshots', () => {
  const update = process.env.UPDATE_AST_SNAPSHOTS === '1';
  it.each(VALID)('%s matches its printAst snapshot', (path) => {
    const { program, sources } = parseFiles(tree, path);
    const dump = printAst(program, sources);
    const file = join(SNAP, `${path.replace(/\//g, '__')}.txt`);
    if (update) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, dump);
    }
    expect(existsSync(file), `missing snapshot ${file}; run with UPDATE_AST_SNAPSHOTS=1`).toBe(true);
    expect(dump).toBe(readFileSync(file, 'utf8'));
  });
});
