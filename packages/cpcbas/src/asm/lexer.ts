/**
 * The asm lexer: one logical line of text -> tokens. Follows the reference lexer
 * (zxbasm asmlex.py): the rules are tried in the reference's order and the first match wins,
 * so `0b01` is binary, `1bh` is hex, `1b` is the temporary label "1B" and `%101` is binary
 * while `a % 3` is the modulo operator.
 */

export type TokKind = 'int' | 'str' | 'id' | 'kw' | 'op' | 'eol';

export interface Tok {
  readonly kind: TokKind;
  /** `int`: the value. `str`: the unquoted text. `id`: the name as written (a temporary label is upper-cased). `kw`: the upper-case keyword. `op`: the operator text. */
  readonly text: string;
  readonly value: number;
  /** 0-based column of the first character in the line text. */
  readonly col: number;
  readonly end: number;
}

export interface LexError {
  readonly col: number;
  readonly char: string;
}

const MNEMONICS = new Set(
  (
    'adc add and bit call ccf cp cpd cpdr cpi cpir cpl daa dec di djnz ei ex exx halt im in inc ind indr ini inir jp jr ' +
    'ld ldd lddr ldi ldir neg nop or otdr otir out outd outi pop push res ret reti retn rl rla rlc rlca rld rr rra rrc ' +
    'rrca rrd rst sbc scf set sla sll sra srl sub xor'
  ).split(' '),
);

/** Pseudo-operations, mapped to the reference's canonical token (`db`/`defm` are DEFB, `ds` is DEFS, `dw` is DEFW). */
const PSEUDO = new Map<string, string>([
  ['align', 'ALIGN'],
  ['org', 'ORG'],
  ['defb', 'DEFB'],
  ['defm', 'DEFB'],
  ['db', 'DEFB'],
  ['defs', 'DEFS'],
  ['defw', 'DEFW'],
  ['ds', 'DEFS'],
  ['dw', 'DEFW'],
  ['equ', 'EQU'],
  ['proc', 'PROC'],
  ['endp', 'ENDP'],
  ['local', 'LOCAL'],
  ['end', 'END'],
  ['incbin', 'INCBIN'],
  ['namespace', 'NAMESPACE'],
]);

export const REGS8 = new Set(['a', 'b', 'c', 'd', 'e', 'h', 'l', 'i', 'r', 'ixh', 'ixl', 'iyh', 'iyl']);
export const REGS16 = new Set(['af', 'bc', 'de', 'hl', 'ix', 'iy', 'sp']);
export const FLAGS = new Set(['z', 'nz', 'nc', 'po', 'pe', 'p', 'm']);

export type KeywordClass = 'mnemonic' | 'pseudo' | 'reg8' | 'reg16' | 'flag';

/** The class of a (lower-case) word, or undefined when it is an ordinary identifier. */
export function keywordClass(word: string): KeywordClass | undefined {
  if (MNEMONICS.has(word)) return 'mnemonic';
  if (PSEUDO.has(word)) return 'pseudo';
  if (REGS8.has(word)) return 'reg8';
  if (FLAGS.has(word)) return 'flag';
  if (REGS16.has(word)) return 'reg16';
  return undefined;
}

// The reference's rules in the order it tries them (HEXA, BIN, TMPLABEL, INTEGER, ID).
const CHAR_RE = /'(.)'/y;
const HEXA_RE = /(?:[0-9](?:_?[0-9a-fA-F])*[hH])|(?:\$[0-9a-fA-F](?:_?[0-9a-fA-F])*)|(?:0x[0-9a-fA-F](?:_?[0-9a-fA-F])*)/y;
const BIN_RE = /(?:%[01](?:_?[01])*)|(?:0[bB](?:_?[01])+)/y;
const TMP_RE = /[0-9]+[FfBb]/y;
const INT_RE = /[0-9](?:_?\d)*/y;
const ID_RE = /[._a-zA-Z][._a-zA-Z0-9]*/y;
const STR_RE = /"(?:""|[^"])*"/y;

const OPS3 = ['<<', '>>'];
const OPS1 = new Set([',', '$', '[', ']', '(', ')', '&', '|', '~', '+', '-', '*', '/', '%', '^', "'", ':']);

function match(re: RegExp, text: string, pos: number): string | undefined {
  re.lastIndex = pos;
  const m = re.exec(text);
  return m ? m[0] : undefined;
}

/** Tokenises a line (without its line end). Illegal characters are collected in `errors` and skipped. */
export function lexLine(text: string, errors: LexError[]): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i] as string;
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    if (c === ';') break; // comment to end of line
    if (c === '\\') {
      // A backslash that is not a continuation is ignored by the reference only at a line end.
      i++;
      continue;
    }
    let m: string | undefined;
    if (c === "'" && (m = match(CHAR_RE, text, i)) !== undefined) {
      out.push({ kind: 'int', text: m, value: (m.codePointAt(1) as number), col: i, end: i + m.length });
      i += m.length;
      continue;
    }
    if ((m = match(HEXA_RE, text, i)) !== undefined) {
      let digits: string;
      if (m.startsWith('0x')) digits = m.slice(2);
      else if (m.startsWith('$')) digits = m.slice(1);
      else digits = m.slice(0, -1);
      out.push({ kind: 'int', text: m, value: parseInt(digits.replace(/_/g, ''), 16), col: i, end: i + m.length });
      i += m.length;
      continue;
    }
    if ((m = match(BIN_RE, text, i)) !== undefined) {
      const digits = m.startsWith('%') ? m.slice(1) : m.slice(2);
      out.push({ kind: 'int', text: m, value: parseInt(digits.replace(/_/g, ''), 2), col: i, end: i + m.length });
      i += m.length;
      continue;
    }
    if ((m = match(TMP_RE, text, i)) !== undefined) {
      out.push({ kind: 'id', text: m.toUpperCase(), value: 0, col: i, end: i + m.length });
      i += m.length;
      continue;
    }
    if ((m = match(INT_RE, text, i)) !== undefined) {
      out.push({ kind: 'int', text: m, value: parseInt(m.replace(/_/g, ''), 10), col: i, end: i + m.length });
      i += m.length;
      continue;
    }
    if ((m = match(ID_RE, text, i)) !== undefined) {
      const lower = m.toLowerCase();
      const cls = keywordClass(lower);
      if (cls === undefined) {
        out.push({ kind: 'id', text: m, value: 0, col: i, end: i + m.length });
      } else {
        const canonical = cls === 'pseudo' ? (PSEUDO.get(lower) as string) : lower.toUpperCase();
        out.push({ kind: 'kw', text: canonical, value: 0, col: i, end: i + m.length });
      }
      i += m.length;
      continue;
    }
    if (c === '"' && (m = match(STR_RE, text, i)) !== undefined) {
      out.push({ kind: 'str', text: m.slice(1, -1).replace(/""/g, '"'), value: 0, col: i, end: i + m.length });
      i += m.length;
      continue;
    }
    const two = text.slice(i, i + 2);
    if (OPS3.includes(two)) {
      out.push({ kind: 'op', text: two, value: 0, col: i, end: i + 2 });
      i += 2;
      continue;
    }
    if (OPS1.has(c)) {
      out.push({ kind: 'op', text: c, value: 0, col: i, end: i + 1 });
      i++;
      continue;
    }
    errors.push({ col: i, char: c });
    i++;
  }
  out.push({ kind: 'eol', text: '', value: 0, col: n, end: n });
  return out;
}
