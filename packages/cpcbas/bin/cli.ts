/**
 * The `cpcbas` command line: argument parsing and orchestration over an injectable
 * {@link CliIo}. Node is allowed in bin/ only; this file itself touches nothing but `io`.
 */
import {
  compile as realCompile,
  DiagnosticBag,
  diagnosticToJson,
  formatDiagnostic,
  SourceSet,
  VERSION,
  normalizePath,
  type CompileInput,
  type CompileOptions,
  type CompileResult,
  type Diagnostic,
  type OptLevel,
  type OutputFormat,
  type Stage,
} from '../src/index.js';
import { lazyTree } from '../src/node/index.js';
import { runSubcommand, SUBCOMMANDS, SUBCOMMAND_HELP } from './subcommands.js';
import { runMigrate } from './migrate-cli.js';

export interface CliIo {
  /** Reads a file by virtual path (relative to `cwd`, or absolute); undefined when missing. */
  readFile(path: string): Uint8Array | undefined;
  writeFile(path: string, bytes: Uint8Array): void;
  stdout(text: string): void;
  stderr(text: string): void;
  cwd: string;
  /** Where `--runtime` points by default (the package's own `lib/`, found by the entry). */
  defaultRuntime?: string;
  /** Today's local date, `YYYY-MM-DD`; the real entry computes it, tests may fix it. */
  today?: () => string;
}

export type CompileFn = (input: CompileInput) => CompileResult;

const HELP = `Usage: cpcbas [options] main.bas

Options:
  -o FILE               output file (.bin, .dsk or .cpr)
  -f bin|dsk|cpr        output format (default: from -o, else bin)
  --org N               code origin (&4000, 0x4000, $4000 or decimal)
  --heap N              heap size in bytes
  --heap-address N      heap start address
  -I DIR                include directory (repeatable)
  -D NAME[=VALUE]       define a name (repeatable)
  -O 0|1|2|3|s          optimisation level (-O0 .. -O3, -Os; default -O2)
  --opt-disable NAME[,NAME]   turn off optimiser passes, rules or features
                        (to narrow down a suspected optimiser bug)
  --opt-trace           mark what the optimiser changed in the --asm output
  -W CODE               disable a warning (repeatable; 301 or W301)
  -Werror               report warnings as errors
  -Wimplicit            warn at each implicit variable declaration (W300)
  -M FILE               write the memory map
  --asm FILE            write the generated assembly
  --stage tokens|ast|ir|ir-opt|asm   print a stage dump (stdout; stderr with json diagnostics)
                        and write no file (-o, -M and --asm are ignored)
  --parse-only          check the program, produce no output
  --diagnostics text|json     diagnostics format (default text, on stderr)
  --dsk-add NAME=PATH   add a file to the .dsk (repeatable)
  --runtime DIR         runtime library directory (default: lib/ of the package, SDK or checkout)
  --version             print the version
  --help                print this help

Exit codes: 0 ok, 1 errors, 2 usage, 5 memory-layout error.
`;

class UsageError extends Error {}

const STAGES: readonly string[] = ['tokens', 'ast', 'ir', 'ir-opt', 'asm'];
const FORMATS: readonly string[] = ['bin', 'dsk', 'cpr'];
/** Options that take a value, spelled `--name value`, `--name=value` or (short ones) `-Xvalue`. */
const LONG_VALUE = new Set([
  '--org', '--heap', '--heap-address', '--asm', '--stage', '--diagnostics', '--dsk-add', '--runtime', '--opt-disable',
]);
const SHORT_VALUE = new Set(['-o', '-f', '-I', '-D', '-O', '-W', '-M']);

export function parseNumber(text: string, what: string): number {
  const t = text.trim();
  let m: RegExpMatchArray | null;
  let v: number;
  if ((m = /^(?:&[hH]?|0[xX]|\$)([0-9a-fA-F]+)$/.exec(t))) v = parseInt(m[1] as string, 16);
  else if (/^[0-9]+$/.test(t)) v = parseInt(t, 10);
  else throw new UsageError(`${what}: '${text}' is not a number (use &4000, 0x4000, $4000 or decimal)`);
  if (v > 0xffff) throw new UsageError(`${what}: '${text}' is out of range (0..65535)`);
  return v;
}

interface Parsed {
  version: boolean;
  help: boolean;
  main?: string;
  out?: string;
  format?: OutputFormat;
  org?: number;
  heap?: number;
  heapAddress?: number;
  includes: string[];
  defines: Record<string, string>;
  optimize?: OptLevel;
  optDisable: string[];
  optTrace: boolean;
  warnings: (string | number)[];
  werror: boolean;
  warnImplicit: boolean;
  map?: string;
  asm?: string;
  stages: Stage[];
  parseOnly: boolean;
  json: boolean;
  dskAdd: { name: string; path: string }[];
  runtime?: string;
}

function parseArgs(argv: readonly string[]): Parsed {
  const p: Parsed = {
    version: false, help: false, includes: [], defines: {}, warnings: [], werror: false, warnImplicit: false,
    stages: [], parseOnly: false, json: false, dskAdd: [], optDisable: [], optTrace: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--version') { p.version = true; continue; }
    if (arg === '--help' || arg === '-h') { p.help = true; continue; }
    if (arg === '--parse-only') { p.parseOnly = true; continue; }
    if (arg === '-Werror') { p.werror = true; continue; }
    if (arg === '-Wimplicit') { p.warnImplicit = true; continue; }
    if (arg === '--opt-trace') { p.optTrace = true; continue; }
    let name = arg;
    let value: string | undefined;
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq > 0) { name = arg.slice(0, eq); value = arg.slice(eq + 1); }
      if (!LONG_VALUE.has(name)) throw new UsageError(`unknown option '${name}'`);
    } else if (arg.startsWith('-') && arg.length > 1) {
      name = arg.slice(0, 2);
      if (!SHORT_VALUE.has(name)) throw new UsageError(`unknown option '${arg}'`);
      if (arg.length > 2) value = arg.slice(2);
    } else {
      if (p.main !== undefined) throw new UsageError(`more than one input file ('${p.main}' and '${arg}')`);
      p.main = arg;
      continue;
    }
    if (value === undefined) {
      const next = argv[++i];
      if (next === undefined) throw new UsageError(`option '${name}' needs a value`);
      value = next;
    }
    applyOption(p, name, value);
  }
  return p;
}

function applyOption(p: Parsed, name: string, value: string): void {
  switch (name) {
    case '-o': p.out = value; break;
    case '-f':
      if (!FORMATS.includes(value)) throw new UsageError(`-f: '${value}' is not bin, dsk or cpr`);
      p.format = value as OutputFormat;
      break;
    case '--org': p.org = parseNumber(value, '--org'); break;
    case '--heap': p.heap = parseNumber(value, '--heap'); break;
    case '--heap-address': p.heapAddress = parseNumber(value, '--heap-address'); break;
    case '-I': p.includes.push(value); break;
    case '-D': {
      const eq = value.indexOf('=');
      const n = eq < 0 ? value : value.slice(0, eq);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) throw new UsageError(`-D: '${value}' is not NAME or NAME=value`);
      p.defines[n] = eq < 0 ? '' : value.slice(eq + 1);
      break;
    }
    case '-O':
      if (!/^[0-3s]$/.test(value)) throw new UsageError(`-O: '${value}' is not 0, 1, 2, 3 or s`);
      p.optimize = value === 's' ? 's' : (Number(value) as 0 | 1 | 2 | 3);
      break;
    case '--opt-disable':
      for (const n of value.split(',')) {
        const t = n.trim();
        if (!/^[a-z0-9][a-z0-9_-]*$/.test(t)) throw new UsageError(`--opt-disable: '${n}' is not a pass, rule or feature name`);
        p.optDisable.push(t);
      }
      break;
    case '-W':
      for (const w of value.split(',')) {
        const t = w.trim();
        if (!/^[EW]?[0-9]{1,3}$/i.test(t)) throw new UsageError(`-W: '${w}' is not a warning code (301 or W301)`);
        if (/^E/i.test(t)) throw new UsageError(`-W: ${t.toUpperCase()} is an error; only warnings can be disabled`);
        p.warnings.push(/^[0-9]+$/.test(t) ? Number(t) : t.toUpperCase());
      }
      break;
    case '-M': p.map = value; break;
    case '--asm': p.asm = value; break;
    case '--stage':
      if (!STAGES.includes(value)) throw new UsageError(`--stage: '${value}' is not tokens, ast, ir, ir-opt or asm`);
      p.stages.push(value as Stage);
      break;
    case '--diagnostics':
      if (value !== 'text' && value !== 'json') throw new UsageError(`--diagnostics: '${value}' is not text or json`);
      p.json = value === 'json';
      break;
    case '--dsk-add': {
      const eq = value.indexOf('=');
      if (eq <= 0 || eq === value.length - 1) throw new UsageError(`--dsk-add: '${value}' is not NAME=path`);
      p.dskAdd.push({ name: value.slice(0, eq), path: value.slice(eq + 1) });
      break;
    }
    case '--runtime': p.runtime = value; break;
  }
}

function formatFromPath(path: string): OutputFormat | undefined {
  const m = /\.(bin|dsk|cpr)$/i.exec(path);
  return m ? (m[1]?.toLowerCase() as OutputFormat) : undefined;
}

function localDate(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/** Runs the CLI. Returns the process exit code. `compile` is injectable for tests. */
export async function run(argv: string[], io: CliIo, compile: CompileFn = realCompile): Promise<number> {
  // Subcommands (the first argument): one case each, so a new one is one line.
  if (argv[0] === 'migrate') return runMigrate(argv.slice(1), io);
  const sub = SUBCOMMANDS.find((n) => n === argv[0]);
  if (sub !== undefined) return runSubcommand(sub, argv.slice(1), io);
  let p: Parsed;
  try {
    p = parseArgs(argv);
    if (!p.version && !p.help && p.main === undefined) throw new UsageError('no input file');
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    io.stderr(`cpcbas: ${e.message}; try --help\n`);
    return 2;
  }
  if (p.version) { io.stdout(`cpcbas ${VERSION}\n`); return 0; }
  if (p.help) { io.stdout(HELP + SUBCOMMAND_HELP); return 0; }

  const main = normalizePath(p.main as string);
  const format: OutputFormat = p.format ?? (p.out !== undefined ? formatFromPath(p.out) : undefined) ?? 'bin';
  if (p.out !== undefined && p.format === undefined && formatFromPath(p.out) === undefined) {
    io.stderr(`cpcbas: -o: cannot tell the format of '${p.out}' (use .bin, .dsk or .cpr, or -f); try --help\n`);
    return 2;
  }
  if (p.dskAdd.length > 0 && format !== 'dsk') {
    io.stderr(`cpcbas: --dsk-add needs a .dsk output (the format is ${format}); try --help\n`);
    return 2;
  }

  const files = lazyTree((path) => io.readFile(path));
  const emit = (diagnostics: readonly Diagnostic[], sources: SourceSet): void => {
    if (p.json) io.stdout(`${JSON.stringify(diagnostics.map((d) => diagnosticToJson(d, sources)))}\n`);
    else for (const d of diagnostics) io.stderr(`${formatDiagnostic(d, sources)}\n`);
  };
  /** A diagnostic that belongs to the CLI, not the compiler (a missing or unwritable file). */
  const hostFailure = (code: 'E003' | 'E010', path: string, message: string, hint?: string): number => {
    const sources = new SourceSet();
    const file = sources.add(path, '', 'user');
    const bag = new DiagnosticBag({ disabled: p.warnings, warningsAsErrors: p.werror });
    bag.report(code, { file: file.id, start: 0, end: 0 }, message, hint);
    emit(bag.all(), sources);
    return 1;
  };

  if (!files.has(main)) {
    return hostFailure('E003', main, `cannot read '${main}': file not found`, 'Check the path of the main file.');
  }
  const dskFiles: { name: string; data: Uint8Array }[] = [];
  for (const a of p.dskAdd) {
    const data = io.readFile(normalizePath(a.path));
    if (data === undefined) return hostFailure('E003', a.path, `cannot read '${a.path}' for --dsk-add ${a.name}: file not found`);
    dskFiles.push({ name: a.name, data });
  }

  const runtimeDir = p.runtime ?? io.defaultRuntime;
  const options: CompileOptions = {
    format,
    buildDate: (io.today ?? localDate)(),
    now: () => performance.now(),
    ...(p.org !== undefined ? { org: p.org } : {}),
    ...(p.heap !== undefined ? { heapSize: p.heap } : {}),
    ...(p.heapAddress !== undefined ? { heapAddress: p.heapAddress } : {}),
    ...(p.optimize !== undefined ? { optimize: p.optimize } : {}),
    ...(p.optDisable.length > 0 ? { optDisable: p.optDisable } : {}),
    ...(p.optTrace ? { optTrace: true } : {}),
    ...(p.parseOnly ? { parseOnly: true } : {}),
    ...(p.stages.length > 0 ? { dump: p.stages } : {}),
    ...(p.warnings.length > 0 ? { disabledWarnings: p.warnings } : {}),
    ...(p.werror ? { warningsAsErrors: true } : {}),
    ...(p.warnImplicit ? { warnImplicit: true } : {}),
    ...(p.map !== undefined ? { map: true } : {}),
    ...(p.asm !== undefined ? { asm: true } : {}),
    ...(dskFiles.length > 0 ? { dskFiles } : {}),
  };
  const input: CompileInput = {
    files,
    main,
    ...(p.includes.length > 0 ? { includePaths: p.includes.map(normalizePath) } : {}),
    ...(Object.keys(p.defines).length > 0 ? { defines: p.defines } : {}),
    ...(runtimeDir !== undefined ? { runtime: lazyTree((path) => io.readFile(path), normalizePath(runtimeDir)) } : {}),
    options,
  };

  let result: CompileResult;
  try {
    result = compile(input);
  } catch (e) {
    io.stderr(`cpcbas: internal error: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }

  // With --diagnostics json, stdout carries only the JSON array, so the dumps go to stderr.
  const dumpTo = (text: string): void => (p.json ? io.stderr(text) : io.stdout(text));
  for (const s of p.stages) {
    const dump = result.stages?.[s];
    if (dump !== undefined) dumpTo(dump.endsWith('\n') ? dump : `${dump}\n`);
  }
  emit(result.diagnostics, result.sources);
  if (!result.ok) return result.exitCode;
  // A dump is an inspection: it never writes an output file.
  if (p.stages.length > 0) return result.exitCode;

  const write = (path: string, bytes: Uint8Array): boolean => {
    try {
      io.writeFile(path, bytes);
      return true;
    } catch (e) {
      hostFailure('E010', path, `cannot write '${path}': ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  };
  if (p.asm !== undefined && result.asm !== undefined && !write(p.asm, utf8(result.asm))) return 1;
  if (p.map !== undefined && result.map !== undefined && !write(p.map, utf8(result.map))) return 1;
  const bytes = result.output ?? result.binary;
  if (!p.parseOnly && bytes !== undefined) {
    const out = p.out ?? main.replace(/\.[^./]*$/, '') + `.${format}`;
    if (!write(out, bytes)) return 1;
  }
  return result.exitCode;
}
