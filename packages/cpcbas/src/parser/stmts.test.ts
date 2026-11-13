import { describe, expect, it } from 'vitest';
import { parseSource, parseSourceRaw, sexp, stmtsOf } from '../../test/parse-helpers.js';
import type { BuiltinStmt, Expr, PrintStmt, Stmt } from '../ast/ast.js';
import { unparse } from '../ast/unparse.js';
import { KEYWORDS } from '../lang/keywords.js';
import { statementParsers } from './stmts.js';

function only<K extends Stmt['kind']>(text: string, kind: K): Extract<Stmt, { kind: K }> {
  const p = parseSource(text);
  expect(p.where).toEqual([]);
  const s = p.program.body.filter((x) => x.kind !== 'LineLabel');
  expect(s).toHaveLength(1);
  expect(s[0]?.kind).toBe(kind);
  return s[0] as Extract<Stmt, { kind: K }>;
}

const opt = (e: Expr | null): string => (e ? sexp(e) : '_');

/** The items of a PRINT as a short text: `a`, `;`, `AT(1 2)`, `TAB(3)`, `USING("##")`. */
function items(s: PrintStmt): string[] {
  return s.items.map((i) => {
    switch (i.kind) {
      case 'PrintExpr':
        return sexp(i.expr);
      case 'PrintSep':
        return i.sep;
      case 'PrintTab':
        return `TAB(${sexp(i.column)})`;
      case 'PrintSpc':
        return `SPC(${sexp(i.count)})`;
      case 'PrintUsing':
        return `USING(${sexp(i.format)})`;
      case 'PrintAt':
        return `AT(${sexp(i.row)} ${sexp(i.col)})`;
    }
  });
}

describe('Locomotive forms', () => {
  it('INPUT ; and LINE INPUT ; keep the cursor', () => {
    const a = only('INPUT ; "p"; v', 'Input');
    expect(a.keepCursor).toBe(true);
    expect(a.prompt?.value).toBe('p');
    expect(only('LINE INPUT ; k$', 'Input').keepCursor).toBe(true);
    expect(only('INPUT #1, ; a', 'Input').keepCursor).toBe(true);
    expect(only('INPUT "p"; v', 'Input').keepCursor).toBe(false);
    expect(unparse(parseSource('INPUT ; "p"; v').program).trim()).toBe('INPUT ; "p"; v');
  });
  it('ENV and ENT take hardware sections mixed with software ones', () => {
    const a = only('ENV 1, 10, 1, 5, =10, 300', 'Builtin');
    expect(a.args.map(opt)).toEqual(['1', '10', '1', '5', '10', '300']);
    expect(a.hardwareAt).toEqual([4]);
    expect(only('ENT 1, =200, 20', 'Builtin').hardwareAt).toEqual([1]);
    expect(only('ENT 1, 5, 3, 2', 'Builtin').hardwareAt).toBeUndefined();
    expect(unparse(parseSource('ENV 2, =8, 500').program).trim()).toBe('ENV 2, =8, 500');
    expect(parseSource('ENV 1, =').where).toEqual(['1:9 E142']);
  });
  it('PEN takes an optional mode; PAPER stays at one ink', () => {
    expect(only('PEN 1, 1', 'Builtin').args.map(opt)).toEqual(['1', '1']);
    expect(only('PEN , 1', 'Builtin').args.map(opt)).toEqual(['_', '1']);
    expect(only('PEN #1, 2, 0', 'Builtin').args.map(opt)).toEqual(['2', '0']);
    expect(parseSource('PEN').where).toEqual(['1:1 E147']);
    expect(parseSource('PEN 1, 2, 3').where).toEqual(['1:1 E147']);
    expect(parseSource('PAPER 1, 1').where).toEqual(['1:1 E147']);
  });
  it('WIDTH, SPEED WRITE and DERR are built-ins; MIN and MAX take one argument', () => {
    expect(only('WIDTH 80', 'Builtin').keyword).toBe('WIDTH');
    expect(only('SPEED WRITE 1', 'Builtin').keyword).toBe('SPEED WRITE');
    expect(parseSource('x = DERR').where).toEqual([]);
    expect(parseSource('x = MAX(1) + MIN(2)').where).toEqual([]);
    expect(parseSource('x = MAX()').where).toEqual(['1:5 E147']);
  });
  it('ON SQ and ON BREAK GOSUB are E981 with one diagnostic', () => {
    for (const src of ['ON SQ(1) GOSUB 500', 'ON BREAK GOSUB 500']) {
      const p = parseSource(src);
      expect(p.where, src).toEqual(['1:1 E981']);
      expect(p.diag.all()[0]?.hint, src).toBeTruthy();
    }
    expect(parseSource('ON SQ(1) GOTO 10, 20').where).toEqual([]);
  });
  it('RUN and the E980 hint read correctly', () => {
    expect(parseSource('RUN').diag.all()[0]?.message).toBe('RUN is not in 1.0: use GOTO to restart at a line, or LOAD and CALL to start another part');
    expect(parseSource('AUTO').diag.all()[0]?.hint).toContain('works in the interpreter only');
  });
});

describe('PRINT', () => {
  it('a bare PRINT has no items', () => {
    const s = only('PRINT', 'Print');
    expect(s.items).toEqual([]);
    expect(s.stream).toBeNull();
  });
  it('keeps items and separators in order, with the trailing one', () => {
    expect(items(only('PRINT "a"; 1, x;', 'Print'))).toEqual(['"a"', ';', '1', ',', 'x', ';']);
    expect(items(only('PRINT ; ;', 'Print'))).toEqual([';', ';']);
  });
  it('? is PRINT', () => {
    expect(items(only('? x; y', 'Print'))).toEqual(['x', ';', 'y']);
    expect(only('?', 'Print').items).toEqual([]);
  });
  it('a stream, with and without items', () => {
    const s = only('PRINT #2, a$; x', 'Print');
    expect(s.stream && sexp(s.stream)).toBe('2');
    expect(items(s)).toEqual(['a$', ';', 'x']);
    expect(only('PRINT #1,', 'Print').items).toEqual([]);
    expect(only('PRINT #1', 'Print').stream).not.toBeNull();
    expect(only('PRINT #n + 1, "x"', 'Print').stream && sexp(only('PRINT #n + 1, "x"', 'Print').stream as Expr)).toBe('(+ n 1)');
  });
  it('AT (Sinclair alias) is an item and the ; after it is a separator', () => {
    expect(items(only('PRINT AT 3, 5; "at"', 'Print'))).toEqual(['AT(3 5)', ';', '"at"']);
    expect(items(only('PRINT #1, AT y + 1, x; "s"', 'Print'))).toEqual(['AT((+ y 1) x)', ';', '"s"']);
  });
  it('USING takes the format and leaves the ; as a separator', () => {
    expect(items(only('PRINT USING "###.##"; 3.14159', 'Print'))).toEqual(['USING("###.##")', ';', '3.14159']);
    expect(items(only('PRINT #1, USING "##"; n', 'Print'))).toEqual(['USING("##")', ';', 'n']);
    expect(items(only('PRINT USING "&"; a$;', 'Print'))).toEqual(['USING("&")', ';', 'a$', ';']);
  });
  it('TAB and SPC are items, and need no separator after them', () => {
    expect(items(only('PRINT TAB(10); "t"; SPC(5)', 'Print'))).toEqual(['TAB(10)', ';', '"t"', ';', 'SPC(5)']);
    expect(items(only('PRINT TAB(5) "x"', 'Print'))).toEqual(['TAB(5)', '"x"']);
    expect(items(only('PRINT SPC(a + 1) x', 'Print'))).toEqual(['SPC((+ a 1))', 'x']);
  });
  it('TAB and SPC need a parenthesis', () => {
    expect(parseSource('PRINT TAB 5').where).toEqual(['1:11 E141']);
    expect(parseSource('PRINT TAB(5').where).toEqual(['1:10 E143']);
  });
  it('TAB outside PRINT is E146 from the expression parser', () => {
    expect(parseSource('x = TAB(3)').where).toEqual(['1:5 E146']);
  });
  it('expressions, unary minus and functions', () => {
    expect(items(only('PRINT -x; (x + 1) * 2; LEFT$(a$, 2)', 'Print'))).toEqual(['(u- x)', ';', '(* (+ x 1) 2)', ';', '(LEFT$ a$ 2)']);
  });
  it('items with no separator are adjacent items, with no PrintSep between them', () => {
    expect(parseSource('PRINT 1 2').where).toEqual([]);
    expect(items(only('PRINT a "is less than" b', 'Print'))).toEqual(['a', '"is less than"', 'b']);
    expect(items(only('PRINT "x" a; "y" b$', 'Print'))).toEqual(['"x"', 'a', ';', '"y"', 'b$']);
    expect(parseSource('PRINT 1 )').where).toEqual(['1:9 E144']);
  });
  it('a bad item is one error and the statement is a BadStmt', () => {
    const p = parseSource('PRINT 1; ); 2\nx = 1');
    expect(p.codes).toHaveLength(1);
    expect(p.program.body.map((s) => s.kind)).toEqual(['BadStmt', 'Let']);
  });
  it('round-trips through unparse', () => {
    const p = parseSource('PRINT #1, AT 2, 3; USING "##"; x, TAB(4) y;');
    expect(p.where).toEqual([]);
    const text = unparse(p.program);
    expect(parseSource(text).codes).toEqual([]);
    expect(unparse(parseSource(text).program)).toBe(text);
  });
});

describe('INPUT and LINE INPUT', () => {
  it('plain targets', () => {
    const s = only('INPUT a, b$, c(2)', 'Input');
    expect(s.line).toBe(false);
    expect(s.prompt).toBeNull();
    expect(s.promptSep).toBeNull();
    expect(s.targets.map((t) => (t.kind === 'Name' ? t.text + (t.suffix ?? '') : 'elem'))).toEqual(['a', 'b$', 'elem']);
  });
  it('prompt with ; or ,', () => {
    const a = only('INPUT "Name"; n$', 'Input');
    expect([a.prompt?.value, a.promptSep]).toEqual(['Name', ';']);
    const b = only('INPUT "Age", age', 'Input');
    expect([b.prompt?.value, b.promptSep]).toEqual(['Age', ',']);
  });
  it('a stream', () => {
    const s = only('INPUT #9, c, d$', 'Input');
    expect(s.stream && sexp(s.stream)).toBe('9');
    expect(s.targets).toHaveLength(2);
    const t = only('LINE INPUT #9, row$', 'Input');
    expect(t.line).toBe(true);
    expect(t.stream && sexp(t.stream)).toBe('9');
  });
  it('LINE INPUT, with and without a prompt', () => {
    expect(only('LINE INPUT a$', 'Input').line).toBe(true);
    const s = only('LINE INPUT "Text: "; t$', 'Input');
    expect([s.line, s.prompt?.value, s.promptSep]).toEqual([true, 'Text: ', ';']);
    expect(only('LINE INPUT "Text: ", t$', 'Input').promptSep).toBe(',');
  });
  it('errors: no variable, LINE without INPUT, two LINE INPUT targets', () => {
    expect(parseSource('INPUT').where).toEqual(['1:6 E150']);
    expect(parseSource('INPUT "x"').where).toEqual(['1:7 E150']);
    expect(parseSource('INPUT 3').where).toEqual(['1:7 E150']);
    expect(parseSource('LINE a$').where).toEqual(['1:6 E141']);
    expect(parseSource('LINE INPUT a$, b$').where).toEqual(['1:16 E190']);
  });
});

describe('DATA, READ, RESTORE', () => {
  it('DATA items are raw, quoted ones are marked', () => {
    const s = only('DATA 120, "quoted, with comma", plain text , &HFF', 'Data');
    expect(s.values.map((v) => [v.raw, v.quoted])).toEqual([
      ['120', false],
      ['quoted, with comma', true],
      ['plain text', false],
      ['&HFF', false],
    ]);
  });
  it('a bare DATA and empty items', () => {
    expect(only('DATA', 'Data').values.map((v) => v.raw)).toEqual(['']);
    expect(only('DATA 1,,2,', 'Data').values.map((v) => v.raw)).toEqual(['1', '', '2', '']);
  });
  it('DATA stops at the colon', () => {
    const p = parseSource('DATA 1, 2 : PRINT 3');
    expect(p.where).toEqual([]);
    expect(p.program.body.map((s) => s.kind)).toEqual(['Data', 'Print']);
  });
  it('DATA value spans point at the item text', () => {
    const p = parseSource('DATA 12, "ab"');
    const s = p.program.body[0];
    expect(s?.kind === 'Data' && s.values.map((v) => p.sources.text(v.span))).toEqual(['12', '"ab"']);
  });
  it('READ takes variables and elements', () => {
    const s = only('READ w$, v, scores(i), u!', 'Read');
    expect(s.targets).toHaveLength(4);
    expect(parseSource('READ').where).toEqual(['1:5 E150']);
    expect(parseSource('READ 1').where).toEqual(['1:6 E150']);
  });
  it('RESTORE with no target, a line and a label', () => {
    expect(only('RESTORE', 'Restore').target).toBeNull();
    expect(only('RESTORE 900', 'Restore').target).toMatchObject({ kind: 'LineTarget', number: 900 });
    expect(only('RESTORE Names', 'Restore').target).toMatchObject({ kind: 'LabelTarget', key: 'names' });
    expect(parseSource('RESTORE "x"').where).toEqual(['1:9 E148']);
  });
});

describe('MID$ as a statement', () => {
  it('with and without a length', () => {
    const a = only('MID$(m$, 2, 3) = "xyz"', 'MidAssign');
    expect([sexp(a.target), sexp(a.start), opt(a.length), sexp(a.value)]).toEqual(['m$', '2', '3', '"xyz"']);
    const b = only('MID$(m$, 5) = "q"', 'MidAssign');
    expect(b.length).toBeNull();
  });
  it('an array element as the target', () => {
    const a = only('MID$(t$(i), 1, 1) = c$', 'MidAssign');
    expect(a.target.kind).toBe('CallOrIndex');
  });
  it('wrong argument count is E147 at MID$, with the statement syntax', () => {
    const p = parseSource('MID$(a$) = "x"');
    expect(p.where).toEqual(['1:1 E147']);
    expect(p.diag.all()[0]?.hint).toContain('MID$(a$, p [, n]) = b$');
    expect(parseSource('MID$(a$, 1, 2, 3) = "x"').where).toEqual(['1:1 E147']);
  });
  it('needs = after the parenthesis', () => {
    expect(parseSource('MID$(a$, 1)').where).toEqual(['1:12 E141']);
    expect(parseSource('MID$(a$, 1 = "x"').codes).toHaveLength(1);
  });
  it('MID$ stays a function inside expressions', () => {
    expect(only('b$ = MID$(a$, 2, 3)', 'Let').value.kind).toBe('BuiltinCall');
  });
});

describe('CALL and RSX', () => {
  it('CALL with no parameters, with parameters, with @ and strings', () => {
    const a = only('CALL &BB18', 'Call');
    expect([sexp(a.address), a.args.length]).toEqual(['&BB18', 0]);
    const b = only('CALL &8000, 1, 2, @buf, "text"', 'Call');
    expect(b.args.map(sexp)).toEqual(['1', '2', '(@ buf)', '"text"']);
    expect(only('CALL KM_WAIT_KEY', 'Call').address.kind).toBe('Name');
    expect(only('CALL @Handler', 'Call').address.kind).toBe('AddressOf');
  });
  it('CALL needs an address', () => {
    expect(parseSource('CALL').where).toEqual(['1:5 E142']);
    expect(parseSource('CALL 1,').where).toEqual(['1:8 E142']);
  });
  it('CALL and RSX take up to 32 parameters', () => {
    const ok = Array.from({ length: 32 }, (_, i) => i).join(', ');
    expect(parseSource(`CALL &8000, ${ok}`).where).toEqual([]);
    expect(parseSource(`CALL &8000, ${ok}, 1`).where).toEqual(['1:1 E185']);
    expect(parseSource(`|X, ${ok}, 1`).where).toEqual(['1:1 E185']);
    expect(parseSource(`|X, ${ok}`).where).toEqual([]);
  });
  it('RSX commands, with and without parameters', () => {
    const a = only('|DISC', 'Rsx');
    expect([a.name, a.args.length]).toEqual(['DISC', 0]);
    const b = only('|ren, "new.bas", "old.bas"', 'Rsx');
    expect([b.name, b.args.map(sexp)]).toEqual(['REN', ['"new.bas"', '"old.bas"']]);
    const p = parseSource('|A : |B\nPRINT 1 : |DIR');
    expect(p.where).toEqual([]);
    expect(p.program.body.map((s) => s.kind)).toEqual(['Rsx', 'Rsx', 'Print', 'Rsx']);
  });
  it('an RSX with a dangling comma is an error', () => {
    expect(parseSource('|DIR,').where).toEqual(['1:6 E142']);
    expect(parseSource('|DIR 1').where).toEqual(['1:6 E144']);
  });
});

const BUILTINS = KEYWORDS.filter((k) => k.kind === 'statement' && k.form === 'builtin');

/** Sample source for an entry with `n` arguments. */
function sample(e: (typeof BUILTINS)[number], n: number, extra = ''): string {
  const args = Array.from({ length: n }, (_, i) => String(i + 1)).join(', ');
  return `${e.name} ${extra}${extra !== '' && n > 0 ? ', ' : ''}${args}`.trim();
}

describe('built-in statements (table-driven)', () => {
  it('the table has an entry per first word of every built-in statement', () => {
    for (const e of BUILTINS) expect(Object.keys(statementParsers)).toContain(e.name.split(' ')[0]);
  });

  describe('every builtin statement entry parses at min and max args', () => {
    for (const e of BUILTINS) {
      const min = e.args?.min ?? 0;
      const max = Number.isFinite(e.args?.max) ? (e.args?.max as number) : min + 3;
      for (const n of [...new Set([min, max])]) {
        it(`${e.name} with ${n} argument${n === 1 ? '' : 's'}`, () => {
          const text = sample(e, n);
          const p = parseSource(text);
          expect(p.where, text).toEqual([]);
          const s = p.program.body[0] as BuiltinStmt;
          expect(s.kind).toBe('Builtin');
          expect(s.keyword).toBe(e.name);
          expect(s.args).toHaveLength(n);
          expect(s.stream).toBeNull();
          expect(s.typeArg).toBeNull();
          expect(p.program.body).toHaveLength(1);
        });
        if (e.stream) {
          it(`${e.name} with a stream and ${n} argument${n === 1 ? '' : 's'}`, () => {
            const text = sample(e, n, '#2');
            const p = parseSource(text);
            expect(p.where, text).toEqual([]);
            const s = p.program.body[0] as BuiltinStmt;
            expect(s.stream && sexp(s.stream)).toBe('2');
            expect(s.args).toHaveLength(n);
          });
        }
        if (e.typeArg) {
          it(`${e.name} with a type and ${n} argument${n === 1 ? '' : 's'}`, () => {
            const text = sample(e, n, 'UINTEGER');
            const p = parseSource(text);
            expect(p.where, text).toEqual([]);
            const s = p.program.body[0] as BuiltinStmt;
            expect(s.typeArg?.name).toBe('UINTEGER');
            expect(s.args).toHaveLength(n);
          });
        }
      }
    }
  });

  describe('too many and too few args at the right column', () => {
    for (const e of BUILTINS) {
      const min = e.args?.min ?? 0;
      const max = e.args?.max ?? 0;
      if (min > 0) {
        it(`${e.name} with ${min - 1} argument(s)`, () => {
          const text = `x = 1 : ${sample(e, min - 1)}`;
          const p = parseSource(text);
          // INK with one argument is the Spectrum form: its own error.
          expect(p.where).toEqual([`1:9 ${e.name === 'INK' && min === 2 ? 'E901' : 'E147'}`]);
        });
      }
      if (Number.isFinite(max)) {
        it(`${e.name} with ${max + 1} arguments`, () => {
          const text = `x = 1 : ${sample(e, max + 1)}`;
          expect(parseSource(text).where).toEqual(['1:9 E147']);
        });
      }
    }
    it('the message names the count and the hint is the syntax', () => {
      const p = parseSource('MODE 1, 2');
      expect(p.diag.all()[0]?.message).toBe('MODE takes 1 argument, 2 given');
      expect(p.diag.all()[0]?.hint).toBe('Syntax: MODE n');
      expect(parseSource('SYMBOL 1').diag.all()[0]?.message).toBe('SYMBOL takes 2 to 9 arguments, 1 given');
    });
    it('a multi-word head reports at its first word', () => {
      expect(parseSource('  GRAPHICS PEN 1, 2, 3').where).toEqual(['1:3 E147']);
      expect(parseSource('WINDOW SWAP').where).toEqual(['1:1 E147']);
    });
  });

  it('multi-word heads are matched longest first', () => {
    const kw = (t: string): string => (only(t, 'Builtin') as BuiltinStmt).keyword;
    expect(kw('GRAPHICS PEN 1')).toBe('GRAPHICS PEN');
    expect(kw('GRAPHICS PAPER 1')).toBe('GRAPHICS PAPER');
    expect(kw('SPEED INK 1, 2')).toBe('SPEED INK');
    expect(kw('SPEED KEY 1, 2')).toBe('SPEED KEY');
    expect(kw('CLEAR INPUT')).toBe('CLEAR INPUT');
    expect(kw('KEY DEF 1, 2')).toBe('KEY DEF');
    expect(kw('KEY 1, "text"')).toBe('KEY');
    expect(kw('WINDOW SWAP 0, 1')).toBe('WINDOW SWAP');
    expect(kw('WINDOW 1, 2, 3, 4')).toBe('WINDOW');
    expect(kw('SYMBOL AFTER 240')).toBe('SYMBOL AFTER');
    expect(kw('SYMBOL 240, 1, 2')).toBe('SYMBOL');
  });
  it('SPEED and GRAPHICS need their second word', () => {
    expect(parseSource('SPEED 5').where).toEqual(['1:7 E141']);
    expect(parseSource('GRAPHICS 1').where).toEqual(['1:10 E141']);
  });

  it('a stream is optional and takes a comma', () => {
    const s = only('PEN #1, 2', 'Builtin');
    expect([s.stream && sexp(s.stream), s.args.map(opt)]).toEqual(['1', ['2']]);
    expect(only('PEN 2', 'Builtin').stream).toBeNull();
    expect(only('CLS #3', 'Builtin').stream).not.toBeNull();
    expect(only('CLS', 'Builtin').args).toEqual([]);
    expect(parseSource('PEN #1 2').where).toEqual(['1:8 E141']);
    expect(parseSource('PEN #1').where).toEqual(['1:1 E147']);
  });
  it('a type argument takes a comma (POKE type, address, value)', () => {
    const s = only('POKE UINTEGER, a, 1234', 'Builtin');
    expect([s.typeArg?.name, s.args.map(opt)]).toEqual(['UINTEGER', ['a', '1234']]);
    expect(only('POKE a + 1, 5', 'Builtin').typeArg).toBeNull();
    expect(parseSource('POKE UINTEGER a, 1').where).toEqual(['1:15 E141']);
    expect(parseSource('POKE FLOAT, 1, 2').codes).toEqual([]);
  });
  it('empty arguments are null where the entry allows them', () => {
    expect(only('SOUND 1, 200, , 15', 'Builtin').args.map(opt)).toEqual(['1', '200', '_', '15']);
    expect(only('GRAPHICS PEN , 1', 'Builtin').args.map(opt)).toEqual(['_', '1']);
    expect(only('GRAPHICS PEN', 'Builtin').args).toEqual([]);
    expect(only('GRAPHICS PEN 2', 'Builtin').args.map(opt)).toEqual(['2']);
    expect(only('PLOT 10, 20, , 1', 'Builtin').args.map(opt)).toEqual(['10', '20', '_', '1']);
    expect(only('MASK , 1', 'Builtin').args.map(opt)).toEqual(['_', '1']);
  });
  it('an empty required argument is E142 at the empty slot', () => {
    expect(parseSource('PLOT , 5').where).toEqual(['1:6 E142']);
    expect(parseSource('SOUND 1, , 5').where).toEqual(['1:10 E142']);
  });
  it('entries without emptyArgs reject an empty argument', () => {
    expect(parseSource('LOCATE 1, ').where).toEqual(['1:11 E142']);
    expect(parseSource('LOCATE , 1').where).toEqual(['1:8 E142']);
  });
  it('INK with one argument is E901 with the PEN hint, at INK', () => {
    const p = parseSource('INK 2');
    expect(p.where).toEqual(['1:1 E901']);
    expect(p.diag.all()[0]?.hint).toContain('PEN n');
    expect(parseSource('INK 1, 2').codes).toEqual([]);
    expect(parseSource('INK').codes).toEqual(['E147']);
  });
  it('Sinclair aliases that are kept parse as built-ins', () => {
    expect(only('BEEP 0.5, 12', 'Builtin').keyword).toBe('BEEP');
    expect(only('PAUSE 50', 'Builtin').keyword).toBe('PAUSE');
    expect(only('CIRCLE 100, 100, 30', 'Builtin').keyword).toBe('CIRCLE');
    expect(only('PAPER 0', 'Builtin').keyword).toBe('PAPER');
    expect(only('BORDER 1', 'Builtin').keyword).toBe('BORDER');
  });
  it('expressions in arguments, and SAVE with the bare type letter', () => {
    expect(only('PLOT x + 1, y * 2', 'Builtin').args.map(opt)).toEqual(['(+ x 1)', '(* y 2)']);
    expect(only('SAVE "name", B, &4000, 100', 'Builtin').args.map(opt)).toEqual(['"name"', 'B', '&4000', '100']);
  });
  it('an error in an argument is one diagnostic and a BadStmt', () => {
    const p = parseSource('PLOT 1, (2\nMODE 1');
    expect(p.codes).toEqual(['E143']);
    expect(p.program.body.map((s) => s.kind)).toEqual(['BadStmt', 'Builtin']);
  });
  it('round-trips through unparse', () => {
    const src = 'PEN #1, 2\nSOUND 1, 200, , 15\nPOKE UINTEGER, a, 5\nGRAPHICS PEN , 1\nCLS #2\n';
    const p = parseSource(src);
    expect(p.where).toEqual([]);
    const text = unparse(p.program);
    const q = parseSource(text);
    expect(q.codes).toEqual([]);
    expect(unparse(q.program)).toBe(text);
  });
});

describe('soft words stay identifiers when assigned', () => {
  for (const w of ['list', 'new', 'auto', 'over', 'inverse', 'bold', 'type', 'private', 'flash', 'tron']) {
    it(`${w} = 3 is an assignment`, () => {
      const p = parseSource(`${w} = 3`);
      expect(p.where).toEqual([]);
      expect(p.program.body[0]?.kind).toBe('Let');
    });
  }
  it('an element of an array named like a soft word is an assignment', () => {
    for (const w of ['over', 'list', 'bold']) {
      const p = parseSource(`${w}(1) = 2\n${w}(f(1), 2) = 3`);
      expect(p.where).toEqual([]);
      expect(p.program.body.map((s) => s.kind)).toEqual(['Let', 'Let']);
    }
  });
  it('a soft word as a name inside an expression', () => {
    expect(parseSource('x = list + over').where).toEqual([]);
  });
});

describe('compatibility diagnostics', () => {
  it('dropped Sinclair statements: E900 at the word, with the entry hint', () => {
    for (const [w, hint] of [
      ['OVER 1', 'GRAPHICS PEN n, 1'],
      ['INVERSE 1', 'Swap PEN and PAPER'],
      ['FLASH 1', 'INK n, c1, c2'],
      ['BRIGHT 1', 'brighter INK'],
      ['BOLD 1', 'Not available'],
      ['ITALIC 1', 'Not available'],
    ] as const) {
      const p = parseSource(`x = 1 : ${w}`);
      expect(p.where, w).toEqual(['1:9 E900']);
      expect(p.diag.all()[0]?.hint, w).toContain(hint);
    }
  });
  it('lower case works the same, and the rest of the line is skipped', () => {
    const p = parseSource('over 1, 2\nx = 1');
    expect(p.where).toEqual(['1:1 E900']);
    expect(p.program.body.map((s) => s.kind)).toEqual(['BadStmt', 'Let']);
  });
  it('interpreter commands: E980', () => {
    for (const w of ['AUTO 100, 10', 'DELETE 10-50', 'EDIT 120', 'LIST 10-20', 'NEW', 'RENUM 10, 10', 'CONT', 'TRON', 'TROFF']) {
      const p = parseSource(w);
      expect(p.where, w).toEqual(['1:1 E980']);
      expect(p.diag.all()[0]?.message).toContain('not applicable in a compiled program');
      expect(p.diag.all()[0]?.hint).toContain('Remove it');
    }
  });
  it('statements that are not in 1.0: E981', () => {
    for (const w of ['ERASE a', 'CURSOR 1', 'CLEAR', 'MERGE "lib"', 'RUN "game"', 'CHAIN MERGE "lib"', 'CHAIN "next", 200']) {
      const p = parseSource(w);
      expect(p.where, w).toEqual(['1:1 E981']);
    }
    expect(parseSource('CLEAR').diag.all()[0]?.message).toBe('CLEAR is not in 1.0');
    // The hint is an alternative, not a restatement of the message.
    for (const [w, text] of [['ERASE a', 'reuse the array'], ['CURSOR 1', 'cursor character'], ['CLEAR', 'local DIMs'], ['CHAIN "n", 5', 'loads another program'], ['MERGE "m"', '#include']] as const) {
      const hint = parseSource(w).diag.all()[0]?.hint ?? '';
      expect(hint, w).toContain(text);
      expect(hint, w).not.toContain('not in 1.0');
    }
  });
  it('the files (L4-FILES): OPENOUT, CLOSEOUT, WRITE and CHAIN "name" parse; WRITE takes , or ; between items and refuses a separator with nothing after it (E191)', () => {
    for (const w of ['OPENOUT "file"', 'CLOSEOUT', 'WRITE #9, a', 'WRITE', 'WRITE #9', 'WRITE 1; 2, "x"', 'CHAIN "next"']) expect(parseSource(w).where, w).toEqual([]);
    expect(parseSource('WRITE 1,').where).toEqual(['1:8 E191']);
    expect(parseSource('WRITE #9, "a";').where).toEqual(['1:14 E191']);
    const w = only('WRITE #9, a, "b" ; 3', 'Write');
    expect(w.stream && sexp(w.stream)).toBe('9');
    expect(w.items.map(sexp)).toEqual(['a', '"b"', '3']);
    expect(only('WRITE', 'Write').items).toEqual([]);
    const c = only('CHAIN "next"', 'Builtin');
    expect(c.keyword).toBe('CHAIN');
  });
  it('RESUME is left to the control-flow task', () => {
    expect(Object.keys(statementParsers)).not.toContain('RESUME');
  });
});

describe('ASM blocks', () => {
  it('lines are kept as written, with their spans', () => {
    const src = 'ASM\n  ld a, 1\nloop:\n  djnz loop\nEND ASM\nPRINT 1';
    const p = parseSource(src);
    expect(p.where).toEqual([]);
    const a = p.program.body[0];
    expect(a?.kind).toBe('Asm');
    if (a?.kind !== 'Asm') return;
    expect(a.lines.map((l) => l.text)).toEqual(['  ld a, 1', 'loop:', '  djnz loop']);
    expect(a.lines.map((l) => p.sources.text(l.span))).toEqual(['  ld a, 1', 'loop:', '  djnz loop']);
    expect(a.lines.map((l) => p.sources.position(l.span.file, l.span.start).line)).toEqual([2, 3, 4]);
    expect(p.sources.text(a.span)).toBe(src.slice(0, src.indexOf('PRINT') - 1));
    expect(p.program.body.map((s) => s.kind)).toEqual(['Asm', 'Print']);
  });
  it('an empty block and a block inside text', () => {
    expect(only('ASM\nEND ASM', 'Asm').lines).toEqual([]);
    const p = parseSource('x = 1\nASM\n nop ; comment \' quote\nEND ASM\nx = 2');
    expect(p.where).toEqual([]);
    expect(p.program.body.map((s) => s.kind)).toEqual(['Let', 'Asm', 'Let']);
  });
  it('END ASM may be in lower case', () => {
    expect(only('asm\n nop\nend asm', 'Asm').lines).toHaveLength(1);
  });
  it('an unclosed block gets only the lexer error E106', () => {
    expect(parseSource('PRINT 1\nASM\n  nop\n  ret').codes).toEqual(['E106']);
  });
  it('a directive inside a block is E186 (no place for it in the tree yet); #line is dropped silently', () => {
    expect(parseSource('ASM\n  nop\n#require "x.asm"\n  ret\nEND ASM').where).toEqual(['3:1 E186']);
    expect(parseSource('ASM\n#init go\nEND ASM').diag.all()[0]?.message).toBe('#init inside an ASM block is not supported');
    const p = parseSource('ASM\n  nop\n#line 10\n  ret\nEND ASM');
    expect(p.where).toEqual([]);
    expect((p.program.body[0] as { lines: unknown[] }).lines).toHaveLength(2);
  });
  it('round-trips through unparse', () => {
    const p = parseSource('ASM\n  ld a, 1\n  ret\nEND ASM');
    expect(unparse(p.program)).toBe('ASM\n  ld a, 1\n  ret\nEND ASM\n');
  });
});

describe('directives', () => {
  it('pragma shapes', () => {
    const shape = (t: string): [string, string, string | null] => {
      const s = only(t, 'Pragma');
      return [s.op, s.name, s.value];
    };
    expect(shape('#pragma org = &4000')).toEqual(['set', 'org', '&4000']);
    expect(shape('#pragma heap_size=2048')).toEqual(['set', 'heap_size', '2048']);
    expect(shape('#pragma HEAP_ADDRESS = &9000')).toEqual(['set', 'heap_address', '&9000']);
    expect(shape('#pragma explicit')).toEqual(['flag', 'explicit', null]);
    expect(shape('#pragma explicit = true')).toEqual(['set', 'explicit', 'true']);
    expect(shape('#pragma push(explicit)')).toEqual(['push', 'explicit', null]);
    expect(shape('#pragma pop( explicit )')).toEqual(['pop', 'explicit', null]);
    expect(shape('#pragma hidata = 0')).toEqual(['set', 'hidata', '0']);
    expect(shape("#pragma org = &4000 ' the start")).toEqual(['set', 'org', '&4000']);
  });
  it('a pragma node covers the directive line', () => {
    const p = parseSource('PRINT 1\n#pragma org = 1\nPRINT 2');
    expect(p.where).toEqual([]);
    expect(p.program.body.map((s) => s.kind)).toEqual(['Print', 'Pragma', 'Print']);
    expect(p.sources.text(p.program.body[1]?.span as never)).toBe('#pragma org = 1');
  });
  it('malformed pragmas are E187 and zxnext is E188', () => {
    expect(parseSourceRaw('#pragma').where).toEqual(['1:1 E187']);
    expect(parseSourceRaw('#pragma = 3').where).toEqual(['1:1 E187']);
    expect(parseSourceRaw('#pragma org =').where).toEqual(['1:1 E187']);
    expect(parseSourceRaw('#pragma zxnext = true').where).toEqual(['1:1 E188']);
    expect(parseSourceRaw('#pragma zxnext').where).toEqual(['1:1 E188']);
  });
  it('#require and #init', () => {
    expect(only('#require "extra.asm"', 'Require').path).toBe('extra.asm');
    expect(only('#init Startup', 'Init').label).toBe('Startup');
    expect(only('#init .core.start', 'Init').label).toBe('.core.start');
    expect(parseSourceRaw('#require extra').where).toEqual(['1:1 E187']);
    expect(parseSourceRaw('#init').where).toEqual(['1:1 E187']);
    expect(parseSourceRaw('#init 1 2').where).toEqual(['1:1 E187']);
  });
  it('#line in BASIC source is a warning and has no other effect', () => {
    const p = parseSource('PRINT 1\n#line 20 "x.bas"\nPRINT 2');
    expect(p.where).toEqual(['2:1 W189']);
    expect(p.diag.hasErrors).toBe(false);
    expect(p.program.body.filter((s) => s.kind === 'Print')).toHaveLength(2);
    // No node at all (R23): no BadStmt that a later stage could take for an error.
    expect(p.program.body.map((s) => s.kind)).toEqual(['Print', 'Print']);
  });
  it('directive forms round-trip through unparse', () => {
    const src = '#pragma org = &4000\n#pragma explicit\n#pragma push(explicit)\n#pragma pop(explicit)\n#require "a.asm"\n#init go\n';
    const p = parseSource(src);
    expect(p.where).toEqual([]);
    expect(unparse(p.program)).toBe(src);
  });
});

describe('robustness', () => {
  const inputs = [
    'PRINT #', 'PRINT AT', 'PRINT AT 1', 'PRINT USING', 'PRINT TAB(', 'INPUT #', 'LINE', 'LINE INPUT', 'DATA "', 'READ a,', 'RESTORE ,',
    'MID$', 'MID$(', 'MID$(a$', 'MID$(a$,', 'CALL (', '|', '|X,', 'POKE', 'POKE UBYTE', 'POKE UBYTE,', 'PEN #', 'PEN #1,', 'GRAPHICS',
    'SPEED', 'KEY DEF', 'ASM', 'ASM\nEND', '#pragma push(', '#pragma pop()', '#require "', '#init (', 'CLEAR INPUT 1', 'TYPE', 'PRIVATE',
    'WINDOW SWAP ,', 'SOUND , , ,', 'SYMBOL 1,2,3,4,5,6,7,8,9,10', '? ? ?', 'PRINT ,,;;', 'x = LIST', 'LIST', 'END ASM',
  ];
  for (const text of inputs) {
    it(`does not throw on ${JSON.stringify(text)} and reports at most one error per statement`, () => {
      const p = parseSource(text);
      expect(p.codes.filter((c) => c.startsWith('E')).length).toBeLessThanOrEqual(p.program.body.filter((s) => s.kind === 'BadStmt').length + 1);
      expect(p.codes).not.toContain('E001');
    });
  }
  it('stmtsOf sees the nodes of a mixed program', () => {
    expect(stmtsOf('PRINT 1 : PEN 2 : DATA 3 : READ a').map((s) => s.kind)).toEqual(['Print', 'Builtin', 'Data', 'Read']);
  });
});
