/**
 * L5-DIFF: the program set of the simulator differential tests (layer 1): the inline programs of the `*-run.test.ts` files
 * (test/opt-corpus.json, recorded with `npm run opt:corpus`), and the program files that the simulator tests and the gates
 * run: tests/loco, tests/conformance, tests/fork-diff.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CorpusEntry } from './opt-shadow.js';
import type { Program } from './opt-harness.js';
import { repoRoot } from './z80sim/run.js';

const here = dirname(fileURLToPath(import.meta.url));
export const corpusFile = join(here, 'opt-corpus.json');

const read = (path: string): string => readFileSync(path, 'latin1');

/** REM LOCO-DISK: NAME=path (relative to the program): a file on the disc, as tools/loco-diff.py puts it there. */
export function discOf(text: string, dir: string): { disc?: Record<string, string> } {
  const disc: Record<string, string> = {};
  for (const m of text.matchAll(/^\d*\s*REM LOCO-DISK:\s*([^=\s]+)=(\S+)/gm)) disc[m[1]!.toUpperCase()] = read(join(dir, m[2]!));
  return Object.keys(disc).length > 0 ? { disc } : {};
}

function locoPrograms(): Program[] {
  const dir = join(repoRoot, 'tests/loco');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.bas'))
    .sort()
    .map((f) => {
      const text = read(join(dir, f));
      // REM LOCO-TYPE: the entries are typed ahead, each followed by RETURN (as test/loco-conformance.test.ts)
      const typed = /^\d+ REM LOCO-TYPE: ?(.*)$/m.exec(text)?.[1]?.replace(/\r$/, '').split('|').map((e) => `${e}\r`).join('');
      return { name: `loco/${f}`, files: text, ...(typed !== undefined ? { keys: typed } : {}), ...discOf(text, dir) };
    });
}

/**
 * The header lines that keep a conformance program out of the level comparison. Narrower than `conformance-sim.test.ts`'s rules
 * (follow-up 220): the comparison needs the program to run to its end at -O0 and the levels to agree, not to pass its own checks,
 * so `REM SIM: skip` (the fake firmware draws nothing, has no AY, ...) and `REM TYPE:` (the keys are typed ahead) no longer
 * exclude. Still out: `XFAIL` (waiting for a task), `BARE: only` (a bare-metal build, not this firmware-mode build), and
 * `MODELS` without 6128 (the Plus ASIC, the 464's own build).
 */
function conformanceSkip(text: string): boolean {
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*REM\s+XFAIL:/i.test(line)) return true;
    const bare = /^\s*REM\s+BARE:\s*(\w+)/i.exec(line);
    if (bare !== null && bare[1]!.toLowerCase() === 'only') return true;
    const models = /^\s*REM\s+MODELS:\s*(.*?)\s*$/i.exec(line);
    if (models !== null && !models[1]!.toLowerCase().split(/\s+/).includes('6128')) return true;
  }
  return false;
}

/** `REM TYPE: text` lines: what the runner types while the program runs, each followed by RETURN (tools/conformance.py). */
function typedKeys(text: string): string | undefined {
  const lines = [...text.matchAll(/^\s*REM\s+TYPE:[ \t]*(.*?)[ \t]*\r?$/gim)].map((m) => `${m[1]!}\r`);
  return lines.length > 0 ? lines.join('') : undefined;
}

/** `REM DISKFILE: NAME=path` lines (the path is relative to tests/conformance): files on the disc. */
function diskFiles(text: string): { disc?: Record<string, string> } {
  const disc: Record<string, string> = {};
  for (const m of text.matchAll(/^\s*REM\s+DISKFILE:\s*([^=\s]+)=(\S+)/gim)) disc[m[1]!.toUpperCase()] = read(join(repoRoot, 'tests/conformance', m[2]!));
  return Object.keys(disc).length > 0 ? { disc } : {};
}

/**
 * Conformance programs that print or store what they time (ticks, frame counts, T-states per call): `Program.timing`. Found by
 * running the layer: each differs between levels in the clock variables only (`_t0`, `_tickAnswer`, frame counters), never in
 * the verdict lines.
 */
const TIMING = new Set([
  'cb_display.bas', 'cb_sprites.bas', 'cb_tilerestore.bas', 'cb_tiles.bas', 'framehook.bas', 'framehook_game.bas', 'isr.bas', 'play.bas',
  'plus_none.bas', 'plus_none_hi.bas', 'music.bas', 'music_hook.bas', 'banks_music.bas',
  // keeps the start-up Frames() count in `_f0`, a clock value (the other verdicts agree at every level)
  'banks_disc.bas',
]);

function conformancePrograms(): Program[] {
  const dir = join(repoRoot, 'tests/conformance');
  const files = new Map<string, string>();
  const walk = (sub: string): void => {
    for (const entry of readdirSync(join(dir, sub), { withFileTypes: true })) {
      const rel = sub === '' ? entry.name : `${sub}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith('.bas')) files.set(rel, read(join(dir, rel)));
    }
  };
  walk('');
  return [...files.keys()]
    .filter((k) => !k.includes('/') && !conformanceSkip(files.get(k)!))
    .sort()
    .map((k) => ({
      name: `conformance/${k}`,
      files,
      main: k,
      defines: { CPC6128: '' },
      // needs more than 60 s of emulated time: it runs 460 M T-states here (the emulator's 60 s is more: wait states)
      ...(k === 'cb_tilewidth.bas' ? { maxTStates: 1_500_000_000 } : {}),
      ...(TIMING.has(k) ? { timing: true } : {}),
      // `results$` holds a heap pointer: the spilled arguments of L5-GAP leave fewer temporaries alive, so it lands a few bytes elsewhere
      // (0x8F86 at -O0, 0x8F81 at -O2; the same free bytes at the end, the same transcript). The heap's free bytes are compared instead.
      ...(k === 'cb_fill.bas' ? { heapOrder: true } : {}),
      // a tolerance band around a duration that a faster level moves across the edge: -O0 and -Os fail it, -O1 to -O3 pass it
      ...(k === 'framehook_game.bas' ? { speedChecks: ['g_print_frames_vs_normal'] } : {}),
      ...(typedKeys(files.get(k)!) !== undefined ? { keys: typedKeys(files.get(k)!)! } : {}),
      ...diskFiles(files.get(k)!),
      // copies the restart area, whose vectors hold the runtime's routine addresses: they move when the runtime is stripped
      ...(k === 'lowram.bas' ? { compareData: false } : {}),
      // keeps the firmware's absolute 300 Hz clock in `tickAnswer` (lib/ticks.bas): a faster program reads a clock one tick apart (L5-CG)
      ...(k === 'textio.bas' ? { compareData: false } : {}),
    }));
}

function forkDiffPrograms(): Program[] {
  const dir = join(repoRoot, 'tests/fork-diff');
  const common = read(join(dir, 'common.bas'));
  return readdirSync(dir)
    .filter((f) => f.endsWith('.bas') && f !== 'common.bas')
    .sort()
    .map((f) => ({ name: `fork-diff/${f}`, files: new Map([['t.bas', read(join(dir, f))], ['common.bas', common]]) }));
}

/**
 * R17: em00k's flow-optimiser bugs as programs, and the aliasing case of
 * docs/ir.md's memory-fact rule. Each prints a value that a pass with the bug gets wrong (test/opt-bugs.test.ts shows it).
 */
/** Bug 1: `ptr = @x : x = 1 : POKE ptr, 2 : result = x` gives 1 at -O3 in the fork. */
export const BUG1: Program = {
  name: 'bug/1-pointer-store',
  files: 'DIM x AS INTEGER\nDIM ptr AS UINTEGER\nDIM result AS INTEGER\nptr = @x : x = 1 : POKE UINTEGER, ptr, 2 : result = x\nPRINT result\n',
};
/** Bug 4 in this dialect: a byte of a word is known (`(_n0+1)`), the word is stored, the byte is read back. */
export const BUG4: Program = {
  name: 'bug/4-overlap',
  files: 'DIM n0 AS UINTEGER\nDIM b AS UBYTE\nPOKE @n0 + 1, 7 : n0 = 2 : b = PEEK(@n0 + 1)\nPRINT b; n0\n',
};
/** A folded address past the end of its variable: `@n0 + 3` is n1's high byte, so the POKE changes n1 (5 + 256). */
export const ALIAS: Program = {
  name: 'bug/alias-next-variable',
  files: 'DIM n0 AS UINTEGER\nDIM n1 AS UINTEGER\nn1 = 5 : POKE @n0 + 3, 1 : PRINT n1\n',
};

export function corpusPrograms(): Program[] {
  // missing before the first `npm run opt:corpus`
  const entries = existsSync(corpusFile) ? (JSON.parse(readFileSync(corpusFile, 'utf8')) as CorpusEntry[]) : [];
  return entries.map((e, i) => ({
    name: `corpus/${String(i).padStart(3, '0')}`,
    files: e.src,
    ...(e.keys !== undefined ? { keys: e.keys } : {}),
    ...(e.maxTStates !== undefined ? { maxTStates: e.maxTStates } : {}),
  }));
}

/**
 * Programs whose globals hold an address that a pass can move by changing the code's size: `@label` stored in a variable, a
 * string handed to CALL (its descriptor's address), and the conformance programs that read bytes of the code area
 * (`PEEK(&0300)`, the ROM-off probe, `lowram`'s snapshot). Their transcripts are still compared.
 */
const LAYOUT = /=\s*@[A-Za-z_]|CALL\s+&?[0-9A-Fa-f]+\s*,\s*("|[A-Za-z_]\w*\$)|PEEK\(&0300\)|PEEK\(&9E33\)/i;

/** `lowram` snapshots the restart area, which holds the address of our interrupt routine. */
const LAYOUT_FILES = new Set(['conformance/lowram.bas']);

/** Every program of the layer, in a fixed order. */
export function allPrograms(): Program[] {
  const text = (p: Program): string => (typeof p.files === 'string' ? p.files : (p.files.get(p.main ?? 't.bas') ?? ''));
  const marked = [...locoPrograms(), ...conformancePrograms(), ...forkDiffPrograms(), ...corpusPrograms()].map((p) =>
    LAYOUT.test(text(p)) || LAYOUT_FILES.has(p.name) ? { ...p, layoutDependent: true } : p,
  );
  return [...marked, BUG1, BUG4, ALIAS];
}

/** Shard `index` of `count`: the layer is split over several test files so that the workers share it. */
export function shardOf(index: number, count: number): Program[] {
  return allPrograms().filter((_, i) => i % count === index);
}
