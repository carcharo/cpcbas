/**
 * What the whole run declares: names (W702, W712), arrays and strings (W703, W706), types (W735), and the
 * facts a flag needs across files (a DATA item that is an unquoted number: W736).
 */
import { RESERVED_WORDS } from '../lang/keywords.js';
import { BORIEL_KEYWORDS } from './boriel-keywords.js';
import { matchParen, up, type FileModel } from './model.js';
import type { Tok } from './tokenize.js';

export interface Decl {
  /** Declared with DIM, CONST, SUB, FUNCTION, a parameter, FOR, a label or an assignment. */
  declared: boolean;
  array: boolean;
  /** A procedure (SUB or FUNCTION). */
  proc: boolean;
  /** Upper-case type name (`UBYTE`, `STRING`), when declared with AS. */
  type?: string;
}

export interface Project {
  /** Declarations by lower-case name including any suffix (`a$`). */
  readonly decls: Map<string, Decl>;
  /** Lower-case base names (no suffix) that the project declares as names, anywhere. */
  readonly declaredBases: Set<string>;
  /** The names declared outside any procedure (and the procedures' own names). */
  readonly globals: Set<string>;
  /** The names declared inside a procedure (parameters, DIM, FOR, assignments), by procedure (`path:line`). */
  readonly locals: Map<string, Set<string>>;
  /** Names with a `$` suffix used without a subscript somewhere (a string variable). */
  readonly scalarStrings: Set<string>;
  /** A DATA item is an unquoted number. */
  dataNumbers: boolean;
  /** `#define` names. */
  readonly macros: Set<string>;
  /** The `#include <x>` and `#include "x"` targets seen, per lower-cased target. */
  readonly includes: Set<string>;
}

/** Splits a word into its base and suffix (`a$` -> `a`, `$`). */
export function splitSuffix(text: string): { base: string; suffix: string } {
  const last = text[text.length - 1] as string;
  if (last === '$' || last === '%' || last === '!') return { base: text.slice(0, -1), suffix: last };
  return { base: text, suffix: '' };
}

/** The reserved words of CPC BASIC that were not Boriel keywords: the names W702 may rename (upper case, `$` forms included). */
export const RENAMEABLE: ReadonlySet<string> = new Set([...RESERVED_WORDS].filter((w) => !BORIEL_KEYWORDS.has(w) && w !== 'REM'));

/** True when the word (with its suffix) would be a reserved word, or a reserved word with a bad suffix, in CPC BASIC. */
export function isRenameable(text: string): boolean {
  const up = text.toUpperCase();
  if (RENAMEABLE.has(up)) return true;
  const { base, suffix } = splitSuffix(up);
  return suffix !== '' && RENAMEABLE.has(base) && !RESERVED_WORDS.has(up);
}

export function newProject(): Project {
  return { decls: new Map(), declaredBases: new Set(), globals: new Set(), locals: new Map(), scalarStrings: new Set(), dataNumbers: false, macros: new Set(), includes: new Set() };
}

function declOf(project: Project, name: string): Decl {
  const key = name.toLowerCase();
  let d = project.decls.get(key);
  if (d === undefined) {
    d = { declared: false, array: false, proc: false };
    project.decls.set(key, d);
  }
  return d;
}

/** The procedure whose body the declaration being read is in (`undefined`: global). Set by {@link collectDecls}. */
let currentScope: string | undefined;

function noteDeclared(project: Project, name: string, global = false): Decl {
  const d = declOf(project, name);
  d.declared = true;
  const base = splitSuffix(name.toLowerCase()).base;
  project.declaredBases.add(base);
  if (global || currentScope === undefined) project.globals.add(base);
  else {
    let set = project.locals.get(currentScope);
    if (set === undefined) project.locals.set(currentScope, (set = new Set()));
    set.add(base);
  }
  return d;
}

/** Reads one file's declarations into the project. */
export function collectDecls(project: Project, file: FileModel): void {
  const { toks } = file;
  currentScope = undefined;
  for (let li = 0; li < file.lines.length; li++) {
    const line = file.lines[li] as FileModel['lines'][number];
    const { sig } = line;
    const t = (p: number): Tok | undefined => (p < sig.length ? (toks[sig[p] as number] as Tok) : undefined);
    const first = t(0);
    if (first === undefined) continue;
    if (first.kind === 'pp') {
      const dir = first.text.toLowerCase();
      if (dir === '#include') {
        const arg = t(1);
        if (arg !== undefined) project.includes.add(arg.text.replace(/^["<]|[">]$/g, '').toLowerCase());
      } else if (dir === '#define') {
        const nameTok = t(1);
        if (nameTok !== undefined && nameTok.kind === 'word') {
          project.macros.add(nameTok.text.toLowerCase());
          // parameters of a function-like macro: `#define NAME(a, b)` (the paren touches the name)
          const open = t(2);
          if (open !== undefined && open.kind === 'op' && open.text === '(' && open.start === nameTok.end) {
            const close = matchParen(toks, sig, 2);
            for (let p = 3; p < (close < 0 ? sig.length : close); p++) {
              const w = t(p);
              if (w !== undefined && w.kind === 'word') noteDeclared(project, w.text, true);
            }
          }
        }
      }
      continue;
    }
    for (const st of line.stmts) {
      const w0 = t(st.lo);
      if (w0 === undefined) continue;
      const u0 = up(w0);
      // a label
      if (st.hi - st.lo === 2 && w0.kind === 'word' && t(st.lo + 1)?.text === ':') {
        if (!RESERVED_WORDS.has(u0)) noteDeclared(project, w0.text);
        continue;
      }
      if (w0.kind === 'word' && u0 === 'DIM') dimNames(project, toks, sig, st.lo + 1, st.hi);
      else if (w0.kind === 'word' && u0 === 'CONST') {
        const nm = t(st.lo + 1);
        if (nm !== undefined && nm.kind === 'word') {
          const d = noteDeclared(project, nm.text);
          const as = findAs(toks, sig, st.lo + 2, st.hi);
          if (as !== undefined) d.type = as;
        }
      } else if (w0.kind === 'word' && (u0 === 'SUB' || u0 === 'FUNCTION')) {
        currentScope = `${file.path}:${li}`;
        procDecl(project, toks, sig, st.lo, st.hi);
      } else if (w0.kind === 'word' && u0 === 'DECLARE') {
        const saved: string | undefined = currentScope as string | undefined;
        currentScope = `${file.path}:${li}:declare`;
        procDecl(project, toks, sig, st.lo, st.hi);
        currentScope = saved;
      } else if (w0.kind === 'word' && u0 === 'END' && (up(t(st.lo + 1)) === 'SUB' || up(t(st.lo + 1)) === 'FUNCTION')) {
        currentScope = undefined;
      } else if (w0.kind === 'word' && u0 === 'FOR') {
        const v = t(st.lo + 1);
        if (v !== undefined && v.kind === 'word') noteDeclared(project, v.text);
      } else if (w0.kind === 'word' && u0 === 'DATA') {
        for (let p = st.lo + 1; p < st.hi; p++) {
          const x = t(p) as Tok;
          if (x.kind === 'num') project.dataNumbers = true;
        }
      } else if (w0.kind === 'word' && (u0 === 'LET' || !BORIEL_KEYWORDS.has(u0))) {
        // an assignment target: `name = `, `name(i) = `, `LET name =`
        let p = st.lo + (u0 === 'LET' ? 1 : 0);
        const nm = t(p);
        if (nm === undefined || nm.kind !== 'word') continue;
        p++;
        while (t(p)?.text === '(') {
          const close = matchParen(toks, sig, p, st.hi);
          if (close < 0) break;
          p = close + 1;
        }
        const eq = t(p);
        if (eq !== undefined && eq.kind === 'op' && eq.text === '=' && p < st.hi) {
          // `MID$(a$, 1, 2) = ...` is the MID$ statement, not a variable
          if (RESERVED_WORDS.has(nm.text.toUpperCase()) && nm.text.endsWith('$')) continue;
          noteDeclared(project, nm.text);
        }
      }
    }
    // string variables used without a subscript
    for (let p = 0; p < sig.length; p++) {
      const x = t(p) as Tok;
      if (x.kind === 'word' && x.text.endsWith('$') && t(p + 1)?.text !== '(') project.scalarStrings.add(x.text.toLowerCase());
    }
  }
}

function findAs(toks: readonly Tok[], sig: readonly number[], lo: number, hi: number): string | undefined {
  for (let p = lo; p < hi; p++) {
    const x = toks[sig[p] as number] as Tok;
    if (x.kind === 'word' && x.text.toUpperCase() === 'AS') {
      const ty = toks[sig[p + 1] as number] as Tok | undefined;
      return ty === undefined ? undefined : ty.text.toUpperCase();
    }
  }
  return undefined;
}

function dimNames(project: Project, toks: readonly Tok[], sig: readonly number[], lo: number, hi: number): void {
  const pending: Decl[] = [];
  let p = lo;
  const t = (q: number): Tok | undefined => (q < hi ? (toks[sig[q] as number] as Tok) : undefined);
  // `DIM ARRAY`? not Boriel; names separated by commas
  for (;;) {
    const nm = t(p);
    if (nm === undefined || nm.kind !== 'word') return;
    const d = noteDeclared(project, nm.text);
    pending.push(d);
    p++;
    if (t(p)?.text === '(') {
      d.array = true;
      const close = matchParen(toks, sig, p, hi);
      if (close < 0) return;
      p = close + 1;
    }
    const nx = t(p);
    if (nx !== undefined && nx.kind === 'op' && nx.text === ',') {
      p++;
      continue;
    }
    break;
  }
  const nx = t(p);
  if (nx !== undefined && nx.kind === 'word' && nx.text.toUpperCase() === 'AS') {
    const ty = t(p + 1);
    if (ty !== undefined) for (const d of pending) d.type = ty.text.toUpperCase();
  }
}

function procDecl(project: Project, toks: readonly Tok[], sig: readonly number[], lo: number, hi: number): void {
  const t = (q: number): Tok | undefined => (q < hi ? (toks[sig[q] as number] as Tok) : undefined);
  let p = lo;
  if (up(t(p)) === 'DECLARE') p++;
  if (up(t(p)) !== 'SUB' && up(t(p)) !== 'FUNCTION') return;
  p++;
  while (up(t(p)) === 'FASTCALL' || up(t(p)) === 'STDCALL') p++;
  const nm = t(p);
  if (nm === undefined || nm.kind !== 'word') return;
  const d = noteDeclared(project, nm.text, true);
  d.proc = true;
  p++;
  if (t(p)?.text === '(') {
    const close = matchParen(toks, sig, p, hi);
    const end = close < 0 ? hi : close;
    // parameters: [BYREF|BYVAL] name [()] [AS type]
    let q = p + 1;
    while (q < end) {
      while (up(t(q)) === 'BYREF' || up(t(q)) === 'BYVAL') q++;
      const prm = t(q);
      if (prm === undefined || prm.kind !== 'word') break;
      const pd = noteDeclared(project, prm.text);
      q++;
      if (t(q)?.text === '(') {
        pd.array = true;
        const c2 = matchParen(toks, sig, q, hi);
        q = c2 < 0 ? end : c2 + 1;
      }
      if (up(t(q)) === 'AS') {
        const ty = t(q + 1);
        if (ty !== undefined) pd.type = ty.text.toUpperCase();
        q += 2;
      }
      // skip a default value `= expr` up to the comma
      while (q < end && t(q)?.text !== ',') q++;
      q++;
    }
    p = close < 0 ? hi : close + 1;
  }
  if (up(t(p)) === 'AS') {
    const ty = t(p + 1);
    if (ty !== undefined) d.type = ty.text.toUpperCase();
  }
}
