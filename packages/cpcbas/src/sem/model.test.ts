import { describe, expect, it } from 'vitest';
import { globalLabel, identityKey, lineLabel, typeKey } from './model.js';

describe('sem/model helpers', () => {
  it('keys variable identities by type class', () => {
    expect(typeKey('INTEGER')).toBe('%');
    expect(typeKey('REAL')).toBe('!');
    expect(typeKey('STRING')).toBe('$');
    expect(typeKey('UBYTE')).toBe('UBYTE');
    expect(identityKey('a', '%')).toBe('a%');
    expect(identityKey('a', 'UBYTE')).toBe('a:UBYTE');
  });

  it('mangles asm labels', () => {
    expect(globalLabel('Score', null, false)).toBe('_Score');
    expect(globalLabel('n', '%', false)).toBe('_n__i');
    expect(globalLabel('x', '!', false)).toBe('_x__r');
    expect(globalLabel('name', '$', false)).toBe('_name__s');
    expect(globalLabel('map', null, true)).toBe('_map__a');
    expect(globalLabel('t', '$', true)).toBe('_t__s__a');
    expect(lineLabel({ number: 100, key: null })).toBe('.L.100');
    expect(lineLabel({ number: null, key: 'loop' })).toBe('.L.loop');
  });
});
