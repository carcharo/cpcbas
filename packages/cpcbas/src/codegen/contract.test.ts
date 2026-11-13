import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { InternalError } from '../core/diagnostics.js';
import { BARE_MAP, FIRMWARE_MAP, RequireSet, TEMPLATES, makeTarget, memoryMapEqus } from './index.js';

const GOLDEN = fileURLToPath(new URL('../../../../tests/asm-golden/programs/', import.meta.url));
const golden = (name: string) => readFileSync(GOLDEN + name, 'latin1').split('\n');

describe('codegen contract data', () => {
  it('emits the memory-map EQUs exactly as the reference prologue', () => {
    expect(memoryMapEqus(FIRMWARE_MAP)).toEqual(golden('empty.asm').slice(1, 5));
    expect(memoryMapEqus(BARE_MAP)).toEqual(golden('cpc_strings_bare.asm').slice(1, 5));
  });

  it('builds the default target as the reference CPC backend', () => {
    const fw = makeTarget({});
    expect(fw.mode).toBe('firmware');
    expect(fw.org).toBe(0x40);
    expect(fw.heapSize).toBe(4768);
    expect(fw.heapAddress).toBe(35680); // print_hello.asm: .core.ZXBASIC_MEM_HEAP EQU 35680
    expect([...fw.asmDefines.keys()]).toEqual(['CPC_INKEY_BUFFERED', '__MEMORY_CHECK__']); // __MEMORY_CHECK__: a failed allocation is error 7 (follow-up 50)
    const bare = makeTarget({ defines: { CPC_BAREMETAL: '' }, heapSize: 1000 });
    expect(bare.mode).toBe('bare');
    expect(bare.heapAddress).toBe(0xb800 - 1000);
    expect(bare.asmDefines.has('CPC_INKEY_BUFFERED')).toBe(false);
    expect(bare.asmDefines.has('__MEMORY_CHECK__')).toBe(true);
    expect(makeTarget({ org: 0x4000, settings: { org: 0x1000, heapSize: null, heapAddress: null } }).org).toBe(0x4000);
    expect(makeTarget({ settings: { org: 0x1000, heapSize: null, heapAddress: null } }).org).toBe(0x1000);
  });

  it('records runtime files by label, sorted, bootstrap forced', () => {
    const r = new RequireSet();
    expect(r.call('.core.__PRINTSTR')).toBe('\tcall .core.__PRINTSTR');
    r.label('.core.PRINT_EOL');
    r.file('fwcall.asm');
    expect(r.sorted()).toEqual(['bootstrap.asm', 'fwcall.asm', 'print.asm', 'printstr.asm']);
    expect(r.needsHeap()).toBe(false);
    r.label('.core.__STORE_STR');
    expect(r.needsHeap()).toBe(true);
    expect(() => r.call('.core.NO_SUCH_LABEL')).toThrow(InternalError);
  });

  it('has no duplicate template keys across the template tables', () => {
    const seen = new Set<string>();
    for (const table of TEMPLATES) {
      for (const key of Object.keys(table)) {
        expect(seen.has(key), key).toBe(false);
        seen.add(key);
      }
    }
  });
});
