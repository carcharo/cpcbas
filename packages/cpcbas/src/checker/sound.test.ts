/** L4-SOUND: SOUND, ENV, ENT, RELEASE, SQ and BEEP in the checker. */
import { describe, expect, it } from 'vitest';
import { DiagnosticBag } from '../core/diagnostics.js';
import { SourceSet } from '../core/source.js';
import { bind } from '../binder/index.js';
import { runFrontEnd } from '../pipeline.js';
import { check } from './index.js';

function codes(text: string, bare = false): string[] {
  const sources = new SourceSet();
  const diag = new DiagnosticBag();
  const { program } = runFrontEnd({ files: new Map([['t.bas', text]]), main: 't.bas' }, sources, diag);
  check({ bound: bind({ program, sources, diagnostics: diag, bareMetal: bare }), sources, diagnostics: diag });
  return diag
    .all()
    .filter((d) => !/^W30\d$/.test(d.code))
    .map((d) => {
      const p = sources.position(d.span.file, d.span.start);
      return `${p.line}:${p.col} ${d.code}`;
    });
}

describe('the sound statements leave the E002 gate in firmware mode', () => {
  it('compile', () => {
    expect(codes('SOUND 1, 200')).toEqual([]);
    expect(codes('SOUND 1, 200, , 15')).toEqual([]);
    expect(codes('SOUND 1, 200, 50, 10, 2, 3, 4')).toEqual([]);
    expect(codes('ENV 1, 10, 2, 5, 5, -2, 4')).toEqual([]);
    expect(codes('ENV 1, 10, 2, 5, =10, 300')).toEqual([]);
    expect(codes('ENT -1, 20, 1, 2')).toEqual([]);
    expect(codes('ENV 1')).toEqual([]);
    expect(codes('RELEASE 7\nx = SQ(1)\nPRINT SQ(2) AND 7')).toEqual([]);
    expect(codes('BEEP 0.5, 12\nd = 1: BEEP d, d * 2')).toEqual([]);
  });
  it('REAL arguments are accepted as they are (Locomotive rounds them)', () => {
    expect(codes('x! = 2.5\nSOUND x!, 100.5')).toEqual([]);
  });
  it('a STRING argument is E230', () => {
    expect(codes('SOUND "a", 100')).toEqual(['1:7 E230']);
    expect(codes('x = SQ("a")')).toEqual(['1:8 E230']);
  });
  it('SQ is a UBYTE', () => {
    expect(codes('DIM u AS UBYTE\nu = SQ(1)')).toEqual([]);
  });
});

describe('bare builds: E270 for the firmware-only statements, none for BEEP', () => {
  for (const [text, word] of [
    ['SOUND 1, 100', 'SOUND'],
    ['ENV 1, 10, 2, 5', 'ENV'],
    ['ENT 1, 10, 2, 5', 'ENT'],
    ['RELEASE 1', 'RELEASE'],
    ['x = SQ(1)', 'SQ'],
  ] as const) {
    it(word, () => {
      const sources = new SourceSet();
      const diag = new DiagnosticBag();
      const { program } = runFrontEnd({ files: new Map([['t.bas', text]]), main: 't.bas' }, sources, diag);
      check({ bound: bind({ program, sources, diagnostics: diag, bareMetal: true }), sources, diagnostics: diag });
      const d = diag.all().filter((x) => x.code === 'E270');
      expect(d).toHaveLength(1);
      expect(d[0]?.message).toContain(word);
      expect(d[0]?.hint).toContain('music/sfx library');
    });
  }
  it('BEEP compiles in a bare build', () => {
    expect(codes('BEEP 0.5, 12\nd = 1: BEEP d, 3', true)).toEqual([]);
  });
});

describe('E273: the shape of ENV and ENT sections', () => {
  it('says what a section is (R16)', () => {
    const sources = new SourceSet();
    const diag = new DiagnosticBag();
    const { program } = runFrontEnd({ files: new Map([['t.bas', 'ENV 1, 1']]), main: 't.bas' }, sources, diag);
    check({ bound: bind({ program, sources, diagnostics: diag, bareMetal: false }), sources, diagnostics: diag });
    const msgs = diag.all().filter((d) => d.code === 'E273').map((d) => d.message);
    expect(msgs).toEqual(['ENV takes sections of 3 values, or of `=` and 2 values']);
  });
  it('a section is three values, or = and two', () => {
    expect(codes('ENV 1, 1, 1')).toEqual(['1:8 E273']);
    expect(codes('ENV 1, 1, 1, 1, 1')).toEqual(['1:8 E273']);
    expect(codes('ENT 1, 1')).toEqual(['1:8 E273']);
    expect(codes('ENV 1, =1')).toEqual(['1:9 E273']);
    expect(codes('ENT 1, 1, 1, 1, =1')).toEqual(['1:8 E273']);
    expect(codes('ENV 1, =1, 2, 3')).toEqual(['1:9 E273']);
  });
  it('at most five sections', () => {
    const five = Array.from({ length: 15 }, () => '1').join(', ');
    expect(codes(`ENV 1, ${five}`)).toEqual([]);
    expect(codes(`ENV 1, ${five}, 1, 1, 1`)).toEqual(['1:1 E147']); // more than 16 arguments: the parser's arity error
    expect(codes('ENT 1, =1, 1, =1, 1, =1, 1, =1, 1, =1, 1')).toEqual([]);
    expect(codes('ENT 1, =1, 1, =1, 1, =1, 1, =1, 1, =1, 1, =1, 1')).toEqual(['1:9 E273']);
  });
});

describe('E274: constants that do not fit 16 bits (Locomotive: Overflow)', () => {
  it('SOUND, RELEASE, ENV, ENT', () => {
    expect(codes('SOUND 1, 100, 32768')).toEqual(['1:15 E274']);
    expect(codes('SOUND 1, 100, -32768')).toEqual([]);
    expect(codes('SOUND 70000, 100')).toEqual(['1:7 E274']);
    expect(codes('SOUND 1, -40000')).toEqual(['1:10 E274']);
    expect(codes('RELEASE 65536')).toEqual(['1:9 E274']);
    expect(codes('ENV 1, =1, 65535')).toEqual([]);
    expect(codes('ENV 1, =1, 65536')).toEqual(['1:12 E274']);
    expect(codes('ENT 1, 1, 1, 70000')).toEqual(['1:14 E274']);
  });
  it('a value out of its own range but inside 16 bits is left to the run time (error 5)', () => {
    expect(codes('SOUND 300, 5000, 1, 99, 99, 99, 99')).toEqual([]);
    expect(codes('ENV 99, 500, 500, 500')).toEqual([]);
  });
});

describe('E275: BEEP constants (the reference compiler ranges)', () => {
  it('duration 0..10, pitch -60..127', () => {
    expect(codes('BEEP 10, 127\nBEEP 0, -60')).toEqual([]);
    expect(codes('BEEP 11, 0')).toEqual(['1:6 E275']);
    expect(codes('BEEP -1, 0')).toEqual(['1:6 E275']);
    expect(codes('BEEP 1, 128')).toEqual(['1:9 E275']);
    expect(codes('BEEP 1, -61')).toEqual(['1:9 E275']);
  });
  it('a run-time value is not checked at compile time', () => {
    expect(codes('d = 50: BEEP d, 300')).toEqual(['1:17 E275']);
    expect(codes('d = 50: p = 300: BEEP d, p')).toEqual([]);
  });
});
