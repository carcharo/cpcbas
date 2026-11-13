/**
 * lib/loco/fmath.asm (FWM-LAYOUT) on the test Z80: the REAL layout against the calculator.
 * Expected bytes are Locomotive's layout (docs/ir.md; the measured values of
 * tests/loco/real-bytes.expected, or worked out from the format: byte 3 is the top mantissa byte
 * with the sign in bit 7, byte 4 the exponent, which is 0 for zero). The operands are given as
 * bytes, never produced by the code under test, and every result is read back as bytes.
 */
import { describe, expect, it } from 'vitest';
import { libTree } from './runtime-tree.js';
import { runProgram } from './z80sim/run.js';

const files: Record<string, string> = {};
for (const [path, text] of libTree()) if (path.startsWith('loco/')) files[path] = text;

type Bytes = readonly number[];
// measured (tests/loco/real-bytes.expected) or computed from the layout by hand
const R = {
  zero: [0, 0, 0, 0, 0],
  one: [0, 0, 0, 0, 0x81],
  minusOne: [0, 0, 0, 0x80, 0x81],
  two: [0, 0, 0, 0, 0x82],
  three: [0, 0, 0, 0x40, 0x82],
  five: [0, 0, 0, 0x20, 0x83],
  ten: [0, 0, 0, 0x20, 0x84],
  oneHalf: [0, 0, 0, 0x40, 0x81],
  twoQuarter: [0, 0, 0, 0x10, 0x82],
  threeThreeQuarters: [0, 0, 0, 0x70, 0x82],
  minusThreeQuarter: [0, 0, 0, 0xc0, 0x80],
  threeEighths: [0, 0, 0, 0x58, 0x82], // 3.375 = 1.5 * 2.25
  twoHundred: [0, 0, 0, 0x48, 0x88],
  tenth: [0xcd, 0xcc, 0xcc, 0x4c, 0x7d],
  // the calculator's small integer 5: exponent 0, sign byte, low, high, 0 -- in its own (Spectrum) order
  smallFive: [0, 0, 5, 0, 0],
} as const;

const load = (b: Bytes): string => ` ld a,${b[0]}\n ld de,${((b[2] as number) << 8) | (b[1] as number)}\n ld bc,${((b[4] as number) << 8) | (b[3] as number)}\n`;
const push = (b: Bytes): string => `${load(b)} push bc\n push de\n push af\n`;
const store = ` ld (outv),a\n ld (outv+1),de\n ld (outv+3),bc\n`;

/** Runs `body` (assembly after the setup) and returns the five bytes at `outv` and the byte at `flag`. */
function run(body: string, bare = false): { res: number[]; flag: number; sp0: number; sp1: number } {
  const r = runProgram(
    {
      body: `${bare ? ' call .core.CPC_INIT_FP_CALC\n' : ''} ld (sp0),sp\n${body}\n ld (sp1),sp`,
      data: 'outv: DEFS 5\nflag: DEFB 0\nsp0: DEFW 0\nsp1: DEFW 0',
      include: ['loco/fmath.asm', 'loco/fmathcmp.asm', 'loco/fmathcv.asm', ...(bare ? ['loco/fmathcalc.asm'] : [])],
      heap: true,
    },
    { files, defines: bare ? { __CPC_PRINTER_ECHO__: '1', CPC_BAREMETAL: '1' } : { __CPC_PRINTER_ECHO__: '1' } } as never,
  );
  expect(r.stopped).toBe('rst0');
  const at = r.image.addr('outv');
  return { res: Array.from(r.memory.subarray(at, at + 5)), flag: r.byteAt('flag') ?? 0, sp0: r.wordAt('sp0'), sp1: r.wordAt('sp1') };
}

const binary = (entry: string, a: Bytes, b: Bytes): { res: number[]; flag: number } => {
  const r = run(`${push(a)}${load(b)} call .core.${entry}\n${store} ld (flag),a`);
  expect(r.sp1, `${entry} removes the stacked operand`).toBe(r.sp0);
  return r;
};

describe('fmath.asm arithmetic on Locomotive\'s layout', () => {
  const CASES: [string, Bytes, Bytes, Bytes][] = [
    ['__LOCO_FADD', R.oneHalf, R.twoQuarter, R.threeThreeQuarters],
    ['__LOCO_FADD', R.zero, R.zero, R.zero],
    ['__LOCO_FADD', R.one, R.minusOne, R.zero],
    ['__LOCO_FADD', R.two, R.three, R.five],
    ['__LOCO_FSUB', R.oneHalf, R.twoQuarter, R.minusThreeQuarter],
    ['__LOCO_FSUB', R.five, R.two, R.three],
    ['__LOCO_FMUL', R.oneHalf, R.twoQuarter, R.threeEighths],
    ['__LOCO_FMUL', R.ten, R.minusOne, [0, 0, 0, 0xa0, 0x84]],
    ['__LOCO_FDIV', R.five, R.two, [0, 0, 0, 0x20, 0x82]], // 5 / 2 = 2.5
    ['__LOCO_FDIV', R.ten, R.five, R.two],
  ];
  it.each(CASES)('%s on bytes: a op b', (entry, a, b, want) => {
    expect(binary(entry, a, b).res).toEqual(want);
  });

  it('the stacked operand is a, the register operand is b (a - b and a / b are not b - a)', () => {
    expect(binary('__LOCO_FSUB', R.two, R.five).res).toEqual([0, 0, 0, 0xc0, 0x82]); // 2 - 5 = -3
    // 2 / 10 = 0.2 is exponent &7E, positive; the calculator's last mantissa bit differs from the firmware's (FWM-CORE)
    const q = binary('__LOCO_FDIV', R.two, R.ten).res;
    expect([q[4], (q[3] as number) & 0x80, q[3]! & 0x7f, q[2], q[1]]).toEqual([0x7e, 0, 0x4c, 0xcc, 0xcc]);
  });

  const CMP: [string, Bytes, Bytes, number][] = [
    ['__LOCO_FEQ', R.one, R.one, 1],
    ['__LOCO_FEQ', R.one, R.two, 0],
    ['__LOCO_FNE', R.one, R.two, 1],
    ['__LOCO_FNE', R.one, R.one, 0],
    ['__LOCO_FLT', R.one, R.two, 1],
    ['__LOCO_FLT', R.two, R.one, 0],
    ['__LOCO_FLT', R.one, R.one, 0],
    ['__LOCO_FLE', R.one, R.one, 1],
    ['__LOCO_FLE', R.two, R.one, 0],
    ['__LOCO_FGT', R.two, R.one, 1],
    ['__LOCO_FGT', R.one, R.two, 0],
    ['__LOCO_FGT', R.one, R.one, 0],
    ['__LOCO_FGE', R.one, R.one, 1],
    ['__LOCO_FGE', R.one, R.two, 0],
    ['__LOCO_FLT', R.minusOne, R.zero, 1],
    ['__LOCO_FGT', R.zero, R.minusOne, 1],
    ['__LOCO_FEQ', R.zero, R.zero, 1],
  ];
  it.each(CMP)('%s gives 0 or 1 in A: a op b', (entry, a, b, want) => {
    expect(binary(entry, a, b).flag).toBe(want);
  });

  it('negates a REAL by the sign bit of byte 3, also for zero (the firmware NEG: 00 00 00 80 00, still zero by its exponent byte)', () => {
    expect(run(`${load(R.one)} call .core.__LOCO_FNEG\n${store}`).res).toEqual(R.minusOne);
    expect(run(`${load(R.minusOne)} call .core.__LOCO_FNEG\n${store}`).res).toEqual(R.one);
    expect(run(`${load(R.tenth)} call .core.__LOCO_FNEG\n${store}`).res).toEqual([0xcd, 0xcc, 0xcc, 0xcc, 0x7d]);
    expect(run(`${load(R.zero)} call .core.__LOCO_FNEG\n${store}`).res).toEqual([0, 0, 0, 0x80, 0]);
  });

  it('converts integers and FIXED to REAL', () => {
    expect(run(` ld a,200\n call .core.__LOCO_FU8\n${store}`).res).toEqual(R.twoHundred);
    expect(run(` ld a,0\n call .core.__LOCO_FU8\n${store}`).res).toEqual(R.zero);
    expect(run(` ld a,0xff\n call .core.__LOCO_FI8\n${store}`).res).toEqual(R.minusOne);
    expect(run(` ld hl,10\n ld de,0\n call .core.__LOCO_FU32\n${store}`).res).toEqual(R.ten);
    expect(run(` ld hl,0xffff\n ld de,0xffff\n call .core.__LOCO_FI32\n${store}`).res).toEqual(R.minusOne);
    expect(run(` ld hl,0x8000\n ld de,1\n call .core.__LOCO_FF16\n${store}`).res).toEqual(R.oneHalf); // 1.5
  });

  it('converts a REAL to a 32-bit integer and to FIXED', () => {
    const r = runProgram(
      {
        body: `${load(R.ten)} call .core.__LOCO_FTOU32\n ld (outv),hl\n ld (outv+2),de\n${load(R.oneHalf)} call .core.__LOCO_FTOF16REG\n ld (outv+4),hl\n ld (outv+6),de`,
        data: 'outv: DEFS 8',
        include: ['loco/fmath.asm', 'loco/fmathcmp.asm', 'loco/fmathcv.asm'],
        heap: true,
      },
      { files } as never,
    );
    expect(r.stopped).toBe('rst0');
    expect([r.wordAt('outv'), r.wordAt('outv', 2)]).toEqual([10, 0]);
    expect([r.wordAt('outv', 4), r.wordAt('outv', 6)]).toEqual([0x8000, 1]); // FIXED 1.5 = DE.HL = 1 . 0x8000
  });

  it('reverses the registers, and normalises the calculator\'s small integer in __LOCO_FOUT (bare builds)', () => {
    expect(run(`${load([1, 2, 3, 4, 5])} call .core.__LOCO_FREV\n${store}`, true).res).toEqual([5, 4, 3, 2, 1]);
    expect(run(`${load([5, 4, 3, 2, 1])} call .core.__LOCO_FREV\n${store}`, true).res).toEqual([1, 2, 3, 4, 5]);
    // the calculator hands back the small integer 5 as 00 00 05 00 00 (A E D C B); the layout has it as 5.0
    expect(run(`${load(R.smallFive)} call .core.__LOCO_FOUT\n${store}`, true).res).toEqual(R.five);
    expect(run(`${load([0, 0xff, 0xfb, 0xff, 0])} call .core.__LOCO_FOUT\n${store}`, true).res).toEqual([0, 0, 0, 0xa0, 0x83]); // -5
    expect(run(`${load(R.zero)} call .core.__LOCO_FOUT\n${store}`, true).res).toEqual(R.zero);
    // a full float in the calculator's order (A the exponent, E the top byte) is reversed
    expect(run(`${load([0x82, 0x40, 0, 0, 0])} call .core.__LOCO_FOUT\n${store}`, true).res).toEqual(R.three);
  });
});
