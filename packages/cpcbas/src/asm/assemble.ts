/**
 * The assembler core (task L2-ASM): preprocessed lines -> parsed items (pass 1: sizes,
 * addresses, labels) -> evaluated and encoded items (pass 2) -> segments, symbols, entry.
 * Behaviour follows the reference assembler (zxbasm asmparse.py, memory.py); see the notes
 * at {@link dumpImage} for the reference's treatment of label slots and gaps.
 * Contract: asm/types.ts.
 */
import { DiagnosticBag } from '../core/diagnostics.js';
import type { DiagnosticCode, RelatedInfo } from '../core/diagnostics.js';
import type { FileId, Span } from '../core/source.js';
import { evalExpr, labelValue } from './expr.js';
import type { EvalHost, Expr } from './expr.js';
import { keywordClass, lexLine } from './lexer.js';
import type { LexError, Tok } from './lexer.js';
import { preprocessAsm } from './preprocess.js';
import { SymbolTable, normalizeNamespace } from './symbols.js';
import type {
  AssembleFn,
  AssembleInput,
  AssembleResult,
  AsmSourceLine,
  AsmSymbol,
  Condition,
  ListingLine,
  Operand,
  Reg16,
  Reg8,
  Segment,
} from './types.js';
import { encode } from './z80/encode.js';

const TEMP_RE = /^[0-9]+$/;
const MAX_ADDRESS = 65535;

const F_PRESENT = 1;
const F_SLOT = 2;
const F_ASM = 4;
const F_WRITTEN = 8;

/** An operand as parsed: expressions are still trees. */
type POp =
  | { readonly kind: 'reg8'; readonly reg: Reg8 }
  | { readonly kind: 'reg16'; readonly reg: Reg16 }
  | { readonly kind: 'cond'; readonly cond: Exclude<Condition, 'C'> }
  | { readonly kind: 'flags' }
  | { readonly kind: 'imm'; readonly e: Expr }
  | { readonly kind: 'mem'; readonly e: Expr }
  | { readonly kind: 'regIndirect'; readonly reg: 'BC' | 'DE' | 'HL' | 'SP' | 'IX' | 'IY' | 'C' }
  | { readonly kind: 'index'; readonly reg: 'IX' | 'IY'; readonly e: Expr | null };

interface ItemBase {
  readonly pc: number;
  readonly span: Span;
  readonly text: string;
  failed: boolean;
}
interface InsItem extends ItemBase {
  readonly t: 'ins';
  readonly mnemonic: string;
  readonly ops: readonly POp[];
}
interface DataItem extends ItemBase {
  readonly t: 'defb' | 'defw';
  readonly exprs: readonly Expr[];
}
interface DefsItem extends ItemBase {
  readonly t: 'defs';
  readonly count: number;
  readonly value: Expr | null;
}
type Item = InsItem | DataItem | DefsItem;

/** Unwinds one statement after a syntax error (always caught inside this module). */
class SyntaxFail {
  constructor(
    readonly tok: Tok,
    readonly message: string,
  ) {}
}

interface PLine {
  readonly text: string;
  readonly span: Span;
  readonly attribution: AsmSourceLine['attribution'];
  readonly seq: number;
}

class Assembler implements EvalHost {
  readonly diag = new DiagnosticBag();
  readonly symbols: SymbolTable;
  readonly items: Item[] = [];
  private readonly mem = new Uint8Array(MAX_ADDRESS + 1);
  private readonly flags = new Uint8Array(MAX_ADDRESS + 1);
  private index = 0;
  private autorun: number | null = null;
  private line!: PLine;
  private toks: Tok[] = [];
  private p = 0;
  private overflowReported = false;
  private readonly suffixes = new WeakMap<Span, string>();
  private readonly lineAttribution: boolean;

  constructor(private readonly input: AssembleInput) {
    this.lineAttribution = input.options?.lineAttribution !== false;
    this.symbols = new SymbolTable({
      report: (code, span, message, hint, related) => this.report(code, span, message, hint, related),
    });
  }

  // ---- diagnostics ----

  report(code: DiagnosticCode, span: Span, message: string, hint?: string, related?: readonly RelatedInfo[]): void {
    const note = this.suffixes.get(span);
    this.diag.report(code, span, note === undefined ? message : `${message} ${note}`, hint, related);
  }

  private spanOf(c0: number, c1: number): Span {
    const l = this.line;
    if (this.lineAttribution && l.attribution !== null) {
      const file = this.input.sources.byPath(l.attribution.path);
      if (file !== undefined) {
        const start = this.input.sources.offsetAt(file.id, l.attribution.line, 1);
        const end = this.input.sources.offsetAt(file.id, l.attribution.line + 1, 1);
        return { file: file.id as FileId, start, end: Math.max(start, end - 1) };
      }
      const span = this.clampSpan(c0, c1);
      this.suffixes.set(span, `(generated from ${l.attribution.path}:${l.attribution.line})`);
      return span;
    }
    return this.clampSpan(c0, c1);
  }

  private clampSpan(c0: number, c1: number): Span {
    const s = this.line.span;
    const start = Math.min(s.start + c0, s.end);
    return { file: s.file, start, end: Math.max(start, Math.min(s.start + c1, s.end)) };
  }

  private tokSpan(t: Tok): Span {
    return this.spanOf(t.col, t.end);
  }

  // ---- memory ----

  /** The last address reported as overlapping (E537), so a run is reported once. */
  private lastOverlap = -2;

  private setSlot(addr: number): void {
    if (addr < 0 || addr > MAX_ADDRESS) return;
    if ((this.flags[addr] as number) & F_SLOT) return;
    this.flags[addr] = (this.flags[addr] as number) | F_SLOT | F_PRESENT;
    this.mem[addr] = 0;
  }

  private setByte(value: number, span: Span): void {
    const a = this.index;
    if (a < 0 || a > MAX_ADDRESS) {
      if (!this.overflowReported) {
        this.overflowReported = true;
        this.report('E535', span, 'Code runs past address 65535');
      }
    } else {
      if (((this.flags[a] as number) & F_WRITTEN) !== 0 && a !== this.lastOverlap + 1) {
        // Output written twice (an ORG back into code or data, e.g. a #pragma hidata block over the program): the image
        // would silently keep the later bytes and merge the runs. Reported once per overlapping run (L3-FIX, follow-up 44).
        this.report('E537', span, `Output overlaps earlier output at address ${a} (&${a.toString(16).toUpperCase().padStart(4, '0')})`);
      }
      if (((this.flags[a] as number) & F_WRITTEN) !== 0) this.lastOverlap = a;
      this.mem[a] = value;
      this.flags[a] = (this.flags[a] as number) | F_PRESENT | F_WRITTEN;
    }
    this.index++;
  }

  private addItem(item: Item, size: number): void {
    this.items.push(item);
    this.setSlot(this.index);
    if (this.index >= 0 && this.index <= MAX_ADDRESS) this.flags[this.index] = (this.flags[this.index] as number) | F_ASM;
    for (let i = 0; i < size; i++) this.setByte(0, item.span);
  }

  private setOrg(value: number, span: Span): void {
    if (value < 0 || value > MAX_ADDRESS) {
      this.report('E525', span, `Memory ORG out of range [0 .. 65535]. Current value: ${value}`);
    }
    this.symbols.endTemporaryEpoch();
    this.index = value;
  }

  // ---- token helpers ----

  private peek(): Tok {
    return this.toks[this.p] as Tok;
  }

  private next(): Tok {
    const t = this.toks[this.p] as Tok;
    if (t.kind !== 'eol') this.p++;
    return t;
  }

  private isOp(text: string): boolean {
    const t = this.peek();
    return t.kind === 'op' && t.text === text;
  }

  private acceptOp(text: string): boolean {
    if (this.isOp(text)) {
      this.p++;
      return true;
    }
    return false;
  }

  private fail(tok: Tok, message?: string): never {
    throw new SyntaxFail(tok, message ?? '');
  }

  private expectOp(text: string): void {
    if (!this.acceptOp(text)) this.fail(this.peek(), `Expected '${text}'`);
  }

  private atStatementEnd(): boolean {
    const t = this.peek();
    return t.kind === 'eol' || (t.kind === 'op' && t.text === ':');
  }

  private expectEnd(): void {
    if (!this.atStatementEnd()) this.fail(this.peek());
  }

  // ---- expressions (precedence as in the reference grammar) ----

  private parseExpr(): Expr {
    let left = this.parseAdd();
    for (;;) {
      const t = this.peek();
      if (t.kind === 'op' && (t.text === '>>' || t.text === '<<' || t.text === '&' || t.text === '|' || t.text === '~')) {
        this.p++;
        const right = this.parseAdd();
        left = { k: 'bin', op: t.text, l: left, r: right, span: this.tokSpan(t) };
      } else return left;
    }
  }

  private parseAdd(): Expr {
    let left = this.parseMul();
    for (;;) {
      const t = this.peek();
      if (t.kind === 'op' && (t.text === '+' || t.text === '-')) {
        this.p++;
        const right = this.parseMul();
        left = { k: 'bin', op: t.text, l: left, r: right, span: this.tokSpan(t) };
      } else return left;
    }
  }

  private parseMul(): Expr {
    let left = this.parsePow();
    for (;;) {
      const t = this.peek();
      if (t.kind === 'op' && (t.text === '*' || t.text === '/' || t.text === '%')) {
        this.p++;
        const right = this.parsePow();
        left = { k: 'bin', op: t.text, l: left, r: right, span: this.tokSpan(t) };
      } else return left;
    }
  }

  private parsePow(): Expr {
    const left = this.parseUnary();
    const t = this.peek();
    if (t.kind === 'op' && t.text === '^') {
      this.p++;
      const right = this.parsePow();
      return { k: 'bin', op: '^', l: left, r: right, span: this.tokSpan(t) };
    }
    return left;
  }

  private parseUnary(): Expr {
    const t = this.peek();
    if (t.kind === 'op' && (t.text === '-' || t.text === '+')) {
      this.p++;
      return { k: 'un', op: t.text, e: this.parseUnary() };
    }
    return this.parseAtom();
  }

  private parseAtom(): Expr {
    const t = this.next();
    if (t.kind === 'int') return { k: 'int', v: t.value };
    if (t.kind === 'id') {
      const span = this.tokSpan(t);
      const r = this.symbols.reference(t.text, span, this.line.seq);
      return 'tmp' in r ? { k: 'tmp', ref: r.tmp, span } : { k: 'lbl', lbl: r.lbl, span };
    }
    if (t.kind === 'op') {
      if (t.text === '$') return { k: 'int', v: this.index };
      if (t.text === '(') {
        const e = this.parseExpr();
        this.expectOp(')');
        return e;
      }
    }
    return this.fail(t);
  }

  /** Strict evaluation: an undefined name is an error now (ORG, ALIGN, END, DEFS count). */
  private evalNow(e: Expr): number | null {
    return evalExpr(e, this, true);
  }

  // ---- statements ----

  private parseLine(): void {
    const first = this.toks[0] as Tok;
    const second = this.toks[1] as Tok;
    if (first.kind === 'id' && second.kind === 'kw' && second.text === 'EQU') {
      this.p = 2;
      const e = this.parseExpr();
      if (this.peek().kind !== 'eol') this.fail(this.peek());
      this.symbols.declare(first.text, this.tokSpan(first), this.line.seq, e, false);
      this.setSlot(this.index);
      return;
    }
    if (first.kind === 'kw' && first.text === 'END') {
      this.p = 1;
      if (this.peek().kind !== 'eol') {
        const e = this.parseExpr();
        if (this.peek().kind !== 'eol') this.fail(this.peek());
        const v = this.evalNow(e);
        if (v !== null) this.autorun = v;
      }
      return;
    }
    for (;;) {
      this.parseAsm();
      if (this.acceptOp(':')) continue;
      if (this.peek().kind === 'eol') break;
      this.fail(this.peek());
    }
  }

  private parseAsm(): void {
    const t = this.peek();
    if (this.atStatementEnd()) return;
    if (t.kind === 'id' || t.kind === 'int') {
      this.p++;
      const name = t.kind === 'id' ? t.text : String(t.value);
      this.symbols.declare(name, this.tokSpan(t), this.line.seq, this.index, true);
      if (!TEMP_RE.test(name)) this.setSlot(this.index);
      return;
    }
    if (t.kind === 'kw') {
      this.p++;
      this.parseKeywordStatement(t);
      return;
    }
    this.fail(t);
  }

  private parseKeywordStatement(t: Tok): void {
    const cls = keywordClass(t.text.toLowerCase());
    const span = this.tokSpan(t);
    switch (t.text) {
      case 'PROC':
        this.symbols.enterProc(span);
        return;
      case 'ENDP':
        this.symbols.exitProc(span);
        return;
      case 'LOCAL': {
        for (;;) {
          const id = this.next();
          if (id.kind !== 'id') this.fail(id, 'Expected a label name');
          this.symbols.setLocal(id.text, this.tokSpan(id));
          if (!this.acceptOp(',')) break;
        }
        this.expectEnd();
        return;
      }
      case 'DEFB':
      case 'DEFW':
        this.parseData(t, t.text === 'DEFB');
        return;
      case 'DEFS':
        this.parseDefs(t);
        return;
      case 'ORG': {
        const e = this.parseExpr();
        this.expectEnd();
        const v = this.evalNow(e);
        if (v !== null) this.setOrg(v, span);
        return;
      }
      case 'ALIGN': {
        const e = this.parseExpr();
        this.expectEnd();
        const v = this.evalNow(e);
        if (v === null) return;
        if (v < 2) {
          this.report('E526', span, 'ALIGN value must be greater than 1');
          return;
        }
        this.setOrg(this.index + ((v - (this.index % v)) % v), span);
        return;
      }
      case 'NAMESPACE': {
        const id = this.next();
        if (id.kind !== 'id') this.fail(id, 'Expected a namespace name');
        this.expectEnd();
        this.symbols.namespace = normalizeNamespace(id.text);
        return;
      }
      case 'INCBIN':
        this.report('E534', span, 'INCBIN is not supported');
        this.p = this.toks.length - 1;
        return;
      case 'EQU':
      case 'END':
        this.fail(t);
        break;
      case 'PUSH':
      case 'POP':
        if (this.peek().kind === 'kw' && this.peek().text === 'NAMESPACE') {
          this.p++;
          this.parseNamespaceStack(t.text === 'PUSH', span);
          return;
        }
        break;
      default:
        break;
    }
    if (cls !== 'mnemonic') this.fail(t);
    this.parseInstruction(t);
  }

  private parseNamespaceStack(push: boolean, span: Span): void {
    const sym = this.symbols;
    if (push) {
      sym.namespaceStack.push(sym.namespace);
      if (this.peek().kind === 'id') {
        sym.namespace = normalizeNamespace(this.next().text);
      }
      this.expectEnd();
      return;
    }
    this.expectEnd();
    const prev = sym.namespaceStack.pop();
    if (prev === undefined) {
      this.report('E532', span, `Stack underflow. No more namespaces to pop. Current namespace is ${sym.namespace}`);
    } else sym.namespace = prev;
  }

  private parseData(t: Tok, bytes: boolean): void {
    const exprs: Expr[] = [];
    const span = this.tokSpan(t);
    for (;;) {
      const s = this.peek();
      const after = this.toks[this.p + 1] as Tok;
      if (bytes && s.kind === 'str' && (after.kind === 'eol' || (after.kind === 'op' && (after.text === ',' || after.text === ':')))) {
        this.p++;
        for (let i = 0; i < s.text.length; i++) exprs.push({ k: 'int', v: s.text.charCodeAt(i) });
      } else {
        exprs.push(this.parseExpr());
      }
      if (!this.acceptOp(',')) break;
    }
    this.expectEnd();
    const size = bytes ? exprs.length : exprs.length * 2;
    this.addItem({ t: bytes ? 'defb' : 'defw', exprs, pc: this.index, span, text: this.line.text, failed: false }, size);
  }

  private parseDefs(t: Tok): void {
    const span = this.tokSpan(t);
    const args: Expr[] = [this.parseExpr()];
    while (this.acceptOp(',')) args.push(this.parseExpr());
    this.expectEnd();
    if (args.length > 2) {
      this.report('E533', span, 'Too many arguments for DEFS');
      return;
    }
    const n = this.evalNow(args[0] as Expr);
    if (n === null) return;
    const count = Math.max(0, n);
    this.addItem(
      { t: 'defs', count, value: args[1] ?? null, pc: this.index, span, text: this.line.text, failed: false },
      count,
    );
  }

  // ---- instructions ----

  private parseInstruction(t: Tok): void {
    const span = this.tokSpan(t);
    const ops: POp[] = [];
    if (!this.atStatementEnd()) {
      ops.push(this.parseOperand(t.text, 0));
      while (this.acceptOp(',')) ops.push(this.parseOperand(t.text, ops.length));
    }
    this.expectEnd();
    const item: InsItem = { t: 'ins', mnemonic: t.text, ops, pc: this.index, span, text: this.line.text, failed: false };
    // Pass 1 only needs the size: every value is pending (no instruction's size depends on a value).
    const r = encode({ mnemonic: t.text, operands: ops.map((o) => this.toEncoderOperand(o, 0, true)), pc: this.index });
    if (!r.ok) {
      this.report(r.code, span, r.message);
      item.failed = true;
      return;
    }
    this.addItem(item, r.bytes.length);
  }

  private parseOperand(mnemonic: string, position: number): POp {
    const t = this.peek();
    if (t.kind === 'kw') {
      const w = t.text;
      const cls = keywordClass(w.toLowerCase());
      if (cls === 'reg8') {
        this.p++;
        return { kind: 'reg8', reg: w as Reg8 };
      }
      if (cls === 'reg16') {
        this.p++;
        if (w === 'AF' && this.isOp("'")) {
          this.p++;
          return { kind: 'reg16', reg: "AF'" };
        }
        return { kind: 'reg16', reg: w as Reg16 };
      }
      if (cls === 'flag') {
        this.p++;
        return { kind: 'cond', cond: w as Exclude<Condition, 'C'> };
      }
      this.fail(t);
    }
    if (t.kind === 'id' && mnemonic === 'IN' && position === 0 && t.text.toLowerCase() === 'f' && (this.toks[this.p + 1] as Tok).text === ',') {
      this.p++;
      return { kind: 'flags' };
    }
    if (t.kind === 'op' && (t.text === '(' || t.text === '[')) {
      const close = t.text === '(' ? ')' : ']';
      const a = this.toks[this.p + 1] as Tok;
      const b = this.toks[this.p + 2] as Tok;
      const bIsClose = b.kind === 'op' && b.text === close;
      if (a.kind === 'kw' && bIsClose) {
        if (a.text === 'HL' || a.text === 'BC' || a.text === 'DE' || a.text === 'SP' || a.text === 'IX' || a.text === 'IY') {
          this.p += 3;
          if (a.text === 'IX' || a.text === 'IY') return { kind: 'regIndirect', reg: a.text };
          return { kind: 'regIndirect', reg: a.text };
        }
        if (a.text === 'C') {
          this.p += 3;
          return { kind: 'regIndirect', reg: 'C' };
        }
      }
      if (a.kind === 'kw' && (a.text === 'IX' || a.text === 'IY')) {
        this.p += 2;
        if (!(this.isOp('+') || this.isOp('-'))) this.fail(this.peek(), `Unexpected token '${this.peek().text}'. Expected '+' or '-'`);
        const e = this.parseExpr();
        this.expectOp(close);
        return { kind: 'index', reg: a.text, e };
      }
      if (t.text === '[') {
        this.p++;
        const e = this.parseExpr();
        this.expectOp(']');
        return { kind: 'mem', e };
      }
      // '(' : an indirection when the whole operand is the parenthesised expression, otherwise an expression.
      const closeAt = this.matchingParen(this.p);
      const e = this.parseExpr();
      if (this.p === closeAt + 1) return { kind: 'mem', e };
      return { kind: 'imm', e };
    }
    return { kind: 'imm', e: this.parseExpr() };
  }

  private matchingParen(open: number): number {
    let depth = 0;
    for (let i = open; i < this.toks.length; i++) {
      const t = this.toks[i] as Tok;
      if (t.kind === 'op' && t.text === '(') depth++;
      else if (t.kind === 'op' && t.text === ')') {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  /** Converts a parsed operand for the encoder; `pending` gives the size-only form of pass 1. */
  private toEncoderOperand(o: POp, pc: number, pending: boolean, values?: readonly number[], at?: { i: number }): Operand {
    void pc;
    const take = (): number => (pending ? 0 : (values as readonly number[])[(at as { i: number }).i++] as number);
    switch (o.kind) {
      case 'imm':
        return pending ? { kind: 'imm', value: 0, pending: true } : { kind: 'imm', value: take() };
      case 'mem':
        return pending ? { kind: 'mem', address: 0, pending: true } : { kind: 'mem', address: take() };
      case 'index':
        if (o.e === null) return { kind: 'index', reg: o.reg, disp: 0 };
        return pending ? { kind: 'index', reg: o.reg, disp: 0, pending: true } : { kind: 'index', reg: o.reg, disp: take() };
      default:
        return o;
    }
  }

  // ---- driving the passes ----

  private joinLines(lines: readonly AsmSourceLine[]): PLine[] {
    const out: PLine[] = [];
    let seq = 0;
    for (let i = 0; i < lines.length; i++) {
      const first = lines[i] as AsmSourceLine;
      let text = first.text;
      let end = first.span.end;
      // The reference joins physical lines that end in a backslash.
      while (/\\[ \t]*$/.test(text) && i + 1 < lines.length) {
        const nxt = lines[i + 1] as AsmSourceLine;
        text = text.replace(/\\[ \t]*$/, ' ') + nxt.text;
        end = nxt.span.end;
        i++;
      }
      out.push({ text, span: { file: first.span.file, start: first.span.start, end: Math.max(end, first.span.start) }, attribution: first.attribution, seq: seq++ });
    }
    return out;
  }

  pass1(lines: readonly AsmSourceLine[]): void {
    for (const line of this.joinLines(lines)) {
      this.line = line;
      const lexErrors: LexError[] = [];
      this.toks = lexLine(line.text, lexErrors);
      this.p = 0;
      for (const le of lexErrors) {
        this.report('E524', this.spanOf(le.col, le.col + 1), `Illegal character '${le.char}'`);
      }
      if (lexErrors.length > 0) continue;
      try {
        this.parseLine();
      } catch (e) {
        if (!(e instanceof SyntaxFail)) throw e;
        const tok = e.tok;
        const what = tok.kind === 'eol' ? 'Unexpected end of line' : `Unexpected '${tok.kind === 'str' ? `"${tok.text}"` : tok.kind === 'int' ? tok.text : tok.text}'`;
        this.report('E522', this.tokSpan(tok), e.message === '' ? `Syntax error. ${what}` : `Syntax error. ${e.message}`);
      }
    }
    this.symbols.endTemporaryEpoch();
    if (this.symbols.scopes.length > 1) {
      this.report('E530', this.symbols.scopeSpans[this.symbols.scopeSpans.length - 1] as Span, 'Missing ENDP to close this scope');
    }
  }

  /** After the last line, as the reference's main does with `#init` labels. */
  appendInits(inits: ReadonlyArray<{ label: string; span: Span }>): number | null {
    let any = false;
    let maxKey = -1;
    let minSlot = -1;
    for (let a = 0; a <= MAX_ADDRESS; a++) {
      const f = this.flags[a] as number;
      if (f & F_PRESENT) {
        any = true;
        maxKey = a;
      }
      if (f & F_SLOT && minSlot < 0) minSlot = a;
    }
    if (!any) return null;
    const entry = maxKey + 1;
    for (const init of inits) {
      this.line = { text: `#init ${init.label}`, span: init.span, attribution: null, seq: Number.MAX_SAFE_INTEGER };
      const r = this.symbols.reference(init.label, init.span, this.line.seq);
      const e: Expr = 'tmp' in r ? { k: 'tmp', ref: r.tmp, span: init.span } : { k: 'lbl', lbl: r.lbl, span: init.span };
      this.addCall('CALL', e, init.span);
    }
    if (inits.length > 0) {
      this.addCall('JP', { k: 'int', v: this.autorun ?? Math.max(minSlot, 0) }, inits[0]?.span as Span);
      return entry;
    }
    return null;
  }

  private addCall(mnemonic: string, e: Expr, span: Span): void {
    const item: InsItem = { t: 'ins', mnemonic, ops: [{ kind: 'imm', e }], pc: this.index, span, text: `${mnemonic.toLowerCase()} (generated)`, failed: false };
    this.addItem(item, 3);
  }

  private values(exprs: readonly (Expr | null)[]): number[] | null {
    const out: number[] = [];
    let ok = true;
    for (const e of exprs) {
      if (e === null) continue;
      const v = evalExpr(e, this, true);
      if (v === null) ok = false;
      else out.push(v);
    }
    return ok ? out : null;
  }

  pass2(): ListingLine[] {
    const listing: ListingLine[] = [];
    for (const item of this.items) {
      if (item.failed) continue;
      let bytes: number[] | null = null;
      if (item.t === 'ins') {
        const exprs: Array<Expr | null> = [];
        for (const o of item.ops) {
          if (o.kind === 'imm' || o.kind === 'mem') exprs.push(o.e);
          else if (o.kind === 'index' && o.e !== null) exprs.push(o.e);
        }
        const vals = this.values(exprs);
        if (vals === null) continue;
        const at = { i: 0 };
        const operands = item.ops.map((o) => this.toEncoderOperand(o, item.pc, false, vals, at));
        const r = encode({ mnemonic: item.mnemonic, operands, pc: item.pc });
        if (!r.ok) {
          this.report(r.code, item.span, r.message);
          continue;
        }
        for (const w of r.warnings ?? []) this.report(w.code, item.span, w.message);
        bytes = [...r.bytes];
      } else if (item.t === 'defb' || item.t === 'defw') {
        const vals = this.values(item.exprs);
        if (vals === null) continue;
        if (item.t === 'defb') {
          if (vals.some((v) => v > 255)) this.report('W504', item.span, 'Value will be truncated');
          bytes = vals.map((v) => ((v % 256) + 256) % 256);
        } else {
          bytes = [];
          for (const v of vals) {
            const x = ((v % 65536) + 65536) % 65536;
            bytes.push(x & 0xff, x >> 8);
          }
        }
      } else if (item.t === 'defs') {
        let fill = 0;
        if (item.value !== null) {
          const v = evalExpr(item.value, this, true);
          if (v === null) continue;
          if (v > 255) this.report('W504', item.span, 'Value will be truncated');
          fill = ((v % 256) + 256) % 256;
        }
        bytes = new Array<number>(item.count).fill(fill);
      }
      if (bytes === null) continue;
      for (let i = 0; i < bytes.length; i++) {
        const a = item.pc + i;
        if (a >= 0 && a <= MAX_ADDRESS) this.mem[a] = bytes[i] as number;
      }
      if (this.input.options?.listing === true) {
        listing.push({ address: item.pc, bytes, span: item.span, text: item.text });
      }
    }
    // Labels that were referenced but never defined and not reported at a use.
    for (const lbl of this.symbols.all) {
      if (lbl.value === null && !lbl.local && !lbl.reported) {
        lbl.reported = true;
        this.report('E520', lbl.span, `Undefined label '${lbl.name}'`);
      }
    }
    return listing;
  }

  /**
   * The flat image as the reference's `dump()` makes it. A label (or EQU) declared at an
   * address "reserves a slot" there; a slot that holds no instruction is a zero byte that the
   * reference emits only if an instruction starts at a later address in the loop. So slots
   * after the last instruction, and in front of nothing, are dropped, while plain gaps are
   * always filled with zeros up to the highest slot.
   */
  dumpImage(): { org: number; out: number[] } {
    let lo = -1;
    let hi = -1;
    for (let a = 0; a <= MAX_ADDRESS; a++) {
      if ((this.flags[a] as number) & F_PRESENT) {
        if (lo < 0) lo = a;
        hi = a;
      }
    }
    if (lo < 0) return { org: 0, out: [] };
    const out: number[] = [];
    let align = 0;
    for (let a = lo; a <= hi; a++) {
      const f = this.flags[a] as number;
      if (f & F_SLOT && !(f & F_ASM)) {
        align++;
        continue;
      }
      if (f & F_ASM) {
        for (; align > 0; align--) out.push(0);
      }
      out.push(f & F_PRESENT ? (this.mem[a] as number) : 0);
    }
    return { org: lo, out };
  }

  segments(): Segment[] {
    const { org, out } = this.dumpImage();
    if (out.length === 0) return [];
    const end = org + out.length;
    const runs: Array<[number, number]> = [];
    for (let a = org; a < end; a++) {
      if ((this.flags[a] as number) & F_WRITTEN) {
        const last = runs[runs.length - 1];
        if (last !== undefined && last[1] === a) last[1] = a + 1;
        else runs.push([a, a + 1]);
      }
    }
    if (runs.length === 0) runs.push([org, end]);
    (runs[0] as [number, number])[0] = org;
    (runs[runs.length - 1] as [number, number])[1] = end;
    return runs.map(([s, e]) => ({ org: s, bytes: Uint8Array.from(out.slice(s - org, e - org)) }));
  }

  symbolList(): AsmSymbol[] {
    const list: AsmSymbol[] = [];
    const globalSet = new Set(this.symbols.globals.values());
    for (const lbl of this.symbols.all) {
      if (lbl.value === null) continue;
      const value = labelValue(lbl, this, false);
      if (value === null) continue;
      const isGlobal = globalSet.has(lbl);
      list.push({
        name: lbl.name,
        value,
        kind: lbl.isAddress ? 'label' : 'equ',
        scope: isGlobal ? 'global' : 'local',
        inMap: lbl.isAddress && isGlobal,
        span: lbl.span,
      });
    }
    list.sort((a, b) => a.value - b.value || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return list;
  }

  get autorunValue(): number | null {
    return this.autorun;
  }
  get currentIndex(): number {
    return this.index;
  }
}

export const assemble: AssembleFn = (input: AssembleInput): AssembleResult => {
  const asm = new Assembler(input);
  const options = input.options ?? {};
  const pre = preprocessAsm({
    sources: input.sources,
    entry: input.entry,
    resolveInclude: input.resolveInclude,
    ...(options.defines !== undefined ? { defines: options.defines } : {}),
    diagnostics: asm.diag,
  });
  let lines = pre.lines;
  const drop = options.dropLines;
  if (drop !== undefined && drop.total === lines.length && drop.ranges.length > 0) {
    lines = lines.filter((_, i) => !drop.ranges.some(([a, b]) => i >= a && i < b));
  }
  asm.pass1(lines);

  let entry: number | null = asm.autorunValue;
  const mode = options.initMode ?? 'collect';
  if (mode === 'zxbasm' && !asm.diag.hasErrors) {
    const e = asm.appendInits(pre.inits);
    if (e !== null) entry = e;
  }
  const listing = asm.pass2();
  const ok = !asm.diag.hasErrors;

  const symbolsByAddress = asm.symbolList();
  const symbols = new Map<string, AsmSymbol>();
  for (const s of symbolsByAddress) if (!symbols.has(s.name)) symbols.set(s.name, s);

  const result: AssembleResult = {
    ok,
    segments: ok ? asm.segments() : [],
    symbols,
    symbolsByAddress,
    inits: mode === 'collect' ? pre.inits.map((i) => i.label) : [],
    entry,
    diagnostics: asm.diag.all(),
    ...(options.listing === true ? { listing } : {}),
  };
  return result;
};
