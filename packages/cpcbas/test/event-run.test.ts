/**
 * L4-EVENTS: EVERY, AFTER, REMAIN, DI, EI, TIME on the test Z80 with a fake firmware ticker.
 *
 * The fake ticker (`FakeTicker`) is the firmware's KL ADD TICKER / KL DEL TICKER / KL INIT EVENT of the
 * firmware guide (SOFT968 "Kernel": the tick list, one tick per six 300 Hz interrupts; a block whose count
 * reaches 0 kicks its event, is recharged from its recharge count, and is removed when that is 0; the event
 * routine of an asynchronous far event is called with interrupts on). Expected values come from the manual,
 * the interpreter's measured transcripts ("EVERY, AFTER, REMAIN, DI, EI, TIME"
 * and tests/loco/timer.expected) and the specification, never from cpcbas's own output.
 */
import { describe, expect, it } from 'vitest';
import { buildSource, lowerSource, normalise, runSource } from './compile-helper.js';
import type { Cpc } from './z80sim/cpc.js';
import { FakeTicker } from './z80sim/ticker.js';
import { assembleAndRun, repoRoot, runProgram } from './z80sim/run.js';
import type { AssembleOptions, AssembledRun, RunOptions } from './z80sim/run.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const files: Record<string, string> = {};
for (const f of readdirSync(join(repoRoot, 'lib/loco')).filter((n) => n.endsWith('.asm'))) files[`loco/${f}`] = readFileSync(join(repoRoot, 'lib/loco', f), 'latin1');

interface EvRun extends AssembledRun {
  ticker: FakeTicker;
  built: ReturnType<typeof buildSource>;
}

function run(source: string, maxTStates = 60_000_000): EvRun {
  let ticker: FakeTicker | undefined;
  const r = runSource(source, {
    maxTStates,
    setup: (cpc) => {
      ticker = new FakeTicker(cpc);
    },
  });
  expect(r.built.diagnostics.filter((d) => d.startsWith('E'))).toEqual([]);
  return Object.assign(r, { ticker: ticker as FakeTicker });
}

const text = (r: EvRun): string => {
  expect(r.stopped).toBe('rst0');
  return normalise(r.printer) as string;
};

describe('EVERY and AFTER with the firmware ticker', () => {
  it('EVERY runs its handler again and again; REMAIN stops the timer', () => {
    const src = [
      '10 EVERY 2 GOSUB 100',
      '20 WHILE n < 4 : WEND',
      '30 r = REMAIN(0)',
      '40 PRINT n; (r > 0) AND (r <= 2); REMAIN(0)',
      '50 m = n : t = TIME : WHILE TIME - t < 60 : WEND',
      '60 PRINT m = n',
      '70 END',
      '100 n = n + 1',
      '110 RETURN',
    ].join('\n');
    // n = 4 when the loop ends (the handler ran four times, one per two ticks); REMAIN gave 1..2 the first
    // time and 0 once the timer is stopped; nothing runs afterwards
    expect(text(run(src))).toBe(' 4 -1  0 \n-1 \n');
  });

  it('AFTER runs once; REMAIN of a timer that has fired is 0', () => {
    const src = [
      '10 AFTER 3 GOSUB 100',
      '20 t = TIME : WHILE TIME - t < 120 : WEND',
      '30 PRINT n; REMAIN(0)',
      '40 END',
      '100 n = n + 1',
      '110 RETURN',
    ].join('\n');
    expect(text(run(src))).toBe(' 1  0 \n');
  });

  it('the first event arrives after n ticks, not before', () => {
    const src = [
      '10 AFTER 5 GOSUB 100',
      '20 t = TIME : WHILE TIME - t < 5 * 6 - 8 : WEND',
      '30 PRINT n',
      '40 WHILE n = 0 : WEND',
      '50 PRINT n',
      '60 END',
      '100 n = n + 1',
      '110 RETURN',
    ].join('\n');
    // 5 ticks are 30 / 300 s; at 22 / 300 s the handler has not run, afterwards it does
    expect(text(run(src))).toBe(' 0 \n 1 \n');
  });

  it('a new EVERY or AFTER replaces what the timer did; n = 0 stops it', () => {
    const src = [
      '10 EVERY 1 GOSUB 100',
      '20 AFTER 1000 GOSUB 200',
      '30 t = TIME : WHILE TIME - t < 60 : WEND',
      '40 PRINT a; b',
      '50 EVERY 1 GOSUB 100',
      '60 EVERY 0 GOSUB 100',
      '70 t = TIME : WHILE TIME - t < 60 : WEND',
      '80 c = a : t = TIME : WHILE TIME - t < 60 : WEND',
      '90 PRINT c = a; REMAIN(0)',
      '95 END',
      '100 a = a + 1',
      '110 RETURN',
      '200 b = b + 1',
      '210 RETURN',
    ].join('\n');
    // timer 0 was AFTER 1000 by line 20, so the EVERY 1 of line 10 never ran; EVERY 0 stops the new one
    expect(text(run(src))).toBe(' 0  0 \n-1  0 \n');
  });

  it('timer and interval errors are error 5', () => {
    const cases = ['AFTER 10, 4 GOSUB 100', 'AFTER 10, -1 GOSUB 100', 'AFTER -1 GOSUB 100', 'PRINT REMAIN(4)', 'PRINT REMAIN(-1)'];
    for (const c of cases) {
      const r = run(['10 ' + c, '20 PRINT "no"', '30 END', '100 RETURN'].join('\n'));
      // the fatal error ends the program with "Error 5"
      expect(r.printer, c).toContain('Error 5');
      expect(r.printer, c).not.toContain('no');
    }
  });
});

describe('tests/loco/timer.bas, the blessed interpreter transcript, on the simulator with the fake ticker', () => {
  it('prints what the interpreter printed', () => {
    const src = readFileSync(join(repoRoot, 'tests/loco/timer.bas'), 'latin1');
    const want = readFileSync(join(repoRoot, 'tests/loco/timer.expected'), 'latin1');
    const r = run(src, 400_000_000);
    expect(text(r)).toBe(want);
  });
});

describe('tests/loco/err-event.bas (R14, follow-up 86): an error trapped inside an event handler', () => {
  it('prints what the interpreter printed: RESUME NEXT returns into the handler, a GOTO out leaves its priority set', () => {
    const src = readFileSync(join(repoRoot, 'tests/loco/err-event.bas'), 'latin1');
    const want = readFileSync(join(repoRoot, 'tests/loco/err-event.expected'), 'latin1');
    expect(text(run(src, 400_000_000))).toBe(want);
  });
});

describe('priorities, DI and EI (the interpreter transcript of tests/loco/probes/p-ev4.bas)', () => {
  const HEAD = 'PRINT "~" ';
  void HEAD;
  /** Busy-waits for `k` / 300 s from inside a handler. */
  const spin = (k: number): string => `t0 = TIME : WHILE TIME - t0 < ${k} : WEND`;

  it('a handler is interrupted only by a higher timer; lower ones wait for its RETURN', () => {
    const src = [
      '10 AFTER 5,0 GOSUB 500',
      '20 AFTER 10,1 GOSUB 600',
      '30 AFTER 15,3 GOSUB 700',
      '40 AFTER 20,2 GOSUB 800',
      '50 t = TIME : WHILE TIME - t < 600 : WEND',
      '60 PRINT "main done"',
      '70 END',
      `500 PRINT "t0 start" : ${spin(150)} : PRINT "t0 end" : RETURN`,
      `600 PRINT "t1 start" : ${spin(50)} : PRINT "t1 end" : RETURN`,
      `700 PRINT "t3 start" : ${spin(20)} : PRINT "t3 end" : RETURN`,
      `800 PRINT "t2 start" : ${spin(20)} : PRINT "t2 end" : RETURN`,
    ].join('\n');
    // t0 runs from tick 5; t1 (tick 10) and then t3 (tick 15) interrupt it; t2 (tick 20) interrupts t1 but not t3;
    // when t3 returns, t2 (pending, above t1) runs; then t1 and t0 finish. The order the interpreter printed.
    expect(text(run(src))).toBe(
      ['t0 start', 't1 start', 't3 start', 't3 end', 't2 start', 't2 end', 't1 end', 't0 end', 'main done'].join('\n') + '\n',
    );
  });

  it('DI inside a handler holds a higher timer until the RETURN; EI inside one lets it run', () => {
    const src = [
      `10 AFTER 5,0 GOSUB 900`,
      '20 t = TIME : WHILE TIME - t < 150 : WEND',
      `30 AFTER 5,1 GOSUB 950`,
      '40 t = TIME : WHILE TIME - t < 150 : WEND',
      '50 PRINT "end"',
      '60 END',
      `700 PRINT "t3 start" : PRINT "t3 end" : RETURN`,
      `900 PRINT "d0 start" : DI : AFTER 3,3 GOSUB 700 : ${spin(90)} : PRINT "d0 end" : RETURN`,
      `950 PRINT "d1 start" : EI : PRINT "d1 end" : RETURN`,
    ].join('\n');
    expect(text(run(src))).toBe(['d0 start', 'd0 end', 't3 start', 't3 end', 'd1 start', 'd1 end', 'end'].join('\n') + '\n');
  });

  it('events that arrive during DI are remembered and all run after EI (measured: 16 after EVERY 10 over 3 s)', () => {
    const src = [
      '10 EVERY 2 GOSUB 100',
      '20 DI',
      '30 t = TIME : WHILE TIME - t < 120 : WEND',
      '40 PRINT n',
      '50 EI',
      '60 PRINT n > 8',
      '70 END',
      '100 n = n + 1',
      '110 RETURN',
    ].join('\n');
    // 120 / 300 s = 20 ticks = 10 periods of 2; none runs under DI, all of them after EI
    expect(text(run(src))).toBe(' 0 \n-1 \n');
  });

  it('the pending count is capped at 127, as the kernel count', () => {
    const src = ['10 EVERY 1 GOSUB 100', '20 DI', '30 t = TIME : WHILE TIME - t < 1200 : WEND', '40 n = 0 : EI', '50 PRINT n', '60 END', '100 n = n + 1', '110 RETURN'].join('\n');
    // 1200 / 300 s = 200 ticks of EVERY 1: only 127 are remembered, and a few more arrive while they run
    const r = run(src);
    const n = Number(text(r).trim());
    expect(n).toBeGreaterThanOrEqual(127);
    expect(n).toBeLessThan(135);
  });
});

describe('follow-up 39: a timer that fires inside a procedure called in a main-program MIN', () => {
  it('does not corrupt the interrupted MIN while the handler computes another one', () => {
    const src = [
      'DIM a AS INTEGER, c AS INTEGER, d AS INTEGER, x AS INTEGER, y AS INTEGER, ran AS INTEGER, seen AS INTEGER',
      'FUNCTION F() AS INTEGER',
      '  DIM t0 AS ULONG',
      '  t0 = TIME',
      '  WHILE TIME - t0 < 90',
      '    ran = ran + 0',
      '  WEND',
      '  seen = ran',
      '  RETURN 30',
      'END FUNCTION',
      'a = 5 : c = 70 : d = 20',
      'EVERY 2 GOSUB 100',
      'x = MIN(a + 1, F())',
      'PRINT x; y; (seen > 0)',
      'END',
      '100 y = MIN(c + 1, d + 2)',
      '110 ran = ran + 1',
      '120 RETURN',
    ].join('\n');
    // MIN(6, 30) = 6; the handler's MIN(71, 22) = 22 ran several times while F waited. F's result is above both
    // spilled operands (R14), so a shared slot would show: the handler's 71 in place of the 6 gives MIN(71, 30) = 30
    expect(text(run(src))).toBe(' 6  22 -1 \n');
  });
});

describe('EVERY in a procedure (R14, after L4-ERR and L4-EVENTS merged)', () => {
  it('a timer set in a SUB runs its main-program handler, and REMAIN in another SUB stops it', () => {
    const src = [
      'DIM n AS INTEGER, r AS INTEGER',
      'SUB StartTimer()',
      '  EVERY 2, 1 GOSUB 100',
      'END SUB',
      'SUB StopTimer()',
      '  r = REMAIN(1)',
      'END SUB',
      '10 StartTimer()',
      '20 WHILE n < 3 : WEND',
      '30 StopTimer()',
      '40 m = n : t = TIME : WHILE TIME - t < 60 : WEND',
      '50 PRINT n >= 3; m = n; (r > 0) AND (r <= 2)',
      '60 END',
      '100 n = n + 1',
      '110 RETURN',
    ].join('\n');
    expect(text(run(src))).toBe('-1 -1 -1 \n');
  });
});

describe('what the compiler emits', () => {
  it('only a program with EVERY or AFTER gets the poll; DI, EI, REMAIN and TIME alone do not', () => {
    const plain = buildSource('10 DI : EI : t = TIME : PRINT REMAIN(0) : PRINT t').asm;
    expect(plain).not.toContain('__EVENT_POLL');
    expect(plain).toContain('__LOCO_DI');
    const withEvery = buildSource('10 EVERY 5 GOSUB 100\n20 PRINT 1\n30 END\n100 RETURN').asm;
    // one poll before each of the four statements of the main program (EVERY, PRINT, END, RETURN)
    expect(withEvery.match(/call \.core\.__EVENT_POLL/g)?.length).toBe(4);
    const none = buildSource('10 PRINT 1').asm;
    expect(none).not.toContain('__EVENT_POLL');
    expect(none).not.toContain('event.asm');
  });

  it('procedures poll too, and an EVERY in a procedure with a main-program target compiles (the handler jump kind, L4-ERR)', () => {
    const polls = buildSource(['SUB S()', '  PRINT 1', '  PRINT 2', 'END SUB', '10 EVERY 5 GOSUB 100', '20 S()', '30 END', '100 RETURN'].join('\n')).asm;
    expect(polls.match(/call \.core\.__EVENT_POLL/g)?.length).toBe(6);
    const low = lowerSource(['SUB S()', '  EVERY 5 GOSUB 100', 'END SUB', '10 S()', '20 END', '100 RETURN'].join('\n'));
    expect(low.diagnostics.filter((d) => d.startsWith('E'))).toEqual([]);
  });

  it('the bare table and the code table agree: DI, EI, EVERY, AFTER, REMAIN and TIME are compiled in bare builds too', () => {
    const src = '10 EVERY 5 GOSUB 100\n20 PRINT REMAIN(0), TIME\n30 END\n100 RETURN';
    const bare = buildSource(src, { CPC_BAREMETAL: '1' });
    expect(bare.diagnostics.filter((d) => d.startsWith('E'))).toEqual([]);
    expect(bare.asm).toContain('#include once <loco/event.asm>');
    expect(bare.defines.has('CPC_BAREMETAL')).toBe(true);
  });
});


// ---------------------------------------------------------------------------
// The runtime on its own: costs, the dispatcher's saved state, and the bare build
// ---------------------------------------------------------------------------

const BARE = { priv: 48128 };
const slot = (priv: number, off: number): number => priv + off;

/** A firmware-mode program that includes lib/loco/event.asm (and a log routine the handlers use). */
function fwAsm(body: string, data = '', setup?: (cpc: Cpc, t: FakeTicker) => void): AssembledRun & { ticker: FakeTicker } {
  let ticker: FakeTicker | undefined;
  const options: RunOptions & AssembleOptions = {
    files,
    irqInterval: 0,
    setup: (cpc) => {
      ticker = new FakeTicker(cpc);
      setup?.(cpc, ticker);
    },
  };
  const r = runProgram({ body, data: `${data}\nlogp: defw logbuf\nlogbuf: defs 64\ndummy: ret\n`, include: ['loco/event.asm'] }, options);
  expect(r.stopped).toBe('rst0');
  return Object.assign(r, { ticker: ticker as FakeTicker });
}

/** A bare-mode snippet (no bootstrap, no firmware): `body` runs with the stack set up, then `jp 0` ends the run. */
function bareAsm(body: string, data = ''): AssembledRun {
  const text = [
    'org 64',
    `.core.CPC_PRIV_BASE EQU ${BARE.priv}`,
    '.core.CPC_PRIV_SIZE EQU 1024',
    '.core.CPC_STACK_TOP EQU 48128',
    '.core.CPC_MEM_TOP EQU 49151',
    '.core.ZXBASIC_HEAP_SIZE EQU 4768',
    '.core.ZXBASIC_MEM_HEAP EQU 42336',
    '#define CPC_BAREMETAL',
    '.core.__START_PROGRAM:',
    '  ld sp, .core.CPC_STACK_TOP',
    body,
    '  jp 0',
    data,
    'logp: defw logbuf',
    'logbuf: defs 64',
    'dummy: ret',
    'log: ld hl, (logp)',
    '  ld (hl), a',
    '  inc hl',
    '  ld (logp), hl',
    '  ret',
    '#include once <loco/event.asm>',
  ].join('\n');
  const r = assembleAndRun(text, { files, irqInterval: 0 });
  expect(r.stopped).toBe('rst0');
  return r;
}

const logText = (r: AssembledRun): string => {
  const at = r.image.addr('logbuf');
  let out = '';
  for (let i = 0; i < 64 && r.memory[at + i] !== 0; i++) out += String.fromCharCode(r.memory[at + i] as number);
  return out;
};

/** `every`/`after` call sequence: n, t pushed (n deeper), the handler in HL. */
const setTimer = (which: 'EVERY' | 'AFTER', n: number, t: number, handler: string): string =>
  ` ld hl, ${n}\n push hl\n ld hl, ${t}\n push hl\n ld hl, ${handler}\n call .core.__LOCO_${which}\n`;

describe('the poll costs (docs/ir.md "Events": about 45 T-states in firmware builds, about 110 in bare builds)', () => {
  const t = (call: string, mk: (b: string) => AssembledRun): number => mk(` ld b, 200\nl1: call ${call}\n djnz l1`).tstates;
  it('firmware: 45 T-states when nothing is due (the call, a test of the one summary byte)', () => {
    const poll = t('.core.__EVENT_POLL', (b) => fwAsm(b));
    const dummy = t('dummy', (b) => fwAsm(b));
    // dummy = call 17 + ret 10 = 27; the poll = call 17 + ld a,(nn) 13 + or a 4 + ret z 11 = 45
    expect((poll - dummy) / 200 + 27).toBe(45);
  });
  it('bare: about 110 T-states (the frame compare as well)', () => {
    const poll = t('.core.__EVENT_POLL', (b) => bareAsm(b));
    const dummy = t('dummy', (b) => bareAsm(b));
    // call 17 + ld hl,(nn) 16 + ld de,(nn) 20 + or a 4 + sbc hl,de 15 + call nz (not taken) 10 + ld a,(nn) 13 + or a 4 + ret z 11
    expect((poll - dummy) / 200 + 27).toBe(110);
  });
});

describe('the dispatcher around a handler (firmware)', () => {
  it('saves and restores LOCO_ERRPOS, LOCO_DEV, the text stream and the running priority', () => {
    const priv = 40448;
    const body = [
      ` ld a, 1\n ld (${slot(priv, 0x243)}), a\n ld (${slot(priv, 0x240)}), a`, // timer 0 pending, summary on
      ` ld hl, h0\n ld (${slot(priv, 0x249)}), hl`,
      ` ld hl, 0x1234\n ld (${slot(priv, 0x222)}), hl\n ld hl, 0x5678\n ld (${slot(priv, 0x224)}), hl\n ld hl, 0x9abc\n ld (${slot(priv, 0x226)}), hl`,
      ` ld a, 8\n ld (${slot(priv, 0x2b0)}), a`,
      ' ld bc, 0x0102\n ld de, 0x0304\n ld hl, 0x0506',
      ' call .core.__EVENT_POLL',
      ` ld (regs), bc\n ld (regs+2), de\n ld (regs+4), hl`,
      ' jp done',
      // the handler: sees DEV = 0, trashes ERRPOS, and records the running priority
      `h0: ld a, (${slot(priv, 0x2b0)})\n ld (seen), a\n ld a, (${slot(priv, 0x242)})\n ld (seen+1), a`,
      ` ld hl, 0xdead\n ld (${slot(priv, 0x222)}), hl\n ld (${slot(priv, 0x224)}), hl\n ld (${slot(priv, 0x226)}), hl`,
      ' ret',
      'done:',
    ].join('\n');
    const r = fwAsm(body, 'regs: defs 6\nseen: defs 2', (_cpc, tk) => {
      tk.stream = 3;
    });
    expect(r.byteAt('seen')).toBe(0); // LOCO_DEV is 0 for the handler
    expect(r.byteAt('seen', 1)).toBe(1); // running priority = timer 0 + 1
    expect([r.wordAt('regs'), r.wordAt('regs', 2), r.wordAt('regs', 4)]).toEqual([0x0102, 0x0304, 0x0506]);
    expect([r.memory[slot(priv, 0x2b0)], r.memory[slot(priv, 0x242)], r.memory[slot(priv, 0x243)]]).toEqual([8, 0, 0]);
    const w = (a: number): number => (r.memory[a] as number) | ((r.memory[a + 1] as number) << 8);
    expect([w(slot(priv, 0x222)), w(slot(priv, 0x224)), w(slot(priv, 0x226))]).toEqual([0x1234, 0x5678, 0x9abc]);
    expect(r.ticker.streamCalls).toEqual([0, 3]); // select stream 0, then the old one again
    expect(r.ticker.stream).toBe(3);
  });
});

describe('the firmware tick blocks (KL INIT EVENT and KL ADD TICKER as the firmware guide specifies them)', () => {
  const priv = 40448;
  const block = (t: number): number => slot(priv, 0x261) + 13 * t;
  it('EVERY n: count n, recharge n; AFTER n: count n, recharge 0; the event is asynchronous, far, both ROMs off', () => {
    const r = fwAsm([setTimer('EVERY', 7, 2, 'hdl'), setTimer('AFTER', 9, 1, 'hdl'), ' jp fin', 'hdl: ret', 'fin:'].join('\n'));
    const w = (a: number): number => (r.memory[a] as number) | ((r.memory[a + 1] as number) << 8);
    expect(r.ticker.chain).toEqual([block(2), block(1)]);
    expect([w(block(2) + 2), w(block(2) + 4)]).toEqual([7, 7]);
    expect([w(block(1) + 2), w(block(1) + 4)]).toEqual([9, 0]);
    const tick0 = r.image.addr('.core.__EV_TICK0');
    expect([r.memory[block(2) + 9], r.memory[block(2) + 12], w(block(2) + 10)]).toEqual([0x80, 0xff, tick0 + 8]);
    expect(w(block(1) + 10)).toBe(tick0 + 4);
    // the handler addresses and a replaced timer: EVERY again on timer 2 removes the old block first
    expect(w(slot(priv, 0x249) + 4)).toBe(r.image.addr('hdl'));
  });
  it('REMAIN returns the count the firmware reports and stops the timer; a block that already fired reports 0', () => {
    const r = fwAsm(
      [setTimer('EVERY', 7, 2, 'hdl'), ' ld hl, 2\n call .core.__LOCO_REMAIN\n ld (rem), hl', ' ld hl, 2\n call .core.__LOCO_REMAIN\n ld (rem+2), hl', ' jp fin', 'hdl: ret', 'fin:'].join('\n'),
      'rem: defw 0xffff, 0xffff',
    );
    expect([r.wordAt('rem'), r.wordAt('rem', 2)]).toEqual([7, 0]);
    expect(r.ticker.chain).toEqual([]);
  });
});

describe('the bare build counts the frame counter in the poll', () => {
  const priv = BARE.priv;
  const PEND = slot(priv, 0x243);
  const FRAMES = '.core.FH_FRAMES';
  const advance = (to: number): string => ` ld hl, ${to}\n ld (${FRAMES}), hl\n`;

  it('EVERY and AFTER count frames; the pending counts and the remaining counts are exact', () => {
    // the handler is only a RET; DI keeps the dispatcher away while the pending counts are read
    const r = bareAsm([setTimer('EVERY', 3, 0, 'hdl'), setTimer('AFTER', 4, 1, 'hdl'), ' call .core.__LOCO_DI', advance(7), ' call .core.__EVENT_POLL', ' ld hl, 0\n call .core.__LOCO_REMAIN', ' ld (rem0), hl', ' ld hl, 1\n call .core.__LOCO_REMAIN', ' ld (rem1), hl', ' jp fin', 'hdl: ret', 'fin:'].join('\n'), 'rem0: defw 0xffff\nrem1: defw 0xffff');
    // EVERY 3 over 7 frames: expired at 3 and 6, one frame into the third period -> 2 left; AFTER 4: expired at 4, stopped
    expect(r.wordAt('rem0')).toBe(2);
    expect(r.wordAt('rem1')).toBe(0);
    // REMAIN cleared the pending counts
    expect([r.memory[PEND], r.memory[PEND + 1]]).toEqual([0, 0]);
  });

  it('a pending kick is counted (two for EVERY 3 after 7 frames, one for AFTER 4) and DI/EI hold and release the summary', () => {
    const r = bareAsm([setTimer('EVERY', 3, 0, 'hdl'), setTimer('AFTER', 4, 1, 'hdl'), ' call .core.__LOCO_DI', advance(7), ' call .core.__EVENT_POLL', ' jp fin', 'hdl: ret', 'fin:'].join('\n'));
    expect([r.memory[PEND], r.memory[PEND + 1], r.memory[PEND + 2], r.memory[PEND + 3]]).toEqual([2, 1, 0, 0]);
    expect(r.memory[slot(priv, 0x240)]).toBe(0); // DI: the summary is off although kicks are pending
    expect(r.memory[slot(priv, 0x241)]).toBe(1);
    const r2 = bareAsm([setTimer('EVERY', 3, 0, 'hdl'), ' call .core.__LOCO_DI', advance(4), ' call .core.__EVENT_POLL', ' call .core.__LOCO_EI', ' jp fin', 'hdl: ret', 'fin:'].join('\n'));
    expect(r2.memory[PEND]).toBe(1);
    expect(r2.memory[slot(priv, 0x240)]).not.toBe(0); // EI: pending and not DI
  });

  it('runs the due handlers highest first, a handler is interrupted only by a higher timer, the RETURN re-enables', () => {
    const body = [
      setTimer('AFTER', 5, 0, 'h0'),
      setTimer('AFTER', 10, 1, 'h1'),
      setTimer('AFTER', 15, 3, 'h3'),
      setTimer('AFTER', 20, 2, 'h2'),
      advance(5),
      ' call .core.__EVENT_POLL', // timer 0 is due: h0 runs
      ' ld a, 0x45\n call log', // 'E'
      ' jp fin',
      // h0: logs '0', lets 15 frames pass (the statements of a real handler poll), logs 'z'
      `h0: ld a, 0x30\n call log\n${advance(20)} call .core.__EVENT_POLL\n ld a, 0x7a\n call log\n ret`,
      'h1: ld a, 0x31\n call log\n ret',
      'h2: ld a, 0x32\n call log\n ret',
      'h3: ld a, 0x33\n call log\n ret',
      'fin:',
    ].join('\n');
    const r = bareAsm(body);
    // while h0 (priority 1) runs, timers 3, 2 and 1 come due together; the poll inside h0 runs them highest first
    expect(logText(r)).toBe('0321zE');
    expect(r.memory[slot(priv, 0x242)]).toBe(0);
  });

  it('DI inside a handler holds a higher timer until the handler returns; RETURN clears DI', () => {
    const body = [
      setTimer('AFTER', 2, 1, 'h1'),
      setTimer('AFTER', 6, 3, 'h3'),
      advance(2),
      ' call .core.__EVENT_POLL',
      ' jp fin',
      // h1: DI, then 8 frames pass and a poll inside the handler must not run timer 3
      `h1: ld a, 0x31\n call log\n call .core.__LOCO_DI\n${advance(8)} call .core.__EVENT_POLL\n ld a, 0x2d\n call log\n ret`,
      'h3: ld a, 0x33\n call log\n ret',
      'fin:',
    ].join('\n');
    const r = bareAsm(body);
    expect(logText(r)).toBe('1-3'); // timer 3 waited for the RETURN of h1
    expect(r.memory[slot(priv, 0x241)]).toBe(0);
  });

  it('the pending count stops at 127', () => {
    const r = bareAsm([setTimer('EVERY', 1, 0, 'hdl'), ' call .core.__LOCO_DI', advance(300), ' call .core.__EVENT_POLL', ' jp fin', 'hdl: ret', 'fin:'].join('\n'));
    expect(r.memory[PEND]).toBe(127);
  });

  it('counts across the wrap of the 16-bit frame counter', () => {
    const body = [
      ' ld hl, 0xfffe\n ld (.core.FH_FRAMES), hl\n ld (' + slot(priv, 0x247) + '), hl', // the last count was at 0xfffe
      setTimer('AFTER', 5, 2, 'hdl'),
      ' call .core.__LOCO_DI',
      ' ld hl, 3\n ld (.core.FH_FRAMES), hl\n', // five frames later
      ' call .core.__EVENT_POLL',
      ' jp fin',
      'hdl: ret',
      'fin:',
    ].join('\n');
    expect(bareAsm(body).memory[PEND + 2]).toBe(1);
  });

  it('n = 0 stops a timer', () => {
    const r = bareAsm([setTimer('EVERY', 2, 0, 'hdl'), setTimer('EVERY', 0, 0, 'hdl'), ' call .core.__LOCO_DI', advance(10), ' call .core.__EVENT_POLL', ' jp fin', 'hdl: ret', 'fin:'].join('\n'));
    expect(r.memory[PEND]).toBe(0);
  });

  it('TIME is the frame counter x 6', () => {
    const r = bareAsm([' ld hl, 0x2345\n ld (.core.FH_FRAMES), hl\n ld hl, 1\n ld (.core.FH_FRAMES + 2), hl', ' call .core.__LOCO_TIME', ' ld (tm), hl\n ld (tm+2), de'].join('\n'), 'tm: defs 4');
    // 0x12345 = 74565 frames; x 6 = 447390 = 6 x 65536 + 54174
    const want = 74565 * 6;
    expect([r.wordAt('tm'), r.wordAt('tm', 2)]).toEqual([want & 0xffff, want >>> 16]);
  });
});
