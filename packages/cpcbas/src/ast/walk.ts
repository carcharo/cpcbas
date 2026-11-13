/**
 * Tree walking over the AST (ast/ast.ts): the child list of every node kind and a
 * pre-order walker. The switch over `kind` is exhaustive; adding a kind to ast.ts
 * makes this file fail to compile until the new kind is handled.
 */

import type { CaseTest, Expr, Node, PrintItem } from './ast.js';

function push(out: Node[], ...items: Array<Node | null | undefined>): void {
  for (const it of items) if (it) out.push(it);
}

function caseTestExprs(t: CaseTest): Expr[] {
  switch (t.kind) {
    case 'CaseValue':
      return [t.value];
    case 'CaseRange':
      return [t.from, t.to];
    case 'CaseIs':
      return [t.value];
    default: {
      const _never: never = t;
      return _never;
    }
  }
}

function printItemExprs(it: PrintItem): Expr[] {
  switch (it.kind) {
    case 'PrintExpr':
      return [it.expr];
    case 'PrintSep':
      return [];
    case 'PrintTab':
      return [it.column];
    case 'PrintSpc':
      return [it.count];
    case 'PrintUsing':
      return [it.format];
    case 'PrintAt':
      return [it.row, it.col];
    default: {
      const _never: never = it;
      return _never;
    }
  }
}

/**
 * The direct child nodes of `node`, in source order. Optional parts that are null are
 * left out. Records that are not nodes (IF branches, CASE tests, PRINT items, loop
 * conditions, DEFINT ranges) are looked through: their expressions and bodies are
 * returned as if they were direct children. A TypeRef shared by several declarators of
 * one DIM (`DIM a, b AS UBYTE`) is returned once for each declarator.
 */
export function children(node: Node): Node[] {
  const out: Node[] = [];
  switch (node.kind) {
    case 'Program':
      push(out, ...node.body);
      break;
    // leaves
    case 'NumberLit':
    case 'StringLit':
    case 'Name':
    case 'TypeRef':
    case 'LineTarget':
    case 'LabelTarget':
    case 'BadExpr':
    case 'LineLabel':
    case 'DefType':
    case 'Option':
    case 'Exit':
    case 'Continue':
    case 'OnBreak':
    case 'End':
    case 'Stop':
    case 'Pragma':
    case 'Require':
    case 'Init':
    case 'BadStmt':
    case 'DataValue':
    case 'AsmLine':
      break;
    // expressions
    case 'Unary':
      push(out, node.operand);
      break;
    case 'Binary':
      push(out, node.left, node.right);
      break;
    case 'AddressOf':
      push(out, node.target, ...(node.index ?? []));
      break;
    case 'CallOrIndex':
      push(out, node.callee, ...node.args);
      break;
    case 'BuiltinCall':
      push(out, node.stream, node.typeArg, ...node.args);
      break;
    case 'FnCall':
      push(out, node.name, ...node.args);
      break;
    case 'ArrayInit':
      push(out, ...node.elements);
      break;
    // statements
    case 'Let':
      push(out, node.target, node.value);
      break;
    case 'MidAssign':
      push(out, node.target, node.start, node.length, node.value);
      break;
    case 'Dim':
      push(out, ...node.decls);
      break;
    case 'DimDecl':
      push(out, node.name, ...node.bounds, node.type, node.init, node.at);
      break;
    case 'Const':
      push(out, node.name, node.type, node.value);
      break;
    case 'If':
      for (const b of node.branches) push(out, b.cond, ...b.body);
      if (node.elseBody) push(out, ...node.elseBody);
      break;
    case 'For':
      push(out, node.variable, node.from, node.to, node.step, ...node.body, node.nextName);
      break;
    case 'While':
      push(out, node.cond, ...node.body);
      break;
    case 'DoLoop':
      push(out, node.pre?.expr, ...node.body, node.post?.expr);
      break;
    case 'SelectCase':
      push(out, node.subject, ...node.cases);
      if (node.elseBody) push(out, ...node.elseBody);
      break;
    case 'CaseClause':
      for (const t of node.tests) push(out, ...caseTestExprs(t));
      push(out, ...node.body);
      break;
    case 'Goto':
    case 'Gosub':
      push(out, node.target);
      break;
    case 'Return':
      push(out, node.value);
      break;
    case 'OnGoto':
      push(out, node.selector, ...node.targets);
      break;
    case 'OnError':
      push(out, node.target);
      break;
    case 'Resume':
      push(out, node.target);
      break;
    case 'Error':
      push(out, node.code);
      break;
    case 'EveryAfter':
      push(out, node.interval, node.timer, node.target);
      break;
    case 'Call':
      push(out, node.address, ...node.args);
      break;
    case 'Rsx':
      push(out, ...node.args);
      break;
    case 'SubCall':
      push(out, node.name, ...node.args);
      break;
    case 'Print':
      push(out, node.stream);
      for (const it of node.items) push(out, ...printItemExprs(it));
      break;
    case 'Input':
      push(out, node.stream, node.prompt, ...node.targets);
      break;
    case 'Write':
      push(out, node.stream, ...node.items);
      break;
    case 'Data':
      push(out, ...node.values);
      break;
    case 'Read':
      push(out, ...node.targets);
      break;
    case 'Restore':
      push(out, node.target);
      break;
    case 'Param':
      push(out, node.name, node.type, node.default);
      break;
    case 'Procedure':
      push(out, node.name, ...node.params, node.returnType, ...node.body);
      break;
    case 'Declare':
      push(out, node.name, ...node.params, node.returnType);
      break;
    case 'DefFn':
      push(out, node.name, ...node.params, node.body);
      break;
    case 'Builtin':
      push(out, node.stream, node.typeArg, ...node.args);
      break;
    case 'Asm':
      push(out, ...node.lines);
      break;
    default: {
      const _never: never = node;
      return _never;
    }
  }
  return out;
}

/**
 * Pre-order walk: `visit(node, parent)` is called for `node` and then for each
 * descendant in source order. Returning `false` from `visit` skips that node's children.
 */
export function walk(
  node: Node,
  visit: (node: Node, parent: Node | null) => boolean | void,
  parent: Node | null = null,
): void {
  if (visit(node, parent) === false) return;
  for (const c of children(node)) walk(c, visit, node);
}
