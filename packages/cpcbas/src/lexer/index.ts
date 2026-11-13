/**
 * The lexer. Contract: core/tokens.ts (`LexFn`). The scanner is in scanner.ts.
 */
import type { DiagnosticBag } from '../core/diagnostics.js';
import type { SourceFile } from '../core/source.js';
import type { LexFn, LexOptions, Token } from '../core/tokens.js';
import { Scanner } from './scanner.js';

export const IMPLEMENTED = true;

export const lex: LexFn = (file: SourceFile, diagnostics: DiagnosticBag, options?: LexOptions): Token[] =>
  new Scanner(file, diagnostics, options).run();
