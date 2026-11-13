/**
 * The oracle of `cpcbas migrate`: cpcbuild's Boriel BASIC sources (tests/migrate/oracle/boriel, copied at
 * cpcbuild commit 9bc23fe) against the reviewed translations that cpcbas already has (lib/, tests/conformance/,
 * tests/games/lamplighter/). This module groups the files into the projects they were translated as, runs the
 * translator, and diffs its output against the reviewed files line by line.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { migrate, type MigrateReport } from '../src/index.js';
import { libTree } from './runtime-tree.js';
import { repoRoot } from './z80sim/run.js';

export const oracleDir = join(repoRoot, 'tests/migrate/oracle');
const borielDir = join(oracleDir, 'boriel');

/** The names the reviewed translations chose by hand (tests/conformance/README.md, lib/README.md, Lamplighter's README). */
export const LIB_RENAMES = { pen: 'penNo', line: 'scanLine', key: 'keyNo' };
export const LAMP_RENAMES = { inp: 'kin' };
export const CONF_RENAMES = { pen: 'penNo', mode: 'md', real: 'isReal', pos: 'PosOf', after: 'afterSum', run: 'RunFrames', wait: 'WaitFrames', mask: 'RegMask' };

/** The Boriel sources, keyed by their path in cpcbuild (`lib/cpcbuild.bas`, `tests/conformance/arrays.bas`, `games/lamplighter/game.bas`). */
export function loadBoriel(): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, `${prefix}${name}/`);
      else if (name.endsWith('.bas')) out.set(`${prefix}${name}`, readFileSync(full, 'latin1'));
    }
  };
  walk(borielDir, '');
  return out;
}

/** Where cpcbas keeps the reviewed translation of a Boriel source (repo-relative). */
export function reviewedPath(key: string): string {
  if (key.startsWith('games/lamplighter/')) return `tests/games/lamplighter/${key.slice('games/lamplighter/'.length)}`;
  if (key === 'tests/screens/lib/shot.bas') return 'tests/games/lamplighter/lib/shot.bas';
  return key;
}

export function readReviewed(key: string): string {
  return readFileSync(join(repoRoot, reviewedPath(key)), 'latin1');
}

export interface Group {
  readonly name: string;
  readonly files: Map<string, string>;
  readonly renames: Record<string, string>;
  /** The files whose output is compared (all of them, except the helpers a conformance program brings along). */
  readonly compared: readonly string[];
  /** The compile check's mains (`[]`: none). */
  readonly mains: readonly string[];
  readonly defines: Record<string, string>;
}

const incs = (path: string, text: string): string[] =>
  [...text.matchAll(/^\s*#include\s+"([^"]+)"/gim)].map((m) => posix.normalize(posix.join(posix.dirname(path), m[1] as string)));

/** `__CPC_PRINTER_ECHO__` and the model, as tools/conformance.py chooses them from a program's header. */
export function conformanceDefines(text: string): Record<string, string> {
  const d: Record<string, string> = { __CPC_PRINTER_ECHO__: '' };
  if (/^\s*REM\s+BARE:\s*only/im.test(text)) d.CPC_BAREMETAL = '';
  const m = /^\s*REM\s+MODELS:\s*(.*?)\s*$/im.exec(text);
  const models = m ? (m[1] as string).toLowerCase().split(/\s+/) : [];
  if (models.length > 0 && !models.includes('6128')) d[models.includes('plus') ? 'PLUS' : 'CPC464'] = '';
  else d.CPC6128 = '';
  return d;
}

/**
 * The projects: the library; Lamplighter; the conformance helpers (`lib/` and `assets/`); and one project per
 * conformance program (the program and the files it includes), because the programs are separate builds that
 * only share helpers, so a name one of them declares must not rename a keyword in another.
 */
export function groups(boriel: ReadonlyMap<string, string>): Group[] {
  const sub = (pred: (k: string) => boolean): Map<string, string> => new Map([...boriel].filter(([k]) => pred(k)));
  const out: Group[] = [];
  const lib = sub((k) => k.startsWith('lib/'));
  out.push({ name: 'lib', files: lib, renames: LIB_RENAMES, compared: [...lib.keys()], mains: [], defines: {} });
  const lamp = sub((k) => k.startsWith('games/lamplighter/') || k === 'tests/screens/lib/shot.bas');
  out.push({
    name: 'lamplighter',
    files: lamp,
    renames: LAMP_RENAMES,
    compared: [...lamp.keys()],
    mains: ['games/lamplighter/main.bas', 'games/lamplighter/tests/logic.bas', 'games/lamplighter/tests/playthrough.bas'],
    defines: { CPC464: '' },
  });
  const conf = sub((k) => k.startsWith('tests/conformance/'));
  const helpers = sub((k) => /^tests\/conformance\/(lib|assets)\//.test(k));
  out.push({ name: 'conformance helpers', files: helpers, renames: CONF_RENAMES, compared: [...helpers.keys()], mains: [], defines: {} });
  for (const key of [...conf.keys()].filter((k) => !helpers.has(k))) {
    const project = new Map<string, string>();
    const todo = [key];
    while (todo.length > 0) {
      const p = todo.pop() as string;
      const text = boriel.get(p);
      if (project.has(p) || text === undefined) continue;
      project.set(p, text);
      todo.push(...incs(p, text));
    }
    out.push({ name: key, files: project, renames: CONF_RENAMES, compared: [key], mains: [key], defines: conformanceDefines(boriel.get(key) as string) });
  }
  return out;
}

export interface GroupRun {
  readonly group: Group;
  readonly output: Map<string, string>;
  readonly report: MigrateReport;
}

export function runGroup(g: Group, from: 'auto' | 'boriel' = 'boriel', compileCheck = true): GroupRun {
  const r = migrate(g.files, {
    from,
    renames: g.renames,
    ...(compileCheck ? { runtime: libTree(), mains: g.mains, defines: g.defines } : {}),
  });
  return { group: g, output: r.files, report: r.report };
}

/** One difference between the translator's output and the reviewed file: a run of lines that differ. */
export interface Hunk {
  /** 1-based line of the translator's output where the run starts. */
  at: number;
  tool: string[];
  reviewed: string[];
}

/** A minimal line diff (Myers), as runs of changed lines. */
export function lineDiff(a: readonly string[], b: readonly string[]): Hunk[] {
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length;
  let eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) {
    ea--;
    eb--;
  }
  const A = a.slice(s, ea);
  const B = b.slice(s, eb);
  const n = A.length;
  const m = B.length;
  if (n === 0 && m === 0) return [];
  const max = n + m;
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && (v[off + k - 1] as number) < (v[off + k + 1] as number))) x = v[off + k + 1] as number;
      else x = (v[off + k - 1] as number) + 1;
      let y = x - k;
      while (x < n && y < m && A[x] === B[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  // walk back: a list of operations in reverse
  const ops: Array<'e' | 'd' | 'i'> = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const vv = trace[d] as Int32Array;
    const k = x - y;
    const prevK = k === -d || (k !== d && (vv[off + k - 1] as number) < (vv[off + k + 1] as number)) ? k + 1 : k - 1;
    const prevX = vv[off + prevK] as number;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push('e');
      x--;
      y--;
    }
    ops.push(x === prevX ? 'i' : 'd');
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    ops.push('e');
    x--;
    y--;
  }
  ops.reverse();
  const hunks: Hunk[] = [];
  let ai = 0;
  let bi = 0;
  let cur: Hunk | undefined;
  for (const op of ops) {
    if (op === 'e') {
      cur = undefined;
      ai++;
      bi++;
      continue;
    }
    if (cur === undefined) {
      cur = { at: s + ai + 1, tool: [], reviewed: [] };
      hunks.push(cur);
    }
    if (op === 'd') cur.tool.push(A[ai++] as string);
    else cur.reviewed.push(B[bi++] as string);
  }
  return hunks;
}

export const splitLines = (text: string): string[] => text.split('\n');

/** The categories of the hand-edit list (the prefix of each reason). */
export const CATEGORIES = ['comment', 'case', 'expected-value', 'include', 'rename', 'port-change', 'moved', 'new-code'] as const;

export interface HandEdit {
  at: number;
  tool: string[];
  reviewed: string[];
  reason: string;
}

export interface HandEdits {
  version: 1;
  description: string;
  files: Record<string, HandEdit[]>;
}

export function loadHandEdits(): HandEdits {
  return JSON.parse(readFileSync(join(oracleDir, 'hand-edits.json'), 'utf8')) as HandEdits;
}

export const handEditsExist = (): boolean => existsSync(join(oracleDir, 'hand-edits.json'));

// ---------------------------------------------------------------------------------------------------------------
// The first draft of a reason, for `MIGRATE_REGEN=1` (the list is then reviewed by hand, and a reason that is
// already in hand-edits.json for the same hunk is kept).

const isComment = (l: string): boolean => /^\s*(REM\b|')/i.test(l) || l.trim() === '';

export function draftReason(tool: readonly string[], reviewed: readonly string[], fileNote: string): string {
  if (tool.every(isComment) && reviewed.every(isComment)) return 'comment: comment text reworded or reflowed by the port; no code differs';
  const norm = (l: readonly string[]): string => l.join('\n').toLowerCase().replace(/\s+/g, '');
  const T = tool.join('\n');
  const R = reviewed.join('\n');
  if (norm(tool) === norm(reviewed)) return 'case: the port writes types, keywords and library names in upper case or in its own case; the same program';
  if (T.replace(/\b0x([0-9A-F]+)\b/gi, '&$1') === R) return 'case: 0xNN written &NN by the port (both are valid CPC BASIC)';
  if (T.replace(/\(\)/g, '') === R) return 'case: a call with no arguments written without parentheses (both are valid CPC BASIC)';
  if (T.replace(/&([0-9A-F]+)\b/gi, (_m, h: string) => String(parseInt(h, 16))) === R) return 'case: a hex number written in decimal by the port; the same value';
  if (T.split('\n').every((l, i) => (reviewed[i] ?? '').replace(/^(\s*)[A-Za-z_]\w* = /, '$1') === l)) return 'port-change: the result of a FUNCTION called as a statement is assigned to a dummy variable by the port';
  if (T.replace(/\$([0-9A-F]+)/gi, '&$1') === R || T.replace(/&H/g, '&') === R) return 'comment: the port also rewrote $ hex in a trailing REM; the translator never edits a comment (docs/migrate.md)';
  if (norm([T.replace(/\bFLOAT\b/gi, 'REAL')]) === norm([R])) return 'port-change: the port writes REAL for FLOAT (CPC BASIC accepts both; same type)';
  if (/\bResults\$|\bReport\(\)|lib\/chkbuf|lib\/tstr|lib\/pixel|lib\/heapinfo/i.test(R) && !/REM\s+changed/i.test(R)) {
    return 'include: the port keeps the check results in its helper lib/chkbuf.bas (printed by Report()) and uses lib/pixel.bas, lib/tstr.bas, lib/heapinfo.bas where the Boriel program used a library file or a built-in the CPC does not have';
  }
  const rem = reviewed.find((l) => /^\s*REM\s+(changed|workaround)/i.test(l));
  if (rem !== undefined) return `expected-value: ${rem.replace(/^\s*REM\s+/i, '').slice(0, 220)}`;
  if (/#include/i.test(T + R)) return 'include: an include path or a helper file moved: the port includes its own helper, or the Boriel library file it replaces is flagged W722';
  if (/STR\$\(/.test(T) && /\b[NT]\$\(/.test(R)) return "expected-value: STR$ became N$ or T$(STR$()): Locomotive's number text has a leading space for a number that is not negative (W732)";
  if (/-\(/.test(R) && !/-\(/.test(T)) return 'expected-value: a true comparison is -1 in CPC BASIC; -( ) keeps the expected value 1 (W728)';
  const typeOnly = T.replace(/\bAS\s+U?(BYTE|INTEGER)\b/gi, 'AS INTEGER').toUpperCase() === R.toUpperCase().replace(/\bAS\s+INTEGER\b/g, 'AS INTEGER');
  if (/\bDIM\b.*\bAS\s+UBYTE\b/i.test(T) && /\bAS\s+INTEGER\b/i.test(R) && T.split('\n').length === R.split('\n').length && typeOnly) {
    return 'expected-value: the variable holds a comparison result, true is -1 (W728), so the port declares it INTEGER (a UBYTE would hold 255)';
  }
  if (/\bTHEN\b/i.test(T) && T.replace(/\)\s+THEN\b/gi, ') <> 0 THEN') === R) return 'expected-value: a number used as a truth value is written as an explicit comparison with 0 (W729)';
  if (/\bPOINT\(/i.test(T) && /\bPt\(/.test(R)) return "port-change: pixel reads use the port's Pt helper (lib/pixel.bas) instead of POINT";
  if (/ \/ /.test(T) && T.replace(/ \/ /g, ' \\ ') === R) return 'port-change: integer division written \\ by the port (the translator keeps /, which divides integers too, docs/migrate.md W737)';
  if (/\bDIM\b[^=\n]*=/.test(T) && /\bDIM\b/.test(R) && !/=/.test(R.split('\n')[0] as string) && /\n/.test(R)) return 'port-change: DIM with an initial value split into DIM and an assignment (a local DIM initialised by a call was dropped, W726)';
  const words = (x: string): string[] => x.match(/[A-Za-z_][A-Za-z0-9_$]*|\S/g) ?? [];
  const tw = words(T);
  const rw = words(R);
  if (tw.length === rw.length) {
    const diff = tw.map((w, i) => [w, rw[i] as string]).filter(([a, b]) => a !== b);
    if (diff.length > 0 && diff.length <= 4 && diff.every(([a, b]) => /^[A-Za-z_]/.test(a as string) && /^[A-Za-z_]/.test(b as string))) {
      return `rename: the port's own names, ${[...new Set(diff.map(([a, b]) => `${a} -> ${b}`))].join(', ')}`;
    }
  }
  if (/\b(SCREEN\$|USR|INVERSE|OVER)\b|\bPRINT\b[^\n]*\b(INK|PAPER)\b|\bPLOT\b[^\n]*\bOVER\b/i.test(T)) {
    return 'port-change: a Spectrum-only form (SCREEN$, USR, INK/PAPER/INVERSE/OVER in a PRINT or PLOT) rewritten with CPC BASIC (COPYCHR$, SYMBOL, PEN, PAPER ...); the translator flags it W720/W721';
  }
  if (/\bINPUT\s*\(/i.test(T)) return 'port-change: INPUT(n) replaced by LINE INPUT (no length limit); the translator flags it W722';
  if (/\b(SoundQueue|SoundFree|SoundBusy|SoundEnvelope|MultiKeys|GetKey|SetFont|GetKeyScanCode|csrlin|pos)\b/i.test(T)) {
    return 'port-change: a Boriel library function the CPC BASIC library does not have replaced by the CPC BASIC statement (SOUND, ENV, INKEY(n), SYMBOL, VPOS, POS); the translator flags it W722';
  }
  if (tool.length === 0) return `new-code: lines the port added: ${fileNote}`;
  if (reviewed.length === 0) return `moved: lines the port removed or moved to another file: ${fileNote}`;
  return `port-change: ${fileNote}`;
}
