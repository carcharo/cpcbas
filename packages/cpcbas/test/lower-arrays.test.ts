/**
 * L3-ARR-LOWER: global arrays in the checker and the lowering. IR shapes (docs/ir.md "Arrays"),
 * checker rules (bounds, AT, UBOUND folding), then simulator runs of the programs the plan names.
 */
import { describe, expect, it } from 'vitest';
import { bind } from '../src/binder/index.js';
import { DiagnosticBag } from '../src/core/diagnostics.js';
import { SourceSet } from '../src/core/source.js';
import { runFrontEnd } from '../src/pipeline.js';
import { lowerSource, normalise, runSource } from './compile-helper.js';

const ir = (src: string): string => lowerSource(src).irText;
const errs = (src: string): string[] => lowerSource(src).diagnostics.filter((d) => d.startsWith('E'));

describe('IR of global arrays', () => {
  it('constant indexes are addr operands with the element offset', () => {
    const t = ir('DIM a(10)\na(3) = 7\nx = a(3)');
    expect(t).toContain('store.i16 @_a__a.__DATA__+6, #7');
    expect(t).toContain('load.i16 t0, @_a__a.__DATA__+6');
    expect(t).toContain('global _a__a i16 size=30 dims=[11]');
  });
  it('computed indexes go through aaddr / aload / astore, the address before the value', () => {
    const t = ir('DIM a(10)\ni = 2\na(i) = a(i + 1) + x');
    expect(t).toMatch(/cast\.u16<-i16 t0, _i\n {2}aaddr\.i16 t1, @_a__a, 1\n/);
    expect(t).toContain('aload.i16');
    expect(t).toMatch(/astore\.i16 t1, t6/);
  });
  it('two dimensions: row-major offset, constant index mixed with a computed one is loaded to a temp', () => {
    const t = ir('DIM m(3, 4) AS UBYTE\nj = 1\nm(2, j) = 9\ny = m(1, 1)');
    expect(t).toContain('load.u16 t0, #2');
    expect(t).toContain('aaddr.u8 t2, @_m__a, 2');
    expect(t).toContain('load.u8 t3, @_m__a.__DATA__+6');
  });
  it('a UINTEGER element with a constant index is read with peek', () => {
    const t = ir('DIM w(3) AS UINTEGER\nw(1) = 500\nx = w(1)');
    expect(t).toContain('store.u16 @_w__a.__DATA__+2, #500');
    expect(t).toContain('peek.u16 t0, @_w__a.__DATA__+2');
  });
  it('@a and @a(i)', () => {
    const t = ir('DIM w(3) AS UINTEGER\np = @w\nq = @w(2)\ni = 1\nr = @w(i)');
    expect(t).toContain('cast.i16<-u16 t0, @_w__a.__DATA__\n');
    expect(t).toContain('@_w__a.__DATA__+4');
    expect(t).toContain('aaddr.u16 t3, @_w__a, 1');
  });
  it('initialisers, AT and hidata', () => {
    const t = ir('#pragma hidata = 49152\nDIM t(3) AS UBYTE => {1,2,3,4}\n#pragma hidata = 0\nDIM u(3) AS UBYTE => {1}\nDIM s(15) AS UBYTE AT &C000\nDIM r(1) AS REAL => {1.5, 2}');
    expect(t).toContain('global _t__a u8 size=8 dims=[4] hidata=49152 init=01020304');
    expect(t).toContain('global _u__a u8 size=12 dims=[4] init=01000000');
    expect(t).toContain('global _s__a u8 size=8 dims=[16] at=49152');
    expect(t).toContain('global _r__a f size=18 dims=[2] init=00000040810000000082');
  });
  it('#pragma hidata places the initialised arrays of one pragma one after another (the fork\'s cursor)', () => {
    // a: 3 bytes at &8000; b: 2 bytes at &8003; c is not initialised (data area); a new pragma restarts at its address.
    const t = ir('#pragma hidata = &8000\nDIM a(2) AS UBYTE => {1,2,3}\nDIM c(1) AS UBYTE\nDIM b(1) AS UBYTE => {9,8}\n#pragma hidata = &8000\nDIM d(0) AS UINTEGER => {7}\nPRINT a(1); b(1); c(0); d(0)');
    expect(t).toContain('global _a__a u8 size=8 dims=[3] hidata=32768 init=010203');
    expect(t).toContain('global _b__a u8 size=8 dims=[2] hidata=32771 init=0908');
    expect(t).toContain('global _c__a u8 size=10 dims=[2]\n');
    expect(t).toContain('global _d__a u16 size=8 dims=[1] hidata=32768 init=0700');
  });
  it('a #pragma hidata array that ends past &FFFF is E249', () => {
    expect(errs('#pragma hidata = &FFF0\nDIM a(9) AS UBYTE => {1}\nDIM b(9) AS UBYTE => {1}')).toEqual([expect.stringMatching(/^E249 #pragma hidata: 'b' \(10 bytes at &FFFA\) does not fit below &10000/)]);
    expect(errs('#pragma hidata = &FFF0\nDIM a(15) AS UBYTE => {1}')).toEqual([]);
  });
  it('string arrays start empty; the list is stored at the start of main', () => {
    const t = ir('DIM s$(2) => {"a", "", "c"}\nPRINT 1');
    expect(t).toContain('store.str @_s__s__a.__DATA__, s0');
    expect(t).toContain('store.str @_s__s__a.__DATA__+4, s1');
    expect(t).toContain('global _s__s__a str size=14 dims=[3]');
  });
  it('READ into an element: address first, then the item', () => {
    const t = ir('DIM a(3)\nREAD a(2)\ni = 1\nREAD a(i)\nDATA 4, 5');
    expect(t).toContain('store.i16 @_a__a.__DATA__+4, t0');
    expect(t).toMatch(/aaddr\.i16 t2, @_a__a, 1\n {2}fparam\.u8 #4\n {2}rtcall \.core\.__LOCO_READ -> i16 t3\n {2}astore\.i16 t2, t3/);
  });
  it('the IR verifies', () => {
    const low = lowerSource('DIM a(3, 3) AS REAL\nDIM n$(2)\ni = 1\na(i, 2) = a(2, i) * 2\nn$(i) = n$(0) + "x"\nREAD a(i, i)\nDATA 1');
    expect(low.diagnostics).toEqual([]);
    expect(low.problems).toEqual([]);
  });
});

describe('checker rules for arrays', () => {
  it('UBOUND / LBOUND fold: dimension 1 by default, 0 the dimension count, a missing dimension 0', () => {
    const t = ir('DIM m(3, 4)\nPRINT UBOUND(m); UBOUND(m, 2); LBOUND(m); UBOUND(m, 0); UBOUND(m, 3)');
    expect(t.match(/fparam\.u16 #(\d+)/g)).toEqual(['fparam.u16 #3', 'fparam.u16 #4', 'fparam.u16 #0', 'fparam.u16 #2', 'fparam.u16 #0']);
  });
  it('a variable dimension for UBOUND is E243', () => {
    expect(errs('DIM m(3, 4)\nd = 1\nx = UBOUND(m, d)')).toEqual(['E243 The dimension of UBOUND of an array must be a constant expression']);
  });
  it('a constant index outside the bounds is E248', () => {
    expect(errs('DIM a(3)\nx = a(4)')[0]).toMatch(/^E248 Index 4 is outside/);
    expect(errs('DIM a(3, 2)\na(1, 3) = 1')[0]).toMatch(/^E248 .*dimension 2/);
    expect(errs('DIM a(3)\nx = a(3)')).toEqual([]);
  });
  it('the wrong number of indexes is E240', () => {
    expect(errs('DIM a(3, 3)\nx = a(1)')[0]).toMatch(/^E240/);
  });
  it('DIM ... AT with an initial list is E247', () => {
    expect(errs('DIM a(3) AS UBYTE => {1, 2} AT &C000')[0]).toMatch(/^E247/);
  });
  it('FOR over an element stays an error', () => {
    expect(errs('DIM a(3)\nFOR a(1) = 1 TO 3\nNEXT').length).toBeGreaterThan(0);
  });
  it('local arrays and array parameters are lowered (L3-ARR-PROC)', () => {
    expect(errs('SUB s()\nDIM b(3)\nEND SUB')).toEqual([]);
    expect(errs('SUB s(a() AS INTEGER)\nEND SUB')).toEqual([]);
  });
  it('a global array is usable inside a SUB', () => {
    expect(errs('DIM a(3)\nSUB s()\na(1) = 2\nEND SUB\ns')).toEqual([]);
  });
});

describe('parser and binder', () => {
  it('@a(i) parses and binds to the array; the hidata state is recorded per DIM', () => {
    const sources = new SourceSet();
    const bag = new DiagnosticBag();
    const { program } = runFrontEnd({ files: new Map([['t.bas', '#pragma hidata = &C000\nDIM a(2) AS UBYTE => {1}\n#pragma hidata = 0\nDIM b(2)\nx = @a(1)']]), main: 't.bas' }, sources, bag);
    const bound = bind({ program, sources, diagnostics: bag, bareMetal: false });
    expect(bag.all().filter((d) => d.code.startsWith('E'))).toEqual([]);
    expect([...bound.hidataAt.values()]).toEqual([{ address: 0xc000, run: 1 }]);
  });
  it('@x(1) of something that is not an array is E204', () => {
    expect(errs('x = 1\ny = @x(1)')[0]).toMatch(/^E204/);
  });
});

const out = (src: string): string => {
  const r = runSource(src);
  expect(r.built.problems).toEqual([]);
  expect(r.stopped).toBe('rst0');
  return normalise(r.printer) ?? r.printer;
};

describe('arrays on the simulator', () => {
  it('DIM a(10): constant and computed indexes, zero start', () => {
    expect(out('DIM a(10)\nPRINT a(5)\na(3) = 7\ni = 3\na(i + 1) = a(i) * 2\nPRINT a(3); a(4)')).toBe(' 0 \n 7  14 \n');
  });
  it('two dimensions with an initialiser and UBOUND', () => {
    const src = 'DIM m(3, 4) AS UBYTE => {1, 2, 3, 4, 5, 6, 7, 8, 9, 10}\nj = 1\nPRINT m(0, 0); m(1, 0); m(2, j); m(3, 4)\nm(3, j) = 200\nPRINT m(3, 1); UBOUND(m); UBOUND(m, 2)';
    expect(out(src)).toBe(' 1  6  0  0 \n 200  3  4 \n');
  });
  it('UINTEGER, REAL elements', () => {
    expect(out('DIM w(2) AS UINTEGER\nDIM r(2) AS REAL\nw(1) = 60000\nr(2) = 1.5\ni = 1\nPRINT w(1); w(i); r(2); r(i + 1)')).toBe(' 60000  60000  1.5  1.5 \n');
  });
  it('string array: assign, replace, initial list', () => {
    expect(out('DIM n$(5)\nDIM s$(2) => {"a", "", "c"}\nn$(2) = "hi"\nn$(2) = n$(2) + "!"\ni = 2\nPRINT n$(i); "["; n$(0); "]"; s$(0); s$(1); s$(2)')).toBe('hi![]ac\n');
  });
  it('READ into elements and @a', () => {
    expect(out('DIM a(3)\nDIM b$(1)\nREAD a(1), b$(0)\ni = 2\nREAD a(i)\nPRINT a(1); a(2); b$(0)\nPRINT PEEK(@a(1)); PEEK(@a) \nDATA 5, "x", 7')).toBe(' 5  7 x\n 5  0 \n');
  });
  it('DIM s(15) AS UBYTE AT &C000', () => {
    expect(out('DIM s(15) AS UBYTE AT &C000\ns(2) = 9\nPRINT PEEK(&C002); UBOUND(s)')).toBe(' 9  15 \n');
  });
  it('READ of a REAL item into an INTEGER element rounds, as into a variable (Locomotive; loco-measured.md, follow-ups 30/37)', () => {
    // The measured rule for a plain variable: DATA 1.5, 2.4, -1.5 read into a% b% c% give 2 2 -2.
    expect(out('DIM a(3)\nREAD a(1), a(2)\ni = 3\nREAD a(i)\nPRINT a(1); a(2); a(3)\nDATA 1.5, 2.4, -1.5')).toBe(' 2  2 -2 \n');
  });
  it('the MID$ statement on a string-array element (constant and computed index)', () => {
    // As for a variable (loco-measured.md "The MID$ statement"): MID$(a$,2,2)="XYZ" on HELLO gives HXYLO, MID$(a$,4)="123456" HEL12.
    const src = 'DIM s$(2)\ns$(0) = "HELLO"\ns$(1) = "HELLO"\nt$ = s$(1)\nMID$(s$(0), 2, 2) = "XYZ"\ni = 1\nMID$(s$(i), 4) = "123456"\nPRINT s$(0); " "; s$(1); " "; t$; LEN(s$(1))';
    expect(out(src)).toBe('HXYLO HEL12 HELLO 5 \n');
  });
});
