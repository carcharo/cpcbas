/** The CLI's `run` with a real file system over tests/parse-corpus: exit codes, dumps, JSON columns. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run, type CliIo } from '../bin/cli.js';
import { basFiles, expectations } from './corpus-files.js';

const CORPUS = fileURLToPath(new URL('../../../tests/parse-corpus/', import.meta.url));

function realIo(): { io: CliIo; out: () => string; err: () => string } {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    readFile(path) {
      try {
        return readFileSync(resolve(CORPUS, path));
      } catch {
        return undefined;
      }
    },
    writeFile() {
      throw new Error('--parse-only and dumps must not write files');
    },
    stdout: (t) => void out.push(t),
    stderr: (t) => void err.push(t),
    cwd: CORPUS,
    today: () => '2026-11-07',
  };
  return { io, out: () => out.join(''), err: () => err.join('') };
}

describe('cpcbas --parse-only over the corpus', () => {
  it.each(basFiles('valid').filter((p) => !expectations(p).length))('%s exits 0 and prints nothing', async (path) => {
    const t = realIo();
    expect(await run(['--parse-only', '-I', 'valid/inc', path], t.io)).toBe(0);
    expect(t.err()).toBe('');
    expect(t.out()).toBe('');
  });

  it('a valid file with only warnings exits 0 and prints them', async () => {
    const t = realIo();
    expect(await run(['--parse-only', 'valid/27-listing-unclosed-string.bas'], t.io)).toBe(0);
    expect(t.err()).toMatch(/^valid\/27-listing-unclosed-string\.bas:4:9: warning W102: /);
  });

  it.each(basFiles('errors'))('%s exits 1 with file:line:col: error Ennn lines', async (path) => {
    const t = realIo();
    expect(await run(['--parse-only', path], t.io)).toBe(1);
    const lines = t.err().split('\n').filter((l) => /^\S+:\d+:\d+: (error|warning) [EW]\d{3}: /.test(l));
    const got = lines.map((l) => {
      const m = /^(\S+):(\d+):(\d+): (?:error|warning) ([EW]\d{3}): /.exec(l) as RegExpExecArray;
      expect(m[1]).toBe(path);
      return `${m[2]}:${m[3]} ${m[4]}`;
    });
    expect(got).toEqual(expectations(path));
    expect(lines.some((l) => l.includes(': error '))).toBe(true);
  });

  it('the documented example line', async () => {
    const t = realIo();
    await run(['--parse-only', 'errors/expr-two-values.bas'], t.io);
    expect(t.err().split('\n')[0]).toMatch(/^errors\/expr-two-values\.bas:2:7: error E144: /);
  });
});

describe('cpcbas --stage', () => {
  it('--stage tokens prints the preprocessed token stream on stdout', async () => {
    const t = realIo();
    expect(await run(['--parse-only', '--stage', 'tokens', 'valid/04-expressions.bas'], t.io)).toBe(0);
    const lines = t.out().split('\n');
    expect(lines[0]).toMatch(/^\d+:\d+ \w+ /);
    expect(lines.some((l) => l.includes('EOF'))).toBe(true);
    expect(t.err()).toBe('');
  });

  it('--stage ast prints the tree on stdout', async () => {
    const t = realIo();
    expect(await run(['--stage', 'ast', 'valid/06-for-next.bas'], t.io)).toBe(0);
    expect(t.out().startsWith('Program mainFile=0\n')).toBe(true);
    expect(t.out()).toContain('For ');
  });

  it('--stage ast still prints the tree when the program has errors', async () => {
    const t = realIo();
    expect(await run(['--stage', 'ast', 'errors/expr-two-values.bas'], t.io)).toBe(1);
    expect(t.out().startsWith('Program ')).toBe(true);
    expect(t.err()).toContain('error E144');
  });
});

describe('cpcbas --diagnostics json', () => {
  it('prints a JSON array with 1-based columns on stdout', async () => {
    const t = realIo();
    expect(await run(['--parse-only', '--diagnostics', 'json', 'errors/expr-two-values.bas'], t.io)).toBe(1);
    const arr = JSON.parse(t.out()) as Array<{ file: string; line: number; col: number; endCol: number; code: string; severity: string }>;
    expect(arr).toHaveLength(1);
    expect(arr[0]).toMatchObject({ file: 'errors/expr-two-values.bas', line: 2, col: 7, code: 'E144', severity: 'error' });
    expect(arr[0]?.endCol).toBeGreaterThan(7);
    expect(t.err()).toBe('');
  });

  it('keeps stdout JSON-only and sends the dump to stderr', async () => {
    const t = realIo();
    expect(await run(['--parse-only', '--diagnostics', 'json', '--stage', 'ast', 'errors/lex-dollar-hex.bas'], t.io)).toBe(1);
    expect(Array.isArray(JSON.parse(t.out()))).toBe(true);
    expect(t.err().startsWith('Program ')).toBe(true);
  });

  it('columns for every error case match the .expect files', async () => {
    for (const path of basFiles('errors')) {
      const t = realIo();
      await run(['--parse-only', '--diagnostics', 'json', path], t.io);
      const arr = JSON.parse(t.out()) as Array<{ line: number; col: number; code: string }>;
      expect(arr.map((d) => `${d.line}:${d.col} ${d.code}`), path).toEqual(expectations(path));
    }
  });
});
