import { describe, expect, it } from 'vitest';
import { DiagnosticBag } from '../core/diagnostics.js';
import type { Span } from '../core/source.js';
import { BARE_MAP, FIRMWARE_MAP, type MemoryMap } from '../codegen/memory-map.js';
import { checkLayout, IMPLEMENTED, type LayoutInput } from './index.js';

const span = { file: 0, start: 0, end: 0 } as unknown as Span;
const RES = '.core.__CPC_RESERVE_4000';

function run(over: Partial<LayoutInput> & { segments: LayoutInput['segments'] }, map: MemoryMap = FIRMWARE_MAP) {
  const diagnostics = new DiagnosticBag();
  const ok = checkLayout({
    map,
    heapInUse: false,
    heapAddress: 0x8a60,
    heapSize: 4768,
    globalLabels: new Set(),
    span,
    diagnostics,
    ...over,
  });
  return { ok, d: diagnostics.all() };
}

describe('checkLayout', () => {
  it('is implemented', () => expect(IMPLEMENTED).toBe(true));

  it('passes a program that fits', () => {
    const r = run({ segments: [{ start: 0x40, end: 0x2000 }] });
    expect(r.ok).toBe(true);
    expect(r.d).toEqual([]);
  });

  it('firmware limit: ending exactly at 0x9E00 passes, one more fails (E401)', () => {
    expect(run({ segments: [{ start: 0x40, end: 0x9e00 }] }).ok).toBe(true);
    const r = run({ segments: [{ start: 0x40, end: 0x9e01 }] });
    expect(r.ok).toBe(false);
    expect(r.d.map((x) => x.code)).toEqual(['E401']);
    expect(r.d[0]?.message).toBe(
      "compiled code+data ends at 0x9E01, past this architecture's memory limit of 0x9E00",
    );
    expect(r.d[0]?.hint).toBeTruthy();
  });

  it('bare limit is 0xB800', () => {
    expect(run({ segments: [{ start: 0x40, end: 0xb800 }] }, BARE_MAP).ok).toBe(true);
    const r = run({ segments: [{ start: 0x40, end: 0xb801 }] }, BARE_MAP);
    expect(r.d[0]?.message).toBe(
      "compiled code+data ends at 0xB801, past this architecture's memory limit of 0xB800",
    );
  });

  it('data segment wording for the limit', () => {
    const r = run({
      segments: [
        { start: 0x40, end: 0x100 },
        { start: 0xa000, end: 0xa010 },
      ],
    });
    expect(r.d[0]?.message).toBe("data placed at ends at 0xA010, past this architecture's memory limit of 0x9E00");
  });

  it('reserved range only when its label is defined (E400)', () => {
    const seg = [{ start: 0x3ff0, end: 0x4001 }];
    expect(run({ segments: seg }).ok).toBe(true);
    const r = run({ segments: seg, globalLabels: new Set([RES]) });
    expect(r.ok).toBe(false);
    expect(r.d[0]?.code).toBe('E400');
    expect(r.d[0]?.message).toBe(
      'compiled code+data (0x3FF0-0x4000) overlaps 0x4000-0x7FFF, reserved because the program uses a library that reserves it (such as a double-buffered back screen)',
    );
  });

  it('reserved range boundaries', () => {
    const labels = new Set([RES]);
    expect(run({ segments: [{ start: 0x40, end: 0x4000 }], globalLabels: labels }).ok).toBe(true);
    expect(run({ segments: [{ start: 0x8000, end: 0x8100 }], globalLabels: labels }).ok).toBe(true);
    expect(run({ segments: [{ start: 0x7fff, end: 0x8100 }], globalLabels: labels }).ok).toBe(false);
  });

  it('hidata segment in the reserved range', () => {
    const r = run({
      segments: [
        { start: 0x40, end: 0x100 },
        { start: 0x5000, end: 0x5100 },
      ],
      globalLabels: new Set([RES]),
    });
    expect(r.d[0]?.message).toBe(
      'data placed at 0x5000-0x50FF overlaps 0x4000-0x7FFF, reserved because the program uses a library that reserves it (such as a double-buffered back screen)',
    );
  });

  it('heap overlap for the main segment (E402)', () => {
    const r = run({
      segments: [{ start: 0x40, end: 0x8a61 }],
      heapInUse: true,
    });
    expect(r.d.map((x) => x.code)).toEqual(['E402']);
    expect(r.d[0]?.message).toBe('compiled code+data (0x0040-0x8A60) overlaps the heap (0x8A60-0x9CFF)');
    expect(run({ segments: [{ start: 0x40, end: 0x8a60 }], heapInUse: true }).ok).toBe(true);
  });

  it('heap overlap for a data segment has the move hint text', () => {
    const r = run({
      segments: [
        { start: 0x40, end: 0x100 },
        { start: 0x9000, end: 0x9100 },
      ],
      heapInUse: true,
    });
    expect(r.d[0]?.message).toBe(
      'data placed at 0x9000-0x90FF overlaps the heap (0x8A60-0x9CFF): move the data, or the heap (--heap-address, --heap)',
    );
  });

  it('heap checks skipped when the heap is not in use', () => {
    const r = run({ segments: [{ start: 0x40, end: 0x9000 }], heapInUse: false, globalLabels: new Set([RES]) });
    expect(r.d.some((x) => x.code === 'E402' || x.code === 'E403')).toBe(false);
  });

  it('heap overlapping a reserved range (E403), only with the label and the heap', () => {
    const base = { segments: [{ start: 0x40, end: 0x100 }], heapAddress: 0x7000, heapSize: 0x2000 };
    expect(run({ ...base, heapInUse: true }).ok).toBe(true);
    expect(run({ ...base, globalLabels: new Set([RES]) }).ok).toBe(true);
    const r = run({ ...base, heapInUse: true, globalLabels: new Set([RES]) });
    expect(r.d.map((x) => x.code)).toEqual(['E403']);
    expect(r.d[0]?.message).toBe(
      'the heap (0x7000-0x8FFF) overlaps 0x4000-0x7FFF, reserved because the program uses a library that reserves it (such as a double-buffered back screen)',
    );
  });

  it('origin below the minimum (E404)', () => {
    const r = run({ segments: [{ start: 0x3f, end: 0x100 }] });
    expect(r.ok).toBe(false);
    expect(r.d.map((x) => x.code)).toEqual(['E404']);
    expect(r.d[0]?.message).toBe(
      "origin 0x003F is below this architecture's lowest usable address of 0x0040 ($0000-$003F hold the restarts and interrupt vectors)",
    );
    expect(run({ segments: [{ start: 0x40, end: 0x100 }] }).ok).toBe(true);
  });

  it('origin message omits the parentheses when there is no reason', () => {
    const r = run({ segments: [{ start: 0x10, end: 0x100 }] }, { ...FIRMWARE_MAP, minCodeReason: '' });
    expect(r.d[0]?.message).toBe("origin 0x0010 is below this architecture's lowest usable address of 0x0040");
  });

  it('reports every finding, in the reference order', () => {
    const r = run({
      segments: [{ start: 0x10, end: 0x9e10 }],
      heapInUse: true,
      heapAddress: 0x7000,
      heapSize: 0x2000,
      globalLabels: new Set([RES]),
    });
    expect(r.d.map((x) => x.code)).toEqual(['E400', 'E401', 'E402', 'E403', 'E404']);
  });
});
