# Changelog

## 0.2.0 (in development)

The package as cpcbuild, the SDK and CPC Game Studio consume it.

- `@cpcbuild/cpcbas` is version `0.2.0-dev`. `dist/lib` (the runtime library, copied from `lib/` by `npm run build`) is part of the
  package, so the CLI works outside a checkout: its default runtime directory is the package's own `dist/lib` (in a checkout it
  stays the repository's `lib/`).
- New entry `@cpcbuild/cpcbas/node` (Node only; the library entry never imports it): `diskTree(dir)` (a lazy `FileTree` over a
  directory), `readTree(dir, filter?)` (an eager map of the `.bas` files, or whatever the filter keeps, under a directory),
  `loadRuntime(dir?)` (the runtime library as a lazy tree, default the package's own), `lazyTree(read, prefix?)`, `defaultRuntimeDir()`.
  The CLI reads through the same helper.
- `npm run bundle` writes `dist/cpcbas.mjs`: the whole CLI in one file for Node 22 with no dependencies (esbuild 0.28.2, exact).
  The SDK ships it next to `lib/`; `node cpcbas.mjs main.bas` finds `lib/` beside it, `--runtime DIR` points elsewhere.
- `cpcbas asm SRC.asm -o OUT.bin [-M MAP]`: a stand-alone Z80 source (no runtime, no includes) to a flat image.
  `cpcbas dsk -o OUT.dsk NAME=FILE@LOAD[:EXEC]...`: an AMSDOS data disc (each file gets an AMSDOS header; EXEC defaults to LOAD).
  These replace `tools/lamp-pack.mjs` and what cpcbuild did with `zxbasm` and `mkdsk.py`.
- `cpcbas migrate`: new review flags W738 (names that differ only in case, in a Boriel run), W739 (a `UINTEGER` met with an
  `INTEGER`; a literal 256-65535 in `INTEGER` arithmetic that reaches a comparison, a division, PRINT/STR$ or a widening) and
  W727 (`ON n GOTO`, `UBOUND(a)` and `DRAW x, y` in a run read as CPC BASIC); W735 also covers `/` and `\` by a power of two.
  `--from auto` reads a run as Boriel only when a rewrite other than those three applied (a must-fix flag no longer counts), so a
  second run over the output adds nothing. A file that is not UTF-8 is left unchanged, with a finding. A file that an `ASM` block
  includes is read as assembly (only its `_name` labels change), not as BASIC.
- The memory map (`-M`) has `.__HIDATA_BACK_0` when the program has a `#pragma hidata` block: the first address after the low
  segment, as the Boriel fork wrote it. Maps of programs without hidata are unchanged.
- `tools/pack-smoke.mjs` (and a test) packs the package, installs the tarball in an empty directory and compiles a program with the
  installed bin and the installed bundle, byte for byte against the repository build.
