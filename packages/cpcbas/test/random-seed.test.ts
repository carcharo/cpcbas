/**
 * Follow-up 110 on the simulator: RANDOM(n) is seeded at its first call from the clock (firmware KL TIME PLEASE, bare
 * FH_FRAMES), and RANDOMIZE n, RANDOMIZE with no number and RND(-n) seed it too, so `RANDOMIZE n` makes RANDOM
 * repeatable (point 4). The expectations are properties of the
 * rule (same seed, same sequence; a different clock, a different first value), not numbers taken from our own output.
 */
import { describe, expect, it } from 'vitest';
import { normalise, runSource } from './compile-helper.js';
import { libTree } from './runtime-tree.js';
import { assembleText, runImage } from './z80sim/run.js';

const run = (source: string): string => {
  const r = runSource(source);
  expect(r.built.problems).toEqual([]);
  expect(r.built.diagnostics.filter((d) => d.startsWith('E'))).toEqual([]);
  expect(r.stopped).toBe('rst0');
  return normalise(r.printer) as string;
};

describe('RANDOM and RANDOMIZE (firmware build)', () => {
  it('RANDOMIZE n makes RANDOM repeat: the same n, the same sequence; another n, another', () => {
    const src = [
      'DIM a(3) AS INTEGER',
      'DIM b(3) AS INTEGER',
      'DIM c(3) AS INTEGER',
      'RANDOMIZE 7',
      'FOR i = 0 TO 3: a(i) = RANDOM(60000): NEXT',
      'RANDOMIZE 7',
      'FOR i = 0 TO 3: b(i) = RANDOM(60000): NEXT',
      'RANDOMIZE 100',
      'FOR i = 0 TO 3: c(i) = RANDOM(60000): NEXT',
      'same = -1: other = 0',
      'FOR i = 0 TO 3',
      ' IF a(i) <> b(i) THEN same = 0',
      ' IF a(i) <> c(i) THEN other = -1',
      'NEXT',
      'PRINT same; other',
    ].join('\n');
    expect(run(src)).toBe('-1 -1 \n');
  });

  it('RANDOMIZE -7 and RANDOMIZE 7 start different RANDOM sequences (the sign is part of the seed, as for RND)', () => {
    expect(run('RANDOMIZE 7\na = RANDOM(60000)\nRANDOMIZE -7\nb = RANDOM(60000)\nPRINT a <> b')).toBe('-1 \n');
  });

  it('RND(-n) seeds it as RANDOMIZE n does', () => {
    expect(run('RANDOMIZE 7\na = RANDOM(60000)\nx! = RND(-7)\nb = RANDOM(60000)\nRANDOMIZE 7\nc = RANDOM(60000)\nPRINT a = b; a = c')).toBe('-1 -1 \n');
  });

  it('RANDOMIZE 0 is repeatable', () => {
    expect(run('RANDOMIZE 0\na = RANDOM(60000)\nRANDOMIZE 0\nb = RANDOM(60000)\nPRINT a = b')).toBe('-1 \n');
  });

  it('with no RANDOMIZE the first call seeds from the clock: a later start gives another first value; later calls do not reseed', () => {
    const first = (delay: string): string => run(`${delay}a = RANDOM(60000)\nPRINT a`);
    const now = first('');
    const later = first('PAUSE 6\n');
    expect(now).not.toBe(later);
    // the same program twice at the same clock gives the same value (the simulator's clock is the T-state count)
    expect(first('')).toBe(now);
    // a second RANDOM call does not reseed from the clock: PAUSE between two calls changes nothing
    expect(run('a = RANDOM(60000)\nb = RANDOM(60000)\nPRINT a; b')).toBe(run('a = RANDOM(60000)\nPAUSE 6\nb = RANDOM(60000)\nPRINT a; b'));
  });

  it('plain RANDOMIZE seeds RANDOM from the time and never prompts', () => {
    expect(run('RANDOMIZE\na = RANDOM(10)\nPRINT a < 10')).toBe('-1 \n');
  });
});

describe('RANDOM seeds (bare build)', () => {
  const files: Record<string, string> = {};
  for (const [path, text] of libTree()) if (path.startsWith('loco/')) files[path] = text;
  /** Sets FH_FRAMES to `frames`, optionally calls `__LOCO_RANDOMIZE`-equivalent through RANDTIME, then RANDOM(60000) twice. */
  const bare = (frames: number, before: string): [number, number] => {
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
      ` ld hl,${frames & 0xffff}`,
      ' ld (.core.FH_FRAMES),hl',
      ` ld hl,${Math.floor(frames / 65536)}`,
      ' ld (.core.FH_FRAMES+2),hl',
      before,
      ' ld hl,60000',
      ' call .core.__LOCO_RANDOM',
      ' ld (answer),hl',
      ' ld hl,60000',
      ' call .core.__LOCO_RANDOM',
      ' ld (answer+2),hl',
      ' rst 0',
      'answer: defw 0,0',
      '#include once <loco/misc.asm>',
      '#include once <loco/realfn.asm>',
    ].join('\n');
    const image = assembleText(text, { files } as never);
    const r = runImage(image.bytes, image.org, image.entry, { maxTStates: 50_000_000 } as never);
    const at = image.addr('answer');
    return [r.memory[at]! | (r.memory[at + 1]! << 8), r.memory[at + 2]! | (r.memory[at + 3]! << 8)];
  };

  it('the first call seeds from FH_FRAMES: another frame count, another sequence; the same count, the same', () => {
    expect(bare(1000, '')).toEqual(bare(1000, ''));
    expect(bare(1000, '')).not.toEqual(bare(1234, ''));
  });

  it('RANDTIME (RANDOMIZE with no number) seeds it from FH_FRAMES too', () => {
    // the clock moves on after RANDTIME: RANDOM keeps the seed RANDTIME gave it, it does not reseed at its first call
    const seeded = bare(777, ' call .core.__LOCO_RANDTIME\n ld hl,5\n ld (.core.FH_FRAMES),hl');
    expect(seeded).toEqual(bare(777, ''));
    expect(seeded).not.toEqual(bare(5, ''));
  });
});
