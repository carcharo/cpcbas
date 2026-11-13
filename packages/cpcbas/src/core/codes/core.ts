/** Codes 001-099: compiler, pipeline and host. Owner: scaffold / pipeline wiring (L1-WIRE) / CLI (L1-CLI). */
import type { CodeTable } from '../diagnostics.js';

export const CORE_CODES = {
  E001: { severity: 'error', title: 'Internal compiler error', hint: 'This is a bug in cpcbas; please report it with the source that triggers it.' },
  E002: { severity: 'error', title: 'Not implemented yet' },
  E003: { severity: 'error', title: 'File not found' },
  E004: { severity: 'error', title: 'Invalid compile option' },
  E005: { severity: 'error', title: 'Too many errors; stopping' },
  // 010-049: CLI / host (L1-CLI)
  E010: { severity: 'error', title: 'Cannot write output file' },
  // 050-099: free
} as const satisfies CodeTable;
