/**
 * `cpcbas migrate`: the command-line side of the Boriel BASIC to CPC BASIC translator. It reads the
 * `.bas` files under the paths, runs `migrate()` over them as one project and prints the report; with
 * `-o DIR` or `--in-place` it writes the translated files. Node is allowed here (bin/ only): the
 * translator itself (`src/migrate`) is pure.
 */
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { migrate, normalizePath, type FileTree, type MigrateDiagnostic, type MigrateOptions, type MigrateReport } from '../src/index.js';
import type { CliIo } from './cli.js';
import { lazyTree } from '../src/node/index.js';

export interface MigrateIo extends CliIo {
  /** Every file below `path` (relative to `cwd`), as paths joined to `path`; undefined when `path` is not a directory. */
  listFiles?(path: string): string[] | undefined;
  /** Creates the folder `path` (relative to `cwd`) and its parents; default: the real file system. */
  makeDir?(path: string): void;
}

export const MIGRATE_HELP = `Usage: cpcbas migrate [options] PATH...

Translates Boriel BASIC (.bas files, or the folders of them) to CPC BASIC. Rewrites what can be
rewritten without changing the meaning, and reports the rest with file, line and what to do.
The files are migrated together as one project. Nothing is written without -o or --in-place.

Options:
  --check               write nothing; exit 1 when a file would change or a must-fix flag (W720-W725)
                        is raised; review flags (W726-W739) are not reported
  --from auto|boriel    how to read the input (default auto: Boriel when a rewrite other than ON n GOTO,
                        UBOUND(a) and DRAW x, y applies; boriel: always; see docs/migrate.md "Boriel or CPC BASIC?")
  --report text|json    report format (default text, on stdout)
  -o DIR                write every migrated file below DIR
  --in-place            overwrite the files that change
  --rename OLD=NEW      the name to give a name that is a reserved word now (repeatable)
  -D NAME[=VALUE]       a define for the compile check (repeatable)
  --runtime DIR         the runtime library for the compile check (default: the repo's lib/)
  --main FILE           a main file of the compile check (repeatable; default: every .bas no other
                        file includes)
  --no-compile          skip the compile check (W725, W737)
  --help                print this help

Exit codes: 0 ok, 1 --check found something, 2 usage.
`;

class UsageError extends Error {}

interface Parsed {
  check: boolean;
  from: 'auto' | 'boriel';
  json: boolean;
  out?: string;
  inPlace: boolean;
  renames: Record<string, string>;
  defines: Record<string, string>;
  runtime?: string;
  mains: string[];
  noCompile: boolean;
  help: boolean;
  paths: string[];
}

function parse(argv: readonly string[]): Parsed {
  const p: Parsed = { check: false, from: 'auto', json: false, inPlace: false, renames: {}, defines: {}, mains: [], noCompile: false, help: false, paths: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    const value = (): string => {
      const eq = arg.indexOf('=');
      if (arg.startsWith('--') && eq > 0) return arg.slice(eq + 1);
      if (!arg.startsWith('--') && arg.length > 2) return arg.slice(2);
      const next = argv[++i];
      if (next === undefined) throw new UsageError(`option '${arg}' needs a value`);
      return next;
    };
    const name = arg.startsWith('--') ? (arg.indexOf('=') > 0 ? arg.slice(0, arg.indexOf('=')) : arg) : arg.slice(0, 2);
    switch (name) {
      case '--help':
      case '-h':
        p.help = true;
        break;
      case '--check':
        p.check = true;
        break;
      case '--in-place':
        p.inPlace = true;
        break;
      case '--from': {
        const v = value();
        if (v !== 'auto' && v !== 'boriel') throw new UsageError(`--from: '${v}' is not auto or boriel`);
        p.from = v;
        break;
      }
      case '--report': {
        const v = value();
        if (v !== 'text' && v !== 'json') throw new UsageError(`--report: '${v}' is not text or json`);
        p.json = v === 'json';
        break;
      }
      case '-o':
        p.out = value();
        break;
      case '--rename': {
        const v = value();
        const eq = v.indexOf('=');
        if (eq <= 0 || eq === v.length - 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(v.slice(0, eq)) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(v.slice(eq + 1))) {
          throw new UsageError(`--rename: '${v}' is not OLD=NEW (two names)`);
        }
        p.renames[v.slice(0, eq)] = v.slice(eq + 1);
        break;
      }
      case '-D': {
        const v = value();
        const eq = v.indexOf('=');
        const n = eq < 0 ? v : v.slice(0, eq);
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) throw new UsageError(`-D: '${v}' is not NAME or NAME=value`);
        p.defines[n] = eq < 0 ? '' : v.slice(eq + 1);
        break;
      }
      case '--runtime':
        p.runtime = value();
        break;
      case '--main':
        p.mains.push(normalizePath(value()));
        break;
      case '--no-compile':
        p.noCompile = true;
        break;
      default:
        if (arg.startsWith('-') && arg.length > 1) throw new UsageError(`unknown option '${arg}'`);
        p.paths.push(arg);
    }
  }
  return p;
}

/** The default file lister: a real directory walk. */
function nodeList(cwd: string, path: string): string[] | undefined {
  const base = resolve(cwd, path);
  try {
    if (!statSync(base).isDirectory()) return undefined;
  } catch {
    return undefined;
  }
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const r = rel === '' ? name : `${rel}/${name}`;
      if (statSync(full).isDirectory()) walk(full, r);
      else out.push(r);
    }
  };
  walk(base, '');
  return out.map((r) => (path === '' || path === '.' ? r : `${path.replace(/\/+$/, '')}/${r}`));
}

const isBas = (path: string): boolean => /\.bas$/i.test(path);

/** `cpcbas migrate ...`; returns the process exit code. */
export async function runMigrate(argv: string[], io: MigrateIo): Promise<number> {
  let p: Parsed;
  try {
    p = parse(argv);
    if (!p.help && p.paths.length === 0) throw new UsageError('no input path');
    if (p.out !== undefined && p.inPlace) throw new UsageError('-o and --in-place cannot be used together');
    if (p.check && (p.out !== undefined || p.inPlace)) throw new UsageError('--check writes nothing: drop -o and --in-place');
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    io.stderr(`cpcbas migrate: ${e.message}; try --help\n`);
    return 2;
  }
  if (p.help) {
    io.stdout(MIGRATE_HELP);
    return 0;
  }
  const list = io.listFiles ?? ((path: string) => nodeList(io.cwd, path));
  // the files, keyed by path as given (a folder's files below it)
  const files = new Map<string, Uint8Array>();
  for (const given of p.paths) {
    const path = normalizePath(given);
    const below = list(path);
    if (below !== undefined) {
      for (const f of below) if (isBas(f)) files.set(normalizePath(f), io.readFile(normalizePath(f)) ?? new Uint8Array());
    } else {
      const bytes = io.readFile(path);
      if (bytes === undefined) {
        io.stderr(`cpcbas migrate: cannot read '${given}': file not found; try --help\n`);
        return 2;
      }
      files.set(path, bytes);
    }
  }
  if (files.size === 0) {
    io.stderr('cpcbas migrate: no .bas file found; try --help\n');
    return 2;
  }

  const runtimeDir = p.runtime ?? io.defaultRuntime;
  const runtime: FileTree | undefined = runtimeDir !== undefined && !p.noCompile ? lazyTree((path) => io.readFile(path), normalizePath(runtimeDir)) : undefined;
  const options: MigrateOptions = {
    from: p.from,
    renames: p.renames,
    ...(runtime !== undefined ? { runtime } : {}),
    ...(p.mains.length > 0 ? { mains: p.mains } : {}),
    ...(Object.keys(p.defines).length > 0 ? { defines: p.defines } : {}),
  };
  const result = migrate(files, options);
  const report = p.check ? checkView(result.report) : result.report;

  io.stdout(p.json ? `${JSON.stringify(report, null, 2)}\n` : formatText(report));

  if (p.check) {
    const mustFix = report.files.some((f) => f.diagnostics.some((d) => d.code <= 'W725' && d.code >= 'W720'));
    return report.summary.changed > 0 || mustFix ? 1 : 0;
  }
  const encoder = new TextEncoder();
  const makeDir = io.makeDir ?? ((dir: string) => void mkdirSync(resolve(io.cwd, dir), { recursive: true }));
  const write = (path: string, text: string): void => {
    const dir = dirname(path);
    if (p.out !== undefined && dir !== '.' && dir !== '') makeDir(dir); // -o DIR and its sub-folders may not exist yet
    io.writeFile(path, encoder.encode(text));
  };
  try {
    if (p.out !== undefined) {
      const base = commonDir([...files.keys()]);
      const changedPaths = new Set(result.report.files.filter((f) => f.changed).map((f) => f.path));
      for (const [path, text] of result.files) {
        const to = normalizePath(`${p.out}/${path.slice(base.length)}`);
        const original = files.get(path);
        // a file that did not change is copied as it is (a file that is not UTF-8 must keep its bytes)
        if (!changedPaths.has(path) && original !== undefined) {
          const dir = dirname(to);
          if (dir !== '.' && dir !== '') makeDir(dir);
          io.writeFile(to, original);
        } else write(to, text);
      }
    } else if (p.inPlace) {
      for (const f of result.report.files) if (f.changed) write(f.path, result.files.get(f.path) as string);
    }
  } catch (e) {
    io.stderr(`cpcbas migrate: error E010: cannot write: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
  return 0;
}

/** `--check` reports rewrites and must-fix flags only: the review flags fire on CPC BASIC too. */
function checkView(report: MigrateReport): MigrateReport {
  const keep = (d: MigrateDiagnostic): boolean => d.code < 'W726';
  const files = report.files.map((f) => ({ ...f, diagnostics: f.diagnostics.filter(keep) }));
  const counts: Record<string, number> = {};
  for (const f of files) for (const d of f.diagnostics) counts[d.code] = (counts[d.code] ?? 0) + 1;
  return { ...report, files, summary: { ...report.summary, counts } };
}

function commonDir(paths: readonly string[]): string {
  if (paths.length === 0) return '';
  const parts = paths.map((x) => x.split('/').slice(0, -1));
  let n = (parts[0] as string[]).length;
  for (const q of parts) {
    let i = 0;
    while (i < n && i < q.length && q[i] === (parts[0] as string[])[i]) i++;
    n = i;
  }
  return n === 0 ? '' : `${(parts[0] as string[]).slice(0, n).join('/')}/`;
}

function formatText(report: MigrateReport): string {
  const lines: string[] = [];
  for (const f of report.files) {
    for (const d of f.diagnostics) {
      lines.push(`${d.file}:${d.line}:${d.col}: ${d.severity} ${d.code}: ${d.message}`);
      if (d.hint) lines.push(`  hint: ${d.hint}`);
    }
  }
  const s = report.summary;
  const codes = Object.keys(s.counts).sort();
  lines.push(`${s.files} file${s.files === 1 ? '' : 's'} read, ${s.changed} changed; read as ${s.dialect === 'boriel' ? 'Boriel BASIC' : 'CPC BASIC'}`);
  if (codes.length > 0) lines.push(codes.map((c) => `${c} x${s.counts[c]}`).join(', '));
  if (s.dialect === 'cpcbas' && (s.counts.W727 ?? 0) > 0) {
    lines.push('W727: the input was read as CPC BASIC; if it is Boriel BASIC (counting from 0, UBOUND(a), DRAW x, y by offset), run again with --from boriel');
  }
  return `${lines.join('\n')}\n`;
}
