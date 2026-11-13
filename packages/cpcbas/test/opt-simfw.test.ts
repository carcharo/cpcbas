/**
 * L5-SIMFW (follow-up 187): the firmware entries the test Z80 gained, so that layers 1 and 2 of the correctness guard compare the
 * programs they used to skip. Expected values are the firmware guide's entry and exit conditions (SOFT968) and the
 * interpreter-blessed transcripts of tests/loco (test/loco-conformance.test.ts runs those at -O0).
 */
import { describe, expect, it } from 'vitest';
import { allPrograms } from './opt-programs.js';
import { DEFAULT_MAX_TSTATES, asmAt, callsOf, compareLevels, diffOutcomes, runBuilt, withAsmHook } from './opt-harness.js';
import type { Outcome } from './opt-harness.js';
import { runProgram } from './z80sim/run.js';

/** The 15 programs layers 1 and 2 skipped with `UnhandledFirmwareError` before L5-SIMFW. */
const WERE_SKIPPED = [
  'loco/err-event.bas', 'loco/files-abandon.bas', 'loco/files-cross.bas', 'loco/files.bas', 'loco/gfx-origin.bas', 'loco/gfx-plot.bas',
  'loco/ink.bas', 'loco/keys-def.bas', 'loco/keys-inkey.bas', 'loco/keys-input.bas', 'loco/text-copychr.bas', 'loco/text-symbol.bas',
  'loco/text-window.bas', 'loco/timer.bas', 'fork-diff/gfx-alias.bas',
];

describe('the programs that used to be skipped are compared', () => {
  const byName = new Map(allPrograms().map((p) => [p.name, p]));
  it.each(WERE_SKIPPED)('%s runs at -O0 and at -O2 and agrees', (name) => {
    const p = byName.get(name);
    expect(p, `${name} is not in the program set`).toBeDefined();
    // requireRun: -O0 is run even when -O2 emits the same image, so a program the simulator cannot run is 'skipped', not 'ok'
    const v = compareLevels(p!, [2], { requireRun: true });
    expect(v.kind === 'ok' ? '' : `${v.kind}: ${v.detail}`).toBe('');
    expect(v.t0).toBeGreaterThan(0);
  });
});

/**
 * Follow-up 220: the conformance programs the layers used to leave out by header (`REM SIM: skip`, `REM TYPE:`, `REM EMUS:` and
 * `REM DISKFILE:`), now compared between levels. Each must RUN at -O0 (a 'skipped' verdict passes the layers silently, so it is
 * asserted here that none has gone back to skipping) and agree at -O2 and -Os.
 */
const NOW_COMPARED = [
  'banks.bas', 'banks_disc.bas', 'banks_hook.bas', 'banks_music.bas', 'cb_display.bas', 'cb_fill.bas', 'cb_keys.bas',
  'cb_palette.bas', 'cb_sprites.bas', 'cb_tilerestore.bas', 'cb_tiles.bas', 'cb_tilewidth.bas', 'font.bas', 'framehook.bas',
  'framehook_game.bas', 'graphics.bas', 'graphics_xor.bas', 'input.bas', 'isr.bas', 'keyboard.bas', 'keys_cpc.bas', 'music.bas',
  'music_hook.bas', 'play.bas', 'plus_none.bas', 'plus_none_hi.bas', 'plus_none_state.bas', 'screen.bas', 'text.bas', 'udg.bas', 'udg_blocks.bas',
].map((n) => `conformance/${n}`);

describe('the header-excluded conformance programs are compared between levels', () => {
  const byName = new Map(allPrograms().map((p) => [p.name, p]));
  it.each(NOW_COMPARED)('%s runs at -O0 and agrees at -O2 and -Os', (name) => {
    const p = byName.get(name);
    expect(p, `${name} is not in the program set`).toBeDefined();
    const v = compareLevels(p!, [2, 's'], { requireRun: true });
    expect(v.kind === 'ok' ? '' : `${v.kind}: ${v.detail}`).toBe('');
    expect(v.t0).toBeGreaterThan(0);
  }, 60_000);

  it('the programs that still cannot run are in the set but skipped at -O0, for the reason the report gives', () => {
    // the key tables (KM GET TRANSLATE &BB2A and its relatives are the ROM's data) and the sound manager's queue (no AY: it never drains)
    for (const n of ['inkey.bas', 'inkey_locks.bas', 'keytables.bas']) {
      const v = compareLevels(byName.get(`conformance/${n}`)!, [2], { requireRun: true });
      expect([n, v.kind, v.detail]).toEqual([n, 'skipped', expect.stringContaining('unhandled firmware address &BB2A')]);
    }
    const sound = { ...byName.get('conformance/sound.bas')!, maxTStates: 20_000_000 };
    expect(compareLevels(sound, [2], { requireRun: true }).detail).toContain('stops with limit');
  });

  it('bare-metal, Plus and 464-only programs are not in the set', () => {
    for (const n of ['bare_beep.bas', 'bare_sound.bas', 'banks464.bas', 'plus_big.bas', 'plus_dma.bas', 'plus_asset.bas', 'bareframes.bas']) {
      expect(byName.has(`conformance/${n}`), n).toBe(false);
    }
  });
});

describe('the harness compares the timing programs by their verdicts', () => {
  const o = (printer: string, data = ''): Outcome => ({ printer, stopped: 'rst0', data, tstates: 1, calls: '' });
  it('measured numbers and counters may differ; a check that flips may not', () => {
    const a = o('INFO ticks= 10\nPASS x_ok\nFAIL y_bad got= 3\nDONE\n', '0a00');
    expect(diffOutcomes(a, o('INFO ticks= 9\nPASS x_ok\nFAIL y_bad got= 4\nDONE\n', '0900'), true, true)).toBeNull();
    expect(diffOutcomes(a, o('INFO ticks= 10\nFAIL x_ok\nFAIL y_bad got= 3\nDONE\n', '0a00'), true, true)).toContain('check verdicts differ');
    expect(diffOutcomes(a, o('INFO ticks= 10\nPASS x_ok\nFAIL y_bad got= 3\nDONE\n', '0a00'), true, false)).toBeNull();
    expect(diffOutcomes(a, o('INFO ticks= 9\nPASS x_ok\nFAIL y_bad got= 3\nDONE\n', '0a00'), true, false)).toContain('transcript differs');
    // a check named as speed-dependent is left out
    expect(diffOutcomes(a, o('INFO t\nPASS x_ok\nPASS y_bad\nDONE\n'), true, true, ['y_bad'])).toBeNull();
  });
});

describe('the harness compares the firmware record', () => {
  const o = (calls: string): Outcome => ({ printer: 'x', stopped: 'rst0', data: '', tstates: 1, calls });
  it('a different recorded call, or a different file on the disc, is a difference', () => {
    expect(diffOutcomes(o('GRA SET ORIGIN 1,2'), o('GRA SET ORIGIN 1,2'))).toBeNull();
    expect(diffOutcomes(o('GRA SET ORIGIN 1,2'), o('GRA SET ORIGIN 1,3'))).toContain('firmware calls differ');
    expect(diffOutcomes(o('-- files\nA=61'), o('-- files\nA=62'))).toContain('firmware calls differ');
  });
});

describe('the modelled entries', () => {
  const win = (body: string, data = ''): ReturnType<typeof runProgram> => runProgram({ body, data: `${data}\nvals: defs 8` });
  it('TXT WIN ENABLE sorts and cuts the window (0-based), homes the cursor, and TXT RD CHAR reads under it', () => {
    const r = win(
      [
        ' ld h, 29\n ld d, 9\n ld l, 4\n ld e, 2', // right < left, bottom < top: sorted
        ' call 0xBB66',
        ' ld a, 0x41\n call 0xBB5A', // 'A' at the window's corner
        ' ld h, 1\n ld l, 1\n call 0xBB75', // TXT SET CURSOR: the window's own (1,1)
        ' call 0xBB60\n ld (vals), a\n ld a, 0\n rla\n ld (vals+1), a', // TXT RD CHAR: A, Carry
        ' call 0xBB69\n ld a, h\n ld (vals+2), a\n ld a, d\n ld (vals+3), a\n ld a, l\n ld (vals+4), a\n ld a, e\n ld (vals+5), a',
      ].join('\n'),
    );
    expect(r.stopped).toBe('rst0');
    expect(r.byteAt('vals')).toBe(0x41);
    expect(r.byteAt('vals', 1)).toBe(1);
    expect([2, 3, 4, 5].map((k) => r.byteAt('vals', k))).toEqual([10, 30, 3, 5]); // columns 10-30, lines 3-5 (1-based)
  });

  it('SCR SET FLASHING is read back by SCR GET FLASHING (the default is 10 and 10)', () => {
    const r = win(
      [
        ' call 0xBC41\n ld a, h\n ld (vals), a\n ld a, l\n ld (vals+1), a',
        ' ld h, 3\n ld l, 7\n call 0xBC3E',
        ' call 0xBC41\n ld a, h\n ld (vals+2), a\n ld a, l\n ld (vals+3), a',
      ].join('\n'),
    );
    expect([0, 1, 2, 3].map((k) => r.byteAt('vals', k))).toEqual([10, 10, 3, 7]);
  });

  it('GRA TEST reads back what GRA PLOT drew with the current pen, and is paper elsewhere', () => {
    const r = win(
      [
        ' ld a, 2\n call 0xBBDE', // GRA SET PEN 2
        ' ld de, 100\n ld hl, 50\n call 0xBBEA', // GRA PLOT ABSOLUTE
        ' ld de, 100\n ld hl, 50\n call 0xBBF0\n ld (vals), a', // GRA TEST ABSOLUTE
        ' ld de, 101\n ld hl, 50\n call 0xBBF0\n ld (vals+1), a',
      ].join('\n'),
    );
    expect([r.byteAt('vals'), r.byteAt('vals', 1)]).toEqual([2, 0]);
    expect(r.cpc.gfx).toEqual(['pen 2', 'plot 100,50', 'GRA TEST ABSOLUTE 100,50', 'GRA TEST ABSOLUTE 101,50']);
  });

  it('the record holds the program\'s arguments and callsOf puts the disc after it', () => {
    const r = win(' ld de, 5\n ld hl, 0xFFFE\n call 0xBBC9\n ld h, 1\n ld l, 2\n call 0xBB3F');
    expect(r.cpc.gfx).toEqual(['GRA SET ORIGIN 5,-2', 'KM SET DELAY 1,2']);
    expect(callsOf(r)).toBe('GRA SET ORIGIN 5,-2\nKM SET DELAY 1,2\n-- disc\n-- files');
  });

  it('a timer event routine runs from the 300 Hz interrupt through the default ticker', () => {
    // KL INIT EVENT (HL = event block, DE = routine, B = class &80, C = ROM select), KL ADD TICKER (HL = tick block, DE = count,
    // BC = recharge): the routine counts in `vals`; the program waits for three runs, so the ticker was driven by the machine.
    const r = runProgram(
      {
        body: [
          ' ld hl, blk+6\n ld de, rout\n ld bc, 0x80FF\n call 0xBCEF', // the event block is inside the tick block,
          ' ld hl, blk\n ld de, 1\n ld bc, 1\n call 0xBCE9',
          ' ei',
          'wait: ld a, (vals)\n cp 3\n jr c, wait',
          ' di\n jp done',
          'rout: ld hl, vals\n inc (hl)\n ret',
          'done:',
        ].join('\n'),
        data: 'vals: defs 8\nblk: defs 13',
      },
      { maxTStates: 5_000_000 },
    );
    expect(r.stopped).toBe('rst0');
    expect(r.byteAt('vals')).toBeGreaterThanOrEqual(3);
    expect(r.cpc.ticker.kicks.length).toBeGreaterThanOrEqual(3);
  });

  it('frame flyback events: KL NEW FRAME FLY runs the routine once per 50 Hz frame, KL DEL FRAME FLY stops it', () => {
    const r = runProgram(
      {
        body: [
          ' ld hl, blk\n ld de, rout\n ld bc, 0x80FF\n call 0xBCD7', // class &80 (asynchronous, far), ROM select &FF
          ' ei',
          'wait: ld a, (vals)\n cp 5\n jr c, wait',
          ' ld hl, blk\n call 0xBCDD\n ld a, 0\n rla\n ld (vals+1), a', // KL DEL FRAME FLY: Carry true, it was on the chain
          ' ld a, (vals)\n ld (vals+2), a',
          ' ld bc, 4000\nspin: dec bc\n ld a, b\n or c\n jr nz, spin', // 4000 loops of 24 T: more than a frame
          ' ld a, (vals)\n ld (vals+3), a\n ld hl, blk\n call 0xBCDD\n ld a, 0\n rla\n ld (vals+4), a',
          ' di\n jp done',
          'rout: ld hl, vals\n inc (hl)\n ret',
          'done:',
        ].join('\n'),
        data: 'vals: defs 8\nblk: defs 8',
      },
      { maxTStates: 5_000_000 },
    );
    expect(r.stopped).toBe('rst0');
    expect(r.byteAt('vals', 1)).toBe(1);
    expect(r.byteAt('vals', 2)).toBe(r.byteAt('vals', 3)); // removed: no more events
    expect(r.byteAt('vals', 4)).toBe(0); // KL DEL FRAME FLY of a block that is not on the chain: Carry false
    expect(r.cpc.ticker.frameKicks.length).toBeGreaterThanOrEqual(5);
    // five frames take about five times 80000 T-states (the first event is at the end of frame 1)
    expect(r.cpc.ticker.frames).toBeGreaterThanOrEqual(5);
    expect(r.tstates).toBeGreaterThan(4 * 80_000);
  });

  it('PPI port B bit 0 is the frame flyback: it is high for a short pulse once a frame', () => {
    const r = runProgram(
      {
        body: [
          ' ld bc, 0xF500\n ld d, 0\n ld e, 0', // D counts rising edges seen, E the last bit
          'poll: in a, (c)\n and 1\n ld h, a\n ld a, e\n cpl\n and h\n jr z, noedge\n inc d', // an edge: now 1, before 0
          'noedge: ld e, h\n ld a, d\n cp 4\n jr c, poll',
          ' ld a, d\n ld (vals), a',
        ].join('\n'),
        data: 'vals: defs 4',
      },
      { maxTStates: 5_000_000, irqInterval: 0 },
    );
    expect(r.stopped).toBe('rst0');
    expect(r.byteAt('vals')).toBe(4);
    expect(r.tstates).toBeGreaterThan(3 * 80_000);
    expect(r.tstates).toBeLessThan(5 * 80_000 + 100_000);
  });

  it('SCR INK ENCODE, SCR GET MODE, KM GET STATE, KM CHAR RETURN and SOUND RESET answer as the guide says', () => {
    const r = runProgram(
      {
        body: [
          ' ld a, 1\n call 0xBC0E', // mode 1
          ' ld a, 2\n call 0xBC2C\n ld (vals), a', // pen 2 in mode 1: pen bit 1 is in bits 3-0
          ' call 0xBC11\n ld (vals+1), a\n ld a, 0\n jr nz, notz\n ld a, 1\nnotz: ld (vals+2), a', // mode 1: Zero set
          ' ld h, 0xFF\n ld l, 0\n call 0xBD3A\n call 0xBB21\n ld a, h\n ld (vals+3), a\n ld a, l\n ld (vals+4), a',
          ' ld a, 0x41\n call 0xBB0C\n call 0xBB09\n ld (vals+5), a',
          ' call 0xBCA7',
        ].join('\n'),
        data: 'vals: defs 8',
      },
    );
    expect(r.stopped).toBe('rst0');
    expect([0, 1, 2, 3, 4, 5].map((k) => r.byteAt('vals', k))).toEqual([0x0f, 1, 1, 0xff, 0, 0x41]);
  });

  it('the fake disc is on every machine: a file put there is read through CAS', () => {
    const r = runProgram({
      body: [
        ' ld c, 7\n ld d, 1\n ld e, 0\n ld h, 0xB0\n ld l, 0xFF\n call 0xBCCE', // KL INIT BACK
        ' ld hl, name\n ld b, 1\n ld de, 0x9000\n call 0xBC77', // CAS IN OPEN "A"
        ' call 0xBC80\n ld (vals), a', // CAS IN CHAR
        ' call 0xBC7A',
      ].join('\n'),
      data: 'vals: defs 4\nname: defb 0x41',
    }, { setup: (cpc) => cpc.disc.put('A', 'Q') });
    expect(r.stopped).toBe('rst0');
    expect(r.byteAt('vals')).toBe(0x51);
    expect(r.cpc.disc.log).toEqual(['IN OPEN A', 'IN CLOSE']);
  });
});

describe('the harness compares a heapOrder program by the heap\'s free bytes', () => {
  const o = (data: string, heapFree: number, strSlots: readonly number[] = [0]): Outcome => ({ printer: 'ok\n', stopped: 'rst0', data, tstates: 1, calls: '', heapFree, strSlots });
  it('a string pointer may differ; the free bytes may not (a leaked or doubly freed temporary changes them)', () => {
    expect(diffOutcomes(o('868f', 4228), o('818f', 4228), true, false, [], true)).toBeNull();
    expect(diffOutcomes(o('868f', 4228), o('818f', 4228), true, false, [], false)).toContain('data region differs');
    // R20: the other variables are still compared (a string pointer at offset 0, an integer at offset 2)
    expect(diffOutcomes(o('868f0500', 4228), o('818f0500', 4228), true, false, [], true)).toBeNull();
    expect(diffOutcomes(o('868f0500', 4228), o('818f0600', 4228), true, false, [], true)).toContain('data region differs at byte 2');
  });
  it('cb_fill: the free bytes are read from the heap (R20: the heap EQU is not in the map) and its string variable is the one slot masked', () => {
    const p = allPrograms().find((x) => x.name === 'conformance/cb_fill.bas')!;
    for (const level of [0, 's'] as const) {
      const built = asmAt(p, level);
      const out = runBuilt(built, p, p.maxTStates ?? DEFAULT_MAX_TSTATES);
      expect(out.heapFree, `-O${level}`).toBeGreaterThan(0);
      expect(out.strSlots, `-O${level}`).toEqual([0]); // results$, the first variable
      const text = withAsmHook((t) => t, () => runBuilt(asmAt(p, level), p, p.maxTStates ?? DEFAULT_MAX_TSTATES));
      expect(text.heapFree, `-O${level} text route`).toBe(out.heapFree);
      expect(text.strSlots, `-O${level} text route`).toEqual([0]);
    }
    expect(diffOutcomes(o('868f', 4228), o('818f', 4220), true, false, [], true)).toContain('heap free bytes differ');
  });
});
