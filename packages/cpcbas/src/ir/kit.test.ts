import { describe, expect, it } from 'vitest';
import { asFileId, type Span } from '../core/source.js';
import { IrBuilder, addr, frame, frameaddr, global, imm, strconst } from './builder.js';
import type { IrProgram, IrProcedure, Operand, Quad } from './ir.js';
import { printIr } from './print.js';
import { verifyIr } from './verify.js';

const SP: Span = { file: asFileId(0), start: 0, end: 1 };

/** A program that uses every quad kind once. */
function everyKind(): IrProgram {
  const b = new IrBuilder();
  const loop = b.newLabel();
  const skip = b.newLabel();
  const sub = b.newLabel();
  const done = b.newLabel();
  b.stmt(10, SP);
  b.stmt(null, SP);
  b.comment('every quad kind');
  b.store('i16', global('_score'), b.load('i16', imm(5)));
  const x = b.load('i16', global('_score'));
  const y = b.load('i16', frame(-2));
  b.store('i16', global('_score'), b.add('i16', x, y));
  b.store('i16', global('_score'), b.sub('i16', b.load('i16', imm(7)), imm(2)));
  b.store('i16', global('_score'), b.mul('i16', imm(3), b.div('i16', imm(9), b.mod('i16', imm(9), imm(4)))));
  b.store('f', global('_r'), b.pow(b.load('f', imm(1.5)), b.load('f', imm(2))));
  b.store('i16', global('_score'), b.and('i16', b.load('i16', imm(1)), b.or('i16', imm(2), b.xor('i16', imm(3), imm(4)))));
  b.store('u16', global('_u'), b.shl('u16', b.load('u16', imm(1)), b.load('u8', imm(3))));
  b.store('u16', global('_u'), b.shr('u16', b.load('u16', imm(8)), b.load('u8', imm(1))));
  b.store('str', global('_s__s'), b.concat(b.load('str', strconst(0)), b.load('str', global('_s__s'))));
  b.store('i16', global('_score'), b.compare('eq', 'i16', b.load('i16', imm(1)), b.compare('ne', 'i16', imm(1), imm(2))));
  b.store('i16', global('_score'), b.compare('lt', 'i16', b.load('i16', imm(1)), b.compare('le', 'i16', imm(1), imm(2))));
  b.store('i16', global('_score'), b.compare('gt', 'i16', b.load('i16', imm(1)), b.compare('ge', 'i16', imm(1), imm(2))));
  b.store('i16', global('_score'), b.neg('i16', b.not('i16', b.abs('i16', imm(-3)))));
  b.store('i16', global('_score'), b.cast('i16', 'u8', b.load('u8', imm(200))));
  b.store('u8', global('_b'), b.peek('u8', imm(0x8000)));
  b.poke('u8', imm(0x8000), b.load('u8', imm(1)));
  b.store('u8', global('_b'), b.in(imm(0xbc00)));
  b.out(imm(0xbc00), b.load('u8', imm(2)));
  b.load('u16', imm(1)); // index
  const el = b.aaddr('i16', addr('_a__a'), 1);
  b.store('i16', global('_score'), b.aload('i16', el));
  b.load('u16', imm(2)); // index
  const el2 = b.aaddr('i16', frame(-6), 1);
  b.astore('i16', el2, imm(9));
  b.label(loop);
  b.jz('i16', global('_score'), skip);
  b.jnz('i16', global('_score'), loop);
  b.jump(skip);
  b.label(skip);
  b.jtable(imm(1), [loop, skip]);
  b.jtable(imm(1), [sub], true);
  b.gosub(sub);
  b.param('i16', imm(1));
  b.param('u8', global('_b'));
  b.call('_Add', 4);
  b.store('i16', global('_score'), b.call('_Twice', 2, 'i16') ?? imm(0));
  b.fparam('str', strconst(0));
  b.rtcall('.core.__PRINTSTR');
  b.store('i16', global('_score'), b.rtcall('.core.__RND', 'i16') ?? imm(0));
  b.store('i16', frame(4, true), frameaddr(-2));
  b.asm([{ text: 'ld a, 1', span: SP }, { text: 'nop', span: SP }]);
  b.jump(done);
  b.label(sub);
  b.retsub();
  b.label(done);
  b.end();
  const proc = new IrBuilder();
  proc.label('_Twice');
  proc.enter(2);
  proc.store('i16', frame(-2), proc.load('i16', frame(4)));
  proc.ret('i16', frame(-2), '_Twice__leave');
  proc.label('_Twice__leave');
  proc.leave(2);
  const p: IrProcedure = {
    label: '_Twice',
    convention: 'STDCALL',
    params: [{ type: 'i16', offset: 4, byref: false }, { type: 'u8', offset: 6, byref: true }],
    ret: 'i16',
    body: proc.take(),
  };
  const add = new IrBuilder();
  add.label('_Add');
  add.enter(0);
  add.label('_Add__leave');
  add.leave(4, 'FASTCALL');
  return {
    main: b.take(),
    procedures: [p, { label: '_Add', convention: 'FASTCALL', params: [], ret: null, body: add.take() }],
    globals: [
      { label: '_score', type: 'i16', size: 2, init: null, at: null, dims: [] },
      { label: '_a__a', type: 'i16', size: 12, init: new Uint8Array([1, 0, 255]), at: null, dims: [5] },
      { label: '_scr', type: 'u8', size: 0, init: null, at: 49152, dims: [] },
    ],
    strings: [{ id: 0, label: '.S.0', bytes: new Uint8Array([72, 105, 34, 92, 10]) }],
    data: [
      { label: '.D.100', type: 'i16', value: -5 },
      { label: null, type: 'str', value: new Uint8Array([65]) },
    ],
    requires: ['print.asm'],
    inits: ['.core.__MY_INIT'],
  };
}

/** Run `verifyIr` on a main list that ends with `end`. */
const verifyMain = (build: (b: IrBuilder) => void, strings: IrProgram['strings'] = []): readonly string[] => {
  const b = new IrBuilder();
  build(b);
  b.end();
  return verifyIr({ main: b.take(), procedures: [], globals: [], strings, data: [], requires: [], inits: [] });
};

describe('builder', () => {
  it('numbers temps and labels, fills span null', () => {
    const b = new IrBuilder();
    expect(b.temp()).toEqual({ k: 'temp', id: 0 });
    expect(b.newLabel()).toBe('.T.0');
    expect(b.newLabel()).toBe('.T.1');
    const t = b.load('i16', imm(1));
    expect(t).toEqual({ k: 'temp', id: 1 });
    b.stmt(1, SP);
    const q = b.quads[0] as Quad;
    expect(q.span).toBeNull();
    expect(b.take()).toHaveLength(2);
    expect(b.quads).toHaveLength(0);
  });
});

describe('printIr', () => {
  it('prints a program using every quad kind', () => {
    expect(printIr(everyKind())).toMatchSnapshot();
  });
  it('is deterministic', () => {
    expect(printIr(everyKind())).toBe(printIr(everyKind()));
  });
  it('prints an empty program', () => {
    expect(printIr({ main: [], procedures: [], globals: [], strings: [], data: [], requires: [], inits: [] })).toBe('main\n');
  });
});

describe('verifyIr', () => {
  it('accepts the every-kind program', () => {
    expect(verifyIr(everyKind())).toEqual([]);
  });

  it('rejects a temp used before it is defined', () => {
    const p = verifyMain((b) => b.store('i16', global('_x'), { k: 'temp', id: 9 }));
    expect(p).toEqual(['main[0]: store uses t9 before it is defined']);
  });
  it('rejects a temp used twice', () => {
    const p = verifyMain((b) => {
      const t = b.load('i16', imm(1));
      b.store('i16', global('_x'), t);
      b.store('i16', global('_x'), t);
    });
    expect(p).toEqual(['main[2]: store uses t0 a second time']);
  });
  it('rejects a temp defined twice', () => {
    const p = verifyMain((b) => {
      b.push({ op: 'load', type: 'i16', dst: { k: 'temp', id: 0 }, a: imm(1), span: null });
      b.push({ op: 'load', type: 'i16', dst: { k: 'temp', id: 0 }, a: imm(2), span: null });
    });
    expect(p.some((m) => m.startsWith('main[1]: load defines t0 a second time'))).toBe(true);
  });
  it('rejects a temp used out of LIFO order', () => {
    const p = verifyMain((b) => {
      const t0 = b.load('i16', imm(1));
      const t1 = b.load('i16', imm(2));
      b.store('i16', global('_x'), t0);
      b.store('i16', global('_x'), t1);
    });
    expect(p[0]).toBe('main[2]: store uses t0 out of LIFO order (top of stack is t1)');
  });
  it('rejects a temp that is never used (live at the end)', () => {
    const p = verifyMain((b) => b.load('i16', imm(1)));
    expect(p).toContain('main[1]: end: temps live here: t0');
  });
  it('rejects a temp live at the end of a procedure list', () => {
    const b = new IrBuilder();
    b.label('_P');
    b.enter(0);
    b.load('i16', imm(1));
    b.label('_P__leave');
    b.leave(0);
    const e = new IrBuilder();
    e.end();
    const p = verifyIr({ main: e.take(), procedures: [{ label: '_P', convention: 'STDCALL', params: [], ret: null, body: b.take() }], globals: [], strings: [], data: [], requires: [], inits: [] });
    expect(p).toEqual(['proc _P[3]: label: temps live here: t0']);
  });
  it('rejects a temp live at the end of the list', () => {
    const b = new IrBuilder();
    b.end();
    b.load('i16', imm(1));
    const p = verifyIr({ main: b.take(), procedures: [], globals: [], strings: [], data: [], requires: [], inits: [] });
    expect(p).toContain('main[2]: temps live at the end: t0');
  });
  for (const [name, build] of [
    ['label', (b: IrBuilder) => b.label('.T.1')],
    ['jump', (b: IrBuilder) => b.jump('.T.0')],
    ['jz', (b: IrBuilder) => b.jz('i16', imm(0), '.T.0')],
    ['stmt', (b: IrBuilder) => b.stmt(1, SP)],
  ] as const) {
    it(`rejects a temp live at ${name}`, () => {
      const p = verifyMain((b) => {
        b.label('.T.0');
        b.load('i16', imm(1));
        build(b);
        b.store('i16', global('_x'), { k: 'temp', id: 0 });
      });
      expect(p.some((m) => /temps live here: t0/.test(m) && m.includes(`${name}:`))).toBe(true);
    });
  }
  it('allows a temp live across a call (a + f(3)), and the call result above it', () => {
    const p = verifyMain((b) => {
      const t0 = b.load('i16', global('_a'));
      b.param('i16', imm(3));
      const t1 = b.call('_P', 2, 'i16') as Operand;
      b.store('i16', global('_x'), b.add('i16', t0, t1));
    });
    expect(p).toEqual([]);
  });
  it('allows temps consumed by a call\'s own params', () => {
    const p = verifyMain((b) => {
      b.param('i16', b.load('i16', imm(1)));
      b.param('i16', b.add('i16', imm(1), imm(2)));
      b.call('_P', 4);
    });
    expect(p).toEqual([]);
  });
  it('rejects an undefined jump target', () => {
    expect(verifyMain((b) => b.jump('.T.5'))).toEqual(['main[0]: jump target .T.5 is not defined in this list']);
    expect(verifyMain((b) => b.jtable(imm(1), ['.T.5']))).toEqual(['main[0]: jtable target .T.5 is not defined in this list']);
  });
  it('rejects a jump into another list', () => {
    const e = new IrBuilder();
    e.jump('_P__leave');
    e.end();
    const b = new IrBuilder();
    b.label('_P');
    b.enter(0);
    b.label('_P__leave');
    b.leave(0);
    const p = verifyIr({ main: e.take(), procedures: [{ label: '_P', convention: 'STDCALL', params: [], ret: null, body: b.take() }], globals: [], strings: [], data: [], requires: [], inits: [] });
    expect(p).toEqual(['main[0]: jump target _P__leave is not defined in this list']);
  });
  it('rejects a duplicate label program-wide', () => {
    const e = new IrBuilder();
    e.label('_P__leave');
    e.end();
    const b = new IrBuilder();
    b.label('_P');
    b.enter(0);
    b.label('_P__leave');
    b.leave(0);
    const p = verifyIr({ main: e.take(), procedures: [{ label: '_P', convention: 'STDCALL', params: [], ret: null, body: b.take() }], globals: [], strings: [], data: [], requires: [], inits: [] });
    expect(p).toEqual(['proc _P[2]: label _P__leave is already defined in main[0]']);
  });
  it('rejects an fparam not followed by call or rtcall', () => {
    const p = verifyMain((b) => {
      b.fparam('i16', imm(1));
      b.comment('x');
      b.rtcall('.core.__X');
    });
    expect(p).toEqual(['main[0]: fparam is not immediately followed by call or rtcall']);
  });
  it('rejects a main that does not end with end', () => {
    const b = new IrBuilder();
    b.comment('x');
    expect(verifyIr({ main: b.take(), procedures: [], globals: [], strings: [], data: [], requires: [], inits: [] })).toEqual(['main[0]: main does not end with end']);
  });
  it('rejects a procedure that does not start with its label and enter', () => {
    const b = new IrBuilder();
    b.enter(0);
    b.label('_P__leave');
    b.leave(0);
    const e = new IrBuilder();
    e.end();
    const p = verifyIr({ main: e.take(), procedures: [{ label: '_P', convention: 'STDCALL', params: [], ret: null, body: b.take() }], globals: [], strings: [], data: [], requires: [], inits: [] });
    expect(p).toEqual(['proc _P[0]: procedure does not start with its label', 'proc _P[1]: procedure label is not followed by enter']);
  });
  it('rejects a procedure that does not end with leave', () => {
    const b = new IrBuilder();
    b.label('_P');
    b.enter(0);
    const e = new IrBuilder();
    e.end();
    const p = verifyIr({ main: e.take(), procedures: [{ label: '_P', convention: 'STDCALL', params: [], ret: null, body: b.take() }], globals: [], strings: [], data: [], requires: [], inits: [] });
    expect(p).toEqual(['proc _P[1]: procedure does not end with leave']);
  });
  it('rejects an undefined string constant', () => {
    expect(verifyMain((b) => b.store('str', global('_s__s'), b.load('str', strconst(3))))).toEqual(['main[0]: load uses undefined string constant s3']);
    expect(verifyMain((b) => b.store('str', global('_s__s'), b.load('str', strconst(3))), [{ id: 3, label: '.S.3', bytes: new Uint8Array() }])).toEqual([]);
  });
});
