/**
 * L2-WIRE: compile() end to end. tests/loco/hello.bas goes through the library's own pipeline
 * (not test/compile-helper.ts), comes out as .bin, .dsk and .cpr, and the program image
 * runs on the test Z80 with the printer echo on.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildAmsdosHeader, buildDsk } from '../src/pack/index.js';
import { compile, formatDiagnostic, type CompileInput, type CompileOptions } from '../src/index.js';
import { normalise } from './compile-helper.js';
import { libTree, readDsk } from './runtime-tree.js';
import { repoRoot, runImage } from './z80sim/run.js';

const loco = (name: string): string => readFileSync(join(repoRoot, 'tests/loco', name), 'latin1');
const build = (text: string, options: CompileOptions = {}, defines: Record<string, string> = { __CPC_PRINTER_ECHO__: '' }) => {
  const input: CompileInput = { files: new Map([['t.bas', text]]), main: 't.bas', defines, runtime: libTree(), options };
  return compile(input);
};
const messages = (r: ReturnType<typeof build>): string[] => r.diagnostics.map((d) => formatDiagnostic(d, r.sources));

describe('compile() builds hello.bas', () => {
  const r = build(loco('hello.bas'), { format: 'dsk' });

  it('is ok, at &0040, with stats', () => {
    expect(messages(r)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.exitCode).toBe(0);
    expect(r.org).toBe(0x40);
    expect(r.entry).toBe(0x40);
    expect(r.stats.codeBytes).toBeGreaterThan(1000);
    expect(r.stats.dataBytes).toBeGreaterThan(0);
    expect(r.stats.heapBytes).toBe(4768);
  });

  it('the .dsk is the standard size and round-trips through buildDsk', () => {
    const again = buildDsk([{ name: 'T.BIN', data: r.binary as Uint8Array, loadAddress: 0x40, entryAddress: 0x40, fileType: 2 }]);
    expect(again.ok && again.value).toEqual(r.output);
    expect(r.output?.length).toBe(256 + 40 * (256 + 9 * 512));
  });

  it('the program file on the disc runs on the simulator and prints the blessed transcript', () => {
    const files = readDsk(r.output as Uint8Array);
    expect(files.map((f) => f.name)).toEqual(['T.BIN']);
    const stored = (files[0] as { data: Uint8Array }).data;
    const header = buildAmsdosHeader({ name: 'T.BIN', length: (r.binary as Uint8Array).length, loadAddress: 0x40, entryAddress: 0x40 });
    expect(header.ok && stored.subarray(0, 128)).toEqual(header.ok && header.value);
    const image = stored.subarray(128, 128 + (r.binary as Uint8Array).length);
    expect(image).toEqual(r.binary);
    const run = runImage(image, 0x40, 0x40, { maxTStates: 400_000_000 });
    expect(run.stopped).toBe('rst0');
    expect(normalise(run.printer)).toBe(loco('hello.expected'));
  });

  it('the AMSDOS name defaults to the main file name; dskName and dskFiles are honoured', () => {
    const r2 = build('PRINT 1', { format: 'dsk', dskName: 'GAME.BIN', dskFiles: [{ name: 'DATA.DAT', data: new Uint8Array([1, 2, 3]) }] });
    expect(messages(r2)).toEqual([]);
    const files = readDsk(r2.output as Uint8Array);
    expect(files.map((f) => f.name)).toEqual(['GAME.BIN', 'DATA.DAT']);
    expect(Array.from((files[1] as { data: Uint8Array }).data.subarray(0, 3))).toEqual([1, 2, 3]);
  });
});

describe('compile() formats', () => {
  it('.bin carries an AMSDOS header by default and none when asked', () => {
    const withHeader = build('PRINT 1', { format: 'bin' });
    const bare = build('PRINT 1', { format: 'bin', amsdosHeader: false });
    expect(withHeader.output?.length).toBe((withHeader.binary as Uint8Array).length + 128);
    expect(bare.output).toEqual(bare.binary);
    expect(withHeader.output?.subarray(128)).toEqual(withHeader.binary);
  });

  it('format none returns the binary and no output', () => {
    const r = build('PRINT 1', { format: 'none' });
    expect(r.binary).toBeDefined();
    expect(r.output).toBeUndefined();
  });

  it('-M and --asm texts are returned only when asked', () => {
    const plain = build('PRINT 1');
    expect(plain.map).toBeUndefined();
    expect(plain.asm).toBeUndefined();
    const r = build('PRINT 1', { map: true, asm: true });
    expect(r.map).toMatch(/^0040: \.core\.__START_PROGRAM$/m);
    expect(r.asm).toContain('.core.__START_PROGRAM:');
    expect(r.asm).toContain('\torg 64');
  });

  it('a bare build (-D CPC_BAREMETAL) of a PRINT-only program makes a cartridge', () => {
    const r = build('PRINT "HI"', { format: 'cpr', org: 0x4000 }, { CPC_BAREMETAL: '' });
    expect(messages(r)).toEqual([]);
    expect(new TextDecoder('latin1').decode((r.output as Uint8Array).subarray(0, 4))).toBe('RIFF');
  });

  it('a bare build with RANDOMIZE, RND(0) and ROUND assembles (the seed comes from the frame counter)', () => {
    const r = build('RANDOMIZE\nRANDOMIZE 5\nx! = RND(-2)\ny! = RND(0)\nz! = ROUND(y!, 3)', { format: 'cpr', org: 0x4000 }, { CPC_BAREMETAL: '' });
    expect(messages(r)).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('options win over #pragma org', () => {
    const r = build('#pragma org = 0x5000\nPRINT 1', { org: 0x6000 });
    expect(messages(r)).toEqual([]);
    expect(r.org).toBe(0x6000);
    expect(build('#pragma org = 0x5000\nPRINT 1').org).toBe(0x5000);
  });
});

describe('compile() dumps', () => {
  const small = 'PRINT 1\nx = 2\n';
  it('--stage ir prints the IR and stops', () => {
    const r = build(small, { dump: ['ir'], format: 'dsk' });
    expect(r.stages?.ir).toMatchSnapshot();
    expect(r.output).toBeUndefined();
    expect(r.ok).toBe(true);
  });

  it('--stage ir needs no runtime tree', () => {
    const r = compile({ files: new Map([['t.bas', small]]), main: 't.bas', options: { dump: ['ir'] } });
    expect(r.ok).toBe(true);
    expect(r.stages?.ir).toContain('main');
  });

  it('--stage asm prints the linked asm and stops', () => {
    // L5: a test that pins bytes builds at -O0 (docs/ir.md "Optimisation")
    const r = build(small, { dump: ['asm'], format: 'dsk', optimize: 0 });
    expect(r.stages?.asm).toMatchSnapshot();
    expect(r.output).toBeUndefined();
    expect(r.ok).toBe(true);
  });
});

describe('compile() diagnostics', () => {
  it('a type error stops before code generation and gives the checker\'s code, no output', () => {
    const r = build('a$ = 5\n', { format: 'dsk' });
    expect(r.ok).toBe(false);
    expect(r.exitCode).toBe(1);
    expect(r.output).toBeUndefined();
    expect(r.binary).toBeUndefined();
    expect(r.diagnostics[0]?.code).toMatch(/^E2\d\d$/);
    expect(r.diagnostics.some((d) => d.code === 'E002')).toBe(false);
  });

  it('a program too big for the memory map is E401 with exit code 5', () => {
    const r = build('PRINT 1', { org: 0xa000 });
    expect(r.ok).toBe(false);
    expect(r.exitCode).toBe(5);
    expect(r.diagnostics.map((d) => d.code)).toContain('E401');
    expect(r.output).toBeUndefined();
  });

  it('an origin below the lowest usable address is E404', () => {
    const r = build('PRINT 1', { org: 0x10 });
    expect(r.exitCode).toBe(5);
    expect(r.diagnostics.map((d) => d.code)).toContain('E404');
  });

  it('a source #init whose label is not defined is E422 at the #init, not an assembler bug', () => {
    const r = build('#init my_missing_init\nPRINT 1\n');
    expect(r.diagnostics.map((d) => d.code)).toEqual(['E422']);
    expect(r.diagnostics[0]?.span.start).toBeGreaterThanOrEqual(0);
  });

  it('a build without the runtime tree is E004', () => {
    const r = compile({ files: new Map([['t.bas', 'PRINT 1']]), main: 't.bas' });
    expect(r.diagnostics.map((d) => d.code)).toEqual(['E004']);
  });

  it('a bad line in an ASM block is the user\'s error, attributed to the BASIC source', () => {
    const r = build('PRINT 1\nASM\n  bogus_op a\nEND ASM\n');
    expect(r.ok).toBe(false);
    const d = r.diagnostics.find((x) => x.severity === 'error');
    expect(d?.code).not.toBe('E001');
    expect(formatDiagnostic(d as never, r.sources)).toMatch(/^t\.bas:3:/);
  });

  it('timeMs comes from the host clock', () => {
    let t = 10;
    const r = build('PRINT 1', { now: () => (t += 5) });
    expect(r.stats.timeMs).toBe(5);
  });

  it('is deterministic', () => {
    expect(build(loco('hello.bas'), { format: 'dsk' }).output).toEqual(build(loco('hello.bas'), { format: 'dsk' }).output);
  });
});
