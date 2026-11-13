REM MODELS: 6128 plus
REM BARE: skip COPYCHR$ is firmware only (TXT RD CHAR); the bare build refuses it with E270
REM SIM: skip the simulator's fake firmware has no TXT RD CHAR (COPYCHR$); chipsrun runs it
REM Conformance: COPYCHR$(#0) (firmware TXT RD CHAR).
REM
REM Ported from cpcbuild's SCREEN$(row, col) test. Changed with the language: SCREEN$(r, c) is
REM LOCATE c+1, r+1 and COPYCHR$(#0), which is the BASIC 1.1 function (6128 and Plus: the 464 has
REM none, hence MODELS) and returns the empty string where the firmware does not recognise a cell;
REM the cursor is where COPYCHR$ read, so the original's "cursor unchanged" checks are replaced by
REM "the cursor stays on the cell read" (a read does not move it). INK/PAPER in PRINT are PEN and PAPER
REM statements (pens, not Spectrum colours); the plotted pixel is PLOT in Locomotive units
REM ((7, 143) of the original is (14, 286) here); CODE is ASC. Dropped: the original's
REM "paper2_ink4_misread" (a pen and a paper both changed misread by the firmware: bare mode only read it
REM back, the firmware's behaviour is not part of the language) and the two out-of-range cells
REM (col 40, row 25), which LOCATE turns into a wrap.

#include "lib/chkbuf.bas"

REM The character at row, col (0-based as the original's SCREEN$), "none" if COPYCHR$ gives nothing
FUNCTION Cd(row AS UBYTE, col AS UBYTE) AS STRING
  DIM s AS STRING
  LOCATE col + 1, row + 1
  s = COPYCHR$(#0)
  IF LEN(s) = 0 THEN RETURN "none"
  RETURN N$(ASC(s))
END FUNCTION

DIM i AS UBYTE

MODE 1
CLS
PRINT AT 2, 0; "A7!";
PRINT AT 2, 5; " ";
CHK("letter", Cd(2, 0), "65")
CHK("digit", Cd(2, 1), "55")
CHK("punct", Cd(2, 2), "33")
CHK("space", Cd(2, 5), "32")

REM different pen
PEN 2
PRINT AT 3, 0; "B";
PEN 1
CHK("pen2", Cd(3, 0), "66")

REM different paper: PAPER 1 is pen 1, the same pen as the default ink, PAPER 2 is a pen of its own
PAPER 2
PRINT AT 4, 0; "C";
PAPER 0
CHK("paper2_default_pen", Cd(4, 0), "67")

REM Spectrum block graphics numbers are the CPC's block graphics here (CHR$ 128-143)
PRINT AT 5, 0; CHR$(129); CHR$(130); CHR$(132); CHR$(136); CHR$(143); CHR$(128);
CHK("block129", Cd(5, 0), "129")
CHK("block130", Cd(5, 1), "130")
CHK("block132", Cd(5, 2), "132")
CHK("block136", Cd(5, 3), "136")
CHK("block143", Cd(5, 4), "143")
REM CHR$ 128 is an empty cell: reads back as a space
CHK("block128_is_space", Cd(5, 5), "32")

REM a redefined character
SYMBOL 240, &F0, &F1, &F2, &F3, &F4, &F5, &F6, &F7
PRINT AT 6, 0; CHR$(240);
CHK("udg", Cd(6, 0), "240")

REM a plotted pixel over a letter changes the cell: it no longer matches any character
REM (text row 7 is pixel y 136-143 from the bottom: 8 * (24 - 7); x = 7 is the glyph's blank right
REM column; in Locomotive units, 2 per mode 1 pixel across and 2 per pixel up: x 14, y 286)
PRINT AT 7, 0; "D";
PLOT 14, 286, 1
CHK("plotted", Cd(7, 0), "none")

REM out of range: a cell outside the screen is not a cell (LOCATE past the width wraps instead:
REM the original's col 40 and row 25 are not tried here), the last cell is
CHK("col39_mode1", Cd(2, 39), "32")
CHK("row24", Cd(24, 0), "32")

REM the cursor stays where it read
LOCATE 8, 10
s$ = COPYCHR$(#0)
CHK("cursor_row", N$(VPOS(#0)), "10")
CHK("cursor_col", N$(POS(#0)), "8")

REM mode 0
MODE 0
CLS
PRINT AT 1, 19; "Z";
CHK("mode0_col19", Cd(1, 19), "90")

REM mode 2
MODE 2
CLS
PRINT AT 1, 79; "Y";
CHK("mode2_col79", Cd(1, 79), "89")

MODE 1
CLS
PRINT
Report()
PRINT "DONE"
END
