/**
 * L5-STRIP: routine-level stripping of runtime and library code (`asm/reach.ts`, the link pass `strip`).
 *
 * The first part drives the reachability analysis on small asm texts: a fall-through pair, a `defw`-only reference, a routine
 * named by user ASM, the interrupt and error vectors, and the cases that must keep a chunk. The second part builds real
 * programs through `compile()` and checks the map and the behaviour.
 */
import { describe, expect, it } from 'vitest';
import { unreachable, nameKey } from '../src/asm/reach.js';
import { compile } from '../src/index.js';
import { libTree } from './runtime-tree.js';
import { compareLevels } from './opt-harness.js';

/** The labels of the chunks the analysis drops, for the text `user` (kept whole, every name a root) and `runtime`. */
function dropped(user: string, runtime: string): string[] {
  const lines = [...user.split('\n'), ...runtime.split('\n')];
  const r = unreachable(lines, user.split('\n').length);
  return r.dropped.flatMap((d) => d.labels).sort();
}

describe('reach: the three drop conditions', () => {
  it('a chunk nothing names is dropped; one that is named is kept', () => {
    const rt = ['LA:', ' ld a, 1', ' ret', 'LB:', ' ld a, 2', ' ret'].join('\n');
    expect(dropped(' call LA', rt)).toEqual(['LB']);
    expect(dropped(' call LB', rt)).toEqual(['LA']);
    expect(dropped(' nop', rt)).toEqual(['LA', 'LB']);
  });

  it('a fall-through pair: the chunk a kept chunk runs on into is kept, though nothing names it', () => {
    const rt = ['LA:', ' ld a, 1', 'LB:', ' add a, 2', ' ret', 'LC:', ' ld a, 9', ' ret'].join('\n');
    expect(dropped(' call LA', rt)).toEqual(['LC']);
    // ...and LB stays droppable when LA is not kept
    expect(dropped(' call LC', rt)).toEqual(['LA', 'LB']);
  });

  it('conditional returns and jumps run on; unconditional ones, reti, retn and jp (hl) do not', () => {
    for (const [end, runsOn] of [
      [' ret z', true],
      [' jr nz, LA', true],
      [' jp c, LA', true],
      [' djnz LA', true],
      [' call LX', true],
      [' ret', false],
      [' reti', false],
      [' retn', false],
      [' jp LA', false],
      [' jr LA', false],
      [' jp (hl)', false],
    ] as const) {
      const rt = ['LA:', end, 'LB:', ' ret'].join('\n');
      expect(dropped(' call LA', rt), end).toEqual(runsOn ? [] : ['LB']);
    }
  });

  it('an empty label run (aliases) runs on into the next chunk', () => {
    const rt = ['LA:', 'LA2:', 'LA3:', ' ret', 'LB:', ' ret'].join('\n');
    expect(dropped(' call LA', rt)).toEqual(['LB']);
    expect(dropped(' call LA3', rt)).toEqual(['LA', 'LA2', 'LB']);
  });

  it('a defw-only reference keeps a routine: the table names it, the table is named', () => {
    const rt = ['TBL:', ' defw H1, H2', 'H1:', ' ret', 'H2:', ' ret', 'H3:', ' ret'].join('\n');
    expect(dropped(' ld hl, TBL', rt)).toEqual(['H3']);
    // a table nothing names takes its routines with it
    expect(dropped(' nop', rt)).toEqual(['H1', 'H2', 'H3', 'TBL']);
  });

  it('data that is read across a label (a constant table) keeps the table that follows it', () => {
    const rt = ['T0:', ' defb 1, 2', 'T1:', ' defb 3', 'T2:', ' defb 4', 'LX:', ' ret', 'LY:', ' defb 9', 'LZ:', ' ret'].join('\n');
    // T0 kept: T1 and T2 are the same table; LX is code, so the run stops there; LY is data after code: dropped
    expect(dropped(' ld hl, T0', rt)).toEqual(['LX', 'LY', 'LZ']);
  });

  it('code that ends in a table (ret, then data) keeps the data-only chunk after it (R18)', () => {
    // `LR` returns, then holds a table that may be indexed on into `TX`'s bytes: TX is kept with it; `LQ` (code) is not
    const rt = ['LR:', ' ld a, (hl)', ' ret', ' defb 1, 2', 'TX:', ' defb 3', 'LQ:', ' ret'].join('\n');
    expect(dropped(' call LR', rt)).toEqual(['LQ']);
    // ...and code ending in `ret` with no table after it keeps nothing that follows
    const plain = ['LR:', ' ret', 'TX:', ' defb 3'].join('\n');
    expect(dropped(' call LR', plain)).toEqual(['TX']);
  });

  it('an EQU names its labels: they are roots, however the EQU is reached', () => {
    const rt = ['SIZE EQU END_T - START_T', 'START_T:', ' defb 1', 'END_T:', ' defb 0', 'LU:', ' ret'].join('\n');
    expect(dropped(' nop', rt)).toEqual(['LU']);
  });

  it('names compare by key: .core.X, core.X and LX are one', () => {
    expect(nameKey('.core.__PRINT')).toBe('__PRINT');
    expect(nameKey('__PRINT')).toBe('__PRINT');
    const rt = ['    push namespace core', '__PRINT:', ' ret', 'OTHER:', ' ret'].join('\n');
    expect(dropped(' call .core.__PRINT', rt)).toEqual(['OTHER']);
  });

  it('a routine named from user ASM is kept (the user region is scanned whole)', () => {
    const user = ['; user', ' ld hl, 1', ' call .core.__ASM_NAMED', ' jp .core.__END'].join('\n');
    const rt = ['    push namespace core', '__ASM_NAMED:', ' ret', '__UNNAMED:', ' ret', '__END:', ' ret'].join('\n');
    expect(dropped(user, rt)).toEqual(['__UNNAMED']);
  });

  it('the interrupt and error vectors: whatever a kept chunk installs or jumps to is kept', () => {
    const user = ' call .core.BOOT\n jp .core.__ERROR';
    const rt = [
      'BOOT:',
      ' ld hl, ISR',
      ' ld (VEC+1), hl',
      ' ret',
      'ISR:',
      ' call HELPER',
      ' reti',
      'HELPER:',
      ' ret',
      '__ERROR:',
      ' ld hl, ERRMSG',
      ' jp PRINTMSG',
      'ERRMSG:',
      ' defm "bad"',
      'PRINTMSG:',
      ' ret',
      'UNUSED:',
      ' ret',
    ].join('\n');
    expect(dropped(user, rt)).toEqual(['UNUSED']);
  });

  it('PROC-local labels are the chunk\'s own: a name LOCAL in a PROC exports nothing, a non-LOCAL one is global', () => {
    const rt = [
      'LA:',
      ' PROC',
      ' LOCAL LOOP',
      'LOOP:',
      ' djnz LOOP',
      'GLOB:',
      ' ret',
      ' ENDP',
      'LB:',
      ' PROC',
      ' LOCAL LOOP',
      'LOOP:',
      ' djnz LOOP',
      ' ret',
      ' ENDP',
    ].join('\n');
    // GLOB is global (exported by LA's PROC); LOOP, local in both, is nobody's: a name LOOP in the user region keeps neither chunk
    expect(dropped(' call LB', rt)).toEqual(['GLOB', 'LA']);
    expect(dropped(' call GLOB', rt)).toEqual(['LB']);
    expect(dropped(' call LOOP', rt)).toEqual(['GLOB', 'LA', 'LB']);
  });

  it('an EQU inside a PROC goes with its chunk (its LOCAL names would not exist without it)', () => {
    const rt = ['LA:', ' PROC', ' LOCAL T, T0', 'T EQU T0 + 1', ' ld (T), hl', 'T0:', ' defw 0', ' ret', ' ENDP', 'LB:', ' ret'].join('\n');
    expect(dropped(' call LB', rt)).toEqual(['LA']);
  });

  it('PROC, ENDP, ALIGN and namespace lines are never dropped (the scopes and the layout stay as they were)', () => {
    const lines = ['LU:', ' nop', '    push namespace core', 'LA:', ' PROC', ' ret', ' ENDP', ' ALIGN 256', 'LB:', ' ret', '    pop namespace'];
    const r = unreachable(lines, 2);
    expect(r.dropped.map((d) => d.labels)).toEqual([['LA'], ['LB']]);
    const gone = new Set<number>();
    for (const [a, b] of r.drop) for (let i = a; i < b; i++) gone.add(i);
    for (const keep of [2, 4, 6, 7, 10]) expect(gone.has(keep), lines[keep]).toBe(false);
    expect([...gone].sort((a, b) => a - b)).toEqual([3, 5, 8, 9]);
  });

  it('a LOCAL label after the last jump is a way in: the chunk runs on (cpcplus __PL_MOVE into __PL_MOVE_SLOW)', () => {
    const rt = ['LA:', ' PROC', ' LOCAL SLOW', ' jr z, SLOW', ' jp LC', 'SLOW:', ' ENDP', 'LB:', ' ret', 'LC:', ' ret'].join('\n');
    expect(dropped(' call LA', rt)).toEqual([]);
    const plain = ['LA:', ' PROC', ' jp LC', ' ENDP', 'LB:', ' ret', 'LC:', ' ret'].join('\n');
    expect(dropped(' call LA', plain)).toEqual(['LB']);
  });

  it('alignment padding (a DEFS whose count names a label) is never dropped: what follows depends on it', () => {
    const rt = ['PADT:', ' DEFS (8 - (PADT & 7)) & 7', 'TABLE:', ' defb 1, 2', 'OTHER:', ' ret'].join('\n');
    expect(dropped(' ld hl, TABLE', rt)).toEqual(['OTHER']);
  });

  it('temporary labels referenced across a chunk edge keep the neighbours', () => {
    const rt = ['LA:', '1:', ' ld a, 1', 'LB:', ' djnz 1b', ' ret', 'LC:', ' ret'].join('\n');
    expect(dropped(' call LB', rt)).toEqual(['LC']); // LB's `1b` is defined in LA: LA is kept too
  });

  it('when in doubt, nothing is dropped: ORG, a continuation line, an unlexable line, an unbalanced PROC', () => {
    expect(dropped(' nop', ['LA:', ' ret', ' ORG 100', 'LB:', ' ret'].join('\n'))).toEqual([]);
    expect(dropped(' nop', ['LA:', ' ld a, \\', ' 1', ' ret'].join('\n'))).toEqual([]);
    expect(dropped(' nop', ['LA:', ' ld a, `', ' ret'].join('\n'))).toEqual([]);
    expect(dropped(' nop', ['LA:', ' PROC', ' ret'].join('\n'))).toEqual([]);
  });
});

const BAS = 'DIM s AS STRING\ns = "ab" + STR$(3)\nPRINT s; LEN(s)\n';

function build(src: string, optimize: 0 | 1 | 2 | 's', extra: { optDisable?: string[]; defines?: Record<string, string> } = {}) {
  return compile({
    files: new Map([['t.bas', src]]),
    main: 't.bas',
    defines: { __CPC_PRINTER_ECHO__: '', ...extra.defines },
    runtime: libTree(),
    options: { map: true, optimize, ...(extra.optDisable !== undefined ? { optDisable: extra.optDisable } : {}) },
  });
}
const labels = (map: string | undefined): Set<string> => new Set((map ?? '').split('\n').map((l) => l.slice(l.indexOf(' ') + 1)));

describe('strip in a real build', () => {
  it('-O0 keeps every linked chunk; -O1, -O2 and -Os drop the ones nothing names', () => {
    const o0 = build(BAS, 0);
    expect(o0.ok).toBe(true);
    for (const level of [1, 2, 's'] as const) {
      const r = build(BAS, level);
      expect(r.ok, String(level)).toBe(true);
      expect(r.binary!.length, String(level)).toBeLessThan(o0.binary!.length);
      expect(r.asm ?? '').toBe(o0.asm ?? ''); // the --asm text is the program as linked; only the image is stripped
    }
  });

  it('--opt-disable strip (with the code passes off) gives -O0\'s image back, byte for byte', () => {
    const o0 = build(BAS, 0);
    const off = build(BAS, 1, { optDisable: ['strip', 'peephole', 'temps', 'cmpjump'] });
    expect(Buffer.from(off.binary!).equals(Buffer.from(o0.binary!))).toBe(true);
    expect(off.map).toBe(o0.map);
  });

  it('what a program uses stays; what it does not, goes', () => {
    const names = labels(build(BAS, 1).map);
    expect(names.has('.core.__LOCO_NUMFMT')).toBe(true); // STR$ and PRINT of a number
    expect(names.has('.core.__LOCO_ZONE')).toBe(false); // linked (text.asm), but nothing here names it
    expect(names.has('.core.__START_PROGRAM')).toBe(true);
    expect(names.has('.core.CPC_INIT_00_BOOTSTRAP')).toBe(true); // an #init routine, called by the prologue
    expect(labels(build(BAS, 0).map).has('.core.__LOCO_ZONE')).toBe(true);
  });

  it('code reached only by an offset from a kept label stays: the four timer event routines (R18; loco timer, err-event)', () => {
    // event.asm enters timer t's routine at __EV_TICK0 + 4 x t; each is `ld a, t / jr __EV_KICK` (timer 3 runs on into it)
    const src = 'EVERY 50,3 GOSUB 10\nEND\n10 RETURN\n';
    for (const level of [0, 2] as const) {
      const r = build(src, level);
      expect(r.ok, String(level)).toBe(true);
      const line = (r.map ?? '').split('\n').find((l) => l.endsWith(' .core.__EV_TICK0'));
      expect(line, String(level)).toBeDefined();
      const start = (r.map ?? '').split('\n').find((l) => l.endsWith(' .core.__START_PROGRAM'))!;
      const at = parseInt(line!.slice(0, line!.indexOf(':')), 16) - parseInt(start.slice(0, start.indexOf(':')), 16);
      const img = Buffer.from(r.binary!);
      for (let t = 0; t < 4; t++) expect([img[at + 4 * t], img[at + 4 * t + 1]], `level ${level}, timer ${t}`).toEqual([0x3e, t]);
    }
  });

  it('a routine that user ASM names is kept', () => {
    const plain = 'PRINT 1\n';
    expect(labels(build(plain, 1).map).has('.core.__LOCO_ZONE')).toBe(false);
    expect(labels(build('ASM\n  call .core.__LOCO_ZONE\nEND ASM\nPRINT 1\n', 1).map).has('.core.__LOCO_ZONE')).toBe(true);
  });

  it('the stripped image runs as -O0 runs (layer 1)', () => {
    for (const src of [BAS, 'PRINT 1+2\n', 'DIM a(5) AS INTEGER\na(2) = 7\nPRINT a(2)\nPRINT SQR(16)\n']) {
      const v = compareLevels({ name: 'strip', files: src });
      expect(v.kind, v.detail).toBe('ok');
      expect(v.ran).toEqual([1, 2, 3, 's']);
    }
  });
});
