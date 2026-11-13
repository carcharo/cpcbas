/**
 * The `--stage ir` dump (format in docs/ir.md).
 *
 * One item per line, deterministic, spans left out:
 * - `main`, then its quads; each `proc ...` header then its quads; quads are indented two
 *   spaces, labels sit at column 0 as `label:`;
 * - a quad is `op.type dst, a, b` (see {@link printQuad});
 * - then `global`, `string`, `data`, `require` and `init` lines, each group after a blank line.
 */
import type { IrDataItem, IrGlobal, IrProcedure, IrProgram, IrString, Operand, PrintIrFn, Quad } from './ir.js';

const signed = (n: number): string => (n < 0 ? `-${-n}` : `+${n}`);

export function printOperand(o: Operand): string {
  switch (o.k) {
    case 'imm':
      return `#${o.value}`;
    case 'temp':
      return `t${o.id}`;
    case 'global':
      return o.label;
    case 'frame':
      return o.byref === true ? `[[ix${signed(o.offset)}]]` : `[ix${signed(o.offset)}]`;
    case 'addr':
      return `@${o.label}${o.offset === undefined || o.offset === 0 ? '' : signed(o.offset)}`;
    case 'frameaddr':
      return `@[ix${signed(o.offset)}]`;
    case 'strconst':
      return `s${o.id}`;
  }
}

/** Bytes as a double-quoted string: printable ASCII as is, `"` `\` and others escaped (`\xNN`). */
function quoteBytes(bytes: Iterable<number>): string {
  let s = '"';
  for (const b of bytes) {
    if (b === 0x22) s += '\\"';
    else if (b === 0x5c) s += '\\\\';
    else if (b >= 0x20 && b < 0x7f) s += String.fromCharCode(b);
    else s += `\\x${b.toString(16).padStart(2, '0')}`;
  }
  return `${s}"`;
}

const quoteText = (text: string): string => quoteBytes(Array.from(text, (c) => c.charCodeAt(0) & 0xff));

const list = (...parts: string[]): string => parts.join(', ');

/** One quad as a line without indentation. Labels are `name:`. */
export function printQuad(q: Quad): string {
  const o = printOperand;
  switch (q.op) {
    case 'load':
    case 'store':
    case 'neg':
    case 'not':
    case 'abs':
    case 'peek':
    case 'aload':
      return `${q.op}.${q.type} ${list(o(q.dst), o(q.a))}`;
    case 'in':
      return `in.${q.type} ${list(o(q.dst), o(q.a))}`;
    case 'add':
    case 'sub':
    case 'mul':
    case 'div':
    case 'mod':
    case 'pow':
    case 'and':
    case 'or':
    case 'xor':
    case 'shl':
    case 'shr':
    case 'concat':
    case 'eq':
    case 'ne':
    case 'lt':
    case 'le':
    case 'gt':
    case 'ge':
      return `${q.op}.${q.type} ${list(o(q.dst), o(q.a), o(q.b))}`;
    case 'cast':
      return `cast.${q.type}<-${q.from} ${list(o(q.dst), o(q.a))}`;
    case 'poke':
    case 'out':
    case 'astore':
      return `${q.op}.${q.type} ${list(o(q.a), o(q.b))}`;
    case 'aaddr':
      return `aaddr.${q.type} ${list(o(q.dst), o(q.array), String(q.dims))}`;
    case 'label':
      return `${q.label}:`;
    case 'jump':
      return `jump ${q.label}`;
    case 'jz':
    case 'jnz':
      return `${q.op}.${q.type} ${list(o(q.a), q.label)}`;
    case 'jtable':
      return `${q.gosub ? 'jtable.gosub' : 'jtable'} ${o(q.a)}, [${q.labels.join(', ')}]`;
    case 'gosub':
      return `gosub ${q.label}`;
    case 'retsub':
      return 'retsub';
    case 'end':
      return `end ${o(q.a)}`;
    case 'param':
    case 'fparam':
      return `${q.op}.${q.type} ${o(q.a)}`;
    case 'call': {
      const head = `call ${list(q.label, String(q.argBytes))}`;
      return q.ret === null ? head : `${head} -> ${q.ret}${q.dst === null ? '' : ` ${o(q.dst)}`}`;
    }
    case 'rtcall': {
      const head = `rtcall ${q.label}`;
      return q.ret === null ? head : `${head} -> ${q.ret}${q.dst === null ? '' : ` ${o(q.dst)}`}`;
    }
    case 'enter':
      return `enter ${q.localBytes}`;
    case 'ret':
      return `ret.${q.type} ${list(o(q.a), q.label)}`;
    case 'leave':
      return `leave ${q.argBytes} ${q.convention.toLowerCase()}`;
    case 'asm':
      // Handled by the caller (one line per asm line).
      return 'asm';
    case 'stmt':
      return q.number === null ? '; stmt' : `; line ${q.number}`;
    case 'comment':
      return `; ${q.text}`;
  }
}

function quadLines(q: Quad): string[] {
  if (q.op === 'label') return [printQuad(q)];
  if (q.op === 'asm') return q.lines.length === 0 ? ['  asm'] : q.lines.map((l) => `  asm ${quoteText(l.text)}`);
  return [`  ${printQuad(q)}`];
}

function procHeader(p: IrProcedure): string {
  const params = p.params.map((x) => `${x.type} ${x.byref ? `[[ix${signed(x.offset)}]]` : `[ix${signed(x.offset)}]`}`);
  return `proc ${p.label} ${p.convention.toLowerCase()} (${params.join(', ')})${p.ret === null ? '' : ` -> ${p.ret}`}`;
}

function hex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

function globalLine(g: IrGlobal): string {
  let s = `global ${g.label} ${g.type} size=${g.size}`;
  if (g.dims.length > 0) s += ` dims=[${g.dims.join(',')}]`;
  if (g.at !== null) s += ` at=${g.at}`;
  if (g.hidata !== undefined) s += ` hidata=${g.hidata}`;
  if (g.init !== null) s += ` init=${hex(g.init)}`;
  return s;
}

const stringLine = (s: IrString): string => `string s${s.id} ${s.label} ${quoteBytes(s.bytes)}`;

function dataLine(d: IrDataItem): string {
  const value = typeof d.value === 'number' ? String(d.value) : quoteBytes(d.value);
  return `data ${d.label === null ? '-' : d.label} ${d.type} ${value}${d.spelling === undefined ? '' : ` spelling ${quoteBytes(d.spelling)}`}`;
}

export const printIr: PrintIrFn = (program: IrProgram): string => {
  const out: string[] = ['main'];
  for (const q of program.main) out.push(...quadLines(q));
  for (const p of program.procedures) {
    out.push('', procHeader(p));
    for (const q of p.body) out.push(...quadLines(q));
  }
  const groups: string[][] = [
    program.globals.map(globalLine),
    program.strings.map(stringLine),
    program.data.map(dataLine),
    program.requires.map((r) => `require ${quoteText(r)}`),
    program.inits.map((i) => `init ${i}`),
  ];
  for (const g of groups) if (g.length > 0) out.push('', ...g);
  return `${out.join('\n')}\n`;
};
