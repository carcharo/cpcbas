/**
 * The `cpcbas asm` and `cpcbas dsk` subcommands: the assembler and the disc writer on their own, for the build
 * scripts that need them without a BASIC program (a game's loader, a data disc). Like `run`, they touch only `io`.
 */
import { assemble, flatten, formatMap } from '../src/asm/index.js';
import { buildDsk } from '../src/pack/index.js';
import { formatDiagnostic, SourceSet, normalizePath } from '../src/index.js';
import type { CliIo } from './cli.js';
import { parseNumber } from './cli.js';

export const SUBCOMMANDS = ['asm', 'dsk'] as const;

export const SUBCOMMAND_HELP = `
Subcommands:
  cpcbas migrate [--check] [--from auto|boriel] [-o DIR | --in-place] PATH...
                        translate Boriel BASIC sources to CPC BASIC (cpcbas migrate --help)
  cpcbas asm SRC.asm -o OUT.bin [-M MAP]
                        assemble a stand-alone Z80 source (no runtime, no includes) to a flat image
  cpcbas dsk -o OUT.dsk NAME=FILE@LOAD[:EXEC]...
                        an AMSDOS data disc; each FILE (no header) gets an AMSDOS header, EXEC defaults to LOAD
`;

class UsageError extends Error {}

/** `parseNumber` throws the CLI's own usage error; the subcommands report theirs (the same exit code and text). */
const num = (text: string, what: string): number => {
  try {
    return parseNumber(text, what);
  } catch (e) {
    throw new UsageError(e instanceof Error ? e.message : String(e));
  }
};

const usage = (io: CliIo, message: string): number => {
  io.stderr(`cpcbas: ${message}; try --help\n`);
  return 2;
};

/** `-o FILE` (and `-M FILE` when `allowMap`) plus positional arguments; anything else is a usage error. */
function split(args: readonly string[], allowMap: boolean): { out?: string; map?: string; rest: string[] } {
  const r: { out?: string; map?: string; rest: string[] } = { rest: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    const opt = a === '-o' || (allowMap && a === '-M') ? a : a.startsWith('-o') && a.length > 2 ? '-o' : allowMap && a.startsWith('-M') && a.length > 2 ? '-M' : undefined;
    if (opt === undefined) {
      if (a.startsWith('-') && a.length > 1) throw new UsageError(`unknown option '${a}'`);
      r.rest.push(a);
      continue;
    }
    const value = a.length > 2 ? a.slice(2) : args[++i];
    if (value === undefined) throw new UsageError(`option '${opt}' needs a value`);
    if (opt === '-o') r.out = value;
    else r.map = value;
  }
  return r;
}

/** Runs `asm` or `dsk` (`args` follow the subcommand's name). Returns the exit code. */
export function runSubcommand(name: (typeof SUBCOMMANDS)[number], args: readonly string[], io: CliIo): number {
  try {
    return name === 'asm' ? runAsm(args, io) : runDsk(args, io);
  } catch (e) {
    if (e instanceof UsageError) return usage(io, `${name}: ${e.message}`);
    throw e;
  }
}

function runAsm(args: readonly string[], io: CliIo): number {
  const { out, map, rest } = split(args, true);
  if (rest.length !== 1) throw new UsageError(rest.length === 0 ? 'no source file' : `more than one source file ('${rest.join("', '")}')`);
  if (out === undefined) throw new UsageError('-o OUT.bin is needed');
  const src = normalizePath(rest[0] as string);
  const text = io.readFile(src);
  if (text === undefined) {
    io.stderr(`cpcbas: error E003: cannot read '${src}': file not found\n`);
    return 1;
  }
  const sources = new SourceSet();
  // Latin-1: a source's bytes above 127 stay one character each, as the reference assembler read them.
  const entry = sources.add(src, new TextDecoder('latin1').decode(text), 'user');
  const result = assemble({ sources, entry, resolveInclude: () => undefined, options: { initMode: 'zxbasm' } });
  const problems = result.diagnostics.filter((d) => d.severity !== 'note');
  for (const d of problems) io.stderr(`${formatDiagnostic(d, sources)}\n`);
  if (!result.ok || problems.some((d) => d.severity === 'error')) return 1;
  try {
    io.writeFile(out, flatten(result.segments).bytes);
    if (map !== undefined) io.writeFile(map, new TextEncoder().encode(formatMap(result)));
  } catch (e) {
    io.stderr(`cpcbas: error E010: cannot write: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
  return 0;
}

function runDsk(args: readonly string[], io: CliIo): number {
  const { out, rest } = split(args, false);
  if (out === undefined) throw new UsageError('-o OUT.dsk is needed');
  if (rest.length === 0) throw new UsageError('no files (NAME=FILE@LOAD[:EXEC])');
  const files = rest.map((spec) => {
    const m = /^([^=@]+)=(.+)@([^@:]+)(?::([^@:]+))?$/.exec(spec);
    if (m === null) throw new UsageError(`'${spec}' is not NAME=FILE@LOAD[:EXEC]`);
    const load = num(m[3] as string, `'${spec}' load address`);
    const exec = m[4] === undefined ? load : num(m[4], `'${spec}' entry address`);
    return { name: (m[1] as string).toUpperCase(), path: m[2] as string, load, exec };
  });
  const disc = files.map((f) => {
    const data = io.readFile(normalizePath(f.path));
    return data === undefined ? f.path : { name: f.name, data, loadAddress: f.load, entryAddress: f.exec, fileType: 2 as const };
  });
  const missing = disc.filter((d): d is string => typeof d === 'string');
  if (missing.length > 0) {
    for (const p of missing) io.stderr(`cpcbas: error E003: cannot read '${p}': file not found\n`);
    return 1;
  }
  const built = buildDsk(disc as Exclude<(typeof disc)[number], string>[]);
  if (!built.ok) {
    io.stderr(`cpcbas: error ${built.error.code}: ${built.error.message}\n`);
    return 1;
  }
  try {
    io.writeFile(out, built.value);
  } catch (e) {
    io.stderr(`cpcbas: error E010: cannot write '${out}': ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
  return 0;
}
