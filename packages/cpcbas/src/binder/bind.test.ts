import { describe, expect, it } from 'vitest';
import type { Name } from '../ast/ast.js';
import { walk } from '../ast/walk.js';
import { DiagnosticBag } from '../core/diagnostics.js';
import { SourceSet } from '../core/source.js';
import { runFrontEnd } from '../pipeline.js';
import type { ArraySymbol, BoundProgram, DefFnSymbol, LabelSymbol, ProcedureSymbol, SemSymbol, VariableSymbol } from '../sem/model.js';
import { IMPLEMENTED, bind } from './index.js';

interface Run {
  readonly bound: BoundProgram;
  readonly diag: DiagnosticBag;
  /** `line:col CODE` of every diagnostic. */
  readonly where: string[];
  readonly names: Name[];
}

function run(text: string, opts: { warn?: boolean; bare?: boolean } = {}): Run {
  const sources = new SourceSet();
  const diag = new DiagnosticBag();
  const { program } = runFrontEnd({ files: new Map([['t.bas', text]]), main: 't.bas' }, sources, diag);
  const bound = bind({ program, sources, diagnostics: diag, bareMetal: opts.bare ?? false, ...(opts.warn ? { warnImplicit: true } : {}) });
  const where = diag.all().map((d) => {
    const p = sources.position(d.span.file, d.span.start);
    return `${p.line}:${p.col} ${d.code}`;
  });
  const names: Name[] = [];
  walk(program, (n) => {
    if (n.kind === 'Name') names.push(n);
  });
  return { bound, diag, where, names };
}

const vars = (r: Run): VariableSymbol[] => r.bound.symbols.filter((s): s is VariableSymbol => s.kind === 'variable');
const summary = (r: Run): string[] => vars(r).map((v) => `${v.name}:${v.type}:${v.storage}`);
const find = <K extends SemSymbol['kind']>(r: Run, kind: K, name: string): Extract<SemSymbol, { kind: K }> => {
  const s = r.bound.symbols.find((x) => x.kind === kind && x.name === name);
  if (!s) throw new Error(`no ${kind} ${name}`);
  return s as Extract<SemSymbol, { kind: K }>;
};
/** The symbol a Name occurrence resolved to; `nth` counts occurrences of that spelling in source order. */
const resolved = (r: Run, text: string, nth = 0): SemSymbol => {
  const occ = r.names.filter((n) => n.text + (n.suffix ?? '') === text);
  const n = occ[nth];
  if (!n) throw new Error(`no occurrence ${nth} of ${text}`);
  const id = r.bound.resolutions.names.get(n);
  if (id === undefined) throw new Error(`${text} unresolved`);
  return r.bound.symbols[id] as SemSymbol;
};

describe('binder basics', () => {
  it('is implemented', () => {
    expect(IMPLEMENTED).toBe(true);
  });

  it('default types: a = 1: b$ = "x": c! = 2', () => {
    const r = run('a = 1: b$ = "x": c! = 2');
    expect(summary(r)).toEqual(['a:INTEGER:global', 'b:STRING:global', 'c:REAL:global']);
    expect(r.where).toEqual([]);
    expect(r.bound.globals).toHaveLength(3);
  });

  it('DEFREAL a-c first: a is REAL and a! is the same symbol', () => {
    const r = run('DEFREAL a-c\na = 1\nPRINT a!');
    expect(vars(r)).toHaveLength(1);
    expect(vars(r)[0]).toMatchObject({ name: 'a', type: 'REAL', typeKey: '!' });
    expect(resolved(r, 'a').id).toBe(resolved(r, 'a!').id);
  });

  it('DEFSTR s makes s and s$ one variable', () => {
    const r = run('DEFSTR s\ns = "x"\nPRINT s$');
    expect(vars(r)).toHaveLength(1);
    expect(vars(r)[0]).toMatchObject({ type: 'STRING' });
    expect(resolved(r, 's').id).toBe(resolved(r, 's$').id);
  });

  it('OPTION REAL makes unsuffixed names REAL; DEFINT overrides it', () => {
    const r = run('OPTION REAL\nDEFINT i\nx = 1: i = 2');
    expect(summary(r)).toEqual(['x:REAL:global', 'i:INTEGER:global']);
    expect(r.bound.settings.optionReal).toBe(true);
  });

  it('a, a%, a!, a$ with the default are three symbols (a is a%)', () => {
    const r = run('a = 1: a% = 2: a! = 3: a$ = "x"');
    expect(summary(r)).toEqual(['a:INTEGER:global', 'a:REAL:global', 'a:STRING:global']);
    expect(resolved(r, 'a').id).toBe(resolved(r, 'a%').id);
    expect(vars(r).map((v) => v.label)).toEqual(['_a', '_a__r', '_a__s']);
  });

  it('DIM a AS UBYTE then a% = 1 gives two symbols', () => {
    const r = run('DIM a AS UBYTE\na = 1\na% = 2');
    expect(summary(r)).toEqual(['a:UBYTE:global', 'a:INTEGER:global']);
    expect(resolved(r, 'a', 1).id).toBe(resolved(r, 'a', 0).id);
    expect(resolved(r, 'a%').id).not.toBe(resolved(r, 'a').id);
    expect(vars(r).map((v) => v.label)).toEqual(['_a', '_a__i']);
  });

  it('a DIM below its use is still found (declarations are hoisted)', () => {
    const r = run('a = 1\nDIM a AS UBYTE');
    expect(summary(r)).toEqual(['a:UBYTE:global']);
  });

  it('E203: DIM a$ AS INTEGER, at the name', () => {
    const r = run('DIM a$ AS INTEGER');
    expect(r.where).toEqual(['1:5 E203']);
  });

  it('E202: DIM twice, with the first as related info', () => {
    const r = run('DIM a AS UBYTE\nDIM a AS UBYTE');
    expect(r.where).toEqual(['2:5 E202']);
    expect(r.diag.all()[0]?.related?.[0]?.message).toBe('first declared here');
  });
});

describe('arrays', () => {
  it('DIM a(5): a = 1: a(2) = 3 gives an array and a scalar', () => {
    const r = run('DIM a(5)\na = 1\na(2) = 3');
    const arr = find(r, 'array', 'a');
    expect(arr).toMatchObject({ element: 'INTEGER', storage: 'global', label: '_a__a' });
    expect(arr.bounds).toHaveLength(1);
    expect(find(r, 'variable', 'a').label).toBe('_a');
    const ci = r.bound.resolutions.callOrIndex.values().next().value;
    expect(ci).toBe(arr.id);
    expect(r.where).toEqual([]);
    expect(r.bound.globals).toEqual([arr.id, find(r, 'variable', 'a').id]);
  });

  it('b(1) = 2 without DIM is E204 at b', () => {
    const r = run('b(1) = 2');
    expect(r.where).toEqual(['1:1 E204']);
    expect(r.diag.all()[0]?.hint).toMatch(/DIM/);
  });

  it('reading b(1) without DIM is E204 with the "array or FUNCTION" wording', () => {
    const r = run('x = 0\nx = b(1)');
    expect(r.where).toEqual(['2:5 E204']);
    expect(r.diag.all()[0]?.message).toContain('array or a FUNCTION');
  });

  it('a$ array and a array are different; suffixes select', () => {
    const r = run('DIM a$(3)\nDIM a%(3)\nx$ = a$(1)\ny = a(1)');
    // a$ is STRING, a(1) means the INTEGER array a%
    const strArr = r.bound.symbols.find((s): s is ArraySymbol => s.kind === 'array' && s.element === 'STRING');
    expect(strArr?.label).toBe('_a__s__a');
    expect(r.where).toEqual([]);
  });

  it('E209: more than 4 dimensions', () => {
    const r = run('DIM m(1, 2, 3, 4, 5)');
    expect(r.where).toEqual(['1:5 E209']);
  });

  it('array initialiser and local arrays', () => {
    const r = run('SUB s()\nDIM t(3) AS UBYTE => {1, 2, 3, 4}\nt(0) = 1\nEND SUB');
    const arr = find(r, 'array', 't');
    expect(arr.storage).toBe('local');
    expect(arr.init).not.toBeNull();
    expect(arr.label).toBeNull();
    expect(r.where).toEqual([]);
  });

  it('an array parameter is an array symbol and an array argument resolves to it', () => {
    const r = run('DIM v(3) AS UBYTE\nSUB sum(values() AS UBYTE, n AS INTEGER)\nPRINT values(0)\nEND SUB\nsum v(), 3');
    expect(r.where).toEqual([]);
    const p = find(r, 'array', 'values');
    expect(p.storage).toBe('param');
    expect(r.bound.resolutions.callOrIndex.size).toBe(2);
    expect(resolved(r, 'v')).toMatchObject({ kind: 'array', name: 'v' });
  });
});

describe('scopes', () => {
  it('a SUB written before the main program uses the global n the main program uses later', () => {
    const r = run('SUB bump()\nn = n + 1\nEND SUB\nn = 5\nbump');
    expect(r.where).toEqual([]);
    const globals = vars(r).filter((v) => v.name === 'n');
    expect(globals).toHaveLength(1);
    expect(globals[0]?.storage).toBe('global');
    expect(resolved(r, 'n', 0).id).toBe(globals[0]?.id);
    expect(resolved(r, 'n', 2).id).toBe(globals[0]?.id);
  });

  it('a SUB using k (not in main) gets a local; it is in the procedure frame list', () => {
    const r = run('SUB s()\nk = 1\nPRINT k\nEND SUB\ns');
    const k = find(r, 'variable', 'k');
    expect(k).toMatchObject({ storage: 'local', label: null, declaredBy: 'implicit' });
    const proc = find(r, 'procedure', 's');
    expect(r.bound.locals.get(proc.id)).toEqual([k.id]);
    expect(r.bound.globals).toEqual([]);
  });

  it('parameters shadow globals', () => {
    const r = run('x = 1\nSUB s(x AS UBYTE)\nPRINT x\nEND SUB\ns 2');
    const p = vars(r).find((v) => v.storage === 'param');
    expect(p?.type).toBe('UBYTE');
    expect(resolved(r, 'x', 1)).toBe(p);
    expect(resolved(r, 'x', 0)).toMatchObject({ storage: 'global' });
  });

  it('#pragma explicit then x = 1 is E206 at x (once per variable)', () => {
    const r = run('#pragma explicit\nx = 1\nPRINT x');
    expect(r.where).toEqual(['2:1 E206']);
    expect(r.bound.settings.explicit).toBe(true);
  });

  it('explicit is positional: uses before the pragma are fine; DIM and params satisfy it', () => {
    const r = run('y = 1\n#pragma explicit\nDIM x\nx = 2\nSUB s(p)\nPRINT p\nEND SUB\ns 1');
    expect(r.where).toEqual([]);
  });

  it('under explicit a FOR variable must be declared too', () => {
    expect(run('#pragma explicit\nFOR i = 1 TO 2\nNEXT i').where).toEqual(['2:5 E206']);
  });

  it('W300 only with warnImplicit, once per implicit declaration', () => {
    expect(run('a = 1\na = 2').where).toEqual([]);
    expect(run('a = 1\na = 2', { warn: true }).where).toEqual(['1:1 W300']);
  });

  it('DIM inside a procedure is local and shadows the global; globals keep their own', () => {
    const r = run('DIM n AS UBYTE\nSUB s()\nDIM n AS INTEGER\nn = 1\nEND SUB\nn = 2');
    expect(r.where).toEqual([]);
    expect(resolved(r, 'n', 2)).toMatchObject({ storage: 'local', type: 'INTEGER' });
    expect(resolved(r, 'n', 3)).toMatchObject({ storage: 'global', type: 'UBYTE' });
  });

  it('FOR declares its loop variable and records forVars', () => {
    const r = run('FOR i = 1 TO 3\nPRINT i\nNEXT i');
    const i = find(r, 'variable', 'i');
    expect(i.declaredBy).toBe('for');
    expect([...r.bound.resolutions.forVars.values()]).toEqual([i.id]);
    expect(resolved(r, 'i', 2).id).toBe(i.id);
  });

  it('CONST is found by name and typed names get an identity', () => {
    const r = run('CONST limit = 10\nCONST k% = 2\nPRINT limit\nPRINT k');
    expect(r.where).toEqual([]);
    expect(resolved(r, 'limit', 1)).toMatchObject({ kind: 'const' });
    expect(resolved(r, 'k', 0)).toMatchObject({ kind: 'const', name: 'k' });
  });

  it('E202 for a CONST declared twice', () => {
    expect(run('CONST a = 1\nCONST a = 2').where).toEqual(['2:7 E202']);
  });

  it('DEFINT after a use: W302 at the DEF statement; the variable keeps its type', () => {
    const r = run('a = 1.5\nDEFINT a\nPRINT a');
    expect(r.where).toEqual([]);
    const r2 = run('OPTION REAL\na = 1.5\nDEFINT a\nPRINT a');
    expect(r2.where).toEqual(['3:1 W302', '4:7 W301']);
    // the first a stays REAL; the a after DEFINT is a new INTEGER variable with its own label
    expect(vars(r2).map((v) => [v.type, v.label])).toEqual([
      ['REAL', '_a'],
      ['INTEGER', '_a__i'],
    ]);
  });
});

describe('procedures', () => {
  it('FUNCTION f with f = x * 2 resolves f to resultVar; y = f(3) resolves to the procedure', () => {
    const r = run('FUNCTION f(x) AS INTEGER\nf = x * 2\nEND FUNCTION\ny = f(3)');
    expect(r.where).toEqual([]);
    const f = find(r, 'procedure', 'f');
    expect(f).toMatchObject({ procKind: 'FUNCTION', returnType: 'INTEGER', label: '_f', convention: 'STDCALL' });
    expect(f.resultVar).not.toBeNull();
    expect(resolved(r, 'f', 1).id).toBe(f.resultVar);
    expect([...r.bound.resolutions.callOrIndex.values()]).toEqual([f.id]);
    expect(f.params).toHaveLength(1);
    expect(r.bound.locals.get(f.id)?.[0]).toBe(f.resultVar);
  });

  it('parameter types: declared, suffix, default; BYREF and defaults', () => {
    const r = run('SUB s(a AS UBYTE, b$, BYREF c, d AS INTEGER = 4)\nEND SUB');
    const s = find(r, 'procedure', 's') as ProcedureSymbol;
    expect(s.params.map((p) => [p.type, p.byref])).toEqual([
      ['UBYTE', false],
      ['STRING', false],
      ['INTEGER', true],
      ['INTEGER', false],
    ]);
    expect(s.params[3]?.default).not.toBeNull();
  });

  it('FUNCTION return type by suffix, by DEF range, and a recursive call', () => {
    const r = run('DEFSTR t\nFUNCTION g$(n)\nRETURN g$(n - 1)\nEND FUNCTION\nFUNCTION tt(n)\nRETURN "x"\nEND FUNCTION');
    expect(find(r, 'procedure', 'g').returnType).toBe('STRING');
    expect(find(r, 'procedure', 'tt').returnType).toBe('STRING');
    expect(r.where).toEqual([]);
  });

  it('a SUB statement resolves; a call of an unknown SUB is E205', () => {
    const r = run('SUB hi()\nEND SUB\nhi\nnope 1');
    expect(r.where).toEqual(['4:1 E205']);
    expect([...r.bound.resolutions.subCalls.values()]).toEqual([find(r, 'procedure', 'hi').id]);
  });

  it('FN calls resolve to DEF FN; an unknown FN is E205', () => {
    const r = run('DEF FNdouble(x) = x * 2\nPRINT FNdouble(3)\nPRINT FNtriple(3)');
    expect(r.where).toEqual(['3:9 E205']);
    const d = r.bound.symbols.find((s) => s.kind === 'deffn');
    expect(d).toMatchObject({ kind: 'deffn', returnType: 'INTEGER' });
    expect([...r.bound.resolutions.fnCalls.values()]).toEqual([d?.id]);
  });

  it('a DEF FN body sees its parameters and the globals (never a local)', () => {
    const r = run('DEF FNadd(x) = x + base\nbase = 10\nPRINT FNadd(1)');
    expect(r.where).toEqual([]);
    expect(resolved(r, 'base', 0)).toMatchObject({ storage: 'global' });
    expect(resolved(r, 'x', 1)).toMatchObject({ storage: 'param' });
  });

  it('a DEF FN with a string parameter', () => {
    const r = run('DEF FNn(s$) = LEN(s$)\nPRINT FNn("abc")');
    const d = r.bound.symbols.find((s): s is DefFnSymbol => s.kind === 'deffn');
    expect(r.bound.symbols[d?.params[0] as number]).toMatchObject({ type: 'STRING' });
  });

  it('procedures share one namespace: E202 for a duplicate SUB, E208 for FUNCTION and array', () => {
    expect(run('SUB a()\nEND SUB\nSUB a()\nEND SUB').where).toEqual(['3:5 E202']);
    expect(run('FUNCTION a() AS INTEGER\nRETURN 1\nEND FUNCTION\nDIM a(3)').where).toEqual(['4:5 E208']);
  });

  it('BYREF arguments count as assignments (no W301)', () => {
    const r = run('SUB s(BYREF p)\np = 1\nEND SUB\ns q\nPRINT q');
    expect(r.where).toEqual([]);
  });

  it('a FUNCTION name used without parentheses is a call', () => {
    const r = run('FUNCTION f() AS INTEGER\nRETURN 1\nEND FUNCTION\nx = f');
    expect(resolved(r, 'f', 1)).toMatchObject({ kind: 'procedure' });
  });

  it('W305: a DECLARE with no definition of the same kind, at the DECLARE', () => {
    expect(run('DECLARE SUB s(n)\nPRINT 1').where).toEqual(['1:1 W305']);
    expect(run('DECLARE FUNCTION f(n)\nSUB f(n)\nEND SUB').where).toContain('1:1 W305');
    expect(run('DECLARE SUB s(n)\nSUB s(n)\nEND SUB').where).toEqual([]);
  });

  it('E213: a DECLARE that differs from the definition in count, type, BYREF, array or result, with the definition as related information', () => {
    const bad = [
      'DECLARE SUB s(n)\nSUB s(n, m)\nEND SUB',
      'DECLARE SUB s(n AS UBYTE)\nSUB s(n AS INTEGER)\nEND SUB',
      'DECLARE SUB s(BYREF n AS UBYTE)\nSUB s(n AS UBYTE)\nEND SUB',
      'DECLARE SUB s(n() AS UBYTE)\nSUB s(n AS UBYTE)\nEND SUB',
      'DECLARE FUNCTION f(n) AS UBYTE\nFUNCTION f(n) AS INTEGER\nf = 1\nEND FUNCTION',
    ];
    for (const src of bad) {
      const r = run(src);
      expect(r.where, src).toEqual(['1:1 E213']);
      expect(r.diag.all()[0]?.related, src).toHaveLength(1);
    }
    expect(run('DECLARE FUNCTION f(BYREF n AS UBYTE, m) AS UBYTE\nFUNCTION f(BYREF n AS UBYTE, m) AS UBYTE\nf = 1\nEND FUNCTION').where).toEqual([]);
  });

  it('DECLARE is attached to its procedure', () => {
    const r = run('DECLARE SUB s(n)\nSUB s(n)\nEND SUB');
    expect(find(r, 'procedure', 's').declares).toHaveLength(1);
  });

  it('the procedure order is source order', () => {
    const r = run('SUB b()\nEND SUB\nDEF FNa(x) = x\nSUB c()\nEND SUB');
    expect(r.bound.procedures.map((id) => (r.bound.symbols[id] as SemSymbol).name)).toEqual(['b', 'a', 'c']);
  });
});

describe('procedure names as variables (review R5)', () => {
  it('assigning a FUNCTION name outside its body is E202, not a second _f', () => {
    const r = run('FUNCTION f(x) AS INTEGER\nf = x * 2\nEND FUNCTION\ny = f(3)\nf = 2');
    expect(r.where).toEqual(['5:1 E202']);
    expect(r.diag.all()[0]?.related).toHaveLength(1);
    expect(resolved(r, 'f', 3).kind).toBe('procedure');
    expect(vars(r).filter((v) => v.name === 'f').map((v) => v.storage)).toEqual(['local']);
  });

  it('a FOR over a SUB name is E202', () => {
    expect(run('SUB s\nEND SUB\nFOR s = 1 TO 2: NEXT').where).toEqual(['3:5 E202']);
  });
});

describe('labels, jumps, DATA', () => {
  it('GOTO 100 with no line 100 is E200 at the number, with the nearest line in the hint', () => {
    const r = run('10 GOTO 100\n90 PRINT 1\n120 END');
    expect(r.where).toEqual(['1:9 E200']);
    expect(r.diag.all()[0]?.hint).toContain('90');
  });

  it('an undefined label is E200 with a did-you-mean', () => {
    const r = run('start:\nGOTO strat');
    expect(r.where).toEqual(['2:6 E200']);
    expect(r.diag.all()[0]?.hint).toContain('start');
  });

  it('two lines numbered 100 are the parser\'s E145 only, and jumps go to the first', () => {
    const r = run('100 PRINT 1\n100 PRINT 2\n110 GOTO 100');
    expect(r.where).toEqual(['2:1 E145']);
    expect(r.diag.all()[0]?.related).toHaveLength(1);
    const lab = r.bound.symbols.filter((s) => s.kind === 'label' && s.number === 100);
    expect(lab).toHaveLength(1);
    expect(lab[0]?.span.start).toBe(0);
  });

  it('a duplicate named label is E201 with related info (labels are lower-cased)', () => {
    const r = run('Top:\nPRINT 1\ntop:\nPRINT 2');
    expect(r.where).toEqual(['3:1 E201']);
    expect(r.diag.all()[0]?.related).toHaveLength(1);
  });

  it('jumps resolve to LabelSymbols with their asm label', () => {
    const r = run('10 GOTO 20\n20 GOSUB there\nthere:\nRETURN');
    expect(r.where).toEqual([]);
    const labels = r.bound.symbols.filter((s): s is LabelSymbol => s.kind === 'label');
    expect(labels.map((l) => l.label)).toEqual(['.L.10', '.L.20', '.L.there']);
    expect([...r.bound.resolutions.targets.values()]).toEqual([labels[1]?.id, labels[2]?.id]);
  });

  it('GOTO from main to a label inside a SUB is E207; and out of a SUB', () => {
    const r = run('GOTO inside\nSUB s()\ninside:\nGOTO outside\nEND SUB\noutside:\nEND');
    expect(r.where).toEqual(['1:6 E207', '4:6 E207']);
    expect(run('SUB s()\n10 GOTO 20\n20 PRINT 1\nEND SUB').where).toEqual([]);
  });

  it('ON ... GOTO/GOSUB, ON ERROR GOTO, EVERY and AFTER targets are resolved and checked', () => {
    const r = run('x = 1\n10 ON x GOTO 10, 20\n20 ON ERROR GOTO 30\n30 EVERY 5 GOSUB 99\nON ERROR GOTO 0');
    expect(r.where).toEqual(['4:18 E200']);
  });

  it('DATA is collected in program order, in procedures too', () => {
    const r = run('DATA 1, "a b", c\nSUB s()\nDATA 2\nEND SUB\nDATA 3');
    expect(r.bound.data.items.map((i) => [i.index, i.value.raw, i.value.quoted])).toEqual([
      [0, '1', false],
      [1, 'a b', true],
      [2, 'c', false],
      [3, '2', false],
      [4, '3', false],
    ]);
  });

  it('RESTORE 200 indexes correctly when line 200 has no DATA but line 210 does', () => {
    const r = run('10 DATA 1, 2\n20 RESTORE 200\n30 RESTORE 210\n40 RESTORE 10\n50 RESTORE\n200 PRINT 1\n210 DATA 3\n220 RESTORE 220');
    expect(r.where).toEqual([]);
    const idx = [...r.bound.data.restoreIndex.values()];
    expect(idx).toEqual([2, 2, 0, 3]);
  });

  it('RESTORE to a label before DATA, and to a line past all DATA', () => {
    const r = run('DATA 1\nfirst:\nDATA 2\nRESTORE first\nlast:\nRESTORE last\nRESTORE nowhere');
    expect(r.where).toEqual(['7:9 E200']);
    expect([...r.bound.data.restoreIndex.values()]).toEqual([1, 2]);
  });

  it('RESTORE may name a line inside a SUB', () => {
    const r = run('RESTORE 5\nSUB s()\n5 DATA 9\nEND SUB');
    expect(r.where).toEqual([]);
    expect([...r.bound.data.restoreIndex.values()]).toEqual([0]);
  });
});

describe('settings, requires, inits', () => {
  it('pragmas set the settings; hidata = 0 turns it off', () => {
    const r = run('#pragma org = &4000\n#pragma heap_size = 2048\n#pragma heap_address = 0x9000\n#pragma hidata = &A000\n#pragma explicit');
    expect(r.where).toEqual([]);
    expect(r.bound.settings).toEqual({ explicit: true, optionReal: false, org: 0x4000, heapSize: 2048, heapAddress: 0x9000, hidata: 0xa000 });
    const off = run('#pragma hidata = &A000\n#pragma hidata = 0');
    expect(off.bound.settings.hidata).toBeNull();
  });

  it('push and pop restore the previous value; pop without push is E212', () => {
    const r = run('#pragma org = 100\n#pragma push(org)\n#pragma org = 200\n#pragma pop(org)');
    expect(r.bound.settings.org).toBe(100);
    expect(run('#pragma pop(org)').where).toEqual(['1:1 E212']);
  });

  it('bad values are E211', () => {
    expect(run('#pragma org = banana').where).toEqual(['1:1 E211']);
    expect(run('#pragma heap_size = 70000').where).toEqual(['1:1 E211']);
    expect(run('#pragma org').where).toEqual(['1:1 E211']);
    expect(run('#pragma explicit = maybe').where).toEqual(['1:1 E211']);
  });

  it('an unknown pragma is a warning; case_insensitive is accepted', () => {
    expect(run('#pragma shiny = 1').where).toEqual(['1:1 W303']);
    expect(run('#pragma case_insensitive = true').where).toEqual([]);
  });

  it('#require inside a SUB records the procedure as owner; #init is recorded', () => {
    const r = run('#require "a.asm"\nSUB s()\n#require "b.asm"\nEND SUB\n#init Boot\nASM\nBoot:\n ret\nEND ASM');
    const s = find(r, 'procedure', 's');
    expect(r.bound.requires.map((q) => [q.path, q.owner])).toEqual([
      ['a.asm', null],
      ['b.asm', s.id],
    ]);
    expect(r.bound.inits.map((i) => i.label)).toEqual(['Boot']);
  });

  it('bareMetal is passed through and refuses nothing', () => {
    const r = run('PRINT 1', { bare: true });
    expect(r.bound.bareMetal).toBe(true);
    expect(r.where).toEqual([]);
  });
});

describe('warnings and labels in asm', () => {
  it('W301: read but never assigned, at the first read', () => {
    const r = run('PRINT x\nPRINT x');
    expect(r.where).toEqual(['1:7 W301']);
  });

  it('W301 names a variable with the suffix it was written with', () => {
    expect(run('PRINT x!').diag.all()[0]?.message).toBe("'x!' is read but never assigned");
    expect(run('PRINT n%').diag.all()[0]?.message).toBe("'n%' is read but never assigned");
    expect(run('PRINT t$').diag.all()[0]?.message).toBe("'t$' is read but never assigned");
    expect(run('PRINT x').diag.all()[0]?.message).toBe("'x' is read but never assigned");
  });

  it('E210 names the variables with their suffixes', () => {
    expect(run('score$ = "a"\nscore__s = 2').diag.all()[0]?.message).toMatch(/^'score__s' and 'score\$' both give/);
  });

  it('W301 not for assigned, FOR, INPUT/READ targets, @x, DIM with an initialiser or AT', () => {
    const r = run('a = 1: PRINT a\nINPUT b: PRINT b\nREAD c$: PRINT c$\nPRINT @d\nDIM e = 1: PRINT e\nDIM f AS UBYTE AT 100: PRINT f');
    expect(r.where).toEqual([]);
  });

  it('E210: a name containing __ that collides with a compiler label', () => {
    const clash = run('b% = 1\nb__i = 2');
    expect(clash.where).toEqual(['2:1 E210']);
    expect(clash.diag.all()[0]?.related).toHaveLength(1);
  });

  it('two identities of one name never clash: REAL a and INTEGER a get different labels', () => {
    const r = run('DEFREAL a\na = 1\nDEFINT a\nb = a');
    expect(r.where.filter((w) => w.endsWith('E210'))).toEqual([]);
  });
});

describe('other uses', () => {
  it('@ resolves arrays, variables, procedures and labels without declaring anything', () => {
    const r = run('DIM buf(9) AS UBYTE\nx = 1\nSUB s()\nEND SUB\nhere:\nPRINT @buf, @x, @s, @here');
    expect(r.where).toEqual([]);
    const kinds = r.names.filter((n) => ['buf', 'x', 's', 'here'].includes(n.text)).map((n) => r.bound.symbols[r.bound.resolutions.names.get(n) as number]?.kind);
    expect(kinds).toEqual(['array', 'variable', 'procedure', 'array', 'variable', 'procedure', 'label']);
    expect(vars(r)).toHaveLength(1);
  });

  it('UBOUND names an array; SAVE keeps its file-type letter out of the variables', () => {
    const r = run('DIM a(4)\nPRINT UBOUND(a)\nSAVE "f", B, 100, 20');
    expect(r.where).toEqual([]);
    expect(vars(r)).toHaveLength(0);
    expect(run('PRINT UBOUND(zz)').where).toEqual(['1:14 E204']);
  });

  it('FN parameters are not visible outside; a global read in a DEF FN stays global', () => {
    const r = run('DEF FNf(p) = p + 1\nPRINT p');
    expect(vars(r).filter((v) => v.storage === 'global')).toHaveLength(1);
  });
});

describe('robustness', () => {
  it('binding the same program twice gives equal symbol arrays', () => {
    const sources = new SourceSet();
    const d0 = new DiagnosticBag();
    const text = 'DIM a(3)\nx = a(1)\nSUB s(p)\nk = p\nEND SUB\n10 GOTO 10\nDATA 1';
    const { program } = runFrontEnd({ files: new Map([['t.bas', text]]), main: 't.bas' }, sources, d0);
    const one = bind({ program, sources, diagnostics: new DiagnosticBag(), bareMetal: false });
    const two = bind({ program, sources, diagnostics: new DiagnosticBag(), bareMetal: false });
    expect(two.symbols).toEqual(one.symbols);
    expect(two.scopes).toEqual(one.scopes);
  });

  it('never throws on broken input', () => {
    for (const text of ['FOR', 'DIM', 'x = (', 'SUB', 'GOTO', 'DEF FN', 'a(1)(2) = 3', 'IF THEN', 'DATA', '@', 'DIM a(']) {
      expect(() => run(text)).not.toThrow();
    }
  });
});

describe('built-in firmware constants', () => {
  const consts = (r: Run): SemSymbol[] => r.bound.symbols.filter((s) => s.kind === 'const');

  it('CALL KM_WAIT_KEY binds to a UINTEGER constant 0xBB18 with no diagnostic', () => {
    const r = run('CALL KM_WAIT_KEY');
    expect(r.where).toEqual([]);
    const c = find(r, 'const', 'KM_WAIT_KEY');
    expect(c.declaredType).toBe('UINTEGER');
    expect(c.value).toMatchObject({ kind: 'NumberLit', value: 0xbb18, radix: 16 });
    expect(vars(r)).toEqual([]);
    expect(resolved(r, 'KM_WAIT_KEY').id).toBe(c.id);
  });

  it('matches in any case, and one shared constant serves every use', () => {
    const r = run('x% = txt_output\ny% = TXT_Output\nCALL Txt_Output');
    expect(r.where).toEqual([]);
    expect(consts(r)).toHaveLength(1);
    expect(find(r, 'const', 'TXT_OUTPUT').span.start).toBeLessThan(20);
  });

  it('reads inside a procedure resolve to the same global constant', () => {
    const r = run('SUB s()\n  CALL SCR_SET_MODE\nEND SUB\nCALL scr_set_mode');
    expect(r.where).toEqual([]);
    const c = find(r, 'const', 'SCR_SET_MODE');
    expect(c.scope).toBe(r.bound.scopes[0]?.id);
    expect(consts(r)).toHaveLength(1);
  });

  it('DIM km_wait_key: the user variable wins, W304 once', () => {
    const r = run('DIM km_wait_key AS INTEGER\nCALL km_wait_key');
    expect(r.where).toEqual(['1:5 W304', '2:6 W301']);
    expect(consts(r)).toEqual([]);
    expect(summary(r)).toEqual(['km_wait_key:INTEGER:global']);
    expect(resolved(r, 'km_wait_key', 1).kind).toBe('variable');
  });

  it('an assignment makes an ordinary variable, with W304', () => {
    const r = run('KM_WAIT_KEY = 5\nPRINT KM_WAIT_KEY');
    expect(r.where).toEqual(['1:1 W304']);
    expect(consts(r)).toEqual([]);
    expect(vars(r)).toHaveLength(1);
  });

  it('a user CONST, SUB or array of the same name wins with W304', () => {
    expect(run('CONST KM_WAIT_KEY = 1\nPRINT KM_WAIT_KEY').where).toEqual(['1:7 W304']);
    expect(run('SUB TXT_OUTPUT()\nEND SUB\nTXT_OUTPUT').where).toEqual(['1:5 W304']);
    expect(run('DIM gra_plot_absolute(3)\ngra_plot_absolute(1) = 2').where).toEqual(['1:5 W304']);
  });

  it('suffixed names and ordinary names are not firmware entries', () => {
    const r = run('km_wait_key% = 1\nPRINT km_wait_key%\nkm_wait_keys = 2\nPRINT km_wait_keys');
    expect(r.where).toEqual([]);
    expect(consts(r)).toEqual([]);
  });

  it('the indirections carry the IND_ prefix and a 6128-only entry is still a constant', () => {
    const r = run('CALL IND_TXT_DRAW_CURSOR\nCALL KL_BANK_SWITCH');
    expect(r.where).toEqual([]);
    expect(find(r, 'const', 'IND_TXT_DRAW_CURSOR').value).toMatchObject({ value: 0xbdcd });
    expect(find(r, 'const', 'KL_BANK_SWITCH').value).toMatchObject({ value: 0xbd5b });
  });
});
