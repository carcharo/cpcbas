REM SIM: skip the simulator's fake firmware draws no pixels (GRA TEST ABSOLUTE for POINT) and has no TXT SET MATRIX; chipsrun runs it
REM Conformance: user-defined characters (SYMBOL), the CPC's block graphics CHR$ 128-143 and
REM the characters above the redefinable ones.
REM
REM Ported from cpcbuild. Changed with the language: POKE USR "a" is SYMBOL c, rows (Locomotive's
REM UDG form; SYMBOL AFTER 240 is the default, so the first character is 240), and the three
REM USR address checks are dropped (they tested the Spectrum's UDG table at USR "a"; here the
REM table is the compiler's and its address is not part of the language). POINT is the L4
REM graphics POINT (mode pixels, as the fork's was). The block graphics CHR$ 128-143 are in
REM udg_blocks.bas.
REM
REM Character cells are read back with POINT (pens). Mode 1, row 23 covers pixel rows 15 (top)
REM down to 8, column c covers x 8c to 8c+7. The quadrants of a cell are 4x4 pixels.

#include "lib/chkbuf.bas"

REM Lit pixels in a w x h box with bottom-left corner (x, y).
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

DIM i AS UBYTE

MODE 1
CLS

REM --- define character 240 as a top-half block, 245 as a left-half block ---
SYMBOL 240, 255, 255, 255, 255, 0, 0, 0, 0
SYMBOL 245, &F0, &F0, &F0, &F0, &F0, &F0, &F0, &F0
PRINT AT 23, 0; CHR$(240); CHR$(245);
CHK("udg_a_top_lit", N$(Lit(0, 12, 8, 4)), "32")
CHK("udg_a_bottom_unlit", N$(Lit(0, 8, 8, 4)), "0")
CHK("udg_u_left_lit", N$(Lit(8, 8, 4, 8)), "32")
CHK("udg_u_right_unlit", N$(Lit(12, 8, 4, 8)), "0")

REM Redefining a character changes the next PRINT of it
SYMBOL 240, 255, 255, 255, 255, 0, 0, 0, 255
PRINT AT 23, 2; CHR$(240);
CHK("udg_redefined", N$(Lit(16, 8, 8, 1)), "8")

REM --- characters past the redefinable ones keep the CPC's own glyphs ---
PRINT AT 23, 12; CHR$(165); CHR$(255);
CHK("chr165_not_blank", N$(-(Lit(96, 8, 8, 8) > 0)), "1")
CHK("chr255_not_blank", N$(-(Lit(104, 8, 8, 8) > 0)), "1")
REM and ordinary text still works
PRINT AT 23, 16; "A";
CHK("letter_a_not_blank", N$(-(Lit(128, 8, 8, 8) > 0)), "1")

PRINT AT 0, 0;
Report()
PRINT "DONE"
END
