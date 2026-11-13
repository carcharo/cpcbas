import { describe, expect, it } from 'vitest';
import { everyKind, SPAN, bin, let_, name, num } from '../../test/ast-builders.js';
import type { Node } from './ast.js';
import { children, walk } from './walk.js';

/** Every node kind in ast.ts. The type test below fails to compile when a kind is missing from this list. */
const ALL_KINDS = [
  'Program', 'Name', 'TypeRef', 'LineTarget', 'LabelTarget', 'NumberLit', 'StringLit', 'Unary', 'Binary',
  'AddressOf', 'CallOrIndex', 'BuiltinCall', 'FnCall', 'BadExpr', 'ArrayInit', 'LineLabel', 'Let', 'MidAssign',
  'Dim', 'DimDecl', 'Const', 'DefType', 'Option', 'If', 'For', 'While', 'DoLoop', 'SelectCase', 'CaseClause',
  'Exit', 'Continue', 'Goto', 'Gosub', 'Return', 'OnGoto', 'OnBreak', 'OnError', 'Resume', 'Error', 'End', 'Stop',
  'EveryAfter', 'Call', 'Rsx', 'SubCall', 'Print', 'Write', 'Input', 'Data', 'DataValue', 'Read', 'Restore', 'Param',
  'Procedure', 'Declare', 'DefFn', 'Builtin', 'Asm', 'AsmLine', 'Pragma', 'Require', 'Init', 'BadStmt',
] as const satisfies readonly Node['kind'][];

type Missing = Exclude<Node['kind'], (typeof ALL_KINDS)[number]>;
const listIsExhaustive: [Missing] extends [never] ? true : Missing = true;

/** Independent oracle: every node object reachable by plain property traversal (spans skipped). */
function reachable(root: Node): Set<Node> {
  const kinds = new Set<string>(ALL_KINDS);
  const seen = new Set<object>();
  const found = new Set<Node>();
  const visit = (v: unknown): void => {
    if (typeof v !== 'object' || v === null || seen.has(v)) return;
    seen.add(v);
    const o = v as Record<string, unknown>;
    if (typeof o.kind === 'string' && kinds.has(o.kind)) found.add(v as Node);
    for (const [k, child] of Object.entries(o)) if (k !== 'span' && k !== 'nextSpan' && k !== 'endSpan') visit(child);
  };
  visit(root);
  return found;
}

describe('walk', () => {
  const set = everyKind();

  it('has an instance for every node kind', () => {
    expect(listIsExhaustive).toBe(true);
    expect(Object.keys(set).sort()).toEqual([...ALL_KINDS].sort());
    for (const k of ALL_KINDS) expect(set[k].kind).toBe(k);
  });

  it('walk visits every child of every node kind', () => {
    for (const k of ALL_KINDS) {
      const node = set[k];
      const visited = new Set<Node>();
      walk(node, (n) => {
        visited.add(n);
      });
      expect([...visited].map((n) => n.kind).sort(), k).toEqual([...reachable(node)].map((n) => n.kind).sort());
      for (const n of reachable(node)) expect(visited.has(n), `${k} reaches ${n.kind}`).toBe(true);
    }
  });

  it('children() returns direct children in source order', () => {
    const i = name('i');
    const forNode = (set.For as Extract<Node, { kind: 'For' }>);
    expect(children(forNode).map((n) => n.kind)).toEqual(['Name', 'NumberLit', 'NumberLit', 'NumberLit', 'Let', 'Name']);
    expect(children(set.If).map((n) => n.kind)).toEqual(['Binary', 'Let', 'Binary', 'Goto', 'Let']);
    expect(children(let_(i, bin('+', i, num(1)))).map((n) => n.kind)).toEqual(['Name', 'Binary']);
    expect(children(set.DoLoop).map((n) => n.kind)).toEqual(['Binary', 'Let', 'Binary']);
    expect(children(set.Print).map((n) => n.kind)).toEqual(['NumberLit', 'NumberLit', 'NumberLit', 'StringLit', 'NumberLit', 'NumberLit', 'Name']);
    expect(children(set.Builtin).map((n) => n.kind)).toEqual(['NumberLit', 'NumberLit', 'NumberLit']);
  });

  it('a leaf has no children and a shared TypeRef is returned once per declarator', () => {
    expect(children(set.End)).toEqual([]);
    expect(children({ kind: 'BadExpr', span: SPAN })).toEqual([]);
    const dim = set.Dim as Extract<Node, { kind: 'Dim' }>;
    const types = [...walkAll(dim)].filter((n) => n.kind === 'TypeRef');
    expect(types).toHaveLength(2);
    expect(types[0]).toBe(types[1]);
  });

  it('walk is pre-order, passes the parent, and false skips the children', () => {
    const seen: string[] = [];
    walk(set.Binary, (n, parent) => {
      seen.push(`${n.kind}<${parent?.kind ?? '-'}`);
    });
    expect(seen).toEqual(['Binary<-', 'Name<Binary', 'NumberLit<Binary']);
    const skipped: string[] = [];
    walk(set.Program, (n) => {
      skipped.push(n.kind);
      return n.kind === 'Program';
    });
    expect(skipped).toEqual(['Program', 'Let']);
  });
});

function walkAll(n: Node): Node[] {
  const out: Node[] = [];
  walk(n, (x) => {
    out.push(x);
  });
  return out;
}
