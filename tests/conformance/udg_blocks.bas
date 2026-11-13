REM SIM: skip the simulator's fake firmware has no GRA TEST ABSOLUTE and draws no pixels; chipsrun runs it
REM Conformance: the CPC's block graphics CHR$ 128-143.
REM
REM Split from cpcbuild's udg.bas. The firmware's blocks are not the Spectrum's: bit 0 of
REM CHR$(128 + n) is the top LEFT quadrant, bit 1 top right, bit 2 bottom left, bit 3 bottom right
REM (CPC manual, appendix III), so cpcbuild's "129 top right, 130 top left, 132 bottom right,
REM 136 bottom left" became 129 top left, 130 top right, 132 bottom left, 136 bottom right. Bare
REM builds use the same layout (txtglyph.asm, follow-up 130), so this program runs bare too.
REM Mode 1, row 23 covers pixel rows 15 (top) down to 8, column c covers x 8c to 8c+7.

#include "lib/chkbuf.bas"

FUNCTION Lit(x AS INTEGER, y AS INTEGER, w AS INTEGER, h AS INTEGER) AS UINTEGER
  DIM i, j AS INTEGER
  DIM n AS UINTEGER
  n = 0
  FOR j = y TO y + h - 1
    FOR i = x TO x + w - 1
      IF POINT(i, j) <> 0 THEN n = n + 1
    NEXT i
  NEXT j
  RETURN n
END FUNCTION

MODE 1
CLS

PRINT AT 23, 4; CHR$(129); CHR$(130); CHR$(132); CHR$(136); CHR$(143); CHR$(128);
CHK("block_129_top_left", N$(Lit(32, 12, 4, 4)) + "/" + N$(Lit(32, 8, 8, 8)), "16/16")
CHK("block_130_top_right", N$(Lit(44, 12, 4, 4)) + "/" + N$(Lit(40, 8, 8, 8)), "16/16")
CHK("block_132_bottom_left", N$(Lit(48, 8, 4, 4)) + "/" + N$(Lit(48, 8, 8, 8)), "16/16")
CHK("block_136_bottom_right", N$(Lit(60, 8, 4, 4)) + "/" + N$(Lit(56, 8, 8, 8)), "16/16")
CHK("block_143_full", N$(Lit(64, 8, 8, 8)), "64")
CHK("block_128_empty", N$(Lit(72, 8, 8, 8)), "0")

PRINT AT 0, 0;
Report()
PRINT "DONE"
END
