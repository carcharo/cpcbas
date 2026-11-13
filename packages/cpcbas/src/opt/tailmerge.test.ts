/**
 * L5-CG: the `tailmerge` pass. Units are built by hand to show what it merges and what it never touches; BASIC programs show that
 * the shared exits run (Lamplighter's string FUNCTION with a dozen RETURNs) and are smaller at -Os than at -O2.
 */
import { describe, expect, it } from 'vitest';
import { assembleText } from '../../test/z80sim/run.js';
import { asmAt, compareLevels, type Program } from '../../test/opt-harness.js';
import type { CodeLine, CodeUnit } from '../codegen/types.js';
import { makeTarget } from '../codegen/index.js';
import { runTailMerge } from './tailmerge.js';
import { levelSpec, type PassEnv } from './index.js';

const env = (trace = false): PassEnv => ({ spec: levelSpec('s'), target: makeTarget({}), trace, enabled: () => true });
type L = string | CodeLine;
const line = (l: L): CodeLine => (typeof l === 'string' ? { text: l, kind: l.startsWith('#') ? 'opaque' : 'code', quad: 0 } : l);
const unit = (...ls: L[]): CodeUnit => ({ procedure: null, quads: [], lines: ls.map(line) });
const text = (u: CodeUnit): string[] => u.lines.map((l) => l.text);
/** Assembled size; the labels the hand-made units name are defined after them (their bytes are not counted). */
const bytes = (units: readonly CodeUnit[]): number => {
  const body = units.flatMap(text);
  const defs = ['_F__exit', '.core.__STORE_STR'].filter((n) => !body.includes(`${n}:`)).map((n) => `${n}:`);
  return assembleText(`\torg 0x4000\n${body.join('\n')}\n${defs.join('\n')}\n`).bytes.length;
};

const TAIL = ['\tpush ix', '\tpop hl', '\tld bc, 65534', '\tadd hl, bc', '\tcall .core.__STORE_STR', '\tjp _F__exit'];

describe('tailmerge', () => {
  it('shares a tail ending in jp between runs: the middle one keeps it, the others jump to its label', () => {
    const u = unit('\tld de, 1', ...TAIL, '.T.1:', '\tld de, 2', ...TAIL, '.T.2:', '\tld de, 3', ...TAIL, '_F__exit:', '\tret');
    const out = runTailMerge([u], env())[0] as CodeUnit;
    const t = text(out);
    expect(t.filter((x) => x === '\tcall .core.__STORE_STR')).toHaveLength(1);
    expect(t.filter((x) => /^\tjp \.T\.\d+$/.test(x))).toHaveLength(2);
    // the second run keeps the tail (members in order, the middle one): its label precedes `push ix`
    const label = t[t.indexOf('\tpush ix') - 1] as string;
    expect(label).toMatch(/^\.T\.\d+:$/);
    expect(t.indexOf(label)).toBeGreaterThan(t.indexOf('.T.1:'));
    expect(bytes([out])).toBe(bytes([u]) - 2 * (13 - 3));
  });

  it('merges across units (STDCALL exits of different procedures)', () => {
    const leave = ['\tld sp, ix', '\tpop ix', '\texx', '\tpop hl', '\tpop bc', '\tex (sp), hl', '\texx', '\tret'];
    const a = unit('_A__leave:', ...leave);
    const b = unit('_B__leave:', ...leave);
    const out = runTailMerge([a, b], env());
    expect(out.flatMap(text).filter((x) => x === '\tret')).toHaveLength(1);
    expect(out.flatMap(text).filter((x) => x.startsWith('\tjp .T.'))).toHaveLength(1);
    expect(bytes(out)).toBeLessThan(bytes([a, b]));
  });

  it('leaves a tail that would not save a byte (a jp is 3 bytes)', () => {
    const u = unit('\tld a, 1', '\tret', '.T.1:', '\tld a, 2', '\tret', '.T.2:', '\tld a, 3', '\tret');
    expect(runTailMerge([u], env())[0]).toBe(u);
    const v = unit('\tpop ix', '\tret', '.T.1:', '\tpop ix', '\tret'); // 3 bytes of tail: no gain
    expect(runTailMerge([v], env())[0]).toBe(v);
  });

  it('never merges across a label, a statement boundary, an ASM block or a line the table cannot size', () => {
    const tail = ['\tpush ix', '\tpop hl', '\tld bc, 65534', '\tadd hl, bc', '\tjp _F__exit'];
    for (const breaker of ['.T.9:', { text: '', kind: 'boundary', quad: 0 } as CodeLine, { text: '\tnop', kind: 'opaque', quad: 0 } as CodeLine, '\tdefb 1']) {
      const u = unit(...tail.slice(0, 2), breaker, ...tail.slice(2), '.T.1:', ...tail.slice(0, 2), breaker, ...tail.slice(2));
      const out = text(runTailMerge([u], env())[0] as CodeUnit);
      // only the part after the breaker (3 instructions, 7 bytes) is shared
      expect(out.filter((x) => x === '\tpush ix')).toHaveLength(2);
      expect(out.filter((x) => x === '\tadd hl, bc')).toHaveLength(1);
    }
  });

  it('never moves the event poll: it stays in both runs, only what follows it is shared', () => {
    const tail = ['\tld a, 1', '\tcall .core.__EVENT_POLL', '\tld bc, 65534', '\tjp _F__exit'];
    const t = text(runTailMerge([unit(...tail, '.T.1:', ...tail)], env())[0] as CodeUnit);
    expect(t.filter((x) => x === '\tcall .core.__EVENT_POLL')).toHaveLength(2);
    expect(t.filter((x) => x === '\tld bc, 65534')).toHaveLength(1);
  });

  it('writes a trace line per change and counts them', () => {
    const u = unit('\tld de, 1', ...TAIL, '.T.1:', '\tld de, 2', ...TAIL);
    const stats = { merges: 0, bytes: 0 };
    const t = text(runTailMerge([u], env(true), stats)[0] as CodeUnit);
    expect(t.filter((x) => x.startsWith('\t; opt tailmerge'))).toHaveLength(2);
    expect(stats).toEqual({ merges: 1, bytes: 10 });
  });
});

describe('tailmerge on programs', () => {
  const names = Array.from({ length: 9 }, (_, i) => `"room ${i} is here"`);
  const source = `
FUNCTION Name$(n AS INTEGER) AS STRING
${names.map((s, i) => `  IF n = ${i} THEN RETURN ${s}`).join('\n')}
  RETURN "none"
END FUNCTION

FUNCTION Pick%(n AS INTEGER) AS INTEGER
  IF n = 1 THEN RETURN 11
  IF n = 2 THEN RETURN 22
  RETURN 0
END FUNCTION

FOR i = 0 TO 10
  PRINT Name$(i); Pick%(i)
NEXT i
`;
  const program: Program = { name: 'tailmerge-names', files: source };

  it('the shared exits run: the -Os program prints what -O2 prints', () => {
    const v = compareLevels(program, [2, 's'], { requireRun: true });
    expect(v.kind, v.detail).toBe('ok');
  });

  it('and -Os is smaller than -O2 by the merged RETURNs', () => {
    const at = (l: 2 | 's'): number => asmAt(program, l).image?.bytes.length ?? 0;
    expect(at('s')).toBeLessThan(at(2) - 9 * 5);
  });
});
