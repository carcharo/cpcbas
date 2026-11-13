REM SIM: skip the simulator's fake firmware draws no pixels (GRA TEST ABSOLUTE for POINT is not modelled); chipsrun runs it
REM Conformance: a custom font for characters 32-127 (SYMBOL AFTER 32 and SYMBOL), and how it
REM coexists with the characters defined above and the CPC glyphs above 127.
REM
REM Ported from cpcbuild's SetFont test. Changed with the language: SetFont(@font) is the Spectrum
REM library's call and does not exist here; Locomotive's way is SYMBOL AFTER 32 (a build-time
REM constant: the first redefinable character) and one SYMBOL per character. The font data arrays
REM became FOR loops, and the original's 3 USR checks (the table's address) are dropped as in udg.bas.
REM "UDG defined before SetFont" is a SYMBOL made before the first redefinition of 32-127, "after"
REM one made after it; the second font is a second set of SYMBOLs over the first.
REM
REM Character cells are read back with POINT (pens). Mode 1, row r covers pixel rows 199-8r (top)
REM down to 192-8r, column c covers x 8c to 8c+7.

#include "lib/chkbuf.bas"

SYMBOL AFTER 32

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

DIM c AS UBYTE
DIM k AS UBYTE

MODE 1
CLS

REM --- before the font: two characters defined above 127 (the original's UDGs "a" and "c") ---
SYMBOL 144, &AA, &AA, &AA, &AA, &AA, &AA, &AA, &AA
SYMBOL 146, 255, 0, 0, 0, 0, 0, 0, 0

REM The first font: every character 32-127 is a solid block; 'A' (65) is a top-half block,
REM 'B' (66) a left-half block.
FOR c = 32 TO 127
  SYMBOL c, 255, 255, 255, 255, 255, 255, 255, 255
NEXT c
SYMBOL 65, 255, 255, 255, 255, 0, 0, 0, 0
SYMBOL 66, &F0, &F0, &F0, &F0, &F0, &F0, &F0, &F0

REM Row 23 = pixel rows 15..8; columns 0.. from x = 0.
PRINT AT 23, 0; "AB@";
CHK("A_top_half", N$(Lit(0, 12, 8, 4)) + "/" + N$(Lit(0, 8, 8, 4)), "32/0")
CHK("B_left_half", N$(Lit(8, 8, 4, 8)) + "/" + N$(Lit(12, 8, 4, 8)), "32/0")
CHK("at_solid", N$(Lit(16, 8, 8, 8)), "64")

PRINT AT 22, 0; "z~ ";
REM char 32 (space) is a solid block now too
CHK("z_solid", N$(Lit(0, 16, 8, 8)), "64")
CHK("tilde_solid", N$(Lit(8, 16, 8, 8)), "64")
CHK("space_solid", N$(Lit(16, 16, 8, 8)), "64")

REM --- a character above 127 keeps a CPC glyph ---
PRINT AT 21, 0; CHR$(200); CHR$(255);
CHK("chr200_not_blank", N$(-(Lit(0, 24, 8, 8) > 0)), "1")
CHK("chr200_not_solid", N$(-(Lit(0, 24, 8, 8) < 64)), "1")
CHK("chr255_not_blank", N$(-(Lit(8, 24, 8, 8) > 0)), "1")

REM --- a character defined before the font survives ---
PRINT AT 20, 0; CHR$(144); CHR$(146);
CHK("udg_a_before_survives", N$(Lit(0, 32, 8, 8)), "32")
REM (the second was defined with the top row only lit)
CHK("udg_c_top_row", N$(Lit(8, 39, 8, 1)), "8")

REM --- a character defined after the font works ---
SYMBOL 147, &0F, &0F, &0F, &0F, &0F, &0F, &0F, &0F
PRINT AT 19, 0; CHR$(147);
CHK("udg_d_after_right", N$(Lit(4, 40, 4, 8)) + "/" + N$(Lit(0, 40, 4, 8)), "32/0")

REM --- a second font replaces the glyphs ---
FOR c = 32 TO 127
  SYMBOL c, 0, 0, 0, 0, 0, 0, 0, 0
NEXT c
SYMBOL 65, &0F, &0F, &0F, &0F, &0F, &0F, &0F, &0F
PRINT AT 18, 0; "AB";
CHK("second_A_right_half", N$(Lit(4, 48, 4, 8)) + "/" + N$(Lit(0, 48, 4, 8)), "32/0")
CHK("second_B_blank", N$(Lit(8, 48, 8, 8)), "0")
REM the character defined earlier is still fine after the second font
PRINT AT 17, 0; CHR$(147);
CHK("udg_d_after_second", N$(Lit(4, 56, 4, 8)), "32")

PRINT AT 0, 0;
Report()
PRINT "DONE"
END
