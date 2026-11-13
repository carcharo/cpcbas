/**
 * L5-DIFF: the differential harness itself. Layers 1 and 2 pass trivially while every level emits -O0's code, so this file
 * proves they fail when they should: a deliberately wrong "pass" (the test-only asm hook of opt-harness.ts, which deletes the
 * first `ld (_x), hl`) must be caught by the comparison, by the fuzzer, and by the level list parsing; and the harness must
 * build exactly what `compile()` builds.
 */
import { describe, expect, it } from 'vitest';
import { compile } from '../src/index.js';
import { asmAt, compareLevels, diffOutcomes, dropFirstStore, levelsFromEnv, parseLevels, runBuilt, withAsmHook, assembleForCheck } from './opt-harness.js';
import { libTree } from './runtime-tree.js';
import { assembleText, resolveRuntime, runImage } from './z80sim/run.js';
import { preprocessAsm } from '../src/asm/preprocess.js';
import { unreachable } from '../src/asm/reach.js';
import { makeTarget } from '../src/codegen/index.js';
import { DiagnosticBag } from '../src/core/diagnostics.js';
import { SourceSet } from '../src/core/source.js';

const PROG = 'DIM a AS INTEGER\nDIM b AS INTEGER\na = 5\nb = a * 3\nPRINT a; b';

describe('the levels', () => {
  it('parse -O0..-O3 and -Os, in any spelling', () => {
    expect(parseLevels('0,1,2,3,s')).toEqual([0, 1, 2, 3, 's']);
    expect(parseLevels('-O2, Os, S')).toEqual([2, 's', 's']);
    expect(() => parseLevels('4')).toThrow(/bad optimisation level/);
    expect(levelsFromEnv('')).toEqual([1, 2, 3, 's']);
    expect(levelsFromEnv('2,s')).toEqual([2, 's']);
  });
});

describe('the harness builds what compile() builds', () => {
  it('the asm and the image at -O0 equal the library pipeline (and the text assembles to the same bytes)', () => {
    const r = compile({ files: new Map([['t.bas', PROG]]), main: 't.bas', defines: { __CPC_PRINTER_ECHO__: '' }, runtime: libTree(), options: { asm: true, optimize: 0 } });
    expect(asmAt({ name: 'p', files: PROG }, 0).asm).toBe(r.asm);
    expect(assembleForCheck(r.asm as string, { name: 'p', files: PROG })).toEqual(r.binary);
    expect(asmAt({ name: 'p', files: PROG }, 0).image?.bytes).toEqual(r.binary);
  });

  // R17 / L5-STRIP: the `--asm` text holds `#include once` lines, so it still names the runtime chunks the link pass dropped.
  // Assembling it gives the unstripped program; the harness must run the image compile() built, the stripped one.
  it.each([[1], [2], [3], ['s']] as const)('at -O%s: the harness runs compile()\'s image, the stripped one, not the --asm text assembled', (level) => {
    for (const files of [PROG, 'DIM s AS STRING\ns = "ab" + STR$(3)\nPRINT s; LEN(s)\n']) {
      const r = compile({ files: new Map([['t.bas', files]]), main: 't.bas', defines: { __CPC_PRINTER_ECHO__: '' }, runtime: libTree(), options: { asm: true, optimize: level } });
      expect(r.ok).toBe(true);
      const built = asmAt({ name: 'p', files }, level);
      expect(built.asm).toBe(r.asm);
      expect(built.image?.bytes).toEqual(r.binary);
      const unstripped = assembleForCheck(r.asm as string, { name: 'p', files });
      expect(r.binary?.length).toBeLessThan(unstripped.length);
    }
  });

  it('runs the stripped image: the data region and the transcript come from it', () => {
    const o = runBuilt(asmAt({ name: 'p', files: PROG }, 2), { name: 'p', files: PROG }, 5_000_000);
    expect(o.stopped).toBe('rst0');
    expect(o.printer).toContain('5');
    expect(o.data.length).toBeGreaterThan(0);
  });
});

describe('a correct optimiser', () => {
  it('passes at every level; a level whose text and image equal -O0\'s is not run again', () => {
    const v = compareLevels({ name: 'p', files: PROG });
    expect(v.kind).toBe('ok');
    // the stripped image differs from -O0's at every optimised level, so each is run
    expect(v.ran).toEqual([1, 2, 3, 's']);
  });
});

describe('a deliberately wrong pass is caught (the first `ld (_x), hl` deleted at the optimised levels)', () => {
  it('layer 1: the data region and the transcript differ', () => {
    const v = withAsmHook(dropFirstStore, () => compareLevels({ name: 'p', files: PROG }));
    expect(v.kind).toBe('fail');
    expect(v.detail).toMatch(/^-O1: (transcript|data region) differs/);
    expect(v.ran).toEqual([1]);
  });

  it('only the levels that were given are checked', () => {
    const v = withAsmHook(dropFirstStore, () => compareLevels({ name: 'p', files: PROG }, ['s']));
    expect(v.detail).toMatch(/^-Os: /);
  });

  it('a program with no such store is not disturbed', () => {
    const v = withAsmHook(dropFirstStore, () => compareLevels({ name: 'p', files: 'PRINT 1+2' }));
    expect(v.kind).toBe('ok');
  });

  it('the hook is off again afterwards', () => {
    withAsmHook(dropFirstStore, () => undefined);
    expect(compareLevels({ name: 'p', files: PROG }).kind).toBe('ok');
  });

  it('a wrong pass that makes the program run away is a failure, found quickly', () => {
    const loop = (asm: string): string => asm.replace(/^\s*ld \(_i\), hl\s*$/gm, '\tnop');
    const v = withAsmHook(loop, () => compareLevels({ name: 'p', files: 'DIM i AS INTEGER\nFOR i = 1 TO 3\nNEXT\nPRINT i' }, [2]));
    expect(v.kind).toBe('fail');
  });
});

// L5-STRIP: a wrong strip is caught by layer 1. The runtime file below has a routine that runs on into the next label
// (STRIP_T_B is named by nobody: it is reached only by falling through from STRIP_T_A). The correct strip keeps it. Here the
// reachability analysis is fed a text in which STRIP_T_A ends in `ret` (so it believes nothing falls through), and the ranges it
// then gives, applied to the real lines, drop the needed chunk. The image still assembles and is wrong; layer 1's comparison
// of the transcript and the data region sees it.
describe('a deliberately wrong strip (a needed chunk dropped) is caught by layer 1', () => {
  const RUNTIME_T = [
    '    push namespace core',
    'STRIP_T_A:',
    '    ld a, 5',
    'STRIP_T_B:',
    '    add a, 2',
    '    ret',
    'STRIP_T_C:',
    '    ld a, 99',
    '    ret',
    '    pop namespace',
    '',
  ].join('\n');
  const BAS = '#require "strip_t.asm"\nDIM x AS UBYTE\nASM\n  call .core.STRIP_T_A\n  ld (_x), a\nEND ASM\nPRINT x\n';
  const files = (): Record<string, string> => {
    const out: Record<string, string> = { 'strip_t.asm': RUNTIME_T };
    for (const [path, text] of libTree()) if (path.startsWith('loco/') && path.endsWith('.asm')) out[path] = text;
    return out;
  };
  const defines = (): Map<string, string> => new Map(makeTarget({ defines: { __CPC_PRINTER_ECHO__: '' }, fileBuffers: { input: false, output: false } }).asmDefines);
  const tree = (): Map<string, string> => new Map([...libTree(), ['runtime/strip_t.asm', RUNTIME_T]]);

  function outcome(image: { bytes: Uint8Array; org: number; entry: number }, from: number, to: number) {
    const r = runImage(image.bytes, image.org, image.entry, { maxTStates: 2_000_000 });
    return { printer: r.printer, stopped: r.stopped, data: Buffer.from(r.memory.slice(from, to)).toString('hex'), tstates: r.tstates };
  }

  it('the right strip keeps STRIP_T_B and prints 7; the wrong one does not', () => {
    const r = compile({ files: new Map([['t.bas', BAS]]), main: 't.bas', defines: { __CPC_PRINTER_ECHO__: '' }, runtime: tree(), options: { asm: true, map: true, optimize: 1 } });
    expect(r.ok, JSON.stringify(r.diagnostics.map((d) => d.message))).toBe(true);
    const asm = r.asm as string;
    const names = (map: string): string[] => map.split('\n').map((l) => l.slice(l.indexOf(' ') + 1));
    expect(names(r.map as string)).toContain('.core.STRIP_T_A');
    expect(names(r.map as string)).toContain('.core.STRIP_T_B');
    expect(names(r.map as string)).not.toContain('.core.STRIP_T_C');

    // the preprocessed lines, as the assembler sees them
    const sources = new SourceSet();
    const entry = sources.add('t.asm', asm, 'generated');
    const pre = preprocessAsm({
      sources,
      entry,
      resolveInclude: (name, from, angle) => {
        const f = files()[name];
        return f !== undefined ? { path: `virtual/${name}`, text: f } : resolveRuntime(name, from, angle);
      },
      defines: defines(),
      diagnostics: new DiagnosticBag(),
    });
    const texts = pre.lines.map((l) => l.text);
    const marker = texts.findIndex((t) => t.includes(';; --- end of user code ---')) + 1;
    const total = texts.length;
    const fromTo = (a: ReturnType<typeof assembleText>): [number, number] => [a.addr('.core.ZXBASIC_USER_DATA'), a.addr('.core.ZXBASIC_USER_DATA_END')];
    const build = (drop: ReturnType<typeof unreachable>['drop']) => assembleText(asm, { defines: defines(), files: files(), dropLines: { total, ranges: drop } });

    const right = unreachable(texts, marker);
    const good = build(right.drop);
    const mutated = texts.map((t) => (/^\s*ld a, 5\s*$/.test(t) ? `${t} : ret` : t));
    const wrong = unreachable(mutated, marker);
    expect(wrong.drop.length).toBeGreaterThan(0);
    const bad = build(wrong.drop);

    const o0 = outcome(good, ...fromTo(good));
    expect(o0.stopped).toBe('rst0');
    expect(o0.printer).toContain(' 7 ');
    const o1 = outcome(bad, ...fromTo(bad));
    expect(diffOutcomes(o0, o1)).not.toBeNull();
  });
});

describe('the data region (R20)', () => {
  it('the text route (fault hook) and the image route compare the same bytes: the variables, up to the first hidden global', () => {
    const p = { name: 'cut', files: 'DIM a AS INTEGER\nFOR i = 1 TO a + 3: a = a + 1: NEXT\nPRINT a' };
    const built = asmAt(p, 0);
    expect(built.asm).toMatch(/^\.?V\.0:/m); // the FOR limit is a hidden global
    const image = runBuilt(built, p, 10_000_000);
    const text = withAsmHook((t) => t, () => runBuilt(asmAt(p, 0), p, 10_000_000));
    expect(image.data.length).toBeGreaterThan(0);
    expect(text.data).toBe(image.data);
  });
});
