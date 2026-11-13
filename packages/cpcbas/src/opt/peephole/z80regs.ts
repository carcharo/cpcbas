/**
 * Which registers an instruction touches (reads or writes), for the rule language's `NEEDS`.
 * Own code (the fork's `MemCell.requires` reads only, and answers "no" for `ld hl, 5` against
 * `pop hl`, so its rule 028 would move the `pop` over a write of the same register).
 *
 * `touches` answers with the 8-bit registers (`a f b c d e h l ixh ixl iyh iyl`), `sp`, or null for an
 * instruction it does not model (a jump, a call, a block or I/O instruction, anything unknown): the
 * caller treats null as "touches everything".
 */

const R8 = new Set(['a', 'f', 'b', 'c', 'd', 'e', 'h', 'l', 'ixh', 'ixl', 'iyh', 'iyl', 'i', 'r']);
const PAIRS: Readonly<Record<string, readonly string[]>> = {
  af: ['a', 'f'],
  bc: ['b', 'c'],
  de: ['d', 'e'],
  hl: ['h', 'l'],
  ix: ['ixh', 'ixl'],
  iy: ['iyh', 'iyl'],
  sp: ['sp'],
};

/** The registers named by a register or a memory operand: `hl`, `a`, `(hl)`, `(ix+3)`; none for a number or a label. */
export function operandRegs(op: string): string[] {
  const t = op.trim().toLowerCase();
  if (R8.has(t)) return [t];
  const p = PAIRS[t];
  if (p !== undefined) return [...p];
  const m = /^\(\s*(hl|de|bc|sp|ix|iy)\b/.exec(t);
  if (m !== null) return [...(PAIRS[m[1] as string] as readonly string[])];
  return [];
}

/** Registers of a list such as `(sp, hl)` or `af`, expanded to single registers. */
export function expandRegs(list: string | readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const x of typeof list === 'string' ? [list] : list) for (const r of operandRegs(x)) out.add(r);
  return out;
}

const WITH_A_F = new Set(['add', 'adc', 'sub', 'sbc', 'and', 'or', 'xor', 'cp']);
const A_F_ONLY = new Set(['neg', 'cpl', 'daa', 'rla', 'rra', 'rlca', 'rrca', 'ccf', 'scf', 'rld', 'rrd']);
const ROTATES = new Set(['rl', 'rr', 'rlc', 'rrc', 'sla', 'sra', 'sll', 'srl']);

/** The registers `instr` reads or writes, or null if it is not modelled. */
export function touches(instr: string): Set<string> | null {
  const t = instr.trim().toLowerCase();
  const sp = t.search(/\s/);
  const name = sp < 0 ? t : t.slice(0, sp);
  const ops = sp < 0 ? [] : t.slice(sp).split(',').map((x) => x.trim());
  const out = new Set<string>();
  const add = (...regs: string[]): void => void regs.forEach((r) => out.add(r));
  const addOps = (): void => ops.forEach((o) => operandRegs(o).forEach((r) => out.add(r)));

  if (name === 'ld') {
    if (ops.length !== 2) return null;
    addOps();
    return out;
  }
  if (WITH_A_F.has(name)) {
    add('a', 'f');
    addOps();
    return out;
  }
  if (name === 'inc' || name === 'dec') {
    add('f');
    addOps();
    return out;
  }
  if (name === 'push' || name === 'pop') {
    add('sp');
    addOps();
    return out;
  }
  if (name === 'ex') {
    if (ops.length !== 2) return null;
    if (ops[0] === "af" && ops[1] === "af'") add('a', 'f');
    else if (ops[0] === 'de' && ops[1] === 'hl') add('d', 'e', 'h', 'l');
    else if (ops[0] === '(sp)') add('sp', ...operandRegs(ops[1] as string));
    else return null;
    return out;
  }
  if (name === 'exx') {
    add('b', 'c', 'd', 'e', 'h', 'l');
    return out;
  }
  if (A_F_ONLY.has(name)) {
    add('a', 'f');
    return out;
  }
  if (ROTATES.has(name) || name === 'bit' || name === 'set' || name === 'res') {
    add('f');
    addOps();
    return out;
  }
  if (name === 'nop') return out;
  return null;
}

/** Whether `instr` reads or writes any register of `regs`, or may (an instruction that is not modelled counts as yes). */
export function needs(instr: string, regs: string | readonly string[]): boolean {
  const t = touches(instr);
  if (t === null) return true;
  for (const r of expandRegs(regs)) if (t.has(r)) return true;
  return false;
}
