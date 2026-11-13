import { describe, expect, it } from 'vitest';
import { FN_SIGS, STMT_SIGS } from './builtins.js';

// The tables as they were written by hand before they were derived from the keyword table.
const STMT_LEGACY = {
  LOCATE: ['int', 'int'],
  MODE: ['int'],
  PEN: ['int', 'int'],
  PAPER: ['int'],
  BORDER: ['int', 'int'],
  CLS: [],
  INK: ['int', 'int', 'int'],
  OUT: ['addr', 'int'],
  ZONE: ['int'],
  PLOT: ['int', 'int', 'int', 'int'],
  DRAW: ['int', 'int', 'int', 'int'],
  MOVE: ['int', 'int', 'int', 'int'],
  SOUND: ['num', 'num', 'num', 'num', 'num', 'num', 'num'],
  ENV: ['num', 'num'],
  ENT: ['num', 'num'],
  RELEASE: ['num'],
  BEEP: ['num', 'num'],
  // R14: the rest of L4-GFX's statements
  'SPEED INK': ['int', 'int'],
  CLG: ['int'],
  ORIGIN: ['int', 'int', 'int', 'int', 'int', 'int'],
  'GRAPHICS PEN': ['int', 'int'],
  'GRAPHICS PAPER': ['int'],
  PLOTR: ['int', 'int', 'int', 'int'],
  MOVER: ['int', 'int', 'int', 'int'],
  DRAWR: ['int', 'int', 'int', 'int'],
  MASK: ['int', 'int'],
  FILL: ['int'],
  CIRCLE: ['int', 'int', 'int'],
};

const FN_LEGACY = {
  INKEY$: [],
  LEN: ['str'],
  LEFT$: ['str', 'int'],
  RIGHT$: ['str', 'int'],
  MID$: ['str', 'int', 'int'],
  CHR$: ['int'],
  ASC: ['str'],
  VAL: ['str'],
  STR$: ['num'],
  SPACE$: ['int'],
  STRING$: ['int', 'strOrInt'],
  UPPER$: ['str'],
  LOWER$: ['str'],
  ABS: ['num'],
  INT: ['num'],
  FIX: ['num'],
  SGN: ['num'],
  CINT: ['num'],
  CREAL: ['num'],
  UNT: ['num'],
  MIN: ['num'],
  MAX: ['num'],
  TAB: ['int'],
  SPC: ['int'],
  INP: ['addr'],
  INKEY: ['int'],
  JOY: ['int'],
  RND: ['num'],
  RANDOM: ['int'],
  SQ: ['num'],
  // R14: L4-GFX's functions
  TEST: ['int', 'int'],
  TESTR: ['int', 'int'],
  POINT: ['int', 'int'],
};

describe('checker signatures derived from the keyword table', () => {
  it('equal the hand-written tables they replace', () => {
    expect(STMT_SIGS).toEqual(STMT_LEGACY);
    expect(FN_SIGS).toEqual(FN_LEGACY);
  });

  it.each(Object.entries(STMT_LEGACY))('statement %s', (name, kinds) => {
    expect(STMT_SIGS[name]).toEqual(kinds);
  });

  it.each(Object.entries(FN_LEGACY))('function %s', (name, kinds) => {
    expect(FN_SIGS[name]).toEqual(kinds);
  });
});
