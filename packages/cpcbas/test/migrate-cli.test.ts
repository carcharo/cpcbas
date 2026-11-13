import { describe, expect, it } from 'vitest';
import { run } from '../bin/cli.js';
import type { MigrateIo } from '../bin/migrate-cli.js';

function memIo(files: Record<string, string>) {
  const fs = new Map<string, Uint8Array>(Object.entries(files).map(([k, v]) => [k, new TextEncoder().encode(v)]));
  const out: string[] = [];
  const err: string[] = [];
  const written = new Map<string, string>();
  const dirs: string[] = [];
  const io: MigrateIo = {
    readFile: (p) => fs.get(p),
    writeFile: (p, b) => void written.set(p, new TextDecoder().decode(b)),
    stdout: (t) => void out.push(t),
    stderr: (t) => void err.push(t),
    cwd: '/work',
    listFiles: (path) => {
      const below = [...fs.keys()].filter((k) => k.startsWith(`${path}/`));
      return below.length > 0 ? below : undefined;
    },
    makeDir: (path) => void dirs.push(path),
  };
  return { io, out: () => out.join(''), err: () => err.join(''), written, dirs };
}

const m = async (args: string[], files: Record<string, string>) => {
  const t = memIo(files);
  const code = await run(['migrate', ...args], t.io);
  return { code, ...t };
};

describe('cpcbas migrate (the command)', () => {
  it('--help', async () => {
    const r = await m(['--help'], {});
    expect(r.code).toBe(0);
    expect(r.out()).toContain('Usage: cpcbas migrate');
    expect(r.out()).toContain('--check');
  });

  it.each([
    [[], 'no input path'],
    [['--bogus', 'a.bas'], "unknown option '--bogus'"],
    [['--from', 'zx', 'a.bas'], "--from: 'zx' is not auto or boriel"],
    [['--report', 'xml', 'a.bas'], '--report'],
    [['--rename', 'inp', 'a.bas'], '--rename'],
    [['--rename', 'a=1b', 'a.bas'], '--rename'],
    [['-D', '1x', 'a.bas'], '-D'],
    [['-o', 'out', '--in-place', 'a.bas'], 'cannot be used together'],
    [['--check', '--in-place', 'a.bas'], '--check writes nothing'],
    [['missing.bas'], "cannot read 'missing.bas'"],
  ])('usage error %j gives exit 2 and one line', async (args, text) => {
    const r = await m(args, { 'a.bas': 'x = 1' });
    expect(r.code).toBe(2);
    expect(r.err()).toContain(text);
    expect(r.err()).toContain('try --help');
    expect(r.err().trimEnd().split('\n')).toHaveLength(1);
    expect(r.out()).toBe('');
  });

  it('writes nothing without -o or --in-place, and reports as the compiler prints diagnostics', async () => {
    const r = await m(['a.bas'], { 'a.bas': 'x = $FF\ny = a > b\n' });
    expect(r.code).toBe(0);
    expect(r.written.size).toBe(0);
    const text = r.out();
    expect(text).toContain('a.bas:1:5: note W700: Boriel number literal rewritten: $FF -> &FF\n');
    expect(text).toContain('a.bas:2:5: warning W728: A comparison used as a number is -1 when true (Boriel gave 1)\n  hint: Boriel gave 1');
    expect(text).toContain('1 file read, 1 changed; read as Boriel BASIC');
    expect(text).toContain('W700 x1, W728 x1');
  });

  it('--report json is the report object', async () => {
    const r = await m(['--report', 'json', 'a.bas'], { 'a.bas': 'x = $FF\n' });
    const j = JSON.parse(r.out()) as { version: number; files: Array<{ path: string; changed: boolean; diagnostics: Array<{ code: string; severity: string }> }>; summary: { files: number; changed: number; dialect: string } };
    expect(j.version).toBe(1);
    expect(j.files[0]).toMatchObject({ path: 'a.bas', changed: true });
    expect(j.files[0]?.diagnostics[0]).toMatchObject({ code: 'W700', severity: 'note', line: 1, col: 5 });
    expect(j.summary).toMatchObject({ files: 1, changed: 1, dialect: 'boriel' });
  });

  it('--check: exit 1 when a file would change, nothing written', async () => {
    const r = await m(['--check', 'a.bas'], { 'a.bas': 'x = $FF\n' });
    expect(r.code).toBe(1);
    expect(r.written.size).toBe(0);
  });

  it('--check: exit 1 on a must-fix flag, exit 0 on clean CPC BASIC, review flags are not reported', async () => {
    const mustFix = await m(['--check', 'a.bas'], { 'a.bas': 'PRINT AT 1, 1; INK 2; "x"\n' });
    expect(mustFix.code).toBe(1);
    expect(mustFix.out()).toContain('W720');
    const clean = await m(['--check', 'a.bas'], { 'a.bas': 'x = &FF\ny = a > b\nPRINT STR$(5)\n' });
    expect(clean.code).toBe(0);
    expect(clean.out()).not.toContain('W728');
    expect(clean.out()).not.toContain('W732');
    expect(clean.out()).toContain('0 changed; read as CPC BASIC');
  });

  it('-o DIR writes every migrated file below DIR, paths relative to the folder given', async () => {
    const r = await m(['-o', 'out', 'src'], { 'src/a.bas': 'x = $FF\n', 'src/sub/b.bas': 'y = 1\n', 'src/readme.txt': 'not basic' });
    expect(r.code).toBe(0);
    expect([...r.written.keys()].sort()).toEqual(['out/a.bas', 'out/sub/b.bas']);
    expect(r.written.get('out/a.bas')).toBe('x = &FF\n');
    expect(r.written.get('out/sub/b.bas')).toBe('y = 1\n');
    expect(r.dirs).toEqual(['out', 'out/sub']); // made before writing: -o DIR need not exist (R21)
  });

  it('a write failure is E010 with exit 1, not an exception', async () => {
    const t = memIo({ 'a.bas': 'x = $FF\n' });
    t.io.writeFile = () => {
      throw new Error('EACCES: permission denied');
    };
    const code = await run(['migrate', '-o', 'out', 'a.bas'], t.io);
    expect(code).toBe(1);
    expect(t.err()).toContain('error E010: cannot write: EACCES');
  });

  it('--in-place writes only the files that change', async () => {
    const r = await m(['--in-place', 'a.bas', 'b.bas'], { 'a.bas': 'x = $FF\n', 'b.bas': 'y = 1\n' });
    expect([...r.written.keys()]).toEqual(['a.bas']);
    expect(r.written.get('a.bas')).toBe('x = &FF\n');
  });

  it('--rename chooses the new name (a project of two files)', async () => {
    const r = await m(['--in-place', '--rename', 'inp=kin', 'a.bas', 'b.bas'], { 'a.bas': 'DIM inp AS UBYTE\n', 'b.bas': 'inp = 1\n' });
    expect(r.written.get('a.bas')).toBe('DIM kin AS UBYTE\n');
    expect(r.written.get('b.bas')).toBe('kin = 1\n');
  });

  it('--from boriel applies the dialect rules to a file with no Boriel-only form', async () => {
    const files = { 'a.bas': 'ON n GOTO a, b\n' };
    expect((await m(['--in-place', 'a.bas'], files)).written.size).toBe(0);
    const r = await m(['--in-place', '--from', 'boriel', 'a.bas'], files);
    expect(r.written.get('a.bas')).toBe('ON n + 1 GOTO a, b\n');
  });

  it('the compile check runs when a runtime is given (and --no-compile turns it off)', async () => {
    const files = { 'a.bas': 'x = 1\nPRINT AT 1, 1; INK 2; "x"\n', 'lib/cpcbuild.bas': 'REM\n' };
    const on = await m(['--runtime', 'lib', 'a.bas'], files);
    expect(on.out()).toContain('W725');
    const off = await m(['--runtime', 'lib', '--no-compile', 'a.bas'], files);
    expect(off.out()).not.toContain('W725');
    expect(off.out()).toContain('W720');
  });

  it('a CPC BASIC run with an ON n GOTO says in its summary to use --from boriel (W727); --check does not', async () => {
    const files = { 'a.bas': 'ON n GOTO a, b\n' };
    const r = await m(['a.bas'], files);
    expect(r.out()).toContain('read as CPC BASIC');
    expect(r.out()).toContain('W727 x1');
    expect(r.out()).toContain('run again with --from boriel');
    const c = await m(['--check', 'a.bas'], files);
    expect(c.code).toBe(0);
    expect(c.out()).not.toContain('W727');
    expect((await m(['--from', 'boriel', 'a.bas'], files)).out()).not.toContain('--from boriel');
  });

  it('a file that is not UTF-8 is reported (W725) and copied byte for byte by -o', async () => {
    const bad = Uint8Array.from([0x78, 0x20, 0x3d, 0x20, 0x24, 0x46, 0x46, 0x0a, 0x52, 0x45, 0x4d, 0x20, 0xe9, 0x0a]);
    const t = memIo({ 'good.bas': 'x = $FF\n' });
    const files = new Map<string, Uint8Array>([['src/bad.bas', bad], ['src/good.bas', new TextEncoder().encode('x = $FF\n')]]);
    const written = new Map<string, Uint8Array>();
    t.io.readFile = (p) => files.get(p);
    t.io.listFiles = (path) => [...files.keys()].filter((k) => k.startsWith(`${path}/`));
    t.io.writeFile = (p, b) => void written.set(p, b);
    const code = await run(['migrate', '-o', 'out', 'src'], t.io);
    expect(code).toBe(0);
    expect(t.out()).toContain('not UTF-8: left unchanged');
    expect(Array.from(written.get('out/bad.bas') ?? [])).toEqual(Array.from(bad));
    expect(new TextDecoder().decode(written.get('out/good.bas'))).toBe('x = &FF\n');
    // --in-place leaves it alone
    written.clear();
    expect(await run(['migrate', '--in-place', 'src'], t.io)).toBe(0);
    expect([...written.keys()]).toEqual(['src/good.bas']);
  });
});
