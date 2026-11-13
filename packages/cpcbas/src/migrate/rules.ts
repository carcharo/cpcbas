/**
 * The rule table of docs/migrate.md for one file: rewrites (W700-W719) are token operations, flags
 * (W720-W737) are diagnostics. The rules read the Boriel tokens of the input and write operations; their
 * output is never matched again.
 */
import { CODES } from '../core/diagnostics.js';
import { RESERVED_WORDS } from '../lang/keywords.js';
import { BORIEL_KEYWORDS } from './boriel-keywords.js';
import { collectDecls, isRenameable, newProject, splitSuffix, type Project } from './decls.js';
import {
  COMPARE_OPS,
  ExprParser,
  matchParen,
  PARENLESS_FUNCTIONS,
  type FileModel,
  type Line,
  type Node,
  type Stmt,
} from './model.js';
import { Ops, type Piece } from './ops.js';
import { numForm, type Tok } from './tokenize.js';

type MigrateCode = keyof typeof CODES & `W7${string}`;

/** One finding before positions are turned into lines and columns. */
export interface RawDiag {
  readonly code: MigrateCode;
  readonly start: number;
  readonly end: number;
  readonly message: Piece;
  /** Rules that apply only to a run read as Boriel (W705, W713, W715). */
  readonly gated: boolean;
}

/** What a rule needs to know about the whole run. */
export interface RunCtx {
  readonly project: Project;
  /** Lower-case old name -> new name (W702). */
  readonly renames: ReadonlyMap<string, string>;
  /** Lower-case base names declared as arrays. */
  readonly arrayBases: ReadonlySet<string>;
  /** Lower-case base name -> suffixes it is used with (`$`, `%`, `!`). */
  readonly suffixUse: ReadonlyMap<string, ReadonlySet<string>>;
  /** True when `#include <name>` or `"name"` can be found in the project or the runtime. */
  readonly hasFile: (name: string, fromPath: string) => boolean;
}

/** A Boriel library file CPC BASIC does not have, with what replaces it (W722). */
const BORIEL_LIBS: ReadonlyMap<string, string> = new Map([
  ['pos.bas', 'POS(#0) counts from 1 (the Boriel pos() counted from 0)'],
  ['csrlin.bas', 'VPOS(#0) counts from 1 (the Boriel csrlin() counted from 0)'],
  ['input.bas', 'LINE INPUT a$ (no length limit) or INPUT'],
  ['keys.bas', 'INKEY$, INKEY(n) with the KEY_ constants, or the library KeyDown(keyNo)'],
  ['screen.bas', 'LOCATE c + 1, r + 1 then COPYCHR$(#0)'],
  ['font.bas', 'SYMBOL AFTER 32 and SYMBOL'],
  ['attr.bas', 'none: the CPC has no attributes'],
  ['alloc.bas', 'none in CPC BASIC'],
  ['play.bas', 'the library music player'],
  ['print42.bas', 'none in CPC BASIC'],
  ['print64.bas', 'none in CPC BASIC'],
  ['sinclair.bas', 'none in CPC BASIC'],
]);

/** Functions defined by those files: flagged where used (W722), and never renamed (W702). */
const BORIEL_LIB_FUNCS: ReadonlyMap<string, string> = new Map([
  ['pos', 'pos.bas'],
  ['csrlin', 'csrlin.bas'],
  ['input', 'input.bas'],
  ['screen', 'screen.bas'],
  ['getkey', 'keys.bas'],
  ['multikeys', 'keys.bas'],
  ['getkeyscancode', 'keys.bas'],
  ['setfont', 'font.bas'],
]);

const ATTR_ITEMS = new Set(['INK', 'PAPER', 'INVERSE', 'OVER']);
const NOEFFECT = new Set(['BRIGHT', 'FLASH', 'BOLD', 'ITALIC']);
const ITEM_STATEMENTS = new Set(['PRINT', 'PLOT', 'DRAW', 'CIRCLE']);
/** Words whose paren-less call W708 rewrites (USR, ASN and ACS are flagged instead). */
const W708_WORDS = new Set([...PARENLESS_FUNCTIONS].filter((w) => w !== 'USR' && w !== 'ASN' && w !== 'ACS'));
const NUMERIC_TYPES = new Set(['BYTE', 'UBYTE', 'INTEGER', 'UINTEGER', 'LONG', 'ULONG', 'FIXED', 'FLOAT']);
const RESPELL: ReadonlyMap<string, string> = new Map([
  ['CODE', 'ASC'],
  ['LN', 'LOG'],
  ['IN', 'INP'],
  ['CHR', 'CHR$'],
  ['STR', 'STR$'],
]);
/** Function words whose result is a string. */
const STRING_FUNCS = new Set(['CHR$', 'STR$', 'INKEY$', 'MID$', 'LEFT$', 'RIGHT$', 'SPACE$', 'STRING$', 'HEX$', 'BIN$', 'DEC$', 'UPPER$', 'LOWER$', 'COPYCHR$']);

/** `word` in the case of the source word: lower case when the source is all lower case, else upper case. */
const like = (src: string, word: string): string => (src === src.toLowerCase() ? word.toLowerCase() : word.toUpperCase());

const oneLine = (s: string): string => s.replace(/\s+/g, ' ');

export class FileRules {
  readonly ops: Ops;
  readonly diags: RawDiag[] = [];
  /** A rewrite other than W705, W713 and W715 was made (the run is read as Boriel). A flag never triggers: its construct stays in the output. */
  trigger = false;
  /** `PEN` tokens made from `INK n` (W730 asks to check their numbers). */
  private readonly penFromInk = new Set<number>();
  private readonly toks: readonly Tok[];
  private readonly declared: ReadonlySet<string>;
  /** What this file alone declares: its own declaration wins over another file's of the same name. */
  private readonly local: Project;
  /** The procedure each line is in (`path:line` of its SUB or FUNCTION; undefined: global). */
  private readonly scopeOf = new Map<Line, string | undefined>();

  constructor(
    readonly file: FileModel,
    private readonly run: RunCtx,
    /** Apply W705, W713 and W715 (the run is read as Boriel). */
    private readonly gatedOn: boolean,
  ) {
    this.toks = file.toks;
    this.ops = new Ops(file.toks);
    this.declared = run.project.declaredBases;
    this.local = newProject();
    collectDecls(this.local, file);
    let scope: string | undefined;
    file.lines.forEach((line, li) => {
      const w = this.sigW(line, 0);
      if (w === 'SUB' || w === 'FUNCTION') scope = `${file.path}:${li}`;
      else if (w === 'DECLARE') scope = `${file.path}:${li}:declare`;
      this.scopeOf.set(line, scope);
      if (w === 'DECLARE') scope = undefined;
      if (w === 'END' && (this.sigW(line, 1) === 'SUB' || this.sigW(line, 1) === 'FUNCTION')) scope = undefined;
    });
  }

  // ------------------------------------------------------------------ helpers

  private tk(i: number): Tok {
    return this.toks[i] as Tok;
  }

  private sigTok(line: Line, p: number): Tok | undefined {
    return p >= 0 && p < line.sig.length ? this.tk(line.sig[p] as number) : undefined;
  }

  private sigW(line: Line, p: number): string {
    const t = this.sigTok(line, p);
    return t !== undefined && t.kind === 'word' ? t.text.toUpperCase() : '';
  }

  private isOp(line: Line, p: number, s: string): boolean {
    const t = this.sigTok(line, p);
    return t !== undefined && t.kind === 'op' && t.text === s;
  }

  /** Raise a rewrite. `a..b` are token indexes (inclusive); the message shows old and new text. */
  private rewrite(code: MigrateCode, a: number, b: number, gated = false): void {
    const old = oneLine(this.file.text.slice(this.tk(a).start, this.tk(b).end));
    const title = CODES[code].title;
    const mark = this.ops.mark(a, b);
    this.diags.push({
      code,
      start: this.tk(a).start,
      end: this.tk(b).end,
      gated,
      message: () => {
        const now = oneLine(this.ops.render(a, b + 1, undefined, mark)).trim();
        return `${title}: ${old} -> ${now === '' ? '(removed)' : now}`;
      },
    });
    if (!gated) this.trigger = true;
  }

  /** Raise a flag (W720 and up). */
  private flag(code: MigrateCode, a: number, b: number, message?: string): void {
    this.diags.push({ code, start: this.tk(a).start, end: this.tk(b).end, gated: false, message: message ?? CODES[code].title });
  }

  private literalInt(a: number, b: number): number | undefined {
    if (a !== b) return undefined;
    const t = this.tk(a);
    if (t.kind !== 'num') return undefined;
    const form = numForm(t.text);
    if (form === 'dec') return /^[0-9]+$/.test(t.text) ? Number(t.text) : undefined;
    if (form === 'dollarHex') return parseInt(t.text.slice(1), 16);
    if (form === 'hSuffixHex') return parseInt(t.text.slice(0, -1), 16);
    return undefined;
  }

  /** Does the expression `[lo, hi)` of the line need parentheses before `+ 1` is added? */
  private needsParens(line: Line, lo: number, hi: number): boolean {
    const ep = new ExprParser(this.toks, line.sig, this.declared, lo, hi);
    const n = ep.parseExpr();
    if (n === null || n.hi !== hi) return true;
    return n.k === 'bin' || n.k === 'un' || n.k === 'range';
  }

  // ------------------------------------------------------------------ the run

  process(): void {
    this.tokenRules();
    this.statementRules();
  }

  // ------------------------------------------------------------------ tokens

  private tokenRules(): void {
    const { file } = this;
    for (const line of file.lines) {
      const first = this.sigTok(line, 0);
      if (first === undefined) continue;
      let skipNames = false;
      if (first.kind === 'pp') {
        const d = first.text.toLowerCase();
        // names in #ifdef and friends are preprocessor symbols, not BASIC names
        skipNames = d !== '#define' && d !== '#pragma';
        if (d === '#include') continue;
      }
      for (let p = 0; p < line.sig.length; p++) {
        const ti = line.sig[p] as number;
        const t = this.tk(ti);
        if (t.kind === 'num') this.numberRule(ti, t);
        else if (t.kind === 'asm') this.asmRule(ti, t, line);
        else if (t.kind === 'word' && !skipNames) this.wordRule(line, p, ti, t);
      }
    }
    // ASM tokens sit on lines of their own; `file.lines` includes them as significant tokens
  }

  private numberRule(ti: number, t: Tok): void {
    const form = numForm(t.text);
    let out: string | undefined;
    if (form === 'dollarHex') out = `&${t.text.slice(1)}`;
    else if (form === 'hSuffixHex') out = `&${t.text.slice(0, -1)}`;
    else if (form === 'percentBin') out = `&X${t.text.slice(1)}`;
    else if (form === 'bSuffixBin') out = `&X${t.text.slice(0, -1)}`;
    if (out === undefined) return;
    this.ops.replace(ti, out);
    this.rewrite('W700', ti, ti);
  }

  /** Does the project declare `base` where `line` is: globally, or in the procedure the line is in? */
  private declaredHere(line: Line, base: string): boolean {
    const { project } = this.run;
    if (project.globals.has(base)) return true;
    const scope = this.scopeOf.get(line);
    return scope !== undefined && (project.locals.get(scope)?.has(base) ?? false);
  }

  private renameOf(word: string, line: Line): string | undefined {
    const { base, suffix } = splitSuffix(word);
    const lower = base.toLowerCase();
    if (!this.declaredHere(line, lower) || !isRenameable(word)) return undefined;
    // the Boriel library functions are flagged (W722) when their file is included, not renamed
    const libFile = BORIEL_LIB_FUNCS.get(lower);
    if (libFile !== undefined && this.run.project.includes.has(libFile)) return undefined;
    if (lower === 'point' && this.run.project.includes.has('point.bas')) return undefined;
    const to = this.run.renames.get(lower) ?? `${base}_`;
    return `${to}${suffix}`;
  }

  private wordRule(line: Line, p: number, ti: number, t: Tok): void {
    const u = t.text.toUpperCase();
    const lower = t.text.toLowerCase();
    // W702: a name that is a reserved word now
    const renamed = this.renameOf(t.text, line);
    if (renamed !== undefined) {
      this.ops.replace(ti, renamed);
      this.rewrite('W702', ti, ti);
      return;
    }
    const isDeclared = this.declared.has(splitSuffix(lower).base);
    // W701
    if (u === 'BAND' || u === 'BOR' || u === 'BXOR' || u === 'BNOT') {
      if (isDeclared) return;
      this.ops.replace(ti, u.slice(1));
      this.rewrite('W701', ti, ti);
      return;
    }
    // W709
    if (u === 'ENDIF') {
      this.ops.replace(ti, like(t.text, 'END IF'));
      this.rewrite('W709', ti, ti);
      return;
    }
    if (u === 'END' && this.sigW(line, p + 1) === 'WHILE') {
      const w = line.sig[p + 1] as number;
      this.ops.replace(ti, like(t.text, 'WEND'));
      for (let k = ti + 1; k <= w; k++) this.ops.remove(k);
      this.rewrite('W709', ti, w);
      return;
    }
    // W700: BIN 0101
    if (u === 'BIN') {
      const nx = this.sigTok(line, p + 1);
      if (nx !== undefined && nx.kind === 'num' && /^[01]+$/.test(nx.text) && !isDeclared) {
        const n = line.sig[p + 1] as number;
        this.ops.replace(ti, `&X${nx.text}`);
        for (let k = ti + 1; k <= n; k++) this.ops.remove(k);
        this.rewrite('W700', ti, n);
      }
      return;
    }
    // W712
    if (lower === 'waitvsync') {
      const prev = this.sigW(line, p - 1);
      if (prev === 'SUB' || prev === 'FUNCTION' || prev === 'DECLARE') return;
      if (this.run.project.decls.get('waitvsync')?.proc) return;
      let last = ti;
      if (this.isOp(line, p + 1, '(') && this.isOp(line, p + 2, ')')) last = line.sig[p + 2] as number;
      this.ops.replace(ti, like(t.text, 'FRAME'));
      for (let k = ti + 1; k <= last; k++) this.ops.remove(k);
      this.rewrite('W712', ti, last);
      return;
    }
    // W707: respelled words and operators
    if (isDeclared) return;
    if (u === 'SHL' || u === 'SHR') {
      this.ops.replace(ti, u === 'SHL' ? '<<' : '>>');
      this.rewrite('W707', ti, ti);
      return;
    }
    const respelled = RESPELL.get(u);
    if (respelled !== undefined && W708_WORDS.has(u)) {
      this.ops.replace(ti, like(t.text, respelled));
      // CHR$ and STR$ keep their meaning; the spelling is the rewrite
      this.rewrite('W707', ti, ti);
    }
    // W708: a built-in function without parentheses
    if (W708_WORDS.has(u) && !this.isOp(line, p + 1, '(')) {
      const ep = new ExprParser(this.toks, line.sig, this.declared, p + 1, line.sig.length);
      const operand = ep.parseOperand();
      if (operand !== null) {
        const lastTok = line.sig[operand.hi - 1] as number;
        const nextTok = line.sig[p + 1] as number;
        // the blank between the word and its operand becomes the opening parenthesis
        if (nextTok === ti + 2 && this.tk(ti + 1).kind === 'ws') this.ops.replace(ti + 1, '(');
        else this.ops.insertAfter(ti, '(');
        this.ops.insertAfter(lastTok, ')');
        this.rewrite('W708', ti, lastTok);
      }
    }
  }

  // ------------------------------------------------------------------ ASM

  private asmRule(ti: number, t: Tok, line: Line): void {
    const { project } = this.run;
    const re = /;[^\n\r]*|"(?:[^"\n\r]|"")*"|(?<![A-Za-z0-9_.$])_([A-Za-z][A-Za-z0-9_]*)/g;
    let out = '';
    let last = 0;
    let changed = false;
    let m: RegExpExecArray | null;
    const notes: Array<{ start: number; end: number; code: MigrateCode; before: string; after: string }> = [];
    while ((m = re.exec(t.text)) !== null) {
      const name = m[1];
      if (name === undefined) continue;
      const lower = name.toLowerCase();
      let to = name;
      let code: MigrateCode | undefined;
      if (this.declaredHere(line, lower) && isRenameable(name)) {
        const libFile = BORIEL_LIB_FUNCS.get(lower);
        if (!(libFile !== undefined && project.includes.has(libFile))) {
          to = `${this.run.renames.get(lower) ?? `${name}_`}`;
          code = 'W702';
        }
      } else {
        const suffixes = this.run.suffixUse.get(lower);
        const unsuffixed = project.decls.get(lower);
        if (this.run.arrayBases.has(lower)) {
          to = `${name}__a`;
          code = 'W703';
        } else if (suffixes !== undefined && !(unsuffixed !== undefined && unsuffixed.declared)) {
          const sfx = suffixes.has('$') ? '$' : suffixes.has('%') ? '%' : '!';
          to = `${name}__${sfx === '$' ? 's' : sfx === '%' ? 'i' : 'r'}`;
          code = 'W703';
        }
      }
      if (code === undefined) continue;
      out += t.text.slice(last, m.index) + `_${to}`;
      last = m.index + m[0].length;
      changed = true;
      notes.push({ start: t.start + m.index, end: t.start + last, code, before: `_${name}`, after: `_${to}` });
    }
    if (!changed) return;
    out += t.text.slice(last);
    this.ops.replace(ti, out);
    for (const n of notes) {
      this.diags.push({ code: n.code, start: n.start, end: n.end, gated: false, message: `${CODES[n.code].title}: ${n.before} -> ${n.after}` });
    }
    this.trigger = true;
  }

  // ------------------------------------------------------------------ statements

  private statementRules(): void {
    const { file } = this;
    let proc: { kind: 'SUB' | 'FUNCTION'; gosub: boolean } | null = null;
    let loopDepth = 0;
    const procHasGosub = (lineIdx: number): boolean => {
      for (let li = lineIdx + 1; li < file.lines.length; li++) {
        const ln = file.lines[li] as Line;
        for (let p = 0; p < ln.sig.length; p++) {
          const w = this.sigW(ln, p);
          if (w === 'GOSUB') return true;
          if (w === 'GO' && this.sigW(ln, p + 1) === 'SUB') return true;
        }
        const f = this.sigW(ln, 0);
        const s = this.sigW(ln, 1);
        if (f === 'END' && (s === 'SUB' || s === 'FUNCTION')) return false;
      }
      return false;
    };
    for (let li = 0; li < file.lines.length; li++) {
      const line = file.lines[li] as Line;
      const first = this.sigTok(line, 0);
      if (first === undefined) continue;
      if (first.kind === 'pp') {
        this.directiveRules(line);
        continue;
      }
      for (const st of line.stmts) {
        const w = this.sigW(line, st.lo);
        const second = this.sigW(line, st.lo + 1);
        if (w === 'SUB' || w === 'FUNCTION') {
          proc = { kind: w, gosub: procHasGosub(li) };
          loopDepth = 0;
        } else if (w === 'END' && (second === 'SUB' || second === 'FUNCTION')) {
          proc = null;
          loopDepth = 0;
        } else if (w === 'FOR' || w === 'WHILE' || (w === 'DO' && st.hi - st.lo >= 1)) loopDepth++;
        else if (w === 'NEXT' || w === 'WEND' || w === 'LOOP' || (w === 'END' && second === 'WHILE')) loopDepth = Math.max(0, loopDepth - 1);
        this.statement(line, st, proc, loopDepth);
      }
    }
  }

  private directiveRules(line: Line): void {
    const d = this.sigTok(line, 0)?.text.toLowerCase();
    const a = line.sig[0] as number;
    const b = line.sig[line.sig.length - 1] as number;
    if (d === '#pragma') {
      const text = line.sig
        .slice(1)
        .map((ti) => this.tk(ti).text.toLowerCase())
        .join('');
      if (/^(push|pop)\(case_insensitive\)$/.test(text) || /^case_insensitive=(true|false|1|0)$/.test(text)) {
        this.removeLine(a, b);
        this.rewrite('W710', a, b);
      } else if (/^(array_base|string_base|zxnext)/.test(text)) {
        const name = /^(array_base|string_base|zxnext)/.exec(text)?.[1] ?? '';
        this.flag('W724', a, b, `#pragma ${name} has no meaning in CPC BASIC`);
      }
    } else if (d === '#include') {
      const arg = this.sigTok(line, 1);
      if (arg === undefined) return;
      const name = arg.text.replace(/^["<]|[">]$/g, '').toLowerCase();
      const angle = arg.kind === 'inc';
      if (name === 'point.bas' && angle) {
        this.removeLine(a, b);
        this.rewrite('W717', a, b);
        return;
      }
      if (this.inSpectrumRegion(a)) return;
      const base = name.slice(name.lastIndexOf('/') + 1);
      const advice = BORIEL_LIBS.get(base);
      if (advice !== undefined && (angle || !this.run.hasFile(name, this.file.path))) {
        this.flag('W722', a, b, `${arg.text} is a Boriel library file that CPC BASIC does not have: ${advice}`);
      } else if (angle && !this.run.hasFile(name, this.file.path)) {
        this.flag('W722', a, b, `${arg.text}: neither the project nor the CPC BASIC library has this file`);
      }
    }
  }

  /** True when token `ti` is inside `#ifdef __ZX...` (Spectrum code that CPC builds never compile). */
  private inSpectrumRegion(ti: number): boolean {
    const stack: boolean[] = [];
    for (const line of this.file.lines) {
      const first = this.sigTok(line, 0);
      if (first === undefined || first.kind !== 'pp') continue;
      if ((line.sig[0] as number) > ti) break;
      const d = first.text.toLowerCase();
      if (d === '#ifdef' || d === '#ifndef' || d === '#if') {
        const arg = this.sigTok(line, 1)?.text ?? '';
        stack.push(d === '#ifdef' && /^__ZX/i.test(arg));
      } else if (d === '#else') {
        // the other branch of a Spectrum test is not Spectrum code
        if (stack.length > 0) stack[stack.length - 1] = false;
      } else if (d === '#endif') stack.pop();
    }
    return stack.some(Boolean);
  }

  /** Removes the tokens `a..b` and the line end after them (and the blank before them). */
  private removeLine(a: number, b: number): void {
    let from = a;
    while (from > 0 && this.tk(from - 1).kind === 'ws') from--;
    let to = b + 1;
    while (to < this.toks.length && (this.tk(to).kind === 'ws' || this.tk(to).kind === 'comment')) to++;
    if (to < this.toks.length && this.tk(to).kind === 'nl') to++;
    for (let k = from; k < to; k++) this.ops.remove(k);
  }

  private statement(line: Line, st: Stmt, proc: { kind: 'SUB' | 'FUNCTION'; gosub: boolean } | null, loopDepth: number): void {
    const t0 = this.sigTok(line, st.lo);
    if (t0 === undefined) return;
    const w = t0.kind === 'word' ? t0.text.toUpperCase() : '';
    const ti0 = line.sig[st.lo] as number;
    const second = this.sigW(line, st.lo + 1);

    // W704: a bare RETURN in a procedure with no GOSUB
    if (w === 'RETURN' && st.hi - st.lo === 1 && proc !== null && !proc.gosub) {
      this.ops.replace(ti0, like(t0.text, `EXIT ${proc.kind}`));
      this.rewrite('W704', ti0, ti0);
      return;
    }
    // W719: POKE UINTEGER addr, value
    if (w === 'POKE' && NUMERIC_TYPES.has(second) && !this.isOp(line, st.lo + 2, ',') && !this.isOp(line, st.lo + 2, '(') && st.hi > st.lo + 2) {
      const ty = line.sig[st.lo + 1] as number;
      this.ops.insertAfter(ty, ',');
      this.rewrite('W719', ti0, ty);
    }
    // W711: INK n
    if (w === 'INK' && !this.declared.has('ink') && this.argCount(line, st.lo + 1, st.hi) === 1 && !this.hasSemicolon(line, st.lo + 1, st.hi)) {
      this.ops.replace(ti0, like(t0.text, 'PEN'));
      this.penFromInk.add(ti0);
      this.rewrite('W711', ti0, ti0);
      this.flag('W730', ti0, line.sig[st.hi - 1] as number, 'A colour number in PEN: Spectrum colours 0-7 were mapped to the pens of the mode');
    }
    // W716 on a whole statement
    if (NOEFFECT.has(w)) {
      this.removeStatement(line, st);
      this.rewrite('W716', ti0, line.sig[st.hi - 1] as number);
      return;
    }
    // W721 statements
    if ((w === 'OVER' || w === 'INVERSE') && !this.declared.has(w.toLowerCase())) {
      this.flag('W721', ti0, line.sig[st.hi - 1] as number, `${w} has no CPC BASIC statement: use the ink mode of PLOT and DRAW (OVER) or swap PEN and PAPER (INVERSE)`);
      return;
    }
    if (w === 'ON' && second !== 'ERROR' && second !== 'BREAK') this.onGoto(line, st);
    if (w === 'DRAW') this.drawStatement(line, st);
    if (w === 'DIM') this.dimStatement(line, st, proc !== null, loopDepth);
    if (ITEM_STATEMENTS.has(w)) this.itemStatement(line, st, w);
    if (w === 'PLOT' || w === 'DRAW' || w === 'DRAWR') this.flag('W731', ti0, line.sig[st.hi - 1] as number, `${w}: coordinates are Locomotive units (640 x 400)`);
    if (w === 'PAPER' || w === 'BORDER') this.flag('W730', ti0, line.sig[st.hi - 1] as number, `A colour number in ${w}: Spectrum colours 0-7 were mapped to the colours of the mode`);
    if (w === 'READ') this.readStatement(line, st);
    if (w === 'DATA') return;
    if (w === 'ASM') return;

    // token-level scans inside this statement
    if (w !== 'SUB' && w !== 'FUNCTION' && w !== 'DECLARE') this.scanStatement(line, st);
    // expression flags (W728, W729, W735, W733)
    this.expressionFlags(line, st, w);
  }

  private argCount(line: Line, lo: number, hi: number): number {
    if (lo >= hi) return 0;
    let n = 1;
    let depth = 0;
    for (let p = lo; p < hi; p++) {
      const t = this.sigTok(line, p) as Tok;
      if (t.kind !== 'op') continue;
      if (t.text === '(') depth++;
      else if (t.text === ')') depth--;
      else if (t.text === ',' && depth === 0) n++;
    }
    return n;
  }

  private hasSemicolon(line: Line, lo: number, hi: number): boolean {
    for (let p = lo; p < hi; p++) if (this.isOp(line, p, ';')) return true;
    return false;
  }

  private removeStatement(line: Line, st: Stmt): void {
    const a = line.sig[st.lo] as number;
    const b = line.sig[st.hi - 1] as number;
    const onlyOne = line.stmts.length === 1;
    if (onlyOne) {
      this.removeLine(a, b);
      return;
    }
    let from = a;
    let to = b + 1;
    // take the following colon and blanks, else the preceding colon
    let q = to;
    while (q < this.toks.length && this.tk(q).kind === 'ws') q++;
    if (q < this.toks.length && this.tk(q).kind === 'op' && this.tk(q).text === ':') {
      to = q + 1;
      while (to < this.toks.length && this.tk(to).kind === 'ws') to++;
    } else {
      let r = from;
      while (r > 0 && this.tk(r - 1).kind === 'ws') r--;
      if (r > 0 && this.tk(r - 1).kind === 'op' && this.tk(r - 1).text === ':') {
        from = r - 1;
        while (from > 0 && this.tk(from - 1).kind === 'ws') from--;
      }
    }
    for (let k = from; k < to; k++) this.ops.remove(k);
  }

  // ---- W705

  private onGoto(line: Line, st: Stmt): void {
    // ON expr GOTO|GOSUB|GO TO|GO SUB a, b, c
    let q = -1;
    let depth = 0;
    for (let p = st.lo + 1; p < st.hi; p++) {
      const t = this.sigTok(line, p) as Tok;
      if (t.kind === 'op') {
        if (t.text === '(') depth++;
        else if (t.text === ')') depth--;
      } else if (depth === 0 && t.kind === 'word') {
        const u = t.text.toUpperCase();
        if (u === 'GOTO' || u === 'GOSUB' || u === 'GO') {
          q = p;
          break;
        }
      }
    }
    if (q < 0 || q === st.lo + 1) return;
    const a = line.sig[st.lo + 1] as number;
    const b = line.sig[q - 1] as number;
    if (!this.gatedOn) {
      this.flag('W727', line.sig[st.lo] as number, b, 'ON n GOTO or GOSUB counts from 1 in CPC BASIC (Boriel counted from 0)');
      return;
    }
    const lit = this.literalInt(a, b);
    if (lit !== undefined) this.ops.replace(a, String(lit + 1));
    else if (q - (st.lo + 1) === 1 && this.tk(a).kind === 'word') this.ops.insertAfter(b, ' + 1');
    else if (this.isOp(line, st.lo + 1, '(') && matchParen(this.toks, line.sig, st.lo + 1, q) === q - 1) this.ops.insertAfter(b, ' + 1');
    else {
      this.ops.insertBefore(a, '(');
      this.ops.insertAfter(b, ') + 1');
    }
    this.rewrite('W705', a, b, true);
  }

  // ---- W715

  private drawStatement(line: Line, st: Stmt): void {
    const ti = line.sig[st.lo] as number;
    if (this.argCount(line, st.lo + 1, st.hi) === 2 && !this.hasSemicolon(line, st.lo + 1, st.hi)) {
      if (this.gatedOn) {
        this.ops.replace(ti, like((this.sigTok(line, st.lo) as Tok).text, 'DRAWR'));
        this.rewrite('W715', ti, ti, true);
      } else this.flag('W727', ti, line.sig[st.hi - 1] as number, 'DRAW x, y goes to the point (x, y) in CPC BASIC (Boriel moved by an offset; DRAWR does)');
    }
  }

  // ---- DIM: W714, W723, W726, W737

  private dimStatement(line: Line, st: Stmt, inProc: boolean, loopDepth: number): void {
    const ti = line.sig[st.lo] as number;
    let hasAs = false;
    let initAt = -1;
    for (let p = st.lo + 1; p < st.hi; p++) {
      const t = this.sigTok(line, p) as Tok;
      if (t.kind === 'word' && t.text.toUpperCase() === 'AS') hasAs = true;
      if (t.kind === 'op' && t.text === '(') {
        const close = matchParen(this.toks, line.sig, p, st.hi);
        if (close < 0) break;
        this.dimBounds(line, p, close);
        p = close;
        continue;
      }
      if (t.kind === 'op' && t.text === '=' && initAt < 0) initAt = p;
      if (t.kind === 'op' && t.text === '=>') initAt = -2;
    }
    if (!hasAs) this.flag('W737', ti, line.sig[st.hi - 1] as number, 'DIM without AS type: the variable is an INTEGER now (Boriel guessed the type from its first use)');
    if (inProc && loopDepth > 0 && initAt >= 0) {
      const v = this.sigTok(line, initAt + 1);
      const v2 = this.sigTok(line, initAt + 2);
      const constant = (v !== undefined && (v.kind === 'num' || v.kind === 'str') && initAt + 2 === st.hi) ||
        (v !== undefined && v.text === '-' && v2 !== undefined && v2.kind === 'num' && initAt + 3 === st.hi);
      if (constant) this.flag('W726', ti, line.sig[st.hi - 1] as number, 'A local DIM with a constant initial value inside a loop: it is assigned each time the DIM is reached');
    }
  }

  private dimBounds(line: Line, open: number, close: number): void {
    // split the dimensions at depth-0 commas
    let lo = open + 1;
    const dims: Array<[number, number]> = [];
    let depth = 0;
    for (let p = open + 1; p < close; p++) {
      const t = this.sigTok(line, p) as Tok;
      if (t.kind === 'op' && t.text === '(') depth++;
      else if (t.kind === 'op' && t.text === ')') depth--;
      else if (t.kind === 'op' && t.text === ',' && depth === 0) {
        dims.push([lo, p]);
        lo = p + 1;
      }
    }
    dims.push([lo, close]);
    for (const [dl, dh] of dims) {
      let to = -1;
      let d2 = 0;
      for (let p = dl; p < dh; p++) {
        const t = this.sigTok(line, p) as Tok;
        if (t.kind === 'op' && t.text === '(') d2++;
        else if (t.kind === 'op' && t.text === ')') d2--;
        else if (d2 === 0 && t.kind === 'word' && t.text.toUpperCase() === 'TO') {
          to = p;
          break;
        }
      }
      if (to < 0) continue;
      const a = line.sig[dl] as number;
      const b = line.sig[to - 1] as number;
      const lit = this.literalInt(a, b);
      const startTok = line.sig[dl] as number;
      const endTok = line.sig[dh - 1] as number;
      if (lit === 0) {
        // remove `0 TO `
        const nextSig = line.sig[to + 1] as number;
        for (let k = a; k < nextSig; k++) this.ops.remove(k);
        this.rewrite('W714', startTok, endTok);
      } else {
        this.flag('W723', startTok, endTok, 'DIM bounds that do not start at 0: arrays start at 0 in CPC BASIC, shift the indices');
      }
    }
  }

  // ---- PRINT, PLOT, DRAW, CIRCLE items: W716, W720

  private itemStatement(line: Line, st: Stmt, w: string): void {
    let depth = 0;
    for (let p = st.lo + 1; p < st.hi; p++) {
      const t = this.sigTok(line, p) as Tok;
      if (t.kind === 'op') {
        if (t.text === '(') depth++;
        else if (t.text === ')') depth--;
        continue;
      }
      if (depth !== 0 || t.kind !== 'word') continue;
      const u = t.text.toUpperCase();
      const prev = this.sigTok(line, p - 1);
      const atItem = p === st.lo + 1 || (prev !== undefined && prev.kind === 'op' && (prev.text === ';' || prev.text === ',' || prev.text === "'"));
      if (!atItem) continue;
      if (NOEFFECT.has(u)) {
        // remove the item: the word, its operand and the `;` or `,` after it
        let q = p + 1;
        let d = 0;
        while (q < st.hi) {
          const x = this.sigTok(line, q) as Tok;
          if (x.kind === 'op') {
            if (x.text === '(') d++;
            else if (x.text === ')') d--;
            else if (d === 0 && (x.text === ';' || x.text === ',')) break;
          }
          q++;
        }
        const a = line.sig[p] as number;
        let b = line.sig[q - 1] as number;
        let endRm = b;
        if (q < st.hi) {
          endRm = line.sig[q] as number;
          b = endRm;
        }
        for (let k = a; k <= endRm; k++) this.ops.remove(k);
        // blanks after the removed separator
        let r = endRm + 1;
        while (r < this.toks.length && this.tk(r).kind === 'ws' && q < st.hi) this.ops.remove(r++);
        this.rewrite('W716', a, b);
        p = q;
        continue;
      }
      if (ATTR_ITEMS.has(u)) {
        const last = line.sig[st.hi - 1] as number;
        this.flag('W720', line.sig[p] as number, last, `${u} inside ${w}: CPC BASIC has no temporary ${u} item`);
      }
    }
  }

  // ---- READ: W736

  private readStatement(line: Line, st: Stmt): void {
    if (!this.run.project.dataNumbers) return;
    for (let p = st.lo + 1; p < st.hi; p++) {
      const t = this.sigTok(line, p) as Tok;
      if (t.kind !== 'word') continue;
      const key = t.text.toLowerCase();
      const dec = this.run.project.decls.get(key);
      if (t.text.endsWith('$') || dec?.type === 'STRING') {
        this.flag('W736', line.sig[p] as number, line.sig[p] as number, `READ ${t.text}: a DATA item that is an unquoted number gives its text in CPC BASIC`);
      }
    }
  }

  // ---- token-level scans inside a statement: W706, W713, W718, flags by word

  private scanStatement(line: Line, st: Stmt): void {
    const isDim = this.sigW(line, st.lo) === 'DIM';
    const slices: Array<[number, number]> = [];
    for (let p = st.lo; p < st.hi; p++) {
      const t = this.sigTok(line, p) as Tok;
      if (t.kind !== 'word') continue;
      const ti = line.sig[p] as number;
      const u = t.text.toUpperCase();
      const lower = t.text.toLowerCase();
      const nextIsParen = this.isOp(line, p + 1, '(');
      // flags by word
      if ((u === 'STR$' || (u === 'STR' && !this.declared.has('str'))) && !this.declared.has('str$')) this.flag('W732', ti, ti, 'STR$ has a leading space for numbers that are not negative');
      if (u === 'INKEY$') this.flag('W734', ti, ti, 'INKEY$ reads the key buffer, not the key held now');
      if ((u === 'ATTR' || u === 'SCREEN$' || u === 'USR' || u === 'ACS' || u === 'ASN' || u === 'VERIFY') && !this.declared.has(splitSuffix(lower).base)) {
        this.flag('W721', ti, ti, `${u} does not exist in CPC BASIC`);
      }
      const libFile = BORIEL_LIB_FUNCS.get(lower);
      if (libFile !== undefined && this.run.project.includes.has(libFile) && nextIsParen && !this.declared.has(lower)) {
        this.flag('W722', ti, ti, `${t.text}() is defined by the Boriel library file ${libFile}, which CPC BASIC does not have`);
      }
      if (!nextIsParen) continue;
      const close = matchParen(this.toks, line.sig, p + 1, st.hi);
      if (close < 0) continue;
      // W713 (gated): UBOUND(a), LBOUND(a)
      if ((u === 'UBOUND' || u === 'LBOUND') && this.argCount(line, p + 2, close) === 1) {
        if (!this.gatedOn) {
          this.flag('W727', ti, line.sig[close] as number, `${t.text}(a) without a dimension is the bound of dimension 1 in CPC BASIC (Boriel returned the number of dimensions)`);
          continue;
        }
        this.ops.insertAfter(line.sig[close - 1] as number, ', 0');
        this.rewrite('W713', ti, line.sig[close] as number, true);
        continue;
      }
      // W718: CHR$(a, b, c)
      if ((u === 'CHR$' || u === 'CHR') && !this.declared.has('chr') && this.argCount(line, p + 2, close) > 1) {
        let depth = 0;
        for (let q = p + 2; q < close; q++) {
          const x = this.sigTok(line, q) as Tok;
          if (x.kind === 'op' && x.text === '(') depth++;
          else if (x.kind === 'op' && x.text === ')') depth--;
          else if (x.kind === 'op' && x.text === ',' && depth === 0) {
            const ci = line.sig[q] as number;
            this.ops.replace(ci, ') + CHR$(');
            if (this.tk(ci + 1).kind === 'ws') this.ops.remove(ci + 1);
          }
        }
        this.rewrite('W718', ti, line.sig[close] as number);
        continue;
      }
      if (isDim) continue;
      // W706: slices and single-index strings
      if (BORIEL_KEYWORDS.has(u) || (RESERVED_WORDS.has(u) && !this.declared.has(lower))) continue;
      slices.push([p, close]);
    }
    // innermost first, so that an outer rewrite copies the text of an inner one that is done
    for (let k = slices.length - 1; k >= 0; k--) {
      const [p, close] = slices[k] as [number, number];
      this.sliceRule(line, st, p, close);
    }
  }

  /** What `name` (with its suffix as written) is: a string variable, an array, either, or neither. Its own file decides first. */
  private stringKind(text: string): 'scalar' | 'array' | 'maybe' | 'no' {
    const key = text.toLowerCase();
    const { base } = splitSuffix(key);
    const kindIn = (p: Project): 'scalar' | 'array' | 'maybe' | 'no' | undefined => {
      const dec = p.decls.get(key);
      const decBase = p.decls.get(base);
      const isStr = key.endsWith('$') || dec?.type === 'STRING' || decBase?.type === 'STRING';
      if (!isStr) return dec === undefined && decBase === undefined ? undefined : 'no';
      if (dec?.proc || decBase?.proc) return 'no';
      const arr = (dec?.array ?? false) || (decBase?.array ?? false);
      const scalarSeen = p.scalarStrings.has(key) || (dec !== undefined && !dec.array && dec.declared) || (decBase !== undefined && !decBase.array && decBase.type === 'STRING');
      if (arr && scalarSeen) return 'maybe';
      if (arr) return 'array';
      if (scalarSeen) return 'scalar';
      return key.endsWith('$') || dec !== undefined || decBase !== undefined ? 'maybe' : undefined;
    };
    const mine = kindIn(this.local);
    if (mine === 'array' || mine === 'scalar' || mine === 'no') return mine;
    return kindIn(this.run.project) ?? (key.endsWith('$') ? 'maybe' : 'no');
  }

  private sliceRule(line: Line, st: Stmt, p: number, close: number): void {
    const nameTok = this.sigTok(line, p) as Tok;
    const open = p + 1;
    const N = line.sig[p] as number;
    const O = line.sig[open] as number;
    const C = line.sig[close] as number;
    // a depth-0 TO inside the parentheses
    let to = -1;
    let commas = 0;
    let depth = 0;
    for (let q = open + 1; q < close; q++) {
      const x = this.sigTok(line, q) as Tok;
      if (x.kind === 'op' && x.text === '(') depth++;
      else if (x.kind === 'op' && x.text === ')') depth--;
      else if (depth === 0 && x.kind === 'op' && x.text === ',') commas++;
      else if (depth === 0 && x.kind === 'word' && x.text.toUpperCase() === 'TO' && to < 0) to = q;
    }
    const isTarget = p === st.lo && this.isOp(line, close + 1, '=');
    if (to >= 0 && commas === 0) {
      if (isTarget) {
        this.flag('W723', N, C, 'An assignment to a slice: use the MID$ statement (positions count from 1)');
        return;
      }
      this.rangeSlice(line, p, open, close, to);
      return;
    }
    if (to >= 0 || commas > 0) return;
    // a single index: a string that is not an array
    if (close === open + 1) return;
    const kind = this.stringKind(nameTok.text);
    if (kind === 'no' || kind === 'array') return;
    if (kind === 'maybe') {
      this.flag('W723', N, C, `${nameTok.text}(i) may be a string slice or an array element: use MID$(${nameTok.text}, i + 1, 1) for a string`);
      return;
    }
    if (isTarget) {
      this.flag('W723', N, C, 'An assignment to a character of a string: use the MID$ statement (positions count from 1)');
      return;
    }
    const a = line.sig[open + 1] as number;
    const b = line.sig[close - 1] as number;
    this.ops.insertBefore(N, 'MID$(');
    this.ops.replace(O, ', ');
    this.dropBlanks(O + 1, a);
    this.plusOne(line, open + 1, close, a, b);
    this.dropBlanks(b + 1, C);
    this.ops.insertBefore(C, ', 1');
    this.rewrite('W706', N, C);
  }

  private dropBlanks(from: number, to: number): void {
    for (let k = from; k < to; k++) if (this.tk(k).kind === 'ws') this.ops.remove(k);
  }

  /** Adds 1 to the expression `[lo, hi)` (positions), folding a literal. */
  private plusOne(line: Line, lo: number, hi: number, a: number, b: number): void {
    const lit = this.literalInt(a, b);
    if (lit !== undefined) this.ops.replace(a, String(lit + 1));
    else if (this.needsParens(line, lo, hi)) {
      this.ops.insertBefore(a, '(');
      this.ops.insertAfter(b, ') + 1');
    } else this.ops.insertAfter(b, ' + 1');
  }

  private rangeSlice(line: Line, p: number, open: number, close: number, to: number): void {
    const N = line.sig[p] as number;
    const O = line.sig[open] as number;
    const C = line.sig[close] as number;
    const T = line.sig[to] as number;
    const hasStart = to > open + 1;
    const hasEnd = to < close - 1;
    const sLo = open + 1;
    const sHi = to;
    const eLo = to + 1;
    const eHi = close;
    const sA = hasStart ? (line.sig[sLo] as number) : -1;
    const sB = hasStart ? (line.sig[sHi - 1] as number) : -1;
    const eA = hasEnd ? (line.sig[eLo] as number) : -1;
    const eB = hasEnd ? (line.sig[eHi - 1] as number) : -1;
    this.ops.replace(O, ', ');
    this.dropBlanks(O + 1, hasStart ? sA : T);
    this.dropBlanks(hasEnd ? eB + 1 : T + 1, C);
    this.dropBlanks(hasStart ? sB + 1 : T, T);
    this.dropBlanks(T + 1, hasEnd ? eA : C);
    if (!hasStart && !hasEnd) return;
    if (!hasStart) {
      // a$(TO e) -> LEFT$(a$, e + 1)
      this.ops.insertBefore(N, 'LEFT$(');
      this.ops.remove(T);
      this.plusOne(line, eLo, eHi, eA, eB);
    } else if (!hasEnd) {
      // a$(s TO) -> MID$(a$, s + 1)
      this.ops.insertBefore(N, 'MID$(');
      this.ops.remove(T);
      this.plusOne(line, sLo, sHi, sA, sB);
    } else {
      this.ops.insertBefore(N, 'MID$(');
      const sLit = this.literalInt(sA, sB);
      const eLit = this.literalInt(eA, eB);
      const rawS = this.file.text.slice(this.tk(sA).start, this.tk(sB).end).replace(/\s+/g, '');
      const rawE = this.file.text.slice(this.tk(eA).start, this.tk(eB).end).replace(/\s+/g, '');
      if (sLit !== undefined && eLit !== undefined) {
        this.ops.replace(sA, String(sLit + 1));
        this.ops.replace(eA, String(eLit - sLit + 1));
        this.ops.replace(T, ', ');
      } else if (rawS.toLowerCase() === rawE.toLowerCase()) {
        // a$(i TO i): one character
        this.plusOne(line, sLo, sHi, sA, sB);
        this.ops.replace(T, ', 1');
        for (let k = eA; k <= eB; k++) this.ops.remove(k);
      } else if (sLit !== undefined) {
        this.ops.replace(sA, String(sLit + 1));
        this.ops.replace(T, ', ');
        if (sLit >= 2) this.ops.insertAfter(eB, ` - ${sLit - 1}`);
        else if (sLit === 0) this.ops.insertAfter(eB, ' + 1');
      } else if (eLit !== undefined) {
        const sText = this.needsParens(line, sLo, sHi) ? `(${this.ops.render(sA, sB + 1)})` : this.ops.render(sA, sB + 1);
        this.plusOne(line, sLo, sHi, sA, sB);
        this.ops.replace(T, ', ');
        this.ops.replace(eA, `${eLit + 1} - ${sText}`);
      } else {
        const sText = this.needsParens(line, sLo, sHi) ? `(${this.ops.render(sA, sB + 1)})` : this.ops.render(sA, sB + 1);
        this.plusOne(line, sLo, sHi, sA, sB);
        this.ops.replace(T, ', ');
        this.ops.insertAfter(eB, ` - ${sText} + 1`);
      }
    }
    this.rewrite('W706', N, C);
  }

  // ------------------------------------------------------------------ expression flags

  private expressionFlags(line: Line, st: Stmt, w: string): void {
    const roots = this.expressionRoots(line, st, w);
    for (const r of roots) this.walk(line, r.node, r.cond ? 'cond' : 'value');
    if (w === 'PRINT') this.printFlag(line, st);
  }

  /** The expressions of a statement and whether each is a condition. */
  private expressionRoots(line: Line, st: Stmt, w: string): Array<{ node: Node; cond: boolean }> {
    const out: Array<{ node: Node; cond: boolean }> = [];
    const parse = (lo: number, hi: number, cond: boolean): number => {
      const ep = new ExprParser(this.toks, line.sig, this.declared, lo, hi);
      const n = ep.parseExpr();
      if (n !== null) {
        out.push({ node: n, cond });
        return n.hi;
      }
      return lo;
    };
    const listFrom = (lo: number, hi: number): void => {
      let p = lo;
      while (p < hi) {
        const ep = new ExprParser(this.toks, line.sig, this.declared, p, hi);
        const n = ep.parseExpr();
        if (n === null) {
          // skip to the next depth-0 separator
          let depth = 0;
          while (p < hi) {
            const x = this.sigTok(line, p) as Tok;
            if (x.kind === 'op' && x.text === '(') depth++;
            else if (x.kind === 'op' && x.text === ')') depth--;
            else if (depth === 0 && x.kind === 'op' && (x.text === ',' || x.text === ';')) break;
            p++;
          }
          p++;
          continue;
        }
        out.push({ node: n, cond: false });
        p = n.hi;
        // anything but a separator after the expression (a keyword item): skip to the next separator
        while (p < hi) {
          const x = this.sigTok(line, p) as Tok;
          if (x.kind === 'op' && (x.text === ',' || x.text === ';')) break;
          p++;
        }
        p++;
      }
    };
    switch (w) {
      case 'IF':
      case 'ELSEIF': {
        let hi = st.hi;
        if (this.sigW(line, hi - 1) === 'THEN') hi--;
        parse(st.lo + 1, hi, true);
        break;
      }
      case 'WHILE':
      case 'UNTIL':
        parse(st.lo + 1, st.hi, true);
        break;
      case 'DO':
      case 'LOOP': {
        const s = this.sigW(line, st.lo + 1);
        if (s === 'WHILE' || s === 'UNTIL') parse(st.lo + 2, st.hi, true);
        break;
      }
      case 'SELECT':
      case 'CASE':
      case 'DIM':
      case 'CONST':
      case 'SUB':
      case 'FUNCTION':
      case 'DECLARE':
      case 'DATA':
      case 'ASM':
      case 'READ':
      case 'ON':
      case 'GOTO':
      case 'GOSUB':
      case 'GO':
      case 'RESTORE':
      case 'END':
      case 'EXIT':
      case 'CONTINUE':
      case 'NEXT':
      case 'ELSE':
      case 'THEN':
        break;
      case 'FOR': {
        // FOR v = a TO b STEP c
        let p = st.lo + 1;
        while (p < st.hi && !this.isOp(line, p, '=')) p++;
        p++;
        let toAt = p;
        let depth = 0;
        for (; toAt < st.hi; toAt++) {
          const x = this.sigTok(line, toAt) as Tok;
          if (x.kind === 'op' && x.text === '(') depth++;
          else if (x.kind === 'op' && x.text === ')') depth--;
          else if (depth === 0 && x.kind === 'word' && x.text.toUpperCase() === 'TO') break;
        }
        parse(p, toAt, false);
        let stepAt = toAt + 1;
        depth = 0;
        for (; stepAt < st.hi; stepAt++) {
          const x = this.sigTok(line, stepAt) as Tok;
          if (x.kind === 'op' && x.text === '(') depth++;
          else if (x.kind === 'op' && x.text === ')') depth--;
          else if (depth === 0 && x.kind === 'word' && x.text.toUpperCase() === 'STEP') break;
        }
        parse(toAt + 1, stepAt, false);
        if (stepAt < st.hi) parse(stepAt + 1, st.hi, false);
        break;
      }
      case 'PRINT': {
        this.printItems(line, st, (lo, hi) => void parse(lo, hi, false));
        break;
      }
      case 'RETURN':
        if (st.hi - st.lo > 1) parse(st.lo + 1, st.hi, false);
        break;
      case 'LET':
        this.assignment(line, st, st.lo + 1, (lo, hi) => void parse(lo, hi, false));
        break;
      default: {
        const t0 = this.sigTok(line, st.lo) as Tok;
        if (t0.kind === 'word' && this.assignment(line, st, st.lo, (lo, hi) => void parse(lo, hi, false))) break;
        if (t0.kind === 'word') listFrom(st.lo + 1, st.hi);
      }
    }
    return out;
  }

  /** `name[(...)] = expr`: calls `rhs` for the right side and returns true. */
  private assignment(line: Line, st: Stmt, from: number, rhs: (lo: number, hi: number) => void): boolean {
    const nm = this.sigTok(line, from);
    if (nm === undefined || nm.kind !== 'word') return false;
    let p = from + 1;
    while (this.isOp(line, p, '(')) {
      const close = matchParen(this.toks, line.sig, p, st.hi);
      if (close < 0) return false;
      p = close + 1;
    }
    if (!this.isOp(line, p, '=') || p >= st.hi) return false;
    rhs(p + 1, st.hi);
    return true;
  }

  /** PRINT items (not AT, TAB or attributes) as expressions. */
  private printItems(line: Line, st: Stmt, onExpr: (lo: number, hi: number) => void): void {
    let p = st.lo + 1;
    while (p < st.hi) {
      const t = this.sigTok(line, p) as Tok;
      if (t.kind === 'op' && (t.text === ';' || t.text === ',' || t.text === "'")) {
        p++;
        continue;
      }
      const u = t.kind === 'word' ? t.text.toUpperCase() : '';
      if (u === 'AT') {
        // AT y, x
        const e1 = new ExprParser(this.toks, line.sig, this.declared, p + 1, st.hi);
        const n1 = e1.parseExpr();
        if (n1 === null) return;
        p = n1.hi;
        if (this.isOp(line, p, ',')) {
          const e2 = new ExprParser(this.toks, line.sig, this.declared, p + 1, st.hi);
          const n2 = e2.parseExpr();
          if (n2 === null) return;
          p = n2.hi;
        }
        continue;
      }
      if (u === 'TAB' || ATTR_ITEMS.has(u) || NOEFFECT.has(u)) {
        const e1 = new ExprParser(this.toks, line.sig, this.declared, p + 1, st.hi);
        const n1 = e1.parseExpr();
        if (n1 === null) return;
        p = n1.hi;
        continue;
      }
      const ep = new ExprParser(this.toks, line.sig, this.declared, p, st.hi);
      const n = ep.parseExpr();
      if (n === null) return;
      onExpr(p, n.hi);
      p = n.hi;
    }
  }

  // ---- W733

  private printFlag(line: Line, st: Stmt): void {
    let flagged = false;
    const fire = (a: number, b: number, why: string): void => {
      if (flagged) return;
      flagged = true;
      this.flag('W733', a, b, `PRINT: ${why}`);
    };
    // commas outside AT, TAB, and brackets
    let p = st.lo + 1;
    while (p < st.hi) {
      const t = this.sigTok(line, p) as Tok;
      const ti = line.sig[p] as number;
      if (t.kind === 'op' && t.text === ',') {
        fire(ti, ti, 'a comma moves to the next 13-column zone');
        p++;
        continue;
      }
      if (t.kind === 'op' && (t.text === ';' || t.text === "'")) {
        p++;
        continue;
      }
      const u = t.kind === 'word' ? t.text.toUpperCase() : '';
      if (u === 'AT') {
        const e1 = new ExprParser(this.toks, line.sig, this.declared, p + 1, st.hi);
        const n1 = e1.parseExpr();
        if (n1 === null) return;
        p = n1.hi;
        if (this.isOp(line, p, ',')) {
          const e2 = new ExprParser(this.toks, line.sig, this.declared, p + 1, st.hi);
          const n2 = e2.parseExpr();
          if (n2 === null) return;
          p = n2.hi;
        }
        continue;
      }
      if (u === 'TAB') {
        fire(ti, ti, 'TAB(n) counts columns from 1');
        const e1 = new ExprParser(this.toks, line.sig, this.declared, p + 1, st.hi);
        const n1 = e1.parseExpr();
        if (n1 === null) return;
        p = n1.hi;
        continue;
      }
      if (ATTR_ITEMS.has(u) || NOEFFECT.has(u)) {
        const e1 = new ExprParser(this.toks, line.sig, this.declared, p + 1, st.hi);
        const n1 = e1.parseExpr();
        if (n1 === null) return;
        p = n1.hi;
        continue;
      }
      const ep = new ExprParser(this.toks, line.sig, this.declared, p, st.hi);
      const n = ep.parseExpr();
      if (n === null) return;
      if (!this.isStringNode(line, n)) fire(line.sig[n.lo] as number, line.sig[n.hi - 1] as number, 'a number prints with a sign position and a trailing space');
      p = n.hi;
    }
  }

  private isStringNode(line: Line, n: Node): boolean {
    switch (n.k) {
      case 'str':
        return true;
      case 'paren':
        return this.isStringNode(line, n.kids[0] as Node);
      case 'bin': {
        const op = this.sigTok(line, n.op as number);
        return op !== undefined && op.text === '+' && this.isStringNode(line, n.kids[0] as Node) && this.isStringNode(line, n.kids[1] as Node);
      }
      case 'fnp': {
        const t = this.sigTok(line, n.lo) as Tok;
        const u = t.text.toUpperCase();
        return u.endsWith('$') || u === 'CHR' || u === 'STR';
      }
      case 'name': {
        const t = this.sigTok(line, n.op as number) as Tok;
        const u = t.text.toUpperCase();
        if (u.endsWith('$')) return true;
        if (STRING_FUNCS.has(u)) return true;
        const dec = this.run.project.decls.get(t.text.toLowerCase());
        return dec?.type === 'STRING';
      }
      default:
        return false;
    }
  }

  // ---- W728, W729, W735

  private isBool(line: Line, n: Node): boolean {
    if (n.k === 'paren') return this.isBool(line, n.kids[0] as Node);
    if (n.k === 'bin') {
      const op = this.opKey(line, n);
      if (COMPARE_OPS.has(op)) return true;
      if (op === 'AND' || op === 'OR' || op === 'XOR') return this.isBool(line, n.kids[0] as Node) && this.isBool(line, n.kids[1] as Node);
    }
    if (n.k === 'un' && this.opKey(line, n) === 'NOT') return this.isBool(line, n.kids[0] as Node);
    return false;
  }

  private opKey(line: Line, n: Node): string {
    const t = this.sigTok(line, n.op as number);
    return t === undefined ? '' : t.text.toUpperCase();
  }

  private hasBool(line: Line, n: Node): boolean {
    if (this.isBool(line, n)) return true;
    if (n.k === 'bin') {
      const op = this.opKey(line, n);
      if (op === 'AND' || op === 'OR' || op === 'XOR') return this.hasBool(line, n.kids[0] as Node) || this.hasBool(line, n.kids[1] as Node);
    }
    if (n.k === 'un' && this.opKey(line, n) === 'NOT') return this.hasBool(line, n.kids[0] as Node);
    if (n.k === 'paren') return this.hasBool(line, n.kids[0] as Node);
    return false;
  }

  private walk(line: Line, n: Node, ctx: 'cond' | 'value' | 'quiet'): void {
    const span = (): [number, number] => [line.sig[n.lo] as number, line.sig[n.hi - 1] as number];
    switch (n.k) {
      case 'paren':
        this.walk(line, n.kids[0] as Node, ctx);
        return;
      case 'bin': {
        const op = this.opKey(line, n);
        const l = n.kids[0] as Node;
        const r = n.kids[1] as Node;
        if (COMPARE_OPS.has(op)) {
          if (ctx === 'value') {
            const [a, b] = span();
            this.flag('W728', a, b, 'A comparison used as a number is -1 when true (Boriel gave 1)');
          }
          this.walk(line, l, 'value');
          this.walk(line, r, 'value');
          return;
        }
        if (op === 'AND' || op === 'OR' || op === 'XOR') {
          const opTok = line.sig[n.op as number] as number;
          if (!(this.isBool(line, l) && this.isBool(line, r))) {
            this.flag('W729', opTok, opTok, `${op} on a value that is not a comparison: it is bitwise in CPC BASIC`);
          }
          if (ctx === 'value' && this.hasBool(line, n)) {
            const [a, b] = span();
            this.flag('W728', a, b, 'A comparison used as a number is -1 when true (Boriel gave 1)');
            this.walk(line, l, 'quiet');
            this.walk(line, r, 'quiet');
          } else {
            this.walk(line, l, ctx);
            this.walk(line, r, ctx);
          }
          return;
        }
        if (op === 'MOD') this.modFlag(line, n);
        else if (op === '/' || op === '\\') this.divFlag(line, n, op);
        this.walk(line, l, 'value');
        this.walk(line, r, 'value');
        return;
      }
      case 'un': {
        const op = this.opKey(line, n);
        const k = n.kids[0] as Node;
        if (op === 'NOT') {
          const opTok = line.sig[n.op as number] as number;
          if (!this.isBool(line, k)) this.flag('W729', opTok, opTok, 'NOT on a value that is not a comparison: it is bitwise in CPC BASIC');
          if (ctx === 'value' && this.hasBool(line, n)) {
            const [a, b] = span();
            this.flag('W728', a, b, 'A comparison used as a number is -1 when true (Boriel gave 1)');
            this.walk(line, k, 'quiet');
          } else this.walk(line, k, ctx);
          return;
        }
        this.walk(line, k, 'value');
        return;
      }
      case 'fnp':
      case 'name':
      case 'at':
      case 'range':
        for (const k of n.kids) this.walk(line, k, 'value');
        return;
      default:
        return;
    }
  }

  /** True when the dividend `n` is a literal or a name declared (or cast) unsigned: its sign cannot differ between the dialects. */
  private unsignedDividend(line: Line, n: Node): boolean {
    let target: Node = n;
    while (target.k === 'paren') target = target.kids[0] as Node;
    if (target.k === 'num') return true;
    if (target.k !== 'name') return false;
    const t = this.sigTok(line, target.op as number) as Tok;
    if (t.text.toUpperCase() === 'CAST' && target.kids[0] !== undefined) {
      const ty = this.sigTok(line, target.kids[0].lo)?.text.toUpperCase();
      return ty === 'UBYTE' || ty === 'UINTEGER' || ty === 'ULONG';
    }
    const dec = this.run.project.decls.get(t.text.toLowerCase());
    return dec?.type === 'UBYTE' || dec?.type === 'UINTEGER' || dec?.type === 'ULONG';
  }

  /** A declared FIXED or FLOAT dividend, or a literal with a decimal point: `/` is exact there. */
  private isFractional(line: Line, n: Node): boolean {
    if (n.k === 'paren') return this.isFractional(line, n.kids[0] as Node);
    if (n.k === 'num') return /\./.test(this.tk(line.sig[n.lo] as number).text);
    if (n.k === 'name') {
      const dec = this.run.project.decls.get((this.sigTok(line, n.op as number) as Tok).text.toLowerCase());
      return dec?.type === 'FIXED' || dec?.type === 'FLOAT';
    }
    return false;
  }

  /** The value of `n` when it is a literal power of two above 1 (a decimal, `$` hex or `h` hex number), else undefined. */
  private powerOfTwo(line: Line, n: Node): number | undefined {
    let t: Node = n;
    while (t.k === 'paren') t = t.kids[0] as Node;
    if (t.k !== 'num') return undefined;
    const ti = line.sig[t.lo] as number;
    const v = this.literalInt(ti, ti);
    return v !== undefined && v >= 2 && (v & (v - 1)) === 0 ? v : undefined;
  }

  private divFlag(line: Line, n: Node, op: string): void {
    const l = n.kids[0] as Node;
    if (this.powerOfTwo(line, n.kids[1] as Node) === undefined) return;
    if (this.unsignedDividend(line, l) || (op === '/' && this.isFractional(line, l))) return;
    const opTok = line.sig[n.op as number] as number;
    this.flag('W735', opTok, opTok, `${op} by a power of two truncates towards zero in CPC BASIC (-7 ${op} 2 is -3; Boriel shifted a signed value: -4)`);
  }

  private modFlag(line: Line, n: Node): void {
    const l = n.kids[0] as Node;
    const opTok = line.sig[n.op as number] as number;
    if (this.unsignedDividend(line, l)) return;
    this.flag('W735', opTok, opTok, 'MOD takes the sign of the dividend in CPC BASIC (-7 MOD 3 is -1)');
  }
}
