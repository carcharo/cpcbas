/**
 * The fake firmware's maths block (FWM-SIM): the 464, 664 and 6128/Plus entry tables of
 * the firmware, the measured register corruption, the carry-set-is-success
 * protocol, and the data check "a pointer below &4000 reads the lower ROM".
 *
 * Where the results come from:
 *  - `+ - * /`, compare, negate, sign, the integer and binary conversions, MOVE, PI, EXPADD, ANGLE:
 *    src/core/locoreal.ts, bit for bit what the recorded vectors show.
 *  - SQR EXP LOG LOG10 SIN COS TAN ATN POW and MUL10A: the firmware is not 1-ulp accurate (SQR is up
 *    to 41 ulp off, MUL10A one ulp on 15 percent of inputs), so a result RECORDED for the same
 *    inputs (fwmath-vectors.json, the edge cases and thresholds of fwmath-entries.json) is replayed
 *    exactly. For any other input the result is JS `Math` rounded to 32 bits (MUL10A: the correctly
 *    rounded product), and the call is listed in `cpc.approximations`; with the option `fwmStrict`
 *    it fails the run instead. Replays are for RAD; in DEG mode every SIN/COS/TAN/ATN is approximate.
 *  - RND and RND(0): the recurrence is not known. The RND state is the four seed bytes at &B100
 *    (&B8E4 on the 464); a seed with a recorded stream (the boot seed: 1000 values; 24 seeds from
 *    RANDOMIZE: 50 values each) replays it; a seed without one fails the run. The real seed's
 *    evolution is unknown, so after each RND the fake stores stand-in bytes
 *    (EE, position, EE), so writing a recorded seed again restarts that seed's stream, as on the machine.
 *  - PREP: the 2168 recorded inputs (fwmath-prep.json, 6128; the 464, 664 and Plus agree on the digits)
 *    are replayed exactly. Any other input is computed by the exact rule (the nearest 9-digit decimal,
 *    halves up), which the firmware follows on 2019 of 2167 recorded inputs (it scales in 32-bit REAL
 *    arithmetic and is sometimes one unit in the 9th digit off); such a call is listed in
 *    `cpc.approximations`, or fails the run with `fwmStrict`.
 *
 * Every entry sets the registers the measured contract says are destroyed (IX := HL, IY, BC, DE and
 * AF junk) and enables interrupts (FIRM JUMP does). Mantissa bytes of results that are zero are
 * canonical zeros; the firmware leaves junk there and nothing reads it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REAL_MAX_POS,
  binToReal,
  int16ToReal,
  realAdd,
  realCmp,
  realDiv,
  realExpAdd,
  realFromNumber,
  realMul,
  realMul10,
  realNeg,
  realSgn,
  realSub,
  realToBin,
  realToInt16,
  realToNumber,
} from '../../src/core/locoreal.js';
import type { RealResult } from '../../src/core/locoreal.js';
import type { Z80Cpu } from './cpu.js';

export type CpcModel = '464' | '664' | '6128' | 'plus';

/** Thrown for a broken contract with the maths firmware (a pointer below &4000, an unrecorded RND seed, ...). */
export class FwMathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FwMathError';
  }
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

// [464, 664, 6128 and Plus]; undefined = the model has no such entry
const TABLE: Record<string, [number, number | undefined, number | undefined]> = {
  MOVE: [0xbd3d, 0xbd5e, 0xbd61],
  INT2REAL: [0xbd40, 0xbd61, 0xbd64],
  BIN2REAL: [0xbd43, 0xbd64, 0xbd67],
  REAL2INT: [0xbd46, 0xbd67, 0xbd6a],
  REAL2BIN: [0xbd49, 0xbd6a, 0xbd6d],
  FIX: [0xbd4c, 0xbd6d, 0xbd70],
  INT: [0xbd4f, 0xbd70, 0xbd73],
  PREP: [0xbd52, 0xbd73, 0xbd76],
  MUL10A: [0xbd55, 0xbd76, 0xbd79],
  ADD: [0xbd58, 0xbd79, 0xbd7c],
  SUB: [0xbd5b, undefined, undefined],
  RSUB: [0xbd5e, 0xbd7f, 0xbd82],
  MUL: [0xbd61, 0xbd82, 0xbd85],
  DIV: [0xbd64, 0xbd85, 0xbd88],
  EXPADD: [0xbd67, undefined, undefined],
  RND: [0xbd9d, 0xbd7c, 0xbd7f],
  RND0: [0xbda0, 0xbd88, 0xbd8b],
  CMP: [0xbd6a, 0xbd8b, 0xbd8e],
  NEG: [0xbd6d, 0xbd8e, 0xbd91],
  SGN: [0xbd70, 0xbd91, 0xbd94],
  ANGLE: [0xbd73, 0xbd94, 0xbd97],
  PI: [0xbd76, 0xbd97, 0xbd9a],
  SQR: [0xbd79, 0xbd9a, 0xbd9d],
  POW: [0xbd7c, 0xbd9d, 0xbda0],
  LOG: [0xbd7f, 0xbda0, 0xbda3],
  LOG10: [0xbd82, 0xbda3, 0xbda6],
  EXP: [0xbd85, 0xbda6, 0xbda9],
  SIN: [0xbd88, 0xbda9, 0xbdac],
  COS: [0xbd8b, 0xbdac, 0xbdaf],
  TAN: [0xbd8e, 0xbdaf, 0xbdb2],
  ATN: [0xbd91, 0xbdb2, 0xbdb5],
};

/** Address of a maths entry on a model (undefined: the model has no such entry). */
export function mathsEntry(model: CpcModel, name: string): number | undefined {
  const row = TABLE[name];
  if (row === undefined) throw new Error(`unknown maths entry ${name}`);
  return model === '464' ? row[0] : model === '664' ? row[1] : row[2];
}

/** The value `KL PROBE ROM` (&B915, C = 0) returns in H. */
export const PROBE_H: Record<CpcModel, number> = { '464': 0, '664': 1, '6128': 2, plus: 4 };

export const RND_SEED_ADDRESS: Record<CpcModel, number> = { '464': 0xb8e4, '664': 0xb100, '6128': 0xb100, plus: 0xb100 };
/** The angle-mode byte (state + 19). */
export const ANGLE_ADDRESS: Record<CpcModel, number> = { '464': 0xb8f7, '664': 0xb113, '6128': 0xb113, plus: 0xb113 };
export const BOOT_SEED = [0x07, 0x6c, 0x65, 0x89];

const PI_BYTES = [0xa2, 0xda, 0x0f, 0x49, 0x82];

// ---------------------------------------------------------------------------------------------
// Recorded data

const bytes = (h: string): number[] => (h.match(/../g) ?? []).map((x) => parseInt(x, 16));
const hex = (b: readonly number[]): string => b.map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join('');
const signedByte = (a: number): number => (a > 127 ? a - 256 : a);

interface Recorded {
  r: number[];
  ok: boolean;
  /** A on return, where the edge-case recording has it (the error codes of LOG). */
  a?: number;
}
interface FixtureOp {
  inputs: string[];
  results: Record<string, string[] | string>;
}
interface Fixtures {
  replay: Map<string, Recorded>;
  /** PREP, by input REAL (hex): the 5 bytes written, the sign byte (B) and the decimal exponent (E). */
  prep: Map<string, { r: number[]; b: number; e: number }>;
  rndBoot: number[][];
  rndSeeded: Map<string, number[][]>;
}

let fixtures: Fixtures | undefined;

function load(): Fixtures {
  if (fixtures !== undefined) return fixtures;
  const read = (n: string): unknown => JSON.parse(readFileSync(join(root, 'tests/fixtures', n), 'utf8'));
  const vec = read('fwmath-vectors.json') as {
    ops: Record<string, FixtureOp>;
    rnd_from_boot: Record<string, string[] | string>;
    rnd_seeded: Record<string, { seed: string; values: string[] }[] | string>;
  };
  const ent = read('fwmath-entries.json') as {
    edges: { op: string; a?: string; b?: string; A?: number; out: Record<string, { R: string; F: string; A: string }> }[];
    thresholds: Record<string, [string, number, string, number][] | string>;
  };
  const replay = new Map<string, Recorded>();
  const put = (key: string, r: string, ok: boolean, a?: number): void => {
    // the first record wins; the lists agree wherever they overlap
    if (!replay.has(key)) replay.set(key, a === undefined ? { r: bytes(r), ok } : { r: bytes(r), ok, a });
  };
  for (const op of ['SQR', 'EXP', 'LOG', 'LOG10', 'SIN', 'COS', 'TAN', 'ATN', 'POW', 'MUL10A']) {
    const d = vec.ops[op]!;
    const res = d.results['6128'] as string[];
    d.inputs.forEach((inp, i) => {
      const [h, c] = res[i]!.split(' ');
      put(`${op}:${inp}`, h!, c === '1');
    });
  }
  for (const e of ent.edges) {
    if (!['SQR', 'EXP', 'LOG', 'LOG10', 'SIN', 'COS', 'TAN', 'ATN', 'POW', 'MUL10A'].includes(e.op)) continue;
    const o = e.out['6128'] ?? e.out['464'];
    if (o === undefined) continue;
    const key = e.op === 'MUL10A' ? `${e.op}:${e.a}|${signedByte(e.A!)}` : e.op === 'POW' ? `${e.op}:${e.a} ${e.b}` : `${e.op}:${e.a}`;
    put(key, o.R.slice(0, 10), (parseInt(o.F, 16) & 1) === 1, parseInt(o.A, 16));
  }
  const th = ent.thresholds['6128'] as [string, number, string, number][];
  for (const [op, x, r, c] of th) put(`${op}:${hex(realFromNumber(x).bytes)}`, r, c === 1);

  const rb = vec.rnd_from_boot['6128'] as string[];
  const seeded = new Map<string, number[][]>();
  for (const s of vec.rnd_seeded['6128'] as { seed: string; values: string[] }[]) {
    if (!seeded.has(s.seed)) seeded.set(s.seed, s.values.map(bytes));
  }
  const pf = read('fwmath-prep.json') as { inputs: string[]; results: Record<string, string[]> };
  const prep = new Map<string, { r: number[]; b: number; e: number }>();
  pf.inputs.forEach((inp, i) => {
    const [r, g] = pf.results['6128']![i]!.split(' ');
    prep.set(inp, { r: bytes(r!), b: parseInt(g!.slice(0, 2), 16), e: parseInt(g!.slice(6, 8), 16) });
  });
  fixtures = { replay, prep, rndBoot: rb.map(bytes), rndSeeded: seeded };
  return fixtures;
}

// ---------------------------------------------------------------------------------------------
// PREP: 9 decimal digits and a decimal exponent

/**
 * The exact rule behind PREP (a nonzero REAL): n = the value / 10^e rounded half up to an integer of 9
 * digits (100000000..999999999), e the decimal exponent of the last digit; n reaching 10^9 becomes 10^8 at e + 1.
 * The firmware itself agrees on 2019 of the 2167 recorded inputs (see the file comment).
 */
export function prepExact(x: readonly number[]): { n: number; e: number; neg: boolean } {
  const m = (BigInt((x[3]! & 0x7f) | 0x80) << 24n) | (BigInt(x[2]!) << 16n) | (BigInt(x[1]!) << 8n) | BigInt(x[0]!);
  const sh = x[4]! - 128 - 32;
  const num = sh >= 0 ? m << BigInt(sh) : m;
  const den = sh >= 0 ? 1n : 1n << BigInt(-sh);
  const pow = (k: number): bigint => 10n ** BigInt(k);
  // e10: 10^e10 <= value < 10^(e10 + 1)
  let e10 = Math.floor((x[4]! - 128) * Math.log10(2));
  const le = (k: number): boolean => (k >= 0 ? num >= pow(k) * den : num * pow(-k) >= den); // 10^k <= value
  while (!le(e10)) e10--;
  while (le(e10 + 1)) e10++;
  let k = e10 - 8;
  const qn = k >= 0 ? num : num * pow(-k);
  const qd = k >= 0 ? den * pow(k) : den;
  let n = (2n * qn + qd) / (2n * qd);
  if (n >= 1000000000n) {
    n = 100000000n;
    k++;
  }
  return { n: Number(n), e: k, neg: (x[3]! & 0x80) !== 0 };
}

// ---------------------------------------------------------------------------------------------
// The block

export interface MathsHost {
  readonly cpu: Z80Cpu;
  /** Registers a firmware entry; `corrupt` registers are not touched here (the maths code does its own). */
  fw(address: number, name: string, corrupt: never[], fn: (cpu: Z80Cpu, i: RegsIn) => void): void;
  /** Calls whose result was approximated (see the file comment). */
  readonly approximations: string[];
  readonly fwmStrict: boolean;
}
export interface RegsIn {
  a: number;
  f: number;
  b: number;
  c: number;
  d: number;
  e: number;
  h: number;
  l: number;
}

const JUNK = { a: 0xa1, b: 0xb1, c: 0xc1, d: 0xd1, e: 0xe1, f: 0x14 };
const IY_JUNK = 0x3127;

/** F with the S, Z and C bits set as given and the rest deliberately non-zero junk. */
const flags = (s: boolean, z: boolean, c: boolean): number => JUNK.f | (s ? 0x80 : 0) | (z ? 0x40 : 0) | (c ? 1 : 0);

export function installMaths(host: MathsHost, model: CpcModel): void {
  const cpu = host.cpu;
  const is464 = model === '464';
  const data = load();

  const check = (name: string, what: string, ptr: number): void => {
    if (ptr < 0x4000 || ptr > 0xfffb)
      throw new FwMathError(
        `firmware maths reads its data with the lower ROM enabled (SOFT968 section 2.4 b): ${name} was given ${what} = &${ptr.toString(16).toUpperCase().padStart(4, '0')}`,
      );
  };
  const read5 = (ptr: number): number[] => [0, 1, 2, 3, 4].map((k) => cpu.mem[(ptr + k) & 0xffff]!);
  const write5 = (ptr: number, v: readonly number[]): void => {
    for (let k = 0; k < 5; k++) cpu.mem[(ptr + k) & 0xffff] = v[k]!;
  };
  const approx = (what: string): void => {
    if (host.fwmStrict) throw new FwMathError(`firmware maths result not recorded and fwmStrict is set: ${what}`);
    host.approximations.push(what);
  };
  const degrees = (): boolean => cpu.mem[ANGLE_ADDRESS[model]] !== 0;

  /** FIRM JUMP enables interrupts. */
  const firm = (): void => {
    cpu.iff1 = true;
    cpu.iff2 = true;
  };
  /** The destroyed registers of the arithmetic and function entries (HL is the result pointer). */
  const destroy = (i: RegsIn, hlOnErr: boolean): void => {
    cpu.b = JUNK.b;
    cpu.c = JUNK.c;
    cpu.d = JUNK.d;
    cpu.e = JUNK.e;
    cpu.a = JUNK.a;
    cpu.h = i.h;
    cpu.l = i.l;
    if (hlOnErr && is464) cpu.hl = 0xffff;
    cpu.ix = (cpu.h << 8) | cpu.l;
    cpu.iy = IY_JUNK;
  };
  const carry = (ok: boolean, a?: number): void => {
    cpu.f = flags(false, false, ok);
    if (a !== undefined) cpu.a = a;
  };

  const add = (name: string, fn: (cpu: Z80Cpu, i: RegsIn) => void): void => {
    const a = mathsEntry(model, name);
    if (a === undefined) return;
    host.fw(a, name, [], (c, i) => {
      fn(c, i);
      firm();
    });
  };

  // ---- two-operand arithmetic: (HL) := (HL) op (DE)
  const arith = (name: string, f: (x: number[], y: number[]) => RealResult): void =>
    add(name, (_c, i) => {
      const hl = (i.h << 8) | i.l;
      const de = (i.d << 8) | i.e;
      check(name, 'HL', hl);
      check(name, 'DE', de);
      const r = f(read5(hl), read5(de));
      write5(hl, r.bytes);
      destroy(i, !r.ok);
      carry(r.ok, JUNK.a);
    });
  arith('ADD', (x, y) => realAdd(x, y));
  arith('SUB', (x, y) => realSub(x, y));
  arith('RSUB', (x, y) => realSub(y, x));
  arith('MUL', (x, y) => realMul(x, y));
  arith('DIV', (x, y) => realDiv(x, y));

  add('EXPADD', (_c, i) => {
    const hl = (i.h << 8) | i.l;
    check('EXPADD', 'HL', hl);
    const r = realExpAdd(read5(hl), signedByte(i.a));
    write5(hl, r.bytes);
    destroy(i, !r.ok);
    carry(r.ok);
  });

  // ---- functions: replay the recorded result, else JS Math
  const replayKey = (name: string, x: number[], y?: number[]): string =>
    y === undefined ? `${name}:${hex(x)}` : `${name}:${hex(x)} ${hex(y)}`;
  const funcResult = (name: string, x: number[], y?: number[]): { r: RealResult; a?: number } => {
    const deg = degrees();
    const rec = !deg || !['SIN', 'COS', 'TAN', 'ATN'].includes(name) ? data.replay.get(replayKey(name, x, y)) : undefined;
    if (rec !== undefined) return rec.a === undefined ? { r: { bytes: rec.r, ok: rec.ok } } : { r: { bytes: rec.r, ok: rec.ok }, a: rec.a };
    approx(`${name}(${hex(x)}${y === undefined ? '' : ', ' + hex(y)})${deg ? ' DEG' : ''}`);
    const v = realToNumber(x);
    const out = (n: number): RealResult => realFromNumber(n);
    const toRad = (n: number): number => (deg ? (n * Math.PI) / 180 : n);
    switch (name) {
      case 'SQR':
        if (x[4] === 0) return { r: { bytes: [0, 0, 0, 0, 0], ok: true } };
        return { r: { bytes: out(Math.sqrt(Math.abs(v))).bytes, ok: v >= 0 } };
      case 'LOG':
      case 'LOG10':
        if (x[4] === 0) return { r: { bytes: [...x], ok: false }, a: 0xff };
        if (v < 0) return { r: { bytes: [...x], ok: false }, a: 0xfe };
        return { r: v === 1 ? { bytes: [0, 0, 0, 0, 0], ok: true } : out(name === 'LOG' ? Math.log(v) : Math.log10(v)) };
      case 'EXP':
        if (v > 88.0) return { r: { bytes: [...REAL_MAX_POS], ok: false } };
        if (v <= -89) return { r: { bytes: [0, 0, 0, 0, 0], ok: true } };
        return { r: out(Math.exp(v)) };
      case 'SIN':
      case 'COS':
      case 'TAN': {
        if (Math.abs(v) >= 262144) return { r: { bytes: [...x], ok: false } };
        // measured on the interpreter (loco-measured.md, L4-ERR): TAN(90) in DEG mode is +max with the carry clear
        if (name === 'TAN' && deg && v === 90) return { r: { bytes: [...REAL_MAX_POS], ok: false } };
        const t = toRad(v);
        return { r: out(name === 'SIN' ? Math.sin(t) : name === 'COS' ? Math.cos(t) : Math.tan(t)) };
      }
      case 'ATN': {
        const t = Math.atan(v);
        return { r: out(deg ? (t * 180) / Math.PI : t) };
      }
      case 'POW': {
        const base = v;
        const e = realToNumber(y!);
        if (base === 0) return e < 0 ? { r: { bytes: [...REAL_MAX_POS], ok: false } } : { r: { bytes: e === 0 ? binToReal(1, false) : [0, 0, 0, 0, 0], ok: true } };
        if (base < 0 && !Number.isInteger(e)) return { r: { bytes: out(Math.abs(base)).bytes, ok: false } };
        const p = Math.pow(base, e);
        return { r: out(p) };
      }
    }
    throw new Error(name);
  };
  for (const name of ['SQR', 'EXP', 'LOG', 'LOG10', 'SIN', 'COS', 'TAN', 'ATN']) {
    add(name, (_c, i) => {
      const hl = (i.h << 8) | i.l;
      check(name, 'HL', hl);
      const f = funcResult(name, read5(hl));
      write5(hl, f.r.bytes);
      destroy(i, false);
      carry(f.r.ok, f.a ?? JUNK.a);
    });
  }
  add('POW', (_c, i) => {
    const hl = (i.h << 8) | i.l;
    const de = (i.d << 8) | i.e;
    check('POW', 'HL', hl);
    check('POW', 'DE', de);
    const f = funcResult('POW', read5(hl), read5(de));
    write5(hl, f.r.bytes);
    destroy(i, !f.r.ok);
    carry(f.r.ok);
  });

  add('MUL10A', (_c, i) => {
    const hl = (i.h << 8) | i.l;
    if (i.a === 0) {
      carry(true); // A = 0 returns at once with everything preserved
      return;
    }
    check('MUL10A', 'HL', hl);
    const x = read5(hl);
    const n = signedByte(i.a);
    const rec = data.replay.get(`MUL10A:${hex(x)}|${n}`);
    let r: RealResult;
    if (rec !== undefined) r = { bytes: rec.r, ok: rec.ok };
    else {
      approx(`MUL10A(${hex(x)}, ${n})`);
      r = realMul10(x, n);
    }
    write5(hl, r.bytes);
    destroy(i, !r.ok);
    carry(r.ok);
  });

  // ---- compare, negate, sign
  add('CMP', (_c, i) => {
    const hl = (i.h << 8) | i.l;
    const de = (i.d << 8) | i.e;
    check('CMP', 'HL', hl);
    check('CMP', 'DE', de);
    const r = realCmp(read5(hl), read5(de));
    cpu.ix = 0xc1c1;
    cpu.iy = IY_JUNK;
    cpu.a = r === 0 ? 0 : r < 0 ? 0xff : 1;
    cpu.f = r === 0 ? flags(false, true, false) : r < 0 ? flags(true, false, true) : flags(false, false, false);
  });
  add('NEG', (_c, i) => {
    const hl = (i.h << 8) | i.l;
    check('NEG', 'HL', hl);
    const r = realNeg(read5(hl));
    write5(hl, r);
    cpu.ix = hl; // measured: IX corrupt
    cpu.a = r[3]!;
    cpu.f = flags(false, false, false);
  });
  add('SGN', (_c, i) => {
    const hl = (i.h << 8) | i.l;
    check('SGN', 'HL', hl);
    const s = realSgn(read5(hl));
    cpu.ix = hl;
    cpu.a = s === 0 ? 0 : s < 0 ? 0xff : 1;
    cpu.f = s === 0 ? flags(false, true, false) : s < 0 ? flags(true, false, true) : flags(false, false, false);
  });

  // ---- conversions
  add('REAL2INT', (_c, i) => {
    const hl = (i.h << 8) | i.l;
    check('REAL2INT', 'HL', hl);
    const r = realToInt16(read5(hl));
    cpu.ix = hl;
    cpu.a = JUNK.a;
    if (r.ok) cpu.hl = r.value!;
    else if (r.onFail === 'zero') cpu.hl = 0;
    cpu.f = flags(r.negative, false, r.ok);
  });
  const toBin = (name: string, mode: 'round' | 'trunc' | 'floor'): void =>
    add(name, (_c, i) => {
      const hl = (i.h << 8) | i.l;
      check(name, 'HL', hl);
      const r = realToBin(read5(hl), mode);
      cpu.ix = hl;
      cpu.c = JUNK.c;
      cpu.a = JUNK.a;
      if (r.ok) {
        const v = r.value!;
        for (let k = 0; k < 4; k++) cpu.mem[(hl + k) & 0xffff] = (v >>> (8 * k)) & 255;
        cpu.b = r.neg ? 0x80 : 0;
      }
      cpu.f = flags(false, false, r.ok);
    });
  toBin('REAL2BIN', 'round');
  toBin('FIX', 'trunc');
  toBin('INT', 'floor');
  add('INT2REAL', (_c, i) => {
    const hl = (i.h << 8) | i.l;
    const de = (i.d << 8) | i.e;
    check('INT2REAL', 'DE', de);
    write5(de, int16ToReal(hl, (i.a & 0x80) !== 0));
    cpu.hl = de;
    cpu.de = hl;
    cpu.a = JUNK.a;
    cpu.f = flags(false, false, false);
  });
  add('BIN2REAL', (_c, i) => {
    const hl = (i.h << 8) | i.l;
    check('BIN2REAL', 'HL', hl);
    const m = read5(hl);
    const v = (m[0]! | (m[1]! << 8) | (m[2]! << 16) | (m[3]! << 24)) >>> 0;
    write5(hl, binToReal(v, (i.a & 0x80) !== 0));
    cpu.ix = hl;
    carry(true, JUNK.a);
  });
  add('MOVE', (_c, i) => {
    const hl = (i.h << 8) | i.l;
    const de = (i.d << 8) | i.e;
    check('MOVE', 'HL', hl);
    check('MOVE', 'DE', de);
    const src = read5(de);
    write5(hl, src);
    if (is464) cpu.a = src[4]!;
    cpu.f = flags(false, false, true);
  });
  add('PI', (_c, i) => {
    const hl = (i.h << 8) | i.l;
    check('PI', 'HL', hl);
    write5(hl, PI_BYTES);
    cpu.d = JUNK.d;
    cpu.e = JUNK.e;
    cpu.f = flags(false, false, true);
  });
  add('ANGLE', (_c, i) => {
    cpu.mem[ANGLE_ADDRESS[model]] = i.a;
    cpu.f = flags(false, false, false);
  });
  add('PREP', (_c, i) => {
    const hl = (i.h << 8) | i.l;
    check('PREP', 'HL', hl);
    const x = read5(hl);
    if (x[4] === 0) {
      // zero (exponent byte 0): returns at once, nothing written, IY kept (measured)
      cpu.b = 0;
      cpu.c = 1;
      cpu.de = hl;
      cpu.hl = hl;
      cpu.ix = hl;
      cpu.a = 0;
      cpu.f = 0x44;
      return;
    }
    const rec = data.prep.get(hex(x));
    let r: number[];
    let b: number;
    let e: number;
    if (rec !== undefined) ({ r, b, e } = rec);
    else {
      approx(`PREP(${hex(x)})`);
      const p = prepExact(x);
      const n = p.n;
      r = [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255, 0x80 + (32 - Math.clz32(n))];
      b = p.neg ? 0xff : 0x01;
      e = p.e & 255;
    }
    write5(hl, r);
    cpu.b = b;
    cpu.c = 4;
    cpu.d = is464 ? (x[4]! < 0x80 ? 0xff : 0) : b; // 6128/664/Plus: D = the sign byte (1 or &FF); 464: &FF when the exponent byte is below &80 (|x| < 0.5), else 0
    cpu.e = e;
    cpu.hl = (hl + 3) & 0xffff;
    cpu.ix = hl;
    cpu.iy = is464 ? 0x2f18 : 0x30c1;
    cpu.a = 3;
    cpu.f = 0x00;
  });

  // ---- RND: replayed streams
  let stream: number[][] | undefined;
  let pos = 0;
  let snapshot = '';
  let last: number[] | undefined;
  const seedAt = RND_SEED_ADDRESS[model];
  const seedHex = (): string => hex([0, 1, 2, 3].map((k) => cpu.mem[seedAt + k]!));
  BOOT_SEED.forEach((b, k) => (cpu.mem[seedAt + k] = b));
  const selectStream = (): void => {
    const s = seedHex();
    snapshot = s;
    pos = 0;
    if (s === hex(BOOT_SEED)) stream = data.rndBoot;
    else {
      stream = data.rndSeeded.get(s);
      if (stream === undefined)
        throw new FwMathError(`RND: no recorded sequence for the seed ${s} (the recurrence is not known; fwmath-vectors.json holds the boot seed and 24 RANDOMIZE seeds)`);
    }
  };
  add('RND', (_c, i) => {
    const hl = (i.h << 8) | i.l;
    check('RND', 'HL', hl);
    if (stream === undefined || seedHex() !== snapshot) selectStream();
    if (pos >= stream!.length) throw new FwMathError(`RND: the recorded sequence for the seed ${snapshot} has only ${stream!.length} values`);
    last = stream![pos++]!;
    write5(hl, last);
    // The firmware replaces the seed at every call (the recurrence is not known). Stand-in bytes, so that a program that
    // writes the SAME seed again (RANDOMIZE n twice) is seen as reseeding: the stream restarts from its first value.
    [0xee, pos & 255, pos >> 8, 0xee].forEach((b, k) => (cpu.mem[seedAt + k] = b));
    snapshot = seedHex();
    cpu.b = JUNK.b;
    cpu.c = JUNK.c;
    cpu.d = JUNK.d;
    cpu.e = JUNK.e;
    cpu.a = JUNK.a;
    cpu.f = flags(false, false, true);
    cpu.ix = hl;
  });
  add('RND0', (_c, i) => {
    const hl = (i.h << 8) | i.l;
    check('RND0', 'HL', hl);
    if (last === undefined) throw new FwMathError('RND(0) before any RND: the last value at boot is not recorded');
    write5(hl, last);
    cpu.b = JUNK.b;
    cpu.c = JUNK.c;
    cpu.d = JUNK.d;
    cpu.e = JUNK.e;
    cpu.a = JUNK.a;
    cpu.f = flags(false, false, true);
    cpu.ix = hl;
  });
}
