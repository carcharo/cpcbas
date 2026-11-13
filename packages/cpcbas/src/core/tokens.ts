/**
 * Tokens: the lexer's output and the preprocessor's input and output.
 *
 * Pipeline:
 *
 *   lex(file)            -> raw tokens of one file, including `Directive` tokens
 *                           for every `#...` line and `AsmLine` tokens inside ASM blocks
 *   preprocess(input)    -> one expanded stream for the whole program: includes
 *                           pasted in, macros expanded, #if branches chosen,
 *                           conditional/definition directives consumed; `#pragma`,
 *                           `#require`, `#init` and `#line` pass through as `Directive`
 *                           tokens for the parser
 *   parse(result)        -> AST (ast/ast.ts)
 *
 * Every token has a {@link Span} in the file it was read from. A token produced by a
 * macro expansion carries the span of the macro *use* and `fromMacro: true`, so
 * errors point at what the user wrote.
 *
 * Kinds are string literals (readable `--stage tokens` dumps and tests). Punctuation
 * and operators use their own text as the kind (`'('`, `'<='`), so the parser writes
 * `tok.kind === '('`.
 */

import type { DiagnosticBag } from './diagnostics.js';
import type { FileId, FileTree, SourceFile, SourceSet, Span } from './source.js';

/** Locomotive type suffixes: `%` INTEGER, `!` REAL, `$` STRING. */
export type TypeSuffix = '%' | '!' | '$';

/** Punctuation and symbolic operators. `=>` and `=<` are Locomotive's spellings of `>=`/`<=`; the parser also reads `=>` as the array-initialiser arrow after a DIM declarator. */
export type PunctKind =
  | '('
  | ')'
  | ','
  | ';'
  | ':'
  | '#'
  | '@'
  | '+'
  | '-'
  | '*'
  | '/'
  | '\\'
  | '^'
  | '='
  | '<>'
  | '<'
  | '>'
  | '<='
  | '>='
  | '=<'
  | '=>'
  | '<<'
  | '>>'
  | '{'
  | '}';

export type TokenKind =
  | 'Number'
  | 'String'
  | 'Identifier'
  | 'Keyword'
  | 'LineNumber'
  | 'Label'
  | 'Rsx'
  | 'DataItem'
  | 'AsmLine'
  | 'Directive'
  | 'Comment'
  | 'Newline'
  | 'EOF'
  | 'Invalid'
  | PunctKind;

/** Fields every token has. */
export interface TokenBase {
  readonly kind: TokenKind;
  readonly span: Span;
  /** The exact source text of the token (for a macro-expanded token: the text of the body token). */
  readonly text: string;
  /** True when whitespace (or a comment) precedes the token on the same line. */
  readonly spaceBefore: boolean;
  /** True when the token is the first on its physical line (after any line continuation it is false). */
  readonly lineStart: boolean;
  /** True when a line comment (REM or `'`) ended the previous text on this line, so this token is the line's end. Present only when true. */
  readonly commentBefore?: boolean;
  /** True when the token came from a macro body; `span` is then the span of the macro use. */
  readonly fromMacro?: boolean;
}

/**
 * A numeric literal: `12`, `1.5`, `.5`, `1E3`, `&FF`, `&HFF`, `0xFF`, `&X1010`, `0b1010`,
 * optionally suffixed `5%` / `5!`. `value` is the exact mathematical value as a JS number
 * (all integer literals up to 2^32 are exact). The checker picks the literal's type.
 */
export interface NumberToken extends TokenBase {
  readonly kind: 'Number';
  readonly value: number;
  readonly radix: 2 | 10 | 16;
  /** True when written with `.` or an exponent (a REAL literal). */
  readonly isReal: boolean;
  readonly suffix: '%' | '!' | null;
}

/** A string literal. `value` has `""` already turned into `"`. `closed` is false for a string that ran to the end of the line (W102). */
export interface StringToken extends TokenBase {
  readonly kind: 'String';
  readonly value: string;
  readonly closed: boolean;
}

/**
 * A name that is not a reserved word: variable, array, SUB, FUNCTION, label use,
 * macro name. `name` is as written without the suffix; compare names with `key`.
 */
export interface IdentifierToken extends TokenBase {
  readonly kind: 'Identifier';
  readonly name: string;
  readonly suffix: TypeSuffix | null;
  /** Lower-cased `name` plus suffix: the case-insensitive identity of the spelling (`Score$` -> `score$`). */
  readonly key: string;
}

/**
 * A reserved word from lang/keywords.ts. `keyword` is the canonical upper-case word,
 * with `$` when part of it (`STR$`, `INKEY$`). Multi-word forms (`END IF`, `LINE INPUT`,
 * `GRAPHICS PEN`) are two or more keyword tokens; the parser combines them.
 * `?` lexes as the keyword `PRINT` (text `?`).
 */
export interface KeywordToken extends TokenBase {
  readonly kind: 'Keyword';
  readonly keyword: string;
}

/** A decimal integer that is the first token of a physical line: a line number (a GOTO/GOSUB target). */
export interface LineNumberToken extends TokenBase {
  readonly kind: 'LineNumber';
  readonly value: number;
}

/** `name:` as the first token of a physical line (unsuffixed, not reserved, colon directly after). The colon is part of the token. */
export interface LabelToken extends TokenBase {
  readonly kind: 'Label';
  readonly name: string;
  /** Lower-cased name. */
  readonly key: string;
}

/** An RSX bar command: `|DISC`, `|ERA`. `name` is upper-cased, without the bar. */
export interface RsxToken extends TokenBase {
  readonly kind: 'Rsx';
  readonly name: string;
}

/**
 * One item of a DATA statement. After the keyword DATA the lexer reads the rest of the
 * statement raw (up to an unquoted `:` or the end of the line), split at unquoted commas.
 * `raw` is the trimmed text; for a quoted item, `quoted` is true and `raw` is the string's value.
 * An empty item (`DATA 1,,2`) has `raw === ''`.
 */
export interface DataItemToken extends TokenBase {
  readonly kind: 'DataItem';
  readonly raw: string;
  readonly quoted: boolean;
}

/**
 * One line inside an `ASM` ... `END ASM` block, raw (the asm text is the assembler's
 * business). `#` lines inside an ASM block are still `Directive` tokens, so `#ifdef`
 * works there. After preprocessing, macro names in `text` have been expanded (the span
 * still covers the original line). The block's own `ASM` and `END ASM` are Keyword tokens.
 */
export interface AsmLineToken extends TokenBase {
  readonly kind: 'AsmLine';
  readonly text: string;
}

/** Preprocessor directive names (spec: modern layer, preprocessor). */
export type DirectiveName =
  | 'include'
  | 'define'
  | 'undef'
  | 'ifdef'
  | 'ifndef'
  | 'if'
  | 'elif'
  | 'else'
  | 'endif'
  | 'error'
  | 'warning'
  | 'line'
  | 'pragma'
  | 'require'
  | 'init';

/**
 * A whole `#...` line (blanks may precede `#`; `_` continuations joined).
 * `name` is lower-cased; an unknown name is kept as written (the preprocessor reports E122).
 * `rest` is the raw text after the name to the end of the logical line, comments not removed;
 * `restSpan` covers it, so the preprocessor can lex it with `lex(file, { range })`.
 */
export interface DirectiveToken extends TokenBase {
  readonly kind: 'Directive';
  readonly name: DirectiveName | string;
  readonly rest: string;
  readonly restSpan: Span;
  /** The directive is a line of an ASM block (an `#include` there includes the file as ASM lines). */
  readonly inAsm?: true;
}

/** A comment (`'...`, `REM ...`, `/' ... '/`), emitted only with `LexOptions.keepComments`. `REM` itself is part of the token. */
export interface CommentToken extends TokenBase {
  readonly kind: 'Comment';
  readonly style: 'apostrophe' | 'rem' | 'block';
  /** The comment's text without the opening marker (and without `'/` for a block). */
  readonly body: string;
}

/** Statement-ending line break (one per physical line end, except after a `_` continuation or inside a block comment). */
export interface NewlineToken extends TokenBase {
  readonly kind: 'Newline';
}

/** End of the stream (exactly one, last). Its span is empty, at the end of the main file. */
export interface EofToken extends TokenBase {
  readonly kind: 'EOF';
}

/** A character the lexer could not use; E101 has been reported. Kept so the parser can resynchronise. */
export interface InvalidToken extends TokenBase {
  readonly kind: 'Invalid';
}

/** Punctuation and symbolic operators. */
export interface PunctToken extends TokenBase {
  readonly kind: PunctKind;
}

export type Token =
  | NumberToken
  | StringToken
  | IdentifierToken
  | KeywordToken
  | LineNumberToken
  | LabelToken
  | RsxToken
  | DataItemToken
  | AsmLineToken
  | DirectiveToken
  | CommentToken
  | NewlineToken
  | EofToken
  | InvalidToken
  | PunctToken;

// ---------------------------------------------------------------------------
// Lexer contract (src/lexer/index.ts)
// ---------------------------------------------------------------------------

export interface LexOptions {
  /** Emit `Comment` tokens (for the LSP and doc comments). Default false. */
  readonly keepComments?: boolean;
  /**
   * Lex only `[start, end)` of the file (offsets in the file's text; spans stay absolute).
   * Used by the preprocessor for `#define` bodies and `#if` expressions. In a range, the
   * first token is not treated as line-initial (no LineNumber/Label).
   */
  readonly range?: { readonly start: number; readonly end: number };
  /**
   * The whole file is the body of an ASM block: every line is an `AsmLine` (directives still
   * work) until an `END ASM` line, if any. Used for a file `#include`d inside an ASM block.
   */
  readonly asmBody?: boolean;
}

/** `lex(file, diagnostics, options)`: raw tokens of one file, ending with one EOF token. Never throws for bad input. */
export type LexFn = (file: SourceFile, diagnostics: DiagnosticBag, options?: LexOptions) => Token[];

// ---------------------------------------------------------------------------
// Preprocessor contract (src/preprocessor/index.ts)
// ---------------------------------------------------------------------------

/** Path prefix of BASIC files found in the bundled library ({@link PreprocessInput.library}). */
export const LIBRARY_PREFIX = '<lib>/';

export interface PreprocessInput {
  /** Registry for every file read; the preprocessor adds includes in the order first met. */
  readonly sources: SourceSet;
  /** User files (and the library, when the host mounts it in the same tree). */
  readonly tree: FileTree;
  /** Normalised path of the main file in `tree`. */
  readonly main: string;
  /**
   * Directories searched for `#include <f>` and, after the including file's own directory,
   * for `#include "f"` (in order). `#require "f"` paths are resolved later, not here.
   */
  readonly includePaths: readonly string[];
  /**
   * The bundled library (the repo's `lib/`, the same tree as `CompileInput.runtime`), searched
   * last: after the include paths, `<f>` and `"f"` look for `f` and then `stdlib/f` in it
   *. A file found there is registered under the path
   * {@link LIBRARY_PREFIX} + its path in the tree (`<lib>/cpcbuild/display.bas`), and its own
   * quoted includes resolve inside the library first. Optional: without it nothing changes.
   */
  readonly library?: FileTree;
  /** `-D NAME[=value]` plus the predefined names (`__CPC__`, `__CPCBAS__`, `__VERSION__`, `__DATE__`, model defines). The caller merges them; `__FILE__` and `__LINE__` are dynamic and built in. */
  readonly defines: ReadonlyMap<string, string>;
  readonly diagnostics: DiagnosticBag;
  readonly lexOptions?: LexOptions;
}

/** A `#define`d macro. Names are case-sensitive. */
export interface MacroDef {
  readonly name: string;
  /** Parameter names for a function-like macro (`#define F(a, b) ...`), or null. */
  readonly params: readonly string[] | null;
  /** Body tokens (lexed from the body text). */
  readonly body: readonly Token[];
  /** Body as raw text (used to expand macros inside ASM lines). */
  readonly bodyText: string;
  /** The definition site; for `-D` and predefined names, a span in a synthetic `<command line>` file. */
  readonly span: Span;
}

/** One resolved `#include`. */
export interface IncludeRecord {
  /** The directive's span in the including file. */
  readonly span: Span;
  /** The name as written (`"tiles.bas"`, `<cpcbuild/sprites.bas>`). */
  readonly requested: string;
  readonly angle: boolean;
  readonly once: boolean;
  /** Resolved file, or null when not found (E120 reported). */
  readonly file: FileId | null;
  /** True when skipped because of `once` (already included). */
  readonly skipped: boolean;
}

export interface PreprocessResult {
  /** The expanded token stream of the whole program, ending with one EOF. */
  readonly tokens: Token[];
  readonly includes: readonly IncludeRecord[];
  /** Macros defined at the end of preprocessing (for the LSP and `--stage tokens`). */
  readonly macros: ReadonlyMap<string, MacroDef>;
  readonly mainFile: FileId | null;
}

/** `preprocess(input)`. Never throws for bad input; a missing main file gives E003 and an empty stream. */
export type PreprocessFn = (input: PreprocessInput) => PreprocessResult;
