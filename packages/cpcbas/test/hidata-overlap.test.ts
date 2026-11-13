/** Follow-up 44 (L3-FIX): a `#pragma hidata` block that lands on the program's own code is an error, not a silent overwrite. */
import { describe, expect, it } from 'vitest';
import { compile, formatDiagnostic } from '../src/index.js';
import { libTree } from './runtime-tree.js';

function build(src: string) {
  const r = compile({ files: new Map([['main.bas', src]]), main: 'main.bas', runtime: libTree(), options: { format: 'bin' } });
  return { r, errors: r.diagnostics.filter((d) => d.severity === 'error').map((d) => formatDiagnostic(d, r.sources)) };
}

describe('#pragma hidata over the program', () => {
  it('a block inside the code is E537 with the address', () => {
    const b = build('#pragma hidata = &0100\nDIM t(3) AS UBYTE => {1,2,3,4}\nPRINT t(0)\n');
    expect(b.r.ok).toBe(false);
    expect(b.errors).toHaveLength(1);
    expect(b.errors[0]).toMatch(/error E537: Output overlaps earlier output at address 256 \(&0100\)/);
  });

  it('a block above the program and below the private block is fine', () => {
    const b = build('#pragma hidata = &8000\nDIM t(3) AS UBYTE => {1,2,3,4}\nPRINT t(0)\n');
    expect(b.errors).toEqual([]);
    expect(b.r.ok).toBe(true);
  });
});
