/**
 * Argument kinds of the built-in statements and functions the checker types itself, derived
 * from the keyword table (lang/keywords.ts, `params`): the entries marked `checked`. Entries
 * not marked are typed generically: arguments are typed but not constrained.
 *
 * `kinds[i]` is the kind of argument i; for a function whose last param repeats (MIN, MAX)
 * the consumer repeats the last kind.
 */
import { KEYWORDS, type ArgKind } from '../lang/keywords.js';

export type { ArgKind };

function derive(kind: 'statement' | 'function'): Readonly<Record<string, readonly ArgKind[]>> {
  const out: Record<string, readonly ArgKind[]> = {};
  for (const k of KEYWORDS) {
    if (k.kind === kind && k.checked && k.params) out[k.name] = k.params.map((p) => p.kind);
  }
  return out;
}

export const STMT_SIGS: Readonly<Record<string, readonly ArgKind[]>> = derive('statement');

export const FN_SIGS: Readonly<Record<string, readonly ArgKind[]>> = derive('function');
