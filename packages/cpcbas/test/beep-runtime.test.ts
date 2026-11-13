/**
 * L5-GAP target 2: a run-time BEEP is one runtime routine (`__LOCO_BEEP`, lib/loco/beep.asm) at every level, firmware and
 * bare; the constant BEEP is still folded at compile time.
 */
import { describe, expect, it } from 'vitest';
import { asmAt, compareLevels, type Program } from './opt-harness.js';

const RUN_TIME = [
  'DIM d AS FLOAT',
  'DIM p AS INTEGER',
  'd = 0.1: p = 12',
  'BEEP d, p',
  'd = 0.25: p = -12',
  'BEEP d, p',
  'd = 30: p = 500',
  'BEEP d, p',
  'd = -1: p = -500',
  'BEEP d, p',
  'PRINT "done"',
].join('\n');

const prog = (name: string, text: string, defines: Record<string, string> = {}): Program => ({ name, files: text, defines });

describe('run-time BEEP', () => {
  it('links one routine and no inline arithmetic, at every level', () => {
    for (const level of [0, 1, 2, 3, 's'] as const) {
      const asm = asmAt(prog('rt', RUN_TIME), level).asm;
      expect(asm).not.toBe('');
      expect(asm.match(/call \.core\.__LOCO_BEEP/g)?.length, `-O${level}`).toBe(4);
      expect(asm, `-O${level}`).not.toMatch(/call \.core\.__BEEPER/);
      expect(asm, `-O${level}`).toContain('loco/beep.asm');
    }
  });
  it('a constant BEEP is folded: __BEEPER is called and __LOCO_BEEP is not linked', () => {
    const asm = asmAt(prog('const', 'BEEP 0.1, 12\nBEEP 0.5, 0'), 's').asm;
    expect(asm).toMatch(/call \.core\.__BEEPER/);
    expect(asm).not.toContain('__LOCO_BEEP');
  });
  it('the duration is read before the pitch expression runs a FUNCTION that changes it', () => {
    const src = [
      'DIM d AS FLOAT',
      'FUNCTION Bump() AS INTEGER',
      '  d = 5',
      '  RETURN 3',
      'END FUNCTION',
      'd = 0.1',
      'BEEP d, Bump()',
      'PRINT d',
    ].join('\n');
    const v = compareLevels(prog('order', src), [1, 2, 3, 's'], { requireRun: true });
    expect(v.detail).toBe('');
    expect(v.kind).toBe('ok');
  });
  it('the transcript and data equal -O0 at every optimised level (firmware; the bare build waits for frames the simulator does not run: tools/conformance.py --bare)', () => {
    const v = compareLevels(prog('rt', RUN_TIME), [1, 2, 3, 's'], { requireRun: true });
    expect(v.detail).toBe('');
    expect(v.kind).toBe('ok');
  });
  it('a bare build links the routine too', () => {
    const asm = asmAt(prog('rt', RUN_TIME, { CPC_BAREMETAL: '' }), 's').asm;
    expect(asm).toContain('loco/beep.asm');
    expect(asm.match(/call \.core\.__LOCO_BEEP/g)?.length).toBe(4);
  });
});
