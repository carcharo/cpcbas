import { describe, expect, it } from 'vitest';
import { everyKind, SPAN, arrayInit, assign, bin, idx, label, let_, line, name, num, printStmt, program, span, str, type, un } from '../../test/ast-builders.js';
import { SourceSet } from '../core/source.js';
import type { Node, Stmt } from './ast.js';
import { PRINT_FIELDS, printAst } from './print.js';

const sources = new SourceSet();
sources.add('main.bas', '10 x = 1 + 2\nPRINT x\n');

const dump = (...body: Stmt[]): string => printAst(program(...body), sources);

describe('printAst is stable', () => {
  it('assignments and expressions', () => {
    expect(printAst(assign(bin('+', num(1), bin('*', name('b', '%'), num(2)))), sources)).toMatchInlineSnapshot(`
      "Program mainFile=0
        includes:
        body:
          Let explicitLet=false
            target: Name text="x" base="x" suffix=-
            value: Binary op="+"
              left: NumberLit value=1 text="1" radix=10 isReal=false suffix=-
              right: Binary op="*"
                left: Name text="b" base="b" suffix="%"
                right: NumberLit value=2 text="2" radix=10 isReal=false suffix=-
      "
    `);
  });

  it('control flow: line labels, block IF with null else, FOR with null step', () => {
    const nodes = everyKind();
    const forNode = { ...(nodes.For as Extract<Node, { kind: 'For' }>), step: null, nextName: null, body: [] };
    expect(dump({ kind: 'LineLabel', span: SPAN, number: null, name: 'Start', key: 'start' }, forNode)).toMatchInlineSnapshot(`
      "Program mainFile=0
        includes:
        body:
          LineLabel number=- name="Start" key="start"
          For step=- nextName=-
            variable: Name text="i" base="i" suffix=-
            from: NumberLit value=1 text="1" radix=10 isReal=false suffix=-
            to: NumberLit value=10 text="10" radix=10 isReal=false suffix=-
            body:
      "
    `);
    expect(dump(nodes.If as Stmt)).toContain('Branch\n');
    expect(dump(nodes.DoLoop as Stmt)).toContain('pre: LoopCond until=false\n');
  });

  it('print and input items', () => {
    const p = everyKind().Print as Stmt;
    expect(dump(p, printStmt(str('x')))).toMatchInlineSnapshot(`
      "Program mainFile=0
        includes:
        body:
          Print
            stream: NumberLit value=1 text="1" radix=10 isReal=false suffix=-
            items:
              PrintAt
                row: NumberLit value=1 text="1" radix=10 isReal=false suffix=-
                col: NumberLit value=2 text="2" radix=10 isReal=false suffix=-
              PrintSep sep=";"
              PrintUsing
                format: StringLit value="##"
              PrintSep sep=";"
              PrintTab
                column: NumberLit value=10 text="10" radix=10 isReal=false suffix=-
              PrintSpc
                count: NumberLit value=3 text="3" radix=10 isReal=false suffix=-
              PrintExpr
                expr: Name text="a" base="a" suffix=-
              PrintSep sep=","
          Print stream=-
            items:
              PrintExpr
                expr: StringLit value="x"
      "
    `);
  });

  it('declarations and procedures', () => {
    const k = everyKind();
    expect(dump(k.Dim as Stmt, k.Procedure as Stmt)).toMatchInlineSnapshot(`
      "Program mainFile=0
        includes:
        body:
          Dim
            decls:
              DimDecl init=- at=-
                name: Name text="p" base="p" suffix=-
                bounds:
                type: TypeRef name="UBYTE" text="UBYTE"
              DimDecl init=- at=-
                name: Name text="q" base="q" suffix=-
                bounds:
                  NumberLit value=9 text="9" radix=10 isReal=false suffix=-
                type: TypeRef name="UBYTE" text="UBYTE"
          Procedure procKind="FUNCTION" convention="FASTCALL"
            name: Name text="Twice" base="twice" suffix=-
            params:
              Param passing=- isArray=false
                name: Name text="v" base="v" suffix=-
                type: TypeRef name="INTEGER" text="INTEGER"
                default: NumberLit value=1 text="1" radix=10 isReal=false suffix=-
            returnType: TypeRef name="INTEGER" text="INTEGER"
            body:
              Return
                value: Binary op="*"
                  left: Name text="v" base="v" suffix=-
                  right: NumberLit value=2 text="2" radix=10 isReal=false suffix=-
      "
    `);
  });

  it('jumps, events, built-ins with omitted arguments, ASM and directives', () => {
    const k = everyKind();
    expect(dump(k.OnGoto as Stmt, k.Builtin as Stmt, k.Asm as Stmt, k.Pragma as Stmt, k.BadStmt as Stmt)).toMatchInlineSnapshot(`
      "Program mainFile=0
        includes:
        body:
          OnGoto gosub=true
            selector: Name text="a" base="a" suffix=-
            targets:
              LineTarget number=10
              LabelTarget name="Two" key="two"
          Builtin keyword="SOUND" stream=- typeArg=-
            args:
              NumberLit value=1 text="1" radix=10 isReal=false suffix=-
              NumberLit value=200 text="200" radix=10 isReal=false suffix=-
              -
              NumberLit value=15 text="15" radix=10 isReal=false suffix=-
          Asm
            lines:
              AsmLine text="    ld a, 1"
          Pragma op="set" name="org" value="32768"
          BadStmt
      "
    `);
  });

  it('prints includes and nested array initialisers', () => {
    const prog = {
      ...program(),
      includes: [{ span: SPAN, requested: '"t.bas"', angle: false, once: true, file: null, skipped: false }],
    };
    expect(printAst(prog, sources)).toMatchInlineSnapshot(`
      "Program mainFile=0
        includes:
          Include requested="\\"t.bas\\"" angle=false once=true file=- skipped=false
        body:
      "
    `);
    expect(printAst(arrayInit(num(1), arrayInit(num(2))), sources)).toContain('    ArrayInit\n');
  });
});

describe('printAst spans', () => {
  it('adds @line:col-line:col (end exclusive) to nodes and records, and shows span fields', () => {
    const sp = new SourceSet();
    sp.add('m.bas', 'x = 1\nFOR i = 1 TO 2\nNEXT i\n');
    const target = { ...name('x'), span: span(0, 1) };
    const value = { ...num(1), span: span(4, 5) };
    const stmt = { ...let_(target, value), span: span(0, 5) };
    const forNode = { ...(everyKind().For as Extract<Node, { kind: 'For' }>), span: span(6, 27), nextSpan: span(21, 27), body: [], step: null };
    const prog = { ...program(stmt, forNode), span: span(0, 27) };
    const text = printAst(prog, sp, { spans: true });
    expect(text.split('\n').slice(0, 7)).toEqual([
      'Program mainFile=0 @1:1-3:7',
      '  includes:',
      '  body:',
      '    Let explicitLet=false @1:1-1:6',
      '      target: Name text="x" base="x" suffix=- @1:1-1:2',
      '      value: NumberLit value=1 text="1" radix=10 isReal=false suffix=- @1:5-1:6',
      '    For step=- nextSpan=3:1-3:7 @2:1-3:7',
    ]);
    expect(printAst(prog, sp)).not.toContain('@');
  });
});

describe('printAst determinism', () => {
  it('is the same for the same tree, whatever the order of the object keys', () => {
    const a = let_(name('x'), un('-', num(1)));
    const reordered = Object.fromEntries(Object.entries(a).reverse()) as unknown as Stmt;
    expect(dump(reordered)).toBe(dump(a));
    expect(dump(a)).toBe(dump(a));
  });

  it('has a field list that covers every key of every node kind', () => {
    const set = everyKind();
    for (const [kind, node] of Object.entries(set)) {
      const keys = Object.keys(node).filter((k) => k !== 'kind' && k !== 'span');
      // hardwareAt is optional: absent unless an ENV or ENT has a hardware section.
      const fields = (PRINT_FIELDS as Record<string, readonly string[]>)[kind]!.filter((f) => f !== 'hardwareAt');
      expect(keys.sort(), kind).toEqual([...fields].sort());
    }
  });

  it('prints a label target, a line target and an index expression', () => {
    expect(printAst(idx('a', num(1)), sources)).toBe(
      'CallOrIndex\n  callee: Name text="a" base="a" suffix=-\n  args:\n    NumberLit value=1 text="1" radix=10 isReal=false suffix=-\n',
    );
    expect(printAst(label('L'), sources)).toBe('LabelTarget name="L" key="l"\n');
    expect(printAst(line(5), sources)).toBe('LineTarget number=5\n');
    expect(printAst(type('LONG'), sources)).toBe('TypeRef name="LONG" text="LONG"\n');
  });
});
