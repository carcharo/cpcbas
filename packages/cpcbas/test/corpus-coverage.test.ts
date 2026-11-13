/**
 * Coverage of the parse corpus (tests/parse-corpus), checked without a parser:
 * every keyword is exercised by a valid program or an error case, every
 * `.expect` line is well formed and points inside its file, and every file
 * names the spec section it covers. See tests/parse-corpus/README.md.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CODES } from '../src/core/diagnostics.js';
import { LEXER_CODES } from '../src/core/codes/lexer.js';
import { KEYWORDS } from '../src/lang/keywords.js';
import type { KeywordEntry } from '../src/lang/keywords.js';

const ROOT = fileURLToPath(new URL('../../../tests/parse-corpus/', import.meta.url));
const VALID = join(ROOT, 'valid');
const ERRORS = join(ROOT, 'errors');

function listFiles(dir: string, ext: string, recursive: boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (recursive) out.push(...listFiles(path, ext, true));
    } else if (name.endsWith(ext)) {
      out.push(path);
    }
  }
  return out;
}

function splitLines(text: string): string[] {
  const lines = text.split(/\r\n|\n|\r/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Crude comment and string strip, enough for a keyword search: removes `'` comments,
 * `/' ... '/` block comments (also across lines) and the text after `REM`, and blanks
 * the inside of string literals, so a word that only occurs in a comment or a string
 * does not count. `REM` itself is kept.
 */
function stripCommentsAndStrings(text: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const line of splitLines(text)) {
    let res = '';
    let inString = false;
    let i = 0;
    while (i < line.length) {
      const ch = line[i]!;
      if (inBlock) {
        if (ch === "'" && line[i + 1] === '/') {
          inBlock = false;
          i += 2;
        } else i++;
        continue;
      }
      if (inString) {
        if (ch === '"') {
          inString = false;
          res += ch;
        } else res += ' ';
        i++;
        continue;
      }
      if (ch === '"') {
        inString = true;
        res += ch;
        i++;
      } else if (ch === '/' && line[i + 1] === "'") {
        inBlock = true;
        i += 2;
      } else if (ch === "'") {
        break;
      } else if (/rem/i.test(line.slice(i, i + 3)) && !/[A-Za-z0-9_$%!]/.test(line[i - 1] ?? ' ') && !/[A-Za-z0-9_$%!]/.test(line[i + 3] ?? ' ')) {
        res += 'REM';
        break;
      } else {
        res += ch;
        i++;
      }
    }
    out.push(res);
  }
  return out.join('\n');
}

const WORD_CHAR = 'A-Za-z0-9_$%!';

/** A regexp for the canonical word sequence of a keyword entry: case-insensitive, whole words, any blanks between them. */
function sequenceRegExp(name: string): RegExp {
  const body = name
    .split(' ')
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
  return new RegExp(`(?<![${WORD_CHAR}#])${body}(?![${WORD_CHAR}])`, 'i');
}

function stripped(files: string[]): string {
  return files.map((f) => stripCommentsAndStrings(readFileSync(f, 'utf8'))).join('\n');
}

function missingFrom(text: string, entries: readonly KeywordEntry[]): string[] {
  const names = [...new Set(entries.map((e) => e.name))];
  return names.filter((n) => !sequenceRegExp(n).test(text));
}

const validFiles = listFiles(VALID, '.bas', true);
const errorFiles = listFiles(ERRORS, '.bas', false);

describe('parse corpus: keyword coverage', () => {
  it('every keyword entry appears in the valid corpus', () => {
    const wanted = KEYWORDS.filter((k) => ['compiled', 'firmware', 'alias', 'library'].includes(k.status));
    expect(missingFrom(stripped(validFiles), wanted)).toEqual([]);
  });

  it('every dropped/later entry appears in an error case', () => {
    const wanted = KEYWORDS.filter((k) => k.status === 'dropped' || k.status === 'later');
    expect(missingFrom(stripped(errorFiles), wanted)).toEqual([]);
  });

  it('every lexer error code has an error case, and W102 is expected in a valid listing', () => {
    const expectText = (files: string[]): string => files.map((f) => readFileSync(f.replace(/\.bas$/, '.expect'), 'utf8')).join('\n');
    const inErrors = expectText(errorFiles);
    const missing = Object.entries(LEXER_CODES)
      .filter(([, info]) => info.severity === 'error')
      .map(([code]) => code)
      .filter((code) => !new RegExp(`\\b${code}\\b`).test(inErrors));
    expect(missing).toEqual([]);
    const withSidecar = listFiles(VALID, '.expect', true).map((f) => f.replace(/\.expect$/, '.bas'));
    expect(expectText(withSidecar)).toMatch(/\bW102\b/);
  });
});

const EXPECT_LINE = /^(\d+):(\d+)(?: ([EW]\d{3}))? (\S.*)$/;

describe('parse corpus: expectations', () => {
  const expectFiles = [...listFiles(VALID, '.expect', true), ...listFiles(ERRORS, '.expect', false)];

  it('every .expect line is well formed and points inside its file', () => {
    const problems: string[] = [];
    for (const file of expectFiles) {
      const rel = relative(ROOT, file);
      const source = file.replace(/\.expect$/, '.bas');
      let lines: string[];
      try {
        lines = splitLines(readFileSync(source, 'utf8'));
      } catch {
        problems.push(`${rel}: no .bas file next to it`);
        continue;
      }
      let last: [number, number] = [0, 0];
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((text, i) => {
          if (text === '') return;
          const m = EXPECT_LINE.exec(text);
          if (!m) {
            problems.push(`${rel}:${i + 1}: not "line:col [CODE] description": ${text}`);
            return;
          }
          const line = Number(m[1]);
          const col = Number(m[2]);
          if (line < 1 || line > lines.length) problems.push(`${rel}:${i + 1}: line ${line} is outside the file (${lines.length} lines)`);
          else if (col < 1 || col > lines[line - 1]!.length + 1) problems.push(`${rel}:${i + 1}: column ${col} is outside line ${line} (length ${lines[line - 1]!.length})`);
          if (m[3] !== undefined && !(m[3] in CODES)) problems.push(`${rel}:${i + 1}: unknown code ${m[3]}`);
          if (line < last[0] || (line === last[0] && col < last[1])) problems.push(`${rel}:${i + 1}: expectations must be in source order`);
          last = [line, col];
        });
    }
    expect(problems).toEqual([]);
  });

  it('every error case has at least one expectation and a sidecar', () => {
    const problems: string[] = [];
    for (const file of errorFiles) {
      const rel = relative(ROOT, file);
      let text: string;
      try {
        text = readFileSync(file.replace(/\.bas$/, '.expect'), 'utf8');
      } catch {
        problems.push(`${rel}: no .expect sidecar`);
        continue;
      }
      if (!text.split('\n').some((l) => EXPECT_LINE.test(l))) problems.push(`${rel}: the .expect file has no expectation`);
    }
    expect(problems).toEqual([]);
  });

  it('every valid and error file starts with a comment naming its spec section', () => {
    const problems: string[] = [];
    for (const file of [...validFiles, ...errorFiles]) {
      const header: string[] = [];
      for (const line of splitLines(readFileSync(file, 'utf8'))) {
        if (!/^\s*('|REM\b)/i.test(line)) break;
        header.push(line);
      }
      if (!/spec sections? \d+/i.test(header.join('\n'))) problems.push(`${relative(ROOT, file)}: no leading comment with "spec section N"`);
    }
    expect(problems).toEqual([]);
  });

  it('the corpus has the planned size', () => {
    expect(validFiles.filter((f) => !f.includes('/inc/')).length).toBeGreaterThanOrEqual(30);
    expect(errorFiles.length).toBeGreaterThanOrEqual(40);
  });
});

describe('stripCommentsAndStrings', () => {
  it('drops comments and string contents but keeps REM and code', () => {
    const text = ["PRINT \"HELLO WORLD\" ' LOCATE", "REM DRAW", "x = 1 /' PLOT", "CIRCLE '/ + 2", "MODE 1"].join('\n');
    const result = stripCommentsAndStrings(text);
    expect(result).not.toMatch(/HELLO|LOCATE|DRAW|PLOT|CIRCLE/);
    expect(result).toMatch(/PRINT/);
    expect(result).toMatch(/REM/);
    expect(result).toMatch(/MODE 1/);
  });
});
