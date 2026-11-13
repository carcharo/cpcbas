/**
 * The AST dump: the `--stage ast` format and the snapshot format of the tests.
 *
 * One node per line, indented two spaces per level:
 *
 *   Kind field=value field=value [@line:col-line:col]
 *
 * - Scalar fields (strings in double quotes, numbers, true/false) come on the node's
 *   line, in the order of {@link PRINT_FIELDS}; `null` is written `-`.
 * - Node fields follow as children, prefixed with the field name (`target: Name ...`).
 * - List fields are a label line (`body:`) with the elements one level deeper; an empty
 *   list is just the label line.
 * - Records that are not nodes (IF branches, DEFINT ranges, loop conditions, includes)
 *   are printed like nodes under a fixed name (`Branch`, `Range`, `LoopCond`, `Include`).
 * - With `spans`, every node and record gets its span (end exclusive) and span-valued
 *   fields (`nextSpan`, `endSpan`) are printed too; without it spans are left out.
 *
 * The output ends with a newline and depends only on the tree, so it is stable.
 */

import type { SourceSet, Span } from '../core/source.js';
import type { CaseTest, Node, PrintItem } from './ast.js';

type AnyNode = Node | CaseTest | PrintItem;
type AnyKind = AnyNode['kind'];
type FieldsOf<K extends AnyKind> = ReadonlyArray<Exclude<keyof Extract<AnyNode, { kind: K }>, 'kind' | 'span'>>;

/** The fields of every node kind that the dump shows, in print order. Exhaustive over node kinds (checked by the compiler). */
export const PRINT_FIELDS: { readonly [K in AnyKind]: FieldsOf<K> } = {
  Program: ['mainFile', 'includes', 'body'],
  Name: ['text', 'base', 'suffix'],
  TypeRef: ['name', 'text'],
  LineTarget: ['number'],
  LabelTarget: ['name', 'key'],
  NumberLit: ['value', 'text', 'radix', 'isReal', 'suffix'],
  StringLit: ['value'],
  Unary: ['op', 'operand'],
  Binary: ['op', 'left', 'right'],
  AddressOf: ['target', 'index'],
  CallOrIndex: ['callee', 'args'],
  BuiltinCall: ['keyword', 'parens', 'typeArg', 'stream', 'args'],
  FnCall: ['name', 'args'],
  BadExpr: [],
  ArrayInit: ['elements'],
  LineLabel: ['number', 'name', 'key'],
  Let: ['explicitLet', 'target', 'value'],
  MidAssign: ['target', 'start', 'length', 'value'],
  Dim: ['decls'],
  DimDecl: ['name', 'bounds', 'type', 'init', 'at'],
  Const: ['name', 'type', 'value'],
  DefType: ['type', 'ranges'],
  Option: ['name'],
  If: ['form', 'branches', 'elseBody'],
  For: ['variable', 'from', 'to', 'step', 'body', 'nextName', 'nextSpan'],
  While: ['cond', 'body'],
  DoLoop: ['pre', 'body', 'post'],
  SelectCase: ['subject', 'cases', 'elseBody'],
  CaseClause: ['tests', 'body'],
  CaseValue: ['value'],
  CaseRange: ['from', 'to'],
  CaseIs: ['op', 'value'],
  Exit: ['target'],
  Continue: ['target'],
  Goto: ['implicit', 'target'],
  Gosub: ['target'],
  Return: ['value'],
  OnGoto: ['gosub', 'selector', 'targets'],
  OnBreak: ['action'],
  OnError: ['target'],
  Resume: ['mode', 'target'],
  Error: ['code'],
  End: [],
  Stop: [],
  EveryAfter: ['every', 'interval', 'timer', 'target'],
  Call: ['address', 'args'],
  Rsx: ['name', 'args'],
  SubCall: ['name', 'parens', 'args'],
  Print: ['stream', 'items'],
  PrintExpr: ['expr'],
  PrintSep: ['sep'],
  PrintTab: ['column'],
  PrintSpc: ['count'],
  PrintUsing: ['format'],
  PrintAt: ['row', 'col'],
  Write: ['stream', 'items'],
  Input: ['line', 'stream', 'prompt', 'promptSep', 'keepCursor', 'targets'],
  Data: ['values'],
  DataValue: ['raw', 'quoted'],
  Read: ['targets'],
  Restore: ['target'],
  Param: ['name', 'type', 'passing', 'isArray', 'default'],
  Procedure: ['procKind', 'convention', 'name', 'params', 'returnType', 'body', 'endSpan'],
  Declare: ['procKind', 'convention', 'name', 'params', 'returnType'],
  DefFn: ['name', 'params', 'body'],
  Builtin: ['keyword', 'stream', 'typeArg', 'args', 'hardwareAt'],
  Asm: ['lines'],
  AsmLine: ['text'],
  Pragma: ['op', 'name', 'value'],
  Require: ['path'],
  Init: ['label'],
  BadStmt: [],
};

/** Records without a `kind`, by the name of the field that holds them. */
const RECORDS: Record<string, { readonly name: string; readonly fields: readonly string[] }> = {
  branches: { name: 'Branch', fields: ['cond', 'body'] },
  ranges: { name: 'Range', fields: ['from', 'to'] },
  includes: { name: 'Include', fields: ['requested', 'angle', 'once', 'file', 'skipped'] },
  pre: { name: 'LoopCond', fields: ['until', 'expr'] },
  post: { name: 'LoopCond', fields: ['until', 'expr'] },
};

export interface PrintAstOptions {
  /** Add ` @line:col-line:col` to every node (end exclusive) and print span-valued fields. */
  readonly spans?: boolean;
}

function isSpan(v: unknown): v is Span {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.file === 'number' && typeof o.start === 'number' && typeof o.end === 'number' && !('kind' in o);
}

function spanText(span: Span, sources: SourceSet): string {
  const r = sources.range(span);
  return `${r.start.line}:${r.start.col}-${r.end.line}:${r.end.col}`;
}

function scalarText(v: unknown): string {
  if (v === null) return '-';
  if (typeof v === 'string') return JSON.stringify(v);
  return String(v);
}

/** The dump of a program (or any node, for tests and debugging). */
export function printAst(root: Node, sources: SourceSet, options: PrintAstOptions = {}): string {
  const spans = options.spans === true;
  const out: string[] = [];

  const emit = (
    level: number,
    label: string | null,
    kind: string,
    obj: Record<string, unknown>,
    fields: readonly string[],
  ): void => {
    const ind = '  '.repeat(level);
    let head = `${ind}${label ? `${label}: ` : ''}${kind}`;
    const kids: Array<[string, unknown]> = [];
    for (const f of fields) {
      const v = obj[f];
      if (isSpan(v)) {
        if (spans) head += ` ${f}=${spanText(v, sources)}`;
      } else if (v === undefined) continue;
      else if (v !== null && typeof v === 'object') kids.push([f, v]);
      else head += ` ${f}=${scalarText(v)}`;
    }
    if (spans && isSpan(obj.span)) head += ` @${spanText(obj.span, sources)}`;
    out.push(head);
    for (const [f, v] of kids) {
      if (Array.isArray(v)) {
        out.push(`${ind}  ${f}:`);
        for (const el of v) element(level + 2, null, f, el);
      } else element(level + 1, f, f, v);
    }
  };

  const element = (level: number, label: string | null, field: string, v: unknown): void => {
    if (v === null || typeof v !== 'object') {
      out.push(`${'  '.repeat(level)}${label ? `${label}: ` : ''}${scalarText(v)}`);
      return;
    }
    const o = v as Record<string, unknown>;
    if (typeof o.kind === 'string') {
      const fields = (PRINT_FIELDS as Record<string, readonly string[] | undefined>)[o.kind] ?? [];
      emit(level, label, o.kind, o, fields);
      return;
    }
    const rec = RECORDS[field];
    emit(level, label, rec ? rec.name : 'Record', o, rec ? rec.fields : Object.keys(o).filter((k) => k !== 'span'));
  };

  element(0, null, '', root);
  return `${out.join('\n')}\n`;
}
