REM MODELS: plus
REM Conformance (CPC Plus, both modes; Phase 7 tidy-up): PlusPokeBlock(dest, src, count) copies
REM count bytes from RAM to the ASIC page at dest in ONE window when the source lies outside
REM &4000-&7FFF. Checks: lengths 1, 64, 255, 256, 257, 400 land byte for byte (sprite pixel
REM RAM keeps the low nibble); the sprite register table at &6000 (what Starfall writes each
REM frame); a block that would run past &7FFF is cut there and does not touch the RAM above
REM it (the old call wrote into &8000 and up); a destination outside &4000-&7FFF or a count
REM of 0 does nothing; the interrupt state is kept; the source is not changed. The same from a
REM source inside &4000-&7FFF is in plus_big (a program that large).
REM
REM Ported from cpcbuild. Changed with the language: $XX is &XX, bAND/bOR/bXOR are AND/OR/XOR,
REM STR$ is N$/T$ (Locomotive puts a space before a number that is not negative), CHR$ 13 is
REM CHR$(13). A true comparison given to STR$ is wrapped in -( ) so the expected values stay 1.
REM the variable AFTER is afterSum.

#include <cpc.bas>
#include "lib/chk.bas"
#include "lib/plushelp.bas"

DIM src(399) AS UBYTE
DIM i, bad AS UINTEGER
DIM before, afterSum AS ULONG

FUNCTION Sum(addr AS UINTEGER, n AS UINTEGER) AS ULONG
  DIM k AS UINTEGER
  DIM t AS ULONG
  t = 0
  FOR k = 0 TO n - 1
    t = t * 3 + PEEK(addr + k) + 1
  NEXT k
  RETURN t
END FUNCTION

FUNCTION Check(first AS UINTEGER, n AS UINTEGER, base AS UINTEGER) AS UINTEGER
  DIM k, b AS UINTEGER
  b = 0
  FOR k = 0 TO n - 1
    IF AsicPeek(first + k) <> (PEEK(base + k) AND 15) THEN b = b + 1
  NEXT k
  RETURN b
END FUNCTION

FOR i = 0 TO 399
  src(i) = (i * 7 + 3) AND 255
NEXT i
PlusUnlock()
SpritesHideAll()

PlusPokeBlock(&4000, @src(0), 1)
CHK("len_1", T$(STR$(Check(&4000, 1, @src(0)))), "0")
PlusPokeBlock(&4100, @src(0), 64)
CHK("len_64", T$(STR$(Check(&4100, 64, @src(0)))), "0")
PlusPokeBlock(&4200, @src(0), 255)
CHK("len_255", T$(STR$(Check(&4200, 255, @src(0)))), "0")
PlusPokeBlock(&4400, @src(0), 256)
CHK("len_256", T$(STR$(Check(&4400, 256, @src(0)))), "0")
PlusPokeBlock(&4600, @src(0), 257)
CHK("len_257", T$(STR$(Check(&4600, 257, @src(0)))), "0")
PlusPokeBlock(&4800, @src(0), 400)
CHK("len_400", T$(STR$(Check(&4800, 400, @src(0)))), "0")
CHK("source_intact", T$(STR$(PEEK(@src(0) + 399))), T$(STR$((399 * 7 + 3) AND 255)))
CHK("iff_kept_on", T$(STR$(Iff())), "1")

REM the register table: 3 sprites of 8 bytes
POKE @src(0), 40: POKE @src(0) + 1, 1: POKE @src(0) + 2, 50: POKE @src(0) + 3, 0: POKE @src(0) + 4, 5
POKE @src(0) + 5, 0: POKE @src(0) + 6, 0: POKE @src(0) + 7, 0
PlusPokeBlock(&6008, @src(0), 8)
CHK("registers", T$(STR$(PlusPeek(&6008))) + " " + T$(STR$(PlusPeek(&6009))) + " " + T$(STR$(PlusPeek(&600A))) + " " + T$(STR$(PlusPeek(&600B))), "40 1 50 0")

REM interrupts off stay off
IntOff()
PlusPokeBlock(&4A00, @src(0), 64)
CHK("iff_kept_off", T$(STR$(Iff())), "0")
IntOn()

REM past the end of the page: cut at &7FFF, the RAM above untouched
before = Sum(32768, 64)
PlusPokeBlock(&7FF0, @src(0), 64)
afterSum = Sum(32768, 64)
CHK("cut_at_7FFF_ram_above_untouched", T$(STR$(-(before = afterSum))), "1")

REM outside the page: nothing (the pixel RAM keeps what it had)
PlusPoke(&4000, 9)
PlusPoke(&4001, 7)
PlusPokeBlock(&3FFF, @src(1), 4)
PlusPokeBlock(&8000, @src(1), 4)
PlusPokeBlock(&4001, @src(0), 0)
CHK("outside_and_zero_ignored", T$(STR$(PlusPeek(&4000))) + " " + T$(STR$(PlusPeek(&4001))), "9 7")
PRINT "DONE"
END
