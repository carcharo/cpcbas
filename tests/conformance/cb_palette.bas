REM BARE: skip compares with the firmware's ink tables through __FW_CALL
REM SIM: skip waits for frame flybacks (WaitRetrace), which the simulator does not generate; chipsrun runs it
REM Conformance: cpcbuild palette (Phase 4c) -- the firmware's ink and
REM border tables after SetPalette, PalUpload, SetInk and SetBorder
REM (SCR_GET_INK / SCR_GET_BORDER), range handling, and that drawing
REM still works. What shows on the real screen (the Gate Array side) is
REM checked by tools/palette_check.py through screenshots, not here.
REM
REM Ported from cpcbuild. Changed with the language: $XX is &XX, bAND/bOR/bXOR are AND/OR/XOR,
REM STR$ is N$/T$ (Locomotive puts a space before a number that is not negative), CHR$ 13 is
REM CHR$(13). POINT is Pt, PLOT is PlotPx, SCREEN$ is the firmware read ReadChr (lib/pixel.bas);
REM PEN is penNo; CHK is lib/chkbuf.bas.

#include <cpc.bas>
#include "lib/pixel.bas"
#include <cpcbuild/display.bas>
#include <cpcbuild/palette.bas>

#include "lib/chkbuf.bas"

REM SCR_GET_INK (&BC35): A = pen -> B = first ink, C = second ink.
FUNCTION ReadChr() AS UBYTE
  ASM
  call .core.__FW_CALL
  defw $BB60
  END ASM
END FUNCTION

FUNCTION FASTCALL GetInk1(penNo AS UBYTE) AS UBYTE
  ASM
  call .core.__FW_CALL
  defw $BC35
  ld a, b
  END ASM
END FUNCTION
FUNCTION FASTCALL GetInk2(penNo AS UBYTE) AS UBYTE
  ASM
  call .core.__FW_CALL
  defw $BC35
  ld a, c
  END ASM
END FUNCTION
REM SCR_GET_BORDER (&BC3B): B, C = the border inks.
FUNCTION GetBorder1 AS UBYTE
  ASM
  call .core.__FW_CALL
  defw $BC3B
  ld a, b
  END ASM
END FUNCTION

DIM p(15) AS UBYTE
DIM i AS UBYTE
DIM before5, before7, before11 AS UBYTE
DIM s$ AS STRING

Mode 1
ScreenInit()

REM --- SetPalette: pens 0..count-1 ---
before5 = GetInk1(4)
before7 = GetInk1(7)
before11 = GetInk1(11)
p(0) = 5: p(1) = 10: p(2) = 15: p(3) = 20
SetPalette(@p(0), 4)
CHK("setpalette_0", N$(GetInk1(0)), "5")
CHK("setpalette_1", N$(GetInk1(1)), "10")
CHK("setpalette_2", N$(GetInk1(2)), "15")
CHK("setpalette_3", N$(GetInk1(3)), "20")
CHK("setpalette_not_flashing", N$(GetInk2(1)), "10")
CHK("setpalette_pen4_untouched", N$(GetInk1(4)), N$(before5))

REM --- PalUpload: pens first..first+count-1 ---
p(0) = 1: p(1) = 26: p(2) = 13
PalUpload(@p(0), 3, 8)
CHK("palupload_8", N$(GetInk1(8)), "1")
CHK("palupload_9", N$(GetInk1(9)), "26")
CHK("palupload_10", N$(GetInk1(10)), "13")
CHK("palupload_pen7_untouched", N$(GetInk1(7)), N$(before7))
CHK("palupload_pen11_untouched", N$(GetInk1(11)), N$(before11))

REM --- SetInk / SetBorder ---
SetInk(2, 24)
CHK("setink_a", N$(GetInk1(2)), "24")
CHK("setink_b", N$(GetInk2(2)), "24")
SetBorder(7)
CHK("setborder", N$(GetBorder1()), "7")
SetBorder(9)
CHK("setborder_again", N$(GetBorder1()), "9")
SetInk(16, 20)
CHK("setink_pen16_ignored_border", N$(GetBorder1()), "9")
CHK("setink_pen16_ignored_pen0", N$(GetInk1(0)), "5")

REM --- range handling: colour above 26, pens above 15, count 0 ---
SetInk(1, 30)
CHK("setink_bad_colour_ignored", N$(GetInk1(1)), "10")
SetBorder(40)
CHK("setborder_bad_colour_ignored", N$(GetBorder1()), "9")
p(0) = 2: p(1) = 3: p(2) = 4: p(3) = 5: p(4) = 6
PalUpload(@p(0), 5, 14)
CHK("palupload_pen14", N$(GetInk1(14)), "2")
CHK("palupload_pen15", N$(GetInk1(15)), "3")
CHK("palupload_stops_at_15_border", N$(GetBorder1()), "9")
PalUpload(@p(0), 0, 0)
CHK("count_0_nothing", N$(GetInk1(0)), "5")
p(0) = 99: p(1) = 12
PalUpload(@p(0), 2, 5)
REM changed: a true comparison is -1 in this language (it was 1); -( ) turns it back into 1, the expected value is unchanged.
CHK("bad_entry_skipped_pen5", N$(-(GetInk1(5) <> 99)), "1")
CHK("good_entry_after_bad_pen6", N$(GetInk1(6)), "12")

REM --- the firmware keeps what was set after its own frame work ran ---
WaitRetrace(3)
CHK("kept_after_frames", N$(GetInk1(2)) + " " + N$(GetBorder1()), "24 9")

REM --- drawing still works, with the new palette ---
SetInk(0, 0): SetInk(1, 26): SetInk(2, 6): SetInk(3, 18)
CLS
PokeScreen(5, 5, &FF)
CHK("poke_after_palette", N$(Pt(22, 194)), "3")
REM changed: PLOT is a later-phase statement; PlotPx (lib/pixel.bas) is the runtime plot.
PlotPx(100, 100)
CHK("plot_after_palette", N$(-(Pt(100, 100) <> 0)), "1")
PRINT AT 3, 3; "hello"
REM changed: SCREEN$(3, 3) (the reference's character read) is the firmware's TXT RD CHAR
REM (&BB60) at the same cell, through LOCATE; COPYCHR$ is a later-phase keyword.
LOCATE 4, 4
CHK("print_after_palette", CHR$(ReadChr()), "h")

REM Back to the firmware's defaults for this mode, so the results print
REM readably: blue paper, yellow ink, blue border.
SetInk(0, 1): SetInk(1, 24): SetInk(2, 20): SetInk(3, 6)
SetBorder(1)
CLS
Report()
PRINT "DONE"
END
