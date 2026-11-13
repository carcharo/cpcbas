/**
 * R17: would the differential layers catch the flow optimiser's known bugs? Bug 1: a store through an unknown pointer leaves memory facts alive. Bug 4: a store to `_x` does not invalidate a
 * value held for an overlapping cell such as `(_x+1)` (em00k's `(_x - 1)`).
 *
 * No optimiser pass exists yet, so each bug is modelled by a test-only asm hook (opt-harness.ts `withAsmHook`) that does what a
 * memory-fact pass does: it folds a PEEK or POKE through a constant address (`@v + K`) into a direct access `(_v+K)` (the
 * folding L5-IR and L5-PEEP will make), remembers the constant stored in each cell, and replaces a later load of a known cell
 * with the constant. The variants differ only in what a store forgets:
 *
 * - `sound`: a store through a pointer (`(hl)`, `(ix+d)`, block moves) forgets every fact. A store to an explicit offset
 *   `(_v+K)` (a folded address) may reach past `_v` into another variable (`@n0 + 7` is n3's high byte), so it forgets every
 *   fact too. A plain store to `(_v)` (an assignment: the variable's own cells) forgets the facts about `_v` at any offset
 *   and every fact at an explicit offset. The control: it must pass everywhere, or the model itself is wrong.
 * - `label`: docs/ir.md's rule as L5-0 wrote it: a store to a global forgets the facts about the same label whatever the
 *   offset, and nothing about other labels. It misses a folded address that reaches into the next variable.
 * - `bug1`: as `sound`, but a store through a pointer forgets nothing.
 * - `bug4`: as `sound`, but a store forgets only the fact of the same cell and width (`(_v)` word, not `(_v+1)` byte).
 *
 * The fuzzer's fixed seeds and two programs (em00k's examples, in this dialect) must catch `bug1` and `bug4`.
 */
import { describe, expect, it } from 'vitest';
import { generate, render } from './fuzz/gen.js';
import { compareLevels, withAsmHook } from './opt-harness.js';
import type { AsmHook, Program } from './opt-harness.js';
import { ALIAS, BUG1, BUG4 } from './opt-programs.js';

type Variant = 'sound' | 'label' | 'bug1' | 'bug4';

const NUM = String.raw`-?\d+`;
const SYM = String.raw`(_[A-Za-z]\w*)(?:([+-])(\d+))?`;

interface Cell {
  readonly label: string;
  readonly off: number;
  /** Written `(_v+K)`, not `(_v)`: a folded address, which may lie outside `_v`. */
  readonly explicit: boolean;
}

/** `(_v)` or `(_v+K)`. */
function cell(text: string): Cell | null {
  const m = new RegExp(`^\\(${SYM}\\)$`).exec(text);
  if (m === null) return null;
  return { label: m[1]!, off: m[2] === undefined ? 0 : (m[2] === '-' ? -1 : 1) * Number(m[3]), explicit: m[2] !== undefined };
}

/**
 * The fold: the address `_v + K` computed into HL, then a byte or word access through HL, as one direct access. The address is
 * `ld de, K / ld hl, _v / add hl, de` with the `push hl / pop hl` that -O0 leaves after it, or (L5-PEEP, which removes that pair
 * and turns K = 1..3 into increments) `ld hl, _v` and K times `inc hl`.
 */
function fold(lines: string[]): string[] {
  const out: string[] = [];
  /** The address computation at `i`: the cell's text and the index after it, or null. */
  const address = (i: number): { at: string; next: number } | null => {
    const k = new RegExp(`^\\tld de, (${NUM})$`).exec(lines[i]!);
    const v = /^\tld hl, (_[A-Za-z]\w*)$/.exec(lines[i + 1] ?? '');
    if (k !== null && v !== null && lines[i + 2] === '\tadd hl, de') {
      const pair = lines[i + 3] === '\tpush hl' && lines[i + 4] === '\tpop hl';
      return { at: `(${v[1]}+${Number(k[1])})`, next: i + (pair ? 5 : 3) };
    }
    // L5-IR folds `@v + K` into the constant `_v+K`: `ld hl, _v+K`
    const f = /^\tld hl, (_[A-Za-z]\w*)\+(\d+)$/.exec(lines[i]!);
    if (f !== null) return { at: `(${f[1]}+${Number(f[2])})`, next: i + 1 };
    const w = /^\tld hl, (_[A-Za-z]\w*)$/.exec(lines[i]!);
    if (w !== null) {
      let n = 0;
      while (lines[i + 1 + n] === '\tinc hl') n++;
      if (n >= 1 && n <= 3) return { at: `(${w[1]}+${n})`, next: i + 1 + n };
    }
    return null;
  };
  for (let i = 0; i < lines.length; i++) {
    const a = address(i);
    if (a !== null) {
      const { at } = a;
      const rest = lines.slice(a.next, a.next + 4);
      if (rest[0] === '\tld a, (hl)' && rest[1] === '\tinc hl' && rest[2] === '\tld h, (hl)' && rest[3] === '\tld l, a') {
        out.push(`\tld hl, ${at}`, '\tld a, l'); // the template leaves A = L, and L5-PEEP's 001 relies on it
        i = a.next + 3;
        continue;
      }
      if (rest[0] === '\tld (hl), e' && rest[1] === '\tinc hl' && rest[2] === '\tld (hl), d') {
        out.push(`\tld ${at}, de`);
        i = a.next + 2;
        continue;
      }
      if (rest[0] === '\tld a, (hl)') {
        out.push(`\tld a, ${at}`);
        i = a.next;
        continue;
      }
      const imm = new RegExp(`^\\tld \\(hl\\), (${NUM})$`).exec(rest[0] ?? '');
      if (imm !== null) {
        out.push(`\tld a, ${imm[1]}`, `\tld ${at}, a`);
        i = a.next;
        continue;
      }
    }
    out.push(lines[i]!);
  }
  return out;
}

interface Fact extends Cell {
  readonly width: 1 | 2;
  readonly value: number;
}

/** The memory-fact pass of one variant over the user code (main program and procedures). */
function factPass(variant: Variant, lines: string[]): string[] {
  let facts: Fact[] = [];
  const regs = new Map<string, number>();
  const forgetAll = (): void => {
    facts = [];
    regs.clear();
  };
  const store = (c: Cell, width: 1 | 2, value: number | undefined): void => {
    if (variant === 'bug4') facts = facts.filter((f) => !(f.label === c.label && f.off === c.off && f.width === width));
    else if (variant === 'label') facts = facts.filter((f) => f.label !== c.label);
    else if (c.explicit) facts = [];
    else facts = facts.filter((f) => f.label !== c.label && !f.explicit);
    if (value !== undefined) facts.push({ ...c, width, value: width === 1 ? value & 0xff : value & 0xffff });
  };
  const known = (label: string, off: number, width: 1 | 2): number | undefined => facts.find((f) => f.label === label && f.off === off && f.width === width)?.value;
  const out: string[] = [];
  for (const line of lines) {
    let m: RegExpExecArray | null;
    if (!line.startsWith('\t') || /^\t(call|jp|jr|ret|rst|djnz|reti|halt|def[bwsm])\b/.test(line) || line.startsWith('#')) {
      forgetAll(); // a label, a jump or call, data, a #line: no fact crosses it in any variant
      out.push(line);
      continue;
    }
    if ((m = new RegExp(`^\\tld (hl|de|a), (${NUM})$`).exec(line)) !== null) {
      regs.set(m[1]!, Number(m[2]));
      out.push(line);
      continue;
    }
    if ((m = /^\tld (\(.*\)), (hl|de|bc|a)$/.exec(line)) !== null && cell(m[1]!) !== null) {
      store(cell(m[1]!)!, m[2] === 'a' ? 1 : 2, regs.get(m[2]!));
      out.push(line);
      continue;
    }
    if ((m = /^\tld (hl|de|a), (\(.*\))$/.exec(line)) !== null && cell(m[2]!) !== null) {
      const c = cell(m[2]!)!;
      const v = known(c.label, c.off, m[1] === 'a' ? 1 : 2);
      regs.clear();
      if (v !== undefined) {
        regs.set(m[1]!, v);
        out.push(`\tld ${m[1]}, ${v}`);
      } else out.push(line);
      continue;
    }
    // anything else: its registers are unknown afterwards; a store through a pointer forgets the memory facts (not in bug1)
    regs.clear();
    const pointerStore = /^\tld \((hl|de|bc|i[xy][^)]*)\), /.test(line) || /^\t(ldir|lddr|ldi|ldd|inc \(|dec \(|ex \(sp\)|rl \(|rr \(|rlc \(|rrc \(|sla \(|sra \(|srl \(|set \d, \(|res \d, \()/.test(line);
    if (pointerStore) {
      if (variant !== 'bug1') facts = [];
    }
    else if (line.startsWith('\tld (')) facts = []; // a store this model does not read (another register, an odd operand): forget
    out.push(line);
  }
  return out;
}

/** The hook of a variant: the fold, then the fact pass, over the user code only (from the main program to the runtime includes). */
export function memoryFactHook(variant: Variant): AsmHook {
  return (asm) => {
    const lines = asm.split('\n');
    const from = lines.findIndex((l) => l.startsWith('.core.__MAIN_PROGRAM__'));
    const to = lines.findIndex((l) => l.includes(';; --- end of user code ---'));
    if (from < 0 || to < from) return asm;
    return [...lines.slice(0, from), ...factPass(variant, fold(lines.slice(from, to))), ...lines.slice(to)].join('\n');
  };
}

const prog = (name: string, files: string): Program => ({ name, files });

/** The bugs must be caught within the fixed seeds of `npm test`'s fuzzer (1..200); the control runs the first 50 (time). */
const SEEDS = 200;
const CONTROL_SEEDS = 50;

/** The first seed in 1..last whose program the variant's hook makes differ at -O2, or null. */
function firstCaught(variant: Variant, last = SEEDS): { seed: number; detail: string } | null {
  return withAsmHook(memoryFactHook(variant), () => {
    for (let seed = 1; seed <= last; seed++) {
      const v = compareLevels(prog(`seed ${seed}`, render(generate(seed))), [2]);
      if (v.kind === 'fail') return { seed, detail: v.detail };
    }
    return null;
  });
}

describe("em00k's flow-optimiser bugs are caught by the differential layers (R17)", () => {
  it('the sound model is right on both programs, and it really changes the code (the bug-4 program is folded and run)', () => {
    for (const p of [BUG1, BUG4, ALIAS]) {
      const v = withAsmHook(memoryFactHook('sound'), () => compareLevels(p, [2]));
      expect(v.kind, `${p.name}: ${v.detail}`).toBe('ok');
    }
    expect(withAsmHook(memoryFactHook('sound'), () => compareLevels(BUG4, [2])).ran).toEqual([2]);
  });

  it('layer 1: bug 1 and bug 4 each make their program print the wrong value', () => {
    const b1 = withAsmHook(memoryFactHook('bug1'), () => compareLevels(BUG1, [2]));
    expect(b1.kind).toBe('fail');
    expect(b1.detail).toMatch(/transcript differs/);
    const b4 = withAsmHook(memoryFactHook('bug4'), () => compareLevels(BUG4, [2]));
    expect(b4.kind).toBe('fail');
    expect(b4.detail).toMatch(/transcript differs/);
    // and each bug is specific: the other bug's program passes
    expect(withAsmHook(memoryFactHook('bug1'), () => compareLevels(BUG4, [2])).kind).toBe('ok');
    expect(withAsmHook(memoryFactHook('bug4'), () => compareLevels(BUG1, [2])).kind).toBe('ok');
  });

  it("docs/ir.md's first rule (a store forgets the facts of its own label only) misses a folded address in the next variable", () => {
    const v = withAsmHook(memoryFactHook('label'), () => compareLevels(ALIAS, [2]));
    expect(v.kind).toBe('fail');
    expect(v.detail).toMatch(/transcript differs/);
  });

  it(`layer 2: the sound model passes the fuzzer's first ${CONTROL_SEEDS} seeds, and bug 1, bug 4 and the label rule are each caught within ${SEEDS}`, () => {
    expect(firstCaught('sound', CONTROL_SEEDS)).toBeNull();
    // L5-IR (follow-up 174): the generator's constant `@n0 + K` that leaves its variable reaches the case the label rule misses
    const label = firstCaught('label');
    expect(label, 'the label rule without the offsets paragraph').not.toBeNull();
    if (process.env['CPCBAS_FUZZ_SHOW'] !== undefined) console.log(`label rule: ${JSON.stringify(label)}`);
    const b1 = firstCaught('bug1');
    const b4 = firstCaught('bug4');
    expect(b1, 'bug 1').not.toBeNull();
    expect(b4, 'bug 4').not.toBeNull();
    if (process.env['CPCBAS_FUZZ_SHOW'] !== undefined) console.log(`bug 1: seed ${b1?.seed}: ${b1?.detail}\nbug 4: seed ${b4?.seed}: ${b4?.detail}`);
  }, 120_000);
});
