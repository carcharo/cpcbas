/**
 * L4-SMALL: FRAME in a bare build (`-D CPC_BAREMETAL`, lib/loco/misc.asm) on the test Z80. A bare program cannot
 * use the fake firmware, so the routine runs in a minimal bare image. The expected behaviour is the firmware's
 * MC WAIT FLYBACK: read the PPI's port B (&F5xx) until bit 0 (the flyback) is set.
 */
import { describe, expect, it } from 'vitest';
import { libTree } from './runtime-tree.js';
import type { Cpc } from './z80sim/cpc.js';
import { assembleText, runImage } from './z80sim/run.js';

const files: Record<string, string> = {};
for (const [path, text] of libTree()) if (path.startsWith('loco/')) files[path] = text;

describe('bare FRAME', () => {
  it('reads port B until bit 0 is set, then returns', () => {
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
      ' call .core.__LOCO_FRAME',
      ' rst 0',
      '#include once <loco/misc.asm>',
    ].join('\n');
    const image = assembleText(text, { files } as never);
    const reads: number[] = [];
    const sequence = [0xa0, 0xa0, 0xa0, 0xa1, 0xa0];
    const run = runImage(image.bytes, image.org, image.entry, {
      maxTStates: 1_000_000,
      setup: (cpc: Cpc) => {
        cpc.cpu.onIn = (port) => {
          reads.push(port);
          return sequence[Math.min(reads.length - 1, sequence.length - 1)] as number;
        };
      },
    } as never);
    expect(run.stopped).toBe('rst0');
    expect(reads.length).toBe(4);
    expect(reads.every((p) => p >> 8 === 0xf5)).toBe(true);
  });
});
