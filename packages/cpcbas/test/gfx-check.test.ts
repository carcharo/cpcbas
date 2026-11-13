/**
 * L4-GFX in the checker: the graphics and colour statements are out of the E002 gate, and a bare build
 * refuses what only the firmware can do with E270 (SPEED INK, MASK, FILL, ORIGIN's window, the ink mode of PLOT and the
 * others, GRAPHICS PEN's background mode) while the rest compiles.
 */
import { describe, expect, it } from 'vitest';
import { bind } from '../src/binder/index.js';
import { check } from '../src/checker/index.js';
import { DiagnosticBag } from '../src/core/diagnostics.js';
import { SourceSet } from '../src/core/source.js';
import { runFrontEnd } from '../src/pipeline.js';

/** `line:col CODE` of every diagnostic. */
function where(text: string, bare: boolean): string[] {
  const sources = new SourceSet();
  const diag = new DiagnosticBag();
  const { program } = runFrontEnd({ files: new Map([['t.bas', text]]), main: 't.bas' }, sources, diag);
  check({ bound: bind({ program, sources, diagnostics: diag, bareMetal: bare }), sources, diagnostics: diag });
  return diag.all().map((d) => {
    const p = sources.position(d.span.file, d.span.start);
    return `${p.line}:${p.col} ${d.code}`;
  });
}

const FIRMWARE_ONLY = ['SPEED INK 1,2', 'MASK 15', 'FILL 2'];
const BOTH = [
  'CLG',
  'CLG 2',
  'ORIGIN 10,20',
  'GRAPHICS PEN 2',
  'GRAPHICS PAPER 1',
  'PLOT 1,2',
  'PLOT 1,2,3',
  'PLOT 1,2,3,0',
  'PLOTR 1,2,,0',
  'MOVE 1,2',
  'MOVER 1,2',
  'DRAW 1,2,3',
  'DRAWR 1,2',
  'INK 1,2',
  'INK 1,2,3',
  'CIRCLE 10,10,5',
  'a = TEST(1,2): b = TESTR(1,2): c = XPOS: d = YPOS: e = POINT(1,2)',
];

describe('the graphics statements are out of the E002 gate', () => {
  it('every one of them is accepted in a firmware build, with its optional arguments', () => {
    for (const src of [...BOTH, ...FIRMWARE_ONLY, 'ORIGIN 1,2,3,4,5,6', 'PLOT 1,2,3,1', 'DRAW 1,2,,3', 'GRAPHICS PEN 1,1', 'GRAPHICS PEN ,1', 'MASK ,1', 'MASK 3,1']) {
      expect(where(src, false), src).toEqual([]);
    }
  });
  it('a string argument is a type error, not E002', () => {
    expect(where('PLOT "a",1', false)).not.toEqual([]);
    expect(where('PLOT "a",1', false).every((w) => !w.endsWith('E002'))).toBe(true);
    expect(where('a$ = "x": INK a$,1', false)).not.toEqual([]);
  });
});

describe('bare builds', () => {
  it('compile what has a bare version: coordinates, pens, CLG, ORIGIN x, y, INK, CIRCLE, POINT, TEST, XPOS, YPOS', () => {
    for (const src of BOTH) expect(where(src, true), src).toEqual([]);
  });
  it('refuse SPEED INK, MASK and FILL with E270 at the statement', () => {
    for (const src of FIRMWARE_ONLY) expect(where(src, true), src).toEqual(['1:1 E270']);
  });
  it("refuse ORIGIN's window part at its first window argument", () => {
    expect(where('ORIGIN 1,2,3,4,5,6', true)).toEqual(['1:12 E270']);
    expect(where('x = 3\nORIGIN 1,2,x,4,5,6', true)).toEqual(['2:12 E270']);
  });
  it('refuse the ink mode of every PLOT, MOVE and DRAW form unless it is a literal 0', () => {
    for (const k of ['PLOT', 'PLOTR', 'MOVE', 'MOVER', 'DRAW', 'DRAWR']) {
      expect(where(`${k} 1,2,3,1`, true), k).toEqual([`1:${k.length + 8} E270`]);
      expect(where(`${k} 1,2,,2`, true), k).toEqual([`1:${k.length + 7} E270`]);
      expect(where(`m = 0\n${k} 1,2,3,m`, true), k).toEqual([`2:${k.length + 8} E270`]);
      expect(where(`${k} 1,2,3,0`, true), k).toEqual([]);
    }
  });
  it("refuse GRAPHICS PEN's background mode", () => {
    expect(where('GRAPHICS PEN 1,1', true)).toEqual(['1:16 E270']);
    expect(where('GRAPHICS PEN ,0', true)).toEqual(['1:15 E270']);
    expect(where('GRAPHICS PEN 3', true)).toEqual([]);
  });
});
