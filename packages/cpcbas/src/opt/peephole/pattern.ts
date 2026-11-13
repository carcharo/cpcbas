/**
 * Line patterns and templates of the rule language (L5-PEEP). A port of the fork's `pattern.py` and
 * `template.py` (zxbasic src/arch/z80/peephole at e33cf0cd), with one change: a pattern matches the
 * whole line, not a prefix (the fork's `re.match` is unanchored; the matcher here is strict so that
 * `neg` cannot match `negx`).
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Ported from the fork's pattern.py and template.py, © Copyright 2008-2024 José Manuel Rodríguez de la Rosa and contributors.
 * See the file CONTRIBUTORS.md of zxbasic (https://github.com/boriel-basic/zxbasic) for copyright details.
 */

/** `$n` and `$$`: a pattern variable and the escaped dollar. */
export const RE_SVAR = /(\$(?:\$|[0-9]+))/;
const RE_PARSE = /(\s+|"(?:[^"]|"")*")/;
const RE_VAR_ONLY = /^\$[0-9]+$/;

/** A rule's text is wrong (the generator reports it as E574 or E575). */
export class RuleError extends Error {
  constructor(
    readonly code: 'E574' | 'E575',
    message: string,
    readonly line?: number,
  ) {
    super(message);
    this.name = 'RuleError';
  }
}

/** The line with every run of white space outside quotes collapsed to one space. */
function normalize(line: string): string {
  return line
    .split(RE_PARSE)
    .filter((x) => x !== '')
    .map((x) => (x.startsWith('"') ? x : x.trim() === '' ? ' ' : x.trim()))
    .join('')
    .trim();
}

const sanitize = (s: string): string => s.replace(/[.^$*+?{}[\]\\|()]/g, (c) => `\\${c}`);

interface Parsed {
  /** The text with white space normalised. */
  readonly line: string;
  /** Tokens: a space, a literal, or a `$n`. */
  readonly output: readonly string[];
  /** The regular expression source (a pattern). */
  readonly source: string;
  /** The names of the groups, `_1` for `$1`, in order of appearance. */
  readonly vars: readonly string[];
}

function parseLine(raw: string): Parsed {
  const line = normalize(raw);
  const output: string[] = [];
  const vars: string[] = [];
  let source = '';
  for (const token of line.split(RE_PARSE).filter((x) => x !== '')) {
    if (token === ' ') {
      source += '\\s+';
      output.push(' ');
      continue;
    }
    for (const tok of token.split(RE_SVAR).filter((x) => x !== '')) {
      if (tok === '$$') {
        source += '\\$';
        output.push('$');
      } else if (RE_VAR_ONLY.test(tok)) {
        output.push(tok);
        const name = `_${tok.slice(1)}`;
        if (!vars.includes(name)) {
          vars.push(name);
          source += `(?<${name}>.*)`;
        } else source += `\\k<${name}>`;
      } else {
        output.push(tok);
        source += sanitize(tok);
      }
    }
  }
  return { line, output, source, vars };
}

/** A pattern for one line: `push $1` binds `$1` to the operand of any `push`. */
export class LinePattern {
  readonly line: string;
  readonly vars: ReadonlySet<string>;
  /** Whether the pattern is a label line (`$2:`): label lines are matched only by such patterns. */
  readonly isLabel: boolean;
  private readonly re: RegExp;

  constructor(raw: string) {
    const p = parseLine(raw);
    this.line = p.line;
    this.vars = new Set(p.vars.map((v) => `$${v.slice(1)}`));
    this.isLabel = p.line.endsWith(':');
    this.re = new RegExp(`^${p.source}$`, 's');
  }

  /** Matches `line`, unifying with (and adding to) `vars`. */
  match(line: string, vars: Map<string, string>): boolean {
    const m = this.re.exec(line);
    if (m === null) return false;
    const add: [string, string][] = [];
    for (const [k, v] of Object.entries(m.groups ?? {})) {
      const key = `$${k.slice(1)}`;
      const old = vars.get(key);
      if (old !== undefined && old !== v) return false;
      add.push([key, v]);
    }
    for (const [k, v] of add) vars.set(k, v);
    return true;
  }
}

/** A template for one line: `ld $4, $3`. */
export class LineTemplate {
  readonly line: string;
  private readonly output: readonly string[];

  constructor(raw: string) {
    const p = parseLine(raw);
    this.line = p.line;
    this.output = p.output;
  }

  /** The variables the template uses. */
  get vars(): string[] {
    return this.output.filter((t) => RE_VAR_ONLY.test(t));
  }

  filter(vars: ReadonlyMap<string, string>): string {
    let out = '';
    for (const tok of this.output) {
      if (RE_VAR_ONLY.test(tok)) {
        const v = vars.get(tok);
        if (v === undefined) throw new RuleError('E575', `unbound variable ${tok}`);
        out += v;
      } else out += tok;
    }
    return out.trim();
  }
}

/** A block of patterns: the REPLACE region. */
export class BlockPattern {
  readonly patterns: readonly LinePattern[];
  readonly vars: ReadonlySet<string>;

  constructor(lines: readonly string[]) {
    this.patterns = lines
      .map((x) => x.trim())
      .filter((x) => x !== '')
      .map((x) => new LinePattern(x));
    const all = new Set<string>();
    for (const p of this.patterns) for (const v of p.vars) all.add(v);
    this.vars = all;
  }

  get length(): number {
    return this.patterns.length;
  }

  /** Matches the first `length` entries of `texts`; the bindings, or null. */
  match(texts: readonly string[]): Map<string, string> | null {
    if (texts.length < this.patterns.length) return null;
    const vars = new Map<string, string>();
    for (let i = 0; i < this.patterns.length; i++) {
      if (!(this.patterns[i] as LinePattern).match(texts[i] as string, vars)) return null;
    }
    return vars;
  }
}

/** A block of templates: the WITH region (empty lines are dropped from the output). */
export class BlockTemplate {
  readonly templates: readonly LineTemplate[];

  constructor(lines: readonly string[]) {
    this.templates = lines
      .map((x) => x.trim())
      .filter((x) => x !== '')
      .map((x) => new LineTemplate(x));
  }

  filter(vars: ReadonlyMap<string, string>): string[] {
    return this.templates.map((t) => t.filter(vars)).filter((x) => x !== '');
  }
}
