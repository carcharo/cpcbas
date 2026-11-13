/**
 * `migrate(files, options)`: the Boriel BASIC to CPC BASIC translator as a pure function. The files of a
 * project come in as a map of path to text and go out translated, with a report of everything rewritten
 * (notes) and everything a person has to look at (warnings). docs/migrate.md is the rule list.
 */
import { CODES, type DiagnosticJson } from '../core/diagnostics.js';
import { decodeText, normalizePath, type SourceSet, type FileContent, type FileTree } from '../core/source.js';
import { runPipeline as compile } from '../pipeline.js';
import type { CompileOptions, CompileResult } from '../index.js';
import { collectDecls, newProject, splitSuffix, type Project } from './decls.js';
import { caseFlags, signFindings } from './flags.js';
import { buildModel, type FileModel } from './model.js';
import { FileRules, type RawDiag, type RunCtx } from './rules.js';
import { lineStarts, positionOf } from './tokenize.js';

export interface MigrateOptions {
  /** `'boriel'`: the input is Boriel BASIC (W705, W713 and W715 apply). `'auto'` (default): they apply when any other rewrite fired; otherwise the run is read as CPC BASIC and those three forms get W727. */
  readonly from?: 'auto' | 'boriel';
  /** Names chosen for W702, by old name (case-insensitive): `{ inp: 'kin' }`. */
  readonly renames?: Readonly<Record<string, string>>;
  /** The CPC BASIC runtime library tree: with it, the translated mains are compile-checked (W725, W737). */
  readonly runtime?: FileTree;
  /** The main files of the compile check (default: every `.bas` no other file includes). */
  readonly mains?: readonly string[];
  /** `-D` defines of the compile check. */
  readonly defines?: Readonly<Record<string, string>>;
}

export type MigrateDiagnostic = DiagnosticJson;

export interface MigrateFileReport {
  path: string;
  changed: boolean;
  diagnostics: MigrateDiagnostic[];
}

export interface MigrateReport {
  version: 1;
  files: MigrateFileReport[];
  summary: {
    files: number;
    changed: number;
    /** Findings per code. */
    counts: Record<string, number>;
    /** How the run was read: Boriel (the dialect rules applied) or CPC BASIC. */
    dialect: 'boriel' | 'cpcbas';
  };
}

export interface MigrateResult {
  files: Map<string, string>;
  report: MigrateReport;
}

/** Files of the CPC BASIC library (lib/), known without a runtime tree. */
const KNOWN_LIBRARY = new Set([
  'cpcbuild.bas', 'cpcbuild/banks.bas', 'cpcbuild/display.bas', 'cpcbuild/fill.bas', 'cpcbuild/keyboard.bas', 'cpcbuild/palette.bas',
  'cpcbuild/reserve.bas', 'cpcbuild/spritelist.bas', 'cpcbuild/sprites.bas', 'cpcbuild/text.bas', 'cpcbuild/tiles.bas',
  'cpcplus/cpcplus.bas', 'cpcplus/palcycle.bas', 'cpcplus/sprman.bas', 'music/music.bas', 'music/music_cpc.bas', 'music/quiet.bas',
  'cpc.bas', 'framehook.bas',
]);

const textOf = (c: FileContent): string => decodeText(c);

/** The offset of the first byte that is not valid UTF-8 (overlong forms, surrogates and values above U+10FFFF included), or -1. */
function badUtf8(c: FileContent): number {
  if (typeof c === 'string') return -1;
  const n = c.length;
  let i = n >= 3 && c[0] === 0xef && c[1] === 0xbb && c[2] === 0xbf ? 3 : 0;
  const cont = (k: number): boolean => k < n && ((c[k] as number) & 0xc0) === 0x80;
  while (i < n) {
    const b = c[i] as number;
    if (b < 0x80) i++;
    else if (b >= 0xc2 && b <= 0xdf && cont(i + 1)) i += 2;
    else if (b >= 0xe0 && b <= 0xef && cont(i + 1) && cont(i + 2) && !(b === 0xe0 && (c[i + 1] as number) < 0xa0) && !(b === 0xed && (c[i + 1] as number) >= 0xa0)) i += 3;
    else if (b >= 0xf0 && b <= 0xf4 && cont(i + 1) && cont(i + 2) && cont(i + 3) && !(b === 0xf0 && (c[i + 1] as number) < 0x90) && !(b === 0xf4 && (c[i + 1] as number) >= 0x90)) i += 4;
    else return i;
  }
  return -1;
}

const dirOf = (path: string): string => {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
};

/** An `#include "file"` line inside an ASM body: that file is assembly too. */
const ASM_INCLUDE = /^[ \t]*#include[ \t]+(?:once[ \t]+)?"([^"\r\n]+)"/gim;

/** The path in `paths` an `#include` of `name` written in `from` refers to, if any. */
function resolveInclude(paths: ReadonlySet<string>, name: string, from: string): string | undefined {
  const rel = normalizePath(dirOf(from) === '' ? name : `${dirOf(from)}/${name}`);
  if (paths.has(rel)) return rel;
  const root = normalizePath(name);
  if (paths.has(root)) return root;
  for (const p of paths) if (p.endsWith(`/${root}`)) return p;
  return undefined;
}

function sorted<T>(m: ReadonlyMap<string, T>): Array<[string, T]> {
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

export function migrate(input: ReadonlyMap<string, FileContent>, options: MigrateOptions = {}): MigrateResult {
  const texts = new Map<string, string>();
  /** Files that are not UTF-8: read for their declarations, never rewritten (a finding says so). */
  const notUtf8 = new Map<string, number>();
  for (const [path, content] of sorted(input)) {
    texts.set(normalizePath(path), textOf(content));
    if (badUtf8(content) >= 0) notUtf8.set(normalizePath(path), textOf(content).indexOf('\uFFFD'));
  }
  const paths = new Set(texts.keys());
  const models: FileModel[] = [];
  for (const [path, text] of texts) models.push(buildModel(path, text));
  // A file that an ASM block includes is assembly: read again as one ASM body (and so on for its own includes)
  const asmFiles = new Set<string>();
  for (let grew = true; grew; ) {
    grew = false;
    for (const model of [...models]) {
      for (const t of model.toks) {
        if (t.kind !== 'asm') continue;
        for (const m of t.text.matchAll(ASM_INCLUDE)) {
          const target = resolveInclude(paths, m[1] as string, model.path);
          if (target === undefined || asmFiles.has(target)) continue;
          asmFiles.add(target);
          models[models.findIndex((x) => x.path === target)] = buildModel(target, texts.get(target) as string, true);
          grew = true;
        }
      }
    }
  }

  const project: Project = newProject();
  for (const m of models) collectDecls(project, m);
  const arrayBases = new Set<string>();
  for (const [key, d] of project.decls) if (d.array) arrayBases.add(splitSuffix(key).base);
  const suffixUse = new Map<string, Set<string>>();
  for (const m of models) {
    for (const t of m.toks) {
      if (t.kind !== 'word') continue;
      const { base, suffix } = splitSuffix(t.text.toLowerCase());
      if (suffix === '') continue;
      if (/\$$/.test(t.text) && /^(chr|str|inkey|left|right|mid|space|string|hex|bin|dec|upper|lower|copychr|screen)$/.test(base)) continue;
      let set = suffixUse.get(base);
      if (set === undefined) suffixUse.set(base, (set = new Set()));
      set.add(suffix);
    }
  }
  const renames = new Map<string, string>();
  for (const [k, v] of Object.entries(options.renames ?? {})) renames.set(k.toLowerCase(), v);
  const runtime = options.runtime;
  const run: RunCtx = {
    project,
    renames,
    arrayBases,
    suffixUse,
    hasFile: (name, from) =>
      resolveInclude(paths, name, from) !== undefined ||
      KNOWN_LIBRARY.has(name) ||
      (runtime !== undefined && (runtime.has(name) || runtime.has(`stdlib/${name}`))),
  };

  // first pass: everything except the rules that need to know the dialect
  const probe = models.map((m) => {
    const r = new FileRules(m, run, false);
    r.process();
    return r;
  });
  const boriel = options.from === 'boriel' || probe.some((r) => r.trigger);
  const final = boriel
    ? models.map((m) => {
        const r = new FileRules(m, run, true);
        r.process();
        return r;
      })
    : probe;

  if (boriel) caseFlags(final.filter((r) => !notUtf8.has(r.file.path)));

  const out = new Map<string, string>();
  const starts = new Map<string, number[]>();
  for (const r of final) {
    const rendered = r.ops.renderAll();
    out.set(r.file.path, notUtf8.has(r.file.path) ? r.file.text : rendered);
    starts.set(r.file.path, lineStarts(r.file.text));
  }
  const byFile = new Map<string, MigrateDiagnostic[]>();
  const toJson = (path: string, d: RawDiag): MigrateDiagnostic => {
    const ls = starts.get(path) as number[];
    const s = positionOf(ls, d.start);
    const e = positionOf(ls, Math.max(d.start, d.end));
    const code = d.code;
    const info = CODES[code];
    const j: MigrateDiagnostic = {
      file: path,
      line: s.line,
      col: s.col,
      endLine: e.line,
      endCol: e.col,
      severity: code <= 'W719' ? 'note' : 'warning',
      code,
      message: typeof d.message === 'string' ? d.message : d.message(),
    };
    if (code > 'W719' && 'hint' in info) j.hint = info.hint;
    return j;
  };
  for (const r of final) {
    const bad = notUtf8.get(r.file.path);
    if (bad === undefined) byFile.set(r.file.path, r.diags.map((d) => toJson(r.file.path, d)));
    else {
      const at = positionOf(starts.get(r.file.path) as number[], Math.max(0, bad));
      byFile.set(r.file.path, [
        { file: r.file.path, line: at.line, col: at.col, endLine: at.line, endCol: at.col + 1, severity: 'warning', code: 'W725', message: 'not UTF-8: left unchanged', hint: 'The file has bytes that are not UTF-8 (a Latin-1 character in a string or a comment); translating it would change them. Save it as UTF-8 and run again.' },
      ]);
    }
  }

  // the compile check
  if (runtime !== undefined) compileCheck(final, out, byFile, options, runtime, paths, starts, boriel, new Set(notUtf8.keys()));

  const files: MigrateFileReport[] = [];
  const counts: Record<string, number> = {};
  let changed = 0;
  for (const [path, text] of texts) {
    const diags = (byFile.get(path) ?? []).slice().sort((a, b) => a.line - b.line || a.col - b.col || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
    const isChanged = out.get(path) !== text;
    if (isChanged) changed++;
    for (const d of diags) counts[d.code] = (counts[d.code] ?? 0) + 1;
    files.push({ path, changed: isChanged, diagnostics: diags });
  }
  return {
    files: out,
    report: { version: 1, files, summary: { files: files.length, changed, counts, dialect: boriel ? 'boriel' : 'cpcbas' } },
  };
}

/** Compiles each main of the translated project with `parseOnly`: errors become W725, W300 becomes W737. */
function compileCheck(
  final: readonly FileRules[],
  out: ReadonlyMap<string, string>,
  byFile: Map<string, MigrateDiagnostic[]>,
  options: MigrateOptions,
  runtime: FileTree,
  paths: ReadonlySet<string>,
  starts: ReadonlyMap<string, number[]>,
  boriel: boolean,
  skip: ReadonlySet<string>,
): void {
  const included = new Set<string>();
  for (const r of final) {
    for (const line of r.file.lines) {
      const first = r.file.toks[line.sig[0] as number];
      if (first === undefined || first.kind !== 'pp' || first.text.toLowerCase() !== '#include') continue;
      const arg = r.file.toks[line.sig[1] as number];
      if (arg === undefined) continue;
      const target = resolveInclude(paths, arg.text.replace(/^["<]|[">]$/g, ''), r.file.path);
      if (target !== undefined && target !== r.file.path) included.add(target);
    }
  }
  const mains = options.mains !== undefined ? options.mains.map(normalizePath) : [...paths].filter((p) => /\.bas$/i.test(p) && !included.has(p));
  const tree: FileTree = { get: (p) => out.get(normalizePath(p)), has: (p) => out.has(normalizePath(p)) };
  const rulesByPath = new Map(final.map((r) => [r.file.path, r]));
  const seen = new Set<string>();
  const mainInput = (main: string, options2: CompileOptions) => ({
    files: tree,
    main,
    runtime,
    ...(options.defines !== undefined ? { defines: options.defines } : {}),
    options: options2,
  });
  for (const main of mains) {
    if (!out.has(main)) continue;
    // `parseOnly` is the front end alone; a second compile to the IR runs the binder and the checker too,
    // which is where an implicit variable (W300) and the type errors are found
    const results = [];
    try {
      const front = compile(mainInput(main, { parseOnly: true, warnImplicit: true }));
      results.push(front);
      if (front.ok) results.push(compile(mainInput(main, { dump: ['ir'], warnImplicit: true })));
    } catch {
      continue;
    }
    for (const result of results) checkResult(result);
    // W739 reads the checked program's types: only when the program compiles
    if (boriel && results.every((r) => r.ok)) signCheck(main);
  }

  function signCheck(main: string): void {
    const { findings } = signFindings(mainInput(main, { warnImplicit: true }));
    for (const f of findings) {
      const rules = rulesByPath.get(f.file.path);
      if (rules === undefined || !out.has(f.file.path) || skip.has(f.file.path)) continue;
      const ls = starts.get(f.file.path) as number[];
      const a = rules.ops.toInput(f.start);
      const z = Math.max(a, rules.ops.toInput(Math.max(f.start, f.end - 1)) + 1);
      const s = positionOf(ls, a);
      const e = positionOf(ls, z);
      const key = `${f.file.path}:${s.line}:${s.col}:W739`;
      if (seen.has(key)) continue;
      seen.add(key);
      (byFile.get(f.file.path) as MigrateDiagnostic[]).push({
        file: f.file.path,
        line: s.line,
        col: s.col,
        endLine: e.line,
        endCol: e.col,
        severity: 'warning',
        code: 'W739',
        message: f.message,
        hint: CODES.W739.hint,
      });
    }
  }

  function checkResult(result: CompileResult): void {
    const sources: SourceSet = result.sources;
    for (const d of result.diagnostics) {
      const file = sources.get(d.span.file);
      if (!out.has(file.path) || file.origin !== 'user' || skip.has(file.path)) continue;
      const rules = rulesByPath.get(file.path);
      if (rules === undefined) continue;
      const pos = sources.position(d.span.file, d.span.start);
      const end = sources.position(d.span.file, Math.max(d.span.start, d.span.end));
      if (d.severity === 'error') {
        const key = `${file.path}:${pos.line}:${pos.col}:${d.code}:${d.message}`;
        if (seen.has(key)) continue;
        seen.add(key);
        (byFile.get(file.path) as MigrateDiagnostic[]).push({
          file: file.path,
          line: pos.line,
          col: pos.col,
          endLine: end.line,
          endCol: end.col,
          severity: 'warning',
          code: 'W725',
          message: `${d.code}: ${d.message}`,
          hint: CODES.W725.hint,
        });
      } else if (d.code === 'W300') {
        // positions of the translated file map back to the input
        const inOff = rules.ops.toInput(d.span.start);
        const ls = starts.get(file.path) as number[];
        const s = positionOf(ls, inOff);
        const key = `${file.path}:${s.line}:${s.col}:W737:${d.message}`;
        if (seen.has(key)) continue;
        seen.add(key);
        (byFile.get(file.path) as MigrateDiagnostic[]).push({
          file: file.path,
          line: s.line,
          col: s.col,
          endLine: s.line,
          endCol: s.col + 1,
          severity: 'warning',
          code: 'W737',
          message: `${d.message} (Boriel guessed the type from its first use)`,
          hint: CODES.W737.hint,
        });
      }
    }
  }
}
