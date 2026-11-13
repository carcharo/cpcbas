import { describe, expect, it } from 'vitest';
import { SourceSet, computeLineStarts, decodeText, dirname, joinPath, normalizePath } from './source.js';

describe('positions', () => {
  it('lines end at \\n, \\r\\n and a lone \\r', () => {
    expect(computeLineStarts('a\nb\r\nc\rd')).toEqual([0, 2, 5, 7]);
  });

  it('position() gives 1-based line and column, clamped', () => {
    const s = new SourceSet();
    const f = s.add('m.bas', '10 PRINT "x"\n20 GOTO 10\n');
    expect(s.position(f.id, 0)).toMatchObject({ line: 1, col: 1 });
    expect(s.position(f.id, 3)).toMatchObject({ line: 1, col: 4 });
    expect(s.position(f.id, 13)).toMatchObject({ line: 2, col: 1 });
    expect(s.position(f.id, 999)).toMatchObject({ line: 3, col: 1 });
    expect(s.offsetAt(f.id, 2, 4)).toBe(16);
  });

  it('registering a path twice returns the same file id', () => {
    const s = new SourceSet();
    const a = s.add('lib/./a.bas', 'x');
    const b = s.add('lib/a.bas', 'y');
    expect(b.id).toBe(a.id);
    expect(b.text).toBe('x');
  });
});

describe('virtual paths', () => {
  it('normalises', () => {
    expect(normalizePath('a\\b/../c//d.bas')).toBe('a/c/d.bas');
    expect(normalizePath('/lib/./runtime/../x.asm')).toBe('/lib/x.asm');
    expect(normalizePath('../x')).toBe('../x');
    expect(dirname('games/main.bas')).toBe('games');
    expect(dirname('main.bas')).toBe('.');
    expect(joinPath('games', 'lib/x.bas')).toBe('games/lib/x.bas');
    expect(joinPath('games', '/abs.bas')).toBe('/abs.bas');
  });
});

describe('decodeText', () => {
  it('decodes UTF-8 and drops a BOM', () => {
    const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, 0x41, 0xc2, 0xa3, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x98, 0x80]);
    expect(decodeText(bytes)).toBe('A£€😀');
    expect(decodeText(Uint8Array.from([0x41, 0xff, 0x42]))).toBe('A�B');
  });
});
