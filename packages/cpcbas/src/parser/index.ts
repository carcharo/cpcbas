/**
 * The parser: preprocessed tokens to the AST (contract: ast/ast.ts, `ParseFn`).
 *
 * - `cursor.ts`: token cursor, error helpers, resynchronisation;
 * - `expr.ts`: the expression grammar and the pieces statements share;
 * - `statements.ts`: the statement loop, blocks, dispatch, LineLabel/Let/SubCall/BadStmt;
 * - `declarations.ts`, `control.ts`, `stmts.ts`: the statement tables of the wave-3 tasks;
 * - `types.ts`: the parser context those tables are written against.
 */
import type { ParseFn, ParseInput, Program } from '../ast/ast.js';
import { asFileId } from '../core/source.js';
import { createContext } from './statements.js';

export const IMPLEMENTED = true;

export const parse: ParseFn = (input: ParseInput): Program => {
  const { pp, sources, diagnostics } = input;
  const file = pp.mainFile ?? asFileId(0);
  const end = pp.mainFile === null ? 0 : (sources.all()[pp.mainFile]?.text.length ?? 0);
  const span = { file, start: 0, end };
  const ctx = createContext(pp.tokens, diagnostics, sources);
  let body: Program['body'] = [];
  try {
    body = ctx.parseBlock([]).body;
  } catch (e) {
    // A bug in the parser, not a user error: report it as E001 and return what was built.
    diagnostics.report('E001', span, `Internal error in the parser: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { kind: 'Program', span, body, includes: pp.includes, mainFile: pp.mainFile };
};
