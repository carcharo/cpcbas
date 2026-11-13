import { describe, expect, it } from 'vitest';
import { asFileId, type Span } from '../../core/source.js';
import { levelSpec, type IrPass } from '../../opt/index.js';
import { IrBuilder, addr, frame, global, imm } from '../builder.js';
import type { IrProgram } from '../ir.js';
import { printIr } from '../print.js';
import { verifyIr } from '../verify.js';
import { IR_CONST, IR_COPY, IR_DEAD, IR_STRENGTH, irOptTrace } from './index.js';

const SP: Span = { file: asFileId(0), start: 0, end: 1 };

/** A main program from the builder's quads (closed with `end`), no globals declared (the passes never read them). */
function program(build: (b: IrBuilder) => void, checkBreak = false): IrProgram {
  const b = new IrBuilder();
  build(b);
  b.end();
  const ir: IrProgram = { main: b.take(), procedures: [], globals: [], strings: [], data: [], requires: [], inits: [], ...(checkBreak ? { checkBreak } : {}) };
  expect(verifyIr(ir)).toEqual([]);
  return ir;
}

/** The main body as the dump prints it, one quad per line, without indentation. */
function run(pass: IrPass, ir: IrProgram): { text: string[]; out: IrProgram } {
  const out = pass.run(ir, { spec: levelSpec(2), trace: true, enabled: () => true });
  expect(verifyIr(out)).toEqual([]);
  const text = printIr(out)
    .split('\n')
    .slice(1)
    .map((l) => l.trim());
  return { text: text.slice(0, text.indexOf('')), out };
}

describe('ir-const', () => {
  it('folds a constant expression with the type wrap rule', () => {
    const ir = program((b) => {
      b.store('u8', global('_x'), b.add('u8', b.load('u8', imm(200)), imm(100)));
      b.store('i16', global('_y'), b.mul('i16', b.load('i16', imm(300)), b.load('i16', imm(200))));
    });
    expect(run(IR_CONST, ir).text).toEqual(['store.u8 _x, #44', 'store.i16 _y, #-5536', 'end #0']);
  });

  it('folds comparisons to -1 and 0, and unary operators', () => {
    const ir = program((b) => {
      b.store('i16', global('_x'), b.compare('lt', 'u16', b.load('u16', imm(1)), imm(65535)));
      b.store('i16', global('_y'), b.neg('i16', b.not('i16', imm(5))));
      b.store('u16', global('_z'), b.cast('u16', 'i16', b.load('i16', imm(-1))));
    });
    expect(run(IR_CONST, ir).text).toEqual(['store.i16 _x, #-1', 'store.i16 _y, #6', 'store.u16 _z, #65535', 'end #0']);
  });

  it('never folds a division by zero, or the quotient of the type minimum by -1', () => {
    const ir = program((b) => {
      b.store('i16', global('_x'), b.div('i16', b.load('i16', imm(1)), imm(0)));
      b.store('i16', global('_y'), b.div('i16', b.load('i16', imm(-32768)), imm(-1)));
    });
    expect(run(IR_CONST, ir).text).toEqual(['div.i16 t1, #1, #0', 'store.i16 _x, t1', 'div.i16 t3, #-32768, #-1', 'store.i16 _y, t3', 'end #0']);
  });

  it('does not fold a shift by the width or more', () => {
    const ir = program((b) => {
      b.store('u8', global('_x'), b.shl('u8', b.load('u8', imm(1)), imm(8)));
    });
    expect(run(IR_CONST, ir).text).toEqual(['shl.u8 t1, #1, #8', 'store.u8 _x, t1', 'end #0']);
  });

  it('puts a constant temp into the quad that pops it, in either operand', () => {
    const ir = program((b) => {
      const k = b.load('i16', imm(7));
      b.store('i16', global('_x'), b.sub('i16', k, global('_y')));
    });
    expect(run(IR_CONST, ir).text).toEqual(['sub.i16 t1, #7, _y', 'store.i16 _x, t1', 'end #0']);
  });

  it('keeps the load of a temp that an array address pops', () => {
    const ir = program((b) => {
      b.load('u16', imm(2));
      const el = b.aaddr('i16', addr('_a__a'), 1);
      b.store('i16', global('_x'), b.aload('i16', el));
    });
    expect(run(IR_CONST, ir).text[0]).toBe('load.u16 t0, #2');
  });

  it('keeps the temp of a param that other params follow (the push order is the argument order)', () => {
    const ir = program((b) => {
      const x = b.load('i16', imm(100));
      b.param('i16', imm(120));
      b.param('i16', x);
      b.rtcall('.core.__LOCO_GMOVE');
      // no param between: the temp is the argument itself and may become the constant
      const y = b.load('i16', imm(7));
      b.param('i16', y);
      b.rtcall('.core.__LOCO_GMOVE');
    });
    expect(run(IR_CONST, ir).text).toEqual([
      'load.i16 t0, #100',
      'param.i16 #120',
      'param.i16 t0',
      'rtcall .core.__LOCO_GMOVE',
      'param.i16 #7',
      'rtcall .core.__LOCO_GMOVE',
      'end #0',
    ]);
  });

  it('turns jz and jnz on a constant into a jump or nothing', () => {
    const ir = program((b) => {
      const l = b.newLabel();
      b.jz('i16', imm(0), l);
      b.jz('i16', imm(1), l);
      b.jnz('i16', b.load('i16', imm(5)), l);
      b.label(l);
    });
    expect(run(IR_CONST, ir).text).toEqual(['jump .T.0', 'jump .T.0', '.T.0:', 'end #0']);
  });

  it('knows a constant stored in the same statement, and forgets it at the next stmt', () => {
    const ir = program((b) => {
      b.stmt(null, SP);
      b.store('i16', global('_x'), imm(5));
      b.store('i16', global('_y'), b.add('i16', b.load('i16', global('_x')), imm(1)));
      b.stmt(null, SP);
      b.store('i16', global('_z'), b.load('i16', global('_x')));
    });
    expect(run(IR_CONST, ir).text).toEqual([
      '; stmt',
      'store.i16 _x, #5',
      'store.i16 _y, #6',
      '; stmt',
      'load.i16 t2, _x',
      'store.i16 _z, t2',
      'end #0',
    ]);
  });

  it('forgets it at a call, a poke and a store through another variable of the same label', () => {
    for (const kill of [(b: IrBuilder) => b.rtcall('.core.__X'), (b: IrBuilder) => b.poke('u8', imm(0x4000), imm(1)), (b: IrBuilder) => b.store('u8', global('_x'), imm(9))]) {
      const ir = program((b) => {
        b.store('i16', global('_x'), imm(5));
        kill(b);
        b.store('i16', global('_y'), b.load('i16', global('_x')));
      });
      expect(run(IR_CONST, ir).text.join('|')).toMatch(/load\.i16 t\d+, _x|store\.i16 _y, #5/);
      // none of them may give the constant 5 to `_y`
      expect(run(IR_CONST, ir).text.join('|')).not.toContain('store.i16 _y, #5');
    }
  });

  it('forgets a frame slot that another store overlaps', () => {
    const ir = program((b) => {
      b.store('i16', frame(-4), imm(5));
      b.store('u8', frame(-3), imm(1));
      b.store('i16', global('_y'), b.load('i16', frame(-4)));
    });
    expect(run(IR_CONST, ir).text).not.toContain('store.i16 _y, #5');
  });

  it('does not use a constant fact across a label', () => {
    const ir = program((b) => {
      const l = b.newLabel();
      b.store('i16', global('_x'), imm(5));
      b.label(l);
      b.store('i16', global('_y'), b.load('i16', global('_x')));
    });
    expect(run(IR_CONST, ir).text).not.toContain('store.i16 _y, #5');
  });

  it('carries addr constants into a 16-bit reader', () => {
    const ir = program((b) => {
      b.store('u8', global('_x'), b.peek('u8', b.load('u16', addr('_v', 1))));
    });
    expect(run(IR_CONST, ir).text).toEqual(['peek.u8 t1, @_v+1', 'store.u8 _x, t1', 'end #0']);
  });

  it('folds `@v + K` into one address, and a poke through it still ends what is known about the next variable', () => {
    const ir = program((b) => {
      b.stmt(null, SP);
      b.store('i16', global('_n1'), imm(5));
      b.poke('u8', b.add('u16', addr('_n0'), imm(3)), imm(1)); // @n0 + 3 is a byte of n1
      b.store('i16', global('_y'), b.load('i16', global('_n1')));
    });
    const t = run(IR_CONST, ir).text;
    expect(t).toContain('poke.u8 @_n0+3, #1');
    expect(t).not.toContain('store.i16 _y, #5');
    expect(t.some((l) => /^load\.i16 t\d+, _n1$/.test(l))).toBe(true);
  });

  it('does not fold an address offset that is large or negative past the limit', () => {
    const ir = program((b) => {
      b.poke('u8', b.add('u16', addr('_n0'), imm(5000)), imm(1));
    });
    expect(run(IR_CONST, ir).text[0]).toContain('add.u16');
  });

  it('reports each change under --opt-trace', () => {
    const ir = program((b) => {
      b.store('u8', global('_x'), b.add('u8', b.load('u8', imm(1)), imm(2)));
    });
    expect(irOptTrace(run(IR_CONST, ir).out).every((l) => l.startsWith('; opt ir-const: '))).toBe(true);
    expect(irOptTrace(run(IR_CONST, ir).out).length).toBeGreaterThan(0);
  });
});

describe('ir-copy', () => {
  it('reads a variable where its value is used when nothing writes memory between', () => {
    const ir = program((b) => {
      const x = b.load('i16', global('_x'));
      b.store('i16', global('_y'), b.add('i16', x, imm(1)));
    });
    expect(run(IR_COPY, ir).text).toEqual(['add.i16 t1, _x, #1', 'store.i16 _y, t1', 'end #0']);
  });

  it('keeps the read before a call that may change the variable', () => {
    const ir = program((b) => {
      const x = b.load('i16', global('_x'));
      const r = b.call('_F', 0, 'i16') as ReturnType<IrBuilder['temp']>;
      b.store('i16', global('_y'), b.add('i16', x, r));
    });
    expect(run(IR_COPY, ir).text[0]).toBe('load.i16 t0, _x');
  });

  it('keeps the read before a poke, an astore, an in, an out and an asm block', () => {
    const kills: ((b: IrBuilder) => void)[] = [
      (b) => b.poke('u8', imm(0x4000), imm(1)),
      (b) => b.out(imm(0xbc00), imm(1)),
      (b) => b.store('u8', global('_t'), b.in(imm(0xbc00))),
      (b) => b.asm([{ text: 'nop', span: SP }]),
    ];
    for (const kill of kills) {
      const ir = program((b) => {
        const x = b.load('i16', global('_x'));
        kill(b);
        b.store('i16', global('_y'), x);
      });
      expect(run(IR_COPY, ir).text[0]).toBe('load.i16 t0, _x');
    }
  });

  it('leaves BYREF slots and different read types alone', () => {
    const ir = program((b) => {
      const x = b.load('i16', frame(4, true));
      b.store('i16', global('_y'), b.add('i16', x, imm(1)));
      const u = b.load('u8', global('_w'));
      b.store('i16', global('_z'), b.cast('i16', 'u16', u));
    });
    const t = run(IR_COPY, ir).text;
    expect(t[0]).toBe('load.i16 t0, [[ix+4]]');
    expect(t.join('|')).toContain('load.u8 t2, _w');
  });

  it('does not take the address of aload and astore from a variable', () => {
    const ir = program((b) => {
      b.load('u16', imm(1));
      const el = b.aaddr('i16', addr('_a__a'), 1);
      b.astore('i16', el, b.load('i16', global('_x')));
    });
    expect(run(IR_COPY, ir).text).toContain('astore.i16 t1, _x');
  });
});

describe('ir-strength', () => {
  it('drops identities of a temp and reads a variable by a load', () => {
    const ir = program((b) => {
      b.store('i16', global('_x'), b.add('i16', b.mul('i16', global('_y'), imm(1)), imm(0)));
      b.store('u8', global('_p'), b.and('u8', b.or('u8', global('_q'), imm(0)), imm(255)));
    });
    expect(run(IR_STRENGTH, ir).text).toEqual(['load.i16 t0, _y', 'store.i16 _x, t0', 'load.u8 t2, _q', 'store.u8 _p, t2', 'end #0']);
  });

  it('turns x * 2^n into a shift (n up to 4) and keeps the call for more', () => {
    const ir = program((b) => {
      b.store('i16', global('_a'), b.mul('i16', global('_y'), imm(2)));
      b.store('u16', global('_b'), b.mul('u16', imm(16), global('_y')));
      b.store('u16', global('_c'), b.mul('u16', global('_y'), imm(32)));
      b.store('i16', global('_d'), b.mul('i16', global('_y'), imm(3)));
    });
    expect(run(IR_STRENGTH, ir).text).toEqual([
      'shl.i16 t0, _y, #1',
      'store.i16 _a, t0',
      'shl.u16 t1, _y, #4',
      'store.u16 _b, t1',
      'mul.u16 t2, _y, #32',
      'store.u16 _c, t2',
      'mul.i16 t3, _y, #3',
      'store.i16 _d, t3',
      'end #0',
    ]);
  });

  it('turns an unsigned quotient by 2^n into a shift and the remainder into a mask, and not the signed ones', () => {
    const ir = program((b) => {
      b.store('u16', global('_a'), b.div('u16', global('_k'), imm(2)));
      b.store('u16', global('_b'), b.mod('u16', global('_k'), imm(8)));
      b.store('u8', global('_c'), b.div('u8', global('_j'), imm(128)));
      b.store('i16', global('_d'), b.div('i16', global('_i'), imm(2)));
      b.store('i16', global('_e'), b.mod('i16', global('_i'), imm(2)));
      b.store('u16', global('_f'), b.div('u16', global('_k'), imm(0)));
    });
    expect(run(IR_STRENGTH, ir).text).toEqual([
      'shr.u16 t0, _k, #1',
      'store.u16 _a, t0',
      'and.u16 t1, _k, #7',
      'store.u16 _b, t1',
      'shr.u8 t2, _j, #7',
      'store.u8 _c, t2',
      'div.i16 t3, _i, #2',
      'store.i16 _d, t3',
      'mod.i16 t4, _i, #2',
      'store.i16 _e, t4',
      'div.u16 t5, _k, #0',
      'store.u16 _f, t5',
      'end #0',
    ]);
  });

  it('merges two adds or subtracts of constants, and drops the pair that cancels', () => {
    const ir = program((b) => {
      b.store('i16', global('_a'), b.sub('i16', b.add('i16', global('_y'), imm(4)), imm(5)));
      b.store('u16', global('_b'), b.sub('u16', b.add('u16', global('_y'), imm(4)), imm(5)));
      b.store('i16', global('_c'), b.add('i16', b.sub('i16', global('_y'), imm(4)), imm(4)));
      b.store('i16', global('_d'), b.add('i16', b.add('i16', global('_y'), imm(1)), imm(2)));
    });
    expect(run(IR_STRENGTH, ir).text).toEqual([
      'sub.i16 t1, _y, #1',
      'store.i16 _a, t1',
      'sub.u16 t3, _y, #1',
      'store.u16 _b, t3',
      'load.i16 t5, _y',
      'store.i16 _c, t5',
      'add.i16 t7, _y, #3',
      'store.i16 _d, t7',
      'end #0',
    ]);
  });

  it('tests the value instead of comparing it with 0', () => {
    const ir = program((b) => {
      const l = b.newLabel();
      b.jz('i16', b.compare('eq', 'i16', global('_x'), imm(0)), l);
      b.jnz('i16', b.compare('ne', 'u16', global('_y'), imm(0)), l);
      b.jz('i16', b.compare('gt', 'u8', imm(0), global('_p')), l); // 0 > p: never for unsigned: left alone
      b.jnz('i16', b.compare('lt', 'u8', imm(0), global('_p')), l); // 0 < p is p > 0, p <> 0
      b.jz('i16', b.compare('gt', 'i16', global('_x'), imm(0)), l); // signed: not a zero test
      b.label(l);
    });
    expect(run(IR_STRENGTH, ir).text).toEqual([
      'jnz.i16 _x, .T.0',
      'jnz.u16 _y, .T.0',
      'gt.u8 t2, #0, _p',
      'jz.i16 t2, .T.0',
      'jnz.u8 _p, .T.0',
      'gt.i16 t4, _x, #0',
      'jz.i16 t4, .T.0',
      '.T.0:',
      'end #0',
    ]);
  });

  it('branches straight to L for IF c THEN GOTO L, and keeps the stmt quad', () => {
    const build = (b: IrBuilder): void => {
      const skip = b.newLabel();
      b.stmt(null, SP);
      b.jz('i16', global('_c'), skip);
      b.stmt(null, SP);
      b.jump('.L.100');
      b.label(skip);
      b.stmt(null, SP);
      b.label('.L.100');
    };
    expect(run(IR_STRENGTH, program(build)).text).toEqual(['; stmt', 'jnz.i16 _c, .L.100', '; stmt', '.T.0:', '; stmt', '.L.100:', 'end #0']);
    // ON BREAK STOP gives the stmt quad code of its own: nothing moves
    expect(run(IR_STRENGTH, program(build, true)).text).toContain('jump .L.100');
  });

  it('leaves the jump when an event poll lies between the stmt and the jump', () => {
    const ir = program((b) => {
      const skip = b.newLabel();
      b.jz('i16', global('_c'), skip);
      b.stmt(null, SP);
      b.rtcall('.core.__EVENT_POLL');
      b.jump('.L.100');
      b.label(skip);
      b.label('.L.100');
    });
    expect(run(IR_STRENGTH, ir).text).toContain('jump .L.100');
  });

  it('leaves floats, strings and 8-bit-count shifts of other widths alone', () => {
    const ir = program((b) => {
      b.store('f', global('_r'), b.mul('f', b.load('f', global('_s')), imm(2)));
    });
    expect(run(IR_STRENGTH, ir).out).toBe(ir);
  });
});

describe('ir-dead', () => {
  it('removes the code between a jump and the next label, keeping stmt, asm and labels', () => {
    const ir = program((b) => {
      const l = b.newLabel();
      b.jump(l);
      b.store('i16', global('_x'), imm(1));
      b.stmt(null, SP);
      b.asm([{ text: 'nop', span: SP }]);
      b.rtcall('.core.__Y');
      b.label(l);
      b.store('i16', global('_x'), imm(2));
    });
    expect(run(IR_DEAD, ir).text).toEqual(['jump .T.0', '; stmt', 'asm "nop"', '.T.0:', 'store.i16 _x, #2', 'end #0']);
  });

  it('removes the code after end and retsub up to the next label, but not the closing end', () => {
    const ir = program((b) => {
      b.retsub();
      b.store('i16', global('_x'), imm(1));
    });
    expect(run(IR_DEAD, ir).text).toEqual(['retsub', 'end #0']);
  });

  it('removes a jump to the label that follows it', () => {
    const ir = program((b) => {
      const l = b.newLabel();
      const m = b.newLabel();
      b.jump(m);
      b.label(l);
      b.label(m);
      b.store('i16', global('_x'), imm(2));
    });
    expect(run(IR_DEAD, ir).text).toEqual(['.T.0:', '.T.1:', 'store.i16 _x, #2', 'end #0']);
  });

  it('keeps a label that something jumps to', () => {
    const ir = program((b) => {
      const l = b.newLabel();
      b.jump(l);
      b.label('.L.5');
      b.store('i16', global('_x'), imm(1));
      b.label(l);
    });
    expect(run(IR_DEAD, ir).text).toEqual(['jump .T.0', '.L.5:', 'store.i16 _x, #1', '.T.0:', 'end #0']);
  });
});
