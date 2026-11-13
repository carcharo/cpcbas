REM Conformance: input, timing, sound and text width (INKEY$, PAUSE, BEEP, BORDER and the
REM mode-dependent PRINT AT/TAB/comma).
REM
REM Times are measured on the 300 Hz tick count (KL TIME PLEASE in firmware builds, the frame counter
REM x 6 in bare ones): PAUSE n waits n frames = 6n ticks, BEEP d waits until the tone (d * 100
REM hundredths) has played = about 300d ticks.
REM
REM Ported from cpcbuild. Changed with the language: POS()/CSRLIN() are POS(#0)/VPOS(#0), counting from 1;
REM the original's Spectrum BORDER (BORDER 2 is red, firmware ink 6) is Locomotive's (BORDER takes the
REM firmware ink number: BORDER 2 is ink 2), so BORDER 2 reads back 2 and BORDER 0 reads back 0.
REM TAB(n) is Locomotive's (column n, 1-based, modulo the width in mode 0: TAB(25) is column 5) and
REM the comma goes to the next 13-column zone, or to the start of the next line when the zone does not fit
REM (mode 0 is 20 wide), all measured on the interpreter.
REM The tone period BEEP queues is still read from the runtime's SOUND_BLK (firmware builds: &9EAF) or the
REM AY's registers (bare builds).

#include <cpc.bas>
#include "lib/chkbuf.bas"
#include "lib/ticks.bas"

SUB CHKRANGE(name AS STRING, gotv AS ULONG, lo AS ULONG, hi AS ULONG)
  IF gotv >= lo AND gotv <= hi THEN
    CHK(name, "ok", "ok")
  ELSE
    CHK(name, T$(STR$(gotv)), T$(STR$(lo)) + ".." + T$(STR$(hi)))
  END IF
END SUB

REM Border colour (firmware ink 0-26). Firmware: SCR GET BORDER (&BC3B) -> B. Bare metal: the runtime's
REM palette shadow (PAL_SHADOW + 16), which holds the same firmware colour number.
#ifdef CPC_BAREMETAL
FUNCTION FASTCALL BorderColour AS UBYTE
  ASM
  ld a, (.core.PAL_SHADOW + 16)
  END ASM
END FUNCTION
#else
FUNCTION FASTCALL BorderColour AS UBYTE
  ASM
  call .core.__FW_CALL
  defw $BC3B
  ld a, b
  END ASM
END FUNCTION
#endif

REM The tone period the last BEEP queued. Firmware: the runtime's SOUND_BLK (period at &9EAF).
REM Bare metal: tone A's period registers (0, 1), which BEEP leaves set.
FUNCTION BeepPeriod() AS UINTEGER
#ifdef CPC_BAREMETAL
  RETURN CAST(UINTEGER, AyRead(0)) + 256 * CAST(UINTEGER, AyRead(1))
#else
  RETURN PEEK(UINTEGER, &9EAF)
#endif
END FUNCTION

DIM t0, t1 AS ULONG

REM --- INKEY$: no key is held ---
CHK("inkey_empty", N$(LEN(INKEY$)), "0")

REM --- PAUSE ---
t0 = Ticks()
PAUSE 50
t1 = Ticks()
CHKRANGE("pause_50_frames", t1 - t0, 294, 312)

t0 = Ticks()
PAUSE 1
t1 = Ticks()
CHKRANGE("pause_1_frame", t1 - t0, 5, 12)

REM --- BEEP, constant arguments ---
t0 = Ticks()
BEEP 0.5, 0
t1 = Ticks()
CHKRANGE("beep_const_0.5s", t1 - t0, 140, 170)
CHK("beep_const_middle_c_period", N$(BeepPeriod()), "239")

REM --- BEEP, run-time arguments ---
DIM d, p AS REAL
d = 0.25
p = 7
t0 = Ticks()
BEEP d, p
t1 = Ticks()
#ifdef CPC_BAREMETAL
REM 13 whole frames plus the wait for a frame boundary plus the float maths: 1/50 s granularity
CHKRANGE("beep_runtime_0.25s", t1 - t0, 65, 110)
#else
CHKRANGE("beep_runtime_0.25s", t1 - t0, 65, 95)
#endif
REM 62500 / (261.6256 * 2^(7/12)) = 159.4
CHK("beep_runtime_period", N$(BeepPeriod()), "159")
p = -12
d = 0.05
BEEP d, p
CHK("beep_runtime_octave_down", N$(BeepPeriod()), "478")

REM A zero duration plays nothing: no note is queued (the period stays at 478, though p now asks for
REM 239) and BEEP returns without waiting.
d = 0
p = 0
t0 = Ticks()
BEEP d, p
t1 = Ticks()
CHK("beep_zero_no_note", N$(BeepPeriod()), "478")
CHKRANGE("beep_zero_duration", t1 - t0, 0, 25)

REM --- BORDER n is firmware ink n ---
BORDER 2
CHK("border_ink2", N$(BorderColour()), "2")
BORDER 0
CHK("border_ink0", N$(BorderColour()), "0")
SetBorder 13
CHK("setborder_hw", N$(BorderColour()), "13")
BORDER 1

REM --- text width follows the mode ---
MODE 0
PRINT AT 2, 19; "X";
CHK("mode0_last_col_wraps", N$(VPOS(#0)) + "," + N$(POS(#0)), "4,1")
PRINT AT 4, 0; TAB(25);
CHK("mode0_tab_mod20", N$(POS(#0)), "5")
PRINT AT 5, 3; ,;
CHK("mode0_comma_next_line", N$(VPOS(#0)) + "," + N$(POS(#0)), "7,1")
MODE 2
PRINT AT 2, 79; "X";
CHK("mode2_last_col_wraps", N$(VPOS(#0)) + "," + N$(POS(#0)), "4,1")
PRINT AT 4, 0; TAB(70);
CHK("mode2_tab", N$(POS(#0)), "70")
PRINT AT 5, 45; ,;
CHK("mode2_comma_zone", N$(VPOS(#0)) + "," + N$(POS(#0)), "6,53")
MODE 1
PRINT AT 2, 39; "X";
CHK("mode1_last_col_wraps", N$(VPOS(#0)) + "," + N$(POS(#0)), "4,1")
PRINT AT 4, 3; ,;
CHK("mode1_comma_zone", N$(POS(#0)), "14")
CLS

PRINT
Report()
PRINT "DONE"
END
