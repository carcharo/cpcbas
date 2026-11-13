/**
 * Robustness of the lowering over every corpus program: it never throws, and a program it
 * lowers without errors passes the IR verifier. Programs the checker gates (outside the L2
 * subset) are lowered as well, with the gate off, to show that what the lowering does not
 * handle is reported as E002 and never crashes.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bind } from '../src/binder/index.js';
import { checkProgram } from '../src/checker/index.js';
import { DiagnosticBag } from '../src/core/diagnostics.js';
import { SourceSet } from '../src/core/source.js';
import { lower } from '../src/ir/index.js';
import { verifyIr } from '../src/ir/verify.js';
import { runFrontEnd } from '../src/pipeline.js';
import { basFiles, corpusTree, INCLUDE_PATHS } from './corpus-files.js';
import { repoRoot } from './z80sim/run.js';

const tree = corpusTree();
const locoDir = join(repoRoot, 'tests/loco');
for (const f of readdirSync(locoDir)) if (f.endsWith('.bas')) tree.set(`loco/${f}`, readFileSync(join(locoDir, f), 'utf8'));
const files = [...basFiles('valid'), ...readdirSync(locoDir).filter((f) => f.endsWith('.bas')).sort().map((f) => `loco/${f}`)];

function lowerWith(path: string, subset: boolean): { errors: string[]; problems: readonly string[]; lowered: boolean } {
  const sources = new SourceSet();
  const bag = new DiagnosticBag();
  const { program } = runFrontEnd({ files: tree, main: path, includePaths: INCLUDE_PATHS }, sources, bag);
  const bound = bind({ program, sources, diagnostics: bag, bareMetal: false });
  const checked = checkProgram({ bound, sources, diagnostics: bag }, { subset });
  if (bag.hasErrors) return { errors: [], problems: [], lowered: false };
  const ir = lower({ checked, diagnostics: bag });
  const errors = bag.all().filter((d) => d.severity === 'error').map((d) => d.code);
  return { errors, problems: errors.length === 0 ? verifyIr(ir) : [], lowered: true };
}

describe('lowering over the corpus', () => {
  it.each(files)('%s lowers without throwing; errors are E002 and clean programs verify', (path) => {
    for (const subset of [true, false]) {
      const r = lowerWith(path, subset);
      if (!r.lowered) continue;
      expect(r.errors.every((c) => c === 'E002'), `${path}: ${r.errors.join(' ')}`).toBe(true);
      expect(r.problems, path).toEqual([]);
    }
  });
});

describe('lowering over the corpus: strings (L2-STRLOWER)', () => {
  it('the string conformance program lowers with no diagnostics and verifies', () => {
    const r = lowerWith('loco/str-basic.bas', true);
    expect(r.lowered).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.problems).toEqual([]);
  });
  it('no corpus program reports the retired string E002s', () => {
    const stringOnly: string[] = [];
    for (const f of files) {
      // Its CALL with a string argument (`@buf, "text"`) used to stop at the array `@buf`; the string descriptor is L3-ADDR's.
      if (f === 'valid/21-call-rsx-address.bas') continue;
      const sources = new SourceSet();
      const bag = new DiagnosticBag();
      const { program } = runFrontEnd({ files: tree, main: f, includePaths: INCLUDE_PATHS }, sources, bag);
      const bound = bind({ program, sources, diagnostics: bag, bareMetal: false });
      const checked = checkProgram({ bound, sources, diagnostics: bag }, { subset: false });
      if (bag.hasErrors) continue;
      lower({ checked, diagnostics: bag });
      const e002 = bag.all().filter((d) => d.code === 'E002');
      if (e002.some((d) => /Strings outside|PRINT of a string|Conversion between numbers and strings|^(LEN|ASC|VAL|STR\$|LEFT\$|RIGHT\$|MID\$|CHR\$|SPACE\$|STRING\$|UPPER\$|LOWER\$|INSTR|INKEY\$) \(strings\)/.test(d.message))) stringOnly.push(f);
    }
    expect(stringOnly).toEqual([]);
  });
});

describe('lowering over the corpus: coverage', () => {
  it('lowers a good share of the programs with the gate on and off (not vacuous)', () => {
    const lowered = (subset: boolean): number => files.filter((f) => lowerWith(f, subset).lowered).length;
    expect(lowered(true)).toBeGreaterThanOrEqual(8);
    expect(lowered(false)).toBeGreaterThan(lowered(true));
  });
});
