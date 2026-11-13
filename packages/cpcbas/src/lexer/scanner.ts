/**
 * Single-pass scanner behind `lex`. No regular expression per token: everything is
 * character-code tests on the source string. Every branch of the main loop advances
 * `pos`, so it terminates on any input.
 */
import type { DiagnosticBag } from '../core/diagnostics.js';
import type { SourceFile, Span } from '../core/source.js';
import type { LexOptions, Token, TokenKind } from '../core/tokens.js';
import { RESERVED_WORDS } from '../lang/keywords.js';

const MAX_U32 = 4294967295;

const isDigit = (c: number): boolean => c >= 48 && c <= 57;
const isLetter = (c: number): boolean => (c | 32) >= 97 && (c | 32) <= 122;
const isIdent = (c: number): boolean => isLetter(c) || isDigit(c) || c === 95;
const isBlank = (c: number): boolean => c >= 0 && c <= 32 && c !== 10 && c !== 13;
const isEol = (c: number): boolean => c === 10 || c === 13;
const hexVal = (c: number): number => {
  if (c >= 48 && c <= 57) return c - 48;
  const l = c | 32;
  return l >= 97 && l <= 102 ? l - 87 : -1;
};

type Extra = Record<string, unknown>;

/** Reserved words that may be written directly against a number in a typed-in listing. */
const GLUE_WORDS: ReadonlySet<string> = new Set(['TO', 'THEN', 'ELSE', 'STEP', 'GOTO', 'GOSUB']);

export class Scanner {
  private readonly text: string;
  private readonly end: number;
  private readonly fileId: SourceFile['id'];
  private readonly keep: boolean;
  /** True after a line comment (REM or `'`), until the next token is made. */
  private afterComment = false;
  private readonly out: Token[] = [];
  private pos: number;
  /** True until the first non-comment token of a physical line has been emitted. */
  private atLineStart: boolean;
  /** Whitespace (or a comment) seen since the last token. */
  private space = false;
  private asmPending = false;
  private asmSpan: Span | null = null;
  /** The whole file is the body of an ASM block (`LexOptions.asmBody`: a file `#include`d inside one). */
  private readonly asmBody: boolean;
  /** True while `lexAsmBlock` runs: a directive there is marked `inAsm`. */
  private inAsmBlock = false;

  constructor(
    file: SourceFile,
    private readonly diag: DiagnosticBag,
    options?: LexOptions,
  ) {
    this.text = file.text;
    this.fileId = file.id;
    this.keep = options?.keepComments ?? false;
    this.asmBody = options?.asmBody === true;
    const r = options?.range;
    this.pos = r ? Math.max(0, Math.min(r.start, file.text.length)) : 0;
    this.end = r ? Math.max(this.pos, Math.min(r.end, file.text.length)) : file.text.length;
    // In a range the first token is not line-initial.
    this.atLineStart = r === undefined;
  }

  // ------------------------------------------------------------------ helpers

  private at(i: number): number {
    return i < this.end ? this.text.charCodeAt(i) : -1;
  }

  private span(start: number, end: number): Span {
    return { file: this.fileId, start, end };
  }

  private eolFrom(i: number): number {
    const { text, end } = this;
    while (i < end) {
      const c = text.charCodeAt(i);
      if (c === 10 || c === 13) return i;
      i++;
    }
    return end;
  }

  /** Length of the line break at `i` (0 when none). */
  private breakLen(i: number): number {
    const c = this.at(i);
    if (c === 13) return this.at(i + 1) === 10 ? 2 : 1;
    return c === 10 ? 1 : 0;
  }

  private make(kind: TokenKind, start: number, end: number, extra?: Extra): Token {
    return {
      kind,
      span: this.span(start, end),
      text: this.text.slice(start, end),
      spaceBefore: this.space,
      lineStart: this.atLineStart,
      ...(this.afterComment ? { commentBefore: true } : null),
      ...extra,
    } as unknown as Token;
  }

  /** Emits a token and updates the line/space state. */
  private emit(kind: TokenKind, start: number, end: number, extra?: Extra): Token {
    const t = this.make(kind, start, end, extra);
    this.out.push(t);
    this.space = false;
    this.atLineStart = false;
    this.afterComment = false;
    return t;
  }

  private matchWord(i: number, word: string): boolean {
    for (let k = 0; k < word.length; k++) {
      if ((this.at(i + k) | 32) !== word.charCodeAt(k)) return false;
    }
    return true;
  }

  /**
   * `_` at `i` as a line continuation: a blank (or the line start) before it, and only
   * blanks or a comment after it. Returns the offset of the line end, or -1.
   */
  private continuationEol(i: number): number {
    if (this.at(i) !== 95) return -1;
    if (i > 0) {
      const prev = this.text.charCodeAt(i - 1);
      if (!isBlank(prev) && !isEol(prev)) return -1;
    }
    let q = i + 1;
    while (isBlank(this.at(q))) q++;
    const c = this.at(q);
    if (c === 39) return this.eolFrom(q);
    if (c === -1 || isEol(c)) return q < this.end ? q : this.end;
    if (this.matchWord(q, 'rem') && !isIdent(this.at(q + 3))) return this.eolFrom(q);
    return -1;
  }

  // --------------------------------------------------------------------- main

  run(): Token[] {
    const { text } = this;
    if (this.asmBody) this.lexAsmBlock();
    while (this.pos < this.end) {
      const start = this.pos;
      const c = text.charCodeAt(start);
      if (isBlank(c)) {
        let p = start + 1;
        while (isBlank(this.at(p))) p++;
        this.pos = p;
        this.space = true;
        continue;
      }
      if (c === 10 || c === 13) {
        const len = this.breakLen(start);
        this.emit('Newline', start, start + len);
        this.pos = start + len;
        this.atLineStart = true;
        if (this.asmPending) {
          this.asmPending = false;
          this.lexAsmBlock();
        }
        continue;
      }
      if (isDigit(c) || c === 38 || (c === 46 && isDigit(this.at(start + 1)))) {
        this.lexNumber();
      } else if (isLetter(c)) {
        this.lexWord();
      } else {
        this.lexOther(c);
      }
    }
    if (this.asmPending) {
      this.asmPending = false;
      this.lexAsmBlock();
    }
    this.atLineStart = false;
    this.space = false;
    this.out.push(this.make('EOF', this.end, this.end));
    return this.out;
  }

  private lexOther(c: number): void {
    const start = this.pos;
    switch (c) {
      case 34:
        this.lexString();
        return;
      case 39:
        this.lexLineComment(start, start + 1, 'apostrophe');
        return;
      case 47:
        if (this.at(start + 1) === 39) {
          this.lexBlockComment();
          return;
        }
        this.punct('/', 1);
        return;
      case 63: // ?
        this.emit('Keyword', start, start + 1, { keyword: 'PRINT' });
        this.pos = start + 1;
        return;
      case 124:
        this.lexRsx();
        return;
      case 36:
        this.lexDollar();
        return;
      case 95:
        this.lexUnderscore();
        return;
      case 35:
        if (this.atLineStart) {
          const q = this.lexDirective(start);
          if (q >= 0) {
            this.pos = q;
            return;
          }
        }
        this.punct('#', 1);
        return;
      case 40:
        this.punct('(', 1);
        return;
      case 41:
        this.punct(')', 1);
        return;
      case 44:
        this.punct(',', 1);
        return;
      case 59:
        this.punct(';', 1);
        return;
      case 58:
        this.punct(':', 1);
        return;
      case 64:
        this.punct('@', 1);
        return;
      case 43:
        this.punct('+', 1);
        return;
      case 45:
        this.punct('-', 1);
        return;
      case 42:
        this.punct('*', 1);
        return;
      case 92:
        this.punct('\\', 1);
        return;
      case 94:
        this.punct('^', 1);
        return;
      case 123:
        this.punct('{', 1);
        return;
      case 125:
        this.punct('}', 1);
        return;
      case 60: {
        const n = this.at(start + 1);
        if (n === 62) this.punct('<>', 2);
        else if (n === 61) this.punct('<=', 2);
        else if (n === 60) this.punct('<<', 2);
        else this.punct('<', 1);
        return;
      }
      case 62: {
        const n = this.at(start + 1);
        if (n === 61) this.punct('>=', 2);
        else if (n === 60) this.punct('<>', 2);
        else if (n === 62) this.punct('>>', 2);
        else this.punct('>', 1);
        return;
      }
      case 61: {
        const n = this.at(start + 1);
        if (n === 62) this.punct('=>', 2);
        else if (n === 60) this.punct('=<', 2);
        else this.punct('=', 1);
        return;
      }
      default:
        this.invalid(start);
    }
  }

  private punct(kind: TokenKind, len: number): void {
    this.emit(kind, this.pos, this.pos + len);
    this.pos += len;
  }

  private invalid(start: number): void {
    const cp = this.text.codePointAt(start) ?? 0;
    const len = cp > 0xffff && start + 2 <= this.end ? 2 : 1;
    const shown = cp > 32 && cp < 127 ? `'${String.fromCodePoint(cp)}'` : `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
    this.diag.report('E101', this.span(start, start + len), `Unexpected character ${shown}`);
    this.emit('Invalid', start, start + len);
    this.pos = start + len;
  }

  // ------------------------------------------------------------------ numbers

  private lexNumber(): void {
    const { text } = this;
    const start = this.pos;
    let p = start;
    let radix: 2 | 10 | 16 = 10;
    let value = 0;
    let isReal = false;
    let bad = false;

    const c0 = this.at(p);
    const c1 = this.at(p + 1) | 32;
    if (c0 === 38 || (c0 === 48 && (c1 === 120 || c1 === 98) && (isLetter(this.at(p + 2)) || isDigit(this.at(p + 2))))) {
      // Prefixed: &FF &HFF &X1010 0xFF 0b1010
      let digitsFrom: number;
      if (c0 === 48) {
        radix = c1 === 120 ? 16 : 2;
        digitsFrom = p + 2;
      } else if (c1 === 104) {
        radix = 16;
        digitsFrom = p + 2;
      } else if (c1 === 120) {
        radix = 2;
        digitsFrom = p + 2;
      } else {
        radix = 16;
        digitsFrom = p + 1;
      }
      p = digitsFrom;
      for (;;) {
        const d = hexVal(this.at(p));
        if (d < 0 || d >= radix) break;
        value = value * radix + d;
        p++;
      }
      if (p === digitsFrom) bad = true;
      // A binary number followed by another digit (&X12) is malformed.
      else if (radix === 2 && isDigit(this.at(p))) bad = true;
      if (bad) {
        while (isIdent(this.at(p))) p++;
      }
    } else {
      while (isDigit(this.at(p))) {
        value = value * 10 + (this.at(p) - 48);
        p++;
      }
      if (this.at(p) === 46) {
        isReal = true;
        p++;
        while (isDigit(this.at(p))) p++;
      }
      if ((this.at(p) | 32) === 101) {
        const n = this.at(p + 1);
        if (isDigit(n)) {
          isReal = true;
          p += 2;
          while (isDigit(this.at(p))) p++;
        } else if ((n === 43 || n === 45) && isDigit(this.at(p + 2))) {
          isReal = true;
          p += 3;
          while (isDigit(this.at(p))) p++;
        } else if (!isLetter(n) && n !== 95) {
          // `1E`, `1E+`: an exponent with no digits. (`2ELSE` is a number and a word.)
          bad = true;
          p++;
          if (n === 43 || n === 45) p++;
        }
      }
      if (isReal && !bad) value = Number(text.slice(start, p));
    }

    if (bad) {
      this.diag.report('E104', this.span(start, p), `Malformed number '${text.slice(start, p)}'`, this.malformedHint(start));
      this.emit('Invalid', start, p);
      this.pos = p;
      return;
    }

    let suffix: '%' | '!' | null = null;
    const s = this.at(p);
    if (s === 37 || s === 33) {
      suffix = s === 37 ? '%' : '!';
      p++;
    }

    // A decimal whole number beyond ULONG is a real, as in Locomotive; an integer suffix keeps E105.
    if (!isReal && radix === 10 && value > MAX_U32 && suffix !== '%') {
      isReal = true;
      value = Number(text.slice(start, p - (suffix === null ? 0 : 1)));
    }
    if (isReal ? !Number.isFinite(value) : value > MAX_U32) {
      this.diag.report('E105', this.span(start, p), `Number too large: '${text.slice(start, p)}'`, isReal ? undefined : 'Integers go up to 4294967295; write a real (with .0) for a larger value.');
      this.emit('Invalid', start, p);
      this.pos = p;
      return;
    }

    if (this.atLineStart && radix === 10 && !isReal && suffix === null) {
      this.emit('LineNumber', start, p, { value });
    } else {
      this.emit('Number', start, p, { value, radix, isReal, suffix });
    }
    this.pos = p;
  }

  private malformedHint(start: number): string {
    const c0 = this.at(start);
    if (c0 === 38 || c0 === 48) {
      const c1 = this.at(start + 1) | 32;
      if (c1 === 120 || c1 === 98) return 'Binary digits are 0 and 1.';
      return 'Hex digits are 0-9 and A-F; write &FF, &HFF or 0xFF.';
    }
    return 'An exponent needs digits: 1E3, 2.5E-2.';
  }

  /** `$` outside a name: Boriel's `$FF` hex prefix, or a stray character. */
  private lexDollar(): void {
    const start = this.pos;
    if (hexVal(this.at(start + 1)) >= 0) {
      let p = start + 1;
      while (hexVal(this.at(p)) >= 0) p++;
      this.diag.report('E950', this.span(start, p));
      this.emit('Invalid', start, p);
      this.pos = p;
      return;
    }
    this.invalid(start);
  }

  // ------------------------------------------------------------------ strings

  /** Reads a string whose opening quote is at `q`. */
  private readString(q: number): { value: string; closed: boolean; next: number } {
    const { text } = this;
    let p = q + 1;
    let from = p;
    let value = '';
    for (;;) {
      const c = this.at(p);
      if (c === 34) {
        if (this.at(p + 1) === 34) {
          value += text.slice(from, p + 1);
          p += 2;
          from = p;
          continue;
        }
        value += text.slice(from, p);
        return { value, closed: true, next: p + 1 };
      }
      if (c === -1 || isEol(c)) {
        value += text.slice(from, p);
        return { value, closed: false, next: p };
      }
      p++;
    }
  }

  private lexString(): void {
    const start = this.pos;
    const r = this.readString(start);
    if (!r.closed) this.diag.report('W102', this.span(start, r.next));
    this.emit('String', start, r.next, { value: r.value, closed: r.closed });
    this.pos = r.next;
  }

  // ----------------------------------------------------------------- comments

  private lexLineComment(start: number, bodyFrom: number, style: 'apostrophe' | 'rem'): void {
    const e = this.eolFrom(start);
    if (this.keep) {
      const t = this.make('Comment', start, e, { style, body: this.text.slice(bodyFrom, e) });
      this.out.push(t);
    }
    this.space = true;
    this.afterComment = true;
    this.pos = e;
  }

  private lexBlockComment(): void {
    const { text } = this;
    const start = this.pos;
    let p = start + 2;
    let closed = false;
    while (p < this.end) {
      if (text.charCodeAt(p) === 39 && this.at(p + 1) === 47) {
        closed = true;
        break;
      }
      p++;
    }
    const bodyEnd = p;
    const e = closed ? p + 2 : this.end;
    if (!closed) this.diag.report('E103', this.span(start, start + 2));
    if (this.keep) {
      this.out.push(this.make('Comment', start, e, { style: 'block', body: text.slice(start + 2, bodyEnd) }));
    }
    this.space = true;
    this.pos = e;
  }

  // -------------------------------------------------------------------- words

  private lexWord(): void {
    const { text } = this;
    const start = this.pos;
    let p = start + 1;
    while (isIdent(this.at(p))) p++;
    // One of the connecting words glued to digits is the word, then the number: `THEN10`, `TO1`,
    // `ELSE30`, `STEP2`, `GOTO10`. Only a plain run of letters followed by digits is split, so
    // names (`a1`, `end2`, `Pause2`) stay names.
    const glued = this.at(p) === 36 || this.at(p) === 37 || this.at(p) === 33 ? null : /^([A-Za-z]+)[0-9]+$/.exec(text.slice(start, p));
    if (glued && GLUE_WORDS.has((glued[1] as string).toUpperCase())) p = start + (glued[1] as string).length;
    const word = text.slice(start, p);
    const up = word.toUpperCase();
    const reserved = RESERVED_WORDS.has(up);
    const sc = this.at(p);

    // Locomotive: no name starts with FN. `FNdouble` is the keyword FN, then the name
    // (which keeps any type suffix): `DEF FNdouble(x)`, `FNdouble(3)`, `FNname$`.
    if (!reserved && up.length > 2 && up.charCodeAt(0) === 70 && up.charCodeAt(1) === 78 && isLetter(up.charCodeAt(2))) {
      this.emit('Keyword', start, start + 2, { keyword: 'FN' });
      this.pos = start + 2;
      this.lexWord();
      return;
    }

    if (sc === 36) {
      if (RESERVED_WORDS.has(`${up}$`)) {
        this.emit('Keyword', start, p + 1, { keyword: `${up}$` });
        this.pos = p + 1;
        return;
      }
      if (reserved) return this.badSuffix(start, p + 1, up);
      this.emit('Identifier', start, p + 1, { name: word, suffix: '$', key: `${word.toLowerCase()}$` });
      this.pos = p + 1;
      return;
    }
    if (sc === 37 || sc === 33) {
      if (reserved) return this.badSuffix(start, p + 1, up);
      const suffix = sc === 37 ? '%' : '!';
      this.emit('Identifier', start, p + 1, { name: word, suffix, key: word.toLowerCase() + suffix });
      this.pos = p + 1;
      return;
    }

    if (!reserved) {
      if (this.atLineStart && sc === 58) {
        this.emit('Label', start, p + 1, { name: word, key: word.toLowerCase() });
        this.pos = p + 1;
        return;
      }
      this.emit('Identifier', start, p, { name: word, suffix: null, key: word.toLowerCase() });
      this.pos = p;
      return;
    }

    if (up === 'REM') {
      this.lexLineComment(start, p, 'rem');
      return;
    }
    const prev = this.out[this.out.length - 1];
    const afterEnd = prev !== undefined && prev.kind === 'Keyword' && prev.keyword === 'END';
    const tok = this.emit('Keyword', start, p, { keyword: up });
    this.pos = p;
    if (up === 'DATA') {
      this.lexData();
    } else if (up === 'ASM' && !afterEnd) {
      let q = p;
      while (isBlank(this.at(q))) q++;
      const c = this.at(q);
      if (c === -1 || isEol(c) || c === 39 || (this.matchWord(q, 'rem') && !isIdent(this.at(q + 3)))) {
        this.asmPending = true;
        this.asmSpan = tok.span;
      }
    }
  }

  private badSuffix(start: number, end: number, up: string): void {
    this.diag.report('E107', this.span(start, end), `'${up}' is a reserved word and cannot take a type suffix`, `Choose another name; ${up} is reserved.`);
    this.emit('Invalid', start, end);
    this.pos = end;
  }

  private lexRsx(): void {
    const start = this.pos;
    if (!isLetter(this.at(start + 1))) {
      this.invalid(start);
      return;
    }
    let p = start + 2;
    while (isIdent(this.at(p))) p++;
    this.emit('Rsx', start, p, { name: this.text.slice(start + 1, p).toUpperCase() });
    this.pos = p;
  }

  private lexUnderscore(): void {
    const start = this.pos;
    const e = this.continuationEol(start);
    if (e < 0 && isIdent(this.at(start + 1))) {
      // A name that starts with `_`: the predefined macros (`__CPC__`, `__FILE__`).
      this.lexWord();
      return;
    }
    if (e < 0) {
      this.diag.report('E101', this.span(start, start + 1), "Unexpected character '_'", 'A line continuation _ must be the last thing on its line, after a blank.');
      this.emit('Invalid', start, start + 1);
      this.pos = start + 1;
      return;
    }
    const next = e + this.breakLen(e);
    if (e >= this.end || next >= this.end) {
      // An Invalid token, so the parser does not also report the unfinished statement.
      this.diag.report('E108', this.span(start, start + 1));
      this.emit('Invalid', start, start + 1);
      this.pos = this.end;
      return;
    }
    this.pos = next;
    this.atLineStart = false;
    this.space = true;
  }

  // --------------------------------------------------------------- directives

  /**
   * Lexes a directive whose `#` is at `hash`. Returns the offset after the logical line
   * (before its line break), or -1 when no name follows the `#`. The caller has set
   * `space` and `atLineStart`.
   */
  private lexDirective(hash: number): number {
    let p = hash + 1;
    while (isBlank(this.at(p))) p++;
    if (!isLetter(this.at(p))) return -1;
    const nameStart = p;
    while (isIdent(this.at(p))) p++;
    const name = this.text.slice(nameStart, p).toLowerCase();
    const restStart = p;
    let q = p;
    for (;;) {
      const c = this.at(q);
      if (c === -1 || isEol(c)) break;
      if (c === 95) {
        const e = this.continuationEol(q);
        if (e >= 0) {
          const next = e + this.breakLen(e);
          if (next >= this.end) {
            this.diag.report('E108', this.span(q, q + 1));
            q = this.end;
            break;
          }
          q = next;
          continue;
        }
      }
      q++;
    }
    this.emit('Directive', hash, q, { name, rest: this.text.slice(restStart, q), restSpan: this.span(restStart, q), ...(this.inAsmBlock ? { inAsm: true } : {}) });
    return q;
  }

  // --------------------------------------------------------------------- data

  private lexData(): void {
    const { text } = this;
    for (;;) {
      let p = this.pos;
      while (isBlank(this.at(p))) p++;
      this.space = p > this.pos;
      this.pos = p;
      const itemStart = p;
      if (this.at(p) === 34) {
        const r = this.readString(p);
        if (!r.closed) this.diag.report('W102', this.span(p, r.next));
        this.emit('DataItem', p, r.next, { raw: r.value, quoted: true });
        p = r.next;
        let q = p;
        while (isBlank(this.at(q))) q++;
        let junkEnd = q;
        while (this.at(junkEnd) !== 44 && this.at(junkEnd) !== 58 && this.at(junkEnd) !== -1 && !isEol(this.at(junkEnd))) junkEnd++;
        let trimmed = junkEnd;
        while (trimmed > q && isBlank(text.charCodeAt(trimmed - 1))) trimmed--;
        if (trimmed > q) this.diag.report('E109', this.span(q, trimmed));
        p = junkEnd;
      } else {
        let e = p;
        for (;;) {
          const c = this.at(e);
          if (c === 44 || c === 58 || c === -1 || isEol(c)) break;
          e++;
        }
        let t = e;
        while (t > itemStart && isBlank(text.charCodeAt(t - 1))) t--;
        this.emit('DataItem', itemStart, t, { raw: text.slice(itemStart, t), quoted: false });
        p = e;
      }
      this.pos = p;
      if (this.at(p) === 44) {
        this.pos = p + 1;
        continue;
      }
      return;
    }
  }

  // ---------------------------------------------------------------------- asm

  /** `pos` is at the start of the first line after `ASM`. */
  private lexAsmBlock(): void {
    this.inAsmBlock = true;
    try {
      this.lexAsmLines();
    } finally {
      this.inAsmBlock = false;
    }
  }

  private lexAsmLines(): void {
    const asmSpan = this.asmBody ? null : this.asmSpan;
    let p = this.pos;
    for (;;) {
      if (p >= this.end) {
        if (asmSpan) this.diag.report('E106', asmSpan);
        this.pos = this.end;
        return;
      }
      const e = this.eolFrom(p);
      let f = p;
      while (isBlank(this.at(f))) f++;
      if (this.matchWord(f, 'end') && isBlank(this.at(f + 3))) {
        let g = f + 3;
        while (isBlank(this.at(g))) g++;
        if (this.matchWord(g, 'asm') && !isIdent(this.at(g + 3))) {
          this.pos = p;
          this.atLineStart = true;
          this.space = false;
          return;
        }
      }
      this.atLineStart = true;
      this.space = f > p;
      let next = e;
      if (this.at(f) === 35) {
        const q = this.lexDirective(f);
        if (q >= 0) next = q;
        else this.emit('AsmLine', p, e);
      } else {
        this.space = false;
        this.emit('AsmLine', p, e);
      }
      p = next + this.breakLen(next);
    }
  }
}
