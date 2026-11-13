cpcbas: the CPC BASIC compiler (TypeScript, pure library + CLI). The
plans, task lists and decisions are kept in the maintainers' private notes.

Rules:
- The library (packages/cpcbas) never imports from node:fs, node:child_process,
  node:path or vscode. Files come in as a virtual tree; bytes go out.
- Every change comes with tests (vitest). `npm test`, `npm run lint` and
  `npm run typecheck` must pass before a commit.
- The assembler must assemble every file under lib/ byte-identically to the
  reference assembler (tests/asm-golden).
- Deterministic output: no iteration over unordered sets when it affects
  output; no Date/Math.random in the compiler.
- Diagnostics: code, file:line:col, message, hint. No bare throw for user
  errors.
- Git: stage explicit paths; never stash, checkout, reset or clean; work in
  the worktree you were given and check `pwd` before writing.
- Public repo: no links to private design docs; user-facing docs only.
