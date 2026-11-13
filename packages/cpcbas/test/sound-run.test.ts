/**
 * lib/loco/sound.asm on the test Z80 and fake firmware (L4-SOUND): SOUND, ENV, ENT, RELEASE and SQ
 * hand the firmware's sound manager the blocks BASIC hands it. The expected bytes are what the real
 * interpreter passed, recorded by tests/loco/probes/p-sound-1.bas and p-sound-2.bas (a hook on the
 * jumpblock entries SOUND QUEUE &BCAA, SOUND RELEASE &BCB3, SOUND AMPL ENVELOPE &BCBC and SOUND
 * TONE ENVELOPE &BCBF) on the 464 and the 6128, and the errors are the ones p-sound-3.bas raised
 *.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Cpc } from './z80sim/cpc.js';
import { newCalls, sound } from './z80sim/sound.js';
import type { Calls } from './z80sim/sound.js';
import { repoRoot, runProgram } from './z80sim/run.js';
import type { AssembleOptions, AssembledRun, RunOptions } from './z80sim/run.js';

const locoDir = join(repoRoot, 'lib/loco');
const files: Record<string, string> = {};
for (const f of readdirSync(locoDir).filter((n) => n.endsWith('.asm'))) files[`loco/${f}`] = readFileSync(join(locoDir, f), 'latin1');

type Opts = RunOptions & AssembleOptions;
const env = (calls: Calls, o: { full?: number; status?: number } = {}): Opts => ({ files, setup: sound(calls, o) });
const PRIV = 40448; // CPC_PRIV_BASE of the firmware-mode wrapper
const SOUND_BLK = PRIV + 0xac;

const push = (values: readonly number[]): string => values.map((v) => ` ld hl,${v & 0xffff}\n push hl\n`).join('');

function run(body: string, calls: Calls, opts: { full?: number; status?: number } = {}): AssembledRun {
  const r = runProgram(
    {
      body: ` ld ix,0x4321\n ld (ixsave),sp\n${body}\n ld (spafter),sp\n push ix\n pop hl\n ld (ixafter),hl\n`,
      data: 'ixsave: defw 0\nspafter: defw 0\nixafter: defw 0\nrsq: defw 0\n',
      include: ['loco/sound.asm'],
      heap: true,
    },
    env(calls, opts),
  );
  expect(r.stopped).toBe('rst0');
  return r;
}

const soundCall = (args: readonly number[]): string => `${push(args)} call .core.__LOCO_SOUND\n`;
const envCall = (entry: 'ENV' | 'ENT', n: number, values: readonly number[], mask = 0): string =>
  `${push([n, ...values])} ld hl,${values.length + mask * 256}\n call .core.__LOCO_${entry}\n`;

const hex = (bytes: readonly number[]): string => bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');

describe('SOUND: the block BASIC passes to SOUND QUEUE (measured on both models)', () => {
  // [SOUND arguments as pushed (defaults filled in), the nine bytes]
  const cases: [string, number[], string][] = [
    ['SOUND 1,200', [1, 200, 20, 12, 0, 0, 0], '01 00 00 c8 00 00 0c 14 00'],
    ['SOUND 1,200,50,10,2,3,4', [1, 200, 50, 10, 2, 3, 4], '01 02 03 c8 00 04 0a 32 00'],
    ['SOUND 2+8,100,-3,15,1', [10, 100, -3, 15, 1, 0, 0], '0a 01 00 64 00 00 0f fd ff'],
    ['SOUND 4+64,0,10,0', [68, 0, 10, 0, 0, 0, 0], '44 00 00 00 00 00 00 0a 00'],
    ['SOUND 2,4095,0,7', [2, 4095, 0, 7, 0, 0, 0], '02 00 00 ff 0f 00 07 00 00'],
    ['SOUND 4,1,100,1,15,15,31', [4, 1, 100, 1, 15, 15, 31], '04 0f 0f 01 00 1f 01 64 00'],
    ['SOUND 129,300', [129, 300, 20, 12, 0, 0, 0], '81 00 00 2c 01 00 0c 14 00'],
    ['SOUND 1,100,-32768', [1, 100, -32768, 12, 0, 0, 0], '01 00 00 64 00 00 0c 00 80'],
    ['SOUND 1,100,32767 (the longest note)', [1, 100, 32767, 12, 0, 0, 0], '01 00 00 64 00 00 0c ff 7f'],
  ];
  for (const [name, args, bytes] of cases) {
    it(name, () => {
      const calls = newCalls();
      const r = run(soundCall(args), calls);
      expect(calls.queue.map(hex)).toEqual([bytes]);
      expect(r.wordAt('spafter')).toBe(r.wordAt('ixsave')); // the arguments are gone
      expect(r.wordAt('ixafter')).toBe(0x4321); // IX survives the manager
    });
  }
  it('a full queue is waited out: the call is repeated until the manager takes the note', () => {
    const calls = newCalls();
    run(soundCall([1, 200, 20, 12, 0, 0, 0]), calls, { full: 3 });
    expect(calls.queue.map(hex)).toEqual(['01 00 00 c8 00 00 0c 14 00']);
  });
  it('the block lives in the private block, where the firmware can read it', () => {
    const calls = newCalls();
    let at = -1;
    const opts: Opts = {
      files,
      setup: (cpc: Cpc) => {
        sound(calls)(cpc);
        cpc.fw(0xbcaa, 'SOUND QUEUE', ['a', 'f', 'b', 'c', 'd', 'e', 'h', 'l'], (c, i) => {
          at = (i.h << 8) | i.l;
          c.f |= 1;
        });
      },
    };
    const r = runProgram({ body: soundCall([1, 200, 20, 12, 0, 0, 0]), include: ['loco/sound.asm'], heap: true }, opts);
    expect(r.stopped).toBe('rst0');
    expect(at).toBe(SOUND_BLK);
  });
});

describe('SOUND: arguments Locomotive refuses are error 5 (measured, p-sound-3.bas)', () => {
  const bad: [string, number[]][] = [
    ['channel 256', [256, 100, 1, 12, 0, 0, 0]],
    ['channel -1', [-1, 100, 1, 12, 0, 0, 0]],
    ['period -1', [1, -1, 1, 12, 0, 0, 0]],
    ['period 4096', [1, 4096, 1, 12, 0, 0, 0]],
    ['volume 16', [1, 100, 1, 16, 0, 0, 0]],
    ['volume -1', [1, 100, 1, -1, 0, 0, 0]],
    ['volume envelope 16', [1, 100, 1, 0, 16, 0, 0]],
    ['volume envelope -1', [1, 100, 1, 0, -1, 0, 0]],
    ['tone envelope 16', [1, 100, 1, 0, 0, 16, 0]],
    ['tone envelope -1', [1, 100, 1, 0, 0, -1, 0]],
    ['noise 32', [1, 100, 1, 0, 0, 0, 32]],
    ['noise -1', [1, 100, 1, 0, 0, 0, -1]],
  ];
  for (const [name, args] of bad) {
    it(name, () => {
      const calls = newCalls();
      const r = runProgram({ body: soundCall(args), include: ['loco/sound.asm'], heap: true }, env(calls));
      expect(r.stopped).toBe('rst0');
      expect(r.printer).toContain('Error 5');
      expect(calls.queue).toEqual([]);
    });
  }
  it('channel 0 and the limits themselves are accepted', () => {
    const calls = newCalls();
    run(soundCall([0, 0, 0, 0, 0, 0, 0]) + soundCall([255, 4095, 0, 15, 15, 15, 31]), calls);
    expect(calls.queue.map(hex)).toEqual(['00 00 00 00 00 00 00 00 00', 'ff 0f 0f ff 0f 1f 0f 00 00']);
  });
});

describe('ENV and ENT: the block BASIC passes to SOUND AMPL ENVELOPE and SOUND TONE ENVELOPE (measured)', () => {
  // [statement, number, values after it, hardware mask, A the firmware gets, the bytes that matter]
  const cases: [string, 'ENV' | 'ENT', number, number[], number, number, string][] = [
    ['ENV 1,10,2,5', 'ENV', 1, [10, 2, 5], 0, 1, '01 0a 02 05'],
    ['ENV 2,5,1,2,3,-1,10', 'ENV', 2, [5, 1, 2, 3, -1, 10], 0, 2, '02 05 01 02 03 ff 0a'],
    ['ENV 3,(5 sections)', 'ENV', 3, [5, 15, 1, 5, 0, 0, 5, 1, 1, 3, 3, 3, 5, 5, 1], 0, 3, '05 05 0f 01 05 00 00 05 01 01 03 03 03 05 05 01'],
    ['ENV 4,=9,500', 'ENV', 4, [9, 500], 1, 4, '01 89 f4 01'],
    ['ENV 5,10,1,5,=10,300', 'ENV', 5, [10, 1, 5, 10, 300], 2, 5, '02 0a 01 05 8a 2c 01'],
    ['ENV 15,127,15,255', 'ENV', 15, [127, 15, 255], 0, 15, '01 7f 0f ff'],
    ['ENV 7,100,-1,3', 'ENV', 7, [100, -1, 3], 0, 7, '01 64 ff 03'],
    ['ENV 6,0,0,0', 'ENV', 6, [0, 0, 0], 0, 6, '01 00 00 00'],
    ['ENV 1,=15,65535', 'ENV', 1, [15, 65535], 1, 1, '01 8f ff ff'],
    ['ENV 1,=1,-1 (-1 is 65535)', 'ENV', 1, [1, -1], 1, 1, '01 81 ff ff'],
    ['ENT 1,10,2,5', 'ENT', 1, [10, 2, 5], 0, 1, '01 0a 02 05'],
    ['ENT -2,5,1,2,3,-1,10 (repeat: bit 7 of the count)', 'ENT', -2, [5, 1, 2, 3, -1, 10], 0, 2, '82 05 01 02 03 ff 0a'],
    ['ENT 3,=200,20', 'ENT', 3, [200, 20], 1, 3, '01 f0 c8 14'],
    ['ENT 4,239,-128,255', 'ENT', 4, [239, -128, 255], 0, 4, '01 ef 80 ff'],
    ['ENT 5,10,-3,4,=100,7,5,5,5', 'ENT', 5, [10, -3, 4, 100, 7, 5, 5, 5], 2, 5, '03 0a fd 04 f0 64 07 05 05 05'],
    ['ENT -15,1,1,1', 'ENT', -15, [1, 1, 1], 0, 15, '81 01 01 01'],
    ['ENT 1,=4095,255', 'ENT', 1, [4095, 255], 1, 1, '01 ff ff ff'],
  ];
  for (const [name, entry, n, values, mask, a, bytes] of cases) {
    it(name, () => {
      const calls = newCalls();
      const r = run(envCall(entry, n, values, mask), calls);
      const got = (entry === 'ENV' ? calls.env : calls.ent)[0];
      expect(entry === 'ENV' ? calls.ent : calls.env).toEqual([]);
      expect(got?.a).toBe(a);
      expect(hex(got?.block.slice(0, bytes.split(' ').length) ?? [])).toBe(bytes);
      expect(r.wordAt('spafter')).toBe(r.wordAt('ixsave'));
      expect(r.wordAt('ixafter')).toBe(0x4321);
    });
  }
  it('no sections: a count of 0', () => {
    const calls = newCalls();
    run(envCall('ENV', 1, []), calls);
    expect(calls.env[0]?.block[0]).toBe(0);
  });
});

describe('ENV and ENT: arguments Locomotive refuses are error 5 (measured, p-sound-3.bas)', () => {
  const bad: [string, 'ENV' | 'ENT', number, number[], number][] = [
    ['ENV 0', 'ENV', 0, [1, 1, 1], 0],
    ['ENV 16', 'ENV', 16, [1, 1, 1], 0],
    ['ENV -1', 'ENV', -1, [1, 1, 1], 0],
    ['ENV steps 128', 'ENV', 1, [128, 1, 1], 0],
    ['ENV steps -1', 'ENV', 1, [-1, 1, 1], 0],
    ['ENV size -129', 'ENV', 1, [1, -129, 1], 0],
    ['ENV size 128', 'ENV', 1, [1, 128, 1], 0],
    ['ENV pause 256', 'ENV', 1, [1, 1, 256], 0],
    ['ENV pause -1', 'ENV', 1, [1, 1, -1], 0],
    ['ENV =16,1', 'ENV', 1, [16, 1], 1],
    ['ENV =-1,1', 'ENV', 1, [-1, 1], 1],
    ['ENT 0', 'ENT', 0, [1, 1, 1], 0],
    ['ENT 16', 'ENT', 16, [1, 1, 1], 0],
    ['ENT -16', 'ENT', -16, [1, 1, 1], 0],
    ['ENT steps 240', 'ENT', 1, [240, 1, 1], 0],
    ['ENT size -129', 'ENT', 1, [1, -129, 1], 0],
    ['ENT pause 256', 'ENT', 1, [1, 1, 256], 0],
    ['ENT =4096,1', 'ENT', 1, [4096, 1], 1],
    ['ENT =-1,1', 'ENT', 1, [-1, 1], 1],
    ['ENT =1,256', 'ENT', 1, [1, 256], 1],
  ];
  for (const [name, entry, n, values, mask] of bad) {
    it(name, () => {
      const calls = newCalls();
      const r = runProgram({ body: envCall(entry, n, values, mask), include: ['loco/sound.asm'], heap: true }, env(calls));
      expect(r.stopped).toBe('rst0');
      expect(r.printer).toContain('Error 5');
      expect(calls.env).toEqual([]);
      expect(calls.ent).toEqual([]);
    });
  }
});

describe('RELEASE and SQ', () => {
  it('RELEASE passes the channel mask 0..7 in A', () => {
    const calls = newCalls();
    const r = run(' ld hl,1\n call .core.__LOCO_RELEASE\n ld hl,7\n call .core.__LOCO_RELEASE\n ld hl,0\n call .core.__LOCO_RELEASE\n', calls);
    expect(calls.release).toEqual([1, 7, 0]);
    expect(r.wordAt('ixafter')).toBe(0x4321);
  });
  for (const v of [8, 255, 256, 0xffff]) {
    it(`RELEASE ${v > 255 ? v - 0x10000 : v} is error 5`, () => {
      const calls = newCalls();
      const r = runProgram({ body: ` ld hl,${v}\n call .core.__LOCO_RELEASE`, include: ['loco/sound.asm'], heap: true }, env(calls));
      expect(r.printer).toContain('Error 5');
      expect(calls.release).toEqual([]);
    });
  }
  it('SQ(1), SQ(2) and SQ(4) return the status SOUND CHECK gives, in HL', () => {
    for (const ch of [1, 2, 4]) {
      const calls = newCalls();
      const r = run(` ld hl,${ch}\n call .core.__LOCO_SQ\n ld (rsq),hl\n`, calls, { status: 0xc3 });
      expect(calls.check).toEqual([ch]);
      expect(r.wordAt('rsq')).toBe(0xc3);
    }
  });
  for (const ch of [0, 3, 5, 7, 8, 256, 0xffff]) {
    it(`SQ(${ch > 256 ? ch - 0x10000 : ch}) is error 5`, () => {
      const calls = newCalls();
      const r = runProgram({ body: ` ld hl,${ch}\n call .core.__LOCO_SQ`, include: ['loco/sound.asm'], heap: true }, env(calls));
      expect(r.printer).toContain('Error 5');
      expect(calls.check).toEqual([]);
    });
  }
});
