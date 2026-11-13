/**
 * A fake AMSDOS for the test Z80 (moved out of files-run.test.ts by L5-SIMFW so that every machine has one): the CAS entries
 * of the firmware manual (CAS IN OPEN &BC77, CAS IN CLOSE &BC7A, CAS IN ABANDON &BC7D, CAS IN CHAR &BC80, CAS IN DIRECT
 * &BC83, CAS RETURN &BC86, CAS TEST EOF &BC89, CAS OUT OPEN &BC8C, CAS OUT CLOSE &BC8F, CAS OUT ABANDON &BC92, CAS OUT CHAR
 * &BC95, CAS OUT DIRECT &BC98) and KL INIT BACK &BCCE, over an in-memory set of files, with a log of the calls it saw.
 */
import { FirmwareContractError } from './cpc.js';
import type { Cpc } from './cpc.js';

export interface DiscFile {
  data: number[];
  type: number;
  load: number;
  entry: number;
}

/** A fake AMSDOS: the files, one input and one output stream, and a log of the calls it saw. */
export class Disc {
  files = new Map<string, DiscFile>();
  log: string[] = [];
  input: { name: string; file: DiscFile; pos: number } | null = null;
  output: { name: string; data: number[]; mode: 'none' | 'char' | 'direct'; file: DiscFile | null } | null = null;
  /** The buffers CAS IN OPEN and CAS OUT OPEN were given. */
  buffers: { in: number[]; out: number[] } = { in: [], out: [] };
  /** The registers CAS OUT DIRECT got: address, length, entry and type. */
  direct: { hl: number; de: number; bc: number; a: number } | null = null;
  initBack = 0;

  put(name: string, bytes: string | number[], over: Partial<DiscFile> = {}): void {
    const data = typeof bytes === 'string' ? Array.from(bytes, (c) => c.charCodeAt(0)) : bytes;
    this.files.set(name, { data, type: 0, load: 0, entry: 0, ...over });
  }
  text(name: string): string | null {
    const f = this.files.get(name);
    return f === undefined ? null : String.fromCharCode(...f.data);
  }
}

const NOT_FOUND = 0x92; // what AMSDOS returns for a name it cannot find (measured: DERR 146 on the interpreter)

export function installDisc(cpc: Cpc, d: Disc): void {
  const mem = cpc.cpu.mem;
  const NONE: never[] = [];
  const ALL = ['a', 'f', 'b', 'c', 'd', 'e', 'h', 'l'] as const;
  const ok = (c: Cpc['cpu']): void => {
    c.f = (c.f | 1) & ~0x40; // Carry true, Zero false
  };
  const fail = (c: Cpc['cpu'], code: number, hard: boolean): void => {
    c.a = code;
    c.f = (c.f & ~1 & ~0x40) | (hard ? 0x40 : 0); // Carry false; Zero true for "failed for another reason"
  };
  const nameOf = (hl: number, len: number): string =>
    Array.from(mem.subarray(hl, hl + len), (b) => String.fromCharCode(b)).join('').replace(/\0+$/, '');
  mem[0xbc77] = 0; // the tape's jump block entry: the runtime starts AMSDOS (KL INIT BACK) before its first file call
  cpc.fw(0xbcce, 'KL INIT BACK', ['a', 'f', 'b', 'c', 'd', 'e', 'h', 'l'], (c, i) => {
    const got = [i.c, i.d, i.e, i.h, i.l];
    if (got.join() !== [7, 1, 0, 0xb0, 0xff].join()) throw new FirmwareContractError(`KL INIT BACK entered with C,D,E,H,L = ${got.join(',')}, not 7,1,0,&B0,&FF`); // ROM 7, the boot's memory limits
    d.initBack++;
    mem[0xbc77] = 0xdf;
  });
  cpc.fw(0xbc77, 'CAS IN OPEN', [...ALL], (c, i) => {
    const name = nameOf(i.h * 256 + i.l, i.b);
    d.buffers.in.push(i.d * 256 + i.e);
    d.log.push(`IN OPEN ${name}`);
    const f = d.files.get(name);
    if (d.input !== null) return fail(c, 0x0e, false);
    if (f === undefined) return fail(c, NOT_FOUND, true);
    d.input = { name, file: f, pos: 0 };
    ok(c);
    c.h = 0x90;
    c.l = 0;
    c.d = f.load >> 8;
    c.e = f.load & 255;
    c.b = f.data.length >> 8;
    c.c = f.data.length & 255;
    c.a = f.type;
  });
  cpc.fw(0xbc7a, 'CAS IN CLOSE', [...ALL], (c) => {
    d.log.push('IN CLOSE');
    if (d.input === null) return fail(c, 0x0e, false);
    d.input = null;
    ok(c);
  });
  cpc.fw(0xbc7d, 'CAS IN ABANDON', [...ALL], () => {
    d.log.push('IN ABANDON');
    d.input = null;
  });
  cpc.fw(0xbc80, 'CAS IN CHAR', ['a', 'f'], (c) => {
    const s = d.input;
    if (s === null) return fail(c, 0x0e, false);
    const b = s.file.data[s.pos];
    if (b === undefined) return fail(c, 0x0f, false);
    s.pos++;
    c.a = b;
    ok(c);
  });
  cpc.fw(0xbc86, 'CAS RETURN', NONE, () => {
    if (d.input !== null) d.input.pos--;
  });
  cpc.fw(0xbc89, 'CAS TEST EOF', ['a', 'f'], (c) => {
    const s = d.input;
    if (s === null) return fail(c, 0x0e, false);
    if (s.pos >= s.file.data.length) return fail(c, 0x0f, false);
    ok(c);
  });
  cpc.fw(0xbc83, 'CAS IN DIRECT', [...ALL], (c, i) => {
    const s = d.input;
    if (s === null) return fail(c, 0x0e, false);
    d.log.push(`IN DIRECT ${(i.h * 256 + i.l).toString(16)}`);
    const dest = i.h * 256 + i.l;
    s.file.data.slice(s.pos).forEach((b, k) => (mem[dest + k] = b));
    s.pos = s.file.data.length;
    ok(c);
    c.h = s.file.entry >> 8;
    c.l = s.file.entry & 255;
  });
  cpc.fw(0xbc8c, 'CAS OUT OPEN', [...ALL], (c, i) => {
    const name = nameOf(i.h * 256 + i.l, i.b);
    d.buffers.out.push(i.d * 256 + i.e);
    d.log.push(`OUT OPEN ${name}`);
    if (d.output !== null) return fail(c, 0x0e, false);
    d.output = { name, data: [], mode: 'none', file: null };
    ok(c);
    c.h = 0x91;
    c.l = 0;
  });
  cpc.fw(0xbc95, 'CAS OUT CHAR', ['a', 'f'], (c, i) => {
    const o = d.output;
    if (o === null || o.mode === 'direct') return fail(c, 0x0e, false);
    o.mode = 'char';
    o.data.push(i.a);
    ok(c);
  });
  cpc.fw(0xbc98, 'CAS OUT DIRECT', [...ALL], (c, i) => {
    const o = d.output;
    if (o === null || o.mode !== 'none') return fail(c, 0x0e, false);
    const hl = i.h * 256 + i.l;
    const len = i.d * 256 + i.e;
    d.direct = { hl, de: len, bc: i.b * 256 + i.c, a: i.a };
    o.mode = 'direct';
    o.data = Array.from(mem.subarray(hl, hl + len));
    o.file = { data: o.data, type: i.a, load: hl, entry: i.b * 256 + i.c };
    ok(c);
  });
  cpc.fw(0xbc8f, 'CAS OUT CLOSE', [...ALL], (c) => {
    const o = d.output;
    d.log.push('OUT CLOSE');
    if (o === null) return fail(c, 0x0e, false);
    // a file nothing was written to is not created (the firmware manual; measured: OPENOUT, CLOSEOUT, OPENIN says not found)
    if (o.data.length > 0 || o.mode === 'direct') d.files.set(o.name, o.file ?? { data: o.data, type: 0, load: 0, entry: 0 });
    d.output = null;
    ok(c);
  });
  cpc.fw(0xbc92, 'CAS OUT ABANDON', [...ALL], () => {
    d.output = null;
  });
}
