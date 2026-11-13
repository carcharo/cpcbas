/** L6-PKG: the package as cpcbuild and the Studio consume it: the `./node` helpers, the bundle, the browser entry, the pack smoke. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { compile } from '../src/index.js';
import { defaultRuntimeDir, diskTree, loadRuntime, readTree } from '../src/node/index.js';
import { run } from '../bin/cli.js';
import { libTree } from './runtime-tree.js';
import { repoRoot } from './z80sim/run.js';

const tmp = mkdtempSync(join(tmpdir(), 'cpcbas-pkg-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const tools = async (name: string): Promise<Record<string, (...a: unknown[]) => Promise<unknown>>> =>
  (await import(pathToFileURL(join(repoRoot, 'tools', name)).href)) as never;

describe('./node helpers', () => {
  it('diskTree reads lazily, relative to the directory, absolute paths pass through', () => {
    const dir = join(tmp, 'dt');
    mkdirSync(join(dir, 'sub'), { recursive: true });
    writeFileSync(join(dir, 'sub', 'a.bas'), 'hello');
    writeFileSync(join(tmp, 'abs.bas'), 'abs');
    const tree = diskTree(dir);
    expect(tree.has('sub/a.bas')).toBe(true);
    expect(tree.has('sub')).toBe(false);
    expect(tree.has('missing.bas')).toBe(false);
    expect(Buffer.from(tree.get('sub/a.bas') as Uint8Array).toString()).toBe('hello');
    expect(Buffer.from(tree.get(join(tmp, 'abs.bas')) as Uint8Array).toString()).toBe('abs');
  });

  it('readTree keeps .bas files by default, sorted, POSIX paths, skips node_modules', () => {
    const dir = join(tmp, 'rt');
    for (const f of ['b.bas', 'a/z.BAS', 'a/y.txt', 'node_modules/p/x.bas', 'c.dat']) {
      mkdirSync(join(dir, f, '..'), { recursive: true });
      writeFileSync(join(dir, f), f);
    }
    expect([...readTree(dir).keys()]).toEqual(['a/z.BAS', 'b.bas']);
    expect([...readTree(dir, /\.(dat|txt)$/).keys()]).toEqual(['a/y.txt', 'c.dat']);
    expect([...readTree(dir, (p) => p.startsWith('a/')).keys()]).toEqual(['a/y.txt', 'a/z.BAS']);
    expect(Buffer.from(readTree(dir).get('b.bas') as Uint8Array).toString()).toBe('b.bas');
  });

  it('loadRuntime reads a given directory, and the checkout\'s lib/ by default', () => {
    expect(loadRuntime(join(repoRoot, 'lib')).has('runtime/print.asm')).toBe(true);
    expect(defaultRuntimeDir()).toBe(join(repoRoot, 'lib'));
    expect(loadRuntime().has('runtime/print.asm')).toBe(true);
    expect(loadRuntime(join(tmp, 'nowhere')).has('runtime/print.asm')).toBe(false);
  });

  it('the Studio\'s call shape compiles: diskTree + loadRuntime', () => {
    const dir = join(tmp, 'proj');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'main.bas'), '10 PRINT "HI"\n');
    const r = compile({ files: diskTree(dir), main: 'main.bas', runtime: loadRuntime(), options: { format: 'bin' } });
    expect(r.ok).toBe(true);
    expect(r.binary?.length).toBeGreaterThan(100);
  });
});

describe('package.json', () => {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'packages/cpcbas/package.json'), 'utf8')) as {
    version: string;
    files: string[];
    exports: Record<string, unknown>;
  };
  it('has the 0.2.0 development version, the ./node export and the runtime in files', () => {
    expect(pkg.version).toBe('0.2.0-dev');
    expect(Object.keys(pkg.exports)).toContain('./node');
    expect(pkg.files).toEqual(expect.arrayContaining(['dist/lib', 'dist/cpcbas.mjs']));
  });
});

/**
 * The runtime text a browser would ship: `;` comments and blank lines gone (a line with a quote keeps its text, so a `;`
 * inside a string stays), leading and trailing blanks trimmed. Used to measure, and to check it changes no output.
 */
function minifyText(text: string): string {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const l = (/["']/.test(line) ? line : line.split(';')[0] ?? '').trim();
    if (l !== '') out.push(l);
  }
  return out.join('\n');
}

describe('the browser entry', () => {
  it('builds without a Node module; minified code with the minified runtime text stays under 1.5 MB', async () => {
    const { bundleBrowser } = (await tools('bundle.mjs')) as { bundleBrowser: () => Promise<{ outputFiles: { contents: Uint8Array }[] }> };
    const out = await bundleBrowser(); // throws when the library reaches a `node:` module
    const code = (out.outputFiles[0] as { contents: Uint8Array }).contents.length;
    const rt = libTree();
    const mini = new Map([...rt].map(([k, v]) => [k, minifyText(v)]));
    const size = (m: Map<string, string>): number => [...m.values()].reduce((n, t) => n + t.length, 0);
    console.log(`browser entry: ${code} bytes minified code + ${size(mini)} bytes minified runtime text = ${code + size(mini)} (runtime text as it is in lib/: ${size(rt)}, together ${code + size(rt)})`);
    expect(code + size(mini)).toBeLessThan(1.5 * 1024 * 1024);
  });

  it('the minified runtime text compiles to the same bytes', () => {
    const mini = new Map([...libTree()].map(([k, v]) => [k, minifyText(v)]));
    for (const rel of ['tests/loco/hello.bas', 'tests/games/lamplighter/main.bas']) {
      const dir = join(repoRoot, rel, '..');
      const base = { files: diskTree(dir), main: rel.split('/').pop() as string, options: { format: 'bin' as const, buildDate: '2026-11-13' }, defines: { CPC6128: '' } };
      const a = compile({ ...base, runtime: libTree() });
      const b = compile({ ...base, runtime: mini });
      expect(a.ok, rel).toBe(true);
      expect(b.ok, rel).toBe(true);
      expect(Buffer.from(b.binary as Uint8Array).equals(Buffer.from(a.binary as Uint8Array)), rel).toBe(true);
    }
  });
});

describe('the bundle (dist/cpcbas.mjs)', () => {
  it('is one file with no dependencies and compiles to the same bytes as the CLI', async () => {
    const { bundleCli } = (await tools('bundle.mjs')) as { bundleCli: (out: string) => Promise<{ metafile: { inputs: Record<string, unknown> } }> };
    const out = join(tmp, 'bundle', 'cpcbas.mjs');
    const meta = await bundleCli(out);
    expect(Object.keys(meta.metafile.inputs).every((p) => !p.includes('node_modules'))).toBe(true);
    // lib/ beside it, and --runtime lib: both work
    const lib = join(tmp, 'bundle', 'lib');
    ((await tools('copy-lib.mjs')).copyLib as unknown as (to: string) => void)(lib);
    const hello = join(repoRoot, 'tests/loco/hello.bas');
    execFileSync('node', [out, hello, '-o', join(tmp, 'bundle', 'a.dsk')]);
    execFileSync('node', [out, '--runtime', lib, hello, '-o', join(tmp, 'bundle', 'b.dsk')]);
    const io = {
      readFile: (p: string) => {
        try {
          return readFileSync(resolve(repoRoot, p));
        } catch {
          return undefined;
        }
      },
      writeFile: (p: string, b: Uint8Array) => writeFileSync(p, b),
      stdout: () => undefined,
      stderr: () => undefined,
      cwd: repoRoot,
      defaultRuntime: join(repoRoot, 'lib'),
    };
    expect(await run([hello, '-o', join(tmp, 'bundle', 'c.dsk')], io)).toBe(0);
    const c = readFileSync(join(tmp, 'bundle', 'c.dsk'));
    expect(readFileSync(join(tmp, 'bundle', 'a.dsk')).equals(c)).toBe(true);
    expect(readFileSync(join(tmp, 'bundle', 'b.dsk')).equals(c)).toBe(true);
    // a game: Lamplighter 6128, the bundle (lib/ beside it) against the CLI
    const lamp = ['--org', '0x40', 'tests/games/lamplighter/main.bas', '-D', 'CPC6128', '-D', '__CPC_PRINTER_ECHO__', '-M'];
    execFileSync('node', [out, ...lamp, join(tmp, 'bundle', 'l1.map'), '-o', join(tmp, 'bundle', 'l1.bin')], { cwd: repoRoot, stdio: 'pipe' });
    expect(await run([...lamp, join(tmp, 'bundle', 'l2.map'), '-o', join(tmp, 'bundle', 'l2.bin')], io)).toBe(0);
    expect(readFileSync(join(tmp, 'bundle', 'l1.bin')).equals(readFileSync(join(tmp, 'bundle', 'l2.bin')))).toBe(true);
    expect(readFileSync(join(tmp, 'bundle', 'l1.map')).equals(readFileSync(join(tmp, 'bundle', 'l2.map')))).toBe(true);
  }, 60_000);
});

describe('npm pack smoke', () => {
  it('the installed tarball compiles hello.bas to the repo build\'s bytes, bin and bundle alike', async () => {
    const { packSmoke } = (await tools('pack-smoke.mjs')) as unknown as {
      packSmoke: (p: string, scratch: string) => Promise<{ files: string[]; bin: Buffer; bundle: Buffer; nodeEntry: boolean[] }>;
    };
    const hello = join(repoRoot, 'tests/loco/hello.bas');
    const r = await packSmoke(hello, tmp);
    expect(r.files).toEqual(expect.arrayContaining(['dist/bin/cpcbas.js', 'dist/src/index.js', 'dist/src/node/index.js', 'dist/cpcbas.mjs', 'dist/lib/runtime/print.asm', 'package.json']));
    expect(r.files.some((f) => f.endsWith('.test.js'))).toBe(false);
    expect(r.nodeEntry).toEqual([true, true]);
    const repoBuild = join(tmp, 'repo.dsk');
    const io = {
      readFile: (p: string) => {
        try {
          return readFileSync(resolve(repoRoot, p));
        } catch {
          return undefined;
        }
      },
      writeFile: (p: string, b: Uint8Array) => writeFileSync(p, b),
      stdout: () => undefined,
      stderr: () => undefined,
      cwd: repoRoot,
      defaultRuntime: join(repoRoot, 'lib'),
    };
    expect(await run([hello, '-o', repoBuild], io)).toBe(0);
    const expected = readFileSync(repoBuild);
    expect(r.bin.equals(expected)).toBe(true);
    expect(r.bundle.equals(expected)).toBe(true);
  }, 120_000);
});
