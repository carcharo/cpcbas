/**
 * L4-0: the statement-boundary hooks (boundary.ts). They are called once per `stmt` quad, right after
 * it, in the main program and in procedures, and once after every statement of a list; for a program
 * without EVERY/AFTER or ON ERROR they emit nothing (the stubs never do).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Stmt } from '../../ast/ast.js';
import type { Quad } from '../ir.js';
import { lowerSource } from '../../../test/compile-helper.js';
import { setBoundaryProbe } from './boundary.js';
import type { LowerCtx } from './context.js';

interface Seen {
  readonly kind: Stmt['kind'];
  readonly inProc: boolean;
  /** The last quad of the body when the start hooks had run. */
  readonly last: Quad | undefined;
}

function observe(source: string): { starts: Seen[]; ends: Stmt['kind'][]; stmtQuads: number; problems: readonly unknown[] } {
  const starts: Seen[] = [];
  const ends: Stmt['kind'][] = [];
  setBoundaryProbe({
    start: (ctx: LowerCtx, s: Stmt) => starts.push({ kind: s.kind, inProc: ctx.procExit !== null, last: ctx.b.quads[ctx.b.quads.length - 1] }),
    end: (_ctx: LowerCtx, s: Stmt) => ends.push(s.kind),
  });
  const r = lowerSource(source);
  setBoundaryProbe(null);
  expect(r.diagnostics).toEqual([]);
  const bodies = [r.ir.main, ...r.ir.procedures.map((p) => p.body)];
  const stmtQuads = bodies.reduce((n, body) => n + body.filter((q) => q.op === 'stmt').length, 0);
  return { starts, ends, stmtQuads, problems: r.problems };
}

afterEach(() => setBoundaryProbe(null));

describe('statement-boundary hooks (stubs)', () => {
  it('start runs once per stmt quad, right after it, and emits nothing', () => {
    const { starts, stmtQuads, problems } = observe(
      [
        '10 a = 1',
        '20 IF a = 1 THEN PRINT a : a = 2 ELSE PRINT 0',
        '30 FOR i = 1 TO 2',
        '40   PRINT i',
        '50 NEXT',
        '60 SELECT CASE a',
        '70   CASE 2 : PRINT "two"',
        '80   CASE ELSE : PRINT "other"',
        '90 END SELECT',
        '100 WHILE a < 4 : a = a + 1 : WEND',
      ].join('\n'),
    );
    expect(problems).toEqual([]);
    expect(starts.length).toBe(stmtQuads);
    expect(starts.length).toBeGreaterThan(10);
    for (const s of starts) expect(s.last?.op).toBe('stmt');
  });

  it('procedure bodies and local DIM initialisers get the hooks too', () => {
    const { starts, stmtQuads } = observe(
      [
        'FUNCTION Five() AS INTEGER',
        '  RETURN 5',
        'END FUNCTION',
        'SUB Show(n AS INTEGER)',
        '  DIM k AS INTEGER = Five()',
        '  PRINT n + k',
        'END SUB',
        'Show 1',
        'Show 2',
      ].join('\n'),
    );
    expect(starts.length).toBe(stmtQuads);
    for (const s of starts) expect(s.last?.op).toBe('stmt');
    expect(starts.filter((s) => s.inProc).map((s) => s.kind)).toEqual(['Return', 'Dim', 'Print']);
    expect(starts.filter((s) => !s.inProc).map((s) => s.kind)).toEqual(['SubCall', 'SubCall']);
  });

  it('end runs after every statement of every list, executable or not', () => {
    const { ends } = observe(['CONST k AS INTEGER = 3', '10 PRINT k', 'IF k > 1 THEN', '  PRINT 1', 'END IF'].join('\n'));
    // The nested PRINT ends before the IF block that holds it.
    expect(ends.filter((k) => k === 'Const')).toHaveLength(1);
    expect(ends.filter((k) => k === 'Print')).toHaveLength(2);
    expect(ends.indexOf('If')).toBeGreaterThan(ends.lastIndexOf('Print'));
  });
});
