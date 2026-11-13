# Assembler golden fixtures

The byte oracle for the assembler (`packages/cpcbas/src/asm`). Every fixture is made by the
reference assembler (zxbasm of the Boriel BASIC fork, branch `cpc-arch`) and committed.
`packages/cpcbas/test/asm-golden.test.ts` assembles the same input with our assembler and
compares the `.bin` bytes and the `-M` map text.

## Layout

- `runtime/<path>.<fw|bare>.bin|.map`: one pair per file under `lib/runtime` and variant
  (`fw` firmware, `bare` bare-metal). The input is a wrapper text that the test rebuilds
  exactly (`wrapperText` in the test, `wrapper_text` in the generator): `org 64`, the memory
  map EQUs the compiler's prologue emits (`CPC_PRIV_BASE`, `CPC_PRIV_SIZE`, `CPC_STACK_TOP`,
  `CPC_MEM_TOP`), the heap EQUs (`ZXBASIC_HEAP_SIZE`, `ZXBASIC_MEM_HEAP`), for `bare` a
  `#define CPC_BAREMETAL`, then `#include once <path>`.
- `runtime/excluded.txt`: `path<TAB>variant<TAB>reference error text` for a file zxbasm cannot
  assemble standalone in a variant. These files are covered through the program fixtures.
- `library/<path>.<fw|bare>.bin|.map`: the same for every asm file of the BASIC library (`lib/cpcbuild`,
  `lib/cpcplus`, `lib/music`; 38 files, 73 cases), with the same wrapper (`#include once <cpcbuild/core.asm>`
  and so on). The reference finds the library files through `CPCBAS_LIB` (set by `tools/asm-oracle/driver.py`),
  the test through the `lib/` root after `lib/runtime`. `library/excluded.txt` lists the 3 cases zxbasm cannot
  assemble standalone (`spritelist.asm` needs `__SL_MAX` from its BASIC part; `plusraster.asm` bare needs
  `__CPC_ISR`); they are covered by the program fixtures.
- `programs/<name>.asm|.bin|.map`: a program compiled by `zxbc --arch cpc -f asm`, then
  assembled by zxbasm. The `.asm` is the fully expanded compiler output (paths in `#line`
  directives are relative to the fork, or `cpcbuild/...` for the toolchain checkout).
  The 21 functional programs of the fork (`tests/functional/arch/cpc`, built with `-O1` as its
  tests do), `examples/*.bas` of cpcbuild, Lamplighter (464, 6128, Plus and the bare Plus
  cartridge, with the flags of its build scripts) and a bare-metal build of `cpc_strings`.

Counts (2026-11-07): 368 runtime cases (186 files of `lib/runtime` in two variants, minus the 4
lines of `excluded.txt`), each a `.bin` and a `.map` (736 files), and 29 programs. A count of
"runtime fixtures" means the 368 cases, each compared for bytes and map.

**Patched runtime files** (`PATCHED` in `tools/import-runtime.py`: `mem/alloc.asm`, `fp_calc.asm`, `arith/div8.asm`, `error.asm`): the generator copies
them from `lib/runtime` into a temporary directory and the reference assembler and compiler search it before the fork's runtime
(`CPCBAS_OVERRIDE`, `tools/asm-oracle/driver.py` and `zxbc-driver.py`), so every fixture that links one, the programs included, is made from the
patched source. Until L4-ERR the fixtures that link `div8.asm` and `fp_calc.asm` were the fork's with their changed bytes corrected by hand; the
override reproduces those bytes exactly.

`.bin` has no origin: it starts at the lowest assembled address. Text is read as Latin-1
(bytes), because some runtime files use CRLF line ends.

## Regenerating

Needs `poetry` (the fork's environment) in the PATH and sibling checkouts of the fork and
cpcbuild (`--fork`, `--cpcbuild`; the defaults are `zxbasic` and `cpcbuild` beside the
repository, or beside the main checkout when run from a worktree).

    python3 tools/asm-oracle/gen-goldens.py            # rewrite runtime/ and programs/
    python3 tools/asm-oracle/gen-goldens.py --check    # exit 1 if a run would change anything

The generator first checks that `lib/runtime` is byte-identical to the fork's runtime, the patched files apart (the
reference resolves includes in the fork; the test resolves them in `lib/runtime`). Run
`tools/import-runtime.py` first if it complains. `tools/asm-oracle/driver.py` runs zxbasm with
the CPC include path (plain zxbasm searches the ZX Spectrum runtime).
