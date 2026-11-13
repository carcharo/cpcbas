REM MODELS: plus
REM Conformance: cpcplus sprites on a CPC Plus (Phase 7 P2, Caprice32 only): pixel
REM RAM (SpriteSetImage, SpriteSetImagePacked), position registers (SpriteMove, with
REM its clamping), and that SpriteMag / SpriteHide / SpritesHideAll leave positions
REM alone (magnification is write-only in Caprice32: its effect is checked by the
REM screenshot test tests/screens/plus_sprites.bas). Read back through the ASIC page.
REM
REM Ported from cpcbuild. Changed with the language: $XX is &XX, bAND/bOR/bXOR are AND/OR/XOR,
REM STR$ is N$/T$ (Locomotive puts a space before a number that is not negative), CHR$ 13 is
REM CHR$(13).

#include <cpc.bas>
#include <cpcbuild/display.bas>
#include "lib/chk.bas"
#include "lib/plushelp.bas"
#include "lib/ticks.bas"

DIM img(255) AS UBYTE
DIM pk(127) AS UBYTE
DIM i, bad AS UINTEGER
DIM v AS UBYTE

PlusUnlock()
REM ---- sprite pictures: 256 bytes, the ASIC keeps the low nibble
FOR i = 0 TO 255
  img(i) = i
NEXT i
SpriteSetImage(0, @img(0))
SpriteSetImage(7, @img(0))
SpriteSetImage(15, @img(0))
bad = 0
FOR i = 0 TO 255
  IF AsicPeek(16384 + i) <> (i AND 15) THEN bad = bad + 1
NEXT i
CHK("image0", T$(STR$(bad)), "0")
bad = 0
FOR i = 0 TO 255
  IF AsicPeek(16384 + 7 * 256 + i) <> (i AND 15) THEN bad = bad + 1
  IF AsicPeek(16384 + 15 * 256 + i) <> (i AND 15) THEN bad = bad + 1
NEXT i
CHK("image7_15", T$(STR$(bad)), "0")
CHK("image_neighbour_untouched", T$(STR$(AsicPeek(16384 + 256) + AsicPeek(16384 + 6 * 256 + 255) + AsicPeek(16384 + 8 * 256))), "0")
FOR i = 0 TO 255
  img(i) = 255 - i
NEXT i
SpriteSetImage(16, @img(0))
CHK("image_n_masked_16_is_0", T$(STR$(AsicPeek(16384))) + " " + T$(STR$(AsicPeek(16384 + 255))), "15 0")
REM a source in &4000-&7FFF (RAM under the ASIC page while it is in) is bounced
REM through a buffer, no longer refused (Phase 7 P3)
FOR i = 0 TO 255
  POKE 17000 + i, i + 3
NEXT i
SpriteSetImage(1, 17000)
bad = 0
FOR i = 0 TO 255
  IF AsicPeek(16384 + 256 + i) <> ((i + 3) AND 15) THEN bad = bad + 1
NEXT i
CHK("image_source_in_window", T$(STR$(bad)), "0")

REM ---- packed pictures: two pixels per byte, the left one in the high nibble
FOR i = 0 TO 127
  pk(i) = (i * 16 + (127 - i)) AND 255
NEXT i
SpriteSetImagePacked(4, @pk(0))
bad = 0
FOR i = 0 TO 127
  IF AsicPeek(16384 + 4 * 256 + i * 2) <> (pk(i) >> 4) THEN bad = bad + 1
  IF AsicPeek(16384 + 4 * 256 + i * 2 + 1) <> (pk(i) AND 15) THEN bad = bad + 1
NEXT i
CHK("packed", T$(STR$(bad)), "0")
CHK("packed_neighbours", T$(STR$(AsicPeek(16384 + 3 * 256 + 255) + AsicPeek(16384 + 5 * 256))), "0")
FOR i = 0 TO 127
  POKE 17400 + i, pk(i)
NEXT i
SpriteSetImagePacked(5, 17400)
bad = 0
FOR i = 0 TO 127
  IF AsicPeek(16384 + 5 * 256 + i * 2) <> (pk(i) >> 4) THEN bad = bad + 1
  IF AsicPeek(16384 + 5 * 256 + i * 2 + 1) <> (pk(i) AND 15) THEN bad = bad + 1
NEXT i
CHK("packed_source_in_window", T$(STR$(bad)), "0")

REM ---- positions: X lo, X hi, Y lo, Y hi at &6000 + 8n; clamped to the ASIC's range
SpriteMove(0, 100, 50)
CHK("move_100_50", T$(STR$(AsicPeek(&6000))) + " " + T$(STR$(AsicPeek(&6001))) + " " + T$(STR$(AsicPeek(&6002))) + " " + T$(STR$(AsicPeek(&6003))), "100 0 50 0")
SpriteMove(0, 639, 199)
CHK("move_639_199", T$(STR$(AsicPeek(&6000))) + " " + T$(STR$(AsicPeek(&6001))) + " " + T$(STR$(AsicPeek(&6002))) + " " + T$(STR$(AsicPeek(&6003))), "127 2 199 0")
SpriteMove(9, -64, -30)
CHK("move_neg", T$(STR$(AsicPeek(&6048))) + " " + T$(STR$(AsicPeek(&6049))) + " " + T$(STR$(AsicPeek(&604A))) + " " + T$(STR$(AsicPeek(&604B))), "192 255 226 255")
SpriteMove(15, 1000, 300)
CHK("move_clamp_hi", T$(STR$(AsicPeek(&6078))) + " " + T$(STR$(AsicPeek(&6079))) + " " + T$(STR$(AsicPeek(&607A))) + " " + T$(STR$(AsicPeek(&607B))), "255 2 255 0")
SpriteMove(15, -300, -300)
CHK("move_clamp_lo", T$(STR$(AsicPeek(&6078))) + " " + T$(STR$(AsicPeek(&6079))) + " " + T$(STR$(AsicPeek(&607A))) + " " + T$(STR$(AsicPeek(&607B))), "0 255 0 255")
SpriteMove(15, -256, 255)
CHK("move_limits", T$(STR$(AsicPeek(&6078))) + " " + T$(STR$(AsicPeek(&6079))) + " " + T$(STR$(AsicPeek(&607A))) + " " + T$(STR$(AsicPeek(&607B))), "0 255 255 0")
SpriteMove(15, 767, -256)
CHK("move_limits2", T$(STR$(AsicPeek(&6078))) + " " + T$(STR$(AsicPeek(&6079))) + " " + T$(STR$(AsicPeek(&607A))) + " " + T$(STR$(AsicPeek(&607B))), "255 2 0 255")
SpriteMove(16, 1, 2)
CHK("move_n_masked", T$(STR$(AsicPeek(&6000))) + " " + T$(STR$(AsicPeek(&6002))), "1 2")
SpriteMove(15, 32767, -32768)
CHK("move_extremes", T$(STR$(AsicPeek(&6078))) + " " + T$(STR$(AsicPeek(&6079))) + " " + T$(STR$(AsicPeek(&607A))) + " " + T$(STR$(AsicPeek(&607B))), "255 2 0 255")

REM magnification and hiding don't touch the position, nor each other's sprites
SpriteMove(2, 300, 80)
SpriteMag(2, 4, 2)
SpriteMag(2, 1, 1)
SpriteMag(2, 0, 3)
SpriteMag(2, 3, 2)
SpriteHide(2)
CHK("mag_keeps_position", T$(STR$(AsicPeek(&6010))) + " " + T$(STR$(AsicPeek(&6011))) + " " + T$(STR$(AsicPeek(&6012))) + " " + T$(STR$(AsicPeek(&6013))), "44 1 80 0")
SpritesHideAll()
CHK("hideall_keeps_position", T$(STR$(AsicPeek(&6010))) + " " + T$(STR$(AsicPeek(&6012))) + " " + T$(STR$(AsicPeek(&6000))), "44 80 1")

PRINT "DONE"
END
