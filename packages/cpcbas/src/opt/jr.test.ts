/**
 * L5-CG: the `jr` code pass and the instruction sizer it uses. Behaviour: a converted jump assembles (the assembler refuses
 * a `jr` out of -128..127), the boundary cases sit where the encoding says, and a span the table cannot size keeps `jp`.
 */
import { describe, expect, it } from 'vitest';
import { assembleText } from '../../test/z80sim/run.js';
import type { CodeLine, CodeUnit } from '../codegen/types.js';
import { runJr } from './jr.js';
import { levelSpec, type PassEnv } from './index.js';
import { instructionSize, lineSize } from './z80size.js';
import { makeTarget } from '../codegen/index.js';

const env = (trace = false): PassEnv => ({ spec: levelSpec('s'), target: makeTarget({}), trace, enabled: () => true });
const unit = (...texts: string[]): CodeUnit => ({ procedure: null, quads: [], lines: texts.map((text): CodeLine => ({ text, kind: text.startsWith('#') ? 'opaque' : 'code', quad: 0 })) });
const run = (u: CodeUnit, trace = false): string[] => runJr([u], env(trace))[0]?.lines.map((l) => l.text) ?? [];
const nops = (n: number): string[] => new Array<string>(n).fill('\tnop');
const asm = (lines: string[]): number[] => [...assembleText(`\torg 0x4000\n${lines.join('\n')}\n`).bytes];

describe('z80size: sizes come from the assembler table', () => {
  it.each([
    ['ld a, 1', 2],
    ['ld hl, 1234', 3],
    ['ld hl, (.core.x)', 3],
    ['ld a, (.core.x)', 3],
    ['ld a, (ix-3)', 3],
    ['ld (ix+3), 5', 4],
    ['ld (hl), 5', 2],
    ['bit 7, e', 2],
    ['bit 3, (ix+2)', 4],
    ['sbc a, a', 1],
    ['sbc hl, de', 2],
    ["ex af, af'", 1],
    ['jp po, .T.1', 3],
    ['jr nz, .T.1', 2],
    ['djnz .T.1', 2],
    ['call .core.__ERROR', 3],
    ['jp (hl)', 1],
    ['out (c), a', 2],
    ['rst 56', 1],
    ['push ix', 2],
    ['add a, 255', 2],
  ])('%s is %i bytes', (text, size) => {
    expect(instructionSize(text)).toBe(size);
  });

  it('labels, comments and #line cost nothing; a directive with data and `$` are unknown', () => {
    expect(lineSize('.T.1:')).toBe(0);
    expect(lineSize('\t; opt x: y')).toBe(0);
    expect(lineSize('#line 3 "a.bas"')).toBe(0);
    expect(lineSize('\tdefb 1, 2')).toBeNull();
    expect(lineSize('\tjr $+4')).toBeNull();
    expect(lineSize('foo EQU 5')).toBeNull();
  });
});

describe('the jr pass', () => {
  it('converts jp and jp z|nz|c|nc to labels in range, and leaves jp po/pe/p/m and jp (hl)', () => {
    const out = run(unit('\tjp .T.1', '\tjp nz, .T.1', '\tjp c, .T.1', '\tjp po, .T.1', '\tjp m, .T.1', '\tjp (hl)', '.T.1:', '\tret'));
    expect(out).toEqual(['\tjr .T.1', '\tjr nz, .T.1', '\tjr c, .T.1', '\tjp po, .T.1', '\tjp m, .T.1', '\tjp (hl)', '.T.1:', '\tret']);
  });

  it('the forward reach is 127 bytes after the jr: 127 converts, 128 does not', () => {
    expect(run(unit('\tjp .T.1', ...nops(127), '.T.1:', '\tret'))[0]).toBe('\tjr .T.1');
    expect(run(unit('\tjp .T.1', ...nops(128), '.T.1:', '\tret'))[0]).toBe('\tjp .T.1');
  });

  it('the backward reach is 128 bytes counting the jr itself: 126 bytes of body converts, 127 does not', () => {
    expect(run(unit('.T.1:', ...nops(126), '\tjp .T.1'))[126 + 1]).toBe('\tjr .T.1');
    expect(run(unit('.T.1:', ...nops(127), '\tjp .T.1'))[127 + 1]).toBe('\tjp .T.1');
  });

  it('what it converts assembles to the same behaviour at the same targets, and is smaller', () => {
    const body = ['\tjp .T.1', ...nops(100), '.T.1:', '\tjp nz, .T.2', ...nops(10), '.T.2:', '\tjp .T.1'];
    const out = run(unit(...body));
    expect(asm(out).length).toBe(asm(body).length - 3);
    expect(out.filter((l) => l.startsWith('\tjr'))).toHaveLength(3);
  });

  it('converts a chain: a jump that fits only after another one shrank', () => {
    // 126 bytes between the first jp and its label, plus an inner jp that shrinks by one: 127 -> fits
    const out = run(unit('\tjp .T.1', '\tjp .T.2', ...nops(124), '.T.2:', ...nops(1), '.T.1:', '\tret'));
    expect(out[0]).toBe('\tjr .T.1');
    expect(out[1]).toBe('\tjr .T.2');
  });

  it('keeps jp across a line it cannot size, and across a label of another unit', () => {
    expect(run(unit('\tjp .T.1', '\tdefb 1, 2, 3', '.T.1:', '\tret'))[0]).toBe('\tjp .T.1');
    expect(run(unit('\tjp .T.9', '.T.1:', '\tret'))[0]).toBe('\tjp .T.9');
  });

  it('sizes opaque lines (a user ASM block) and counts a #line as nothing', () => {
    const u: CodeUnit = {
      procedure: null,
      quads: [],
      lines: [
        { text: '\tjp .T.1', kind: 'code', quad: 0 },
        { text: '#line 3 "a.bas"', kind: 'opaque', quad: 1 },
        ...nops(127).map((text): CodeLine => ({ text, kind: 'opaque', quad: 1 })),
        { text: '.T.1:', kind: 'code', quad: 2 },
      ],
    };
    expect(run(u)[0]).toBe('\tjr .T.1');
  });

  it('--opt-trace writes one comment line per conversion', () => {
    const out = run(unit('\tjp nz, .T.1', '.T.1:'), true);
    expect(out).toEqual(['\tjr nz, .T.1', '\t; opt jr: jp nz, .T.1', '.T.1:']);
  });

  it('a duplicate result: the unit is returned unchanged when nothing converts', () => {
    const u = unit('\tjp .T.9', '\tret');
    expect(runJr([u], env())[0]).toBe(u);
  });
});
