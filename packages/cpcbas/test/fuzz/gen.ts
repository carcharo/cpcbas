/**
 * L5-DIFF layer 2: a seeded generator of random, terminating programs for the optimisation differential (test/opt-fuzz.test.ts,
 * `npm run fuzz:opt`). The same seed always gives the same program.
 *
 * What it covers:
 * - integer expressions of every integer type (BYTE, UBYTE, INTEGER, UINTEGER, LONG, ULONG), wrapping on assignment, shifts,
 *   AND/OR/XOR/NOT, the `\` and MOD sign rules (the divisor is always `(e AND 7) + 1`, so no program divides by zero);
 * - comparisons, which are -1 or 0 and combine with AND/OR/NOT;
 * - IF/ELSE, FOR (literal, computed, negative and variable STEP), WHILE (counter-bounded), EXIT FOR/WHILE, GOSUB/RETURN
 *   (acyclic), SUB and FUNCTION with parameters and locals (calls only go to earlier procedures);
 * - integer and string arrays, small strings (LEN, LEFT$, MID$, CHR$, STR$, concatenation, comparison);
 * - PEEK/POKE through a variable pointer, including em00k's bug 1 (`p = @x : x = 1 : POKE p, 2 : r = x`), and adjacent
 *   globals written as words and as bytes, including bug 4 (`x = 1 - x : F(1 - x)`): the UBYTE block m0..m7 and the UINTEGER
 *   block n0..n3 are declared next to each other and are poked as bytes and as words at computed offsets; and bug 4 in this
 *   dialect (R17): a byte of a word poked, the word stored, the byte read back.
 *
 * Termination: every loop has a small bound the body cannot change (loop, step and counter variables are never assigned by the
 * body), and a work budget caps the statements a program can execute.
 *
 * A program is a tree of nodes so that the shrinker (shrink.ts) can delete statements and unwrap blocks.
 */

export type Node = string | Block;
export interface Block {
  readonly head: string;
  readonly body: Node[];
  /** An ELSE part. */
  readonly other?: Node[];
  readonly tail: string;
}
export interface Proc {
  readonly head: string;
  readonly locals: string[];
  readonly body: Node[];
  readonly tail: string;
}
export interface FuzzProgram {
  readonly seed: number;
  readonly decls: string[];
  readonly procs: Proc[];
  readonly main: Node[];
  /** GOSUB targets, after END: label and body (RETURN is added). */
  readonly subs: { readonly label: string; readonly body: Node[] }[];
}

/** mulberry32: small, fast, deterministic. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(xs: readonly T[]): T {
    return xs[this.int(xs.length)] as T;
  }
}

type IntType = 'BYTE' | 'UBYTE' | 'INTEGER' | 'UINTEGER' | 'LONG' | 'ULONG';
interface Var {
  readonly name: string;
  readonly type: IntType;
}

const M = ['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'];
const N = ['n0', 'n1', 'n2', 'n3'];
const GLOBALS: Var[] = [
  ...M.map((name): Var => ({ name, type: 'UBYTE' })),
  ...N.map((name): Var => ({ name, type: 'UINTEGER' })),
  { name: 'b0', type: 'BYTE' },
  { name: 'b1', type: 'BYTE' },
  { name: 'i0', type: 'INTEGER' },
  { name: 'i1', type: 'INTEGER' },
  { name: 'i2', type: 'INTEGER' },
  { name: 'l0', type: 'LONG' },
  { name: 'l1', type: 'LONG' },
  { name: 'u0', type: 'ULONG' },
  { name: 'u1', type: 'ULONG' },
];
const SIZE: Record<IntType, number> = { BYTE: 1, UBYTE: 1, INTEGER: 2, UINTEGER: 2, LONG: 4, ULONG: 4 };
const LITERALS = ['0', '1', '2', '3', '7', '10', '100', '127', '128', '255', '256', '1000', '32767', '65535', '70000', '-1', '-2', '-128', '-129', '-32768', '-32769'];
const INT_TYPES: IntType[] = ['BYTE', 'UBYTE', 'INTEGER', 'UINTEGER', 'LONG', 'ULONG'];

interface Callable {
  readonly name: string;
  readonly nParams: number;
  readonly isFunction: boolean;
  /** Statements one call can execute, an upper bound. */
  readonly cost: number;
}

/** The scope a block of statements is generated in. */
interface Scope {
  /** Variables that may be assigned and read. */
  readonly vars: Var[];
  /** Read only (loop variables and the like). */
  readonly reads: string[];
  readonly callables: Callable[];
  /** Procedures use their own loop, step and counter variables. */
  readonly prefix: string;
  /** The names of the labels this block may GOSUB. */
  readonly gosubs: string[];
  readonly inProc: boolean;
}

class Gen {
  /** Statements still allowed to execute, an upper bound counting loop multiplicities. */
  budget = 30000;
  constructor(readonly rng: Rng) {}

  lit(): string {
    return this.rng.chance(0.8) ? this.rng.pick(LITERALS) : String(this.rng.int(2000) - 1000);
  }

  atom(sc: Scope, d: number): string {
    const r = this.rng;
    const k = r.int(20);
    if (k < 8) return r.pick(sc.vars).name;
    if (k < 11) return this.lit();
    if (k < 12 && sc.reads.length > 0) return r.pick(sc.reads);
    if (k < 14) return `ia(${this.idx(sc, d, 7)})`;
    if (k < 15) return `ba(${this.idx(sc, d, 7)})`;
    if (k < 16) return `LEN(${this.str(sc, d)})`;
    if (k < 17) return `PEEK(@m0 + ${this.idx(sc, d, 7)})`;
    if (k < 18) return `PEEK(UINTEGER, @n0 + ${this.idx(sc, d, 6)})`;
    const fns = sc.callables.filter((c) => c.isFunction);
    if (k < 19 && fns.length > 0 && d > 0) return this.call(sc, d, r.pick(fns));
    return r.pick(sc.vars).name;
  }

  /** `(e AND mask)`: an index or an offset in 0..mask. */
  idx(sc: Scope, d: number, mask: number): string {
    return `(${this.expr(sc, Math.min(d, 1))} AND ${mask})`;
  }

  call(sc: Scope, d: number, c: Callable): string {
    this.budget -= c.cost;
    const args = Array.from({ length: c.nParams }, () => this.expr(sc, Math.min(d, 1) - 1));
    return `${c.name}(${args.join(', ')})`;
  }

  expr(sc: Scope, d: number): string {
    const r = this.rng;
    if (d <= 0 || r.chance(0.2)) return this.atom(sc, 0);
    const k = r.int(30);
    const a = (): string => this.expr(sc, d - 1);
    if (k < 8) return `(${a()} ${r.pick(['+', '-', '*'])} ${a()})`;
    if (k < 12) return `(${a()} ${r.pick(['AND', 'OR', 'XOR'])} ${a()})`;
    if (k < 14) return `(${a()} \\ ((${a()} AND 7) + 1))`;
    if (k < 16) return `(${a()} MOD ((${a()} AND 7) + 1))`;
    if (k < 18) return `(${a()} ${r.pick(['<<', '>>'])} ${r.int(8)})`;
    if (k < 21) return `(${a()} ${r.pick(['=', '<>', '<', '>', '<=', '>='])} ${a()})`;
    if (k < 23) return `(-${a()})`;
    if (k < 25) return `(NOT ${a()})`;
    if (k < 26) return `((${a()} ${r.pick(['<', '>', '=', '<>'])} ${a()}) ${r.pick(['AND', 'OR'])} (${a()} ${r.pick(['<', '>', '='])} ${a()}))`;
    if (k < 27) return `(${this.str(sc, d - 1)} ${r.pick(['=', '<>', '<', '>'])} ${this.str(sc, d - 1)})`;
    if (k < 28) return `ABS(${a()})`;
    return this.atom(sc, d);
  }

  /** A short string expression. */
  str(sc: Scope, d: number): string {
    const r = this.rng;
    const k = r.int(10);
    if (d <= 0 || k < 3) return r.pick(['s0', 's1', '"ab"', '"x"', '""', '"hello"', `sa(${this.idx(sc, 0, 3)})`]);
    if (k < 5) return `CHR$(65 + ${this.idx(sc, 1, 15)})`;
    if (k < 6) return `LEFT$(${this.str(sc, d - 1)}, ${this.idx(sc, 1, 5)})`;
    if (k < 7) return `MID$(${this.str(sc, d - 1)}, ${this.idx(sc, 1, 3)} + 1, ${this.idx(sc, 1, 3)})`;
    if (k < 8) return `STR$(${this.expr(sc, 1)})`;
    return `LEFT$(${this.str(sc, d - 1)} + ${this.str(sc, d - 1)}, 8)`;
  }

  /** `count` statements in `sc`, `mult` being how often each can run. */
  stmts(sc: Scope, count: number, depth: number, mult: number, loop: 'for' | 'while' | null): Node[] {
    const out: Node[] = [];
    for (let i = 0; i < count; i++) out.push(...this.stmt(sc, depth, mult, loop));
    return out;
  }

  stmt(sc: Scope, depth: number, mult: number, loop: 'for' | 'while' | null): Node[] {
    const r = this.rng;
    this.budget -= mult;
    const simple = depth >= 3 || this.budget < 200 * mult;
    const k = r.int(simple ? 14 : 30);
    const x = (): Var => r.pick(sc.vars);
    if (k < 5) return [`${x().name} = ${this.expr(sc, 3)}`];
    if (k < 6) return [`ia(${this.idx(sc, 1, 7)}) = ${this.expr(sc, 2)}`];
    if (k < 7) return [`ba(${this.idx(sc, 1, 7)}) = ${this.expr(sc, 2)}`];
    if (k < 9) return [`PRINT ${this.expr(sc, 3)}`];
    if (k < 10) return [`PRINT ${this.expr(sc, 2)}; ${this.expr(sc, 2)}`];
    if (k < 11) return [`${r.pick(['s0', 's1'])} = LEFT$(${this.str(sc, 2)}, 8)`, `PRINT s0; LEN(s1)`];
    if (k < 12) return [`sa(${this.idx(sc, 1, 3)}) = ${this.str(sc, 2)}`];
    if (k < 14) return this.pointerStmt(sc);
    const procs = sc.callables.filter((c) => !c.isFunction);
    const fns = sc.callables.filter((c) => c.isFunction);
    if (k < 16 && procs.length > 0) return [this.call(sc, 1, r.pick(procs))];
    if (k < 17 && fns.length > 0) return [`${x().name} = ${this.call(sc, 1, r.pick(fns))}`];
    if (k < 18 && sc.gosubs.length > 0) return [`GOSUB ${r.pick(sc.gosubs)}`];
    if (k < 19 && loop !== null) return [`IF ${this.expr(sc, 2)} THEN EXIT ${loop === 'for' ? 'FOR' : 'WHILE'}`];
    if (k < 23) {
      const body = this.stmts(sc, 1 + r.int(3), depth + 1, mult, loop);
      const other = r.chance(0.5) ? this.stmts(sc, 1 + r.int(2), depth + 1, mult, loop) : undefined;
      return [{ head: `IF ${this.expr(sc, 2)} THEN`, body, ...(other !== undefined ? { other } : {}), tail: 'END IF' }];
    }
    if (k < 27) return this.forLoop(sc, depth, mult);
    return this.whileLoop(sc, depth, mult);
  }

  forLoop(sc: Scope, depth: number, mult: number): Node[] {
    const r = this.rng;
    const lv = `${sc.prefix}k${depth}`;
    const sv = `${sc.prefix}sv${depth}`;
    const inner = { ...sc, reads: [...sc.reads, lv] };
    // start in 0..8 and limit in 0..7: a step of either sign ends, whatever the body does to the variables the bounds read
    const start = r.chance(0.5) ? String(r.int(9)) : this.idx(sc, 1, 8);
    const limit = r.chance(0.5) ? String(r.int(8)) : this.idx(sc, 1, 7);
    const pre: Node[] = [];
    let step = '';
    const kind = r.int(4);
    if (kind === 1) step = ` STEP ${r.pick(['2', '3'])}`;
    else if (kind === 2) step = ` STEP -${r.pick(['1', '2', '3'])}`;
    else if (kind === 3) {
      pre.push(`${sv} = ${r.pick(['1', '2', '-1', '-2', '3', '-3'])}`);
      step = ` STEP ${sv}`;
    }
    const body = this.stmts(inner, 1 + r.int(3), depth + 1, mult * 9, 'for');
    return [...pre, { head: `FOR ${lv} = ${start} TO ${limit}${step}`, body, tail: 'NEXT' }];
  }

  whileLoop(sc: Scope, depth: number, mult: number): Node[] {
    const r = this.rng;
    const wc = `${sc.prefix}w${depth}`;
    const inner = { ...sc, reads: [...sc.reads, wc] };
    const body = this.stmts(inner, 1 + r.int(3), depth + 1, mult * 6, 'while');
    body.push(`${wc} = ${wc} + 1`);
    return [`${wc} = 0`, { head: `WHILE (${wc} < ${2 + r.int(4)}) AND (${this.expr(sc, 2)} <> 12345)`, body, tail: 'WEND' }];
  }

  /** PEEK/POKE through pointers and addresses: em00k's bug 1 and bug 4, and the byte and word blocks. */
  pointerStmt(sc: Scope): Node[] {
    const r = this.rng;
    const e = (): string => this.expr(sc, 2);
    switch (r.int(8)) {
      case 0: {
        // bug 1: the pointer's target is stored, poked through the pointer, read back
        const x = r.pick(GLOBALS.filter((v) => v.type !== 'LONG' && v.type !== 'ULONG'));
        const poke = SIZE[x.type] === 1 ? `POKE pp, ${e()}` : `POKE UINTEGER, pp, ${e()}`;
        return [`pp = @${x.name}`, `${x.name} = ${this.lit()}`, poke, `PRINT ${x.name}`, `${r.pick(sc.vars).name} = ${x.name} + 1`];
      }
      case 1:
        return [`pp = @buf(0) + ${this.idx(sc, 1, 31)}`, `POKE pp, ${e()}`, `${r.pick(sc.vars).name} = PEEK(pp)`];
      case 2:
        return [`pp = @buf(0) + ${this.idx(sc, 1, 30)}`, `POKE UINTEGER, pp, ${e()}`, `PRINT PEEK(UINTEGER, pp); PEEK(pp)`];
      case 3:
        return [`POKE @${r.pick(['m0', 'n0'])} + ${this.idx(sc, 1, 7)}, ${e()}`, `PRINT ${r.pick(M)}; ${r.pick(N)}`];
      case 4:
        return [`POKE UINTEGER, @${r.pick(['m0', 'n0'])} + ${this.idx(sc, 1, 6)}, ${e()}`, `${r.pick(sc.vars).name} = PEEK(UINTEGER, @m0 + ${r.pick(['0', '2', '4', '6'])})`];
      case 5: {
        if (r.int(2) === 0) {
          // bug 4 as em00k wrote it: a store, then a read of an expression over the same variable
          const x = r.pick(sc.vars).name;
          const y = r.pick(sc.vars).name;
          const c = this.lit();
          return [`${x} = ${c} - ${x}`, `${y} = ${c} - ${x}`, `PRINT ${y}`];
        }
        // bug 4 in this dialect (R17): a byte of a word is written, the whole word is stored, the byte is read back; a
        // pass that keeps the byte's value past the word store (the cells overlap) prints the stale byte
        const w = r.pick(N);
        const k = r.int(2);
        return [`POKE @${w} + ${k}, ${r.int(256)}`, `${w} = ${this.lit()}`, `${r.pick(sc.vars).name} = PEEK(@${w} + ${k})`, `PRINT PEEK(@${w} + ${k}); ${w}`];
      }
      case 6: {
        // L5-IR (follow-up 174): a constant `@v + K` that leaves `v` is the next variable's cells. A word of the block is stored, the
        // address constant is poked, the word is read back: a pass that folds `@n0 + 2` and keeps `n1`'s value across the poke prints
        // the stale word. (The bytes m0..m7 are one block: `@m1 + K` reaches m2..m7 the same way.)
        if (r.int(2) === 0) {
          const i = r.int(3);
          const k = 2 + r.int(2);
          return [`n${i + 1} = ${this.lit()}`, `POKE @n${i} + ${k}, ${r.int(256)}`, `${r.pick(sc.vars).name} = n${i + 1} + 1`, `PRINT n${i + 1}`];
        }
        const i = r.int(6);
        return [`m${i + 1} = ${r.int(256)}`, `POKE @m${i} + 1, ${e()}`, `PRINT m${i + 1}`];
      }
      default: {
        // an array element address
        return [`pp = @ia(0) + ${this.idx(sc, 1, 7)} * 2`, `POKE UINTEGER, pp, ${e()}`, `PRINT ia(${this.idx(sc, 1, 7)})`];
      }
    }
  }
}

export function generate(seed: number): FuzzProgram {
  const rng = new Rng(seed * 7919 + 17);
  const g = new Gen(rng);
  const decls: string[] = [];
  // the byte block and the word block first and in order: they are adjacent in memory
  for (const v of GLOBALS) decls.push(`DIM ${v.name} AS ${v.type}`);
  decls.push('DIM pp AS UINTEGER', 'DIM k0 AS INTEGER', 'DIM k1 AS INTEGER', 'DIM k2 AS INTEGER', 'DIM sv0 AS INTEGER', 'DIM sv1 AS INTEGER', 'DIM sv2 AS INTEGER', 'DIM w0 AS INTEGER', 'DIM w1 AS INTEGER', 'DIM w2 AS INTEGER', 'DIM gk2 AS INTEGER', 'DIM gsv2 AS INTEGER', 'DIM gw2 AS INTEGER');
  decls.push('DIM ia(7) AS INTEGER', 'DIM ba(7) AS UBYTE', 'DIM sa(3) AS STRING', 'DIM buf(31) AS UBYTE', 'DIM s0 AS STRING', 'DIM s1 AS STRING');
  // seed the variables with edge values so that wrap and sign rules are reached from the first statement
  const init: Node[] = GLOBALS.map((v) => `${v.name} = ${rng.pick(LITERALS)}`);

  const callables: Callable[] = [];
  const procs: Proc[] = [];
  const nProcs = rng.int(4);
  for (let j = 0; j < nProcs; j++) {
    const isFunction = rng.chance(0.5);
    const nParams = rng.int(4);
    const params: Var[] = Array.from({ length: nParams }, (_, i) => ({ name: `a${i}`, type: rng.pick(INT_TYPES) }));
    const nLocals = rng.int(3);
    const locals: Var[] = Array.from({ length: nLocals }, (_, i) => ({ name: `v${i}`, type: rng.pick(INT_TYPES) }));
    const loopDecls = ['pk0', 'pk1', 'pk2', 'psv0', 'psv1', 'psv2', 'pw0', 'pw1', 'pw2'].map((n) => `DIM ${n} AS INTEGER`);
    const name = `${isFunction ? 'Fn' : 'Sb'}${j}`;
    const before = g.budget;
    const sc: Scope = { vars: [...GLOBALS, ...params, ...locals], reads: [], callables: [...callables], prefix: 'p', gosubs: [], inProc: true };
    const body = g.stmts(sc, 2 + rng.int(4), 1, 1, null);
    if (isFunction) body.push(`RETURN ${g.expr(sc, 2)}`);
    const cost = Math.min(2000, Math.max(5, (before - g.budget) * 2));
    g.budget = before; // the procedure is charged at each call, not once
    callables.push({ name, nParams, isFunction, cost });
    const paramText = params.map((p) => `${p.name} AS ${p.type}`).join(', ');
    procs.push({
      head: `${isFunction ? 'FUNCTION' : 'SUB'} ${name}(${paramText})${isFunction ? ` AS ${rng.pick(INT_TYPES)}` : ''}`,
      locals: [...loopDecls, ...locals.map((v) => `DIM ${v.name} AS ${v.type}`)],
      body,
      tail: isFunction ? 'END FUNCTION' : 'END SUB',
    });
  }

  const nSubs = rng.int(3);
  const labels = Array.from({ length: nSubs }, (_, i) => `G${i}`);
  // a GOSUB body shares the globals with the main program, so it has loop variables of its own (a procedure's are locals)
  const mainScope = (gosubs: string[], prefix: string): Scope => ({ vars: [...GLOBALS], reads: [], callables, prefix, gosubs, inProc: false });
  const subs = labels.map((label, i) => ({ label, body: g.stmts(mainScope(labels.slice(i + 1), 'g'), 1 + rng.int(3), 2, 4, null) }));
  const main = [...init, ...g.stmts(mainScope(labels, ''), 8 + rng.int(14), 0, 1, null)];
  main.push(`PRINT ${[...GLOBALS.map((v) => v.name), 'LEN(s0)', 'LEN(s1)'].join('; ')}`, 'PRINT s0; s1; sa(0); sa(1); sa(2); sa(3)', 'PRINT ia(0); ia(1); ia(2); ia(3); ia(4); ia(5); ia(6); ia(7)');
  return { seed, decls, procs, main, subs };
}

function renderNodes(nodes: readonly Node[], indent: string, out: string[]): void {
  for (const n of nodes) {
    if (typeof n === 'string') out.push(`${indent}${n}`);
    else {
      out.push(`${indent}${n.head}`);
      renderNodes(n.body, `${indent}  `, out);
      if (n.other !== undefined) {
        out.push(`${indent}ELSE`);
        renderNodes(n.other, `${indent}  `, out);
      }
      out.push(`${indent}${n.tail}`);
    }
  }
}

/** The program as BASIC source. */
export function render(p: FuzzProgram): string {
  const out: string[] = [...p.decls];
  for (const proc of p.procs) {
    out.push(proc.head, ...proc.locals.map((l) => `  ${l}`));
    renderNodes(proc.body, '  ', out);
    out.push(proc.tail);
  }
  renderNodes(p.main, '', out);
  out.push('END');
  for (const s of p.subs) {
    out.push(`${s.label}:`);
    renderNodes(s.body, '  ', out);
    out.push('  RETURN');
  }
  return `${out.join('\n')}\n`;
}
