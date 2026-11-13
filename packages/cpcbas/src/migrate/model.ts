/**
 * The structure `cpcbas migrate` reads from a file: logical lines (continuations joined), the statements of
 * each line, and a tolerant expression parser for the rules that need operand extents (W728, W729, W733,
 * W735, W736). Nothing here throws on odd input: a parse that fails returns `null` and the rule skips.
 */
import { tokenize, type Tok } from './tokenize.js';

export interface Stmt {
  /** Range `[lo, hi)` of positions in the line's `sig` array. */
  readonly lo: number;
  readonly hi: number;
}

export interface Line {
  /** Indexes into the file's `toks` of the significant tokens of this logical line (no whitespace, comments, continuations or line ends). */
  readonly sig: number[];
  readonly stmts: Stmt[];
}

export interface FileModel {
  readonly path: string;
  readonly text: string;
  readonly toks: Tok[];
  readonly lines: Line[];
}

/**
 * `asm`: the file is assembly (it is included inside an ASM block), so its whole text is one ASM body: only the ASM
 * rules (W703 and W702's renames of `_name` labels) apply, never a BASIC rule (`in a, (c)` is not `INP`).
 */
export function buildModel(path: string, text: string, asm = false): FileModel {
  const toks: Tok[] = asm ? (text === '' ? [] : [{ kind: 'asm', text, start: 0, end: text.length }]) : tokenize(text);
  const lines: Line[] = [];
  let cur: number[] = [];
  const flush = (): void => {
    if (cur.length > 0) lines.push({ sig: cur, stmts: splitStatements(toks, cur) });
    cur = [];
  };
  for (let i = 0; i < toks.length; i++) {
    const k = (toks[i] as Tok).kind;
    if (k === 'nl') flush();
    else if (k !== 'ws' && k !== 'cont' && k !== 'comment') cur.push(i);
  }
  flush();
  return { path, text, toks, lines };
}

export const up = (t: Tok | undefined): string => (t === undefined ? '' : t.text.toUpperCase());

/** Words that cannot be a label even when a colon follows (statement keywords of both dialects). */
function isOpen(t: Tok): boolean {
  return t.kind === 'op' && (t.text === '(' || t.text === '{');
}
function isClose(t: Tok): boolean {
  return t.kind === 'op' && (t.text === ')' || t.text === '}');
}

/** Splits a logical line at `:` (outside brackets), after `THEN`, and around `ELSE`. A leading line number or `label:` is its own statement. */
export function splitStatements(toks: readonly Tok[], sig: readonly number[]): Stmt[] {
  const stmts: Stmt[] = [];
  const t = (p: number): Tok => toks[sig[p] as number] as Tok;
  const n = sig.length;
  let start = 0;
  let depth = 0;
  if (n > 0 && t(0).kind === 'pp') return [{ lo: 0, hi: n }];
  // a line number
  if (n > 0 && t(0).kind === 'num' && /^[0-9]+$/.test(t(0).text) && n > 1) {
    stmts.push({ lo: 0, hi: 1 });
    start = 1;
  }
  // a label: `name:` at the start, the name not a keyword (the caller decides about reserved words)
  if (start < n && t(start).kind === 'word' && start + 1 < n && t(start + 1).kind === 'op' && t(start + 1).text === ':' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(t(start).text) && !LABEL_BLOCK.has(t(start).text.toUpperCase())) {
    stmts.push({ lo: start, hi: start + 2 });
    start += 2;
  }
  const close = (end: number): void => {
    if (end > start) stmts.push({ lo: start, hi: end });
  };
  for (let p = start; p < n; p++) {
    const tk = t(p);
    if (isOpen(tk)) depth++;
    else if (isClose(tk)) depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      if (tk.kind === 'op' && tk.text === ':') {
        close(p);
        start = p + 1;
      } else if (tk.kind === 'word') {
        const u = tk.text.toUpperCase();
        if (u === 'THEN') {
          close(p + 1);
          start = p + 1;
        } else if (u === 'ELSE') {
          close(p);
          stmts.push({ lo: p, hi: p + 1 });
          start = p + 1;
        }
      }
    }
  }
  close(n);
  return stmts;
}

/** Words that never start a label (the keywords of the statements a colon can follow). */
const LABEL_BLOCK = new Set([
  'CLS', 'END', 'ELSE', 'RETURN', 'STOP', 'CONTINUE', 'EXIT', 'LOOP', 'DO', 'NEXT', 'WEND', 'ENDIF', 'ASM', 'RANDOMIZE', 'BEEP', 'RESTORE', 'THEN',
  'CLG', 'CLEAR', 'RUN', 'CONT', 'CAT', 'DI', 'EI', 'FRAME', 'TAGOFF', 'TAG', 'CLOSEIN', 'CLOSEOUT', 'GRAPHICS', 'WAITVSYNC', 'WAIT', 'RELEASE',
]);

// --------------------------------------------------------------------- expressions

export type NodeKind = 'num' | 'str' | 'name' | 'paren' | 'un' | 'bin' | 'fnp' | 'at' | 'range' | 'bad';

export interface Node {
  readonly k: NodeKind;
  /** Range `[lo, hi)` of positions in the line's `sig` array. */
  readonly lo: number;
  readonly hi: number;
  /** `bin`/`un`: the operator token's position. `name`: the position of the name. */
  readonly op?: number;
  readonly kids: Node[];
  /** `name`: groups of `( ... )` that follow it, each as a list of arguments. */
  readonly groups?: Node[][];
}

const FNP = new Set([
  'CHR$', 'CHR', 'STR$', 'STR', 'CODE', 'LEN', 'PEEK', 'SIN', 'COS', 'TAN', 'ATN', 'ASN', 'ACS', 'EXP', 'LN', 'SQR', 'SGN', 'INT', 'ABS', 'VAL', 'IN', 'USR', 'TAB',
]);
export const PARENLESS_FUNCTIONS: ReadonlySet<string> = FNP;

const PREC: Record<string, number> = {
  OR: 1, XOR: 2, AND: 3,
  '=': 5, '<>': 5, '<': 5, '>': 5, '<=': 5, '>=': 5,
  BOR: 6, BXOR: 6, BAND: 7,
  SHL: 8, SHR: 8, '<<': 8, '>>': 8,
  '+': 9, '-': 9, MOD: 10, '*': 11, '/': 11, '\\': 11, '^': 13,
};
export const COMPARE_OPS: ReadonlySet<string> = new Set(['=', '<>', '<', '>', '<=', '>=']);

export class ExprParser {
  constructor(
    readonly toks: readonly Tok[],
    readonly sig: readonly number[],
    /** Lower-case names the project declares itself (a word in it is not respelled or given an operand). */
    readonly declared: ReadonlySet<string>,
    public pos: number,
    readonly end: number,
  ) {}

  tok(p: number = this.pos): Tok | undefined {
    return p < this.end ? (this.toks[this.sig[p] as number] as Tok) : undefined;
  }

  private isOp(text: string, p: number = this.pos): boolean {
    const t = this.tok(p);
    return t !== undefined && t.kind === 'op' && t.text === text;
  }

  private word(p: number = this.pos): string {
    const t = this.tok(p);
    return t !== undefined && t.kind === 'word' ? t.text.toUpperCase() : '';
  }

  /** The operator at the cursor, if it is a binary operator of the given minimum precedence. */
  private binOp(minPrec: number): { text: string; prec: number } | undefined {
    const t = this.tok();
    if (t === undefined) return undefined;
    let key: string;
    if (t.kind === 'op') key = t.text;
    else if (t.kind === 'word') key = t.text.toUpperCase();
    else return undefined;
    const prec = PREC[key];
    if (prec === undefined || prec < minPrec) return undefined;
    if (t.kind === 'word' && this.declared.has(t.text.toLowerCase())) return undefined;
    return { text: key, prec };
  }

  parseExpr(minPrec = 1): Node | null {
    let left = this.parseUnary(minPrec);
    if (left === null) return null;
    for (;;) {
      const op = this.binOp(minPrec);
      if (op === undefined) break;
      const opPos = this.pos;
      this.pos++;
      // `^` is right associative; the rest are left associative
      const right = this.parseExpr(op.text === '^' ? op.prec : op.prec + 1);
      if (right === null) return null;
      left = { k: 'bin', lo: left.lo, hi: right.hi, op: opPos, kids: [left, right] };
    }
    return left;
  }

  private parseUnary(minPrec: number): Node | null {
    const t = this.tok();
    if (t === undefined) return null;
    const w = t.kind === 'word' ? t.text.toUpperCase() : '';
    const lo = this.pos;
    if (w === 'NOT' && !this.declared.has('not')) {
      // NOT binds looser than a comparison and tighter than AND
      this.pos++;
      const operand = this.parseExpr(Math.max(minPrec, 5));
      if (operand === null) return null;
      return { k: 'un', lo, hi: operand.hi, op: lo, kids: [operand] };
    }
    if (w === 'BNOT') {
      this.pos++;
      const operand = this.parseExpr(12);
      if (operand === null) return null;
      return { k: 'un', lo, hi: operand.hi, op: lo, kids: [operand] };
    }
    if (t.kind === 'op' && (t.text === '-' || t.text === '+')) {
      this.pos++;
      const operand = this.parseExpr(12);
      if (operand === null) return null;
      return { k: 'un', lo, hi: operand.hi, op: lo, kids: [operand] };
    }
    return this.parsePrimary();
  }

  /** One operand as a paren-less function takes it: a signed primary, a function with its own operand. */
  parseOperand(): Node | null {
    const t = this.tok();
    if (t !== undefined && t.kind === 'op' && (t.text === '-' || t.text === '+')) {
      const lo = this.pos;
      this.pos++;
      const o = this.parseOperand();
      return o === null ? null : { k: 'un', lo, hi: o.hi, op: lo, kids: [o] };
    }
    return this.parsePrimary();
  }

  private parseArgs(): Node[] | null {
    // at '('
    this.pos++;
    const args: Node[] = [];
    if (this.isOp(')')) {
      this.pos++;
      return args;
    }
    for (;;) {
      const a = this.parseArg();
      if (a === null) return null;
      args.push(a);
      if (this.isOp(',')) {
        this.pos++;
        continue;
      }
      if (this.isOp(')')) {
        this.pos++;
        return args;
      }
      return null;
    }
  }

  /** An argument: an expression, or a slice `a TO b`, `TO b`, `a TO`. */
  private parseArg(): Node | null {
    const lo = this.pos;
    if (this.word() === 'TO') {
      this.pos++;
      if (this.isOp(')') || this.isOp(',')) return { k: 'range', lo, hi: this.pos, kids: [] };
      const e = this.parseExpr();
      return e === null ? null : { k: 'range', lo, hi: e.hi, kids: [e] };
    }
    const e = this.parseExpr();
    if (e === null) return null;
    if (this.word() === 'TO') {
      this.pos++;
      if (this.isOp(')') || this.isOp(',')) return { k: 'range', lo, hi: this.pos, kids: [e] };
      const f = this.parseExpr();
      return f === null ? null : { k: 'range', lo, hi: f.hi, kids: [e, f] };
    }
    return e;
  }

  private parsePrimary(): Node | null {
    const t = this.tok();
    if (t === undefined) return null;
    const lo = this.pos;
    if (t.kind === 'num') {
      this.pos++;
      return { k: 'num', lo, hi: this.pos, kids: [] };
    }
    if (t.kind === 'str') {
      this.pos++;
      return { k: 'str', lo, hi: this.pos, kids: [] };
    }
    if (t.kind === 'op' && t.text === '(') {
      this.pos++;
      const e = this.parseExpr();
      if (e === null || !this.isOp(')')) return null;
      this.pos++;
      return { k: 'paren', lo, hi: this.pos, kids: [e] };
    }
    if (t.kind === 'op' && t.text === '@') {
      this.pos++;
      const nameTok = this.tok();
      if (nameTok === undefined || nameTok.kind !== 'word') return null;
      this.pos++;
      // @a(3): an element's address
      const groups: Node[][] = [];
      while (this.isOp('(')) {
        const g = this.parseArgs();
        if (g === null) return null;
        groups.push(g);
      }
      return { k: 'at', lo, hi: this.pos, kids: groups.flat(), groups };
    }
    if (t.kind === 'word') {
      const u = t.text.toUpperCase();
      const lower = t.text.toLowerCase();
      this.pos++;
      if (FNP.has(u) && !this.declared.has(lower) && !this.isOp('(')) {
        const operand = this.parseOperand();
        if (operand === null) return null;
        return { k: 'fnp', lo, hi: operand.hi, op: lo, kids: [operand] };
      }
      const groups: Node[][] = [];
      while (this.isOp('(')) {
        const g = this.parseArgs();
        if (g === null) return null;
        groups.push(g);
      }
      return { k: 'name', lo, hi: this.pos, op: lo, kids: groups.flat(), groups };
    }
    return null;
  }
}

/** Position of the `)` that closes the `(` at `open`, or -1. */
export function matchParen(toks: readonly Tok[], sig: readonly number[], open: number, end: number = sig.length): number {
  let depth = 0;
  for (let p = open; p < end; p++) {
    const t = toks[sig[p] as number] as Tok;
    if (t.kind !== 'op') continue;
    if (t.text === '(') depth++;
    else if (t.text === ')') {
      depth--;
      if (depth === 0) return p;
    }
  }
  return -1;
}
