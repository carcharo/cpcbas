REM BARE: only
REM Conformance (bare-metal mode): the BEEP statement, the four forms the compiler has: constant arguments,
REM run-time arguments (REAL maths), a negative pitch and a zero duration. Follow-up 108: run by hand on
REM 2026-11-09 (the 464 and 6128 discs and the Plus cartridge printed all four lines), now a program.
REM
REM What the AY holds is read back after each BEEP (period of tone A, mixer, volume), once the note has
REM played: BEEP in a bare build is blocking and silences the chip at the end, so the check is made by a
REM frame hook that snapshots the registers at the first loud frame (as bare_sound.bas does, which also
REM checks the timing). No PRINT: lib/bareout.bas writes to the printer port.

#include <cpc.bas>
#include <framehook.bas>
#include "lib/bareout.bas"

DIM bb_seen, bb_r0, bb_r1, bb_r7, bb_r8 AS UBYTE

ASM
  jp bb_skip
bb_hook:                        ; frame hook: interrupts off, registers saved
  ld a, 8
  call .core.__CPC_AY_READ
  and $0F
  jr z, bb_quiet
  ld a, (_bb_seen)
  or a
  jr nz, bb_quiet
  inc a
  ld (_bb_seen), a             ; the first loud frame: snapshot
  xor a
  call .core.__CPC_AY_READ
  ld (_bb_r0), a
  ld a, 1
  call .core.__CPC_AY_READ
  ld (_bb_r1), a
  ld a, 7
  call .core.__CPC_AY_READ
  ld (_bb_r7), a
  ld a, 8
  call .core.__CPC_AY_READ
  ld (_bb_r8), a
bb_quiet:
  ret
bb_skip:
END ASM

SUB BbReset()
  bb_seen = 0
  bb_r0 = 0
  bb_r1 = 0
END SUB

FUNCTION Period() AS UINTEGER
  RETURN bb_r0 + 256 * (bb_r1 AND 15)
END FUNCTION

DIM d AS REAL
DIM p AS INTEGER

ASM
  ld hl, bb_hook
  ld (.core.FH_ADDR), hl
END ASM
SoundStop

REM 1: constant arguments, middle C = period 239
BbReset()
BEEP 0.2, 0
BCHK("beep1_seen", bb_seen, 1)
BCHK("beep1_period", Period(), 239)
BCHK("beep1_volume", bb_r8, 15)
BCHK("beep1_silent", AyRead(8), 0)

REM 2: run-time arguments, pitch 12 = period 119
d = 0.2
p = 12
BbReset()
BEEP d, p
BCHK("beep2_seen", bb_seen, 1)
BCHK("beep2_period", Period(), 119)
BCHK("beep2_silent", AyRead(8), 0)

REM 3: a negative pitch, an octave down = period 478
p = -12
BbReset()
BEEP d, p
BCHK("beep3_period", Period(), 478)

REM 4: a zero duration plays nothing
BbReset()
BEEP 0, 0
BCHK("beep4_nothing", bb_seen, 0)

BDone()
