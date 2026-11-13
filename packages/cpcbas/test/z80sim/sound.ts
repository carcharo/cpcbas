/**
 * A fake firmware sound manager for the test Z80 (L4-SOUND): SOUND QUEUE &BCAA, SOUND CHECK &BCAD,
 * SOUND RELEASE &BCB3, SOUND AMPL ENVELOPE &BCBC and SOUND TONE ENVELOPE &BCBF record what they are given.
 * Register contracts as the Firmware Guide (SOFT968): every register but the stack pointer is corrupt after
 * each call, and IX is left at junk, so a caller that relies on them fails here as on a real machine.
 */
import type { Cpc } from './cpc.js';

export interface Calls {
  queue: number[][];
  release: number[];
  env: { a: number; block: number[] }[];
  ent: { a: number; block: number[] }[];
  check: number[];
}

/** A fake sound manager: records what it is given (a full queue can be simulated by `full`). */
export function sound(calls: Calls, opts: { full?: number; status?: number } = {}) {
  let refused = opts.full ?? 0;
  return (cpc: Cpc): void => {
    const all = ['a', 'f', 'b', 'c', 'd', 'e', 'h', 'l'] as const;
    cpc.fw(0xbcaa, 'SOUND QUEUE', [...all], (c, i) => {
      if (refused > 0) {
        refused--;
        c.f &= ~1;
      } else {
        calls.queue.push(Array.from(c.mem.slice((i.h << 8) | i.l, ((i.h << 8) | i.l) + 9)));
        c.f |= 1;
      }
      c.ix = 0x1234; // the sound manager corrupts IX
    });
    cpc.fw(0xbcb3, 'SOUND RELEASE', [...all], (_c, i) => {
      calls.release.push(i.a);
    });
    cpc.fw(0xbcad, 'SOUND CHECK', [...all], (c, i) => {
      calls.check.push(i.a);
      c.a = opts.status ?? 0x84;
    });
    const envelope = (list: Calls['env']) => (c: Cpc['cpu'], i: { a: number; h: number; l: number }) => {
      const at = (i.h << 8) | i.l;
      list.push({ a: i.a, block: Array.from(c.mem.slice(at, at + 16)) });
      c.ix = 0x1234;
    };
    cpc.fw(0xbcbc, 'SOUND AMPL ENVELOPE', [...all], envelope(calls.env));
    cpc.fw(0xbcbf, 'SOUND TONE ENVELOPE', [...all], envelope(calls.ent));
  };
}


export const newCalls = (): Calls => ({ queue: [], release: [], env: [], ent: [], check: [] });

// ---------------------------------------------------------------------------
// The default sound manager of the fake CPC: three channels with queues, hold, rendezvous, flush and release
// ---------------------------------------------------------------------------

/** T-states in 1/100 s (the 4 MHz clock). */
const CS = 40_000;

interface Note {
  hold: boolean;
  /** Channels (bit 0 = A) the note waits to meet. */
  meet: number;
  /** Length in 1/100 s (0 or negative: one second, the envelope is not modelled). */
  cs: number;
}

/**
 * The firmware sound manager as far as SQ, SOUND, RELEASE and the envelope calls show it (Firmware Guide, SOUND QUEUE,
 * SOUND CHECK, SOUND RELEASE; the states match what the interpreter reported, tests/loco/sound.bas): each channel has a
 * queue of four notes behind the one playing; a note starts when it is at the head, not held, and every channel it
 * waits to meet has a note waiting for it; it plays for its duration in T-states of the fake CPU. Nothing is heard or
 * written to the AY. Envelope calls are accepted and ignored.
 */
export class SoundManager {
  private readonly queue: Note[][] = [[], [], []];
  private readonly until: number[] = [-1, -1, -1];
  private readonly playing: boolean[] = [false, false, false];

  /** Brings the channels up to date at time `t` (T-states). */
  private advance(t: number): void {
    for (let ch = 0; ch < 3; ch++) if (this.playing[ch] && t >= (this.until[ch] as number)) this.playing[ch] = false;
    for (let moved = true; moved; ) {
      moved = false;
      for (let ch = 0; ch < 3; ch++) {
        const head = (this.queue[ch] as Note[])[0];
        if (this.playing[ch] || head === undefined || head.hold) continue;
        let ready = true;
        for (let other = 0; other < 3; other++) {
          if (!(head.meet & (1 << other))) continue;
          const there = (this.queue[other] as Note[])[0];
          if (this.playing[other] || there === undefined || there.hold || !(there.meet & (1 << ch))) ready = false;
        }
        if (!ready) continue;
        const group = [ch, ...[0, 1, 2].filter((o) => head.meet & (1 << o))];
        for (const g of group) {
          const note = (this.queue[g] as Note[]).shift() as Note;
          this.playing[g] = true;
          this.until[g] = t + (note.cs > 0 ? note.cs : 100) * CS;
        }
        moved = true;
      }
    }
  }

  /** SOUND QUEUE: false when a selected channel's queue is full (nothing is queued then). */
  queueNote(block: readonly number[], t: number): boolean {
    this.advance(t);
    const status = block[0] as number;
    const channels = [0, 1, 2].filter((c) => status & (1 << c));
    if (channels.some((c) => !(status & 0x80) && (this.queue[c] as Note[]).length >= 4)) return false;
    const duration = ((block[7] as number) | ((block[8] as number) << 8)) << 16 >> 16;
    for (const c of channels) {
      if (status & 0x80) {
        this.queue[c] = [];
        this.playing[c] = false;
      }
      (this.queue[c] as Note[]).push({ hold: (status & 0x40) !== 0, meet: (status >> 3) & 7, cs: duration });
    }
    this.advance(t);
    return true;
  }

  /** SOUND RELEASE: the channels in the mask stop holding. */
  release(mask: number, t: number): void {
    for (let c = 0; c < 3; c++) {
      const head = (this.queue[c] as Note[])[0];
      if (mask & (1 << c) && head !== undefined) head.hold = false;
    }
    this.advance(t);
  }

  /** SOUND CHECK: free entries (bits 0-2), the channels the head waits for (bits 3-5), held (bit 6), playing (bit 7). */
  check(mask: number, t: number): number {
    this.advance(t);
    const c = mask & 4 ? 2 : mask & 2 ? 1 : 0;
    const q = this.queue[c] as Note[];
    const head = q[0];
    let a = 4 - q.length;
    if (head !== undefined) a |= (head.hold ? 0x40 : 0) | (head.meet << 3);
    if (this.playing[c]) a |= 0x80;
    return a;
  }
}

/** Installs the default sound manager; returns it. Sound entries a test hooks afterwards replace these. */
export function installSoundManager(cpc: Cpc): SoundManager {
  const mgr = new SoundManager();
  const all = ['a', 'f', 'b', 'c', 'd', 'e', 'h', 'l'] as const;
  cpc.fw(0xbcaa, 'SOUND QUEUE', [...all], (c, i) => {
    const at = (i.h << 8) | i.l;
    const ok = mgr.queueNote(Array.from(c.mem.slice(at, at + 9)), c.t);
    c.f = (c.f & ~1) | (ok ? 1 : 0);
    c.ix = 0x1234;
  });
  cpc.fw(0xbcad, 'SOUND CHECK', [...all], (c, i) => {
    c.a = mgr.check(i.a, c.t);
  });
  cpc.fw(0xbcb3, 'SOUND RELEASE', [...all], (c, i) => {
    mgr.release(i.a, c.t);
  });
  for (const [address, name] of [
    [0xbcbc, 'SOUND AMPL ENVELOPE'],
    [0xbcbf, 'SOUND TONE ENVELOPE'],
  ] as const) {
    cpc.fw(address, name, [...all], (c) => {
      c.ix = 0x1234;
      c.f |= 1;
    });
  }
  return mgr;
}
