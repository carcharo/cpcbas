/**
 * The unparser: turns an AST back into CPC BASIC source.
 *
 * Layout: keywords in canonical upper case, one statement per line, two spaces of
 * indentation per block, `:` only inside a single-line IF. Line numbers, labels,
 * `#` directives and the lines of an ASM block start in column 0 (a line number or label
 * must be the first token of its line; asm lines are raw text).
 *
 * Parentheses are added only where operator precedence needs them (spec section 5,
 * all binary operators left-associative):
 *
 *   ^   >  unary - +   >  * /  >  \  >  MOD  >  + -  >  << >>  >  comparisons  >  NOT  >  AND  >  OR  >  XOR
 *
 * Spellings that the AST keeps (type names as written, number text, `LET`, `GOTO` for
 * an implicit jump outside IF) are kept, so `parse(unparse(parse(x)))` equals `parse(x)`
 * up to spans.
 */

import type {
  ArrayInit,
  AsmLine,
  BinaryOp,
  CaseClause,
  CaseTest,
  DataValue,
  DimDecl,
  Expr,
  JumpTarget,
  LValue,
  Name,
  Node,
  Param,
  PrintItem,
  Program,
  Stmt,
  TypeRef,
} from './ast.js';

const PREC_PRIMARY = 14;
const PREC_POWER = 13;
const PREC_SIGN = 12;
const PREC_NOT = 5;

const BINARY_PREC: Record<BinaryOp, number> = {
  '^': PREC_POWER,
  '*': 11,
  '/': 11,
  '\\': 10,
  MOD: 9,
  '+': 8,
  '-': 8,
  '<<': 7,
  '>>': 7,
  '=': 6,
  '<>': 6,
  '<': 6,
  '>': 6,
  '<=': 6,
  '>=': 6,
  AND: 4,
  OR: 3,
  XOR: 2,
};

function prec(e: Expr): number {
  switch (e.kind) {
    case 'Binary':
      return BINARY_PREC[e.op];
    case 'Unary':
      return e.op === 'NOT' ? PREC_NOT : PREC_SIGN;
    default:
      return PREC_PRIMARY;
  }
}

function paren(text: string, wrap: boolean): string {
  return wrap ? `(${text})` : text;
}

function quote(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

function nameText(n: Name): string {
  return n.text + (n.suffix ?? '');
}

function list(items: readonly Expr[]): string {
  return items.map(expr).join(', ');
}

/** An expression as source text. */
export function unparseExpr(e: Expr): string {
  return expr(e);
}

function expr(e: Expr): string {
  switch (e.kind) {
    case 'NumberLit':
      return e.text;
    case 'StringLit':
      return quote(e.value);
    case 'Name':
      return nameText(e);
    case 'Unary': {
      const inner = e.operand;
      if (e.op === 'NOT') return `NOT ${paren(expr(inner), prec(inner) < PREC_NOT)}`;
      const nestedSign = inner.kind === 'Unary' && inner.op !== 'NOT';
      return `${e.op}${paren(expr(inner), prec(inner) < PREC_SIGN || nestedSign)}`;
    }
    case 'Binary': {
      const p = BINARY_PREC[e.op];
      const l = paren(expr(e.left), prec(e.left) < p);
      const r = paren(expr(e.right), prec(e.right) <= p);
      return `${l} ${e.op} ${r}`;
    }
    case 'AddressOf':
      return e.index === undefined ? `@${nameText(e.target)}` : `@${nameText(e.target)}(${list(e.index)})`;
    case 'CallOrIndex':
      return `${nameText(e.callee)}(${list(e.args)})`;
    case 'BuiltinCall': {
      if (!e.parens) return e.keyword;
      const parts: string[] = [];
      if (e.typeArg) parts.push(typeText(e.typeArg));
      if (e.stream) parts.push(`#${expr(e.stream)}`);
      for (const a of e.args) parts.push(expr(a));
      return `${e.keyword}(${parts.join(', ')})`;
    }
    case 'FnCall':
      return `FN ${nameText(e.name)}${e.args.length > 0 ? `(${list(e.args)})` : ''}`;
    case 'BadExpr':
      return '<bad>';
    default: {
      const _never: never = e;
      return _never;
    }
  }
}

function typeText(t: TypeRef): string {
  return t.text;
}

function targetText(t: JumpTarget): string {
  return t.kind === 'LineTarget' ? String(t.number) : t.name;
}

function lvalue(v: LValue): string {
  return expr(v);
}

function arrayInit(a: ArrayInit): string {
  return `{${a.elements.map((el) => (el.kind === 'ArrayInit' ? arrayInit(el) : expr(el))).join(', ')}}`;
}

function declText(d: DimDecl, withType: boolean): string {
  let s = nameText(d.name);
  if (d.bounds.length > 0) s += `(${list(d.bounds)})`;
  if (withType && d.type) s += ` AS ${typeText(d.type)}`;
  if (d.init) s += d.init.kind === 'ArrayInit' ? ` => ${arrayInit(d.init)}` : ` = ${expr(d.init)}`;
  if (d.at) s += ` AT ${expr(d.at)}`;
  return s;
}

/** `DIM a, b AS UBYTE` shares one TypeRef: print the type once, on the last declarator of the group. */
function dimText(decls: readonly DimDecl[]): string {
  const parts = decls.map((d, i) => {
    const next = decls[i + 1];
    const sharedWithNext = d.type !== null && next !== undefined && next.type === d.type && !d.init && !d.at;
    return declText(d, !sharedWithNext);
  });
  return `DIM ${parts.join(', ')}`;
}

function paramText(p: Param): string {
  let s = '';
  if (p.passing) s += `${p.passing} `;
  s += nameText(p.name);
  if (p.isArray) s += '()';
  if (p.type) s += ` AS ${typeText(p.type)}`;
  if (p.default) s += ` = ${expr(p.default)}`;
  return s;
}

function printItems(items: readonly PrintItem[]): string {
  let out = '';
  for (const it of items) {
    switch (it.kind) {
      case 'PrintSep':
        out += it.sep;
        continue;
      case 'PrintExpr':
        out += ` ${expr(it.expr)}`;
        break;
      case 'PrintTab':
        out += ` TAB(${expr(it.column)})`;
        break;
      case 'PrintSpc':
        out += ` SPC(${expr(it.count)})`;
        break;
      case 'PrintUsing':
        out += ` USING ${expr(it.format)}`;
        break;
      case 'PrintAt':
        out += ` AT ${expr(it.row)}, ${expr(it.col)}`;
        break;
      default: {
        const _never: never = it;
        return _never;
      }
    }
  }
  return out;
}

function caseTestText(t: CaseTest): string {
  switch (t.kind) {
    case 'CaseValue':
      return expr(t.value);
    case 'CaseRange':
      return `${expr(t.from)} TO ${expr(t.to)}`;
    case 'CaseIs':
      return `IS ${t.op} ${expr(t.value)}`;
    default: {
      const _never: never = t;
      return _never;
    }
  }
}

function dataValueText(v: DataValue): string {
  return v.quoted ? quote(v.raw) : v.raw;
}

function indent(level: number): string {
  return '  '.repeat(level);
}

function block(body: readonly Stmt[], level: number): string[] {
  return body.flatMap((s) => stmtLines(s, level));
}

/** Statements of a single-line IF branch, joined with `:`. */
function inlineBody(body: readonly Stmt[]): string {
  const only = body.length === 1 ? body[0] : undefined;
  if (only && only.kind === 'Goto' && only.implicit) return targetText(only.target);
  return body.map((s) => stmtLines(s, 0).join(' : ')).join(' : ');
}

function builtinArgs(stream: Expr | null, typeArg: TypeRef | null, args: ReadonlyArray<Expr | null>, hardwareAt: readonly number[] = []): string {
  const parts: string[] = [];
  if (stream) parts.push(`#${expr(stream)}`);
  if (typeArg) parts.push(typeText(typeArg));
  args.forEach((a, i) => parts.push((hardwareAt.includes(i) ? '=' : '') + (a ? expr(a) : '')));
  return parts.join(', ');
}

function withArgs(head: string, args: string): string {
  return args === '' ? head : `${head} ${args}`;
}

function procHeader(
  word: 'SUB' | 'FUNCTION',
  convention: string | null,
  name: Name,
  params: readonly Param[],
  returnType: TypeRef | null,
): string {
  let s = word;
  if (convention) s += ` ${convention}`;
  s += ` ${nameText(name)}(${params.map(paramText).join(', ')})`;
  if (returnType) s += ` AS ${typeText(returnType)}`;
  return s;
}

function stmtLines(s: Stmt, level: number): string[] {
  const ind = indent(level);
  const one = (text: string): string[] => [ind + text];
  switch (s.kind) {
    case 'LineLabel':
      return [s.number !== null ? String(s.number) : `${s.name ?? ''}:`];
    case 'Let':
      return one(`${s.explicitLet ? 'LET ' : ''}${lvalue(s.target)} = ${expr(s.value)}`);
    case 'MidAssign': {
      const args = [lvalue(s.target), expr(s.start)];
      if (s.length) args.push(expr(s.length));
      return one(`MID$(${args.join(', ')}) = ${expr(s.value)}`);
    }
    case 'Dim':
      return one(dimText(s.decls));
    case 'Const':
      return one(`CONST ${nameText(s.name)}${s.type ? ` AS ${typeText(s.type)}` : ''} = ${expr(s.value)}`);
    case 'DefType': {
      const word = s.type === 'INTEGER' ? 'DEFINT' : s.type === 'REAL' ? 'DEFREAL' : 'DEFSTR';
      const ranges = s.ranges.map((r) => (r.from === r.to ? r.from : `${r.from}-${r.to}`));
      return one(`${word} ${ranges.join(', ')}`);
    }
    case 'Option':
      return one(`OPTION ${s.name}`);
    case 'If': {
      if (s.form === 'line') {
        const first = s.branches[0];
        let text = `IF ${first ? expr(first.cond) : ''} THEN ${first ? inlineBody(first.body) : ''}`;
        if (s.elseBody) text += ` ELSE ${inlineBody(s.elseBody)}`;
        return one(text);
      }
      const out: string[] = [];
      s.branches.forEach((b, i) => {
        out.push(`${ind}${i === 0 ? 'IF' : 'ELSEIF'} ${expr(b.cond)} THEN`);
        out.push(...block(b.body, level + 1));
      });
      if (s.elseBody) {
        out.push(`${ind}ELSE`);
        out.push(...block(s.elseBody, level + 1));
      }
      out.push(`${ind}END IF`);
      return out;
    }
    case 'For': {
      let head = `FOR ${nameText(s.variable)} = ${expr(s.from)} TO ${expr(s.to)}`;
      if (s.step) head += ` STEP ${expr(s.step)}`;
      return [ind + head, ...block(s.body, level + 1), `${ind}NEXT${s.nextName ? ` ${nameText(s.nextName)}` : ''}`];
    }
    case 'While':
      return [`${ind}WHILE ${expr(s.cond)}`, ...block(s.body, level + 1), `${ind}WEND`];
    case 'DoLoop': {
      const cond = (c: { until: boolean; expr: Expr }): string => ` ${c.until ? 'UNTIL' : 'WHILE'} ${expr(c.expr)}`;
      return [`${ind}DO${s.pre ? cond(s.pre) : ''}`, ...block(s.body, level + 1), `${ind}LOOP${s.post ? cond(s.post) : ''}`];
    }
    case 'SelectCase': {
      const out = [`${ind}SELECT CASE ${expr(s.subject)}`];
      for (const c of s.cases) out.push(...caseLines(c, level + 1));
      if (s.elseBody) {
        out.push(`${indent(level + 1)}CASE ELSE`);
        out.push(...block(s.elseBody, level + 2));
      }
      out.push(`${ind}END SELECT`);
      return out;
    }
    case 'Exit':
      return one(`EXIT ${s.target}`);
    case 'Continue':
      return one(`CONTINUE ${s.target}`);
    case 'Goto':
      return one(`GOTO ${targetText(s.target)}`);
    case 'Gosub':
      return one(`GOSUB ${targetText(s.target)}`);
    case 'Return':
      return one(s.value ? `RETURN ${expr(s.value)}` : 'RETURN');
    case 'OnGoto':
      return one(`ON ${expr(s.selector)} ${s.gosub ? 'GOSUB' : 'GOTO'} ${s.targets.map(targetText).join(', ')}`);
    case 'OnBreak':
      return one(`ON BREAK ${s.action}`);
    case 'OnError':
      return one(`ON ERROR GOTO ${s.target ? targetText(s.target) : '0'}`);
    case 'Resume':
      return one(s.mode === 'same' ? 'RESUME' : s.mode === 'next' ? 'RESUME NEXT' : `RESUME ${s.target ? targetText(s.target) : '0'}`);
    case 'Error':
      return one(`ERROR ${expr(s.code)}`);
    case 'End':
      return one('END');
    case 'Stop':
      return one('STOP');
    case 'EveryAfter':
      return one(
        `${s.every ? 'EVERY' : 'AFTER'} ${expr(s.interval)}${s.timer ? `, ${expr(s.timer)}` : ''} GOSUB ${targetText(s.target)}`,
      );
    case 'Call':
      return one(withArgs('CALL', [expr(s.address), ...s.args.map(expr)].join(', ')));
    case 'Rsx':
      return one(`|${s.name}${s.args.length > 0 ? `, ${list(s.args)}` : ''}`);
    case 'SubCall':
      return one(s.parens ? `${nameText(s.name)}(${list(s.args)})` : withArgs(nameText(s.name), list(s.args)));
    case 'Print': {
      const head = s.stream ? `PRINT #${expr(s.stream)}${s.items.length > 0 ? ',' : ''}` : 'PRINT';
      return one(head + printItems(s.items));
    }
    case 'Input': {
      let text = s.line ? 'LINE INPUT' : 'INPUT';
      if (s.stream) text += ` #${expr(s.stream)},`;
      if (s.keepCursor) text += ' ;';
      if (s.prompt) text += ` ${quote(s.prompt.value)}${s.promptSep ?? ';'}`;
      if (s.targets.length > 0) text += ` ${s.targets.map(lvalue).join(', ')}`;
      return one(text);
    }
    case 'Write': {
      const head = s.stream ? `WRITE #${expr(s.stream)}${s.items.length > 0 ? ',' : ''}` : 'WRITE';
      return one(withArgs(head, list(s.items)));
    }
    case 'Data':
      return one(withArgs('DATA', s.values.map(dataValueText).join(', ')));
    case 'Read':
      return one(`READ ${s.targets.map(lvalue).join(', ')}`);
    case 'Restore':
      return one(withArgs('RESTORE', s.target ? targetText(s.target) : ''));
    case 'Procedure':
      return [
        ind + procHeader(s.procKind, s.convention, s.name, s.params, s.returnType),
        ...block(s.body, level + 1),
        `${ind}END ${s.procKind}`,
      ];
    case 'Declare':
      return one(`DECLARE ${procHeader(s.procKind, s.convention, s.name, s.params, s.returnType)}`);
    case 'DefFn':
      return one(
        `DEF FN ${nameText(s.name)}${s.params.length > 0 ? `(${s.params.map(nameText).join(', ')})` : ''} = ${expr(s.body)}`,
      );
    case 'Builtin':
      return one(withArgs(s.keyword, builtinArgs(s.stream, s.typeArg, s.args, s.hardwareAt)));
    case 'Asm':
      return ['ASM', ...s.lines.map((l) => l.text), 'END ASM'].map((t, i) => (i === 0 ? ind + t : t));
    case 'Pragma': {
      switch (s.op) {
        case 'set':
          return [`#pragma ${s.name} = ${s.value ?? ''}`];
        case 'flag':
          return [`#pragma ${s.name}`];
        case 'push':
          return [`#pragma push(${s.name})`];
        case 'pop':
          return [`#pragma pop(${s.name})`];
        default: {
          const _never: never = s.op;
          return _never;
        }
      }
    }
    case 'Require':
      return [`#require ${quote(s.path)}`];
    case 'Init':
      return [`#init ${s.label}`];
    case 'BadStmt':
      return one('REM <bad statement>');
    default: {
      const _never: never = s;
      return _never;
    }
  }
}

function caseLines(c: CaseClause, level: number): string[] {
  return [`${indent(level)}CASE ${c.tests.map(caseTestText).join(', ')}`, ...block(c.body, level + 1)];
}

/** The program as CPC BASIC source, ending with a newline (empty for an empty program). */
export function unparse(program: Program): string {
  const lines = block(program.body, 0);
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

/** Any node as source text: a statement as its lines (no trailing newline), a fragment (parameter, declarator, DATA item) as it is written. */
export function unparseNode(node: Node): string {
  switch (node.kind) {
    case 'Program':
      return unparse(node).replace(/\n$/, '');
    case 'NumberLit':
    case 'StringLit':
    case 'Name':
    case 'Unary':
    case 'Binary':
    case 'AddressOf':
    case 'CallOrIndex':
    case 'BuiltinCall':
    case 'FnCall':
    case 'BadExpr':
      return expr(node);
    case 'TypeRef':
      return typeText(node);
    case 'LineTarget':
    case 'LabelTarget':
      return targetText(node);
    case 'ArrayInit':
      return arrayInit(node);
    case 'DimDecl':
      return declText(node, true);
    case 'CaseClause':
      return caseLines(node, 0).join('\n');
    case 'Param':
      return paramText(node);
    case 'DataValue':
      return dataValueText(node);
    case 'AsmLine':
      return (node satisfies AsmLine).text;
    default:
      return stmtLines(node, 0).join('\n');
  }
}
