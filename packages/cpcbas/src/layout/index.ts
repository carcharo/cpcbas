/** The memory-layout check (contract: layout/types.ts; reference: zxbc.py `check_memory_layout`). */
import type { CheckLayoutFn, LayoutInput } from './types.js';

export type * from './types.js';

export const IMPLEMENTED = true;

function hex4(n: number): string {
  return n.toString(16).toUpperCase().padStart(4, '0');
}

function h(n: number): string {
  return `0x${hex4(n)}`;
}

export const checkLayout: CheckLayoutFn = (input: LayoutInput): boolean => {
  const { map, segments, globalLabels, span, diagnostics } = input;
  const heapUsed = input.heapInUse;
  const heapAddress = input.heapAddress;
  const heapEnd = heapUsed ? heapAddress + input.heapSize : 0;
  let ok = true;
  const fail = (code: 'E400' | 'E401' | 'E402' | 'E403' | 'E404' | 'E405' | 'E406', message: string): void => {
    ok = false;
    diagnostics.report(code, span, message);
  };

  const buffers = input.fileBufferBytes ?? 0;
  const bufStart = map.codeLimit - buffers;
  const bufRange = `${h(bufStart)}-${h(map.codeLimit - 1)}`;

  segments.forEach((seg, index) => {
    const what = index === 0 ? 'compiled code+data' : 'data placed at';
    const range = `${h(seg.start)}-${h(seg.end - 1)}`;
    const spanText = index === 0 ? `(${range})` : range;
    for (const r of map.reserved) {
      if (globalLabels.has(r.label) && seg.start < r.end && r.start < seg.end) {
        fail('E400', `${what} ${spanText} overlaps ${h(r.start)}-${h(r.end - 1)}, reserved because ${r.reason}`);
      }
    }
    if (seg.end > map.codeLimit) {
      fail('E401', `${what} ends at ${h(seg.end)}, past this architecture's memory limit of ${h(map.codeLimit)}`);
    } else if (buffers > 0 && seg.end > bufStart) {
      fail('E405', `${what} ends at ${h(seg.end)}, inside the AMSDOS file buffers (${bufRange}) that the file statements need`);
    }
    if (heapUsed && seg.start < heapEnd && heapAddress < seg.end) {
      const tail = index === 0 ? '' : ': move the data, or the heap (--heap-address, --heap)';
      fail('E402', `${what} ${spanText} overlaps the heap (${h(heapAddress)}-${h(heapEnd - 1)})${tail}`);
    }
  });

  if (buffers > 0 && heapUsed && heapEnd > bufStart) {
    fail('E406', `the heap (${h(heapAddress)}-${h(heapEnd - 1)}) overlaps the AMSDOS file buffers (${bufRange})`);
  }

  for (const r of map.reserved) {
    if (globalLabels.has(r.label) && heapUsed && heapAddress < r.end && r.start < heapEnd) {
      fail(
        'E403',
        `the heap (${h(heapAddress)}-${h(heapEnd - 1)}) overlaps ${h(r.start)}-${h(r.end - 1)}, reserved because ${r.reason}`,
      );
    }
  }

  const org = segments[0]?.start;
  if (org !== undefined && org < map.minCode) {
    const reason = map.minCodeReason ? ` (${map.minCodeReason})` : '';
    fail('E404', `origin ${h(org)} is below this architecture's lowest usable address of ${h(map.minCode)}${reason}`);
  }
  return ok;
};
