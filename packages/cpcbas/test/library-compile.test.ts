/**
 * L3-LIB: every BASIC file of lib/ (cpcbuild.bas, cpcbuild/, cpcplus/, music/, stdlib/) compiles with cpcbas.
 * For each file a program includes it and calls every SUB and FUNCTION it declares (arguments are zeros and "A"),
 * built for -D CPC464, -D CPC6128 and -D PLUS, firmware and (where the file supports it) -D CPC_BAREMETAL.
 * The signatures are read from the library file itself, so a new SUB is tested without editing this file.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile, formatDiagnostic } from '../src/index.js';
import { repoRoot } from './z80sim/run.js';

const libDir = join(repoRoot, 'lib');

/** All of lib/ (.asm and .bas), keyed by path relative to lib/, as the CLI's --runtime reads it. */
function loadLib(): Map<string, string> {
  const tree = new Map<string, string>();
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, `${prefix}${name}/`);
      else if (/\.(asm|bas)$/.test(name)) tree.set(`${prefix}${name}`, readFileSync(full, 'latin1'));
    }
  };
  walk(libDir, '');
  return tree;
}
const lib = loadLib();

interface Proc {
  readonly name: string;
  readonly isFunction: boolean;
  readonly params: readonly string[];
}

/** SUB and FUNCTION declarations of a file (outside comments and ASM blocks), one per name. */
export function procsOf(text: string): Proc[] {
  const out = new Map<string, Proc>();
  let inAsm = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const lower = line.toLowerCase();
    if (lower === 'asm' || lower.startsWith('asm ')) inAsm = true;
    else if (lower.startsWith('end asm')) inAsm = false;
    if (inAsm || line.startsWith("'")) continue;
    const m = /^(sub|function)\s+(?:fastcall\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:\((.*)\))?\s*(?:as\s+\w+)?\s*$/i.exec(line);
    if (!m || out.has((m[2] as string).toLowerCase())) continue;
    const params = (m[3] ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p !== '')
      .map((p) => (/\bas\s+string\b/i.test(p) ? '"A"' : '0'));
    out.set((m[2] as string).toLowerCase(), { name: m[2] as string, isFunction: m[1]!.toLowerCase() === 'function', params });
  }
  return [...out.values()];
}

/** A file and the files it includes (`#include once <x>`), depth first. */
function withIncludes(path: string, seen = new Set<string>()): string[] {
  if (seen.has(path)) return [];
  seen.add(path);
  const text = lib.get(path) ?? '';
  const out = [path];
  for (const m of text.matchAll(/^#include\s+(?:once\s+)?<([^>]+)>/gim)) {
    const inc = m[1] as string;
    if (lib.has(inc) && inc.endsWith('.bas')) out.push(...withIncludes(inc, seen));
  }
  return out;
}

/** Files that a program must include first for the file's own SUBs to exist (the banked-song SUB of the music player needs banks.bas). */
const INCLUDE_FIRST = new Map<string, string>([
  ['music/music.bas', 'cpcbuild/banks.bas'],
  ['music/music_cpc.bas', 'cpcbuild/banks.bas'],
]);

/**
 * SUBs the library does not define in one build mode (they are `#ifdef`'d out, so using one is an undefined-function
 * error): the raster interrupts need bare-metal mode, the firmware sound manager needs the firmware.
 */
const BARE_ONLY = new Set(['rasterintat', 'rasterintoff', 'rasterintclear', 'rasterintmove']);
const FIRMWARE_ONLY = new Set(['soundqueue', 'soundfree', 'soundbusy', 'soundenvelope', 'bankload']);

export function programFor(path: string, bare = false): string {
  const first = INCLUDE_FIRST.get(path);
  const procs = [...(first ? withIncludes(first) : []), ...withIncludes(path)].flatMap((p) => procsOf(lib.get(p) ?? ''));
  const seen = new Set<string>();
  const lines = [...(first ? [`#include <${first}>`] : []), `#include <${path}>`, 'DIM dummy AS ULONG'];
  for (const p of procs) {
    const key = p.name.toLowerCase();
    if (seen.has(key)) continue;
    if (bare ? FIRMWARE_ONLY.has(key) : BARE_ONLY.has(key)) continue;
    seen.add(key);
    const args = p.params.join(', ');
    lines.push(p.isFunction ? `dummy = ${p.name}(${args})` : `${p.name}(${args})`);
  }
  lines.push('END');
  return lines.filter((l) => l !== '').join('\n') + '\n';
}

type Model = 'CPC464' | 'CPC6128' | 'PLUS';
const MODELS: readonly Model[] = ['CPC464', 'CPC6128', 'PLUS'];

/** Library files that do not build with -D CPC_BAREMETAL, with the reason. */
const NO_BARE = new Map<string, string>();

const files = [...lib.keys()].filter((p) => p.endsWith('.bas') && !p.startsWith('music/quiet')).sort();

function build(path: string, model: Model, bare: boolean) {
  const defines: Record<string, string> = { [model]: '' };
  if (bare) defines.CPC_BAREMETAL = '';
  const r = compile({
    files: new Map([['main.bas', programFor(path, bare)]]),
    main: 'main.bas',
    defines,
    runtime: lib,
    options: { format: 'bin' },
  });
  return { r, errors: r.diagnostics.filter((d) => d.severity === 'error').map((d) => formatDiagnostic(d, r.sources)) };
}

describe('library files compile', () => {
  for (const path of files) {
    for (const model of MODELS) {
      it(`${path} (${model}, firmware)`, () => {
        expect(build(path, model, false).errors).toEqual([]);
      });
      if (!NO_BARE.has(path)) {
        it(`${path} (${model}, bare-metal)`, () => {
          expect(build(path, model, true).errors).toEqual([]);
        });
      }
    }
  }
});

describe('the generated programs call the library', () => {
  it('every file with SUBs or FUNCTIONS gets calls, and the umbrella file calls its parts', () => {
    expect(procsOf(lib.get('cpcbuild/display.bas') as string).map((p) => p.name)).toContain('WaitRetrace');
    const umbrella = programFor('cpcbuild.bas');
    for (const name of ['ScreenInit', 'PutSprite', 'FillRect', 'TileMap', 'ScanKeys', 'SetPalette', 'SprListBegin', 'TextAt']) {
      expect(umbrella, name).toContain(name);
    }
    for (const path of ['cpcbuild/banks.bas', 'cpcplus/cpcplus.bas', 'cpcplus/sprman.bas', 'music/music_cpc.bas', 'stdlib/cpc.bas']) {
      expect(programFor(path).split('\n').length, path).toBeGreaterThan(8);
    }
  });
});

describe('the bundled song', () => {
  it.each(['CPC464', 'CPC6128'])('music.bas with quiet.bas plays it (%s)', (model) => {
    const src = '#include <music/music.bas>\n#include <music/quiet.bas>\nMusicInit(@quiet, 0)\nMusicStop()\nEND\n';
    const r = compile({ files: new Map([['main.bas', src]]), main: 'main.bas', defines: { [model]: '' }, runtime: lib, options: { format: 'bin' } });
    expect(r.diagnostics.filter((d) => d.severity === 'error').map((d) => formatDiagnostic(d, r.sources))).toEqual([]);
  });
});

describe('tests/e2e/lib-smoke.bas', () => {
  it.each(['CPC464', 'CPC6128'])('builds (%s); tools run it on chipsrun', (model) => {
    const src = readFileSync(join(repoRoot, 'tests/e2e/lib-smoke.bas'), 'latin1');
    const r = compile({ files: new Map([['lib-smoke.bas', src]]), main: 'lib-smoke.bas', defines: { [model]: '', __CPC_PRINTER_ECHO__: '1' }, runtime: lib, options: { format: 'bin' } });
    expect(r.diagnostics.filter((d) => d.severity === 'error').map((d) => formatDiagnostic(d, r.sources))).toEqual([]);
    expect(r.binary?.length ?? 0).toBeGreaterThan(1000);
  });
});
