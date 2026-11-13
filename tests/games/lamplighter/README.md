# Lamplighter (cpcbas port source)

A copy of cpcbuild's `games/lamplighter`, translated for cpcbas (task L4-LAMP-IMPORT).

- **Source**: cpcbuild commit `6730b64`, `games/lamplighter/` plus `tests/screens/lib/shot.bas` and the
  CPC part of the test helpers (see "Left out" below). Copied read only.
- **Licence**: MIT, as cpcbuild (Copyright 2026 Barry White).
- **cpcbuild is not edited.** The translated copies here are the only versions that change. cpcbuild's
  asset converters (`img2cpc.py`, `tmx2bas.py`) still write `$` hex; the port commits converted copies,
  and the converters change in L6.
- **Build and test** (L4-LAMP): `python3 tools/lamp.py build` makes the four builds, the discs and the cartridge;
  `python3 tools/lamp.py` runs the chipsrun tests (464, 6128), `python3 tools/lamp.py --plus` the Caprice32 and CPCEC
  ones (6128 Plus, disc and cartridge), `python3 tools/lamp.py bench` the speed rows. `loader_plus.asm` is the
  `RUN"PLUS` loader. Build outputs are not committed.
- **Test switches** in `main.bas`: `-D START_ROOM=n`, `SHOT=n`, `SHOT_LIT`, `SHOT_CLIMB`, `SHOT_WALK`, `SHOT_TITLE`,
  `BENCH`, and `AUTOPLAY` (the real platform layer plays the whole tower; `AUTOPLAY_NOKEY` for an emulator that cannot
  type the title key).

## Layout

The game directory is this one. Paths are as in cpcbuild, with two exceptions: `tests/` holds the test
programs of `games/lamplighter/tests/`, and `lib/shot.bas` is the shot helper from `tests/screens/lib/`.

- `game.bas`, `main.bas`, `platform_cpc.bas`, `platform_plus.bas`
- `assets/`: the `.bas` includes, `lamp.cpcpal`, the PNG and TMX sources, and the `.cpcimp` import specs
  of the PNG sources (`sprites`, `tiles`, `plus/tiles`, `plus/lpsprites`)
- `assets/plus/`: the Plus assets and their PNG sources
- `tests/`: `logic.bas`, `playthrough.bas`, `plus_layer.bas`, `platform_null.bas`, `playseq.bas`, `say.bas`
- `tests/golden/{464,6128,plus-cap32,plus-cpcec}/`: cpcbuild's screenshot goldens, unchanged, plus `autoplay.png` in each
  (blessed once from a real AUTOPLAY run)
- `lib/shot.bas`: the shot helper (translated, rule 6)

## Left out

- Spectrum: `platform_zx.bas`, `assets/zx/`, `tests/golden/zx48/`, `tests/golden/zx128/`, `build_zx.sh`
- Python and runners: `assets/make_art.py`, `assets/make_plus_art.py`, `assets/split_rooms.py`,
  `tests/run.py`, `tests/run_plus.py`, `tests/reach.py` (L4-LAMP ports the runners)
- Build and shell files: `build_cpc.sh`, `build_plus.sh`, `build_assets.sh`, `cpcbuild.json`,
  `tests/bench.sh`, `tests/bench_plus.sh`, `tests/env.sh`
- `__pycache__/`, `build/`
- `tests/zx/lib/zxtest.bas`: not copied. The brief asked for "the CPC part" of it, but the file has no CPC
  part. It is the Spectrum test port (`OUT 255`), and `say.bas` includes it only under `#ifdef __ZX48K__`.
  The CPC build never includes it. See "Deviations".

## Translation rules

Applied by a script in order (rules 1 to 7 of the L4-LAMP-IMPORT brief, and nothing else). Each count is
the number of replacements.

1. `$` followed by hex digits, outside ASM blocks and string literals, becomes `&`. Not after a letter,
   digit, `_` or `$`, so `STR$`, `CHR$` and `MID$` are unchanged.
2. `bAND`, `bOR`, `bXOR`, `bNOT` (any case) become `AND`, `OR`, `XOR`, `NOT`.
3. The whole word `inp` becomes `kin`.
4. In a `SUB` (not a `FUNCTION`), a code line ending in a bare `RETURN` gets `EXIT SUB` in its place.
5. Inside ASM blocks, `_name.__DATA__` becomes `_name__a.__DATA__`.
6. In `lib/shot.bas`, `CODE(name(i TO i))` becomes `ASC(MID$(name, i + 1, 1))`.
7. `#include "../../tests/screens/lib/shot.bas"` becomes `#include "lib/shot.bas"` (the only include
   path that the new layout changes; the other relative includes keep their meaning).

| Rule | Total | Per file |
|---|---:|---|
| 1 | 11760 | `assets/rooms.bas` 5700, `assets/plus/lpsprites.bas` 3102, `assets/sprites.bas` 1536, `assets/fontcpc.bas` 322, `assets/tiles.bas` 528, `assets/plus/tiles.bas` 528, `assets/plus/pl_pens.bas` 36, `platform_plus.bas` 1, `tests/plus_layer.bas` 7 |
| 2 | 71 | `game.bas` 45, `platform_cpc.bas` 16, `main.bas` 6, `platform_plus.bas` 2, `tests/plus_layer.bas` 1, `tests/logic.bas` 1 |
| 3 | 32 | `game.bas` 14, `main.bas` 10, `tests/logic.bas` 5, `tests/playthrough.bas` 3 |
| 4 | 18 | `game.bas` 16, `platform_cpc.bas` 2 |
| 5 | 9 | `game.bas` 9 |
| 6 | 1 | `lib/shot.bas` 1 |
| 7 | 1 | `platform_cpc.bas` 1 |

Notes on the counts:

- Rule 1: no `$` in a comment was changed (none occur). The three `$` in `lib/shot.bas` are inside an ASM
  block and are not changed by rule 1, which excludes ASM.
- Rules 2 and 3 were applied to code and comments, never to string literals. No string literal contains
  `bAND`, `bOR`, `inp` or `$hex`.
- Rule 3 changed two words in comments: `game.bas:892` ("with input kin") and `tests/logic.bas:28`.
  The rule names no exclusion for comments, so the comment was changed to keep it matching the variable.
- Rule 4: every bare `RETURN` at the end of a `SUB` line was changed. None was skipped (no trailing
  comment after one, no `GOSUB` in a `SUB`). In `game.bas`, the SUBs are `Die`, `MoveX`, `MoveY`,
  `ClimbStep`, `MovePlayer`, `MoveEnemies` and `GameDraw`. In `platform_cpc.bas`, they are `PlatFlush` and
  `PlatMusic`. `RETURN` in a `FUNCTION` is unchanged.
- Rule 5: all 9 `__DATA__` references are in `game.bas`, inside ASM blocks.
- Not changed, as the rules require: the `$` in `STR$`, `CHR$` and `MID$` (rule 1 excludes a `$` after a
  letter), and the `$` in string literals. After the translation, 16 lines still contain a `$`, and each is
  one of those cases or inside `lib/shot.bas`'s ASM.

Counts were checked against an independent `grep -P` of the source files (rules 1, 2 and 3), and the
rule 4 and rule 5 lines were read in the translated files.

## Build results

Commands run from this directory, with `--org 0x40`. Sizes are the output `.bin` files (not committed).

| Command | Result | Size (bytes) |
|---|---|---:|
| `-D CPC464 main.bas` | ok, 2 warnings (2 W301) | 31225 |
| `-D CPC6128 main.bas` | ok, 2 warnings (2 W301) | 31225 |
| `-D PLUS -D CPC_BAREMETAL -D CPC_OWNFONT main.bas` | ok, 2 warnings (2 W301) | 34852 |
| `-D CPC464 -D SHOT=3 main.bas` | ok, 5 warnings (2 W301, 3 W306) | 31193 |
| `-D PLUS main.bas` | fails, 1 error: `platform_plus.bas:97:5: error E002: PAUSE is not implemented yet` (the only error) | - |
| `-D CPC464 tests/logic.bas` | ok, 6 warnings (2 W301, 4 W306) | 19687 |
| `-D CPC464 tests/playthrough.bas` | ok, 5 warnings (2 W301, 3 W306) | 15774 |

The 464 and 6128 builds are the same size (31225 bytes each).

The warnings are the source's own, not from the translation: W301 (`nLamp` and `nDoor`, read but never
assigned, `game.bas:366` and `game.bas:378`) and W306 (procedures that nothing calls).

## Deviations and open points

- `tests/zx/lib/zxtest.bas` was not copied: it has no CPC part (see "Left out").
- The `.cpcimp` import specs were copied with the PNG sources. The brief did not list them. They are
  text, and the converter needs them to regenerate the `.bas` assets from the PNGs.
- `-D PLUS` (without the Plus defines and `CPC_BAREMETAL`) still fails on `PAUSE`. That is L4-SMALL's work,
  and PAUSE was not touched.
- The `#include <zxtest.bas>` in `tests/say.bas` stays as it is. It is inside `#ifdef __ZX48K__` and is
  never reached in these builds.
- The `$` hex form and the cpcbuild converters are unchanged in cpcbuild (see the top of this file).
