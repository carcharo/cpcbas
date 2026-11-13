REM Pt(x, y): the pen of the pixel at x, y, in the same coordinates as PLOT (the current mode's
REM pixels, origin bottom-left); 0 for a point off the screen.
REM
REM Ported from cpcbuild's point.bas (the reference compiler's POINT). cpcbas has no POINT yet
REM (graphics are L4), and these programs use it as an independent check of the library's screen
REM addressing, so the conformance suite carries its own. Same routine as the original:
REM   firmware: GRA ASK CURSOR (&BBC6) is saved, GRA TEST ABSOLUTE (&BBF0) reads the pixel, the
REM             cursor is put back with GRA MOVE ABSOLUTE (&BBC0);
REM   bare metal (-D CPC_BAREMETAL): gfxbare.asm's __GR_POINT reads screen memory.
REM Changed: the result is the ASM block's register A (a FUNCTION whose ASM leaves it there).

#ifndef __CONF_PIXEL__
#define __CONF_PIXEL__

FUNCTION Pt(x AS INTEGER, y AS INTEGER) AS UBYTE
  #require "gfx.asm"
  ASM
  push namespace core
#ifdef CPC_BAREMETAL
  ld e, (ix+4)
  ld d, (ix+5)
  ld l, (ix+6)
  ld h, (ix+7)
  call __GR_POINT
#else
  call .core.__FW_CALL
  defw $BBC6
  push de
  push hl
  ld e, (ix+4)
  ld d, (ix+5)
  ld l, (ix+6)
  ld h, (ix+7)
  call __GRA_XY
  call .core.__FW_CALL
  defw $BBF0
  pop hl
  pop de
  push af
  call .core.__FW_CALL
  defw $BBC0
  pop af
#endif
  pop namespace
  END ASM
END FUNCTION

REM PlotPx(x, y): plot x, y (mode pixels, origin bottom-left) in the firmware's graphics pen
REM (pen 1 after a MODE): GRA PLOT ABSOLUTE (&BBEA) after the runtime's __GRA_XY scaling. PLOT is
REM a later-phase statement; cb_palette plots one point. Firmware mode only.
#ifndef CPC_BAREMETAL
SUB PlotPx(x AS INTEGER, y AS INTEGER)
  #require "gfx.asm"
  ASM
  push namespace core
  ld e, (ix+4)
  ld d, (ix+5)
  ld l, (ix+6)
  ld h, (ix+7)
  call __GRA_XY
  call .core.__FW_CALL
  defw $BBEA
  pop namespace
  END ASM
END SUB
#endif

#endif
