/**
 * The rule file format (L5-PEEP): `OLEVEL`, `OFLAG`, and the regions `REPLACE`, `WITH`, `IF`, `DEFINE`.
 * A port of the fork's `parser.py` `parse_str` (zxbasic src/arch/z80/peephole at e33cf0cd). Lines
 * starting with `;;` between regions are comments. A malformed file is a {@link RuleError}:
 * E574 for the file's syntax and E575 for what it says (an unbound or doubly defined variable, an
 * unknown function), which `tools/gen-rules.mjs` reports at generation time.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Ported from the fork's parser.py, © Copyright 2008-2024 José Manuel Rodríguez de la Rosa and contributors.
 * See the file CONTRIBUTORS.md of zxbasic (https://github.com/boriel-basic/zxbasic) for copyright details.
 */

import { exprVars, parseExpr, type Expr } from './expr.js';
import { BlockPattern, BlockTemplate, RuleError } from './pattern.js';

/** A parsed rule. */
export interface Rule {
  /** The `--opt-disable` name: the file's stem (`000_o1_push_pop`). */
  readonly name: string;
  readonly level: number;
  readonly flag: number;
  readonly replace: BlockPattern;
  readonly with: BlockTemplate;
  readonly cond: Expr;
  readonly defines: readonly { readonly name: string; readonly expr: Expr }[];
}

const RE_REGION = /^([_a-zA-Z][a-zA-Z0-9]*)[ \t]*\{\{$/;
const RE_DEF = /^([_a-zA-Z][a-zA-Z0-9]*)[ \t]*:[ \t]*(.*)$/;
const REGIONS = new Set(['IF', 'WITH', 'REPLACE', 'DEFINE']);
const SCALARS = new Set(['OFLAG', 'OLEVEL']);
const ENGINE_VARS = ['$0', '$00'];

/** The stem rule names must have (`--opt-disable` names are `[a-z0-9][a-z0-9_-]*`). */
export const RE_RULE_NAME = /^[a-z0-9][a-z0-9_-]*$/;

/** Parses the text of one rule file. */
export function parseRule(name: string, text: string): Rule {
  const bad = (code: 'E574' | 'E575', message: string, line?: number): never => {
    throw new RuleError(code, `${name}: ${message}${line !== undefined ? ` (line ${line})` : ''}`, line);
  };
  if (!RE_RULE_NAME.test(name)) bad('E574', `the rule name must match ${RE_RULE_NAME.source}`);

  const regions = new Map<string, { line: number; text: string }[]>();
  const scalars = new Map<string, number>();
  let region: string | null = null;
  let lineNo = 0;
  for (const raw of text.split('\n')) {
    lineNo++;
    let line = raw.trim();
    if (line === '') continue;
    if (region === null) {
      if (line.startsWith(';;')) continue;
      let m = RE_REGION.exec(line);
      if (m !== null) {
        region = (m[1] as string).toUpperCase();
        if (!REGIONS.has(region)) bad('E574', `unknown region '${m[1] as string}'`, lineNo);
        if (regions.has(region)) bad('E574', `duplicated definition ${region}`, lineNo);
        regions.set(region, []);
        continue;
      }
      m = RE_DEF.exec(line);
      if (m !== null) {
        const key = (m[1] as string).toUpperCase();
        if (!SCALARS.has(key)) bad('E574', `unknown definition parameter '${key}'`, lineNo);
        if (scalars.has(key)) bad('E574', `duplicated definition ${key}`, lineNo);
        if (!/^\d+$/.test(m[2] as string)) bad('E574', `field ${key} must be an integer`, lineNo);
        scalars.set(key, Number(m[2]));
        continue;
      }
      bad('E574', 'syntax error', lineNo);
    }
    let ends = false;
    if (line.endsWith('}}')) {
      line = line.slice(0, -2).trim();
      ends = true;
    }
    if (line !== '') (regions.get(region as string) as { line: number; text: string }[]).push({ line: lineNo, text: line });
    if (ends) region = null;
  }
  if (region !== null) bad('E574', `region ${region} is not closed`);

  for (const key of ['REPLACE', 'WITH']) if (!regions.has(key)) bad('E574', `undefined section ${key}`);
  for (const key of ['OLEVEL', 'OFLAG']) if (!scalars.has(key)) bad('E574', `undefined section ${key}`);
  const texts = (key: string): string[] => (regions.get(key) ?? []).map((x) => x.text);
  if (texts('REPLACE').length === 0) bad('E574', 'empty region REPLACE');

  let replace: BlockPattern;
  let template: BlockTemplate;
  let cond: Expr;
  const defines: { name: string; expr: Expr }[] = [];
  try {
    replace = new BlockPattern(texts('REPLACE'));
    template = new BlockTemplate(texts('WITH'));
    const ifLine = (regions.get('IF') ?? [])[0]?.line ?? 0;
    cond = parseExpr(texts('IF').join(' '), ifLine);
    for (const d of regions.get('DEFINE') ?? []) {
      const eq = d.text.indexOf('=');
      if (eq < 0) bad('E574', "assignation '=' not found", d.line);
      const v = d.text.slice(0, eq).trim();
      if (!/^\$[0-9]+$/.test(v)) bad('E574', `'${v}' is not a variable name`, d.line);
      if (defines.some((x) => x.name === v)) bad('E574', `duplicated variable '${v}'`, d.line);
      defines.push({ name: v, expr: parseExpr(d.text.slice(eq + 1), d.line) });
    }
  } catch (e) {
    if (e instanceof RuleError) throw new RuleError(e.code, `${name}: ${e.message}`, e.line);
    throw e;
  }

  const bound = new Set<string>([...replace.vars, ...ENGINE_VARS]);
  for (const d of defines) {
    if (replace.vars.has(d.name)) bad('E575', `variable '${d.name}' is already defined in the pattern`);
    for (const v of exprVars(d.expr)) if (!bound.has(v)) bad('E575', `DEFINE ${d.name} uses the unbound variable ${v}`);
    bound.add(d.name);
  }
  for (const v of exprVars(cond)) if (!bound.has(v)) bad('E575', `IF uses the unbound variable ${v}`);
  for (const t of template.templates) for (const v of t.vars) if (!bound.has(v)) bad('E575', `WITH uses the unbound variable ${v}`);

  return {
    name,
    level: scalars.get('OLEVEL') as number,
    flag: scalars.get('OFLAG') as number,
    replace,
    with: template,
    cond,
    defines,
  };
}
