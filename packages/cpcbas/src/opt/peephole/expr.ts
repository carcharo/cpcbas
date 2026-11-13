/**
 * The IF and DEFINE expressions of the rule language (L5-PEEP): a tokenizer, a parser and an evaluator.
 * A port of the fork's `evaluator.py` and the expression half of `parser.py` (zxbasic
 * src/arch/z80/peephole at e33cf0cd). The grammar and the precedences are the fork's; the parser is
 * a precedence-climbing one rather than the fork's tree rebalancing, and a variable's value is
 * always a string (a comma list evaluates to a list of values).
 *
 * Operators, tightest first: `.* ./`, `+ .+ .-`, `== <>`, `&&`, `||`, `IN`; prefix `!` and the
 * functions `IS_ASM IS_INDIR IS_REG16 IS_REG8 IS_LABEL IS_IMMED LEN INSTR HIREG LOREG HIVAL LOVAL GVAL
 * IS_REQUIRED CTEST NEEDS FLAGVAL OP1 OP2`. Values are strings; "" is false; a comparison gives "True"
 * or "". `NEEDS` here means "reads or writes" (see z80regs.ts).
 *
 * Two variables are set by the engine, not by the pattern: `$0` is "1" when every register is dead
 * after the window's last line (docs/ir.md "A dead register"), "" otherwise; `$00` is the template key
 * of the quad that emitted the window's last line (`add:u16`, `store:i16`).
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Ported from the fork's evaluator.py and parser.py, © Copyright 2008-2024 José Manuel Rodríguez de la Rosa and contributors.
 * See the file CONTRIBUTORS.md of zxbasic (https://github.com/boriel-basic/zxbasic) for copyright details.
 */

import { RuleError } from './pattern.js';
import { expandRegs, needs } from './z80regs.js';

export type Value = string | readonly Value[];

export type Expr =
  | { readonly t: 'lit'; readonly v: string }
  | { readonly t: 'var'; readonly name: string }
  | { readonly t: 'un'; readonly op: string; readonly e: Expr }
  | { readonly t: 'bin'; readonly op: string; readonly l: Expr; readonly r: Expr }
  | { readonly t: 'list'; readonly items: readonly Expr[] };

const UNARY_NAMES = [
  '!',
  'IS_ASM',
  'IS_INDIR',
  'IS_REG16',
  'IS_REG8',
  'IS_LABEL',
  'IS_IMMED',
  'LEN',
  'INSTR',
  'HIREG',
  'LOREG',
  'HIVAL',
  'LOVAL',
  'GVAL',
  'IS_REQUIRED',
  'CTEST',
  'NEEDS',
  'FLAGVAL',
  'OP1',
  'OP2',
] as const;
const UNARY = new Set<string>(UNARY_NAMES);

/** Binary operators with the fork's precedences (a lower number binds tighter). */
const PRECEDENCE: Readonly<Record<string, number>> = {
  '.*': 3,
  './': 3,
  '+': 5,
  '.+': 5,
  '.-': 5,
  '==': 10,
  '<>': 10,
  '&&': 15,
  '||': 20,
  IN: 25,
};

const OPERATOR_TOKENS = ['==', '<>', '&&', '||', '.+', '.-', '.*', './', '+', '!'];

interface Token {
  readonly kind: 'str' | 'word' | 'op' | '(' | ')' | ',';
  readonly text: string;
}

function tokenize(src: string, lineno: number): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i] as string;
    if (c === ' ' || c === '\t') {
      i++;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let text = '';
      for (;;) {
        if (j >= src.length) throw new RuleError('E574', `unterminated string in IF expression: ${src}`, lineno);
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            text += '"';
            j += 2;
            continue;
          }
          break;
        }
        text += src[j];
        j++;
      }
      out.push({ kind: 'str', text });
      i = j + 1;
      continue;
    }
    if (c === '(' || c === ')' || c === ',') {
      out.push({ kind: c, text: c });
      i++;
      continue;
    }
    const op = OPERATOR_TOKENS.find((o) => src.startsWith(o, i));
    if (op !== undefined) {
      out.push({ kind: 'op', text: op });
      i += op.length;
      continue;
    }
    const m = /^[^\s,"()!<>=&|+]+/.exec(src.slice(i));
    if (m === null) throw new RuleError('E574', `syntax error in IF expression at '${src.slice(i)}'`, lineno);
    out.push({ kind: 'word', text: m[0] });
    i += m[0].length;
  }
  return out;
}

/** Parses an IF or DEFINE expression; an empty one is true. */
export function parseExpr(src: string, lineno = 0): Expr {
  const tokens = tokenize(src, lineno);
  if (tokens.length === 0) return { t: 'lit', v: 'True' };
  let pos = 0;
  const fail = (what: string): never => {
    throw new RuleError('E574', `${what} in IF expression: ${src}`, lineno);
  };
  const peek = (): Token | undefined => tokens[pos];

  const primary = (): Expr => {
    const tok = tokens[pos++];
    if (tok === undefined) return fail('unexpected end');
    if (tok.kind === '(') {
      const items: Expr[] = [expr(100)];
      while (peek()?.kind === ',') {
        pos++;
        items.push(expr(100));
      }
      if (tokens[pos++]?.kind !== ')') return fail('unclosed parenthesis');
      return items.length === 1 ? (items[0] as Expr) : { t: 'list', items };
    }
    if (tok.kind === 'op' && tok.text === '!') return { t: 'un', op: '!', e: primary() };
    if (tok.kind === 'word' && UNARY.has(tok.text) && peek()?.kind === '(') return { t: 'un', op: tok.text, e: primary() };
    if (tok.kind === 'word' && UNARY.has(tok.text) && tok.text !== '!') {
      // A function name without an argument list: its operand is the next primary.
      return { t: 'un', op: tok.text, e: primary() };
    }
    if (tok.kind === 'word' && /^\$[0-9]+$/.test(tok.text)) return { t: 'var', name: tok.text };
    if (tok.kind === 'word' || tok.kind === 'str') return { t: 'lit', v: tok.text };
    return fail(`unexpected '${tok.text}'`);
  };

  const expr = (limit: number): Expr => {
    let left = primary();
    for (;;) {
      const tok = peek();
      if (tok === undefined) break;
      const name = tok.kind === 'op' || (tok.kind === 'word' && tok.text === 'IN') ? tok.text : null;
      if (name === null || name === '!') break;
      const prec = PRECEDENCE[name];
      if (prec === undefined) return fail(`unexpected operator '${name}'`);
      if (prec >= limit) break;
      pos++;
      const right = expr(prec);
      left = { t: 'bin', op: name, l: left, r: right };
    }
    return left;
  };

  const e = expr(100);
  if (pos < tokens.length) return fail(`unexpected '${(tokens[pos] as Token).text}'`);
  return e;
}

/** The variables of an expression. */
export function exprVars(e: Expr, into = new Set<string>()): Set<string> {
  switch (e.t) {
    case 'var':
      into.add(e.name);
      break;
    case 'un':
      exprVars(e.e, into);
      break;
    case 'bin':
      exprVars(e.l, into);
      exprVars(e.r, into);
      break;
    case 'list':
      e.items.forEach((x) => exprVars(x, into));
      break;
    default:
  }
  return into;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/**
 * Functions that need the CPU-state model of L5-FLOW (`GVAL`, `FLAGVAL`, `IS_REQUIRED`, `HIVAL`, `LOVAL`):
 * the engine's default answers are the fork's (`GVAL` and `FLAGVAL` make a fresh unknown, `IS_REQUIRED`
 * is true, `HIVAL`/`LOVAL` split a number or give a fresh unknown). The OLEVEL 3/4 rules are data until
 * L5-FLOW supplies a model.
 */
export interface EvalHooks {
  gval(x: string): string;
  isRequired(x: string): boolean;
}

let unknownCount = 0;
const DEFAULT_HOOKS: EvalHooks = {
  gval: () => `_u${++unknownCount}`,
  isRequired: () => true,
};

const truthy = (v: Value): boolean => (typeof v === 'string' ? v !== '' : v.length > 0);
const norm = (v: Value | boolean): Value => (v === true ? 'True' : v === false ? '' : typeof v === 'string' ? v : v.length === 0 ? '' : v);
const str = (v: Value): string => (typeof v === 'string' ? v : v.map(str).join(','));

function parseInt16(x: string): number | null {
  const s = x.trim().toUpperCase();
  if (s === '') return null;
  let m: RegExpExecArray | null;
  if ((m = /^0X([0-9A-F]+)$/.exec(s)) !== null) return parseInt(m[1] as string, 16);
  if ((m = /^([0-9][0-9A-F]*)H$/.exec(s)) !== null) return parseInt(m[1] as string, 16);
  if ((m = /^\$([0-9A-F]+)$/.exec(s)) !== null) return parseInt(m[1] as string, 16);
  if ((m = /^%([01]+)$/.exec(s)) !== null) return parseInt(m[1] as string, 2);
  if ((m = /^([01]+)B$/.exec(s)) !== null) return parseInt(m[1] as string, 2);
  if (/^-?[0-9]+$/.test(s)) return parseInt(s, 10);
  return null;
}

const HI: Readonly<Record<string, string>> = { af: 'a', bc: 'b', de: 'd', hl: 'h', ix: 'ixh', iy: 'iyh' };
const LO: Readonly<Record<string, string>> = { af: 'f', bc: 'c', de: 'e', hl: 'l', ix: 'ixl', iy: 'iyl' };
const REG16 = new Set(['af', 'bc', 'de', 'hl', 'ix', 'iy']);
const REG8 = new Set(['a', 'b', 'c', 'd', 'e', 'h', 'l', 'ixh', 'ixl', 'iyh', 'iyl']);
const RE_IXIY_IDX = /^\([ \t]*i[xy][ \t]*[-+][ \t]*.+\)$/;
const CONDITIONS = new Set(['nz', 'z', 'nc', 'c', 'po', 'pe', 'p', 'm']);

function operand(x: string, n: number): string {
  const parts = x.trim().replace(',', ' ').split(/\s+/);
  return parts[n] ?? '';
}

/** The condition flag an instruction needs to execute (`jp z, x` gives `z`, `ret nc` gives `nc`), or "". */
function ctest(x: string): string {
  const m = /^(jp|jr|call|ret)\s+([a-z]+)\b/i.exec(x.trim());
  if (m === null) return '';
  const cc = (m[2] as string).toLowerCase();
  return CONDITIONS.has(cc) && (m[1]?.toLowerCase() === 'ret' || /,/.test(x)) ? cc : '';
}

function applyUnary(op: string, v: Value, hooks: EvalHooks): Value {
  if (op === 'NEEDS') {
    if (typeof v === 'string' || v.length !== 2) throw new RuleError('E575', 'NEEDS takes (instruction, (registers))');
    const regs = v[1] as Value;
    return norm(needs(str(v[0] as Value), typeof regs === 'string' ? regs : regs.map(str)));
  }
  const x = str(v);
  switch (op) {
    case '!':
      return norm(!truthy(v));
    case 'IS_ASM':
      return norm(x.startsWith('##ASM'));
    case 'IS_INDIR':
      return norm(RE_IXIY_IDX.test(x));
    case 'IS_REG16':
      return norm(REG16.has(x.trim().toLowerCase()));
    case 'IS_REG8':
      return norm(REG8.has(x.trim().toLowerCase()));
    case 'IS_LABEL':
      return norm(x.trim().endsWith(':'));
    case 'IS_IMMED':
      return norm(!x.trim().startsWith('('));
    case 'LEN':
      return String(x.split(/\s+/).filter((s) => s !== '').length);
    case 'INSTR':
      return x.trim().split(/\s+/)[0] ?? '';
    case 'HIREG':
      return HI[x.trim().toLowerCase()] ?? '';
    case 'LOREG':
      return LO[x.trim().toLowerCase()] ?? '';
    case 'HIVAL': {
      const n = parseInt16(x);
      return n === null ? hooks.gval(x) : String((n >> 8) & 0xff);
    }
    case 'LOVAL': {
      const n = parseInt16(x);
      return n === null ? hooks.gval(x) : String(n & 0xff);
    }
    case 'GVAL':
    case 'FLAGVAL':
      return hooks.gval(x);
    case 'IS_REQUIRED':
      return norm(hooks.isRequired(x));
    case 'CTEST':
      return ctest(x);
    case 'OP1':
      return operand(x, 1);
    case 'OP2':
      return operand(x, 2);
    default:
      throw new RuleError('E575', `unknown function '${op}'`);
  }
}

function num(v: Value): number | null {
  return parseInt16(str(v));
}

function arith(op: string, l: Value, r: Value): Value {
  const a = num(l);
  const b = num(r);
  if (a === null || b === null) return '';
  switch (op) {
    case '.+':
      return String(a + b);
    case '.-':
      return String(a - b);
    case '.*':
      return String(a * b);
    default:
      return b === 0 ? '' : String(Math.trunc(a / b));
  }
}

/** Evaluates `e` with the variables of a match. An unbound variable is E575. */
export function evaluate(e: Expr, vars: ReadonlyMap<string, string>, hooks: EvalHooks = DEFAULT_HOOKS): Value {
  switch (e.t) {
    case 'lit':
      return e.v;
    case 'var': {
      const v = vars.get(e.name);
      if (v === undefined) throw new RuleError('E575', `unbound variable '${e.name}'`);
      return v;
    }
    case 'un':
      return norm(applyUnary(e.op, evaluate(e.e, vars, hooks), hooks));
    case 'list':
      return e.items.map((x) => evaluate(x, vars, hooks));
    case 'bin': {
      switch (e.op) {
        case '&&': {
          const l = evaluate(e.l, vars, hooks);
          return truthy(l) ? norm(evaluate(e.r, vars, hooks)) : '';
        }
        case '||': {
          const l = evaluate(e.l, vars, hooks);
          return truthy(l) ? norm(l) : norm(evaluate(e.r, vars, hooks));
        }
        case '==':
          return norm(equal(evaluate(e.l, vars, hooks), evaluate(e.r, vars, hooks)));
        case '<>':
          return norm(!equal(evaluate(e.l, vars, hooks), evaluate(e.r, vars, hooks)));
        case '+':
          return str(evaluate(e.l, vars, hooks)) + str(evaluate(e.r, vars, hooks));
        case 'IN': {
          const l = evaluate(e.l, vars, hooks);
          const r = evaluate(e.r, vars, hooks);
          if (typeof r === 'string') return norm(typeof l === 'string' && r.includes(l));
          return norm(r.some((x) => equal(x, l)));
        }
        default:
          return arith(e.op, evaluate(e.l, vars, hooks), evaluate(e.r, vars, hooks));
      }
    }
  }
}

function equal(a: Value, b: Value): boolean {
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  return a.length === b.length && a.every((x, i) => equal(x, b[i] as Value));
}

/** Whether an IF's result is true. */
export function isTrue(v: Value): boolean {
  return truthy(v);
}

export { expandRegs };
