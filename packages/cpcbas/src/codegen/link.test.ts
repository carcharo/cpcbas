import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assemble } from '../asm/assemble.js';
import { flatten } from '../asm/image.js';
import { DiagnosticBag } from '../core/diagnostics.js';
import { SourceSet } from '../core/source.js';
import type { IrDataItem, IrGlobal, IrProgram, Quad } from '../ir/ir.js';
import { checkLayout } from '../layout/index.js';
import { emitData, emitGlobals, emitStrings, encodeReal5 } from './data.js';
import { generate, link, makeTarget, TEMPLATES, type Target, type TemplateTable } from './index.js';
import { templateKey } from './types.js';
import { generateWith } from './generate.js';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const GOLDEN = `${REPO}tests/asm-golden/programs/`;

function loadTree(): Map<string, string> {
  const tree = new Map<string, string>();
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = `${dir}/${name}`;
      if (statSync(full).isDirectory()) walk(full, `${prefix}${name}/`);
      else if (name.endsWith('.asm')) tree.set(`${prefix}${name}`, readFileSync(full, 'latin1'));
    }
  };
  walk(`${REPO}lib/runtime`, 'runtime/');
  return tree;
}
const TREE = loadTree();

const span = { file: 0 as never, start: 0, end: 0 };
const end: Quad = { op: 'end', a: { k: 'imm', value: 0 }, span: null };
const emptyIr = (main: readonly Quad[], extra: Partial<IrProgram> = {}): IrProgram => ({
  main,
  procedures: [],
  globals: [],
  strings: [],
  data: [],
  requires: [],
  inits: [],
  ...extra,
});

const ENDSEQ = ['\tld hl, 0', '\tld b, h', '\tld c, l', '.core.__END_PROGRAM:', '\tjp .core.__CPC_END'];

/** Test-only templates for the constructs the golden programs use. */
function testTemplates(strLabels: readonly string[]): TemplateTable {
  return {
    end: () => ENDSEQ,
    rtcall: (q, ctx) => [ctx.requires.call((q as Extract<Quad, { op: 'rtcall' }>).label)],
    'fparam:str': (q) => {
      const a = (q as Extract<Quad, { op: 'fparam' }>).a;
      if (a.k !== 'strconst') throw new Error('test template: strconst only');
      return [`\tld hl, ${strLabels[a.id]}`, '\txor a'];
    },
  };
}

function build(ir: IrProgram, target: Target, templates: TemplateTable, sources = new SourceSet(), diagnostics = new DiagnosticBag()) {
  const asm = generateWith({ ir, target, diagnostics, templates: [templates] }, TEMPLATES);
  const linked = link({ asm, target, runtime: TREE, sources, diagnostics });
  const entry = sources.add('program.asm', linked.text, 'generated');
  const result = assemble({
    sources,
    entry,
    resolveInclude: linked.resolveInclude,
    options: { initMode: 'collect', defines: target.asmDefines },
  });
  return { asm, linked, result, diagnostics };
}

const golden = (name: string): Uint8Array => new Uint8Array(readFileSync(GOLDEN + name));

describe('link: byte-identity with the reference', () => {
  it('an empty program is empty.bin', () => {
    const { result, diagnostics, linked } = build(emptyIr([end]), makeTarget({}), testTemplates([]));
    expect(diagnostics.all().map((d) => d.message)).toEqual([]);
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(linked.heapInUse).toBe(false);
    expect(linked.inits).toEqual(['.core.CPC_INIT_00_BOOTSTRAP']);
    expect(Buffer.from(flatten(result.segments).bytes).equals(Buffer.from(golden('empty.bin')))).toBe(true);
  });

  it('the prologue text is the reference text for the empty program', () => {
    const { linked } = build(emptyIr([end]), makeTarget({}), testTemplates([]));
    const ref = readFileSync(`${GOLDEN}empty.asm`, 'latin1').split('\n').slice(0, 23);
    expect(linked.text.split('\n').slice(0, 22)).toEqual(ref.slice(0, 22));
  });

  const helloIr = (): IrProgram =>
    emptyIr(
      [
        { op: 'rtcall', label: '.core.COPY_ATTR', ret: null, dst: null, span: null },
        { op: 'fparam', type: 'str', a: { k: 'strconst', id: 0 }, span: null },
        { op: 'rtcall', label: '.core.__PRINTSTR', ret: null, dst: null, span: null },
        { op: 'rtcall', label: '.core.PRINT_EOL', ret: null, dst: null, span: null },
        end,
      ],
      { strings: [{ id: 0, label: '.LABEL.__LABEL0', bytes: new Uint8Array([...'HELLO CPC'].map((c) => c.charCodeAt(0))) }] },
    );

  it('print_hello is print_hello.bin (heap EQUs, string format, include order)', () => {
    const { result, diagnostics, linked, asm } = build(helloIr(), makeTarget({}), testTemplates(['.LABEL.__LABEL0']));
    expect(diagnostics.all().map((d) => d.message)).toEqual([]);
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(linked.heapInUse).toBe(true);
    expect(linked.inits).toEqual(['.core.CPC_INIT_00_BOOTSTRAP', '.core.__MEM_INIT']);
    expect(asm.requires).toContain('print.asm');
    const ref = readFileSync(`${GOLDEN}print_hello.asm`, 'latin1').split('\n');
    expect(linked.text.split('\n').slice(0, 43)).toEqual(ref.slice(0, 43));
    expect(Buffer.from(flatten(result.segments).bytes).equals(Buffer.from(golden('print_hello.bin')))).toBe(true);
  });

  it('the bare target gives the bare EQUs and heap address, and -D names reach the asm', () => {
    const target = makeTarget({ defines: { CPC_BAREMETAL: '' } });
    const { linked, result, diagnostics } = build(helloIr(), target, testTemplates(['.LABEL.__LABEL0']));
    expect(diagnostics.all().map((d) => d.message)).toEqual([]);
    const bareRef = readFileSync(`${GOLDEN}cpc_strings_bare.asm`, 'latin1').split('\n');
    expect(linked.text.split('\n').slice(0, 5)).toEqual(bareRef.slice(0, 5));
    expect(linked.text).toContain('.core.ZXBASIC_MEM_HEAP EQU 42336');
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    // a bare build assembles differently from the firmware build: CPC_BAREMETAL reached the runtime
    const fw = build(helloIr(), makeTarget({}), testTemplates(['.LABEL.__LABEL0']));
    expect(Buffer.from(flatten(result.segments).bytes).equals(Buffer.from(flatten(fw.result.segments).bytes))).toBe(false);
  });

  it('a missing runtime file is E420 naming it, and is not included', () => {
    const sources = new SourceSet();
    const diagnostics = new DiagnosticBag();
    const target = makeTarget({});
    const asm = { data: [], main: ENDSEQ, procedures: [], constants: [], requires: ['bootstrap.asm', 'nosuch.asm'], inits: [] };
    const linked = link({ asm, target, runtime: TREE, sources, diagnostics });
    const errs = diagnostics.all();
    expect(errs.map((d) => d.code)).toEqual(['E420']);
    expect(errs[0]?.message).toContain('nosuch.asm');
    expect(linked.text).not.toContain('nosuch.asm');
    expect(sources.text(errs[0]?.span ?? span)).toBe('#include once <nosuch.asm>');
  });

  it('a missing #require file is E421 at the #require, once, and generate passes the spans through', () => {
    const sources = new SourceSet();
    const diagnostics = new DiagnosticBag();
    const f = sources.add('prog.bas', '#require "nosuch.asm"\n', 'user');
    const at = { file: f.id, start: 0, end: 21 };
    const ir = emptyIr([end], { requires: ['nosuch.asm'], requireSpans: new Map([['nosuch.asm', at]]) });
    const asm = generateWith({ ir, target: makeTarget({}), diagnostics, templates: [testTemplates([])] }, []);
    expect(asm.requireSpans?.get('nosuch.asm')).toBe(at);
    link({ asm, target: makeTarget({}), runtime: TREE, sources, diagnostics });
    expect(diagnostics.all().map((d) => [d.code, d.message, d.span])).toEqual([['E421', "#require file 'nosuch.asm' not found in the runtime library", at]]);
  });

  it('source #init labels join the runtime ones, sorted and unique', () => {
    const target = makeTarget({});
    const asm = { data: [], main: ENDSEQ, procedures: [], constants: [], requires: ['bootstrap.asm'], inits: ['_zz', '.core.CPC_INIT_00_BOOTSTRAP'] };
    const linked = link({ asm, target, runtime: TREE, sources: new SourceSet(), diagnostics: new DiagnosticBag() });
    expect(linked.inits).toEqual(['.core.CPC_INIT_00_BOOTSTRAP', '_zz']);
  });

  it('quoted includes search the including file directory first', () => {
    const tree = new Map<string, string>([
      ['runtime/sub/a.asm', 'x:\n'],
      ['runtime/a.asm', 'y:\n'],
    ]);
    const { resolveInclude } = link({
      asm: { data: [], main: [], procedures: [], constants: [], requires: [], inits: [] },
      target: makeTarget({}),
      runtime: new Map([...tree, ...TREE]),
      sources: new SourceSet(),
      diagnostics: new DiagnosticBag(),
    });
    expect(resolveInclude('a.asm', 'runtime/sub/b.asm', false)?.path).toBe('runtime/sub/a.asm');
    expect(resolveInclude('a.asm', 'runtime/sub/b.asm', true)?.path).toBe('runtime/a.asm');
    expect(resolveInclude('nope.asm', 'x', true)).toBeUndefined();
  });
});

describe('generate', () => {
  it('a missing template is E002 at the quad and generation continues', () => {
    const s = { file: 0 as never, start: 3, end: 5 };
    const ir = emptyIr([{ op: 'add', type: 'f', dst: { k: 'temp', id: 0 }, a: { k: 'imm', value: 1 }, b: { k: 'imm', value: 2 }, span: s }, end]);
    const d = new DiagnosticBag();
    const asm = generateWith({ ir, target: makeTarget({}), diagnostics: d, templates: [{ end: () => ['\tnop'] }] }, []);
    expect(d.all().map((x) => [x.code, x.message, x.span])).toEqual([['E002', '`add` on `f` is not implemented yet', s]]);
    expect(asm.main).toEqual(['\tnop']);
  });

  it('a cast is keyed by both types, cast:<from>-><to>', () => {
    const cast = (from: 'u8' | 'f', to: 'i16'): Quad => ({ op: 'cast', type: to, from, dst: { k: 'temp', id: 0 }, a: { k: 'imm', value: 1 }, span: null });
    expect(templateKey(cast('u8', 'i16'))).toBe('cast:u8->i16');
    const t: TemplateTable = { 'cast:u8->i16': () => ['\tint'], 'cast:f->i16': () => ['\treal'] };
    const ir = emptyIr([cast('u8', 'i16'), cast('f', 'i16')]);
    const asm = generateWith({ ir, target: makeTarget({}), diagnostics: new DiagnosticBag(), templates: [t] }, []);
    expect(asm.main).toEqual(['\tint', '\treal']);
  });

  it('with the real TEMPLATES a quad nobody implements (pow on an integer) is E002', () => {
    const d = new DiagnosticBag();
    const pow: Quad = { op: 'pow', type: 'i16', dst: { k: 'temp', id: 0 }, a: { k: 'imm', value: 2 }, b: { k: 'imm', value: 3 }, span: null };
    generate({ ir: emptyIr([pow]), target: makeTarget({}), diagnostics: d });
    expect(d.all().map((x) => x.message)).toEqual(['`pow` on `i16` is not implemented yet']);
  });

  it('newLabel continues after the highest .T.<n> in the IR, in main and procedures', () => {
    const t: TemplateTable = { label: (_q, ctx) => [ctx.newLabel(), ctx.newLabel()] };
    const lab = (label: string): Quad => ({ op: 'label', label, span: null });
    const proc = { label: '_p', convention: 'STDCALL' as const, params: [], ret: null, body: [lab('.T.9')] };
    const ir = emptyIr([lab('.T.4'), lab('.L.10')], { procedures: [proc] });
    const asm = generateWith({ ir, target: makeTarget({}), diagnostics: new DiagnosticBag(), templates: [t] }, []);
    expect(asm.main).toEqual(['.T.10', '.T.11', '.T.12', '.T.13']);
  });

  it('stmt emits nothing, comment emits a comment, asm emits #line before each line and a bare #line after', () => {
    const sources = new SourceSet();
    const f = sources.add('prog.bas', 'PRINT 1\nASM\n', 'user');
    const s = { file: f.id, start: 8, end: 11 };
    const ir = emptyIr([
      { op: 'stmt', number: 10, span: s },
      { op: 'comment', text: 'hello', span: null },
      { op: 'asm', lines: [{ text: '\tnop', span: s }], span: s },
    ]);
    const asm = generateWith({ ir, target: makeTarget({}), diagnostics: new DiagnosticBag(), templates: [], sources }, []);
    expect(asm.main).toEqual(['\t; hello', '#line 2 "prog.bas"', '\tnop', '#line']);
  });

  it('an internal asm quad (the lowering\'s own lines) gets no #line', () => {
    const sources = new SourceSet();
    const f = sources.add('prog.bas', 'BORDER 1\n', 'user');
    const s = { file: f.id, start: 0, end: 8 };
    const ir = emptyIr([{ op: 'asm', lines: [{ text: '\tld b, 1', span: s }], span: s, internal: true }]);
    const asm = generateWith({ ir, target: makeTarget({}), diagnostics: new DiagnosticBag(), templates: [], sources }, []);
    expect(asm.main).toEqual(['\tld b, 1']);
  });

  it('records #require files and keeps #init labels in source order; main, procedures, constants are separate', () => {
    const ir = emptyIr([end], { requires: ['zeta.asm', 'alpha.asm'], inits: ['_b', '_a'] });
    const asm = generateWith({ ir, target: makeTarget({}), diagnostics: new DiagnosticBag(), templates: [testTemplates([])] }, []);
    expect(asm.requires).toEqual(['alpha.asm', 'bootstrap.asm', 'zeta.asm']);
    expect(asm.inits).toEqual(['_b', '_a']);
  });
});

describe('data emission', () => {
  const g = (p: Partial<IrGlobal>): IrGlobal => ({ label: '_x', type: 'u8', size: 1, init: null, at: null, dims: [], ...p });
  it('globals: zeros, init bytes, AT', () => {
    const d = new DiagnosticBag();
    const lines = emitGlobals(
      [g({}), g({ label: '_n', type: 'f', size: 5 }), g({ label: '_w', type: 'u16', size: 2, init: new Uint8Array([0x34, 0x12]) }), g({ label: '_s', at: 16384 })],
      d,
      span,
    );
    expect(lines).toEqual(['_x:', '\tDEFB 00', '_n:', '\tDEFB 00, 00, 00, 00, 00', '_w:', '\tDEFB 34h', '\tDEFB 12h', '_s EQU 16384']);
    expect(d.all().map((x) => x.code)).toEqual([]);
  });

  it('arrays: descriptor, elements, dimension and UBOUND tables (docs/ir.md "Arrays")', () => {
    const d = new DiagnosticBag();
    // DIM a(2) AS UBYTE => {7, 8}; DIM m(1, 2) AS UINTEGER AT &C000; DIM h(2) AS UBYTE => {1, 2} under #pragma hidata = &8000
    const lines = emitGlobals(
      [
        g({ label: '_a', dims: [3], size: 11, init: new Uint8Array([7, 8]) }),
        g({ label: '_m', type: 'u16', dims: [2, 3], size: 8, at: 0xc000 }),
        g({ label: '_h', dims: [2], size: 8, init: new Uint8Array([1, 2]), hidata: 0x8000 }),
      ],
      d,
      span,
    );
    expect(lines).toEqual([
      '_a:', '\tDEFW _a.__DIMS__', '_a.__DATA__.__PTR__:', '\tDEFW _a.__DATA__', '\tDEFW 0', '\tDEFW _a.__UBOUND__',
      '_a.__DATA__:', '\tDEFB 07h, 08h, 00h',
      '_a.__DIMS__:', '\tDEFB 00h, 00h, 01h', '_a.__UBOUND__:', '\tDEFB 02h, 00h',
      '_m:', '\tDEFW _m.__DIMS__', '_m.__DATA__.__PTR__:', '\tDEFW _m.__DATA__', '\tDEFW 0', '\tDEFW _m.__UBOUND__',
      '_m.__DATA__ EQU 49152',
      '_m.__DIMS__:', '\tDEFB 01h, 00h, 03h, 00h, 02h', '_m.__UBOUND__:', '\tDEFB 01h, 00h, 02h, 00h',
      '_h:', '\tDEFW _h.__DIMS__', '_h.__DATA__.__PTR__:', '\tDEFW _h.__DATA__', '\tDEFW 0', '\tDEFW _h.__UBOUND__',
      '_h.__DATA__.__BACK__:', '\torg 32768', '_h.__DATA__:', '\tDEFB 01h, 02h', '\torg _h.__DATA__.__BACK__',
      '_h.__DIMS__:', '\tDEFB 00h, 00h, 01h', '_h.__UBOUND__:', '\tDEFB 01h, 00h',
    ]);
    expect(d.all().map((x) => x.code)).toEqual([]);
  });

  it('an emitted array assembles to the layout __ARRAY reads', () => {
    const ir = emptyIr([end], { globals: [g({ label: '_b', type: 'u16', dims: [3, 4], size: 32 })] });
    const { result, diagnostics } = build(ir, makeTarget({}), testTemplates([]));
    expect(diagnostics.all().map((x) => x.message)).toEqual([]);
    expect(result.diagnostics.filter((x) => x.severity === 'error').map((x) => x.code)).toEqual([]);
    const sym = (n: string): number => (result.symbols.get(n) ?? result.symbols.get(`.${n}`))!.value;
    const image = flatten(result.segments);
    const word = (a: number): number => image.bytes[a - image.org]! | (image.bytes[a - image.org + 1]! << 8);
    const b = sym('_b');
    expect(word(b)).toBe(sym('_b.__DIMS__'));
    expect(word(b + 2)).toBe(sym('_b.__DATA__'));
    expect(word(b + 4)).toBe(0);
    expect(word(b + 6)).toBe(sym('_b.__UBOUND__'));
    expect(sym('_b.__DATA__')).toBe(b + 8);
    expect(sym('_b.__DIMS__')).toBe(b + 8 + 24);
    expect([word(sym('_b.__DIMS__')), word(sym('_b.__DIMS__') + 2), image.bytes[sym('_b.__DIMS__') + 4 - image.org]]).toEqual([1, 4, 2]);
    expect([word(sym('_b.__UBOUND__')), word(sym('_b.__UBOUND__') + 2)]).toEqual([2, 3]);
  });

  it('hex bytes that start with a letter get a leading 0, and assemble (not read as labels)', () => {
    expect(emitGlobals([g({ label: '_w', type: 'u16', size: 2, init: new Uint8Array([0xaa, 0x0b]) })], new DiagnosticBag(), span)).toEqual([
      '_w:',
      '\tDEFB 0AAh',
      '\tDEFB 0Bh',
    ]);
    expect(emitStrings([{ id: 0, label: '.S.0', bytes: new Uint8Array(0xa000) }])[1]).toBe('\tDEFW 0A000h');
    const ir = emptyIr([end], { globals: [g({ label: '_w', type: 'u16', size: 2, init: new Uint8Array([0xaa, 0xfb]) })] });
    const { result, diagnostics } = build(ir, makeTarget({}), testTemplates([]));
    expect(diagnostics.all().map((d) => d.message)).toEqual([]);
    expect(result.diagnostics.filter((d) => d.severity === 'error').map((d) => d.code)).toEqual([]);
    const bytes = flatten(result.segments).bytes;
    expect([...bytes].some((b, i) => b === 0xaa && bytes[i + 1] === 0xfb)).toBe(true);
  });

  it('strings as the reference', () => {
    expect(emitStrings([{ id: 0, label: '.S.0', bytes: new Uint8Array([72, 255]) }])).toEqual(['.S.0:', '\tDEFW 0002h', '\tDEFB 48h', '\tDEFB 0FFh']);
  });

  it('DATA table: labelled start, typed items, terminator', () => {
    const items: IrDataItem[] = [
      { label: '.D.10', type: 'u8', value: 1 },
      { label: null, type: 'i16', value: -2 },
      { label: null, type: 'str', value: new Uint8Array([65]) },
    ];
    expect(emitData(items, new DiagnosticBag(), span, false)).toEqual([
      '.DATA.__DATA__0:', '.D.10:', '\tDEFB 3', '\tDEFB 1', '\tDEFB 4', '\tDEFB 254', '\tDEFB 255', '\tDEFB 1', '\tDEFW .DATA.__S0',
      '__DATA__END:', '\tDEFB 00h', '.DATA.__S0:', '\tDEFW 0001h', '\tDEFB 41h',
    ]);
    expect(emitData([], new DiagnosticBag(), span, false)).toEqual([]);
    expect(emitData([], new DiagnosticBag(), span, true)).toEqual(['.DATA.__DATA__0:', '__DATA__END:', '\tDEFB 00h']);
  });

  it('real numbers in Locomotive\'s 5-byte layout (bytes 0..4 as PEEK(@a + i) read them on the interpreter)', () => {
    // measured on the 464 and the 6128: mantissa low byte first, exponent last
    const measured: [number, number[]][] = [
      [0, [0x00, 0x00, 0x00, 0x00, 0x00]],
      [1, [0x00, 0x00, 0x00, 0x00, 0x81]],
      [0.5, [0x00, 0x00, 0x00, 0x00, 0x80]],
      [-1, [0x00, 0x00, 0x00, 0x80, 0x81]],
      [3, [0x00, 0x00, 0x00, 0x40, 0x82]],
      [0.1, [0xcd, 0xcc, 0xcc, 0x4c, 0x7d]],
      [1e10, [0x00, 0xf9, 0x02, 0x15, 0xa2]],
      [-2.5, [0x00, 0x00, 0x00, 0xa0, 0x82]],
      [255, [0x00, 0x00, 0x00, 0x7f, 0x88]],
    ];
    for (const [v, bytes] of measured) expect(encodeReal5(v), String(v)).toEqual(bytes);
    expect(encodeReal5(2.5)).toEqual([0, 0, 0, 0x20, 0x82]);
  });

  it('the cpc_data program links with its DATA table', () => {
    const items: IrDataItem[] = [1, 2, 3].map((v) => ({ label: null, type: 'u8' as const, value: v }));
    const ir = emptyIr([end], { data: items, globals: [g({ label: '_x' }), g({ label: '_y' })], requires: ['read_restore.asm'] });
    const { asm } = build(ir, makeTarget({}), testTemplates([]));
    const ref = readFileSync(`${GOLDEN}cpc_data.asm`, 'latin1').split('\n');
    const at = ref.indexOf('.DATA.__DATA__0:');
    expect(asm.constants.slice(0, 7)).toEqual(ref.slice(at, at + 7));
    expect(asm.data).toEqual(['_x:', '\tDEFB 00', '_y:', '\tDEFB 00']);
  });
});

describe('#pragma hidata arrays (IrGlobal.hidata)', () => {
  const g = (p: Partial<IrGlobal>): IrGlobal => ({ label: '_x', type: 'u8', size: 1, init: null, at: null, dims: [], ...p });
  const hi = (hidata: number): IrProgram =>
    emptyIr([end], {
      globals: [
        g({ label: '_before' }),
        g({ label: '_h', type: 'u16', dims: [3], size: 8, init: Uint8Array.from([1, 0, 2, 0, 3, 0]), hidata }),
        g({ label: '_after' }),
      ],
    });
  const sym = (r: ReturnType<typeof build>['result'], n: string): number => (r.symbols.get(n) ?? r.symbols.get(`.${n}`))!.value;

  it('assembles the elements at their address and leaves the data area and the code where they were', () => {
    const plain = build(emptyIr([end], { globals: [g({ label: '_before' }), g({ label: '_after' })] }), makeTarget({}), testTemplates([]));
    const { result, diagnostics } = build(hi(0x8000), makeTarget({}), testTemplates([]));
    expect(diagnostics.all().map((d) => d.message)).toEqual([]);
    expect(result.diagnostics.filter((d) => d.severity === 'error').map((d) => d.code)).toEqual([]);
    expect(sym(result, '_h.__DATA__')).toBe(0x8000);
    // the descriptor's +2 word points there; the elements are in the image, in order, and the third word is zero
    const read = (a: number): number => {
      const seg = result.segments.find((s) => a >= s.org && a < s.org + s.bytes.length)!;
      return seg.bytes[a - seg.org]!;
    };
    expect([0, 1, 2, 3, 4, 5].map((i) => read(0x8000 + i))).toEqual([1, 0, 2, 0, 3, 0]);
    expect(read(sym(result, '_h') + 2) | (read(sym(result, '_h') + 3) << 8)).toBe(0x8000);
    // the program's own segment is the main one at the origin; the elements form a second segment
    expect(result.segments.map((s) => s.org)).toEqual([0x40, 0x8000]);
    expect(result.segments[1]!.bytes.length).toBe(6);
    // ZXBASIC_USER_DATA_LEN counts the descriptor and tables, not the elements
    expect(sym(result, '.core.ZXBASIC_USER_DATA_LEN')).toBe(sym(plain.result, '.core.ZXBASIC_USER_DATA_LEN') + 8 + 3 + 2);
    expect(sym(result, '.core.__MAIN_PROGRAM__') - sym(plain.result, '.core.__MAIN_PROGRAM__')).toBe(8 + 3 + 2);
  });

  const layout = (hidata: number, extra: Partial<Parameters<typeof checkLayout>[0]> = {}) => {
    const target = makeTarget({});
    const { result, linked } = build(hi(hidata), target, testTemplates([]));
    const bag = new DiagnosticBag();
    const ok = checkLayout({
      map: target.map,
      segments: result.segments.map((s) => ({ start: s.org, end: s.org + s.bytes.length })),
      heapInUse: linked.heapInUse,
      heapAddress: target.heapAddress,
      heapSize: target.heapSize,
      globalLabels: new Set(),
      span,
      diagnostics: bag,
      ...extra,
    });
    return { ok, messages: bag.all().map((d) => `${d.code} ${d.message}`) };
  };

  it('the layout check sees the block as a "data placed at" segment: fine below the limit', () => {
    expect(layout(0x8000)).toEqual({ ok: true, messages: [] });
  });

  it('a block past the memory limit is E401, named "data placed at"', () => {
    expect(layout(0xc000).messages).toEqual(["E401 data placed at ends at 0xC006, past this architecture's memory limit of 0x9E00"]);
  });

  it('a block inside the heap is E402', () => {
    const target = makeTarget({});
    const messages = layout(target.heapAddress + 16, { heapInUse: true }).messages;
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/^E402 data placed at 0x[0-9A-F]{4}-0x[0-9A-F]{4} overlaps the heap/);
  });

  it('a block over a reserved range of a library that reserves it is E400', () => {
    const r = layout(0x5000, { globalLabels: new Set(['.core.__CPC_RESERVE_4000']) });
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]).toMatch(/^E400 data placed at 0x5000-0x5005 overlaps 0x4000-0x7FFF, reserved because/);
  });
});
