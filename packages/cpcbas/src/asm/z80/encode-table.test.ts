import { describe, expect, it, vi } from 'vitest';

vi.mock('./table.gen.js', () => ({ Z80_TABLE: [['NOP', 'NOP', 2, '00', 0]] }));

describe('encoder table check', () => {
  it('a size mismatch in the table is an InternalError', async () => {
    const { InternalError } = await import('../../core/diagnostics.js');
    await expect(import('./encode.js')).rejects.toBeInstanceOf(InternalError);
  });
});
