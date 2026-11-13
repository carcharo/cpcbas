import { describe, expect, it } from 'vitest';
import { lexLine } from './lexer.js';
import type { LexError } from './lexer.js';

function lex(text: string): Array<[string, string | number]> {
  const errors: LexError[] = [];
  const toks = lexLine(text, errors);
  expect(errors).toEqual([]);
  return toks.filter((t) => t.kind !== 'eol').map((t) => [t.kind, t.kind === 'int' ? t.value : t.text]);
}

describe('asm lexer', () => {
  it('reads every number form of the reference', () => {
    expect(lex('10 0ffh 1Ah $FF 0x1f %0101 0b101 1_000 0FF_FFh')).toEqual([
      ['int', 10],
      ['int', 0xff],
      ['int', 0x1a],
      ['int', 0xff],
      ['int', 0x1f],
      ['int', 5],
      ['int', 5],
      ['int', 1000],
      ['int', 0xffff],
    ]);
  });

  it('tries the rules in the reference order: 1bh is hex, 1b is a temporary label, 0b1 is binary', () => {
    expect(lex('1bh 1b 1F 10b 0b1')).toEqual([
      ['int', 0x1b],
      ['id', '1B'],
      ['id', '1F'],
      ['id', '10B'],
      ['int', 1],
    ]);
  });

  it('reads character constants, strings with doubled quotes, and drops comments', () => {
    expect(lex(`'A' "say ""hi""" ; comment 'x'`)).toEqual([
      ['int', 65],
      ['str', 'say "hi"'],
    ]);
  });

  it('separates % the operator from %101 the number, and $ the address from $ff', () => {
    expect(lex('foo % 3')).toEqual([
      ['id', 'foo'],
      ['op', '%'],
      ['int', 3],
    ]);
    expect(lex('$+2')).toEqual([
      ['op', '$'],
      ['op', '+'],
      ['int', 2],
    ]);
  });

  it('classifies keywords case-insensitively and keeps label case', () => {
    expect(lex('LD a,(HL) Foo.Bar _x db dw ds defm')).toEqual([
      ['kw', 'LD'],
      ['kw', 'A'],
      ['op', ','],
      ['op', '('],
      ['kw', 'HL'],
      ['op', ')'],
      ['id', 'Foo.Bar'],
      ['id', '_x'],
      ['kw', 'DEFB'],
      ['kw', 'DEFW'],
      ['kw', 'DEFS'],
      ['kw', 'DEFB'],
    ]);
  });

  it('reads << >> and the single-character operators', () => {
    expect(lex('1<<2>>3&4|5~6^7')).toEqual([
      ['int', 1],
      ['op', '<<'],
      ['int', 2],
      ['op', '>>'],
      ['int', 3],
      ['op', '&'],
      ['int', 4],
      ['op', '|'],
      ['int', 5],
      ['op', '~'],
      ['int', 6],
      ['op', '^'],
      ['int', 7],
    ]);
  });

  it('reports illegal characters and carries on', () => {
    const errors: LexError[] = [];
    const toks = lexLine('ld a,@5', errors);
    expect(errors).toEqual([{ col: 5, char: '@' }]);
    expect(toks.length).toBeGreaterThan(3);
  });
});
