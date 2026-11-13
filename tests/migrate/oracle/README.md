# The migrate oracle

`cpcbas migrate` is tested against translations that were made and reviewed by hand before the tool
existed. `packages/cpcbas/test/migrate-oracle.test.ts` runs the translator over the Boriel BASIC
originals and compares its output, line by line, with those reviewed translations.

## Contents

- `boriel/`: cpcbuild's Boriel BASIC sources, copied byte for byte from cpcbuild commit `9bc23fe`
  (`git -C <cpcbuild> show 9bc23fe:<path>`), under their paths in cpcbuild:
  - `lib/`: the 17 `.bas` files of the BASIC library that cpcbas's `lib/` also has;
  - `tests/conformance/`: the 94 `.bas` files (programs and their `lib/` and `assets/` helpers) that
    `tests/conformance/` of cpcbas also has;
  - `games/lamplighter/`: Lamplighter's 21 CPC `.bas` files, and `tests/screens/lib/shot.bas`.
  Only `.bas` files are copied; the assembly, images and data files are not read by the translator.
  The sources have not changed between the dates the reviewed translations were made and `9bc23fe`
  (D6), and they are licensed as cpcbuild (MIT).
- The reviewed translations are not copied: they are cpcbas's own `lib/`, `tests/conformance/` and
  `tests/games/lamplighter/` (Lamplighter's `lib/shot.bas` is the translation of `tests/screens/lib/shot.bas`).
- `hand-edits.json`: every run of lines where the reviewed file differs from the translator's output,
  with a reason that starts with its category (`comment`, `case`, `expected-value`, `include`, `rename`,
  `port-change`, `moved`, `new-code`). The test fails on a difference that is not listed, on a listed one
  that no longer differs, and on a hand edit without a reason. Regenerate it after a deliberate change
  with `MIGRATE_REGEN=1 npx vitest run packages/cpcbas/test/migrate-oracle.test.ts` and read the diff:
  a hunk that is unchanged keeps its reason, a new one gets a draft reason from `draftReason()` in
  `packages/cpcbas/test/migrate-oracle-lib.ts`.
- `flag-counts.json`: how many findings of each code the translator raises on the Boriel files (the
  test fails when a rule starts or stops firing).

## How the projects are formed

The reviewed translations were made one program at a time, so the test migrates them as the projects they
are: the library; Lamplighter (with `renames: { inp: 'kin' }`); the conformance helpers (`lib/` and
`assets/`); and each conformance program with the files it includes (so a name one program declares
does not rename a keyword in another). The renames the reviewers chose by hand are passed as the
`renames` option (`LIB_RENAMES`, `LAMP_RENAMES`, `CONF_RENAMES` in the helper). Every run uses
`from: 'boriel'`, as the Studio's Convert command does.

## What the test also checks

- every run is idempotent (`auto` and `boriel`, then `auto` over the output);
- each project's `auto` output equals its `boriel` output, or the file has a W727 finding (only `arrays.bas`'s `UBOUND(a1)` differs); a second `auto` run over a project with a must-fix flag still open adds nothing;
- a program the translator leaves with no must-fix flag (W720-W724) compiles, apart from E239 (a
  FUNCTION called as a statement: Boriel allows it, follow-up 226);
- the reviewed translations compile with `--parse-only`, and `cpcbas migrate --check` finds nothing to
  change or fix in them;
- the translator does not throw on cut, shuffled or damaged input.
