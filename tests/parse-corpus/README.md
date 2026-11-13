# Parse corpus

Programs that define what the front end (lexer, preprocessor, parser) must
accept, and the mistakes it must report. They are written from the language
specification, in CPC BASIC (a Locomotive BASIC surface with typed SUB and
FUNCTION, `DIM ... AS`, `ASM` blocks and `#include`), not in Boriel BASIC.
Each file names the spec section it covers in its first comment.

## Layout

```
valid/            programs that parse with no diagnostics
  NN-area.bas     one file per spec area, numbered in reading order
  NN-area.expect  optional: warnings the file is expected to produce (see below)
  inc/            files that valid programs #include
errors/           one wrong thing per file
  name.bas
  name.expect     required: the diagnostics the file must produce
pending/          valid Locomotive programs the front end does not accept yet (empty now)
```

`valid/loco-*.bas` are our own programs written to exercise the keyword
forms of the Locomotive manuals (where the
keyword table and the parser disagree with them is recorded in the maintainers' private notes). `errors/loco-*.bas` are the
Locomotive statements that CPC BASIC refuses or defers.

`pending/` holds Locomotive programs that are valid BASIC but that the parser or
the keyword table rejects today. The runner, the coverage test and the CLI test
do not read it: nothing under `pending/` is checked until a file moves to
`valid/` (with its snapshot) after the front end is fixed. Each file's first
comment says what it needs, and the report names the diagnostic it gives now.

`valid/inc/` is also the include path for `#include <file>` (the angle-bracket
form). `#include "inc/x.bas"` from a valid program finds the file relative to
the including file. Files in `inc/` are parsed through the programs that
include them and must also parse on their own.

## The `.expect` format

One expectation per line, in source order:

```
LINE:COL [CODE] description
```

- `LINE` and `COL` are 1-based. A column counts UTF-16 code units and a tab is
  one column. `COL` may be one past the last
  character of the line.
- `CODE` is the diagnostic code (`E140`, `W102`). It must exist in the code
  tables. Every error case pins its codes, and the corpus runner compares
  `LINE:COL CODE` exactly.
- `description` is a short free-text note for the reader. It is not compared.
- No comments, no blank lines except at the end.

The expectation list for a file is exact: the file must produce these
diagnostics, in this order, and no others. Files with several expectations
(`sinclair-others`, `interpreter-commands`, `later-statements`,
`boriel-operators`) hold independent lines, each one a statement that stands
alone, so that one line does not change what the next reports. They are the
exception to "one wrong thing per file", kept together because each line is the
same kind of case for a different keyword.

A valid file normally has no `.expect`. It has one only for warnings that the
program is meant to trigger (`27-listing-unclosed-string.bas`: an unclosed
string is a warning, W102, not an error).

## Where a diagnostic is placed

The corpus fixes these positions. Where the parser disagrees, either the
parser or the expectation changes, and the change is recorded in the maintainers' private notes.

- Lexical errors: at the first character of the offending item (the stray
  character, the `/'` of an unclosed block comment, the start of the number,
  the `ASM` keyword of an unclosed block, the word with a bad suffix, the `_`
  of a continuation at the end of the file, the `$` of a `$FF`).
- An unclosed string (W102): at the opening quote.
- An unclosed block (IF, FOR, WHILE, DO, SELECT, SUB, FUNCTION): at the
  opening keyword.
- An unclosed parenthesis: at the `(`. A stray `)`: at the `)`.
- NEXT without FOR: at `NEXT`. A NEXT variable mismatch: at the variable after
  `NEXT`. A NEXT inside an IF line: at that `NEXT`.
- Wrong argument count for a built-in: at the keyword or function name.
- A dropped or not-in-1.0 form: at its keyword (`ATTR`, `RENUM`, `bAND`,
  `TYPE`), or at the token that makes it that form when it sits inside a
  statement (`TO` in `DIM a(1 TO 5)` and in `a$(2 TO 4)`).
- Preprocessor: at the `#` of the directive, except "include not found" and
  "include cycle" (at the file name string) and a wrong macro argument count
  (at the macro name where it is used).
- A duplicate line number: at the second occurrence.

## The runner

`packages/cpcbas/test/parse-corpus.test.ts` runs the whole front end over the
corpus: valid files give only their `.expect` diagnostics, error cases give
exactly theirs, `parse(unparse(parse(x)))` equals `parse(x)` up to spans for
every valid file, and `printAst` of every valid file equals the snapshot in
`packages/cpcbas/test/__snapshots__/ast/`. After an intended parser change,
regenerate the snapshots with `UPDATE_AST_SNAPSHOTS=1 npx vitest run
packages/cpcbas/test/parse-corpus.test.ts` and read the diff.
`corpus-arity.test.ts` checks that every built-in is seen at its minimum and
maximum argument count; `cli-e2e.test.ts` drives the `cpcbas` command over the
corpus.

## Keyword coverage

`packages/cpcbas/test/corpus-coverage.test.ts` runs without a parser. It
checks that

- every `KEYWORDS` entry of status compiled, firmware, library or alias occurs
  in `valid/` (words only, comments and string contents do not count);
- every dropped or later entry occurs in `errors/`;
- every lexer error code has an error case, and W102 is expected by a valid
  listing;
- every `.expect` line is well formed, in order, points inside its file and
  uses a known code;
- every error case has an expectation;
- every file starts with a comment that says `spec section N`.

Preprocessor entries (`#error`, `#warning`, `#line`) occur in `valid/` inside a
`#if 0` branch, so they are read but not acted on.

## Adding a case

1. Pick the area. A new valid program goes in `valid/` as `NN-area.bas`,
   starting with `' Spec section N: ...`. A new error goes in `errors/` as
   `name.bas` with one wrong thing, also starting with a spec comment.
2. For an error, write `name.expect` with `LINE:COL [CODE] description` for
   each diagnostic. Count columns from 1 and count the header comment in the
   line numbers.
3. Run `npm test`. If you used a keyword that was missing from the corpus, the
   coverage test now passes for it; if you broke the format, it says where.
