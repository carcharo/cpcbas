/**
 * L2-CG-FLOW: every template is generated through generate() + link(), assembled with our
 * assembler over lib/runtime and executed on the test Z80 with the fake CPC firmware
 * (test/z80sim). The integer templates belong to L2-CG-INT, so the few the programs need
 * (load, store, add, sub, jz, jnz, param, fparam, peek, poke) are test-only versions at the
 * bottom of this file, written independently of flow.ts except for the operand loader.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assemble } from '../asm/assemble.js';
import { flatten } from '../asm/image.js';
import { DiagnosticBag } from '../core/diagnostics.js';
import { asFileId, SourceSet, type Span } from '../core/source.js';
import { addr, frame, global as rawGlobal, imm, IrBuilder } from '../ir/builder.js';
import type { IrGlobal, IrProcedure, IrProgram, IrType, Operand, Quad } from '../ir/ir.js';
import { verifyIr } from '../ir/verify.js';
import { runImage } from '../../test/z80sim/run.js';
import { FLOW_TEMPLATES, loadReg, memSize } from './flow.js';
import { generateWith } from './generate.js';
import { INT_TEMPLATES } from './int.js';
import { link, makeTarget, TEMPLATES, type Template, type TemplateTable } from './index.js';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));

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
  walk(`${REPO}lib/loco`, 'loco/'); // the break check is lib/loco/keys.asm (L4-KEYS)
  return tree;
}
const TREE = loadTree();

const SP: Span = { file: asFileId(0), start: 0, end: 0 };
const s16 = (v: number): number => (v << 16) >> 16;

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

/** Test globals are `_name` labels (a bare `r` or `m` would be a register to the assembler). */
const global = (label: string): Operand => rawGlobal(`_${label}`);

const g = (label: string, type: IrType): IrGlobal => ({
  label: `_${label}`,
  type,
  size: memSize(type),
  init: null,
  at: null,
  dims: [],
});

interface Built {
  main: readonly Quad[];
  procs?: readonly IrProcedure[];
  globals: readonly IrGlobal[];
}

interface Outcome {
  stopped: string;
  asm: ReturnType<typeof generateWith>;
  word(label: string, offset?: number): number;
  byte(label: string, offset?: number): number;
  mem: Uint8Array;
  sp: number;
}

function run(b: Built, opts: { noVerify?: boolean; first?: TemplateTable; checkBreak?: boolean } = {}): Outcome {
  const ir: IrProgram = {
    main: b.main,
    procedures: b.procs ?? [],
    globals: [...b.globals, g('sp_end', 'u16')],
    strings: [],
    data: [],
    requires: [],
    inits: [],
    ...(opts.checkBreak === true ? { checkBreak: true } : {}),
  };
  if (!opts.noVerify) expect(verifyIr(ir)).toEqual([]);
  const target = makeTarget({ defines: { __CPC_PRINTER_ECHO__: '' } });
  const diagnostics = new DiagnosticBag();
  const sources = new SourceSet();
  const asm = generateWith({ ir, target, diagnostics, templates: [...(opts.first ? [opts.first] : []), FLOW_TEMPLATES, TEST_TEMPLATES] }, TEMPLATES);
  expect(diagnostics.all().map((d) => d.message)).toEqual([]);
  const linked = link({ asm, target, runtime: TREE, sources, diagnostics });
  const entry = sources.add('program.asm', linked.text, 'generated');
  const result = assemble({
    sources,
    entry,
    resolveInclude: linked.resolveInclude,
    options: { initMode: 'collect', defines: target.asmDefines },
  });
  expect(result.diagnostics.filter((d) => d.severity !== 'note').map((d) => d.message)).toEqual([]);
  const image = flatten(result.segments);
  const sym = (l: string): number => {
    if (!l.startsWith('.') && !l.startsWith('_')) l = `_${l}`;
    const s = result.symbols.get(l) ?? result.symbols.get(`.${l}`);
    if (!s) throw new Error(`undefined label ${l}`);
    return s.value;
  };
  const r = runImage(image.bytes, image.org, sym('.core.__START_PROGRAM'));
  return {
    stopped: r.stopped,
    asm,
    mem: r.memory,
    byte: (l, o = 0) => r.memory[sym(l) + o],
    word: (l, o = 0) => r.memory[sym(l) + o] | (r.memory[sym(l) + o + 1] << 8),
    sp: r.cpu.sp,
  };
}

/** A program: `body(b)` fills the main program; END is appended. */
function program(body: (b: IrBuilder) => void, globals: IrGlobal[], procs: IrProcedure[] = []): Built {
  const b = new IrBuilder();
  body(b);
  b.end();
  return { main: b.take(), globals, procs };
}

const asmQ = (...lines: string[]): Quad => ({ op: 'asm', lines: lines.map((text) => ({ text, span: SP })), span: null });

/** `ctr = ctr + 1; slot = ctr` (a trace marker). */
function mark(b: IrBuilder, slot: string): void {
  const c = b.load('i16', global('ctr'));
  const c1 = b.add('i16', c, imm(1));
  b.store('i16', global('ctr'), c1);
  const c2 = b.load('i16', global('ctr'));
  b.store('i16', global(slot), c2);
}

/** Records SP into `slot` (an `asm` quad). */
const saveSp = (slot: string): Quad => asmQ(`\tld (_${slot}), sp`);

function proc(label: string, convention: IrProcedure['convention'], params: IrProcedure['params'], ret: IrType | null, body: Quad[]): IrProcedure {
  return { label, convention, params, ret, body };
}

// ---------------------------------------------------------------------------
// conditional jumps
// ---------------------------------------------------------------------------

describe('conditional jumps (test-only jz/jnz over flow.ts operand loading)', () => {
  const cases: [IrType, number, boolean][] = [
    ['i16', 0, false],
    ['i16', -1, true],
    ['i16', 1, true],
    ['i16', 256, true], // only the high byte is non-zero
    ['i16', -32768, true],
    ['u8', 0, false],
    ['u8', 128, true],
    ['i32', 0, false],
    ['i32', 65536, true], // only the high word is non-zero
  ];
  for (const [type, v, truthy] of cases) {
    it(`${type} ${v}: jz ${truthy ? 'falls through' : 'jumps'}, jnz ${truthy ? 'jumps' : 'falls through'}`, () => {
      const out = run(
        program(
          (b) => {
            b.store(type, global('v'), imm(v));
            const t1 = b.newLabel();
            const t2 = b.newLabel();
            b.store('u8', global('rz'), imm(0));
            b.store('u8', global('rnz'), imm(0));
            b.jz(type, global('v'), t1);
            b.jump(t2);
            b.label(t1);
            b.store('u8', global('rz'), imm(1));
            b.label(t2);
            const t3 = b.newLabel();
            const t4 = b.newLabel();
            b.jnz(type, global('v'), t3);
            b.jump(t4);
            b.label(t3);
            b.store('u8', global('rnz'), imm(1));
            b.label(t4);
          },
          [g('v', type), g('rz', 'u8'), g('rnz', 'u8')],
        ),
      );
      expect(out.stopped).toBe('rst0');
      expect(out.byte('rz')).toBe(truthy ? 0 : 1);
      expect(out.byte('rnz')).toBe(truthy ? 1 : 0);
    });
  }
});

// ---------------------------------------------------------------------------
// GOSUB / RETURN
// ---------------------------------------------------------------------------

describe('gosub and retsub', () => {
  it('three nested levels return in order and leave SP balanced', () => {
    const out = run(
      program(
        (b) => {
          b.push(saveSp('sp0'));
          b.gosub('.L.A');
          mark(b, 'm');
          b.push(saveSp('sp1'));
          b.end();
          b.label('.L.A');
          mark(b, 'a1');
          b.gosub('.L.B');
          mark(b, 'a2');
          b.retsub();
          b.label('.L.B');
          mark(b, 'b1');
          b.gosub('.L.C');
          mark(b, 'b2');
          b.retsub();
          b.label('.L.C');
          mark(b, 'c1');
          b.retsub();
        },
        ['ctr', 'm', 'a1', 'a2', 'b1', 'b2', 'c1'].map((l) => g(l, 'i16')).concat([g('sp0', 'u16'), g('sp1', 'u16')]),
      ),
    );
    expect(out.stopped).toBe('rst0');
    expect(['a1', 'b1', 'c1', 'b2', 'a2', 'm'].map((l) => out.word(l))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(out.word('sp1')).toBe(out.word('sp0'));
  });
});

// ---------------------------------------------------------------------------
// jump tables
// ---------------------------------------------------------------------------

describe('jtable (ON ... GOTO / GOSUB, 1-based, out of range falls through)', () => {
  const GOTO_SELECTORS = [0, 1, 2, 3, 4, 255, 256, 257, 65535];
  const goto = (sel: Operand | null, selector: number, viaTemp: boolean): number => {
    const out = run(
      program(
        (b) => {
          b.store('u16', global('sel'), imm(selector));
          const labels = ['.L.1', '.L.2', '.L.3'];
          const src = viaTemp ? b.load('u16', global('sel')) : (sel ?? global('sel'));
          b.jtable(src, labels);
          b.store('i16', global('r'), imm(99));
          b.jump('.L.done');
          labels.forEach((l, i) => {
            b.label(l);
            b.store('i16', global('r'), imm(i + 1));
            b.jump('.L.done');
          });
          b.label('.L.done');
        },
        [g('sel', 'u16'), g('r', 'i16')],
      ),
    );
    expect(out.stopped).toBe('rst0');
    return out.word('r');
  };
  for (const viaTemp of [false, true]) {
    it(`ON GOTO over 3 targets, selector ${viaTemp ? 'popped from a temp' : 'read from a global'}`, () => {
      for (const sel of GOTO_SELECTORS) expect(goto(null, sel, viaTemp), `selector ${sel}`).toBe(sel >= 1 && sel <= 3 ? sel : 99);
    });
  }

  it('an immediate selector', () => {
    const one = (v: number): number => {
      const out = run(
        program(
          (b) => {
            b.jtable(imm(v), ['.L.1', '.L.2']);
            b.store('i16', global('r'), imm(99));
            b.jump('.L.done');
            b.label('.L.1');
            b.store('i16', global('r'), imm(1));
            b.jump('.L.done');
            b.label('.L.2');
            b.store('i16', global('r'), imm(2));
            b.label('.L.done');
          },
          [g('r', 'i16')],
        ),
      );
      return out.word('r');
    };
    expect([0, 1, 2, 3].map(one)).toEqual([99, 1, 2, 99]);
  });

  it('ON GOSUB returns after the table, with SP balanced, in range and out of range', () => {
    for (const sel of [0, 1, 2, 3, 4, 256, 65535]) {
      const out = run(
        program(
          (b) => {
            b.store('u16', global('sel'), imm(sel));
            b.push(saveSp('sp0'));
            b.jtable(global('sel'), ['.L.1', '.L.2', '.L.3'], true);
            b.store('i16', global('after'), imm(7));
            b.push(saveSp('sp1'));
            b.end();
            ['.L.1', '.L.2', '.L.3'].forEach((l, i) => {
              b.label(l);
              b.store('i16', global('r'), imm(i + 1));
              b.retsub();
            });
          },
          [g('sel', 'u16'), g('r', 'i16'), g('after', 'i16'), g('sp0', 'u16'), g('sp1', 'u16')],
        ),
      );
      expect(out.stopped, `selector ${sel}`).toBe('rst0');
      expect(out.word('r'), `selector ${sel}`).toBe(sel >= 1 && sel <= 3 ? sel : 0);
      expect(out.word('after'), `selector ${sel}`).toBe(7);
      expect(out.word('sp1'), `selector ${sel}`).toBe(out.word('sp0'));
    }
  });

  it('a 255-entry table: the last entry is reachable, 256 falls through', () => {
    const labels = Array.from({ length: 255 }, (_, i) => `.L.${i + 1}`);
    const one = (v: number): number => {
      const out = run(
        program(
          (b) => {
            b.jtable(imm(v), labels);
            b.store('i16', global('r'), imm(-1));
            b.jump('.L.done');
            labels.forEach((l, i) => {
              b.label(l);
              b.store('i16', global('r'), imm(i + 1));
              b.jump('.L.done');
            });
            b.label('.L.done');
          },
          [g('r', 'i16')],
        ),
      );
      return s16(out.word('r'));
    };
    expect([1, 128, 255, 256, 0].map(one)).toEqual([1, 128, 255, -1, -1]);
  });

  it('more than 255 targets is E002', () => {
    const labels = Array.from({ length: 256 }, (_, i) => `.L.${i + 1}`);
    const diagnostics = new DiagnosticBag();
    const ir: IrProgram = {
      main: [{ op: 'jtable', a: imm(1), labels, gosub: false, span: null }, ...labels.map((l): Quad => ({ op: 'label', label: l, span: null }))],
      procedures: [],
      globals: [],
      strings: [],
      data: [],
      requires: [],
      inits: [],
    };
    generateWith({ ir, target: makeTarget({}), diagnostics, templates: [FLOW_TEMPLATES] }, TEMPLATES);
    expect(diagnostics.all().map((d) => d.code)).toEqual(['E002']);
  });
});

// ---------------------------------------------------------------------------
// procedures
// ---------------------------------------------------------------------------

describe('STDCALL procedures', () => {
  it('three parameters (u8, i16, i32) returning i16, called twice: values arrive, SP and IX balanced', () => {
    // First argument nearest the frame: u8 at ix+4 (value in the high byte, ix+5), i16 at ix+6, i32 at ix+8.
    const body: Quad[] = [];
    const pb = new IrBuilder();
    pb.label('_F');
    pb.enter(2);
    pb.store('u8', global('seen8'), frame(5));
    pb.store('i32', global('seen32'), frame(8));
    const b16 = pb.load('i16', frame(6));
    pb.store('i16', frame(-2), b16);
    pb.ret('i16', frame(-2), '_F__leave');
    pb.label('_F__leave');
    pb.push({ op: 'leave', argBytes: 8, convention: 'STDCALL', span: null });
    body.push(...pb.take());
    const f = proc(
      '_F',
      'STDCALL',
      [
        { type: 'u8', offset: 5, byref: false },
        { type: 'i16', offset: 6, byref: false },
        { type: 'i32', offset: 8, byref: false },
      ],
      'i16',
      body,
    );
    const out = run(
      program(
        (b) => {
          b.push(asmQ('\tld ix, 4660'));
          b.push(saveSp('sp0'));
          b.param('i32', imm(0x12345678));
          b.param('i16', imm(-1234));
          b.param('u8', imm(200));
          const r1 = b.call('_F', 8, 'i16') as Operand;
          b.store('i16', global('r1'), r1);
          b.push(saveSp('sp1'));
          b.store('u8', global('s8a'), global('seen8'));
          b.store('i32', global('s32a'), global('seen32'));
          b.param('i32', imm(-5));
          b.param('i16', imm(30000));
          b.param('u8', imm(7));
          const r2 = b.call('_F', 8, 'i16') as Operand;
          b.store('i16', global('r2'), r2);
          b.push(saveSp('sp2'));
          b.push(asmQ('\tld (_ixafter), ix'));
        },
        [
          'seen8',
          's8a',
        ]
          .map((l) => g(l, 'u8'))
          .concat(['seen32', 's32a'].map((l) => g(l, 'i32')))
          .concat(['r1', 'r2'].map((l) => g(l, 'i16')))
          .concat(['sp0', 'sp1', 'sp2', 'ixafter'].map((l) => g(l, 'u16'))),
        [f],
      ),
    );
    expect(out.stopped).toBe('rst0');
    expect(out.byte('s8a')).toBe(200);
    expect(out.word('s32a')).toBe(0x5678);
    expect(out.word('s32a', 2)).toBe(0x1234);
    expect(s16(out.word('r1'))).toBe(-1234);
    expect(s16(out.word('r2'))).toBe(30000);
    expect(out.byte('seen8')).toBe(7);
    expect(out.word('seen32')).toBe(0xfffb);
    expect(out.word('seen32', 2)).toBe(0xffff);
    expect(out.word('sp1')).toBe(out.word('sp0'));
    expect(out.word('sp2')).toBe(out.word('sp0'));
    expect(out.word('ixafter')).toBe(4660);
  });

  // The i16 parameters get distinct powers of two so a wrong order or offset changes the result.
  for (let k = 0; k <= 8; k++) {
    it(`${k} i16 parameter(s) (${2 * k} bytes popped by leave)`, () => {
      const pb = new IrBuilder();
      pb.label('_P');
      pb.enter(0);
      let acc: Operand = imm(0);
      for (let i = 0; i < k; i++) {
        const v = pb.load('i16', frame(4 + 2 * i));
        acc = i === 0 ? v : pb.sub('i16', acc, v);
      }
      if (k === 0) pb.ret('i16', imm(12345), '_P__leave');
      else pb.ret('i16', acc, '_P__leave');
      pb.label('_P__leave');
      pb.push({ op: 'leave', argBytes: 2 * k, convention: 'STDCALL', span: null });
      const p = proc(
        '_P',
        'STDCALL',
        Array.from({ length: k }, (_, i) => ({ type: 'i16' as const, offset: 4 + 2 * i, byref: false })),
        'i16',
        pb.take(),
      );
      const out = run(
        program(
          (b) => {
            b.push(saveSp('sp0'));
            for (let i = k - 1; i >= 0; i--) b.param('i16', imm(1 << i));
            const r = b.call('_P', 2 * k, 'i16') as Operand;
            b.store('i16', global('r'), r);
            b.push(saveSp('sp1'));
          },
          [g('r', 'i16'), g('sp0', 'u16'), g('sp1', 'u16')],
          [p],
        ),
      );
      expect(out.stopped).toBe('rst0');
      const expected = k === 0 ? 12345 : 1 - ((1 << k) - 2); // p1 - (p2 + ... + pk)
      expect(s16(out.word('r'))).toBe(expected);
      expect(out.word('sp1')).toBe(out.word('sp0'));
    });
  }

  it('recursion to depth 10 (sum n + (n-1) + ... + 0 = 55) leaves SP balanced', () => {
    const pb = new IrBuilder();
    pb.label('_Sum');
    pb.enter(0);
    pb.jz('i16', frame(4), '.L.base');
    const n = pb.load('i16', frame(4));
    const n1 = pb.sub('i16', n, imm(1));
    pb.param('i16', n1);
    const rec = pb.call('_Sum', 2, 'i16') as Operand;
    const n2 = pb.load('i16', frame(4));
    const total = pb.add('i16', rec, n2);
    pb.ret('i16', total, '_Sum__leave');
    pb.label('.L.base');
    pb.ret('i16', imm(0), '_Sum__leave');
    pb.label('_Sum__leave');
    pb.push({ op: 'leave', argBytes: 2, convention: 'STDCALL', span: null });
    const sum = proc('_Sum', 'STDCALL', [{ type: 'i16', offset: 4, byref: false }], 'i16', pb.take());
    const out = run(
      program(
        (b) => {
          b.push(saveSp('sp0'));
          b.param('i16', imm(10));
          const r = b.call('_Sum', 2, 'i16') as Operand;
          b.store('i16', global('r'), r);
          b.push(saveSp('sp1'));
        },
        [g('r', 'i16'), g('sp0', 'u16'), g('sp1', 'u16')],
        [sum],
      ),
    );
    expect(out.stopped).toBe('rst0');
    expect(out.word('r')).toBe(55);
    expect(out.word('sp1')).toBe(out.word('sp0'));
  });

  it('BYREF parameters: the slot holds an address, loaded through it', () => {
    const pb = new IrBuilder();
    pb.label('_Inc');
    pb.enter(0);
    const v = pb.load('i16', frame(4, true));
    const v1 = pb.add('i16', v, imm(1));
    // store through the reference: asm, as the byref store is the integer templates' job
    pb.store('i16', global('tmp'), v1);
    pb.push(asmQ('\tld l, (ix+4)', '\tld h, (ix+5)', '\tld de, (_tmp)', '\tld (hl), e', '\tinc hl', '\tld (hl), d'));
    pb.label('_Inc__leave');
    pb.push({ op: 'leave', argBytes: 2, convention: 'STDCALL', span: null });
    const inc = proc('_Inc', 'STDCALL', [{ type: 'i16', offset: 4, byref: true }], null, pb.take());
    const out = run(
      program(
        (b) => {
          b.store('i16', global('x'), imm(41));
          b.param('u16', addr('_x'));
          b.call('_Inc', 2, null);
        },
        [g('x', 'i16'), g('tmp', 'i16')],
        [inc],
      ),
    );
    expect(out.word('x')).toBe(42);
  });

  it('locals are zeroed on every entry: 3 and 12 bytes, after the stack was dirtied', () => {
    const mk = (label: string, n: number, fill: boolean): IrProcedure => {
      const pb = new IrBuilder();
      pb.label(label);
      pb.enter(n);
      if (fill) pb.push(asmQ(...Array.from({ length: n }, (_, i) => `\tld (ix-${i + 1}), 255`)));
      else pb.push(asmQ('\txor a', ...Array.from({ length: n }, (_, i) => `\tor (ix-${i + 1})`), `\tld (_z${n}), a`));
      pb.label(`${label}__leave`);
      pb.push({ op: 'leave', argBytes: 0, convention: 'STDCALL', span: null });
      return proc(label, 'STDCALL', [], null, pb.take());
    };
    const out = run(
      program(
        (b) => {
          b.push(saveSp('sp0'));
          b.call('_Dirty12', 0, null);
          b.call('_Check12', 0, null);
          b.call('_Dirty3', 0, null);
          b.call('_Check3', 0, null);
          b.push(saveSp('sp1'));
        },
        [g('z12', 'u8'), g('z3', 'u8'), g('sp0', 'u16'), g('sp1', 'u16')],
        [mk('_Dirty12', 12, true), mk('_Check12', 12, false), mk('_Dirty3', 3, true), mk('_Check3', 3, false)],
      ),
    );
    expect(out.stopped).toBe('rst0');
    expect(out.byte('z12')).toBe(0);
    expect(out.byte('z3')).toBe(0);
    expect(out.word('sp1')).toBe(out.word('sp0'));
  });

  it('control: with the zeroing removed from enter the same check sees the dirt (the zero test is not vacuous)', () => {
    const noZero: TemplateTable = {
      enter: (q) => ['\tpush ix', '\tld ix, 0', '\tadd ix, sp', `\tld hl, -${(q as Extract<Quad, { op: 'enter' }>).localBytes}`, '\tadd hl, sp', '\tld sp, hl'],
    };
    const mk = (label: string, fill: boolean): IrProcedure => {
      const pb = new IrBuilder();
      pb.label(label);
      pb.enter(12);
      if (fill) pb.push(asmQ(...Array.from({ length: 12 }, (_, i) => `\tld (ix-${i + 1}), 255`)));
      else pb.push(asmQ('\txor a', ...Array.from({ length: 12 }, (_, i) => `\tor (ix-${i + 1})`), '\tld (_z12), a'));
      pb.label(`${label}__leave`);
      pb.push({ op: 'leave', argBytes: 0, convention: 'STDCALL', span: null });
      return proc(label, 'STDCALL', [], null, pb.take());
    };
    const out = run(
      program(
        (b) => {
          b.call('_Dirty', 0, null);
          b.call('_Check', 0, null);
        },
        [g('z12', 'u8')],
        [mk('_Dirty', true), mk('_Check', false)],
      ),
      { first: noZero },
    );
    expect(out.byte('z12')).not.toBe(0);
  });
});

describe('FASTCALL procedures', () => {
  it('a u16 function without a frame: argument in HL, result in HL', () => {
    const pb = new IrBuilder();
    pb.label('_Twice');
    pb.enter(0);
    pb.push(asmQ('\tadd hl, hl'));
    pb.label('_Twice__leave');
    pb.push({ op: 'leave', argBytes: 0, convention: 'FASTCALL', span: null });
    const p = proc('_Twice', 'FASTCALL', [{ type: 'u16', offset: 0, byref: false }], 'u16', pb.take());
    const out = run(
      program(
        (b) => {
          b.push(saveSp('sp0'));
          b.push(asmQ('\tld ix, 4660'));
          b.fparam('u16', imm(21000));
          const r = b.call('_Twice', 0, 'u16') as Operand;
          b.store('u16', global('r'), r);
          b.push(saveSp('sp1'));
          b.push(asmQ('\tld (_ixafter), ix'));
        },
        [g('r', 'u16'), g('sp0', 'u16'), g('sp1', 'u16'), g('ixafter', 'u16')],
        [p],
      ),
    );
    expect(out.stopped).toBe('rst0');
    expect(out.word('r')).toBe(42000);
    expect(out.word('sp1')).toBe(out.word('sp0'));
    expect(out.word('ixafter')).toBe(4660);
    // No frame code at all in the body.
    expect(out.asm.procedures.join('\n')).not.toContain('ix');
  });

  it('a u8 function with locals keeps the argument in A, zeroes the locals and restores IX/SP', () => {
    const dirtyB = new IrBuilder();
    dirtyB.label('_Dirty');
    dirtyB.enter(12);
    dirtyB.push(asmQ(...Array.from({ length: 12 }, (_, i) => `\tld (ix-${i + 1}), 255`)));
    dirtyB.label('_Dirty__leave');
    dirtyB.push({ op: 'leave', argBytes: 0, convention: 'STDCALL', span: null });
    const dirty = proc('_Dirty', 'STDCALL', [], null, dirtyB.take());
    for (const locals of [3, 4]) {
      const pb = new IrBuilder();
      pb.label('_Add');
      pb.enter(locals);
      // result = argument (A) | all locals; locals are zero, so the argument must come back unchanged
      pb.push(asmQ(...Array.from({ length: locals }, (_, i) => `\tor (ix-${i + 1})`)));
      pb.label('_Add__leave');
      pb.push({ op: 'leave', argBytes: 0, convention: 'FASTCALL', span: null });
      const p = proc('_Add', 'FASTCALL', [{ type: 'u8', offset: 0, byref: false }], 'u8', pb.take());
      const out = run(
        program(
          (b) => {
            b.push(saveSp('sp0'));
            b.push(asmQ('\tld ix, 4660'));
            b.call('_Dirty', 0, null);
            b.fparam('u8', imm(0x5a));
            const r = b.call('_Add', 0, 'u8') as Operand;
            b.store('u8', global('r'), r);
            b.push(saveSp('sp1'));
            b.push(asmQ('\tld (_ixafter), ix'));
          },
          [g('r', 'u8'), g('sp0', 'u16'), g('sp1', 'u16'), g('ixafter', 'u16')],
          [dirty, p],
        ),
      );
      expect(out.stopped, `${locals} locals`).toBe('rst0');
      expect(out.byte('r'), `${locals} locals`).toBe(0x5a);
      expect(out.word('sp1'), `${locals} locals`).toBe(out.word('sp0'));
      expect(out.word('ixafter'), `${locals} locals`).toBe(4660);
    }
  });
});

describe('FASTCALL register argument spilled by enter (review R6)', () => {
  for (const [type, value, locals, slot] of [
    ['u8', 0x5a, 3, -2],
    ['u16', 21000, 4, -4],
    ['i32', -123456, 6, -5],
  ] as const) {
    it(`a ${type} argument lands in its local slot [ix${slot}] and survives the body`, () => {
      const pb = new IrBuilder();
      pb.label('_Keep');
      pb.enter(locals);
      pb.push(asmQ('\tld hl, 0', '\tld de, 0', '\txor a')); // the body clobbers the registers
      pb.push({ op: 'ret', type, a: frame(slot), label: '_Keep__leave', span: null });
      pb.label('_Keep__leave');
      pb.push({ op: 'leave', argBytes: 0, convention: 'FASTCALL', span: null });
      const p = proc('_Keep', 'FASTCALL', [{ type, offset: slot, byref: false }], type, pb.take());
      const out = run(
        program(
          (b) => {
            b.push(saveSp('sp0'));
            b.fparam(type, imm(value));
            const r = b.call('_Keep', 0, type) as Operand;
            b.store(type, global('r'), r);
            b.push(saveSp('sp1'));
          },
          [g('r', type), g('sp0', 'u16'), g('sp1', 'u16')],
          [p],
        ),
        { first: INT_TEMPLATES },
      );
      expect(out.stopped).toBe('rst0');
      const got = type === 'u8' ? out.byte('r') : type === 'u16' ? out.word('r') : (out.word('r') | (out.word('r', 2) << 16)) | 0;
      expect(got).toBe(value);
      expect(out.word('sp1')).toBe(out.word('sp0'));
    });
  }
});

describe('stmt: statement boundaries (review R6)', () => {
  const body = (b: IrBuilder): void => {
    b.push({ op: 'stmt', number: 10, span: SP });
    mark(b, 'a');
    b.push({ op: 'stmt', number: 20, span: SP });
    mark(b, 'b');
  };
  const globals = (): IrGlobal[] => [g('ctr', 'i16'), g('a', 'i16'), g('b', 'i16')];

  it('emits nothing without a flag', () => {
    const out = run(program(body, globals()));
    expect(out.stopped).toBe('rst0');
    expect(out.asm.main.join('\n')).not.toContain('CHKBRK');
    expect(out.asm.requires).not.toContain('loco/keys.asm');
  });

  it('with checkBreak calls .core.__LOCO_CHKBRK with the line number in HL; no ESC: the program runs on', () => {
    const out = run(program(body, globals()), { checkBreak: true });
    expect(out.stopped).toBe('rst0');
    expect(out.word('a')).toBe(1);
    expect(out.word('b')).toBe(2);
    const text = out.asm.main.join('\n');
    expect(text).toContain('\tpush hl\n\tld hl, 10\n\tcall .core.__LOCO_CHKBRK');
    expect(text).toContain('\tld hl, 20\n\tcall .core.__LOCO_CHKBRK');
    expect(out.asm.requires).toContain('loco/keys.asm');
  });
});

// ---------------------------------------------------------------------------
// runtime calls, memory, CALL block, END
// ---------------------------------------------------------------------------

describe('rtcall', () => {
  it('links the routine file and pushes the result by type', () => {
    const out = run(
      program(
        (b) => {
          b.fparam('i16', imm(-1234));
          const r = b.rtcall('.core.__ABS16', 'i16') as Operand;
          b.store('i16', global('r'), r);
        },
        [g('r', 'i16')],
      ),
    );
    expect(out.stopped).toBe('rst0');
    expect(out.word('r')).toBe(1234);
    expect(out.asm.requires).toContain('abs16.asm');
  });
});

describe('PEEK and POKE (test-only templates) round trip through the flow plumbing', () => {
  it('bytes written with poke are read back with peek, also through a temp address', () => {
    const out = run(
      program(
        (b) => {
          b.poke('u8', imm(0x5000), imm(0xa5));
          b.poke('u8', imm(0x5001), imm(0x3c));
          const v = b.peek('u8', imm(0x5000));
          b.store('u8', global('p0'), v);
          const a = b.load('u16', imm(0x5001));
          const w = b.peek('u8', a);
          b.store('u8', global('p1'), w);
        },
        [g('p0', 'u8'), g('p1', 'u8')],
      ),
    );
    expect(out.stopped).toBe('rst0');
    expect(out.byte('p0')).toBe(0xa5);
    expect(out.byte('p1')).toBe(0x3c);
    expect(out.mem[0x5000]).toBe(0xa5);
    expect(out.mem[0x5001]).toBe(0x3c);
  });
});

describe('CALL with the Locomotive parameter block (asm quads, as the lowering builds it)', () => {
  it('A = count and IX points at the last parameter; the routine sees every 16-bit value', () => {
    // CALL routine, p1, p2, p3: the block is pushed first parameter first, so IX = SP is the last one.
    const out = run(
      program(
        (b) => {
          b.push(saveSp('sp0'));
          b.param('u16', imm(0x1111));
          b.param('u16', imm(0x2222));
          b.param('u16', imm(0x3333));
          b.push(asmQ('\tld ix, 0', '\tadd ix, sp', '\tld a, 3', '\tcall .T.mc', '\tld hl, 6', '\tadd hl, sp', '\tld sp, hl'));
          b.push(saveSp('sp1'));
          b.jump('.T.past');
          b.push(
            asmQ(
              '.T.mc:',
              '\tld (_rec_a), a',
              '\tld l, (ix+0)',
              '\tld h, (ix+1)',
              '\tld (_rec_0), hl',
              '\tld l, (ix+2)',
              '\tld h, (ix+3)',
              '\tld (_rec_1), hl',
              '\tld l, (ix+4)',
              '\tld h, (ix+5)',
              '\tld (_rec_2), hl',
              '\tret',
            ),
          );
          b.label('.T.past');
        },
        [g('rec_a', 'u8'), g('rec_0', 'u16'), g('rec_1', 'u16'), g('rec_2', 'u16'), g('sp0', 'u16'), g('sp1', 'u16')],
      ),
    );
    expect(out.stopped).toBe('rst0');
    expect(out.byte('rec_a')).toBe(3);
    expect([out.word('rec_0'), out.word('rec_1'), out.word('rec_2')]).toEqual([0x3333, 0x2222, 0x1111]);
    expect(out.word('sp1')).toBe(out.word('sp0'));
  });
});

describe('end', () => {
  it('reaches RST 0 through __CPC_END', () => {
    const out = run(program((b) => b.store('u8', global('r'), imm(1)), [g('r', 'u8')]));
    expect(out.stopped).toBe('rst0');
    expect(out.byte('r')).toBe(1);
  });

  it('two end quads produce one END block; the second jumps to it, and code after an early END is skipped', () => {
    const b = new IrBuilder();
    b.store('u8', global('r'), imm(1));
    b.jz('i16', global('stop'), '.L.go');
    b.end(imm(7));
    b.label('.L.go');
    b.store('u8', global('r'), imm(2));
    b.end();
    const out = run({ main: b.take(), globals: [g('r', 'u8'), g('stop', 'i16')] });
    const text = out.asm.main.join('\n');
    expect(text.match(/\.core\.__END_PROGRAM:/g)).toHaveLength(1);
    expect(text.match(/jp \.core\.__CPC_END/g)).toHaveLength(1);
    expect(text).toContain('jp .core.__END_PROGRAM');
    expect(out.stopped).toBe('rst0');
    expect(out.byte('r')).toBe(2);
  });

  it('an early END (taken) skips the rest', () => {
    const b = new IrBuilder();
    b.store('u8', global('r'), imm(1));
    b.store('i16', global('go'), imm(-1));
    b.jz('i16', global('go'), '.L.later');
    b.end(imm(0));
    b.label('.L.later');
    b.store('u8', global('r'), imm(2));
    b.end();
    const out = run({ main: b.take(), globals: [g('r', 'u8'), g('go', 'i16')] });
    expect(out.stopped).toBe('rst0');
    expect(out.byte('r')).toBe(1);
  });
});

describe('plain templates', () => {
  it('label, jump, gosub, retsub, asm text', () => {
    const ctxless = (q: Quad): readonly string[] => (FLOW_TEMPLATES[q.op] as Template)(q, undefined as never);
    expect(ctxless({ op: 'label', label: '.L.10', span: null })).toEqual(['.L.10:']);
    expect(ctxless({ op: 'jump', label: '.L.10', span: null })).toEqual(['\tjp .L.10']);
    expect(ctxless({ op: 'gosub', label: '.L.10', span: null })).toEqual(['\tcall .L.10']);
    expect(ctxless({ op: 'retsub', span: null })).toEqual(['\tret']);
    expect(ctxless(asmQ('\tnop', '\thalt'))).toEqual(['\tnop', '\thalt']);
  });
});

// ---------------------------------------------------------------------------
// test-only integer templates
// ---------------------------------------------------------------------------

const lines = (...xs: (readonly string[])[]): string[] => xs.flat();

const TEST_TEMPLATES: TemplateTable = {
  'load:u8': (q, c) => lines(loadReg('u8', (q as Extract<Quad, { op: 'load' }>).a, q, c), ['\tpush af']),
  'load:i16': (q, c) => lines(loadReg('i16', (q as Extract<Quad, { op: 'load' }>).a, q, c), ['\tpush hl']),
  'load:u16': (q, c) => lines(loadReg('u16', (q as Extract<Quad, { op: 'load' }>).a, q, c), ['\tpush hl']),
  'load:i32': (q, c) => lines(loadReg('i32', (q as Extract<Quad, { op: 'load' }>).a, q, c), ['\tpush de', '\tpush hl']),
  ...Object.fromEntries(
    (['u8', 'i8', 'u16', 'i16', 'u32', 'i32'] as const).map((t): [string, Template] => [
      `store:${t}`,
      (q, c) => {
        const s = q as Extract<Quad, { op: 'store' }>;
        const get = loadReg(t, s.a, q, c);
        if (s.dst.k === 'global') {
          const L = s.dst.label;
          switch (memSize(t)) {
            case 1:
              return lines(get, [`\tld (${L}), a`]);
            case 2:
              return lines(get, [`\tld (${L}), hl`]);
            default:
              return lines(get, [`\tld (${L}), hl`, `\tld (${L}+2), de`]);
          }
        }
        if (s.dst.k === 'frame') {
          const o = s.dst.offset;
          const d = (n: number): string => `(ix${n < 0 ? '-' : '+'}${Math.abs(n)})`;
          switch (memSize(t)) {
            case 1:
              return lines(get, [`\tld ${d(o)}, a`]);
            case 2:
              return lines(get, [`\tld ${d(o)}, l`, `\tld ${d(o + 1)}, h`]);
            default:
              return lines(get, [`\tld ${d(o)}, l`, `\tld ${d(o + 1)}, h`, `\tld ${d(o + 2)}, e`, `\tld ${d(o + 3)}, d`]);
          }
        }
        throw new Error('test store: global or frame only');
      },
    ]),
  ),
  // pops b then a (b was pushed last)
  'add:i16': (q, c) => {
    const o = q as Extract<Quad, { b: Operand; dst: Operand; type: IrType }>;
    return lines(loadReg('i16', o.b, q, c), ['\tex de, hl'], loadReg('i16', o.a, q, c), ['\tadd hl, de', '\tpush hl']);
  },
  'sub:i16': (q, c) => {
    const o = q as Extract<Quad, { b: Operand; dst: Operand; type: IrType }>;
    return lines(loadReg('i16', o.b, q, c), ['\tex de, hl'], loadReg('i16', o.a, q, c), ['\tor a', '\tsbc hl, de', '\tpush hl']);
  },
  'jz:i16': (q, c) => {
    const o = q as Extract<Quad, { op: 'jz' | 'jnz' }>;
    return lines(loadReg('i16', o.a, q, c), ['\tld a, h', '\tor l', `\tjp z, ${o.label}`]);
  },
  'jnz:i16': (q, c) => {
    const o = q as Extract<Quad, { op: 'jz' | 'jnz' }>;
    return lines(loadReg('i16', o.a, q, c), ['\tld a, h', '\tor l', `\tjp nz, ${o.label}`]);
  },
  'jz:u8': (q, c) => {
    const o = q as Extract<Quad, { op: 'jz' | 'jnz' }>;
    return lines(loadReg('u8', o.a, q, c), ['\tor a', `\tjp z, ${o.label}`]);
  },
  'jnz:u8': (q, c) => {
    const o = q as Extract<Quad, { op: 'jz' | 'jnz' }>;
    return lines(loadReg('u8', o.a, q, c), ['\tor a', `\tjp nz, ${o.label}`]);
  },
  'jz:i32': (q, c) => {
    const o = q as Extract<Quad, { op: 'jz' | 'jnz' }>;
    return lines(loadReg('i32', o.a, q, c), ['\tld a, h', '\tor l', '\tor d', '\tor e', `\tjp z, ${o.label}`]);
  },
  'jnz:i32': (q, c) => {
    const o = q as Extract<Quad, { op: 'jz' | 'jnz' }>;
    return lines(loadReg('i32', o.a, q, c), ['\tld a, h', '\tor l', '\tor d', '\tor e', `\tjp nz, ${o.label}`]);
  },
  'param:u8': (q, c) => lines(loadReg('u8', (q as Extract<Quad, { op: 'param' }>).a, q, c), ['\tpush af']),
  'param:i16': (q, c) => lines(loadReg('i16', (q as Extract<Quad, { op: 'param' }>).a, q, c), ['\tpush hl']),
  'param:u16': (q, c) => lines(loadReg('u16', (q as Extract<Quad, { op: 'param' }>).a, q, c), ['\tpush hl']),
  'param:i32': (q, c) => lines(loadReg('i32', (q as Extract<Quad, { op: 'param' }>).a, q, c), ['\tpush de', '\tpush hl']),
  'fparam:u8': (q, c) => loadReg('u8', (q as Extract<Quad, { op: 'fparam' }>).a, q, c),
  'fparam:u16': (q, c) => loadReg('u16', (q as Extract<Quad, { op: 'fparam' }>).a, q, c),
  'fparam:i16': (q, c) => loadReg('i16', (q as Extract<Quad, { op: 'fparam' }>).a, q, c),
  'peek:u8': (q, c) => lines(loadReg('u16', (q as Extract<Quad, { op: 'peek' }>).a, q, c), ['\tld a, (hl)', '\tpush af']),
  'poke:u8': (q, c) => {
    const o = q as Extract<Quad, { op: 'poke' }>;
    return lines(loadReg('u8', o.b, q, c), ['\tld c, a'], loadReg('u16', o.a, q, c), ['\tld (hl), c']);
  },
};
