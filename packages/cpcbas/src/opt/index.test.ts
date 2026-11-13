/**
 * L5-0: the pass manager, the level table and the hooks; and the wave-0 guarantee that every level
 * builds `-O0`'s image byte for byte (flow and the four Lamplighter builds).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lazyTree as diskTree } from '../node/index.js';
import { libTree } from '../../test/runtime-tree.js';
import { repoRoot } from '../../test/z80sim/run.js';
import { DiagnosticBag } from '../core/diagnostics.js';
import { asFileId } from '../core/source.js';
import { compile, type CompileOptions } from '../index.js';
import type { IrProgram } from '../ir/ir.js';
import {
  CODE_PASSES,
  DEFAULT_OPT_LEVEL,
  FEATURE_NAMES,
  IR_PASSES,
  LEVELS,
  LINK_PASSES,
  OPT_LEVELS,
  isOptLevel,
  levelSpec,
  makeOptimizer,
  optNames,
  type CodePass,
  type IrPass,
  type OptLevel,
} from './index.js';
import { generate, makeTarget } from '../codegen/index.js';
import type { CodeUnit, CodegenOptions } from '../codegen/types.js';
import { lowerSource } from '../../test/compile-helper.js';

const SPAN = { file: asFileId(0), start: 0, end: 0 };
const opt = (level?: unknown, disable?: string[], extra: Partial<Parameters<typeof makeOptimizer>[0]> = {}) => {
  const bag = new DiagnosticBag();
  const o = makeOptimizer({ level, ...(disable ? { disable } : {}), diagnostics: bag, span: SPAN, ...extra });
  return { o, bag, codes: () => bag.all().map((d) => d.code) };
};
const EMPTY_IR: IrProgram = { main: [{ op: 'end', a: { k: 'imm', value: 0 }, span: null }], procedures: [], globals: [], strings: [], data: [], requires: [], inits: [] };

describe('L5-0: the level table', () => {
  it('has the five levels; -O2 is the default', () => {
    expect(OPT_LEVELS).toEqual([0, 1, 2, 3, 's']);
    expect(DEFAULT_OPT_LEVEL).toBe(2);
    expect(Object.keys(LEVELS).sort()).toEqual(['0', '1', '2', '3', 's']);
    for (const l of OPT_LEVELS) expect(levelSpec(l).level).toBe(l);
  });

  it('-O0 turns nothing on', () => {
    expect(levelSpec(0)).toEqual({ level: 0, registerTemps: false, peephole: 0, unusedLabels: false, irPasses: false, style: 'base', sizeRules: false, strip: false, flow: false });
  });

  it('each level adds to the one before; -Os is -O2 with short templates and size rules, without the flow optimiser', () => {
    expect(levelSpec(1)).toMatchObject({ registerTemps: true, peephole: 1, strip: true, irPasses: false, unusedLabels: false, style: 'base', flow: false });
    expect(levelSpec(2)).toMatchObject({ registerTemps: true, peephole: 2, strip: true, irPasses: true, unusedLabels: true, style: 'fast', flow: false });
    expect(levelSpec(3)).toEqual({ ...levelSpec(2), level: 3, flow: true });
    expect(levelSpec('s')).toEqual({ ...levelSpec(2), level: 's', style: 'short', sizeRules: true });
  });

  it('isOptLevel accepts exactly the five levels', () => {
    for (const l of OPT_LEVELS) expect(isOptLevel(l)).toBe(true);
    for (const x of [4, -1, '2', 'S', 'O2', null, 1.5]) expect(isOptLevel(x)).toBe(false);
  });

  it('the feature names are known, and optNames lists them with every registered pass and its names', () => {
    expect(FEATURE_NAMES).toEqual(['cmpjump', 'templates', 'temps']);
    const names = new Set<string>(FEATURE_NAMES);
    for (const p of [...IR_PASSES, ...CODE_PASSES, ...LINK_PASSES]) {
      names.add(p.name);
      for (const n of p.names ?? []) names.add(n);
    }
    expect(optNames()).toEqual([...names].sort());
    expect(LINK_PASSES.map((p) => p.name)).toEqual(['strip']); // L5-STRIP
  });

  it('L5-PEEP registers the peephole pass at code slot 100, answering to its rules and to `labels`', () => {
    const p = CODE_PASSES.find((x) => x.name === 'peephole');
    expect(p?.order).toBe(100);
    expect(p?.names).toContain('labels');
    expect(p?.names).toContain('000_o1_push_pop');
    expect(p?.names).toContain('504_add_hl_1');
  });
});

describe('L5-0: makeOptimizer', () => {
  it('undefined is the default level; a bad level is E570 and falls back to the default', () => {
    expect(opt().o.spec.level).toBe(2);
    for (const bad of [4, '2', 'fast']) {
      const r = opt(bad);
      expect(r.codes()).toEqual(['E570']);
      expect(r.o.spec.level).toBe(2);
    }
  });

  it('an unknown --opt-disable name is E571; a known one is accepted', () => {
    expect(opt(2, ['temps', 'cmpjump']).codes()).toEqual([]);
    const r = opt(2, ['temps', 'nonsense']);
    expect(r.codes()).toEqual(['E571']);
    expect(r.bag.all()[0]?.message).toContain("'nonsense'");
  });

  it('-O0 gives generate no options (RC3 path); the other levels give the level\'s style and register temps', () => {
    const target = makeTarget({});
    expect(opt(0).o.codegen(target)).toBeUndefined();
    const o2 = opt(2).o.codegen(target);
    expect(o2?.registerTemps).toBe(true);
    expect(o2?.style).toBe('fast');
    expect(opt('s').o.codegen(target)?.style).toBe('short');
    expect(opt(1).o.codegen(target)?.style).toBe('base');
    const off = opt('s', ['temps', 'templates']).o.codegen(target);
    expect(off?.registerTemps).toBe(false);
    expect(off?.style).toBe('base');
    expect(off?.enabled('temps')).toBe(false);
    expect(off?.enabled('cmpjump')).toBe(true);
  });

  it('runs the passes a level selects, in order then by name, and skips disabled ones', () => {
    const log: string[] = [];
    const pass = (name: string, order: number, when: (l: OptLevel) => boolean): CodePass => ({
      name, order, when: (s) => when(s.level), run: (u) => (log.push(name), u),
    });
    const passes = [pass('zz', 100, () => true), pass('late', 900, () => true), pass('aa', 100, () => true), pass('o3only', 300, (l) => l === 3)];
    const target = makeTarget({});
    log.length = 0;
    opt(2, [], { passes: { code: passes } }).o.codegen(target)?.runCodePasses([]);
    expect(log).toEqual(['aa', 'zz', 'late']);
    log.length = 0;
    opt(3, ['zz'], { passes: { code: passes } }).o.codegen(target)?.runCodePasses([]);
    expect(log).toEqual(['aa', 'o3only', 'late']);
  });

  it('a pass\'s rule names are --opt-disable names, and the pass sees them through env.enabled', () => {
    let seen: boolean | undefined;
    const p: CodePass = { name: 'peephole', order: 100, names: ['000_o1_push_pop'], when: () => true, run: (u, env) => ((seen = env.enabled('000_o1_push_pop')), u) };
    const r = opt(2, ['000_o1_push_pop'], { passes: { code: [p] } });
    expect(r.codes()).toEqual([]);
    r.o.codegen(makeTarget({}))?.runCodePasses([]);
    expect(seen).toBe(false);
  });

  it('an IR pass that breaks the IR is E001 naming the pass, and the IR before it is kept', () => {
    const broken: IrPass = { name: 'ir-broken', order: 100, when: () => true, run: (ir) => ({ ...ir, main: [{ op: 'store', type: 'i16', dst: { k: 'global', label: '_x' }, a: { k: 'temp', id: 9 }, span: null }] }) };
    const r = opt(2, [], { passes: { ir: [broken] } });
    expect(r.o.ir(EMPTY_IR)).toBe(EMPTY_IR);
    expect(r.codes()).toEqual(['E001']);
    expect(r.bag.all()[0]?.message).toContain("'ir-broken'");
    // not at -O0, and not when disabled
    expect(opt(0, [], { passes: { ir: [broken] } }).o.ir(EMPTY_IR)).toBe(EMPTY_IR);
    const off = opt(2, ['ir-broken'], { passes: { ir: [broken] } });
    expect(off.o.ir(EMPTY_IR)).toBe(EMPTY_IR);
    expect(off.codes()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Through compile(): the hooks are wired, and every level is -O0's image
// ---------------------------------------------------------------------------

const io = diskTree((p) => {
  try {
    return readFileSync(resolve(repoRoot, p));
  } catch {
    return undefined;
  }
});

function build(main: string, defines: Record<string, string>, options: CompileOptions) {
  return compile({ files: io, main, defines, runtime: libTree(), options: { format: 'none', asm: true, map: true, ...options } });
}

describe('L5-0: the compile options', () => {
  it('E570 and E571 stop the compile with exit code 1', () => {
    const r1 = build('tests/fork-diff/flow.bas', {}, { optimize: 7 as unknown as OptLevel });
    expect(r1.ok).toBe(false);
    expect(r1.diagnostics.map((d) => d.code)).toEqual(['E570']);
    const r2 = build('tests/fork-diff/flow.bas', {}, { optDisable: ['no-such-pass'] });
    expect(r2.diagnostics.map((d) => d.code)).toEqual(['E571']);
    expect(r2.exitCode).toBe(1);
  });

  it('E570 and E571 are reported by --parse-only and the tokens/AST dumps too (follow-up 165, R17)', () => {
    for (const front of [{ parseOnly: true }, { dump: ['tokens'] }, { dump: ['ast', 'tokens'] }] as const) {
      const r1 = build('tests/fork-diff/flow.bas', {}, { ...front, optimize: 's9' as unknown as OptLevel });
      expect(r1.diagnostics.map((d) => d.code), JSON.stringify(front)).toEqual(['E570']);
      expect(r1.exitCode).toBe(1);
      const r2 = build('tests/fork-diff/flow.bas', {}, { ...front, optDisable: ['no-such-pass'] });
      expect(r2.diagnostics.map((d) => d.code), JSON.stringify(front)).toEqual(['E571']);
      const ok = build('tests/fork-diff/flow.bas', {}, { ...front, optimize: 's', optDisable: ['temps'] });
      expect(ok.ok, JSON.stringify(front)).toBe(true);
    }
  });

  it('--opt-disable with every name given, and --opt-trace with nothing to trace, build -O0\'s asm', () => {
    const a = build('tests/fork-diff/flow.bas', {}, { optimize: 0 });
    const b = build('tests/fork-diff/flow.bas', {}, { optimize: 's', optTrace: true, optDisable: optNames() });
    expect(b.ok).toBe(true);
    expect(b.asm).toBe(a.asm);
  });

  it('--opt-trace changes comment lines only: the image is the same with and without it', () => {
    const a = build('tests/fork-diff/flow.bas', {}, { optimize: 2 });
    const b = build('tests/fork-diff/flow.bas', {}, { optimize: 2, optTrace: true });
    expect(Buffer.from(b.binary ?? []).equals(Buffer.from(a.binary ?? []))).toBe(true);
    expect(b.asm).toMatch(/; opt [a-z0-9_-]+: /); // L5-TEMPS removed flow's push/pop pairs, so which rule fires is not pinned
    expect(a.asm).not.toMatch(/; opt /);
  });
});

/** The images of the wave-0 guarantee: flow (fork-diff), and Lamplighter's four builds as tools/lamp.py builds them. */
const IDENTITY: ReadonlyArray<readonly [string, string, Record<string, string>, CompileOptions]> = [
  ['flow', 'tests/fork-diff/flow.bas', {}, {}],
  ['lamp464', 'tests/games/lamplighter/main.bas', { CPC464: '' }, { org: 0x40 }],
  ['lamp6128', 'tests/games/lamplighter/main.bas', { CPC6128: '' }, { org: 0x40 }],
  ['lampplus', 'tests/games/lamplighter/main.bas', { PLUS: '' }, { org: 0x40 }],
  ['lamppluc', 'tests/games/lamplighter/main.bas', { PLUS: '', CPC_BAREMETAL: '', CPC_OWNFONT: '' }, { org: 0x40 }],
];

describe('L5-0: with every pass and feature disabled, a level builds -O0\'s code', () => {
  it.each(IDENTITY)('%s: every level and the default build -O0\'s image, asm and map', (_name, main, defines, options) => {
    const base = build(main, defines, { ...options, optimize: 0 });
    expect(base.ok).toBe(true);
    expect(base.binary?.length).toBeGreaterThan(1000);
    for (const level of [1, 2, 3, 's', undefined] as const) {
      const r = build(main, defines, { ...options, optDisable: optNames(), ...(level === undefined ? {} : { optimize: level }) });
      expect(r.ok, `-O${String(level)}`).toBe(true);
      expect(Buffer.from(r.binary ?? []).equals(Buffer.from(base.binary ?? [])), `-O${String(level)} image`).toBe(true);
      expect(r.asm, `-O${String(level)} asm`).toBe(base.asm);
      expect(r.map, `-O${String(level)} map`).toBe(base.map);
    }
  }, 60_000);
});

describe('L5-0: the code-stage hook in generate', () => {
  const SRC = 'ON BREAK STOP\nx% = 1\nASM\n  nop\nEND ASM\nPRINT x%\n';
  const codegen = (run: (u: readonly CodeUnit[]) => readonly CodeUnit[]): CodegenOptions => ({ registerTemps: false, style: 'base', enabled: () => true, runCodePasses: run });

  it('hands every unit to the code passes, tagged: a boundary per statement, the ESC check and ASM lines opaque', () => {
    const low = lowerSource(SRC);
    expect(low.diagnostics).toEqual([]);
    let seen: readonly CodeUnit[] = [];
    const bag = new DiagnosticBag();
    const plain = generate({ ir: low.ir, target: makeTarget({}), diagnostics: bag, sources: low.sources });
    const hooked = generate({ ir: low.ir, target: makeTarget({}), diagnostics: bag, sources: low.sources, opt: codegen((u) => ((seen = u), u)) });
    expect(hooked).toEqual(plain);
    expect(seen.map((u) => u.procedure)).toEqual([null]);
    const main = seen[0] as CodeUnit;
    expect(main.quads).toBe(low.ir.main);
    const stmts = low.ir.main.filter((q) => q.op === 'stmt').length;
    expect(main.lines.filter((l) => l.kind === 'boundary')).toHaveLength(stmts);
    expect(main.lines.filter((l) => l.kind === 'boundary').every((l) => l.text === '' && low.ir.main[l.quad]?.op === 'stmt')).toBe(true);
    const opaque = main.lines.filter((l) => l.kind === 'opaque').map((l) => l.text);
    expect(opaque).toContain('  nop');
    expect(opaque.some((t) => t.includes('__LOCO_CHKBRK'))).toBe(true);
    expect(opaque.some((t) => t.startsWith('#line '))).toBe(true);
    // the flattened lines are main's text
    expect(main.lines.filter((l) => l.kind !== 'boundary').map((l) => l.text)).toEqual(plain.main);
  });

  it('what the passes return is what generate emits', () => {
    const low = lowerSource(SRC);
    const bag = new DiagnosticBag();
    const marked = generate({
      ir: low.ir, target: makeTarget({}), diagnostics: bag, sources: low.sources,
      opt: codegen((units) => units.map((u) => ({ ...u, lines: [{ text: '\t; opt test: first', kind: 'code', quad: 0 }, ...u.lines] }))),
    });
    expect(marked.main[0]).toBe('\t; opt test: first');
  });
});

describe('L5-0: the default level is -O2', () => {
  it('no level builds the same as -O2', () => {
    const a = build('tests/fork-diff/flow.bas', {}, {});
    const b = build('tests/fork-diff/flow.bas', {}, { optimize: 2 });
    expect(a.asm).toBe(b.asm);
    expect(Buffer.from(a.binary ?? []).equals(Buffer.from(b.binary ?? []))).toBe(true);
  });
});
