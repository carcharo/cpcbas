/**
 * The assembler's byte oracle: every file under lib/runtime (in a firmware and a bare-metal
 * variant) and the reference compiler's programs must assemble to the bytes and the map the
 * reference assembler (zxbasm) produced. Fixtures: tests/asm-golden (README.md there).
 *
 * The comparison suite is switched on by `IMPLEMENTED` in src/asm/index.ts (task L2-ASM).
 * The checks on the fixtures themselves (every runtime file covered, no orphans) always run.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { IMPLEMENTED } from '../src/asm/index.js';
import type {
  AssembleFn,
  AssembleResult,
  AsmSymbol,
  FlattenFn,
  FormatMapFn,
  IncludeResolver,
} from '../src/asm/types.js';
import { SourceSet, dirname as vdirname, joinPath, normalizePath } from '../src/core/source.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const runtimeDir = join(repo, 'lib/runtime');
const goldenDir = join(repo, 'tests/asm-golden');

type Variant = 'fw' | 'bare';
const VARIANTS: readonly Variant[] = ['fw', 'bare'];

/**
 * The text assembled for lib/runtime/<path>. Must equal wrapper_text() in
 * tools/asm-oracle/gen-goldens.py. The EQUs are the memory map the compiler's prologue emits
 * (src/arch/cpc/backend/main.py) and the heap symbols of its heap definitions.
 */
export function wrapperText(path: string, variant: Variant): string {
  const [privBase, privSize, stackTop, memTop, heap] =
    variant === 'bare' ? [48128, 1024, 48128, 49151, 42336] : [40448, 1024, 42496, 42619, 35680];
  const lines = [
    'org 64',
    `.core.CPC_PRIV_BASE EQU ${privBase}`,
    `.core.CPC_PRIV_SIZE EQU ${privSize}`,
    `.core.CPC_STACK_TOP EQU ${stackTop}`,
    `.core.CPC_MEM_TOP EQU ${memTop}`,
    '.core.ZXBASIC_HEAP_SIZE EQU 4768',
    `.core.ZXBASIC_MEM_HEAP EQU ${heap}`,
  ];
  if (variant === 'bare') lines.push('#define CPC_BAREMETAL');
  lines.push(`#include once <${path}>`);
  return `${lines.join('\n')}\n`;
}

function walk(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, `${prefix}${name}/`));
    else out.push(`${prefix}${name}`);
  }
  return out;
}

const hex = (n: number, width = 4): string => n.toString(16).toUpperCase().padStart(width, '0');

/**
 * Describes the first difference between two flat images, or returns undefined when equal.
 * The address is `org + index`; the symbol is the label at or below it (highest value
 * first-wins by name order), so a wrong byte can be traced to a routine.
 */
export function describeFirstDifference(
  expected: Uint8Array,
  actual: { org: number; bytes: Uint8Array },
  symbols: readonly AsmSymbol[],
): string | undefined {
  const n = Math.min(expected.length, actual.bytes.length);
  let at = -1;
  for (let i = 0; i < n; i++) {
    if (expected[i] !== actual.bytes[i]) {
      at = i;
      break;
    }
  }
  if (at < 0 && expected.length === actual.bytes.length) return undefined;
  if (at < 0) at = n;
  const addr = actual.org + at;
  let sym: AsmSymbol | undefined;
  for (const s of symbols) {
    if (s.kind === 'label' && s.scope === 'global' && s.value <= addr && (!sym || s.value >= sym.value)) sym = s;
  }
  const where = sym ? `${sym.name}+${addr - sym.value}` : '(no symbol at or below)';
  const want = at < expected.length ? `0x${hex(expected[at] as number, 2)}` : 'end of image';
  const got = at < actual.bytes.length ? `0x${hex(actual.bytes[at] as number, 2)}` : 'end of image';
  return (
    `first difference at 0x${hex(addr)} (${where}): expected ${want}, got ${got}; ` +
    `expected ${expected.length} bytes, got ${actual.bytes.length} (image org 0x${hex(actual.org)})`
  );
}

/** First differing line of two texts, or undefined when equal. */
export function describeFirstTextDifference(expected: string, actual: string): string | undefined {
  if (expected === actual) return undefined;
  const e = expected.split('\n');
  const a = actual.split('\n');
  for (let i = 0; i < Math.max(e.length, a.length); i++) {
    if (e[i] !== a[i]) return `map line ${i + 1}: expected ${JSON.stringify(e[i])}, got ${JSON.stringify(a[i])}`;
  }
  return 'map texts differ';
}

interface Excluded {
  readonly path: string;
  readonly variant: Variant;
  readonly reason: string;
}

function readExcluded(sub = 'runtime'): Excluded[] {
  const text = readFileSync(join(goldenDir, sub, 'excluded.txt'), 'latin1');
  const out: Excluded[] = [];
  for (const line of text.split('\n')) {
    if (line === '') continue;
    const [path, variant, ...rest] = line.split('\t');
    out.push({ path: path ?? '', variant: variant as Variant, reason: rest.join('\t') });
  }
  return out;
}

const runtimeFiles = walk(runtimeDir);
const excluded = readExcluded();
const isExcluded = (path: string, variant: Variant): boolean =>
  excluded.some((e) => e.path === path && e.variant === variant);

const fixturePath = (path: string, variant: Variant, ext: 'bin' | 'map', sub = 'runtime'): string =>
  join(goldenDir, sub, `${path}.${variant}.${ext}`);

/** The asm files of the BASIC library (lib/cpcbuild, lib/cpcplus, lib/music), as `dir/name.asm`; fixtures in tests/asm-golden/library. */
const libDir = join(repo, 'lib');
const libraryFiles = ['cpcbuild', 'cpcplus', 'music'].flatMap((d) => walk(join(libDir, d), `${d}/`).filter((f) => f.endsWith('.asm')));
const libraryExcluded = readExcluded('library');
const isLibraryExcluded = (path: string, variant: Variant): boolean =>
  libraryExcluded.some((e) => e.path === path && e.variant === variant);

const programNames = walk(join(goldenDir, 'programs'))
  .filter((f) => f.endsWith('.asm'))
  .map((f) => f.slice(0, -4));

describe('asm golden fixtures', () => {
  it('every lib/runtime file has fixtures or an excluded.txt line', () => {
    const problems: string[] = [];
    for (const path of runtimeFiles) {
      for (const variant of VARIANTS) {
        const has = existsSync(fixturePath(path, variant, 'bin')) && existsSync(fixturePath(path, variant, 'map'));
        if (isExcluded(path, variant)) {
          if (has) problems.push(`${path} (${variant}): excluded but has fixtures`);
        } else if (!has) {
          problems.push(`${path} (${variant}): no fixtures and not in excluded.txt`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('every library asm file has fixtures or a library/excluded.txt line', () => {
    expect(libraryFiles.length).toBeGreaterThanOrEqual(38);
    const problems: string[] = [];
    for (const path of libraryFiles) {
      for (const variant of VARIANTS) {
        const has =
          existsSync(fixturePath(path, variant, 'bin', 'library')) && existsSync(fixturePath(path, variant, 'map', 'library'));
        if (isLibraryExcluded(path, variant)) {
          if (has) problems.push(`${path} (${variant}): excluded but has fixtures`);
        } else if (!has) {
          problems.push(`${path} (${variant}): no fixtures and not in library/excluded.txt`);
        }
      }
    }
    expect(problems).toEqual([]);
    for (const e of libraryExcluded) expect(libraryFiles, e.path).toContain(e.path);
  });

  it('every excluded.txt line names a runtime file and carries the reference error text', () => {
    expect(excluded.length).toBeGreaterThan(0);
    for (const e of excluded) {
      expect(runtimeFiles, e.path).toContain(e.path);
      expect(VARIANTS, e.path).toContain(e.variant);
      expect(e.reason.length, `${e.path} (${e.variant})`).toBeGreaterThan(0);
    }
    expect(new Set(excluded.map((e) => `${e.path} ${e.variant}`)).size).toBe(excluded.length);
  });

  it('there are no fixture files without a runtime file or program', () => {
    const known = new Set<string>(['runtime/excluded.txt']);
    for (const path of runtimeFiles) {
      for (const variant of VARIANTS) for (const ext of ['bin', 'map']) known.add(`runtime/${path}.${variant}.${ext}`);
    }
    for (const name of programNames) for (const ext of ['asm', 'bin', 'map']) known.add(`programs/${name}.${ext}`);
    known.add('library/excluded.txt');
    for (const path of libraryFiles) {
      for (const variant of VARIANTS) for (const ext of ['bin', 'map']) known.add(`library/${path}.${variant}.${ext}`);
    }
    const orphans = walk(goldenDir).filter((f) => f !== 'README.md' && !known.has(f));
    expect(orphans).toEqual([]);
  });

  it('every program has an asm, a bin and a map; the set covers the functional programs, firmware and bare builds', () => {
    expect(programNames.length).toBeGreaterThanOrEqual(21);
    for (const name of programNames) {
      for (const ext of ['bin', 'map']) {
        expect(existsSync(join(goldenDir, 'programs', `${name}.${ext}`)), `${name}.${ext}`).toBe(true);
      }
    }
    expect(programNames.some((n) => n.includes('bare'))).toBe(true);
    expect(programNames.some((n) => n.includes('plus'))).toBe(true);
  });

  it('the wrapper text is the documented one', () => {
    expect(wrapperText('print.asm', 'fw')).toBe(
      [
        'org 64',
        '.core.CPC_PRIV_BASE EQU 40448',
        '.core.CPC_PRIV_SIZE EQU 1024',
        '.core.CPC_STACK_TOP EQU 42496',
        '.core.CPC_MEM_TOP EQU 42619',
        '.core.ZXBASIC_HEAP_SIZE EQU 4768',
        '.core.ZXBASIC_MEM_HEAP EQU 35680',
        '#include once <print.asm>',
        '',
      ].join('\n'),
    );
    const bare = wrapperText('print.asm', 'bare').split('\n');
    expect(bare.slice(1, 5)).toEqual([
      '.core.CPC_PRIV_BASE EQU 48128',
      '.core.CPC_PRIV_SIZE EQU 1024',
      '.core.CPC_STACK_TOP EQU 48128',
      '.core.CPC_MEM_TOP EQU 49151',
    ]);
    expect(bare.slice(-3, -1)).toEqual(['#define CPC_BAREMETAL', '#include once <print.asm>']);
  });

  it('reports the first differing address, byte and symbol', () => {
    const sym = (name: string, value: number): AsmSymbol => ({
      name,
      value,
      kind: 'label',
      scope: 'global',
      inMap: true,
      span: { file: 0 as never, start: 0, end: 0 },
    });
    const symbols = [sym('.core.A', 0x40), sym('.core.B', 0x50)];
    const msg = describeFirstDifference(
      Uint8Array.of(1, 2, 3, 4),
      { org: 0x4e, bytes: Uint8Array.of(1, 2, 9, 4) },
      symbols,
    );
    expect(msg).toContain('0x0050');
    expect(msg).toContain('.core.B+0');
    expect(msg).toContain('expected 0x03, got 0x09');
    expect(describeFirstDifference(Uint8Array.of(1), { org: 1, bytes: Uint8Array.of(1) }, [])).toBeUndefined();
    expect(describeFirstDifference(Uint8Array.of(1, 2), { org: 1, bytes: Uint8Array.of(1) }, [])).toContain(
      'expected 0x02, got end of image',
    );
    expect(describeFirstTextDifference('a\nb', 'a\nc')).toContain('map line 2');
    expect(describeFirstTextDifference('a', 'a')).toBeUndefined();
  });
});

/** Resolves includes in lib/runtime: angle names from its root; quoted names from the including file's directory first. */
function runtimeResolver(): IncludeResolver {
  const known = new Set(runtimeFiles);
  const libKnown = new Set(libraryFiles);
  return (name, fromPath, angle) => {
    // the BASIC library's asm (`<cpcbuild/core.asm>`) is found in lib/ after the runtime, as the reference's extra include path
    const libHit = (): ReturnType<IncludeResolver> => {
      const rel = normalizePath(name);
      return libKnown.has(rel) ? { path: `lib/${rel}`, text: readFileSync(join(libDir, rel), 'latin1') } : undefined;
    };
    const candidates: string[] = [];
    if (!angle && fromPath.startsWith('lib/runtime/')) {
      candidates.push(joinPath(vdirname(fromPath).slice('lib/runtime'.length + 1), name));
    }
    candidates.push(normalizePath(name));
    for (const rel of candidates) {
      if (known.has(rel)) {
        return { path: `lib/runtime/${rel}`, text: readFileSync(join(runtimeDir, rel), 'latin1') };
      }
    }
    return libHit();
  };
}

interface AsmApi {
  assemble: AssembleFn;
  flatten: FlattenFn;
  formatMap: FormatMapFn;
}

/** The assembler is loaded only when the suite runs: L2-ASM exports `flatten` and `formatMap` beside `assemble`. */
async function loadAssembler(): Promise<AsmApi> {
  const mod = (await import('../src/asm/index.js')) as unknown as Partial<AsmApi>;
  if (!mod.assemble || !mod.flatten || !mod.formatMap) {
    throw new Error('src/asm/index.ts must export assemble, flatten and formatMap once IMPLEMENTED is true');
  }
  return { assemble: mod.assemble, flatten: mod.flatten, formatMap: mod.formatMap };
}

function check(api: AsmApi, entryPath: string, text: string, binFile: string, mapFile: string): void {
  // a missing fixture fails loudly
  const expectedBin = new Uint8Array(readFileSync(binFile));
  const expectedMap = readFileSync(mapFile, 'latin1');
  const sources = new SourceSet();
  const entry = sources.add(entryPath, text, 'generated');
  const result: AssembleResult = api.assemble({
    sources,
    entry,
    resolveInclude: runtimeResolver(),
    options: { initMode: 'zxbasm' },
  });
  const errors = result.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.code} ${d.message}`);
  expect(errors, 'assembler errors').toEqual([]);
  const image = api.flatten(result.segments);
  // The reference .bin carries no origin: bytes are compared from the lowest address, and the map checks the addresses.
  const diff = describeFirstDifference(expectedBin, image, result.symbolsByAddress);
  expect(diff, 'bytes').toBeUndefined();
  const mapDiff = describeFirstTextDifference(expectedMap, api.formatMap(result));
  expect(mapDiff, 'map').toBeUndefined();
}

describe.skipIf(!IMPLEMENTED)('assembler matches the reference (runtime files)', () => {
  for (const path of runtimeFiles) {
    for (const variant of VARIANTS) {
      if (isExcluded(path, variant)) continue;
      it(`${path} (${variant})`, async () => {
        const api = await loadAssembler();
        check(api, 'wrapper.asm', wrapperText(path, variant), fixturePath(path, variant, 'bin'), fixturePath(path, variant, 'map'));
      });
    }
  }
});

describe.skipIf(!IMPLEMENTED)('assembler matches the reference (programs)', () => {
  for (const name of programNames) {
    it(name, async () => {
      const api = await loadAssembler();
      const base = join(goldenDir, 'programs', name);
      check(api, `programs/${name}.asm`, readFileSync(`${base}.asm`, 'latin1'), `${base}.bin`, `${base}.map`);
    });
  }
});

describe.skipIf(!IMPLEMENTED)('assembler matches the reference (library asm)', () => {
  for (const path of libraryFiles) {
    for (const variant of VARIANTS) {
      if (isLibraryExcluded(path, variant)) continue;
      it(`${path} (${variant})`, async () => {
        const api = await loadAssembler();
        check(
          api,
          'wrapper.asm',
          wrapperText(path, variant),
          fixturePath(path, variant, 'bin', 'library'),
          fixturePath(path, variant, 'map', 'library'),
        );
      });
    }
  }
});
