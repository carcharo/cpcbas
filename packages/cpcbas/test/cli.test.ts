import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run, parseNumber, type CliIo, type CompileFn } from '../bin/cli.js';
import { lazyTree as diskTree } from '../src/node/index.js';
import { DiagnosticBag, SourceSet, VERSION, type CompileInput, type CompileResult } from '../src/index.js';

function memIo(files: Record<string, string | Uint8Array> = {}, extra: Partial<CliIo> = {}) {
  const fs = new Map<string, Uint8Array>();
  for (const [k, v] of Object.entries(files)) fs.set(k, typeof v === 'string' ? new TextEncoder().encode(v) : v);
  const out: string[] = [];
  const err: string[] = [];
  const written = new Map<string, Uint8Array>();
  const reads: string[] = [];
  const io: CliIo = {
    readFile: (p) => {
      reads.push(p);
      return fs.get(p);
    },
    writeFile: (p, b) => void written.set(p, b),
    stdout: (t) => void out.push(t),
    stderr: (t) => void err.push(t),
    cwd: '/work',
    today: () => '2026-11-07',
    ...extra,
  };
  return { io, out: () => out.join(''), err: () => err.join(''), written, reads };
}

function okResult(extra: Partial<CompileResult> = {}): CompileResult {
  return {
    ok: true,
    diagnostics: [],
    sources: new SourceSet(),
    stats: { codeBytes: 0, dataBytes: 0, heapBytes: 0, timeMs: 0 },
    exitCode: 0,
    ...extra,
  };
}

function spy(result: CompileResult = okResult()) {
  const calls: CompileInput[] = [];
  const fn: CompileFn = (input) => {
    calls.push(input);
    return result;
  };
  return { fn, calls };
}

describe('cpcbas CLI', () => {
  it('--version', async () => {
    const t = memIo();
    expect(await run(['--version'], t.io)).toBe(0);
    expect(t.out()).toBe(`cpcbas ${VERSION}\n`);
  });

  it('--help prints usage and exits 0', async () => {
    const t = memIo();
    expect(await run(['--help'], t.io)).toBe(0);
    expect(t.out()).toContain('Usage: cpcbas');
  });

  it('unknown option gives exit 2 and one line', async () => {
    const t = memIo({ 'a.bas': '' });
    expect(await run(['--bogus', 'a.bas'], t.io)).toBe(2);
    const lines = t.err().trimEnd().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('--bogus');
    expect(lines[0]).toContain('try --help');
    expect(t.out()).toBe('');
  });

  it.each([
    [[], 'no input file'],
    [['a.bas', 'b.bas'], 'more than one'],
    [['a.bas', '--org', 'zzz'], '--org'],
    [['a.bas', '--org', '70000'], 'out of range'],
    [['a.bas', '-O', '4'], '-O'],
    [['a.bas', '-Ox'], "-O: 'x' is not 0, 1, 2, 3 or s"],
    [['a.bas', '-O', 'S'], '-O'],
    [['a.bas', '--opt-disable', 'Bad Name'], '--opt-disable'],
    [['a.bas', '--opt-disable'], 'needs a value'],
    [['a.bas', '-o'], 'needs a value'],
    [['a.bas', '-o', 'x.txt'], 'format'],
    [['a.bas', '--stage', 'foo'], '--stage'],
    [['a.bas', '--diagnostics', 'xml'], '--diagnostics'],
    [['a.bas', '-W', 'E101'], 'E101 is an error; only warnings can be disabled'],
    [['a.bas', '-D', '1x'], '-D'],
    [['a.bas', '--dsk-add', 'noequals'], '--dsk-add'],
    [['a.bas', '--dsk-add', 'X=a.bas'], '--dsk-add needs a .dsk output'],
    [['a.bas', '-o', 'a.cpr', '--dsk-add', 'X=a.bas'], '--dsk-add needs a .dsk output'],
  ])('usage error %j', async (argv, text) => {
    const t = memIo({ 'a.bas': '' });
    const s = spy();
    expect(await run(argv, t.io, s.fn)).toBe(2);
    expect(t.err().trimEnd().split('\n')).toHaveLength(1);
    expect(t.err()).toContain(text);
    expect(s.calls).toHaveLength(0);
  });

  it('parses numbers in four notations', () => {
    expect(parseNumber('&4000', 'x')).toBe(0x4000);
    expect(parseNumber('0x4000', 'x')).toBe(0x4000);
    expect(parseNumber('$4000', 'x')).toBe(0x4000);
    expect(parseNumber('16384', 'x')).toBe(0x4000);
  });

  it('every option maps onto CompileInput', async () => {
    const t = memIo({ 'src/main.bas': 'x', 'extra.bin': new Uint8Array([1, 2]) });
    const s = spy();
    const code = await run(
      [
        'src/main.bas', '-o', 'out.dsk', '--org', '&4000', '--heap=0x200', '--heap-address', '$A000',
        '-I', 'inc', '-Ilib2', '-D', 'CPC6128', '-DLEVEL=3', '-D', 'EMPTY=', '-O2',
        '-W', '301', '-W', 'w302', '-W', '303,304', '-Werror', '-M', 'o.map', '--asm', 'o.asm',
        '--stage', 'ast', '--dsk-add', 'DATA.BIN=extra.bin', '--runtime', '/rt',
      ],
      t.io,
      s.fn,
    );
    expect(code).toBe(0);
    const input = s.calls[0] as CompileInput;
    expect(input.main).toBe('src/main.bas');
    expect(input.includePaths).toEqual(['inc', 'lib2']);
    expect(input.defines).toEqual({ CPC6128: '', LEVEL: '3', EMPTY: '' });
    const o = input.options;
    expect(o).toMatchObject({
      format: 'dsk', org: 0x4000, heapSize: 0x200, heapAddress: 0xa000, optimize: 2,
      disabledWarnings: [301, 'W302', 303, 304], warningsAsErrors: true, map: true, asm: true,
      dump: ['ast'], buildDate: '2026-11-07',
    });
    expect(o?.dskFiles).toEqual([{ name: 'DATA.BIN', data: new Uint8Array([1, 2]) }]);
    expect(typeof o?.now).toBe('function');
    // the runtime tree reads lazily through the io, relative to --runtime
    t.reads.length = 0;
    expect(input.runtime?.has('runtime/print.asm')).toBe(false);
    expect(t.reads).toEqual(['/rt/runtime/print.asm']);
  });

  it.each([
    [['-Os'], 's'],
    [['-O', 's'], 's'],
    [['-O0'], 0],
    [['-O', '1'], 1],
    [['-O3'], 3],
  ])('L5-0: %j is optimize %j', async (args, level) => {
    const s = spy();
    expect(await run(['a.bas', ...args], memIo({ 'a.bas': '' }).io, s.fn)).toBe(0);
    expect((s.calls[0] as CompileInput).options?.optimize).toBe(level);
  });

  it('L5-0: --opt-disable (repeatable, comma lists) and --opt-trace reach the compiler', async () => {
    const s = spy();
    const argv = ['a.bas', '--opt-disable', 'temps,cmpjump', '--opt-disable=peephole', '--opt-trace'];
    expect(await run(argv, memIo({ 'a.bas': '' }).io, s.fn)).toBe(0);
    expect((s.calls[0] as CompileInput).options).toMatchObject({ optDisable: ['temps', 'cmpjump', 'peephole'], optTrace: true });
  });

  it('L5-0: --help lists -Os, --opt-disable and --opt-trace', async () => {
    const t = memIo({});
    expect(await run(['--help'], t.io)).toBe(0);
    expect(t.out()).toContain('-O 0|1|2|3|s');
    expect(t.out()).toContain('--opt-disable NAME[,NAME]');
    expect(t.out()).toContain('--opt-trace');
  });

  it('defaults: bin format, no optional options, local date', async () => {
    const t = memIo({ 'a.bas': 'x' }, { today: undefined });
    const s = spy();
    await run(['a.bas'], t.io, s.fn);
    const o = (s.calls[0] as CompileInput).options as Record<string, unknown>;
    expect(o.format).toBe('bin');
    expect(o.buildDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const k of ['org', 'heapSize', 'optimize', 'optDisable', 'optTrace', 'parseOnly', 'dump', 'warningsAsErrors']) expect(k in o).toBe(false);
  });

  it('format comes from -o extension, and -f wins', async () => {
    const s = spy();
    await run(['a.bas', '-o', 'x.CPR'], memIo({ 'a.bas': '' }).io, s.fn);
    await run(['a.bas', '-o', 'x.bin', '-f', 'dsk'], memIo({ 'a.bas': '' }).io, s.fn);
    expect(s.calls.map((c) => c.options?.format)).toEqual(['cpr', 'dsk']);
  });

  it('--parse-only and --stage reach the compiler; the dump goes to stdout', async () => {
    const t = memIo({ 'a.bas': '' });
    const s = spy(okResult({ stages: { tokens: 'TOKENS' }, binary: new Uint8Array([1]) }));
    expect(await run(['a.bas', '--parse-only', '--stage', 'tokens'], t.io, s.fn)).toBe(0);
    expect((s.calls[0] as CompileInput).options).toMatchObject({ parseOnly: true, dump: ['tokens'] });
    expect(t.out()).toBe('TOKENS\n');
    expect(t.written.size).toBe(0);
  });

  it('with json diagnostics the --stage dump goes to stderr and stdout stays one JSON array', async () => {
    const t = memIo({ 'a.bas': '' });
    const s = spy(okResult({ stages: { tokens: 'TOKENS', ast: 'AST\n' } }));
    expect(await run(['a.bas', '--stage', 'tokens', '--stage', 'ast', '--diagnostics', 'json'], t.io, s.fn)).toBe(0);
    expect(t.err()).toBe('TOKENS\nAST\n');
    expect(t.out()).toBe('[]\n');
    expect(JSON.parse(t.out())).toEqual([]);
  });

  function failing(): CompileResult {
    const sources = new SourceSet();
    const f = sources.add('a.bas', 'PRINT 1\nPRINT 2 +\n');
    const bag = new DiagnosticBag();
    bag.report('E002', { file: f.id, start: 15, end: 16 }, 'boom', 'try again');
    return okResult({ ok: false, diagnostics: bag.all(), sources, exitCode: 1 });
  }

  it('json diagnostics are one array on stdout and parse as JSON', async () => {
    const t = memIo({ 'a.bas': 'x\n' });
    expect(await run(['a.bas', '--diagnostics', 'json'], t.io)).toBe(1);
    const arr = JSON.parse(t.out()) as { code: string; line: number; col: number; file: string }[];
    expect(Array.isArray(arr)).toBe(true);
    expect(arr).toHaveLength(1);
    expect(arr[0]?.code).toBe('E205');
    expect(t.out().trimEnd().split('\n')).toHaveLength(1);
    expect(t.err()).toBe('');
  });

  it('text diagnostics go to stderr in file:line:col form', async () => {
    const t = memIo({ 'a.bas': 'x' });
    expect(await run(['a.bas'], t.io, () => failing())).toBe(1);
    expect(t.err()).toContain('a.bas:2:8: error E002: boom\n  hint: try again\n');
    expect(t.out()).toBe('');
  });

  it('the real compile reports a checker error in text form', async () => {
    const t = memIo({ 'a.bas': 'x' });
    expect(await run(['a.bas'], t.io)).toBe(1);
    expect(t.err()).toMatch(/^a\.bas:1:1: error E205: /);
  });

  it('nothing is written when compile fails', async () => {
    const t = memIo({ 'a.bas': 'x' });
    const bad = { ...failing(), output: new Uint8Array([1]), asm: 'a', map: 'm' };
    expect(await run(['a.bas', '-o', 'o.bin', '--asm', 'o.asm', '-M', 'o.map'], t.io, () => bad)).toBe(1);
    expect(t.written.size).toBe(0);
  });

  it('exit code 5 passes through', async () => {
    const t = memIo({ 'a.bas': 'x' });
    expect(await run(['a.bas'], t.io, () => ({ ...failing(), exitCode: 5 }))).toBe(5);
  });

  it('writes output, asm and map when ok', async () => {
    const t = memIo({ 'dir/a.bas': 'x' });
    const r = okResult({ output: new Uint8Array([1, 2, 3]), asm: 'ASM', map: 'MAP' });
    expect(await run(['dir/a.bas', '--asm', 'o.asm', '-M', 'o.map'], t.io, () => r)).toBe(0);
    expect([...t.written.keys()].sort()).toEqual(['dir/a.bin', 'o.asm', 'o.map']);
    expect(t.written.get('dir/a.bin')).toEqual(new Uint8Array([1, 2, 3]));
    expect(new TextDecoder().decode(t.written.get('o.asm'))).toBe('ASM');
  });

  it('missing main file gives a diagnostic, not a crash', async () => {
    const t = memIo();
    const s = spy();
    expect(await run(['nope.bas'], t.io, s.fn)).toBe(1);
    expect(t.err()).toContain('nope.bas:1:1: error E003');
    expect(s.calls).toHaveLength(0);
    const j = memIo();
    expect(await run(['nope.bas', '--diagnostics', 'json'], j.io, s.fn)).toBe(1);
    expect((JSON.parse(j.out()) as { code: string }[])[0]?.code).toBe('E003');
  });

  it('a missing --dsk-add file is E003 too', async () => {
    const t = memIo({ 'a.bas': '' });
    expect(await run(['a.bas', '-o', 'a.dsk', '--dsk-add', 'X=gone.bin'], t.io, spy().fn)).toBe(1);
    expect(t.err()).toContain('error E003');
  });

  it('a write failure is E010 with exit 1', async () => {
    const t = memIo({ 'a.bas': '' });
    t.io.writeFile = () => {
      throw new Error('disk full');
    };
    const r = okResult({ output: new Uint8Array([1]) });
    expect(await run(['a.bas'], t.io, () => r)).toBe(1);
    expect(t.err()).toContain('error E010');
    expect(t.err()).toContain('disk full');
  });
});

describe('lazyTree', () => {
  it('reads lazily and once, over a real directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpcbas-cli-'));
    try {
      mkdirSync(join(dir, 'sub'));
      writeFileSync(join(dir, 'sub', 'a.bas'), 'hello');
      let reads = 0;
      const tree = diskTree((p) => {
        reads++;
        try {
          return readFileSync(join(dir, p));
        } catch {
          return undefined;
        }
      });
      expect(reads).toBe(0);
      expect(tree.has('./sub/a.bas')).toBe(true);
      expect(new TextDecoder().decode(tree.get('sub/a.bas') as Uint8Array)).toBe('hello');
      expect(tree.has('missing.bas')).toBe(false);
      expect(reads).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('diagnostic hints name real options (R16)', () => {
  it('every --option a code hint names is one the CLI parses', async () => {
    const { CODES } = await import('../src/core/diagnostics.js');
    // the CLI's options, and `cpcbas migrate`'s (a migrate code's hint names --from)
    const cliText = readFileSync(join(__dirname, '../bin/cli.ts'), 'utf8') + readFileSync(join(__dirname, '../bin/migrate-cli.ts'), 'utf8');
    const named = new Set<string>();
    for (const info of Object.values(CODES) as { hint?: string }[]) for (const m of (info.hint ?? '').matchAll(/--[a-z][a-z-]*/g)) named.add(m[0]);
    expect(named.size).toBeGreaterThan(0);
    for (const opt of named) expect(cliText, opt).toContain(`'${opt}'`);
  });
});
