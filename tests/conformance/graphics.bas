REM SIM: skip the simulator's fake firmware has no GRA TEST ABSOLUTE and draws no pixels; chipsrun runs it
REM Conformance: graphics and colour (PLOT, DRAW, CIRCLE, GRAPHICS PEN, MODE, POINT).
REM
REM Pixels are read back with POINT (the mode's pixels, origin bottom-left, as the fork's was), which
REM returns the pixel's pen.
REM
REM Ported from cpcbuild. Changed with the language:
REM - PLOT and DRAW take Locomotive's units (640 x 400 whatever the mode), so the original's
REM   mode 1 pixel (x, y) is PLOT 2x, 2y and a DRAW distance is doubled; POINT and CIRCLE keep the
REM   mode's pixels (the fork's aliases).
REM - PLOT INK 2; is PLOT x, y, pen: Spectrum red/green were pens 3 and 2 in mode 1 and are now those
REM   pens; PLOT INVERSE 1 is pen 0; permanent INK 5 is GRAPHICS PEN 2.
REM - OVER 1 (XOR) is the ink mode of PLOT/DRAW: firmware only, in graphics_xor.bas. DRAW with an
REM   arc (DRAW x, y, angle) is Spectrum only and is dropped, with CIRCLE OVER.
REM - The mode checks use the pens Locomotive gives (pen 4 and 12 in mode 0 as before: the pen is
REM   what PLOT's third argument says).
REM - The text colour checks use PEN and PAPER (pens): CHR$ 143 is the full block on both machines.

#include <cpc.bas>
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

REM --- PLOT, default colour, exact pixel addressing (mode 1 pixel (x, y) is unit 2x, 2y) ---
PLOT 20, 20
CHK("plot_default_pen", N$(POINT(10, 10)), "1")
CHK("plot_neighbour_x", N$(POINT(11, 10)), "0")
CHK("plot_neighbour_y", N$(POINT(10, 11)), "0")
PLOT 638, 398
CHK("plot_top_right", N$(POINT(319, 199)), "1")
PLOT 0, 0
CHK("plot_origin", N$(POINT(0, 0)), "1")

REM --- pens ---
PLOT 40, 40, 3
CHK("plot_pen3", N$(POINT(20, 20)), "3")
PLOT 42, 40, 2
CHK("plot_pen2", N$(POINT(21, 20)), "2")
PLOT 40, 40, 0
CHK("plot_pen0_paper", N$(POINT(20, 20)), "0")
GRAPHICS PEN 2
PLOT 44, 40
CHK("graphics_pen2", N$(POINT(22, 20)), "2")
GRAPHICS PEN 1

REM --- DRAW ---
PLOT 0, 100
DRAW 200, 100
CHK("draw_mid", N$(POINT(50, 50)), "1")
CHK("draw_end", N$(POINT(100, 50)), "1")
CHK("draw_past_end", N$(POINT(101, 50)), "0")
DRAW 100, 140
CHK("draw_continues", N$(POINT(50, 70)), "1")
CHK("draw_diag_mid", N$(POINT(75, 60)), "1")
REM DRAWR is relative to the cursor, which DRAW left at (100, 140)
DRAWR 40, 0
CHK("drawr_end", N$(POINT(70, 70)), "1")
CHK("drawr_past_end", N$(POINT(71, 70)), "0")
CHK("cursor_after_drawr", N$(XPOS) + "," + N$(YPOS), "140,140")

REM --- CIRCLE (the fork's alias: the mode's pixels, every pixel once) ---
CIRCLE 160, 100, 20
CHK("circle_right", N$(POINT(180, 100)), "1")
CHK("circle_top", N$(POINT(160, 120)), "1")
CHK("circle_left", N$(POINT(140, 100)), "1")
CHK("circle_bottom", N$(POINT(160, 80)), "1")
CHK("circle_centre", N$(POINT(160, 100)), "0")
DIM before, drawn AS UINTEGER
before = CountBox(240, 140, 270, 170)
CIRCLE 255, 155, 12
drawn = CountBox(240, 140, 270, 170)
CHK("circle_box_empty", N$(before), "0")
CHK("circle_drawn", N$(-(drawn > 60)), "1")

REM --- text colours (read back from a character cell's pixels) ---
REM Row 23 covers pixel rows 15 down to 8; CHR$ 143 is a solid block.
PEN 3
PRINT AT 23, 0; CHR$(143);
PEN 1
PAPER 2
PRINT " ";
PAPER 0
CHK("text_pen3", N$(POINT(3, 12)), "3")
CHK("text_paper2", N$(POINT(11, 12)), "2")

REM --- modes ---
MODE 0
CHK("getmode_0", N$(GetMode()), "0")
PLOT 636, 398, 4
CHK("mode0_plot_pen4", N$(POINT(159, 199)), "4")
PLOT 0, 0, 3
CHK("mode0_pen3", N$(POINT(0, 0)), "3")
PLOT 4, 0, 12
CHK("mode0_pen12", N$(POINT(1, 0)), "12")
MODE 2
REM the graphics pen survives MODE (it was 12 above, which mode 2 shows as pen 0): say pen 1
PLOT 639, 0, 1
CHK("mode2_plot", N$(POINT(639, 0)), "1")
CHK("mode2_neighbour", N$(POINT(638, 0)), "0")
MODE 1
CHK("mode1_cleared", N$(POINT(10, 10)), "0")

PRINT
Report()
PRINT "DONE"
END
