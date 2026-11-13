/**
 * L4-SOUND through the whole pipeline: BASIC source for SOUND, ENV, ENT, RELEASE, SQ and BEEP is compiled and run
 * on the test Z80 with the fake sound manager (z80sim/sound.ts). Expected blocks are what the real interpreter passed
 * (p-sound-1.bas, p-sound-2.bas); BEEP's period and duration are the reference compiler's `getDEHL`
 * (zxbasic/src/arch/cpc/beep.py) for the same arguments.
 */
import { describe, expect, it } from 'vitest';
import { compile, formatDiagnostic } from '../src/index.js';
import { beepConstants } from '../src/ir/lower/builtins.js';
import { buildSource, normalise, runSource } from './compile-helper.js';
import { libTree } from './runtime-tree.js';
import { newCalls, sound } from './z80sim/sound.js';

const hex = (bytes: readonly number[]): string => bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');

function play(source: string, opts: { status?: number } = {}) {
  const calls = newCalls();
  const r = runSource(source, { setup: sound(calls, opts) });
  expect(r.stopped).toBe('rst0');
  return { calls, r, text: normalise(r.printer) };
}
/** [duration in 1/100 s, tone period] of the nth queued note. */
const note = (calls: ReturnType<typeof newCalls>, n = 0): [number, number] => {
  const b = calls.queue[n] as number[];
  return [b[7] | (b[8] << 8), b[3] | (b[4] << 8)];
};

describe('SOUND, ENV, ENT, RELEASE and SQ compiled', () => {
  it('SOUND with every argument, variables and expressions', () => {
    const { calls } = play('c = 2: p = 100\nSOUND c, p * 2, 50, 10, 2, 3, 4\nSOUND c + 8, p, -3, 15, 1');
    expect(calls.queue.map(hex)).toEqual(['02 02 03 c8 00 04 0a 32 00', '0a 01 00 64 00 00 0f fd ff']);
  });
  it('omitted arguments take the defaults (duration 20, volume 12), also in the middle', () => {
    const { calls } = play('SOUND 1, 200\nSOUND 1, 200, , 15\nSOUND 4, 100, , , 3');
    expect(calls.queue.map(hex)).toEqual(['01 00 00 c8 00 00 0c 14 00', '01 00 00 c8 00 00 0f 14 00', '04 03 00 64 00 00 0c 14 00']);
  });
  it('REAL arguments are rounded half away from zero, as the interpreter does (p-sound-5.bas)', () => {
    const { calls } = play(
      'SOUND 1.5,100.5\nSOUND 1.4,100.4,20.5,12.5,1.5,2.5,3.5\nSOUND 0.4,0.4,-1.5\nRELEASE 2.5\nENV 1.5,10.5,2.5,5.5\nENT -2.5,10.4,-2.5,5.4\nENV 3,-0.4,-0.5,0.5\nDEFREAL x\nx=1.5:SOUND x+128+64,100,100.5,0',
    );
    expect(calls.queue.map(hex)).toEqual([
      '02 00 00 65 00 00 0c 14 00',
      '01 02 03 64 00 04 0d 15 00',
      '00 00 00 00 00 00 0c fe ff',
      'c2 00 00 64 00 00 00 65 00',
    ]);
    expect(calls.release).toEqual([3]);
    expect(calls.env.map((e) => `${e.a}: ${hex(e.block.slice(0, 4))}`)).toEqual(['2: 01 0b 03 06', '3: 01 00 ff 01']);
    expect(calls.ent.map((e) => `${e.a}: ${hex(e.block.slice(0, 4))}`)).toEqual(['3: 81 0a fd 05']);
  });
  it('ENV and ENT: software and hardware sections', () => {
    const { calls } = play('ENV 5, 10, 1, 5, =10, 300\nENT -2, 5, 1, 2, 3, -1, 10\nENT 3, =200, 20\nv = 15\nENV v, 127, 15, 255');
    expect(calls.env.map((e) => `${e.a}: ${hex(e.block.slice(0, e.a === 5 ? 7 : 4))}`)).toEqual(['5: 02 0a 01 05 8a 2c 01', '15: 01 7f 0f ff']);
    expect(calls.ent.map((e) => `${e.a}: ${hex(e.block.slice(0, 7))}`)[0]).toBe('2: 82 05 01 02 03 ff 0a');
    expect(hex(calls.ent[1].block.slice(0, 4))).toBe('01 f0 c8 14');
  });
  it('RELEASE and SQ: the status byte, as a number', () => {
    const { calls, text } = play('RELEASE 5\nc = 2\nPRINT SQ(c); SQ(1) AND 7\nDIM u AS UBYTE\nu = SQ(4)\nPRINT u', { status: 0xc3 });
    expect(calls.release).toEqual([5]);
    expect(calls.check).toEqual([2, 1, 4]);
    expect(text).toBe(' 195  3 \n 195 \n');
  });
});

describe('BEEP compiled', () => {
  // [duration, pitch, the reference compiler's getDEHL(duration, pitch)]
  const reference: [number, number, number, number][] = [
    [0.2, 0, 20, 239],
    [0.5, 0, 50, 239],
    [1, 12, 100, 119],
    [0, -60, 0, 4095],
    [10, 127, 1000, 1],
    [0.25, -12, 25, 478],
    [2, 7.5, 200, 155],
    [1, 60, 100, 7],
    [0.01, 0.5, 1, 232],
  ];
  it('constant arguments fold to the reference compiler numbers', () => {
    for (const [d, p, dur, per] of reference) expect(beepConstants(d, p), `${d}, ${p}`).toEqual([dur, per]);
  });
  it('constant BEEP queues one note on channel A and waits for it', () => {
    for (const [d, p, dur, per] of reference.filter((x) => x[2] > 0 && x[0] !== 0.01)) {
      const { calls } = play(`BEEP ${d}, ${p}`, { status: 0x04 });
      expect(calls.queue, `${d}, ${p}`).toHaveLength(1);
      expect(note(calls), `${d}, ${p}`).toEqual([dur, per]);
      expect(calls.queue[0]?.[0]).toBe(1);
    }
  });
  it('a duration of 0 plays nothing', () => {
    expect(play('BEEP 0, 0', { status: 0x04 }).calls.queue).toEqual([]);
  });
  it('run-time values give the same numbers (to one unit: the REAL arithmetic rounds)', () => {
    for (const [d, p, dur, per] of reference.filter((x) => x[2] > 0 && Number.isInteger(x[1]))) {
      const { calls } = play(`d! = ${d}: p = ${p}\nBEEP d!, p`, { status: 0x04 });
      expect(calls.queue, `${d}, ${p}`).toHaveLength(1);
      const [gd, gp] = note(calls);
      expect(gd, `duration ${d}, ${p}`).toBe(dur);
      // the period is clamped to 1..4095 by the player; the REAL maths may differ from the table's by one unit
      expect(Math.abs(gp - per), `period ${d}, ${p}: ${gp} against ${per}`).toBeLessThanOrEqual(Math.max(1, Math.round(per / 4000)));
    }
  });
  it('run-time values are held to the ranges: a negative duration plays nothing, a long one is 10 s, the pitch is clamped', () => {
    expect(play('d! = -1: p = 0\nBEEP d!, p', { status: 0x04 }).calls.queue).toEqual([]);
    expect(note(play('d! = 50: p = 0\nBEEP d!, p', { status: 0x04 }).calls)[0]).toBe(1000);
    expect(note(play('d! = 1: p = 1000\nBEEP d!, p', { status: 0x04 }).calls)[1]).toBe(1); // pitch 127
    expect(note(play('d! = 1: p = -1000\nBEEP d!, p', { status: 0x04 }).calls)[1]).toBe(4095); // pitch -60 (period 7644, clamped)
  });
  it('a bare build of BEEP compiles (the AY plays it); SOUND is E270', () => {
    const bare = { CPC_BAREMETAL: '' };
    const mk = (text: string) => compile({ files: new Map([['t.bas', text]]), main: 't.bas', defines: bare, runtime: libTree(), options: { format: 'cpr', org: 0x4000 } });
    const ok = mk('BEEP 0.5, 3\nd! = 1: p = 5\nBEEP d!, p');
    expect(ok.diagnostics.map((d) => formatDiagnostic(d, ok.sources))).toEqual([]);
    expect(ok.ok).toBe(true);
    const bad = mk('SOUND 1, 100');
    expect(bad.diagnostics.map((d) => d.code)).toEqual(['E270']);
  });
});

describe('programs that do not use sound are unchanged', () => {
  it('no sound.asm in a program without the sound statements', () => {
    const b = buildSource('PRINT 1');
    expect(b.asm).not.toContain('__LOCO_SOUND');
    expect(b.asm).not.toContain('__LOCO_ENV');
  });
});
