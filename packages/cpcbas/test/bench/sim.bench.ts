/**
 * L5-MEASURE: exact T-states of the compute kernels (BM7, integer loop, sieve, strings) at every cpcbas level, on the test
 * Z80. Development tooling: the file name does not match `*.test.ts`, so `npm test` does not run it. Run it with
 * `npm run bench:sim` or `python3 bench/speed.py --sim`.
 *
 * Each kernel is bench/programs/speed/NAME.bas, the program the emulator benchmark times. It calls KL TIME PLEASE (&BD0D)
 * once before and once after the timed section; the simulator records the CPU's T-state counter at each call, so the
 * figure is the exact T-states from the first call to the second (it includes the two calls' own cost, the same for every
 * level). The simulator model is not the CPC's gate array: it has no wait states, so the figure is the Z80's own
 * instruction count at 4 MHz (the sim's T-states are a comparison between levels, not a CPC time).
 *
 * Environment: SIM_LEVELS (default `0,1,2,3,s`), SIM_KERNELS (default all four), SIM_OUT (a JSON file to write).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { compile, formatDiagnostic, type OptLevel } from '../../src/index.js';
import { libTree } from '../runtime-tree.js';
import { repoRoot, runImage } from '../z80sim/run.js';

const levels = (process.env['SIM_LEVELS'] ?? '0,1,2,3,s').split(',');
const kernels = (process.env['SIM_KERNELS'] ?? 'bm7,intloop,sieve,strings').split(',');
const speedDir = join(repoRoot, 'bench/programs/speed');
const text = (name: string): string => readFileSync(join(speedDir, name), 'latin1');

interface Cell {
  readonly kernel: string;
  readonly level: string;
  readonly tstates?: number;
  readonly output?: string;
  readonly error?: string;
}

function measure(kernel: string, level: string): Cell {
  // an unknown level is E570 (L5-0), so a mistyped SIM_LEVELS entry shows as a build error, never as -O0's figure
  const optimize = (level === 's' ? 's' : Number(level)) as OptLevel;
  const r = compile({
    files: new Map([
      ['k.bas', text(`${kernel}.bas`)],
      ['tick.bas', text('tick.bas')],
    ]),
    main: 'k.bas',
    defines: { __CPC_PRINTER_ECHO__: '' },
    runtime: libTree(),
    options: { optimize },
  });
  if (!r.ok || r.binary === undefined) {
    const first = r.diagnostics.map((d) => formatDiagnostic(d, r.sources)).find((m) => m.includes('error')) ?? 'build failed';
    return { kernel, level, error: first };
  }
  const stamps: number[] = [];
  const run = runImage(r.binary, r.org ?? 0x40, r.entry ?? 0x40, {
    maxTStates: 2_000_000_000,
    setup: (cpc) => {
      const prev = cpc.cpu.hooks[0xbd0d];
      if (prev === undefined) throw new Error('KL TIME PLEASE is not hooked');
      cpc.cpu.hooks[0xbd0d] = (cpu) => {
        stamps.push(cpu.t);
        prev(cpu);
      };
    },
  });
  if (run.stopped !== 'rst0' || stamps.length !== 2) return { kernel, level, error: `stopped ${run.stopped}, ${stamps.length} clock reads` };
  const output = run.printer.split('\x04END')[0]!.replace(/\s+/g, ' ').trim();
  return { kernel, level, tstates: (stamps[1] as number) - (stamps[0] as number), output };
}

describe('sim bench', () => {
  it('measures the kernels at every level', () => {
    const cells: Cell[] = [];
    for (const k of kernels) for (const l of levels) cells.push(measure(k, l));
    const rows = ['kernel      ' + levels.map((l) => `-O${l}`.padStart(12)).join('')];
    for (const k of kernels) {
      rows.push(
        k.padEnd(12) +
          levels
            .map((l) => {
              const c = cells.find((x) => x.kernel === k && x.level === l);
              return (c?.tstates !== undefined ? String(c.tstates) : 'n/a').padStart(12);
            })
            .join(''),
      );
    }
    console.log(`\nT-states of the timed section (exact, simulator)\n${rows.join('\n')}`);
    for (const c of cells) if (c.error !== undefined) console.log(`  ${c.kernel} -O${c.level}: ${c.error}`);
    const out = process.env['SIM_OUT'];
    if (out) writeFileSync(out, JSON.stringify(cells, null, 1));
  }, 900_000);
});
