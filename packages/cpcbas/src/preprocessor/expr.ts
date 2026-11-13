/**
 * The `#if` expression evaluator.
 *
 * Integer expressions with C operators (`|| && ! == != < > <= >= + - * / % ( )`) and the BASIC words
 * `AND OR NOT` plus `=` and `<>`. An undefined name is 0; a macro defined with no value is 1; a macro
 * with a value is that value, evaluated as an expression. `defined(NAME)` and `defined NAME` both work.
 * This does not use the lexer: `|`, `&`, `!` and `%` mean other things to it.
 *
 * Precedence, loosest first: `||` `OR`; `&&` `AND`; `NOT` (BASIC, below comparison); `=` `==` `!=` `<>`;
 * `< > <= >= =< =>`; `+ -`; `* / %`; unary `- + !` (C, tight); primary.
 */

/** What the evaluator needs to know about macros. */
export interface ExprEnv {
  /** The macro's parameter list and body text, or undefined when it is not defined. */
  lookup(name: string): { readonly params: readonly string[] | null; readonly text: string } | undefined;
}

export type ExprResult = { readonly ok: true; readonly value: number } | { readonly ok: false; readonly message: string };

class ExprError extends Error {}

type ETok = { k: 'num'; v: number } | { k: 'id'; v: string } | { k: 'op'; v: string };

const NUMBER_RE = /^(0[xX][0-9a-fA-F]+|&[xX][01]+|&[hH]?[0-9a-fA-F]+|0[bB][01]+|[0-9]+)/;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*/;
const OPS2 = ['||', '&&', '==', '!=', '<>', '<=', '>=', '=<', '=>'];
const OPS1 = '!<>=+-*/%()';

function parseNumber(s: string): number {
  if (/^0[xX]/.test(s)) return parseInt(s.slice(2), 16);
  if (/^&[xX]/.test(s)) return parseInt(s.slice(2), 2);
  if (s[0] === '&') return parseInt(s.slice(/^&[hH]/.test(s) ? 2 : 1), 16);
  if (/^0[bB]/.test(s)) return parseInt(s.slice(2), 2);
  return parseInt(s, 10);
}

function tokenize(text: string): ETok[] {
  const out: ETok[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i] as string;
    if (c === ' ' || c === '\t') {
      i++;
      continue;
    }
    const rest = text.slice(i);
    const two = OPS2.find((o) => rest.startsWith(o));
    if (two) {
      out.push({ k: 'op', v: two });
      i += 2;
      continue;
    }
    const num = NUMBER_RE.exec(rest);
    if (num) {
      const after = rest[num[0].length];
      if (after !== undefined && /[A-Za-z0-9_.]/.test(after)) throw new ExprError(`bad number '${num[0]}${after}'`);
      out.push({ k: 'num', v: parseNumber(num[0]) });
      i += num[0].length;
      continue;
    }
    const id = IDENT_RE.exec(rest);
    if (id) {
      out.push({ k: 'id', v: id[0] });
      i += id[0].length;
      continue;
    }
    if (OPS1.includes(c)) {
      out.push({ k: 'op', v: c });
      i++;
      continue;
    }
    if (c === '"') throw new ExprError('a string cannot be used in #if');
    throw new ExprError(`unexpected '${c}'`);
  }
  return out;
}

/** Removes a trailing `'` comment and `_` line continuations from a directive's text. */
function clean(text: string): string {
  const joined = text.replace(/[ \t]_(?:\r\n|\r|\n)/g, ' ');
  const q = joined.indexOf("'");
  return q >= 0 ? joined.slice(0, q) : joined;
}

class Parser {
  private pos = 0;
  constructor(
    private readonly toks: ETok[],
    private readonly env: ExprEnv,
    private readonly active: readonly string[],
  ) {}

  run(): number {
    if (this.toks.length === 0) throw new ExprError('the expression is empty');
    const v = this.or();
    if (this.pos < this.toks.length) throw new ExprError(`unexpected '${this.show(this.toks[this.pos] as ETok)}'`);
    return v;
  }

  private show(t: ETok): string {
    return t.k === 'num' ? String(t.v) : t.v;
  }

  private peekOp(...ops: string[]): string | undefined {
    const t = this.toks[this.pos];
    if (!t) return undefined;
    if (t.k === 'op' && ops.includes(t.v)) return t.v;
    if (t.k === 'id') {
      const up = t.v.toUpperCase();
      if ((up === 'AND' || up === 'OR' || up === 'NOT') && ops.includes(up)) return up;
    }
    return undefined;
  }

  private or(): number {
    let l = this.and();
    while (this.peekOp('||', 'OR')) {
      this.pos++;
      const r = this.and();
      l = l !== 0 || r !== 0 ? 1 : 0;
    }
    return l;
  }

  private and(): number {
    let l = this.not();
    while (this.peekOp('&&', 'AND')) {
      this.pos++;
      const r = this.not();
      l = l !== 0 && r !== 0 ? 1 : 0;
    }
    return l;
  }

  private not(): number {
    if (this.peekOp('NOT')) {
      this.pos++;
      return this.not() === 0 ? 1 : 0;
    }
    return this.equality();
  }

  private equality(): number {
    let l = this.relational();
    for (;;) {
      const op = this.peekOp('=', '==', '!=', '<>');
      if (!op) return l;
      this.pos++;
      const r = this.relational();
      l = (op === '=' || op === '==' ? l === r : l !== r) ? 1 : 0;
    }
  }

  private relational(): number {
    let l = this.additive();
    for (;;) {
      const op = this.peekOp('<', '>', '<=', '>=', '=<', '=>');
      if (!op) return l;
      this.pos++;
      const r = this.additive();
      l = (op === '<' ? l < r : op === '>' ? l > r : op === '<=' || op === '=<' ? l <= r : l >= r) ? 1 : 0;
    }
  }

  private additive(): number {
    let l = this.multiplicative();
    for (;;) {
      const op = this.peekOp('+', '-');
      if (!op) return l;
      this.pos++;
      const r = this.multiplicative();
      l = op === '+' ? l + r : l - r;
    }
  }

  private multiplicative(): number {
    let l = this.unary();
    for (;;) {
      const op = this.peekOp('*', '/', '%');
      if (!op) return l;
      this.pos++;
      const r = this.unary();
      if (op === '*') l = l * r;
      else {
        if (r === 0) throw new ExprError('division by zero');
        l = op === '/' ? Math.trunc(l / r) : l % r;
      }
    }
  }

  private unary(): number {
    const op = this.peekOp('-', '+', '!');
    if (op) {
      this.pos++;
      const v = this.unary();
      return op === '-' ? -v : op === '+' ? v : v === 0 ? 1 : 0;
    }
    return this.primary();
  }

  private primary(): number {
    const t = this.toks[this.pos];
    if (!t) throw new ExprError('the expression ends too soon');
    this.pos++;
    if (t.k === 'num') return t.v;
    if (t.k === 'op') {
      if (t.v !== '(') throw new ExprError(`unexpected '${t.v}'`);
      const v = this.or();
      const close = this.toks[this.pos];
      if (!close || close.k !== 'op' || close.v !== ')') throw new ExprError("missing ')'");
      this.pos++;
      return v;
    }
    if (t.v === 'defined') return this.defined();
    return this.name(t.v);
  }

  private defined(): number {
    const t = this.toks[this.pos];
    if (t?.k === 'op' && t.v === '(') {
      const id = this.toks[this.pos + 1];
      const close = this.toks[this.pos + 2];
      if (id?.k !== 'id' || close?.k !== 'op' || close.v !== ')') throw new ExprError("defined( ) needs one name");
      this.pos += 3;
      return this.env.lookup(id.v) ? 1 : 0;
    }
    if (t?.k === 'id') {
      this.pos++;
      return this.env.lookup(t.v) ? 1 : 0;
    }
    throw new ExprError('defined needs a name');
  }

  private name(n: string): number {
    const def = this.env.lookup(n);
    if (!def) return 0;
    if (def.params) throw new ExprError(`the function-like macro '${n}' cannot be used in #if`);
    if (def.text.trim() === '') return 1;
    if (this.active.includes(n)) throw new ExprError(`macro '${n}' refers to itself`);
    return new Parser(tokenize(clean(def.text)), this.env, [...this.active, n]).run();
  }
}

/** Evaluates the text after `#if` / `#elif`. Never throws. */
export function evalIfExpression(text: string, env: ExprEnv): ExprResult {
  try {
    return { ok: true, value: new Parser(tokenize(clean(text)), env, []).run() };
  } catch (e) {
    if (e instanceof ExprError) return { ok: false, message: e.message };
    return { ok: false, message: 'the expression could not be read' };
  }
}
