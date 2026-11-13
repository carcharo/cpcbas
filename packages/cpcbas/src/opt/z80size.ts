/**
 * The size in bytes of one line of Z80 assembly text, read from the assembler's own instruction table
 * (`asm/z80/table.gen.ts`) the way the encoder picks a row, so the two cannot disagree. An instruction's size
 * never depends on a symbol's value (an operand that is not a register is `N` or `NN` whatever its value),
 * which is what lets the code stage size a span before the program is laid out (L5-CG's `jr` pass).
 *
 * `lineSize` answers null for what it cannot size: a directive with data (`defb`, `defw`, `defs`, `org`, ...), a
 * macro or anything that mentions `$`. A caller treats null as "unknown", never as zero.
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { Z80_TABLE } from '../asm/z80/table.gen.js';

const SIZES = new Map<string, number>();
const TIMES = new Map<string, number>();
const MNEMONICS = new Set<string>();
for (const [key, t, size, , z80n] of Z80_TABLE) {
  if (z80n === 1) continue;
  SIZES.set(key, size);
  TIMES.set(key, t);
  MNEMONICS.add(key.split(' ')[0] as string);
}

const REGS = new Set(['A', 'B', 'C', 'D', 'E', 'H', 'L', 'I', 'R', 'IXH', 'IXL', 'IYH', 'IYL', 'AF', 'BC', 'DE', 'HL', 'SP', 'IX', 'IY', "AF'", 'NZ', 'Z', 'NC', 'PO', 'PE', 'P', 'M']);
const INDIRECT = new Set(['HL', 'BC', 'DE', 'SP', 'C', 'IX', 'IY']);
const BIT_OPS = new Set(['BIT', 'SET', 'RES']);

/** The ways the table may spell an operand, in the encoder's order. */
function choices(op: string, first: boolean, mnemonic: string): readonly string[] | null {
  const u = op.toUpperCase();
  if (REGS.has(u)) return [u];
  if (u.startsWith('(') && u.endsWith(')')) {
    const inner = u.slice(1, -1).trim();
    if (INDIRECT.has(inner)) return [`(${inner})`];
    const m = /^(IX|IY)\s*[+-]/.exec(inner);
    if (m !== null) return [`(${m[1] as string}+N)`];
    return ['(NN)', '(N)'];
  }
  if (first && (BIT_OPS.has(mnemonic) || mnemonic === 'IM')) return /^[0-7]$/.test(u) ? [u] : null;
  if (first && mnemonic === 'RST') return /^(0|8|10|18|20|28|30|38|\$?[0-9]+)$/i.test(u) ? ['RST'] : null;
  return ['N', 'NN'];
}

/** Bytes of one instruction line's text (`ld a, (ix+3)`, no leading tab needed), or null. */
export function instructionSize(text: string): number | null {
  return instructionCost(text)?.bytes ?? null;
}

/** Bytes and T-states of one instruction (the table's figure: a taken `jr`/`djnz` is its longer time), or null. */
export function instructionCost(text: string): { readonly bytes: number; readonly t: number } | null {
  let t = text.trim();
  const semi = t.indexOf(';');
  if (semi >= 0) t = t.slice(0, semi).trim();
  if (t === '' || t.includes('$')) return t === '' ? { bytes: 0, t: 0 } : null;
  const sp = t.search(/\s/);
  const mnemonic = (sp < 0 ? t : t.slice(0, sp)).toUpperCase();
  if (!MNEMONICS.has(mnemonic)) return null;
  const rest = sp < 0 ? '' : t.slice(sp).trim();
  const operands = rest === '' ? [] : rest.split(',').map((s) => s.trim());
  if (mnemonic === 'RST') return operands.length === 1 && choices(operands[0] as string, true, mnemonic) !== null ? { bytes: 1, t: 11 } : null;
  const per: Array<readonly string[]> = [];
  for (let i = 0; i < operands.length; i++) {
    const c = choices(operands[i] as string, i === 0, mnemonic);
    if (c === null) return null;
    per.push(c);
  }
  const pick: string[] = [];
  let found: { bytes: number; t: number } | null = null;
  const search = (i: number): boolean => {
    if (i === per.length) {
      const key = pick.length === 0 ? mnemonic : `${mnemonic} ${pick.join(',')}`;
      const size = SIZES.get(key);
      if (size === undefined) return false;
      found = { bytes: size, t: TIMES.get(key) as number };
      return true;
    }
    for (const c of per[i] as readonly string[]) {
      pick[i] = c;
      if (search(i + 1)) return true;
    }
    pick.length = i;
    return false;
  };
  return search(0) ? found : null;
}

/** The label a line defines (`.T.3:`), or null. */
export function labelOf(text: string): string | null {
  const m = /^([A-Za-z_.][\w.$]*):\s*$/.exec(text);
  return m === null ? null : (m[1] as string);
}

/**
 * Bytes of one code-stage line: 0 for a label, a comment or a `#line`, the instruction's size otherwise, null when unknown.
 * A label line may carry an instruction after it (`x: ld a, 1`); anything else that starts at column 0 is unknown.
 */
export function lineSize(text: string): number | null {
  if (text === '' || text.startsWith('#') || text.startsWith(';')) return 0;
  if (labelOf(text) !== null) return 0;
  if (text.startsWith('\t') || text.startsWith(' ')) {
    const t = text.trim();
    if (t === '' || t.startsWith(';')) return 0;
    return instructionSize(t);
  }
  return null;
}
