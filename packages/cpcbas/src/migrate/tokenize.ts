/**
 * A Boriel-aware tokenizer for `cpcbas migrate`. It keeps every character of the input (whitespace,
 * comments, line continuations), so joining the token texts gives the file back. It knows what the CPC
 * BASIC lexer rejects: `$FF`, `0FFh`, `%0101` and `0101b` numbers, `/' ... '/` block comments,
 * `ASM ... END ASM` blocks (one token, never scanned as BASIC) and preprocessor lines.
 */

export type TokKind =
  | 'ws' // spaces and tabs
  | 'nl' // a line end (\n, \r\n or \r)
  | 'cont' // `_` or `\` at the end of a line, with the line end: the next line continues this one
  | 'comment' // `'...`, `REM ...` (to the end of the line) or `/' ... '/`
  | 'str' // "..." (a doubled quote is one quote)
  | 'num' // a number in any Boriel form
  | 'word' // a name or keyword, with its `$`, `%` or `!` suffix
  | 'op' // punctuation and operators
  | 'pp' // a preprocessor directive word: `#include`, `#define` ...
  | 'inc' // the `<file>` of an `#include`
  | 'asm'; // the body of an ASM block (between the ASM line and END ASM)

export interface Tok {
  readonly kind: TokKind;
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

const isDigit = (c: string): boolean => c >= '0' && c <= '9';
const isHexDigit = (c: string): boolean => (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
const isLetter = (c: string): boolean => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
export const isIdentChar = (c: string): boolean => isLetter(c) || isDigit(c) || c === '_';

/** The kind of number a `num` token spells: the rewrite (W700) needs to know. */
export type NumForm = 'dec' | 'dollarHex' | 'hSuffixHex' | 'percentBin' | 'bSuffixBin';

export function numForm(text: string): NumForm {
  if (text.startsWith('&')) return 'dec';
  if (text.startsWith('$')) return 'dollarHex';
  if (text.startsWith('%')) return 'percentBin';
  if (/^[0-9][0-9a-fA-F]*[hH]$/.test(text)) return 'hSuffixHex';
  if (/^[01]+[bB]$/.test(text)) return 'bSuffixBin';
  return 'dec';
}

const OPS2 = new Set(['<>', '<=', '>=', '<<', '>>', '=>']);

/** Statement-start context for deciding whether `ASM` opens a block. */
function startsStatement(prev: Tok | undefined): boolean {
  if (prev === undefined) return true;
  if (prev.kind === 'nl') return true;
  if (prev.kind === 'op' && prev.text === ':') return true;
  if (prev.kind === 'word') {
    const u = prev.text.toUpperCase();
    return u === 'THEN' || u === 'ELSE';
  }
  return false;
}

export function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  const n = text.length;
  let p = 0;
  /** The previous token that is not whitespace, a continuation or a comment. */
  let prevSig: Tok | undefined;
  /** True while only whitespace has been seen on the current line. */
  let atLineStart = true;
  const push = (kind: TokKind, start: number, end: number): Tok => {
    const t: Tok = { kind, text: text.slice(start, end), start, end };
    out.push(t);
    if (kind !== 'ws' && kind !== 'cont' && kind !== 'comment') prevSig = t;
    if (kind === 'nl') atLineStart = true;
    else if (kind !== 'ws' && kind !== 'cont') atLineStart = false;
    return t;
  };
  const eol = (from: number): number => {
    let q = from;
    while (q < n && text[q] !== '\n' && text[q] !== '\r') q++;
    return q;
  };
  /** After the end of a line, the end of its line break. */
  const afterBreak = (q: number): number => (text[q] === '\r' && text[q + 1] === '\n' ? q + 2 : q + 1);

  while (p < n) {
    const c = text[p] as string;
    // line breaks
    if (c === '\n' || c === '\r') {
      const e = afterBreak(p);
      push('nl', p, e);
      p = e;
      continue;
    }
    if (c === ' ' || c === '\t') {
      let q = p + 1;
      while (q < n && (text[q] === ' ' || text[q] === '\t')) q++;
      push('ws', p, q);
      p = q;
      continue;
    }
    // continuation: `_` or `\` (blank) end of line
    if (c === '_' || c === '\\') {
      const before = text[p - 1];
      if (c === '\\' || before === undefined || !isIdentChar(before)) {
        let q = p + 1;
        while (q < n && (text[q] === ' ' || text[q] === '\t')) q++;
        if (q >= n || text[q] === '\n' || text[q] === '\r') {
          const e = q >= n ? n : afterBreak(q);
          push('cont', p, e);
          p = e;
          continue;
        }
      }
    }
    // comments
    if (c === "'") {
      const e = eol(p);
      push('comment', p, e);
      p = e;
      continue;
    }
    if (c === '/' && text[p + 1] === "'") {
      const close = text.indexOf("'/", p + 2);
      const e = close < 0 ? n : close + 2;
      push('comment', p, e);
      p = e;
      continue;
    }
    // strings
    if (c === '"') {
      let q = p + 1;
      for (;;) {
        if (q >= n || text[q] === '\n' || text[q] === '\r') break;
        if (text[q] === '"') {
          if (text[q + 1] === '"') {
            q += 2;
            continue;
          }
          q++;
          break;
        }
        q++;
      }
      push('str', p, q);
      p = q;
      continue;
    }
    // preprocessor directive word at the start of a line
    if (c === '#' && atLineStart) {
      let q = p + 1;
      while (q < n && isLetter(text[q] as string)) q++;
      const t = push('pp', p, q);
      p = q;
      if (t.text.toLowerCase() === '#include') {
        let r = p;
        while (r < n && (text[r] === ' ' || text[r] === '\t')) r++;
        if (text[r] === '<') {
          const close = text.indexOf('>', r);
          const lineEnd = eol(r);
          if (close >= 0 && close < lineEnd) {
            if (r > p) push('ws', p, r);
            push('inc', r, close + 1);
            p = close + 1;
          }
        }
      }
      continue;
    }
    // CPC BASIC numbers: &FF, &HFF, &X0101 are one token, so their digits are not read as Boriel forms
    if (c === '&') {
      const m = /^&(?:[xX][01]+|[hH]?[0-9a-fA-F]+)/.exec(text.slice(p, p + 40));
      if (m !== null) {
        push('num', p, p + m[0].length);
        p += m[0].length;
        continue;
      }
    }
    // numbers
    if (isDigit(c) || (c === '.' && isDigit(text[p + 1] ?? ''))) {
      const before = text[p - 1];
      if (before === undefined || !isIdentChar(before)) {
        const rest = text.slice(p, p + 64);
        let m: RegExpExecArray | null;
        let e: number;
        if ((m = /^0[xX][0-9a-fA-F]+(?![A-Za-z0-9_$])/.exec(rest))) e = p + m[0].length;
        else if ((m = /^[0-9][0-9a-fA-F]*[hH](?![A-Za-z0-9_$])/.exec(rest))) e = p + m[0].length;
        else if ((m = /^[01]+[bB](?![A-Za-z0-9_$])/.exec(rest))) e = p + m[0].length;
        else {
          m = /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/.exec(rest) as RegExpExecArray;
          e = p + m[0].length;
        }
        push('num', p, e);
        p = e;
        continue;
      }
    }
    if (c === '$') {
      let q = p + 1;
      while (q < n && isHexDigit(text[q] as string)) q++;
      const before = text[p - 1];
      if (q > p + 1 && (before === undefined || !(isIdentChar(before) || before === '$'))) {
        push('num', p, q);
        p = q;
        continue;
      }
    }
    if (c === '%') {
      let q = p + 1;
      while (q < n && (text[q] === '0' || text[q] === '1')) q++;
      const before = text[p - 1];
      if (q > p + 1 && (before === undefined || !isIdentChar(before)) && !isIdentChar(text[q] ?? ' ')) {
        push('num', p, q);
        p = q;
        continue;
      }
    }
    // words
    if (isLetter(c) || c === '_') {
      let q = p + 1;
      while (q < n && isIdentChar(text[q] as string)) q++;
      const sfx = text[q];
      if (sfx === '$' || sfx === '%' || sfx === '!') q++;
      const wordText = text.slice(p, q);
      const up = wordText.toUpperCase();
      if (up === 'REM') {
        const e = eol(p);
        push('comment', p, e);
        p = e;
        continue;
      }
      const prevBefore = prevSig;
      push('word', p, q);
      p = q;
      if (up === 'ASM' && startsStatement(prevBefore) && !(prevBefore?.kind === 'word' && prevBefore.text.toUpperCase() === 'END')) {
        // a block when the rest of the line is blank or a comment
        let r = p;
        while (r < n && (text[r] === ' ' || text[r] === '\t')) r++;
        if (r >= n || text[r] === '\n' || text[r] === '\r' || text[r] === "'" || text.slice(r, r + 3).toUpperCase() === 'REM') {
          const lineEnd = eol(r);
          // the rest of the ASM line (a comment) then the body, up to the END of `END ASM`
          const re = /\bEND[ \t]+ASM\b/gi;
          re.lastIndex = lineEnd;
          const m = re.exec(text);
          const bodyEnd = m ? m.index : n;
          if (r < lineEnd) {
            if (r > p) push('ws', p, r);
            push('comment', r, lineEnd);
            p = lineEnd;
          }
          if (bodyEnd > p) {
            push('asm', p, bodyEnd);
            p = bodyEnd;
          }
        }
      }
      continue;
    }
    // operators
    const two = text.slice(p, p + 2);
    if (OPS2.has(two)) {
      push('op', p, p + 2);
      p += 2;
      continue;
    }
    push('op', p, p + 1);
    p++;
  }
  return out;
}

/** The offsets at which each line starts (a line ends at \n, \r\n or a lone \r). */
export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) i++;
      starts.push(i + 1);
    } else if (c === 10) starts.push(i + 1);
  }
  return starts;
}

/** 1-based line and column of an offset. */
export function positionOf(starts: readonly number[], offset: number): { line: number; col: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] as number) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, col: offset - (starts[lo] as number) + 1 };
}
