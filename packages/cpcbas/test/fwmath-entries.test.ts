/**
 * The firmware maths entry table of FWM-0 against its recorded data,
 * tests/fixtures/fwmath-entries.json (tools/fwm-record.py entries, stack, thresholds). `npm test` runs no
 * emulator; this pins the facts the later tasks rely on.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

interface Reg {
  R: string;
  A: string;
  F: string;
  HL: string;
}
interface Edge {
  op: string;
  a?: string;
  b?: string;
  A?: number;
  hl?: string;
  out: Record<string, Reg | string>;
}
interface Entries {
  models: Record<string, { jumpblock: Record<string, string>; probe_rom: { A: number; H: number; L: number }; block: [number, number] }>;
  standard: Record<string, Record<string, unknown>>;
  stack: Record<string, Record<string, number>>;
  stack_deep: Record<string, Record<string, number>>;
  edges: Edge[];
  thresholds: Record<string, unknown[][] | string>;
}

const doc = JSON.parse(readFileSync(join(root, 'tests/fixtures/fwmath-entries.json'), 'utf8')) as Entries;
const hexw = (n: number): string => n.toString(16).toUpperCase().padStart(4, '0');

describe('model detection and the three tables', () => {
  it('KL PROBE ROM returns version 0, 1, 2, 4 for the 464, 664, 6128 and Plus (mark 1, class &80)', () => {
    const v = Object.fromEntries(Object.entries(doc.models).map(([m, x]) => [m, x.probe_rom.H]));
    expect(v).toEqual({ '464': 0, '664': 1, '6128': 2, plus: 4 });
    for (const x of Object.values(doc.models)) {
      expect(x.probe_rom.L).toBe(1);
      expect(x.probe_rom.A).toBe(0x80);
    }
  });

  it('the maths block is a run of RST 5 entries: 48 on the 464, 32 on the 664, 6128 and Plus', () => {
    const sizes: Record<string, number> = { '464': 48, '664': 32, '6128': 32, plus: 32 };
    for (const [m, x] of Object.entries(doc.models)) {
      const [lo, hi] = x.block;
      expect((hi - lo) / 3 + 1).toBe(sizes[m]);
      for (let a = lo; a <= hi; a += 3) expect(x.jumpblock[hexw(a)]!.slice(0, 2), `${m} ${hexw(a)}`).toBe('EF');
    }
  });

  it('the 664 block is the 6128 block 3 bytes lower, with the same ROM targets; the Plus equals the 6128', () => {
    const j6 = doc.models['6128']!.jumpblock;
    const j4 = doc.models['664']!.jumpblock;
    const jp = doc.models.plus!.jumpblock;
    for (let a = 0xbd61; a <= 0xbdbe; a += 3) {
      expect(j4[hexw(a - 3)], hexw(a)).toBe(j6[hexw(a)]);
      expect(jp[hexw(a)]).toBe(j6[hexw(a)]);
    }
    // the slot before the 664's block is the RST 1 entry (text input), as the 6128's is at BD5E
    expect(j4.BD5B).toBe('CF02AC');
    expect(j6.BD5E).toBe('CF02AC');
  });
});

describe('the standard sweep', () => {
  it('is identical on the 664, 6128 and Plus', () => {
    for (const m of ['664', 'plus']) expect(doc.standard[m]).toEqual(doc.standard['6128']);
  });

  it('stack depth: at most 40 bytes under the caller on every entry and model, and the interrupt baseline is small', () => {
    for (const m of Object.keys(doc.stack_deep)) {
      const d = doc.stack_deep[m]!;
      expect(Math.max(...Object.values(d)), m).toBeLessThanOrEqual(40);
      expect(d.base).toBeLessThanOrEqual(8);
    }
  });
});

describe('error behaviour (carry set = success)', () => {
  const find = (op: string, a?: string, b?: string): Edge => {
    const e = doc.edges.find((x) => x.op === op && x.a === a && (b === undefined || x.b === b));
    if (!e) throw new Error(`no edge ${op} ${a} ${b}`);
    return e;
  };
  const res = (e: Edge, m = '6128'): Reg => {
    const r = e.out[m];
    if (r === undefined || r === 'HANG') throw new Error(`${e.op}: ${String(r)}`);
    return (r === '=6128' ? e.out['6128'] : r) as Reg;
  };
  const carry = (r: Reg): boolean => (parseInt(r.F, 16) & 1) === 1;
  const MAXP = 'FFFFFF7FFF';
  const MAXN = 'FFFFFFFFFF';

  it('no entry hangs on any recorded case', () => {
    for (const e of doc.edges) for (const [m, r] of Object.entries(e.out)) expect(r, `${e.op} ${m}`).not.toBe('HANG');
  });

  it('overflow gives the largest value of the right sign with carry clear', () => {
    for (const [op, a, b, want] of [
      ['ADD', MAXP, MAXP, MAXP],
      ['ADD', MAXN, MAXN, MAXN],
      ['MUL', MAXP, MAXP, MAXP],
      ['MUL', 'C6EB782DC3', 'C6EB782DC3', MAXP],
      ['DIV', '0000000081', '0000000001', MAXP],
    ] as const) {
      const r = res(find(op, a, b));
      expect(r.R.slice(0, 10), `${op} ${a} ${b}`).toBe(want);
      expect(carry(r)).toBe(false);
    }
  });

  it('division by zero gives +-max with carry clear; 0/0 gives +max', () => {
    for (const [a, want] of [
      ['0000000081', MAXP],
      ['0000008081', MAXN],
      ['0000000000', MAXP],
    ] as const) {
      const r = res(find('DIV', a, '0000000000'));
      expect(r.R.slice(0, 10)).toBe(want);
      expect(carry(r)).toBe(false);
    }
  });

  it('SQR(-1) is SQR(1) with carry clear; LOG(0) and LOG(-1) leave the argument with carry clear', () => {
    const s = res(find('SQR', '0000008081'));
    expect(s.R.slice(0, 10)).toBe('0000000081');
    expect(carry(s)).toBe(false);
    const l0 = res(find('LOG', '0000000000'));
    expect(l0.R.slice(0, 10)).toBe('0000000000');
    expect(carry(l0)).toBe(false);
    const l1 = res(find('LOG', '0000008081'));
    expect(l1.R.slice(0, 10)).toBe('0000008081');
    expect(carry(l1)).toBe(false);
  });

  it('underflow gives exponent byte 0 and carry set', () => {
    const r = res(find('MUL', '0000000001', '0000000001'));
    expect(r.R.slice(8, 10)).toBe('00');
    expect(carry(r)).toBe(true);
  });

  it('exponent byte 0 is read as zero: CMP and SGN treat the small-integer form as zero', () => {
    for (const z of ['0000004000', '3412000000', 'FFFFFFFF00']) {
      expect(res(find('SGN', z)).A).toBe('00');
      expect(res(find('CMP', z, '0000000000')).A).toBe('00');
    }
  });

  it('EXP overflows between 88.0 and 88.1', () => {
    const t = (doc.thresholds['6128'] as [string, number, string, number][]).filter((x) => x[0] === 'EXP');
    const ok = t.filter((x) => x[3] === 1 && x[1] > 0).map((x) => x[1]);
    const bad = t.filter((x) => x[3] === 0 && x[1] > 0).map((x) => x[1]);
    expect(Math.max(...ok)).toBe(88);
    expect(Math.min(...bad)).toBe(88.1);
  });

  it('SIN, COS and TAN fail (carry clear) from 2^18 up and work at 2^16', () => {
    const t = doc.thresholds['6128'] as [string, number, string, number][];
    for (const op of ['SIN', 'COS', 'TAN']) {
      expect(t.find((x) => x[0] === op && x[1] === 65536)![3]).toBe(1);
      expect(t.find((x) => x[0] === op && x[1] === 262144)![3]).toBe(0);
    }
  });

  it('every recorded case is the same on the 664 and the Plus as on the 6128', () => {
    for (const e of doc.edges) {
      for (const m of ['664', 'plus']) {
        const x = e.out[m];
        if (x !== undefined) expect(x === '=6128' || JSON.stringify(x) === JSON.stringify(e.out['6128'])).toBe(true);
      }
    }
  });
});
