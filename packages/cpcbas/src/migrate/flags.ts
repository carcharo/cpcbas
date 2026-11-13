/**
 * The review flags that need more than one token of one file: W738 (names that differ only in case, found from
 * the words of the whole project) and W739 (a `UINTEGER` met with an `INTEGER`, a literal 256-65535 in `INTEGER`
 * arithmetic that reaches a comparison, a division, PRINT/STR$ or a widening; found from the checked program).
 */
import { walk } from '../ast/walk.js';
import type { Expr, Node } from '../ast/ast.js';
import { bind } from '../binder/index.js';
import { check } from '../checker/index.js';
import { DiagnosticBag } from '../core/diagnostics.js';
import { SourceSet, type SourceFile } from '../core/source.js';
import type { CompileInput } from '../index.js';
import { RESERVED_WORDS } from '../lang/keywords.js';
import { runFrontEnd } from '../pipeline.js';
import { BORIEL_KEYWORDS } from './boriel-keywords.js';
import type { FileRules } from './rules.js';

// ------------------------------------------------------------------ W738

const isKeyword = (word: string): boolean => {
  const u = word.toUpperCase();
  return RESERVED_WORDS.has(u) || BORIEL_KEYWORDS.has(u);
};

/**
 * W738: a name spelled two ways in the project. Boriel told `score` from `Score` unless `#pragma case_insensitive`
 * was in force (the words between that pragma and its `pop` or `= FALSE`, or the end of the file, do not count).
 * One finding at the first use of each spelling.
 */
export function caseFlags(rules: readonly FileRules[]): void {
  const found = new Map<string, Map<string, Array<{ rules: FileRules; start: number; end: number }>>>();
  for (const r of rules) {
    const { toks, lines, text } = r.file;
    let insensitive = false;
    for (const line of lines) {
      const first = toks[line.sig[0] as number];
      if (first === undefined) continue;
      if (first.kind === 'pp') {
        if (first.text.toLowerCase() === '#pragma') {
          const body = text.slice(first.start, toks[line.sig[line.sig.length - 1] as number]?.end ?? first.end).toLowerCase();
          if (/case_insensitive\s*=\s*(true|1|on)\b/.test(body)) insensitive = true;
          else if (/case_insensitive\s*=\s*(false|0|off)\b/.test(body) || /pop\s*\(\s*case_insensitive/.test(body)) insensitive = false;
        }
        continue;
      }
      if (insensitive) continue;
      for (const ti of line.sig) {
        const t = toks[ti];
        if (t === undefined || t.kind !== 'word' || isKeyword(t.text)) continue;
        const key = t.text.toLowerCase();
        let spellings = found.get(key);
        if (spellings === undefined) found.set(key, (spellings = new Map()));
        let uses = spellings.get(t.text);
        if (uses === undefined) spellings.set(t.text, (uses = []));
        uses.push({ rules: r, start: t.start, end: t.end });
      }
    }
  }
  for (const spellings of found.values()) {
    if (spellings.size < 2) continue;
    const names = [...spellings.keys()];
    for (const [spelling, uses] of spellings) {
      const first = uses[0] as { rules: FileRules; start: number; end: number };
      first.rules.diags.push({
        code: 'W738',
        start: first.start,
        end: first.end,
        gated: false,
        message: `'${spelling}' differs only in case from ${names.filter((n) => n !== spelling).map((n) => `'${n}'`).join(', ')}: two names in Boriel BASIC, one in CPC BASIC`,
      });
    }
  }
}

// ------------------------------------------------------------------ W739

export interface SignFinding {
  readonly file: SourceFile;
  readonly start: number;
  readonly end: number;
  readonly message: string;
  /** `cmp`: a UINTEGER met an INTEGER; `lit`: a literal 256-65535 in INTEGER arithmetic. */
  readonly kind: 'cmp' | 'lit';
}

const COMPARE = new Set(['=', '<>', '<', '>', '<=', '>=']);
const WIDE = new Set(['LONG', 'ULONG', 'REAL', 'FIXED']);
const UNSIGNED = new Set(['UBYTE', 'UINTEGER']);

/** The W739 findings of one main file's program, from the binder's and the checker's types. Never throws. */
export function signFindings(input: CompileInput): { sources: SourceSet; findings: SignFinding[] } {
  const sources = new SourceSet();
  const findings: SignFinding[] = [];
  try {
    const bag = new DiagnosticBag();
    const { program } = runFrontEnd(input, sources, bag);
    if (bag.hasErrors) return { sources, findings };
    const bound = bind({ program, sources, diagnostics: bag, bareMetal: Object.prototype.hasOwnProperty.call(input.defines ?? {}, 'CPC_BAREMETAL') });
    const checked = check({ bound, sources, diagnostics: bag });
    if (bag.hasErrors) return { sources, findings };
    const type = (e: Expr): string | undefined => checked.exprTypes.get(e);
    const sink = new Map<Node, boolean>();
    const add = (node: Node, kind: SignFinding['kind'], message: string): void => {
      const file = sources.get(node.span.file);
      if (file.origin === 'user') findings.push({ file, start: node.span.start, end: node.span.end, message, kind });
    };
    walk(program, (node, parent) => {
      if (node.kind === 'Binary' || node.kind === 'Unary' || node.kind === 'NumberLit' || node.kind === 'Name' || node.kind === 'CallOrIndex' || node.kind === 'BuiltinCall' || node.kind === 'FnCall') {
        const e = node as Expr;
        let s = false;
        if (parent !== null) {
          if (parent.kind === 'Binary') s = COMPARE.has(parent.op) || parent.op === '/' || parent.op === '\\' || parent.op === 'MOD' || ((parent.op === '+' || parent.op === '-' || parent.op === '*') && (sink.get(parent) ?? false));
          else if (parent.kind === 'Unary') s = (parent.op === '-' || parent.op === '+') && (sink.get(parent) ?? false);
          else if (parent.kind === 'Print') s = true;
          else if (parent.kind === 'BuiltinCall') s = parent.keyword === 'STR$';
        }
        const wide = checked.coercions.get(e);
        if (wide !== undefined && WIDE.has(wide) && type(e) === 'INTEGER') s = true;
        sink.set(node, s);
      }
      if (node.kind !== 'Binary') return;
      if (COMPARE.has(node.op)) {
        const l = type(node.left);
        const r = type(node.right);
        const mixed = (l === 'UINTEGER' && r === 'INTEGER') || (l === 'INTEGER' && r === 'UINTEGER');
        if (mixed && !checked.constants.has(node.left) && !checked.constants.has(node.right)) {
          add(node, 'cmp', 'A UINTEGER is compared with an INTEGER: Boriel converted both to signed, CPC BASIC compares the values');
        }
        return;
      }
      if ((node.op === '+' || node.op === '-' || node.op === '*') && (sink.get(node) ?? false) && type(node) === 'INTEGER') {
        const lit = (e: Expr): boolean => e.kind === 'NumberLit' && !e.isReal && e.value >= 256 && e.value <= 65535;
        const other = lit(node.left) ? node.right : lit(node.right) ? node.left : undefined;
        const o = other === undefined ? undefined : type(other);
        if (o !== undefined && UNSIGNED.has(o)) {
          add(node, 'lit', 'A literal from 256 to 65535 is an INTEGER here (Boriel: UINTEGER), so this result is negative from 32768 up where it is compared, divided, printed or widened');
        }
      }
    });
  } catch {
    // a compiler bug is not the translator's finding
  }
  return { sources, findings };
}
