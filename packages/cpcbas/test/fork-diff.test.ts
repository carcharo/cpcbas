/**
 * L2-FORKDIFF: the common-subset programs under tests/fork-diff/ parse under cpcbas's parser and
 * lower without any diagnostic (in particular no E002). Fast, no emulator; the emulator
 * comparison against the fork is tools/fork-diff.py.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lowerSource } from './compile-helper.js';
import { repoRoot } from './z80sim/run.js';

const dir = join(repoRoot, 'tests/fork-diff');
const programs = readdirSync(dir).filter((f) => f.endsWith('.bas') && f !== 'common.bas').sort();
const common = { 'common.bas': readFileSync(join(dir, 'common.bas'), 'utf8') };

describe('tests/fork-diff programs', () => {
  // L4 adds one program per modern-layer alias (PAUSE, BEEP, CIRCLE/POINT, PRINT AT): the bound rose from 10 to 16.
  it('there are six to sixteen of them', () => {
    expect(programs.length).toBeGreaterThanOrEqual(6);
    expect(programs.length).toBeLessThanOrEqual(16);
  });

  it.each(programs)('%s parses, checks and lowers with no error (no E002) and verifies', (file) => {
    const low = lowerSource(readFileSync(join(dir, file), 'utf8'), common);
    // warnings are allowed (a variable only an ASM block assigns draws W301); errors are not
    expect(low.diagnostics.filter((d) => !d.startsWith('W'))).toEqual([]);
    expect(low.problems).toEqual([]);
  });

  it.each(programs)('%s keeps to the common subset (no PRINT AT, no ?, no bAND family)', (file) => {
    const text = readFileSync(join(dir, file), 'utf8');
    expect(text).not.toMatch(/\bPRINT\s+AT\b/i);
    expect(text).not.toMatch(/^\s*\?/m);
    expect(text).not.toMatch(/\b(bAND|bOR|bXOR|bNOT)\b/i);
    expect(text).toMatch(/\bEND\b/);
  });
});
