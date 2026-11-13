import { describe, expect, it } from 'vitest';
import { CODE_RANGES, CODES, DiagnosticBag, codeNumber, diagnosticToJson, formatDiagnostic } from './diagnostics.js';
import { SourceSet } from './source.js';

describe('code tables', () => {
  it('every code is in its table range, with a letter matching its severity, and numbers are unique', () => {
    const seen = new Map<number, string>();
    for (const { name, table, ranges } of CODE_RANGES) {
      for (const [code, info] of Object.entries(table)) {
        expect(code, `${name}: ${code}`).toMatch(/^[EW]\d{3}$/);
        expect(code[0], `${name}: ${code} letter`).toBe(info.severity === 'error' ? 'E' : 'W');
        const num = codeNumber(code);
        expect(ranges.some(([lo, hi]) => num >= lo && num <= hi), `${name}: ${code} outside its ranges`).toBe(true);
        expect(seen.has(num), `${code} duplicates ${seen.get(num)}`).toBe(false);
        seen.set(num, code);
      }
    }
    expect(Object.keys(CODES).length).toBe(seen.size);
  });
});

describe('DiagnosticBag', () => {
  const sources = new SourceSet();
  const f = sources.add('main.bas', 'PRINT "hi\n');

  it('sorts, filters disabled warnings and applies -Werror', () => {
    const bag = new DiagnosticBag({ disabled: ['W129'] });
    bag.report('E101', { file: f.id, start: 5, end: 6 });
    bag.report('W102', { file: f.id, start: 2, end: 3 });
    bag.report('W129', { file: f.id, start: 0, end: 1 });
    expect(bag.all().map((d) => d.code)).toEqual(['W102', 'E101']);
    const strict = new DiagnosticBag({ warningsAsErrors: true });
    strict.report('W102', { file: f.id, start: 0, end: 1 });
    expect(strict.hasErrors).toBe(true);
    expect(strict.all()[0]?.code).toBe('W102');
  });

  it('formats text and JSON with 1-based columns', () => {
    const bag = new DiagnosticBag();
    bag.report('W102', { file: f.id, start: 6, end: 9 });
    const [d] = bag.all();
    expect(d).toBeDefined();
    if (!d) return;
    expect(formatDiagnostic(d, sources)).toBe(
      'main.bas:1:7: warning W102: String not closed; closed at the end of the line\n  hint: Add the closing ".',
    );
    expect(diagnosticToJson(d, sources)).toMatchObject({ file: 'main.bas', line: 1, col: 7, endLine: 1, endCol: 10, code: 'W102' });
  });
});
