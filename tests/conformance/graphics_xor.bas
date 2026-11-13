REM BARE: skip the ink mode of PLOT and DRAW (XOR, AND, OR) is firmware only: a bare build refuses it with E270
REM SIM: skip the simulator's fake firmware has no GRA TEST ABSOLUTE and draws no pixels; chipsrun runs it
REM Conformance: the ink mode (OVER 1 of the original) of PLOT and DRAW, and a CIRCLE drawn in XOR mode.
REM
REM Split from cpcbuild's graphics.bas. OVER 1 is the fourth argument of PLOT/DRAW, the ink mode 1
REM (XOR); it stays set until changed, so each check ends by setting mode 0 again. PLOT 60, 60 is
REM mode 1 pixel (30, 30): Locomotive's units are 640 x 400. CIRCLE draws in the current ink mode
REM (it goes through the firmware's GRA PLOT), so the original's "CIRCLE OVER 1" erases the circle
REM by drawing it again in XOR mode. (The original's "DRAW OVER 1 leaves the start point lit, like the
REM Spectrum" is dropped: it is a Spectrum rule.)

#include "lib/chkbuf.bas"

FUNCTION CountBox(x0 AS INTEGER, y0 AS INTEGER, x1 AS INTEGER, y1 AS INTEGER) AS UINTEGER
  DIM x, y AS INTEGER
  DIM n AS UINTEGER
  n = 0
  FOR y = y0 TO y1
    FOR x = x0 TO x1
      IF POINT(x, y) <> 0 THEN n = n + 1
    NEXT x
  NEXT y
  RETURN n
END FUNCTION

MODE 1

REM --- XOR plot ---
PLOT 60, 60, 1, 0
PLOT 60, 60, 1, 1
CHK("xor_plot_erases", N$(POINT(30, 30)), "0")
PLOT 60, 60, 1, 1
CHK("xor_plot_redraws", N$(POINT(30, 30)), "1")
PLOT 60, 60, 1, 0

REM --- XOR draw: a line drawn twice disappears ---
PLOT 80, 200, 1, 0
DRAW 100, 200, 1, 1
CHK("xor_draw_mid", N$(POINT(45, 100)), "1")
CHK("xor_draw_end", N$(POINT(50, 100)), "1")
PLOT 80, 200, 1, 1
DRAW 100, 200, 1, 1
CHK("xor_draw_twice_mid", N$(POINT(45, 100)), "0")
CHK("xor_draw_twice_end", N$(POINT(50, 100)), "0")
PLOT 0, 0, 1, 0

REM --- a circle drawn twice in XOR mode erases every pixel: each one is plotted exactly once ---
DIM before, drawn, erased AS UINTEGER
before = CountBox(240, 140, 270, 170)
PLOT 0, 0, 1, 1
CIRCLE 255, 155, 12
drawn = CountBox(240, 140, 270, 170)
CIRCLE 255, 155, 12
erased = CountBox(240, 140, 270, 170)
PLOT 0, 0, 1, 0
CHK("circle_box_empty", N$(before), "0")
CHK("circle_drawn", N$(-(drawn > 60)), "1")
CHK("circle_xor_erases", N$(erased), "0")

PRINT
Report()
PRINT "DONE"
END
