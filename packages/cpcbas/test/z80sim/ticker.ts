/**
 * The firmware's ticker, faked for the test Z80 (moved out of event-run.test.ts by R15 so that the file tests can use it):
 * KL ADD TICKER / KL DEL TICKER / KL INIT EVENT of the firmware guide (SOFT968 "Kernel": the tick list, one tick per six
 * 300 Hz interrupts; a block whose count reaches 0 kicks its event, is recharged from its recharge count, and is removed when
 * that is 0; the event routine of an asynchronous far event is called with interrupts on), and TXT STR SELECT.
 */
import { FirmwareContractError } from './cpc.js';
import type { Cpc } from './cpc.js';

const SENTINEL = 0xb8f0; // where an event routine returns to (hooked, never executed)

/** The firmware's ticker, faked: a tick list in memory, driven by the CPU's 300 Hz interrupt. */
export class FakeTicker {
  readonly chain: number[] = [];
  irqs = 0;
  ticks = 0;
  kicks: number[] = []; // the order in which event routines were called (tick block addresses)
  /** The selected text stream (the machine's own: TXT STR SELECT sets it). */
  get stream(): number {
    return this.cpc.stream;
  }
  set stream(n: number) {
    this.cpc.stream = n;
  }
  /** The frame-flyback event chain (KL NEW/ADD/DEL FRAME FLY): event block addresses, in the order they were added. */
  readonly frameChain: number[] = [];
  /** Frame flybacks seen (one per six 300 Hz interrupts: 50 Hz in the sim's time base). */
  frames = 0;
  frameKicks: number[] = [];
  readonly streamCalls: number[] = []; // the A of every TXT STR SELECT call
  private busy = false;
  constructor(private readonly cpc: Cpc) {
    const cpu = cpc.cpu;
    cpc.hook(SENTINEL, (c) => {
      c.stop = 'evdone';
    });
    cpc.fw(0xbcef, 'KL INIT EVENT', ['a', 'f', 'b', 'c', 'd', 'e', 'h', 'l'], (c, i) => {
      const blk = (i.h << 8) | i.l;
      cpu.ww(blk, 0); // chain
      cpu.wb(blk + 2, 0); // count
      cpu.wb(blk + 3, i.b); // class
      cpu.ww(blk + 4, (i.d << 8) | i.e); // routine
      cpu.wb(blk + 6, i.c); // ROM select
      void c;
    });
    // Frame flyback events (SOFT968 "Kernel"): the block is the event block itself (chain 0, count 2, class 3, routine 4, ROM select 6).
    // KL NEW FRAME FLY initialises it (as KL INIT EVENT) and adds it; KL ADD FRAME FLY adds an initialised one; KL DEL FRAME FLY removes
    // one (Carry true when it was on the chain). The routine runs once per frame, asynchronously, with interrupts on.
    cpc.fw(0xbcd7, 'KL NEW FRAME FLY', ['a', 'f', 'b', 'c', 'd', 'e', 'h', 'l'], (_c, i) => {
      const blk = (i.h << 8) | i.l;
      cpu.ww(blk, 0);
      cpu.wb(blk + 2, 0);
      cpu.wb(blk + 3, i.b);
      cpu.ww(blk + 4, (i.d << 8) | i.e);
      cpu.wb(blk + 6, i.c);
      this.frameChain.push(blk);
    });
    cpc.fw(0xbcda, 'KL ADD FRAME FLY', ['a', 'f', 'h', 'l'], (_c, i) => {
      this.frameChain.push((i.h << 8) | i.l);
    });
    cpc.fw(0xbcdd, 'KL DEL FRAME FLY', ['a', 'f', 'h', 'l'], (c, i) => {
      const at = this.frameChain.indexOf((i.h << 8) | i.l);
      if (at >= 0) this.frameChain.splice(at, 1);
      c.f = at >= 0 ? c.f | 1 : c.f & ~1;
    });
    cpc.fw(0xbce9, 'KL ADD TICKER', ['a', 'f', 'b', 'c', 'd', 'e', 'h', 'l'], (_c, i) => {
      const blk = (i.h << 8) | i.l;
      cpu.ww(blk + 2, (i.d << 8) | i.e);
      cpu.ww(blk + 4, (i.b << 8) | i.c);
      this.chain.push(blk);
    });
    cpc.fw(0xbcec, 'KL DEL TICKER', ['a', 'f', 'b', 'c', 'h', 'l', 'd', 'e'], (c, i) => {
      const blk = (i.h << 8) | i.l;
      const at = this.chain.indexOf(blk);
      if (at < 0) {
        c.f &= ~1;
        return;
      }
      this.chain.splice(at, 1);
      c.de = cpu.rw(blk + 2);
      c.f |= 1;
    });
    cpc.fw(0xbbb4, 'TXT STR SELECT', ['f', 'h', 'l'], (c, i) => {
      c.a = this.cpc.stream;
      this.cpc.stream = i.a & 7;
      this.streamCalls.push(i.a);
    });
    // the machine's interrupt handler (its contract checks and count) runs after the tick
    for (const a of [0xb939, 0xb941]) {
      const base = cpu.hooks[a];
      cpu.hooks[a] = (c) => {
        this.irqs++;
        if (!this.busy && this.irqs % 6 === 0) {
          this.tick(c);
          this.frame(c);
        }
        if (base !== undefined) base(c);
        else {
          c.iff1 = true;
          c.iff2 = true;
          c.ret();
        }
      };
    }
  }

  private frame(c: Cpc['cpu']): void {
    this.frames++;
    for (const blk of [...this.frameChain]) {
      this.frameKicks.push(blk);
      this.callRoutine(c, c.rw(blk + 4));
    }
  }

  private tick(c: Cpc['cpu']): void {
    this.ticks++;
    const due: number[] = [];
    for (const blk of [...this.chain]) {
      const count = c.rw(blk + 2) - 1;
      if (count > 0) {
        c.ww(blk + 2, count);
        continue;
      }
      const recharge = c.rw(blk + 4);
      if (recharge > 0) c.ww(blk + 2, recharge);
      else this.chain.splice(this.chain.indexOf(blk), 1);
      due.push(blk);
    }
    for (const blk of due) {
      this.kicks.push(blk);
      this.callRoutine(c, c.rw(blk + 10));
    }
  }

  /** Runs an asynchronous event routine to its RET (interrupts on, as the firmware measures), then resumes. */
  private callRoutine(c: Cpc['cpu'], routine: number): void {
    const r = Uint8Array.from(c.r);
    const r2 = Uint8Array.from(c.r2);
    const saved = { pc: c.pc, sp: c.sp, ix: c.ix, iy: c.iy, iff1: c.iff1, iff2: c.iff2 };
    this.busy = true;
    c.sp = (c.sp - 2) & 0xffff;
    c.ww(c.sp, SENTINEL);
    c.pc = routine;
    c.iff1 = true;
    c.stop = null;
    for (let guard = 0; c.stop === null && guard < 2_000_000; guard++) c.step();
    if (c.stop !== 'evdone') throw new FirmwareContractError(`an event routine did not return (stopped: ${String(c.stop)})`);
    c.stop = null;
    this.busy = false;
    c.r.set(r);
    c.r2.set(r2);
    Object.assign(c, saved);
  }
}
