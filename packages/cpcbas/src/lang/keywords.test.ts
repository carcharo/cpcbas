import { describe, expect, it } from 'vitest';
import { KEYWORDS, RESERVED_WORDS, SOFT_WORDS, isReserved, keywordOf, lookupKeyword } from './keywords.js';

describe('keyword table', () => {
  it('has one entry per (name, kind), canonical upper-case names', () => {
    const seen = new Set<string>();
    for (const k of KEYWORDS) {
      const canonical = k.kind === 'preprocessor' ? k.name.toLowerCase() : k.name.toUpperCase().replace(/\s+/g, ' ').trim();
      expect(k.name, k.name).toBe(canonical);
      const id = `${k.name}/${k.kind}`;
      expect(seen.has(id), `duplicate ${id}`).toBe(false);
      seen.add(id);
    }
  });

  it('gives aliases a target, dropped and later entries a hint', () => {
    for (const k of KEYWORDS) {
      if (k.status === 'dropped' || k.status === 'later') expect(k.hint, k.name).toBeTruthy();
      if (k.kind === 'function') expect(k.returns, k.name).toBeTruthy();
      if (k.form === 'builtin') expect(k.args, k.name).toBeTruthy();
    }
  });

  it('ROUND returns REAL, as the checker types it for every argument (Locomotive; review R12)', () => {
    expect(keywordOf('ROUND', 'function')?.returns).toBe('REAL');
  });

  it('reserves the words of reserved entries, not the soft ones', () => {
    expect(isReserved('print')).toBe(true);
    expect(isReserved('STR$')).toBe(true);
    expect(isReserved('GRAPHICS')).toBe(true);
    expect(RESERVED_WORDS.has('OVER')).toBe(false);
    expect(SOFT_WORDS.has('OVER')).toBe(true);
    expect(isReserved('list')).toBe(false);
  });

  it('looks up by name and kind', () => {
    expect(lookupKeyword('mid$').map((k) => k.kind).sort()).toEqual(['function', 'statement']);
    expect(keywordOf('graphics  pen', 'statement')?.args).toEqual({ min: 0, max: 2 });
  });

  it('gives every built-in statement and function with arguments kinds that match args', () => {
    let covered = 0;
    for (const k of KEYWORDS) {
      const builtin = k.form === 'builtin' || (k.kind === 'function' && k.args !== undefined);
      if (!builtin) {
        expect(k.params, `${k.name}/${k.kind}`).toBeUndefined();
        continue;
      }
      covered++;
      const id = `${k.name}/${k.kind}`;
      const params = k.params;
      const args = k.args;
      expect(params, id).toBeDefined();
      expect(args, id).toBeDefined();
      if (!params || !args) continue;
      const names = params.map((p) => p.name);
      expect(new Set(names).size, `${id} param names`).toBe(names.length);
      const required = params.filter((p) => !p.optional).length;
      // PEN may leave the ink empty (emptyArgs + optionalFirst): its min counts the slot.
      expect(required, `${id} required`).toBeLessThanOrEqual(args.min);
      expect(args.min, id).toBeLessThanOrEqual(params.length);
      const repeats = params.some((p) => p.repeat);
      if (repeats) {
        expect(params[params.length - 1]?.repeat, `${id} only the last param repeats`).toBe(true);
        expect(args.max, id).toBeGreaterThanOrEqual(params.length);
      } else {
        expect(params.length, id).toBeLessThanOrEqual(args.max);
        expect(args.max, `${id} max`).toBe(params.length);
      }
      if (args.max === Infinity) expect(repeats, id).toBe(true);
      // Optional params only make sense for counts below the maximum; a leading one is first.
      params.forEach((p, i) => {
        if (p.leading) {
          expect(p.optional, id).toBe(true);
          expect(i, id).toBe(0);
        }
        if (p.optional && !p.leading && !repeats) {
          // Every param after the first optional (non-leading) one is optional too.
          expect(params.slice(i).every((q) => q.optional), `${id} optional tail`).toBe(true);
        }
      });
    }
    expect(covered).toBeGreaterThanOrEqual(120);
  });

  it('describes the alternative forms', () => {
    const by = (n: string, kind: 'statement' | 'function') => keywordOf(n, kind)?.params ?? [];
    expect(by('STRING$', 'function').map((p) => p.kind)).toEqual(['int', 'strOrInt']);
    expect(by('MID$', 'function').map((p) => !!p.optional)).toEqual([false, false, true]);
    expect(by('PEN', 'statement').map((p) => !!p.optional)).toEqual([true, true]);
    expect(by('INSTR', 'function').map((p) => !!p.leading)).toEqual([true, false, false]);
    expect(by('MIN', 'function').map((p) => !!p.repeat)).toEqual([true]);
    expect(keywordOf('MID$', 'statement')?.params).toBeUndefined();
  });

  it('marks as checked only entries whose kinds the checker enforces', () => {
    const names = KEYWORDS.filter((k) => k.checked).map((k) => `${k.name}/${k.kind}`);
    expect(names).toHaveLength(61);
    for (const k of KEYWORDS) if (k.checked) expect(k.params, k.name).toBeDefined();
  });
});

