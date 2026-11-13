REM Ticks(): a 300 Hz clock in both modes.
REM Firmware: KL TIME PLEASE (&BD0D), DEHL = the 300 Hz clock.
REM Bare metal: Frames() (50 Hz, from the bare interrupt handler) * 6, so the same units
REM but 1/50 s granularity.
REM
REM Ported from cpcbuild. A function's result is its RETURN, so the firmware branch
REM leaves DEHL in a global (tickAnswer) and returns that.

#ifndef __CONF_TICKS__
#define __CONF_TICKS__

#ifdef CPC_BAREMETAL
#include <framehook.bas>
FUNCTION Ticks() AS ULONG
  RETURN Frames() * 6
END FUNCTION
#else
DIM tickAnswer AS ULONG
tickAnswer = 0
FUNCTION Ticks() AS ULONG
  ASM
  call .core.__FW_CALL
  defw $BD0D
  ld (_tickAnswer), hl
  ld (_tickAnswer + 2), de
  END ASM
  RETURN tickAnswer
END FUNCTION
#endif

#endif
