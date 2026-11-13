/**
 * The blessed Locomotive transcripts (tests/loco) exist and are well formed. The emulator half is
 * tools/loco-diff.py (see tests/loco/README.md); `npm test` never runs an emulator.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const loco = join(resolve(dirname(fileURLToPath(import.meta.url)), '../../..'), 'tests/loco');
const programs = readdirSync(loco)
  .filter((f) => f.endsWith('.bas'))
  .map((f) => f.slice(0, -4))
  .sort();
const blessed = JSON.parse(readFileSync(join(loco, 'blessed.json'), 'utf8')) as Record<
  string,
  { program: string; emulator: string; files: Record<string, string>; sha256: Record<string, string>; shot?: Record<string, string> }
>;

/** The expected files of a program: the shared one, or the per-model ones. */
function expectedFiles(name: string): string[] {
  const shared = `${name}.expected`;
  const per = ['464', '6128'].map((m) => `${name}.${m}.expected`).filter((f) => existsSync(join(loco, f)));
  return existsSync(join(loco, shared)) ? [shared, ...per] : per;
}

/**
 * Programs written but not yet run on the interpreter by the harness owner (tools/loco-diff.py
 * --bless): they need no blessed record until then. Remove the entry when the program is blessed.
 */
const PENDING_BLESS: ReadonlySet<string> = new Set<string>();

describe('tests/loco blessed transcripts', () => {
  it('has the conformance programs of the milestone table', () => {
    for (const name of ['hello', 'int-arith', 'int-compare', 'int-flow', 'int-print', 'int-memory', 'str-basic', 'data', 'deffn']) {
      expect(programs).toContain(name);
    }
  });

  it.each(programs.filter((p) => !PENDING_BLESS.has(p)))('%s has a blessed record and expected output', (name) => {
    const files = expectedFiles(name);
    expect(files.length, `${name}: no .expected file (run tools/loco-diff.py --bless)`).toBeGreaterThan(0);
    // a shared file excludes per-model files
    if (files.includes(`${name}.expected`)) expect(files).toHaveLength(1);
    const record = blessed[name];
    expect(record, `${name}: missing from blessed.json`).toBeDefined();
    expect(record!.program).toBe(`${name}.bas`);
    expect(record!.emulator).toMatch(/^(Caprice32|CPCEC)$/);
    expect(Object.values(record!.files).sort()).toEqual([...files].sort());
    // each file is the transcript blessed.json hashed (an edit by hand breaks this)
    for (const [key, file] of Object.entries(record!.files)) {
      const models = key === 'all' ? Object.keys(record!.sha256) : [key];
      expect(models.length, `${name}: no sha256 for ${file}`).toBeGreaterThan(0);
      const sha = createHash('sha256').update(readFileSync(join(loco, file))).digest('hex');
      for (const m of models) expect(sha, `${file}: sha256 for ${m}`).toBe(record!.sha256[m]);
    }
    // a `REM LOCO: shot` program (tools/loco-diff.py) may print nothing: its screen is what is compared (record.shot, a sha256 per model)
    for (const sha of Object.values(record!.shot ?? {})) expect(sha, `${name}: shot sha256`).toMatch(/^[0-9a-f]{64}$/);
    for (const file of files) {
      const text = readFileSync(join(loco, file), 'latin1');
      if (record!.shot === undefined) {
        expect(text.length, file).toBeGreaterThan(0);
        expect(text.endsWith('\n'), `${file}: ends with a newline`).toBe(true);
      } else if (text.length > 0) expect(text.endsWith('\n'), `${file}: ends with a newline`).toBe(true);
      expect(text, `${file}: no CR`).not.toMatch(/\r/);
      expect(text, `${file}: no END marker`).not.toContain('\x04');
      expect(text, `${file}: no trailing Ready`).not.toMatch(/(^|\n)Ready\n$/);
      for (const ch of text) {
        const code = ch.charCodeAt(0);
        expect(code === 10 || code >= 32, `${file}: stray control code ${code}`).toBe(true);
      }
      expect(text, `${file}: not an error transcript`).not.toMatch(/\b(Syntax error|Improper argument|DATA exhausted) in \d+/);
    }
  });

  it('compare.json names programs, and a blessed record carries its rule', () => {
    const rules = JSON.parse(readFileSync(join(loco, 'compare.json'), 'utf8')) as Record<string, string[]>;
    expect(Object.keys(rules)).toEqual(['real', 'real-exact', 'bare-skip', 'bare-stop', 'compiled-skip']);
    // follow-up 68: the lists the --bare gate reads (tools/loco-diff.py); each names blessed programs
    for (const key of ['bare-skip', 'bare-stop', 'compiled-skip']) {
      for (const name of Object.keys(rules[key] ?? {})) expect(programs, `${key}: ${name}`).toContain(name);
    }
    // every REAL program is "real-exact" since FWM-CORE (the firmware's own maths); "real" (8 digits) is for a program that cannot be
    expect(rules['real-exact']).toEqual(['real-arith', 'real-basic', 'real-bytes', 'real-fn', 'real-rnd', 'real-round', 'real-val', 'err-real', 'err-real-trap', 'real-text']);
    for (const name of rules['real-exact'] ?? []) {
      // compared byte for byte in firmware builds: the blessed record needs no rule
      expect(programs).toContain(name);
      const record = blessed[name] as { compare?: string } | undefined;
      expect(record, `${name}: blessed`).toBeDefined();
      expect(record!.compare, `${name}: no rule in blessed.json`).toBeUndefined();
    }
    for (const name of rules.real ?? []) {
      expect(programs).toContain(name);
      const record = blessed[name] as { compare?: string } | undefined;
      if (record !== undefined) expect(record.compare, `${name}: blessed.json "compare"`).toBe('real');
    }
    for (const [name, record] of Object.entries(blessed)) {
      if ((record as { compare?: string }).compare !== undefined) expect(rules.real, name).toContain(name);
    }
  });

  it('has no blessed record without a program', () => {
    for (const name of Object.keys(blessed)) expect(programs).toContain(name);
  });

  it('hello prints the milestone transcript', () => {
    expect(readFileSync(join(loco, 'hello.expected'), 'latin1')).toBe('Hello CPC\n 1 \n 2 \n 3 \n 4 \n 5 \n 5  3 \n');
  });
});
