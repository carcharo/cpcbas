/**
 * Every tests/parse-corpus/valid program goes through the binder. Only the diagnostics listed
 * in EXPECTED may appear (line:col code, with a reason per file); anything else fails.
 */
import { describe, expect, it } from 'vitest';
import { bind } from '../src/binder/index.js';
import { DiagnosticBag } from '../src/core/diagnostics.js';
import { SourceSet } from '../src/core/source.js';
import { runFrontEnd } from '../src/pipeline.js';
import { basFiles, corpusTree, expectations, INCLUDE_PATHS } from './corpus-files.js';

const tree = corpusTree();

/** Binder diagnostics a valid corpus file is expected to give: `file -> [codes, reason]`. */
const EXPECTED = new Map<string, { diagnostics: string[]; reason: string }>([
  ['valid/06-for-next.bas', { diagnostics: ['26:9 W301', '26:18 W301', '26:32 W301'], reason: 'a loop-syntax snippet whose bounds first, last and stride are never assigned' }],
  ['valid/11-sub-function.bas', { diagnostics: ['3:1 W305', '4:1 W305', '82:1 E205', '83:7 E204'], reason: 'DECLARE SUB/FUNCTION with no definition: W305 at each DECLARE, and DECLARE declares nothing (spec section 7), so the calls are undefined' }],
  ['valid/21-call-rsx-address.bas', { diagnostics: ['35:47 W301'], reason: 'KM_WAIT_KEY is a built-in firmware constant (spec section 18) and binds clean; 35:47 is an unassigned CALL argument' }],
  ['valid/loco-06-numbers.bas', { diagnostics: ['20:9 W301', '20:21 W301', '20:36 W301'], reason: 'a snippet reading a, b and c that are never assigned' }],
  ['valid/loco-15-memory-machine.bas', { diagnostics: ['17:17 W301', '17:20 W301', '17:24 W301'], reason: 'SIZEOF(buf), SIZEOF(w) and a CALL argument read variables never assigned in the snippet' }],
  ['valid/loco-16-files.bas', { diagnostics: ['8:9 W301'], reason: 'LOAD f$ reads a file name variable never assigned in the snippet' }],
]);

function run(path: string): { front: string[]; binder: string[] } {
  const sources = new SourceSet();
  const front = new DiagnosticBag();
  const { program } = runFrontEnd({ files: tree, main: path, includePaths: INCLUDE_PATHS }, sources, front);
  const diag = new DiagnosticBag();
  const bound = bind({ program, sources, diagnostics: diag, bareMetal: false });
  expect(bound.scopes.length).toBeGreaterThan(0);
  const fmt = (d: { span: { file: number; start: number }; code: string }): string => {
    const p = sources.position(d.span.file as never, d.span.start);
    return `${p.line}:${p.col} ${d.code}`;
  };
  return { front: front.all().map(fmt), binder: diag.all().map(fmt) };
}

const VALID = [...basFiles('valid'), ...basFiles('valid/inc')];

describe('binder over the parse corpus', () => {
  it.each(VALID)('%s binds with no unexpected diagnostic', (path) => {
    const { front, binder } = run(path);
    expect(front).toEqual(expectations(path));
    expect(binder).toEqual(EXPECTED.get(path)?.diagnostics ?? []);
  });

  it('binding the corpus twice gives the same diagnostics', () => {
    for (const path of VALID.slice(0, 10)) expect(run(path).binder).toEqual(run(path).binder);
  });
});
