/**
 * FWM-CORE: the bare build's SQR (Newton's method on the calculator, lib/loco/realfn.asm, `-D CPC_BAREMETAL`)
 * on the test Z80: exact squares, 2, 1E-30, 1E30, 0, the error for a negative argument and the time. A bare
 * program cannot use the fake firmware, so the routine runs in a minimal bare image (no bootstrap, no heap).
 * Expected values are worked out from the maths (the exact root, one unit in the last place at most) and for
 * the perfect squares exactly; the 8-digit agreement with the firmware's SQR is the harness's REAL rule.
 */
import { describe, expect, it } from 'vitest';
import { realFromNumber, realToNumber } from '../src/core/locoreal.js';
import { libTree } from './runtime-tree.js';
import type { Cpc } from './z80sim/cpc.js';
import type { Z80Cpu } from './z80sim/cpu.js';
import { assembleText, runImage } from './z80sim/run.js';

const files: Record<string, string> = {};
for (const [path, text] of libTree()) if (path.startsWith('loco/')) files[path] = text;

const hex5 = (b: readonly number[]): string => b.map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join('');

/** Runs SQR on each input (REAL bytes); returns the 5 result bytes of each and the T-states of the whole run. */
function sqrAll(inputs: number[][]): { out: number[][]; tstates: number; error: number | null } {
  const text = [
    'org 64',
    '.core.CPC_PRIV_BASE EQU 48128',
    '.core.CPC_PRIV_SIZE EQU 1024',
    '.core.CPC_STACK_TOP EQU 48128',
    '.core.CPC_MEM_TOP EQU 49151',
    '.core.ZXBASIC_HEAP_SIZE EQU 4768',
    '.core.ZXBASIC_MEM_HEAP EQU 42336',
    '#define CPC_BAREMETAL',
    '.core.__START_PROGRAM:',
    ' di',
    ' ld sp,.core.CPC_STACK_TOP',
    ' call .core.CPC_INIT_FP_CALC',
    ...inputs.map(
      (p, i) =>
        ` ld a,${p[0]}\n ld de,${(p[2]! << 8) | p[1]!}\n ld bc,${(p[4]! << 8) | p[3]!}\n call .core.__LOCO_SQR\n ld (outs+${5 * i}),a\n ld (outs+${5 * i + 1}),de\n ld (outs+${5 * i + 3}),bc`,
    ),
    ' rst 0',
    `outs: DEFS ${5 * inputs.length}`,
    '#include once <loco/realfn.asm>',
  ].join('\n');
  const image = assembleText(text, { files } as never);
  let error: number | null = null;
  const run = runImage(image.bytes, image.org, image.entry, {
    maxTStates: 200_000_000,
    setup: (cpc: Cpc) => {
      cpc.cpu.hooks[image.addr('.core.__ERROR')] = (c: Z80Cpu) => {
        error = c.a;
        c.stop = 'halt';
      };
    },
  } as never);
  const at = image.addr('outs');
  return { out: inputs.map((_, i) => Array.from(run.memory.subarray(at + 5 * i, at + 5 * i + 5))), tstates: run.tstates, error };
}

const real = (v: number): number[] => realFromNumber(v).bytes;

describe('bare SQR (Newton)', () => {
  it('perfect squares are exact: 0, 1, 4, 9, 16, 144, 0.25, 2.25, 1E10, 1048576', () => {
    const cases: [number, number][] = [
      [0, 0],
      [1, 1],
      [4, 2],
      [9, 3],
      [16, 4],
      [144, 12],
      [0.25, 0.5],
      [2.25, 1.5],
      [1e10, 1e5],
      [1048576, 1024],
    ];
    const r = sqrAll(cases.map(([x]) => real(x)));
    cases.forEach(([x, root], i) => expect(hex5(r.out[i]!), `SQR(${x})`).toBe(hex5(real(root))));
  });

  it('SQR(2), 1E-30, 1E30, 3, 12345.678, 1.7E38 and 1E-38 are within one unit in the last place of the root', () => {
    const xs = [2, 1e-30, 1e30, 3, 12345.678, 1.7e38, 1e-38, 0.1, 0.7, 5e-20];
    const r = sqrAll(xs.map(real));
    xs.forEach((x, i) => {
      const exact = Math.sqrt(realToNumber(real(x))); // the root of the REAL that was passed
      const got = realToNumber(r.out[i]!);
      expect(Math.abs(got - exact) / exact, `SQR(${x}) = ${got}`).toBeLessThanOrEqual(2 ** -31);
    });
    // SQR(2) is 1.41421356 to 9 digits (Locomotive prints 1.41421356)
    expect(realToNumber(r.out[0]!)).toBeCloseTo(1.4142135623, 8);
  });

  it('a negative argument is error 5 (Improper argument)', () => {
    const r = sqrAll([real(-4)]);
    expect(r.error).toBe(5);
  });

  it('takes far less time than the 112 ms of the old route (target about 20 ms; 4 MHz CPC = 4000 T-states per ms)', () => {
    const r = sqrAll([real(2)]);
    const ms = r.tstates / 4000;
    expect(ms).toBeLessThan(20);
    expect(ms).toBeGreaterThan(0.5);
  });
});
