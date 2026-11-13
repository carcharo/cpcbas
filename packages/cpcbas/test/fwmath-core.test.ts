/**
 * FWM-CORE on the test Z80 with the fake firmware's maths in strict mode: the gate and the model detection
 * (lib/loco/fwmath.asm), + - * / and the functions against the RECORDED firmware results
 * (tests/fixtures/fwmath-vectors.json, recorded on CPCEC through the Locomotive ROMs), IX and IY kept across
 * the gate, the three entry tables against the table of the fake,
 * and the error protocol (section 5). `fwmStrict` makes any result that was not recorded a failure, so
 * every input here is a recorded one. Expected values are the recording's, never the code under test's.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { libTree } from './runtime-tree.js';
import { mathsEntry, PROBE_H } from './z80sim/fwmaths.js';
import type { CpcModel } from './z80sim/fwmaths.js';
import { assembleAndRun, repoRoot, runProgram } from './z80sim/run.js';

const files: Record<string, string> = {};
for (const [path, text] of libTree()) if (path.startsWith('loco/')) files[path] = text;

interface OpData {
  inputs: string[];
  results: Record<string, string[] | string>;
}
const doc = JSON.parse(readFileSync(join(repoRoot, 'tests/fixtures/fwmath-vectors.json'), 'utf8')) as { ops: Record<string, OpData> };
const results = (op: string): string[] => {
  const r = doc.ops[op]!.results['6128']!;
  return r as string[];
};

const bytes = (h: string): number[] => (h.match(/../g) ?? []).map((x) => parseInt(x, 16));
const load = (b: readonly number[]): string => ` ld a,${b[0]}\n ld de,${(b[2]! << 8) | b[1]!}\n ld bc,${(b[4]! << 8) | b[3]!}\n`;
const push = (b: readonly number[]): string => `${load(b)} push bc\n push de\n push af\n`;
const MODELS: CpcModel[] = ['464', '664', '6128', 'plus'];

interface Case {
  inputs: number[][];
  expect: number[];
  ok: boolean;
}

/** The first `n` recorded vectors of an op with the carry set, spread through the list. */
function pick(op: string, n: number, filter: (inputs: number[][]) => boolean = () => true): Case[] {
  const d = doc.ops[op]!;
  const res = results(op);
  const out: Case[] = [];
  const step = Math.max(1, Math.floor(d.inputs.length / (n * 3)));
  for (let i = 0; i < d.inputs.length && out.length < n; i += step) {
    const [h, c] = res[i]!.split(' ');
    const inputs = d.inputs[i]!.split(' ').map(bytes);
    if (c !== '1' || !filter(inputs)) continue;
    out.push({ inputs, expect: bytes(h!), ok: true });
  }
  return out;
}

/** Zero results leave junk in the mantissa bytes: compare them by the exponent byte. */
const same = (got: number[], want: number[]): boolean => (want[4] === 0 ? got[4] === 0 : got.every((b, i) => b === want[i]));

/** Runs `call` for every case, one result per case at `out`; IX and IY are set before and read after. */
function runCases(model: CpcModel, cases: Case[], emit: (c: Case) => string): { res: number[][]; ix: number; iy: number; sp0: number; sp1: number } {
  const body = [
    ' ld ix,0x1234',
    ' ld iy,0x5678',
    ' ld (sp0),sp',
    ...cases.map((c, i) => `${emit(c)} ld (resv+${5 * i}),a\n ld (resv+${5 * i + 1}),de\n ld (resv+${5 * i + 3}),bc\n`),
    ' ld (sp1),sp',
    ' ld (ixsave),ix',
    ' ld (iysave),iy',
  ].join('\n');
  const r = runProgram(
    { body, data: `resv: DEFS ${5 * cases.length + 5}\nsp0: DEFW 0\nsp1: DEFW 0\nixsave: DEFW 0\niysave: DEFW 0`, include: ['loco/fmath.asm', 'loco/fwmath.asm', 'loco/realfn.asm'], heap: true },
    { files, model, fwmStrict: true, maxTStates: 400_000_000 } as never,
  );
  expect(r.stopped).toBe('rst0');
  expect(r.cpc.approximations).toEqual([]);
  const at = r.image.addr("resv");
  return {
    res: cases.map((_, i) => Array.from(r.memory.subarray(at + 5 * i, at + 5 * i + 5))),
    ix: r.wordAt('ixsave'),
    iy: r.wordAt('iysave'),
    sp0: r.wordAt('sp0'),
    sp1: r.wordAt('sp1'),
  };
}

describe.each(MODELS)('the gate on the %s', (model) => {
  it('+ * / and - give the recorded results, keep IX and IY and the stack', () => {
    const add = pick('ADD', 12);
    const mul = pick('MUL', 12);
    const div = pick('DIV', 12);
    const sub = pick('RSUB', 12);
    // a op b: a is pushed, b in the registers; for - the recorded RSUB vector (x, y) = y - x, so a = y, b = x
    const cases: [Case[], string, (c: Case) => number[][]][] = [
      [add, '__LOCO_FADD', (c) => [c.inputs[0]!, c.inputs[1]!]],
      [mul, '__LOCO_FMUL', (c) => [c.inputs[0]!, c.inputs[1]!]],
      [div, '__LOCO_FDIV', (c) => [c.inputs[0]!, c.inputs[1]!]],
      [sub, '__LOCO_FSUB', (c) => [c.inputs[1]!, c.inputs[0]!]],
    ];
    const all = cases.flatMap(([cs, label, ab]) => cs.map((c) => ({ c, label, ab: ab(c) })));
    expect(all.length).toBe(48);
    const r = runCases(
      model,
      all.map((x) => x.c),
      (c) => {
        const x = all.find((y) => y.c === c)!;
        return `${push(x.ab[0]!)}${load(x.ab[1]!)} call .core.${x.label}\n`;
      },
    );
    all.forEach((x, i) => expect(same(r.res[i]!, x.c.expect), `${x.label} ${JSON.stringify(x.ab)} -> ${r.res[i]!.join(',')} want ${x.c.expect.join(',')}`).toBe(true));
    expect(r.ix).toBe(0x1234);
    expect(r.iy).toBe(0x5678);
    expect(r.sp1).toBe(r.sp0);
  });

  it('SQR EXP LOG LOG10 SIN COS TAN ATN and POW give the recorded results', () => {
    const fns: [string, string][] = [
      ['SQR', '__LOCO_SQR'],
      ['EXP', '__LOCO_EXP'],
      ['LOG', '__LOCO_LOG'],
      ['LOG10', '__LOCO_LOG10'],
      ['SIN', '__LOCO_SIN'],
      ['COS', '__LOCO_COS'],
      ['TAN', '__LOCO_TAN'],
      ['ATN', '__LOCO_ATN'],
    ];
    const all = fns.flatMap(([op, label]) => pick(op, 6).map((c) => ({ c, label })));
    const pow = pick('POW', 10, (i) => (i[0]![3]! & 0x80) === 0);
    expect(all.length + pow.length).toBe(58);
    const r = runCases(
      model,
      [...all.map((x) => x.c), ...pow],
      (c) => {
        const x = all.find((y) => y.c === c);
        if (x !== undefined) return `${load(c.inputs[0]!)} call .core.${x.label}\n`;
        return `${push(c.inputs[0]!)}${load(c.inputs[1]!)} call .core.__LOCO_POW\n`;
      },
    );
    [...all.map((x) => ({ c: x.c, n: x.label })), ...pow.map((c) => ({ c, n: 'POW' }))].forEach((x, i) =>
      expect(same(r.res[i]!, x.c.expect), `${x.n} ${JSON.stringify(x.c.inputs)} -> ${r.res[i]!.join(',')} want ${x.c.expect.join(',')}`).toBe(true),
    );
    expect(r.ix).toBe(0x1234);
    expect(r.iy).toBe(0x5678);
    expect(r.sp1).toBe(r.sp0);
  });
});

describe('the entry tables', () => {
  it('the three records of fwmath.asm hold the recorded entries (464, 664, 6128 = Plus), in the order of the FWMO_ constants', () => {
    const names = ['ADD', 'RSUB', 'MUL', 'DIV', 'POW', 'SQR', 'EXP', 'LOG', 'LOG10', 'SIN', 'COS', 'TAN', 'ATN', 'RND', 'RND0', 'ANGLE', 'PREP', 'MUL10A', 'REAL2BIN', 'BIN2REAL'];
    const r = runProgram({ body: ' nop', include: ['loco/fwmath.asm'] }, { files } as never);
    const seeds = { '464': 0xb8e4, '664': 0xb100, '6128': 0xb100 } as const;
    for (const [label, model] of [['464', '464'], ['664', '664'], ['6128', '6128']] as const) {
      const base = r.image.addr(`.core.__FWM_T${label}`);
      names.forEach((n, i) => expect(r.wordAt(`.core.__FWM_T${label}`, 2 * i), `${model} ${n}`).toBe(mathsEntry(model, n)));
      expect(r.memory[base + 40]! | (r.memory[base + 41]! << 8)).toBe(seeds[model]);
    }
    expect(mathsEntry('plus', 'ADD')).toBe(mathsEntry('6128', 'ADD'));
  });

  it('KL PROBE ROM answers 0, 1, 2 and 4: the table follows (the detection runs once)', () => {
    const tbl = (model: CpcModel): number => {
      const r = runProgram(
        { body: ` ld a,1\n ld de,0\n ld bc,0\n call .core.__FWM_TBLHL\n ld (got),hl\n call .core.__FWM_TBLHL\n ld (got2),hl`, data: 'got: DEFW 0\ngot2: DEFW 0', include: ['loco/fwmath.asm'] },
        { files, model, fwmStrict: true } as never,
      );
      expect(r.stopped).toBe('rst0');
      expect(r.wordAt('got2')).toBe(r.wordAt('got'));
      return r.wordAt('got') - r.image.addr('.core.__FWM_T464');
    };
    expect(PROBE_H).toEqual({ '464': 0, '664': 1, '6128': 2, plus: 4 });
    // the records are 21 words apart, in the order 464, 664, 6128
    expect(tbl('464')).toBe(0);
    expect(tbl('664')).toBe(42);
    expect(tbl('6128')).toBe(84);
    expect(tbl('plus')).toBe(84);
  });
});

describe('the number text (PREP digits, then the text rule)', () => {
  it('__LOCO_FMTF prints the text Locomotive prints for all 2000 recorded bit patterns, on every model', () => {
    const t = JSON.parse(readFileSync(join(repoRoot, 'tests/fixtures/fwmath-text.json'), 'utf8')) as { patterns: string[]; text: Record<string, string[] | string> };
    const want = t.text['6128'] as string[];
    const all = t.patterns.map(bytes);
    const BATCH = 250; // (the program, its data and the runtime must stay below the firmware's &B900)
    const body = [
      ' ld hl,pats',
      ` ld bc,${BATCH}`,
      'lp:',
      ' push bc',
      ' push hl',
      ' ld a,(hl)\n inc hl\n ld e,(hl)\n inc hl\n ld d,(hl)\n inc hl\n ld c,(hl)\n inc hl\n ld b,(hl)',
      ' call .core.__LOCO_FMTF',
      ' inc bc',
      ' ld de,(optr)',
      ' ld a,c\n ld (de),a\n inc de\n ldir\n ld (optr),de',
      ' pop hl\n ld de,5\n add hl,de\n pop bc\n dec bc\n ld a,b\n or c\n jr nz,lp',
    ].join('\n');
    for (const model of MODELS) {
      const bad: string[] = [];
      for (let from = 0; from < all.length; from += BATCH) {
        const pats = all.slice(from, from + BATCH);
        const data = ['optr: DEFW obuf', 'pats:', ...pats.map((p) => ` DEFB ${p.join(',')}`), `obuf: DEFS ${pats.length * 18}`].join('\n');
        const r = runProgram({ body, data, include: ['loco/real.asm', 'loco/fwmath.asm'] }, { files, model, fwmStrict: true, maxTStates: 800_000_000 } as never);
        expect(r.stopped).toBe('rst0');
        expect(r.cpc.approximations).toEqual([]);
        let at = r.image.addr('obuf');
        pats.forEach((_p, i) => {
          const n = r.memory[at]!;
          const got = String.fromCharCode(...r.memory.subarray(at + 1, at + 1 + n));
          at += 1 + n;
          if (got !== want[from + i]) bad.push(`${t.patterns[from + i]}: got "${got}" want "${want[from + i]}"`);
        });
      }
      expect(bad.slice(0, 5), `${model}: ${bad.length} differ`).toEqual([]);
    }
  });
});

describe('bare builds keep their own digits (follow-up 57)', () => {
  it('the calculator-free digit generator of real.asm, bare variant, differs from Locomotive on the same 51 of 2000 patterns as before FWM-CORE', () => {
    const t = JSON.parse(readFileSync(join(repoRoot, 'tests/fixtures/fwmath-text.json'), 'utf8')) as { patterns: string[]; text: Record<string, string[] | string> };
    const want = t.text['6128'] as string[];
    const compiled = JSON.parse(readFileSync(join(repoRoot, 'tests/fixtures/fwmath-text-compiled.json'), 'utf8')) as { result: Record<string, { differ: number }> };
    const all = t.patterns.map(bytes);
    const BATCH = 250;
    let differ = 0;
    for (let from = 0; from < all.length; from += BATCH) {
      const pats = all.slice(from, from + BATCH);
      const text = [
        'org 64',
        '.core.CPC_PRIV_BASE EQU 48128',
        '.core.CPC_PRIV_SIZE EQU 1024',
        '.core.CPC_STACK_TOP EQU 48128',
        '.core.CPC_MEM_TOP EQU 49151',
        '.core.ZXBASIC_HEAP_SIZE EQU 4768',
        '.core.ZXBASIC_MEM_HEAP EQU 42336',
        '#define CPC_BAREMETAL',
        '.core.__START_PROGRAM:',
        ' di',
        ' ld sp,.core.CPC_STACK_TOP',
        ' ld hl,pats',
        ` ld bc,${BATCH}`,
        'lp: push bc',
        ' push hl',
        ' ld a,(hl)\n inc hl\n ld e,(hl)\n inc hl\n ld d,(hl)\n inc hl\n ld c,(hl)\n inc hl\n ld b,(hl)',
        ' call .core.__LOCO_FMTF',
        ' inc bc',
        ' ld de,(optr)',
        ' ld a,c\n ld (de),a\n inc de\n ldir\n ld (optr),de',
        ' pop hl\n ld de,5\n add hl,de\n pop bc\n dec bc\n ld a,b\n or c\n jr nz,lp',
        ' rst 0',
        'optr: DEFW obuf',
        'pats:',
        ...pats.map((p) => ` DEFB ${p.join(',')}`),
        `obuf: DEFS ${pats.length * 18}`,
        '#include once <loco/real.asm>',
      ].join('\n');
      const r = assembleAndRun(text, { files, maxTStates: 800_000_000 } as never);
      expect(r.stopped).toBe('rst0');
      let at = r.image.addr('obuf');
      pats.forEach((_p, i) => {
        const n = r.memory[at]!;
        const got = String.fromCharCode(...r.memory.subarray(at + 1, at + 1 + n));
        at += 1 + n;
        if (got !== want[from + i]) differ++;
      });
    }
    expect(differ).toBe(compiled.result['6128']!.differ);
    expect(differ).toBe(51);
  });
});

describe('a zero the firmware computes has junk in its mantissa bytes', () => {
  // 1.0 + -1.0 gives 00 00 00 01 00, and a product that underflows gives its mantissa with exponent byte 0: everything must read them as 0
  const junk = [[0, 0, 0, 1, 0], [0x65, 0x08, 0xe5, 0x3c, 0], [0, 0, 0, 0x81, 0]];
  const one = [0, 0, 0, 0, 0x81];
  const run = (body: string): number[] => {
    const r = runProgram(
      { body: `${body}\n ld (resv),a\n ld (resv+1),de\n ld (resv+3),bc`, data: 'resv: DEFS 5', include: ['loco/fmath.asm', 'loco/fmathcmp.asm', 'loco/fmathcv.asm', 'loco/realfn.asm'], heap: true },
      { files, fwmStrict: true } as never,
    );
    expect(r.stopped).toBe('rst0');
    return Array.from(r.memory.subarray(r.image.addr('resv'), r.image.addr('resv') + 5));
  };
  it.each(junk.map((j) => [j]))('%j compares equal to zero and below one, converts to the integer 0, and adds as zero', (z) => {
    const eq = run(`${push(z!)}${load([0, 0, 0, 0, 0])} call .core.__LOCO_FEQ`);
    expect(eq[0]).toBe(1);
    const lt = run(`${push(z!)}${load(one)} call .core.__LOCO_FLT`);
    expect(lt[0]).toBe(1);
    // DEHL -> A E D C B = L H E D 0
    const toInt = run(`${load(z!)} call .core.__LOCO_FTOU32\n ld a,l\n ld l,d\n ld c,l\n ld l,e\n ld d,l\n ld e,h\n ld b,0`);
    expect(toInt).toEqual([0, 0, 0, 0, 0]);
    const sum = run(`${push(z!)}${load(one)} call .core.__LOCO_FADD`);
    expect(same(sum, one)).toBe(true);
  });
});

describe('RANDOMIZE and the angle mode write the firmware bytes the recordings show', () => {
  const rnd = (JSON.parse(readFileSync(join(repoRoot, 'tests/fixtures/fwmath-vectors.json'), 'utf8')) as { rnd_seeded: Record<string, { arg: string; arg_bytes: string; seed: string }[] | string> }).rnd_seeded['6128'] as {
    arg: string;
    arg_bytes: string;
    seed: string;
  }[];
  it.each(MODELS)('on the %s RANDOMIZE n stores the seed of each of the 24 recorded arguments at the right address', (model) => {
    const at = { '464': 0xb8e4, '664': 0xb100, '6128': 0xb100, plus: 0xb100 }[model];
    const body = rnd.map((r, i) => `${load(bytes(r.arg_bytes))} call .core.__LOCO_RANDOMIZE\n ld hl,${at}\n ld de,seeds+${4 * i}\n ld bc,4\n ldir`).join('\n');
    const r = runProgram({ body, data: `seeds: DEFS ${4 * rnd.length}`, include: ['loco/realfn.asm'] }, { files, model, fwmStrict: true } as never);
    expect(r.stopped).toBe('rst0');
    const base = r.image.addr('seeds');
    rnd.forEach((x, i) => expect(Array.from(r.memory.subarray(base + 4 * i, base + 4 * i + 4)).map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(''), `RANDOMIZE ${x.arg}`).toBe(x.seed));
  });
  it.each(MODELS)('on the %s the detection leaves RAD whatever BASIC left, DEG sets the firmware byte to &FF and RAD back to 0', (model) => {
    const at = { '464': 0xb8f7, '664': 0xb113, '6128': 0xb113, plus: 0xb113 }[model];
    const r = runProgram(
      {
        body: ` ld a,0x55\n ld (${at}),a\n call .core.__FWM_TBLHL\n ld a,(${at})\n ld (m0),a\n call .core.__LOCO_DEG\n ld a,(${at})\n ld (m1),a\n call .core.__LOCO_RAD\n ld a,(${at})\n ld (m2),a`,
        data: 'm0: DEFB 0\nm1: DEFB 0\nm2: DEFB 0',
        include: ['loco/realfn.asm'],
      },
      { files, model, fwmStrict: true } as never,
    );
    expect(r.stopped).toBe('rst0');
    expect([r.byteAt('m0'), r.byteAt('m1'), r.byteAt('m2')]).toEqual([0, 0xff, 0]);
  });
});
