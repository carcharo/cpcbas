/**
 * Reachable procedures (task L3-FIX).
 *
 * A SUB, FUNCTION or DEF FN is emitted when the main program reaches it through a call, an
 * `@name`, or its assembler label (`_Name`) appearing as a word in an ASM block of the main
 * program or of a reachable procedure (the library's ASM calls BASIC procedures by label).
 * Every procedure is still bound and checked; only the lowering skips the others, so their
 * strings and `#require`s are not linked.
 */
import type { Node } from '../../ast/ast.js';
import { children } from '../../ast/walk.js';
import type { FileId, Span } from '../../core/source.js';
import type { CheckedProgram, SymbolId } from '../../sem/model.js';

const cache = new WeakMap<CheckedProgram, ReadonlySet<SymbolId>>();

/** The words of an assembler line (labels may contain `.` and `$`). */
const WORD = /[A-Za-z_.$][A-Za-z0-9_.$]*/g;

/** The procedures and DEF FNs the main program reaches. */
export function reachableProcedures(checked: CheckedProgram): ReadonlySet<SymbolId> {
  const hit = cache.get(checked);
  if (hit !== undefined) return hit;
  const bound = checked.bound;
  const res = bound.resolutions;
  const byLabel = new Map<string, SymbolId>(); // lower-case label -> procedure
  for (const id of bound.procedures) {
    const s = bound.symbols[id];
    if (s !== undefined && (s.kind === 'procedure' || s.kind === 'deffn')) byLabel.set(s.label.toLowerCase(), id);
  }
  const reached = new Set<SymbolId>();
  const queue: SymbolId[] = [];
  const mark = (id: SymbolId | undefined): void => {
    if (id === undefined || reached.has(id)) return;
    const s = bound.symbols[id];
    if (s === undefined || (s.kind !== 'procedure' && s.kind !== 'deffn')) return;
    reached.add(id);
    queue.push(id);
  };
  const visit = (node: Node): boolean => {
    switch (node.kind) {
      case 'Procedure':
      case 'DefFn':
      case 'Declare':
        return false; // reached only through a use, never by being declared
      case 'Name':
        mark(res.names.get(node));
        break;
      case 'CallOrIndex':
        mark(res.callOrIndex.get(node));
        break;
      case 'FnCall':
        mark(res.fnCalls.get(node));
        break;
      case 'SubCall':
        mark(res.subCalls.get(node));
        break;
      case 'AsmLine':
        for (const w of node.text.replace(/;.*$/, '').matchAll(WORD)) mark(byLabel.get(w[0].toLowerCase()));
        break;
      default:
        break;
    }
    return true;
  };
  const walkAll = (n: Node): void => {
    if (!visit(n)) return;
    for (const c of children(n)) walkAll(c);
  };
  for (const n of bound.program.body) walkAll(n);
  // `#init` routines are called by the prologue; one may be a BASIC procedure's label.
  for (const i of bound.inits) mark(byLabel.get(i.label.toLowerCase()));
  while (queue.length > 0) {
    const s = bound.symbols[queue.pop() as SymbolId];
    if (s === undefined || (s.kind !== 'procedure' && s.kind !== 'deffn')) continue;
    for (const c of children(s.decl)) walkAll(c);
  }
  cache.set(checked, reached);
  return reached;
}

/**
 * The first call, in the program's own files (`isUser`), of the procedure whose declaration holds `within`
 * (follow-up 67: the span of a library refusal stub's assembler line, so the pipeline can report the user's
 * call). Null when no user code calls it directly.
 */
export function firstUserCall(checked: CheckedProgram, within: Span, isUser: (file: FileId) => boolean): Span | null {
  const bound = checked.bound;
  const res = bound.resolutions;
  const holds = (id: SymbolId | undefined): boolean => {
    const s = id === undefined ? undefined : bound.symbols[id];
    if (s === undefined || (s.kind !== 'procedure' && s.kind !== 'deffn')) return false;
    const d = s.decl.span;
    return d.file === within.file && d.start <= within.start && within.end <= d.end;
  };
  let found: Span | null = null;
  const walk = (n: Node): void => {
    if (found !== null) return;
    switch (n.kind) {
      case 'Declare':
        return;
      case 'Procedure':
      case 'DefFn':
        if (!isUser(n.span.file)) return;
        break;
      case 'Name':
        if (holds(res.names.get(n))) found = n.span;
        break;
      case 'CallOrIndex':
        if (holds(res.callOrIndex.get(n))) found = n.span;
        break;
      case 'FnCall':
        if (holds(res.fnCalls.get(n))) found = n.span;
        break;
      case 'SubCall':
        if (holds(res.subCalls.get(n))) found = n.span;
        break;
      default:
        break;
    }
    for (const c of children(n)) walk(c);
  };
  for (const n of bound.program.body) walk(n);
  return found;
}
