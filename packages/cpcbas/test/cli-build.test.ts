/** L2-WIRE: the CLI builds for real: a real CliIo (reads the repo, writes a temp dir) over tests/loco/hello.bas. */
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { run, type CliIo } from '../bin/cli.js';
import { repoRoot } from './z80sim/run.js';

const tmp = mkdtempSync(join(tmpdir(), 'cpcbas-cli-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;

function realIo(): { io: CliIo; out: () => string; err: () => string; dir: string; files: () => string[] } {
  const dir = join(tmp, `t${n++}`);
  mkdirSync(dir);
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    readFile(path) {
      try {
        return readFileSync(resolve(repoRoot, path));
      } catch {
        return undefined;
      }
    },
    writeFile(path, bytes) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bytes);
    },
    stdout: (t) => void out.push(t),
    stderr: (t) => void err.push(t),
    cwd: repoRoot,
    defaultRuntime: join(repoRoot, 'lib'),
    today: () => '2026-11-07',
  };
  return { io, out: () => out.join(''), err: () => err.join(''), dir, files: () => readdirSync(dir).sort() };
}

describe('cpcbas builds', () => {
  it('hello.bas to a .dsk of the standard size', async () => {
    const t = realIo();
    expect(await run(['tests/loco/hello.bas', '-o', join(t.dir, 'hello.dsk')], t.io)).toBe(0);
    expect(t.err()).toBe('');
    const dsk = readFileSync(join(t.dir, 'hello.dsk'));
    expect(dsk.length).toBe(256 + 40 * (256 + 9 * 512));
    expect(dsk.subarray(0, 8).toString('latin1')).toBe('MV - CPC');
  });

  it('-M and --asm write the map and the asm next to the output', async () => {
    const t = realIo();
    const args = ['tests/loco/hello.bas', '-o', join(t.dir, 'h.bin'), '-M', join(t.dir, 'h.map'), '--asm', join(t.dir, 'h.asm')];
    expect(await run(args, t.io)).toBe(0);
    expect(t.files()).toEqual(['h.asm', 'h.bin', 'h.map']);
    expect(readFileSync(join(t.dir, 'h.map'), 'latin1')).toMatch(/^0040: \.core\.__START_PROGRAM$/m);
    expect(readFileSync(join(t.dir, 'h.asm'), 'latin1')).toContain('.core.__MAIN_PROGRAM__:');
    expect(readFileSync(join(t.dir, 'h.bin')).length).toBeGreaterThan(1000);
  });

  it('--dsk-add puts a data file on the disc', async () => {
    const t = realIo();
    writeFileSync(join(t.dir, 'data.dat'), 'abc');
    expect(await run(['tests/loco/hello.bas', '-o', join(t.dir, 'h.dsk'), '--dsk-add', `DATA.DAT=${join(t.dir, 'data.dat')}`], t.io)).toBe(0);
    expect(readFileSync(join(t.dir, 'h.dsk')).includes(Buffer.from('DATA    DAT'))).toBe(true);
  });

  it('a type error exits 1 with the checker\'s diagnostic and writes nothing', async () => {
    const t = realIo();
    writeFileSync(join(t.dir, 'bad.bas'), 'a$ = 5\n');
    expect(await run([join(t.dir, 'bad.bas'), '-o', join(t.dir, 'bad.dsk'), '-M', join(t.dir, 'bad.map')], t.io)).toBe(1);
    expect(t.err()).toMatch(/bad\.bas:1:\d+: error E2\d\d: /);
    expect(t.err()).not.toContain('E002');
    expect(t.files()).toEqual(['bad.bas']);
  });

  it('a layout error exits 5 and writes nothing', async () => {
    const t = realIo();
    expect(await run(['tests/loco/hello.bas', '--org', '0xA000', '-o', join(t.dir, 'x.bin')], t.io)).toBe(5);
    expect(t.err()).toContain('error E401');
    expect(t.files()).toEqual([]);
  });

  it('-D CPC_BAREMETAL builds with the bare target', async () => {
    const t = realIo();
    writeFileSync(join(t.dir, 'bare.bas'), 'PRINT "HI"\n');
    expect(await run([join(t.dir, 'bare.bas'), '-D', 'CPC_BAREMETAL', '--org', '0x4000', '-o', join(t.dir, 'bare.cpr'), '--asm', join(t.dir, 'bare.asm')], t.io)).toBe(0);
    expect(t.err()).toBe('');
    expect(readFileSync(join(t.dir, 'bare.cpr')).subarray(0, 4).toString('latin1')).toBe('RIFF');
    expect(readFileSync(join(t.dir, 'bare.asm'), 'latin1')).toContain('org 16384');
  });

  it('--stage ir and --stage asm print to stdout and write nothing', async () => {
    const ir = realIo();
    expect(await run(['tests/loco/hello.bas', '--stage', 'ir', '-o', join(ir.dir, 'x.dsk')], ir.io)).toBe(0);
    expect(ir.out()).toContain('rtcall .core.__LOCO_MODE');
    const asm = realIo();
    expect(await run(['tests/loco/hello.bas', '--stage', 'asm', '-o', join(asm.dir, 'x.dsk')], asm.io)).toBe(0);
    expect(asm.out()).toContain('.core.__START_PROGRAM:');
    expect(ir.files()).toEqual([]);
    expect(asm.files()).toEqual([]);
  });

  it('a dump never writes an output: --stage asm with --asm and -M writes nothing either', async () => {
    const t = realIo();
    const args = ['tests/loco/hello.bas', '--stage', 'asm', '-o', join(t.dir, 'x.dsk'), '--asm', join(t.dir, 'x.asm'), '-M', join(t.dir, 'x.map')];
    expect(await run(args, t.io)).toBe(0);
    expect(t.out()).toContain('.core.__START_PROGRAM:');
    expect(t.files()).toEqual([]);
  });

  it('-Wimplicit warns at an implicit declaration', async () => {
    const t = realIo();
    writeFileSync(join(t.dir, 'imp.bas'), 'x = 1\nPRINT x\n');
    expect(await run([join(t.dir, 'imp.bas'), '-Wimplicit', '-o', join(t.dir, 'imp.bin')], t.io)).toBe(0);
    expect(t.err()).toContain('warning W300');
  });
});
