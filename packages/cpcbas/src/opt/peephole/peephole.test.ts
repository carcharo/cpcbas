/**
 * L5-PEEP: the rule language, the engine and every rule (a case that fires and one that does not, per rule).
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CodeLine, CodeUnit } from '../../codegen/types.js';
import type { Quad } from '../../ir/ir.js';
import { lazyTree as diskTree } from '../../node/index.js';
import { libTree } from '../../../test/runtime-tree.js';
import { compile, type CompileOptions } from '../../index.js';
import { levelSpec, type PassEnv } from '../index.js';
import { evaluate, parseExpr } from './expr.js';
import { applyRules, makeCtx, newStats } from './engine.js';
import { RuleError } from './pattern.js';
import { parseRule } from './rule-parser.js';
import { allRules, removeUnusedLabels, rulesFor, runPeephole } from './pass.js';
import { RULE_SOURCES } from './rules.gen.js';
import { expandRegs, needs, touches } from './z80regs.js';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../../../../..');

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** A quad stand-in: only `op` and `type` matter to the engine (the dead-register test and `$00`). */
const quad = (key: string): Quad => {
  const [op, type] = key.split(':');
  return { op, ...(type !== undefined ? { type } : {}), span: null } as unknown as Quad;
};

interface Spec {
  /** The window's lines, without the tab (a label ends with a colon). All belong to quad 0 of key `q`. */
  readonly lines: readonly string[];
  /** The key of quad 0, `store:i16`, `add:u16`; default `load:i16` (a quad that leaves a value). */
  readonly q?: string;
  /** What follows: instruction lines (quad 1, `jump`), `|` for a boundary, `!` for an internal opaque asm line. Default: a boundary. */
  readonly tail?: readonly string[];
}

function unitOf(s: Spec): CodeUnit {
  const lines: CodeLine[] = s.lines.map((t) => ({ text: t.endsWith(':') ? t : `\t${t}`, kind: 'code', quad: 0 }));
  const quads: Quad[] = [quad(s.q ?? 'load:i16'), quad('jump')];
  for (const t of s.tail ?? ['|']) {
    if (t === '|') lines.push({ text: '', kind: 'boundary', quad: 1 });
    else if (t === '!') {
      quads.push({ op: 'asm', internal: true, lines: [], span: null } as unknown as Quad);
      lines.push({ text: '\tnop', kind: 'opaque', quad: quads.length - 1 });
    } else lines.push({ text: t.endsWith(':') ? t : `\t${t}`, kind: 'code', quad: 1 });
  }
  return { procedure: null, quads, lines };
}

const texts = (u: CodeUnit): string[] => u.lines.filter((l) => l.kind !== 'boundary').map((l) => l.text.trim());

/** Runs only `rule` (by name) over the spec and returns the unit's text. */
function run(rule: string, s: Spec, extra: readonly string[] = []): string[] {
  const rules = allRules().filter((r) => r.name === rule || extra.includes(r.name));
  expect(rules.map((r) => r.name), `rule ${rule} exists`).toContain(rule);
  return texts(applyRules(unitOf(s), makeCtx(rules, false)));
}

const tailOf = (s: Spec): string[] => (s.tail ?? ['|']).filter((t) => t !== '|').map((t) => (t === '!' ? 'nop' : t));

interface Case {
  readonly rule: string;
  readonly fires: readonly { readonly s: Spec; readonly out: readonly string[] }[];
  readonly not: readonly Spec[];
}

const S = (lines: string[], q?: string, tail?: string[]): Spec => ({ lines, ...(q !== undefined ? { q } : {}), ...(tail !== undefined ? { tail } : {}) });

// ---------------------------------------------------------------------------
// one fires case and one does-not-fire case per rule
// ---------------------------------------------------------------------------

const CASES: readonly Case[] = [
  { rule: '000_o1_push_pop', fires: [{ s: S(['push hl', 'pop hl']), out: [] }, { s: S(['push af', 'pop af']), out: [] }], not: [S(['push hl', 'pop de']), S(['push hl', 'pop hl'], undefined, ['!'])] },
  {
    rule: '001_o1_ld_xxyy_ldyyxx',
    fires: [{ s: S(['ld a, b', 'ld b, a']), out: ['ld a, b'] }, { s: S(['ld hl, de', 'ld de, hl']), out: ['ld hl, de'] }],
    not: [S(['ld a, (hl)', 'ld (hl), a']), S(['ld a, 5', 'ld 5, a']), S(['ld a, b', 'ld c, a'])],
  },
  {
    rule: '003_o1_useless_jp',
    fires: [{ s: S(['jp .T.1', '.T.1:']), out: ['.T.1:'] }, { s: S(['jp z, .T.1', '.T.1:']), out: ['.T.1:'] }],
    not: [S(['jp .T.1', '.T.2:']), S(['jp .T.1', 'ld a, 1', '.T.1:'])],
  },
  {
    rule: '006_o1_push_af_pop_xx',
    fires: [{ s: S(['push af', 'pop hl'], 'store:u8'), out: ['ld h, a'] }, { s: S(['push hl', 'pop af'], 'store:u8'), out: ['ld a, h'] }],
    not: [S(['push af', 'pop hl'], 'load:u8'), S(['push hl', 'pop de'], 'store:u8'), S(['push af', 'pop af'], 'store:u8')],
  },
  { rule: '007_o1_ex_de_hl', fires: [{ s: S(['ex de, hl', 'ex de, hl']), out: [] }, { s: S(['exx', 'exx']), out: [] }], not: [S(['ex de, hl', 'exx'])] },
  { rule: '010_o1_ld_de_hl_ex_de_hl', fires: [{ s: S(['push hl', 'pop de']), out: ['ld d, h', 'ld e, l'] }, { s: S(['push bc', 'pop hl']), out: ['ld h, b', 'ld l, c'] }], not: [S(['push hl', 'pop hl']), S(['push af', 'pop hl']), S(['push hl', 'pop ix'])] },
  {
    rule: '017_jp_cond_jp_labell',
    fires: [{ s: S(['jp z, .T.1', 'jp .T.2', '.T.1:']), out: ['jp nz, .T.2', '.T.1:'] }, { s: S(['jr nc, .T.1', 'jp .T.2', '.T.1:']), out: ['jp c, .T.2', '.T.1:'] }],
    not: [S(['jp z, .T.1', 'jp .T.2', '.T.3:']), S(['jp po, .T.1', 'jp .T.2', '.T.1:']), S(['jp z, .T.1', 'ld a, 1', '.T.1:'])],
  },
  {
    rule: '022_insr_a_or_a',
    fires: [{ s: S(['and 5', 'or a']), out: ['and 5'] }, { s: S(['xor b', 'and a']), out: ['xor b'] }, { s: S(['or h', 'or a']), out: ['or h'] }],
    not: [S(['cp 5', 'or a']), S(['sub 5', 'or a']), S(['inc a', 'or a']), S(['dec a', 'and a']), S(['and 5', 'xor a'])],
  },
  {
    rule: '028_o2_pop_up',
    fires: [{ s: S(['ld a, (_x)', 'pop hl']), out: ['pop hl', 'ld a, (_x)'] }, { s: S(['ld c, a', 'pop hl']), out: ['pop hl', 'ld c, a'] }],
    not: [
      S(['ld hl, 5', 'pop hl']),
      S(['ex de, hl', 'pop de']),
      S(['push de', 'pop hl']),
      S(['call f', 'pop hl']),
      S(['jp .T.1', 'pop hl']),
      S(['.T.1:', 'pop hl']),
      S(['add a, 1', 'pop af']),
      S(['ld (hl), a', 'pop hl']),
      S(['ld sp, hl', 'pop hl']),
      S(['ei', 'pop hl']),
    ],
  },
  { rule: '029_cp_0_or_a', fires: [{ s: S(['cp 0', 'jp z, .T.1']), out: ['or a', 'jp z, .T.1'] }, { s: S(['sub 0', 'ld l, a']), out: ['or a', 'ld l, a'] }], not: [S(['cp 0', 'jp po, .T.1']), S(['cp 0', 'jp pe, .T.1']), S(['cp 1', 'jp z, .T.1']), S(['ld a, 0', 'jp z, .T.1'])] },
  {
    rule: '031_jpx_y_jpx',
    fires: [{ s: S(['jp .T.1', 'ld a, 1']), out: ['jp .T.1'] }, { s: S(['jr .T.1', 'inc hl']), out: ['jr .T.1'] }, { s: S(['jp (hl)', 'ld a, 1']), out: ['jp (hl)'] }],
    not: [S(['jp .T.1', '.T.2:']), S(['jp z, .T.1', 'ld a, 1']), S(['jp .T.1', 'call .core.__EVENT_POLL']), S(['jp .T.1', 'rst 56']), S(['jp .T.1', 'DEFW .T.1'])],
  },
  // our own rules
  { rule: '502_ld_mem_a_ld_a_mem', fires: [{ s: S(['ld (_x), a', 'ld a, (_x)']), out: ['ld (_x), a'] }], not: [S(['ld (_x), a', 'ld a, (_y)']), S(['ld (hl), a', 'ld a, (hl)'])] },
  {
    rule: '503_ld_b_ld_a_op_b',
    fires: [
      { s: S(['ld b, 5', 'ld a, (_x)', 'xor b'], 'eq:u8'), out: ['ld a, (_x)', 'xor 5'] },
      { s: S(['ld b, c', 'ld a, (_x)', 'add a, b'], 'add:u8'), out: ['ld a, (_x)', 'add a, c'] },
      { s: S(['ld b, (ix-2)', 'ld a, 7', 'sbc a, b'], 'sub:i8'), out: ['ld a, 7', 'sbc a, (ix-2)'] },
    ],
    not: [
      S(['ld b, a', 'ld a, (_x)', 'xor b'], 'eq:u8'),
      S(['ld b, 5', 'ld a, b', 'xor b'], 'eq:u8'),
      S(['ld b, 5', 'ld a, (bc)', 'xor b'], 'eq:u8'),
      S(['ld b, 5', 'ld a, (_x)', 'cp b'], 'lt:u8'),
      S(['ld b, 5', 'ld a, (_x)', 'xor b'], 'gt:u8'),
    ],
  },
  { rule: '504_add_hl_1', fires: [{ s: S(['ld de, 1', 'ld hl, (_x)', 'add hl, de'], 'add:u16'), out: ['ld hl, (_x)', 'inc hl'] }], not: [S(['ld de, 1', 'ld hl, (_x)', 'add hl, de'], 'load:u16'), S(['ld de, 2', 'ld hl, (_x)', 'add hl, de'], 'add:u16'), S(['ld de, 1', 'ld hl, (_x)', 'add hl, de'], 'sub:u16')] },
  { rule: '505_add_hl_2', fires: [{ s: S(['ld de, 2', 'ld hl, 7', 'add hl, de'], 'add:i16'), out: ['ld hl, 7', 'inc hl', 'inc hl'] }], not: [S(['ld de, 3', 'ld hl, (_x)', 'add hl, de'], 'add:i16')] },
  { rule: '506_add_hl_3', fires: [{ s: S(['ld de, 3', 'ld hl, (_x)', 'add hl, de'], 'add:u16'), out: ['ld hl, (_x)', 'inc hl', 'inc hl', 'inc hl'] }], not: [S(['ld de, 3', 'ld hl, (_x)', 'adc hl, de'], 'add:u16')] },
  { rule: '507_sub_hl_1', fires: [{ s: S(['ld de, 1', 'ld hl, (_x)', 'or a', 'sbc hl, de'], 'sub:u16'), out: ['ld hl, (_x)', 'dec hl'] }], not: [S(['ld de, 1', 'ld hl, (_x)', 'or a', 'sbc hl, de'], 'add:u16'), S(['ld de, 1', 'ld hl, (_x)', 'sbc hl, de'], 'sub:u16')] },
  { rule: '509_sub_hl_3', fires: [{ s: S(['ld de, 3', 'ld hl, (_x)', 'or a', 'sbc hl, de'], 'sub:u16'), out: ['ld hl, (_x)', 'dec hl', 'dec hl', 'dec hl'] }], not: [S(['ld de, 3', 'ex de, hl', 'or a', 'sbc hl, de'], 'sub:u16')] },
  {
    rule: '510_ld_a_0_store',
    fires: [
      { s: S(['ld a, 0', 'ld (_x), a'], 'store:u8'), out: ['xor a', 'ld (_x), a'] },
      { s: S(['ld a, 0', 'ld (ix-3), a'], 'store:i8'), out: ['xor a', 'ld (ix-3), a'] },
      { s: S(['ld a, 0', 'ld (hl), a'], 'poke'), out: ['xor a', 'ld (hl), a'] },
    ],
    not: [
      S(['ld a, 0', 'ld (_x), a'], 'load:u8'), // the flags may be read after a quad that leaves a value
      S(['ld a, 1', 'ld (_x), a'], 'store:u8'),
      S(['ld a, 0', 'ld b, a'], 'store:u8'),
      S(['ld a, 0', 'ld (_x), a'], 'store:u8', ['!']), // an ASM block may read the flags
    ],
  },
  {
    rule: '511_ld_a_0_param',
    fires: [{ s: S(['ld a, 0', 'push af'], 'param:u8'), out: ['xor a', 'push af'] }, { s: S(['ld a, 0', 'push af'], 'param:i8'), out: ['xor a', 'push af'] }],
    not: [S(['ld a, 0', 'push af'], 'load:u8'), S(['ld a, 0', 'push af'], 'param:u16'), S(['ld a, 1', 'push af'], 'param:u8'), S(['ld a, 0', 'push hl'], 'param:u8')],
  },
];

describe('L5-PEEP: every rule fires on its pattern and not on its near misses', () => {
  for (const c of CASES) {
    it(c.rule, () => {
      for (const f of c.fires) {
        const out = run(c.rule, f.s);
        expect(out, `${c.rule}: ${f.s.lines.join(' / ')}`).toEqual([...f.out, ...tailOf(f.s)]);
      }
      for (const n of c.not) {
        if (n.lines.length === 0) continue;
        expect(run(c.rule, n), `${c.rule} must not fire on ${n.lines.join(' / ')}`).toEqual([...n.lines, ...tailOf(n)]);
      }
    });
  }

  it('every rule of OLEVEL 1 and 2 has a test above, and the OLEVEL 3 and 4 rules are data', () => {
    const tested = new Set(CASES.map((c) => c.rule));
    for (const r of allRules()) {
      if (r.level <= 2) expect(tested.has(r.name), `${r.name} has no test`).toBe(true);
    }
    const state = allRules().filter((r) => r.level >= 3);
    expect(state.length).toBe(18);
    for (const r of state) expect(rulesFor(2).includes(r), `${r.name} is not run at -O2`).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// the engine
// ---------------------------------------------------------------------------

describe('L5-PEEP: the engine', () => {
  const rules = (...names: string[]) => allRules().filter((r) => names.includes(r.name));
  const go = (u: CodeUnit, names: string[], trace = false) => applyRules(u, makeCtx(rules(...names), trace));

  it('rescans back after a rule fires: a removal exposes the next', () => {
    // push hl / push de / pop de / pop hl: the inner pair goes, then the outer
    const out = texts(go(unitOf(S(['push hl', 'push de', 'pop de', 'pop hl'])), ['000_o1_push_pop']));
    expect(out).toEqual([]);
  });

  it('a window never spans a boundary line', () => {
    const u: CodeUnit = {
      procedure: null,
      quads: [quad('load:i16'), quad('stmt')],
      lines: [
        { text: '\tpush hl', kind: 'code', quad: 0 },
        { text: '', kind: 'boundary', quad: 1 },
        { text: '\tpop hl', kind: 'code', quad: 1 },
      ],
    };
    expect(texts(go(u, ['000_o1_push_pop']))).toEqual(['push hl', 'pop hl']);
  });

  it('a window never contains an opaque line, nor ends directly before one', () => {
    const inside: CodeUnit = unitOf(S(['push hl'], 'load:i16', ['!']));
    expect(texts(go(inside, ['000_o1_push_pop']))).toEqual(['push hl', 'nop']);
    const before = unitOf(S(['push hl', 'pop hl'], 'load:i16', ['!']));
    expect(texts(go(before, ['000_o1_push_pop']))).toEqual(['push hl', 'pop hl', 'nop']);
    const after = unitOf(S(['push hl', 'pop hl'], 'load:i16', ['|', '!']));
    expect(texts(go(after, ['000_o1_push_pop']))).toEqual(['nop']);
  });

  it('a window ending before an internal opaque line is counted as refused (with trace)', () => {
    const u = unitOf(S(['push hl', 'pop hl'], 'load:i16', ['!']));
    const stats = newStats();
    const out = applyRules(u, makeCtx(rules('000_o1_push_pop'), true, stats));
    expect(stats.refused.get('asm-internal')).toBe(1);
    expect(texts(out)).toContain('; opt-refused 000_o1_push_pop: push hl / pop hl (asm-internal)');
    expect(stats.hits.size).toBe(0);
  });

  it('a window that would contain an internal opaque line is counted too', () => {
    const u: CodeUnit = {
      procedure: null,
      quads: [quad('load:i16'), { op: 'asm', internal: true, lines: [], span: null } as unknown as Quad],
      lines: [
        { text: '\tpush hl', kind: 'code', quad: 0 },
        { text: '\tpop hl', kind: 'opaque', quad: 1 },
      ],
    };
    const stats = newStats();
    applyRules(u, makeCtx(rules('000_o1_push_pop'), true, stats));
    expect(stats.refused.get('asm-internal')).toBe(1);
  });

  it('comment lines are skipped by the matcher and kept', () => {
    const u = unitOf(S(['push hl', '; a comment', 'pop hl']));
    const lines = u.lines.map((l, i) => (l.text.trim().startsWith(';') ? { ...l, text: '\t; a comment', kind: 'code' as const, quad: i } : l));
    const out = texts(go({ ...u, lines }, ['000_o1_push_pop']));
    expect(out).toEqual(['; a comment']);
  });

  it('a directive line (the inline table of a jump) is never matched, and ends a window', () => {
    const u = unitOf(S(['jp .T.1', 'DEFB 1', 'DEFW .T.2']));
    expect(texts(go(u, ['031_jpx_y_jpx']))).toEqual(['jp .T.1', 'DEFB 1', 'DEFW .T.2']);
  });

  it('a label line is matched only by a pattern line that is a label', () => {
    // 031 would match `jp L / L2:` with $3 = the label if the engine did not check; 003 names the label in its pattern
    expect(texts(go(unitOf(S(['jp .T.1', '.T.2:'])), ['031_jpx_y_jpx']))).toEqual(['jp .T.1', '.T.2:']);
    expect(texts(go(unitOf(S(['jp .T.1', '.T.1:'])), ['003_o1_useless_jp']))).toEqual(['.T.1:']);
  });

  it('a rewritten line keeps the quad of the line it came from (028 moves the pop with its quad)', () => {
    const u: CodeUnit = {
      procedure: null,
      quads: [quad('store:u8'), quad('load:i16')],
      lines: [
        { text: '\tld a, (_x)', kind: 'code', quad: 0 },
        { text: '\tpop hl', kind: 'code', quad: 1 },
      ],
    };
    const out = go(u, ['028_o2_pop_up']);
    expect(out.lines.map((l) => [l.text.trim(), l.quad])).toEqual([['pop hl', 1], ['ld a, (_x)', 0]]);
  });

  it('the dead-register test ($0): a store quad is dead at its last line, not before its other lines', () => {
    const dead = unitOf(S(['push af', 'pop hl'], 'store:u8', ['|']));
    expect(texts(go(dead, ['006_o1_push_af_pop_xx']))).toEqual(['ld h, a']);
    const notLast = unitOf(S(['push af', 'pop hl'], 'store:u8', ['ld (_x), hl']));
    // the quad's own next line has another quad here, so this is still dead: the tail belongs to quad 1
    expect(texts(go(notLast, ['006_o1_push_af_pop_xx']))).toEqual(['ld h, a', 'ld (_x), hl']);
    const same: CodeUnit = { procedure: null, quads: [quad('store:u8')], lines: ['\tpush af', '\tpop hl', '\tld (_x), hl'].map((text) => ({ text, kind: 'code' as const, quad: 0 })) };
    expect(texts(go(same, ['006_o1_push_af_pop_xx']))).toEqual(['push af', 'pop hl', 'ld (_x), hl']);
  });

  it('--opt-trace writes `; opt <rule>: <the window>` after the change', () => {
    const out = texts(go(unitOf(S(['push hl', 'pop hl'])), ['000_o1_push_pop'], true));
    expect(out).toEqual(['; opt 000_o1_push_pop: push hl / pop hl']);
  });

  it('is deterministic and idempotent', () => {
    const u = unitOf(S(['push hl', 'pop de', 'ld a, (_x)', 'pop bc', 'jp .T.1', 'inc a', '.T.1:']));
    const a = go(u, allRules().filter((r) => r.level <= 2).map((r) => r.name));
    const b = go(a, allRules().filter((r) => r.level <= 2).map((r) => r.name));
    expect(texts(b)).toEqual(texts(a));
  });
});

// ---------------------------------------------------------------------------
// the pass
// ---------------------------------------------------------------------------

const envFor = (level: 1 | 2 | 's', disable: string[] = [], trace = false): PassEnv => ({
  spec: levelSpec(level),
  trace,
  enabled: (n) => !disable.includes(n),
  target: undefined as never,
});

describe('L5-PEEP: the peephole pass', () => {
  const prog = (): CodeUnit =>
    unitOf(S(['jp .T.1', '.T.1:', 'push hl', 'pop hl', 'ld a, (_x)', 'pop bc'], 'load:i16', ['|']));

  it('-O1 runs the rules once and keeps every label', () => {
    const [u] = runPeephole([prog()], envFor(1));
    expect(texts(u as CodeUnit)).toEqual(['.T.1:', 'ld a, (_x)', 'pop bc']);
  });

  it('-O2 also removes the unused generated labels and runs a second round', () => {
    const [u] = runPeephole([prog()], envFor(2));
    expect(texts(u as CodeUnit)).toEqual(['pop bc', 'ld a, (_x)']);
  });

  it('the level selects the rules: 028 is OLEVEL 2', () => {
    expect(rulesFor(1).some((r) => r.name === '028_o2_pop_up')).toBe(false);
    expect(rulesFor(2).some((r) => r.name === '028_o2_pop_up')).toBe(true);
    expect(rulesFor(2).some((r) => r.level > 2)).toBe(false);
  });

  it('--opt-disable names a rule, `labels` the label removal, `peephole` the pass (by the registered name)', () => {
    const noRule = runPeephole([prog()], envFor(2, ['028_o2_pop_up']))[0] as CodeUnit;
    expect(texts(noRule)).toEqual(['ld a, (_x)', 'pop bc']);
    const noLabels = runPeephole([prog()], envFor(2, ['labels']))[0] as CodeUnit;
    expect(texts(noLabels)).toEqual(['.T.1:', 'pop bc', 'ld a, (_x)']);
  });

  it('removes only generated `.T.n` labels nobody names, in any unit, comment or opaque line', () => {
    const mk = (procedure: string | null, lines: [string, CodeLine['kind']?][]): CodeUnit => ({
      procedure,
      quads: [quad('label')],
      lines: lines.map(([text, kind]) => ({ text: text.endsWith(':') ? text : `\t${text}`, kind: kind ?? 'code', quad: 0 })),
    });
    const units = [
      mk(null, [['.T.1:'], ['.T.2:'], ['.T.3:'], ['.L.10:'], ['jp .T.2'], ['; .T.1 is only in a comment'], ['.T.4:'], ['ld a, 0', 'opaque'], ['dw .T.4', 'opaque']]),
      mk('.T.9', [['.T.9:'], ['jp .T.3']]),
    ];
    const out = removeUnusedLabels(units, false);
    expect(texts(out[0] as CodeUnit)).toEqual(['.T.2:', '.T.3:', '.L.10:', 'jp .T.2', '; .T.1 is only in a comment', '.T.4:', 'ld a, 0', 'dw .T.4']);
    expect(texts(out[1] as CodeUnit)).toEqual(['.T.9:', 'jp .T.3']);
  });

  it('a label named by a trace line is still removed (trace changes comments only)', () => {
    const a = runPeephole([prog()], envFor(2, [], false))[0] as CodeUnit;
    const b = runPeephole([prog()], envFor(2, [], true))[0] as CodeUnit;
    expect(texts(b).filter((t) => !t.startsWith(';'))).toEqual(texts(a));
  });
});

// ---------------------------------------------------------------------------
// the rule language
// ---------------------------------------------------------------------------

describe('L5-PEEP: the rule language', () => {
  const vars = (o: Record<string, string>) => new Map(Object.entries(o));
  const ev = (src: string, o: Record<string, string> = {}) => evaluate(parseExpr(src), vars(o));

  it('operators and precedences are the fork\'s', () => {
    expect(ev('$1 == hl', { $1: 'hl' })).toBe('True');
    expect(ev('$1 <> hl', { $1: 'hl' })).toBe('');
    expect(ev('($2 == "z") && "nc" || "c"', { $2: 'z' })).toBe('nc');
    expect(ev('($2 == "z") && "nc" || "c"', { $2: 'nz' })).toBe('c');
    expect(ev('$1 IN (or, and, xor)', { $1: 'and' })).toBe('True');
    expect(ev('$1 IN (or, and, xor)', { $1: 'cp' })).toBe('');
    expect(ev('"(" + $1 + ")"', { $1: 'x' })).toBe('(x)');
    expect(ev('!IS_REG16($1)', { $1: 'hl' })).toBe('');
    expect(ev('$1 .+ 1', { $1: '4' })).toBe('5');
    expect(ev('$1 .- 1 == 3', { $1: '4' })).toBe('True');
    expect(ev('', {})).toBe('True');
  });

  it('the functions', () => {
    expect(ev('IS_INDIR($1)', { $1: '(ix+5)' })).toBe('True');
    expect(ev('IS_INDIR($1)', { $1: '(hl)' })).toBe('');
    expect(ev('IS_REG8($1)', { $1: 'a' })).toBe('True');
    expect(ev('IS_LABEL($1)', { $1: '.T.1:' })).toBe('True');
    expect(ev('LEN($1)', { $1: 'z, .T.1' })).toBe('2');
    expect(ev('INSTR($1)', { $1: 'ld a, 5' })).toBe('ld');
    expect(ev('HIREG($1)', { $1: 'hl' })).toBe('h');
    expect(ev('LOREG($1)', { $1: 'hl' })).toBe('l');
    expect(ev('OP1($1)', { $1: 'ld a, 5' })).toBe('a');
    expect(ev('OP2($1)', { $1: 'ld a, 5' })).toBe('5');
    expect(ev('CTEST($1)', { $1: 'jp nz, x' })).toBe('nz');
    expect(ev('CTEST($1)', { $1: 'jp x' })).toBe('');
    expect(ev('CTEST($1)', { $1: 'ret c' })).toBe('c');
    expect(ev('NEEDS($1, (sp, hl))', { $1: 'ld a, (hl)' })).toBe('True');
    expect(ev('NEEDS($1, (sp, hl))', { $1: 'ld a, (_x)' })).toBe('');
    expect(ev('HIVAL($1)', { $1: '0x1234' })).toBe('18');
    expect(ev('LOVAL($1)', { $1: '0x1234' })).toBe('52');
  });

  it('an unbound variable is E575 at evaluation', () => {
    expect(() => ev('$9 == a')).toThrow(RuleError);
  });

  it('a rule file with a syntax error is E574, one that says something wrong E575', () => {
    const ok = 'OLEVEL: 1\nOFLAG: 1\nREPLACE {{\n push $1\n pop $1\n}}\nWITH {{\n}}\n';
    expect(parseRule('t', ok).name).toBe('t');
    const bad = (text: string, name = 't') => {
      try {
        parseRule(name, text);
      } catch (e) {
        return (e as RuleError).code;
      }
      return 'none';
    };
    expect(bad(ok.replace('OLEVEL: 1', 'OLEVEL: x'))).toBe('E574');
    expect(bad(ok.replace('WITH {{\n}}', ''))).toBe('E574');
    expect(bad(ok.replace('REPLACE {{', 'REPLAC {{'))).toBe('E574');
    expect(bad(ok.replace('}}\nWITH', '\nWITH'))).toBe('E574');
    expect(bad(`${ok}IF {{\n $1 ==\n}}\n`)).toBe('E574');
    expect(bad(ok, 'Bad_Name')).toBe('E574');
    expect(bad(`${ok}IF {{\n $2 == a\n}}\n`)).toBe('E575');
    expect(bad(`${ok}DEFINE {{\n $1 = a\n}}\n`)).toBe('E575');
    expect(bad(ok.replace('WITH {{\n}}', 'WITH {{\n ld $3, $1\n}}'))).toBe('E575');
  });

  it('z80regs: what an instruction touches', () => {
    expect([...(touches('ld a, (hl)') as Set<string>)].sort()).toEqual(['a', 'h', 'l']);
    expect([...(touches('pop af') as Set<string>)].sort()).toEqual(['a', 'f', 'sp']);
    expect(touches('call x')).toBeNull();
    expect(needs('ld hl, 5', 'hl')).toBe(true);
    expect(needs('ld a, (_x)', ['sp', 'hl'])).toBe(false);
    expect(needs('add a, 1', 'af')).toBe(true);
    expect(needs('ei', 'hl')).toBe(true);
    expect([...expandRegs(['sp', 'de'])].sort()).toEqual(['d', 'e', 'sp']);
  });
});

// ---------------------------------------------------------------------------
// the rule files and the generated module
// ---------------------------------------------------------------------------

describe('L5-PEEP: the rule files', () => {
  const dir = join(here, 'rules');
  const files = readdirSync(dir).filter((f) => f.endsWith('.opt')).sort();

  it('rules.gen.ts is what tools/gen-rules.mjs writes (--check)', () => {
    expect(() => execFileSync('node', [join(repo, 'tools', 'gen-rules.mjs'), '--check'], { stdio: 'pipe' })).not.toThrow();
  });

  it('every file is in the generated module, by its stem, and parses', () => {
    expect(RULE_SOURCES.map((r) => r.name)).toEqual(files.map((f) => f.slice(0, -4)));
    for (const r of RULE_SOURCES) expect(parseRule(r.name, r.text).name).toBe(r.name);
  });

  it('each file carries the SPDX line; a ported one the fork\'s copyright line, its CONTRIBUTORS.md line and the fork commit (docs/ir.md)', () => {
    for (const f of files) {
      const text = readFileSync(join(dir, f), 'utf8');
      expect(text.startsWith(';; SPDX-License-Identifier: AGPL-3.0-or-later\n'), f).toBe(true);
      if (/^[0-4]/.test(f)) {
        expect(text, f).toContain(';; © Copyright 2008-2024 José Manuel Rodríguez de la Rosa and contributors.\n');
        expect(text, f).toContain(';; See the file CONTRIBUTORS.md of zxbasic (https://github.com/boriel-basic/zxbasic) for copyright details.\n');
        expect(text, f).toMatch(/;; Ported from zxbasic src\/arch\/z80\/peephole\/opts\/\S+\.opt at e33cf0cd \(cpcbas L5-PEEP; changes: .+\)\./);
      } else {
        expect(text, f).toContain(';; cpcbas L5-PEEP: our own rule');
        expect(f).toMatch(/^5\d\d_/);
      }
    }
  });

  it('rules.gen.ts starts with the SPDX line and the fork\'s copyright', () => {
    const gen = readFileSync(join(here, 'rules.gen.ts'), 'utf8');
    expect(gen.startsWith('// SPDX-License-Identifier: AGPL-3.0-or-later\n')).toBe(true);
    expect(gen).toContain('// © Copyright 2008-2024 José Manuel Rodríguez de la Rosa and contributors.\n');
  });

  it('flags are unique among rules of one level where the order matters little, and names are lower case', () => {
    for (const r of allRules()) expect(r.name).toMatch(/^[a-z0-9][a-z0-9_-]*$/);
  });
});

// ---------------------------------------------------------------------------
// real programs
// ---------------------------------------------------------------------------

describe('L5-PEEP: on real programs', () => {
  const io = diskTree((p) => {
    try {
      return readFileSync(join(repo, p));
    } catch {
      return undefined;
    }
  });
  const build = (main: string, options: CompileOptions) => compile({ files: io, main, defines: {}, runtime: libTree(), options: { format: 'none', asm: true, ...options } });
  const body = (asm: string): string[] => {
    const lines = asm.split('\n');
    return lines.slice(lines.findIndex((l) => l.startsWith('.core.__MAIN_PROGRAM__:')));
  };
  const calls = (asm: string): string[] => body(asm).filter((l) => /^\s(call|rst)\b/.test(l)).map((l) => l.trim());

  it.each([['tests/fork-diff/flow.bas'], ['tests/fork-diff/strings.bas'], ['tests/conformance/arrays.bas']])('%s: no call is deleted or moved, at every level (docs/ir.md: the event poll is a call)', (main) => {
    const base = calls(build(main, { optimize: 0 }).asm as string);
    expect(base.length).toBeGreaterThan(10);
    // the IR passes (L5-IR) turn `* 2^n` and `/ 2^n` into shifts, which removes a call on purpose: this test is about the rule engine
    const noIr = ['ir-const', 'ir-copy', 'ir-strength', 'ir-dead'];
    for (const level of [1, 2, 3] as const) expect(calls(build(main, { optimize: level, optDisable: noIr }).asm as string), `-O${String(level)}`).toEqual(base);
    // -Os shares tails (`tailmerge`): the calls of a tail kept once run from every jump to it, so the list shrinks, but the event
    // poll is never in a tail (it stays at every statement start) and every call that is left is one of -O0's
    const small = calls(build(main, { optimize: 's', optDisable: noIr }).asm as string);
    expect(small.filter((c) => c.includes('__EVENT_POLL')), '-Os polls').toEqual(base.filter((c) => c.includes('__EVENT_POLL')));
    const pool = [...base];
    for (const c of small) {
      const at = pool.indexOf(c);
      expect(at, `-Os call ${c} is not one of -O0's`).toBeGreaterThanOrEqual(0);
      pool.splice(at, 1);
    }
  });

  it('every `#line` and every user and line label of -O0 is still in the asm at -O2', () => {
    const a = build('tests/fork-diff/strings.bas', { optimize: 0 }).asm as string;
    const b = build('tests/fork-diff/strings.bas', { optimize: 2 }).asm as string;
    const keep = (asm: string): string[] => asm.split('\n').filter((l) => /^(#line|\.L\.|_)/.test(l));
    expect(keep(b)).toEqual(keep(a));
  });

  it('-O2 is smaller than -O0 and -O1 is between', () => {
    const size = (level: 0 | 1 | 2): number => (build('tests/fork-diff/strings.bas', { optimize: level, format: 'bin' }).binary as Uint8Array).length;
    expect(size(2)).toBeLessThan(size(1));
    expect(size(1)).toBeLessThan(size(0));
  });
});
