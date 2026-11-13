/**
 * The Z80 instruction encoder (task L2-ENC): one instruction with evaluated operands ->
 * bytes, table-driven from the reference assembler's Z80SET (table.gen.ts).
 *
 * The pattern key is built from the operands the way the reference parser builds it
 * (`LD A,(IX+N)`, `JP NZ,NN`, `BIT 3,(HL)`), looked up in the table, and the argument
 * bytes (`XX` in the template) are filled little-endian.
 */
import { InternalError, type DiagnosticCode } from '../../core/diagnostics.js';
import type { EncodeFn, EncodeRequest, EncodeResult, Operand } from '../types.js';
import { Z80_TABLE } from './table.gen.js';

type ArgKind = 'value' | 'disp' | 'target';

interface Arg {
  readonly kind: ArgKind;
  readonly value: number;
  readonly pending: boolean;
}

/** One way to write an operand in a pattern key. */
interface Choice {
  readonly text: string;
  readonly arg?: Arg;
}

interface Entry {
  readonly key: string;
  /** Opcode bytes; -1 marks an argument byte. */
  readonly template: readonly number[];
  /** Byte width of each argument group (`N` = 1, `NN` = 2) in key order. */
  readonly groups: readonly number[];
}

const ENTRIES = new Map<string, Entry>();
const MNEMONICS = new Set<string>();

for (const [key, , size, opcode, z80n] of Z80_TABLE) {
  if (z80n === 1) continue; // Z80 only (no Z80N)
  const template = opcode.split(' ').map((t) => (t === 'XX' ? -1 : parseInt(t, 16)));
  if (template.length !== size) throw new InternalError(`Z80 table: size mismatch for ${key}`);
  const groups = (key.match(/\bN+\b/g) ?? []).map((g) => g.length);
  ENTRIES.set(key, { key, template, groups });
  MNEMONICS.add(key.split(' ')[0] as string);
}

const BIT_OPS = new Set(['BIT', 'SET', 'RES']);

function err(code: DiagnosticCode, message: string): EncodeResult {
  return { ok: false, code, message };
}

function choicesFor(op: Operand, index: number, mnemonic: string): readonly Choice[] | EncodeResult {
  switch (op.kind) {
    case 'reg8':
      return [{ text: op.reg }];
    case 'reg16':
      return [{ text: op.reg }];
    case 'cond':
      return [{ text: op.cond }];
    case 'flags':
      return [{ text: 'F' }];
    case 'regIndirect':
      return [{ text: `(${op.reg})` }];
    case 'mem': {
      const arg: Arg = { kind: 'value', value: op.address, pending: op.pending === true };
      return [{ text: '(NN)', arg }, { text: '(N)', arg }];
    }
    case 'index': {
      const pending = op.pending === true;
      const out: Choice[] = [{ text: `(${op.reg}+N)`, arg: { kind: 'disp', value: op.disp, pending } }];
      if (op.disp === 0 && !pending) out.push({ text: `(${op.reg})` });
      return out;
    }
    case 'imm': {
      const pending = op.pending === true;
      if (index === 0 && BIT_OPS.has(mnemonic)) {
        if (!pending && (!Number.isInteger(op.value) || op.value < 0 || op.value > 7)) {
          return err('E501', `Invalid bit position ${op.value}. Must be in [0..7]`);
        }
        return [{ text: String(pending ? 0 : op.value) }];
      }
      if (index === 0 && mnemonic === 'IM') {
        if (!pending && ![0, 1, 2].includes(op.value)) return err('E501', `Invalid IM number ${op.value}`);
        return [{ text: String(pending ? 0 : op.value) }];
      }
      if (index === 0 && mnemonic === 'RST') {
        if (!pending && ![0, 8, 16, 24, 32, 40, 48, 56].includes(op.value)) {
          return err('E501', `Invalid RST number ${op.value}`);
        }
        return [{ text: `${(pending ? 0 : op.value).toString(16).toUpperCase()}H` }];
      }
      const kind: ArgKind = mnemonic === 'JR' || mnemonic === 'DJNZ' ? 'target' : 'value';
      const arg: Arg = { kind, value: op.value, pending };
      return [{ text: 'N', arg }, { text: 'NN', arg }];
    }
  }
}

function isResult(x: readonly Choice[] | EncodeResult): x is EncodeResult {
  return !Array.isArray(x);
}

export const encode: EncodeFn = (request: EncodeRequest): EncodeResult => {
  const mnemonic = request.mnemonic.toUpperCase();
  if (!MNEMONICS.has(mnemonic)) return err('E500', `Unknown instruction '${request.mnemonic}'`);

  const perOperand: Array<readonly Choice[]> = [];
  for (let i = 0; i < request.operands.length; i++) {
    const c = choicesFor(request.operands[i] as Operand, i, mnemonic);
    if (isResult(c)) return c;
    perOperand.push(c);
  }

  // Try the combinations in order (N before NN, (IX+N) before (IX)).
  let entry: Entry | undefined;
  let chosen: Choice[] = [];
  const pick: Choice[] = [];
  const search = (i: number): boolean => {
    if (i === perOperand.length) {
      const key = pick.length === 0 ? mnemonic : `${mnemonic} ${pick.map((c) => c.text).join(',')}`;
      const found = ENTRIES.get(key);
      if (found === undefined) return false;
      entry = found;
      chosen = pick.slice();
      return true;
    }
    for (const c of perOperand[i] as readonly Choice[]) {
      pick[i] = c;
      if (search(i + 1)) return true;
    }
    pick.length = i;
    return false;
  };
  if (!search(0) || entry === undefined) {
    const shown = request.operands.length === 0 ? '' : ' ' + describe(request.operands);
    return err('E501', `Invalid operands for ${mnemonic}${shown}`);
  }
  const found: Entry = entry;

  const args = chosen.flatMap((c) => (c.arg === undefined ? [] : [c.arg]));
  const warnings: Array<{ code: DiagnosticCode; message: string }> = [];
  const values: number[] = [];
  for (let g = 0; g < found.groups.length; g++) {
    const arg = args[g];
    const width = found.groups[g] as number;
    if (arg === undefined) return err('E501', `Invalid operands for ${mnemonic}`);
    let value = arg.value;
    if (arg.pending) {
      value = 0;
    } else if (arg.kind === 'target') {
      value = arg.value - (request.pc + 2);
      if (value < -128 || value > 127) {
        return err('E502', `Relative jump out of range (${value} bytes; must be -128..127)`);
      }
    } else if (arg.kind === 'disp') {
      if (value < -128 || value > 127) {
        return err('E503', `Index displacement ${value} out of range; must be -128..127`);
      }
    } else {
      const lo = width === 1 ? -128 : -32768;
      const hi = width === 1 ? 255 : 65535;
      if (value < lo || value > hi) {
        warnings.push({ code: 'W504', message: 'Value will be truncated' });
      }
    }
    values.push(value);
  }

  const bytes: number[] = [];
  let g = 0;
  let b = 0;
  for (const t of found.template) {
    if (t >= 0) {
      bytes.push(t);
      continue;
    }
    const width = found.groups[g] as number;
    const v = values[g] as number;
    bytes.push(Math.floor(v / 2 ** (8 * b)) & 0xff);
    if (++b === width) {
      g++;
      b = 0;
    }
  }
  return warnings.length > 0 ? { ok: true, bytes, warnings } : { ok: true, bytes };
};

function describe(ops: readonly Operand[]): string {
  return ops
    .map((o) => {
      switch (o.kind) {
        case 'reg8':
        case 'reg16':
          return o.reg;
        case 'cond':
          return o.cond;
        case 'flags':
          return 'F';
        case 'imm':
          return 'n';
        case 'mem':
          return '(nn)';
        case 'regIndirect':
          return `(${o.reg})`;
        case 'index':
          return `(${o.reg}+d)`;
      }
    })
    .join(',');
}
