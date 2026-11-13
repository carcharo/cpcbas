REM BARE: skip SOUND, ENV, SQ and RELEASE are the firmware sound manager (E270 in a bare build)
REM SIM: skip the simulator's fake firmware has no sound manager (SOUND, SQ) and no AY; chipsrun runs it
REM Conformance: the firmware sound manager through the Locomotive statements (SOUND, ENV, SQ, RELEASE),
REM and BEEP.
REM The firmware's sound manager plays from the 300 Hz interrupt handler, so what is checked is
REM behaviour: that SOUND returns at once when the queue has room (timed with KL TIME PLEASE), the
REM queue counts (SQ), and what the AY chip holds while notes play (read back with AyRead: tone period
REM regs 0-5, volume regs 8-10). No audio check is possible (the emulator can't record sound).
REM Period = 62500 / frequency, as BEEP.
REM
REM Ported from cpcbuild. Changed with the language:
REM - SoundQueue/SoundFree/SoundBusy are SOUND and SQ(channel): bits 0-2 are the free queue entries,
REM   bit 7 a note playing. SOUND does not return "queued or not": it waits while the queue is full (as
REM   BASIC does), so "full returns 0" became "SQ says no free entry" and "a SOUND on a full queue waits".
REM - SoundEnvelope n, @data, sections is ENV n, steps, size, pause (a section a time); its data array
REM   "was copied" check is dropped (the statement takes numbers).
REM - SoundStop is the library's (cpc.bas: the firmware's SOUND RESET); the language has no stop statement.
REM - The original's "period clamped to 4095" is dropped: Locomotive refuses a period over 4095 (error 5).
REM - Wait is WaitTicks (WAIT is a statement now).
REM - The 464 is told by the build (-D CPC464, which the runner adds) instead of its interrupt handler address.

#include <cpc.bas>
#include "lib/chkbuf.bas"
#include "lib/ticks.bas"

REM Wait n ticks (1/300 s) of the clock.
SUB WaitTicks(n AS UINTEGER)
  DIM t0 AS ULONG
  t0 = Ticks()
  DO
  LOOP UNTIL Ticks() - t0 >= n
END SUB

REM Tone period of channel ch (0-2) as the AY holds it.
FUNCTION Per(ch AS UBYTE) AS UINTEGER
  RETURN CAST(UINTEGER, AyRead(ch * 2 + 1) AND 15) * 256 + AyRead(ch * 2)
END FUNCTION

REM Volume of channel ch (0-2).
FUNCTION Vol(ch AS UBYTE) AS UBYTE
  RETURN AyRead(8 + ch) AND 15
END FUNCTION

REM The free entries of the queue of channel c (1, 2 or 4) and whether it has a note playing or queued
FUNCTION Free(c AS UBYTE) AS UBYTE
  RETURN SQ(c) AND 7
END FUNCTION
FUNCTION Busy(c AS UBYTE) AS UBYTE
  DIM q AS UBYTE
  q = SQ(c)
  IF (q AND 128) <> 0 OR (q AND 7) < 4 THEN RETURN 1
  RETURN 0
END FUNCTION

REM The volume the AY holds for a note's start volume v with no volume envelope. 664/6128: v. 464 (firmware
REM 1.0): its volumes are 0-7, doubled into the AY's 0-15; SOUND passes v to the firmware as it is and the
REM firmware keeps the low three bits (measured: 12 gives 8, 9 gives 2, 15 gives 14). The fork's SoundQueue
REM mapped v to the nearest even volume instead; Locomotive's own BASIC 1.0 has no volume above 7. With an
REM envelope all models use v as 0-15.
FUNCTION Want(v AS UBYTE) AS UBYTE
#ifdef CPC464
  RETURN (v AND 7) * 2
#else
  RETURN v
#endif
END FUNCTION

DIM seq(7) AS UINTEGER
DIM i, n, ok, prev, v AS UBYTE
DIM t0, t1 AS ULONG
DIM p, last AS UINTEGER

REM ---------------- idle ----------------
CHK("idle_free_A", N$(Free(1)), "4")
CHK("idle_free_B", N$(Free(2)), "4")
CHK("idle_free_C", N$(Free(4)), "4")
CHK("idle_busy", N$(Busy(1) + Busy(2) + Busy(4)), "0")

REM ---------------- BEEP before ----------------
t0 = Ticks()
BEEP 0.2, 0
t1 = Ticks()
CHK("beep_before_waits", N$(-((t1 - t0) >= 55 AND (t1 - t0) <= 75)), "1")
CHK("beep_before_idle", N$(Busy(1)), "0")

REM ---------------- returns at once ----------------
t0 = Ticks()
SOUND 1, 239, 1000, 15, 0       REM a 10 second note
t1 = Ticks()
CHK("sound_returns_at_once", N$(-((t1 - t0) <= 3)), "1")
CHK("busy_playing", N$(Busy(1)), "1")
CHK("free_while_playing", N$(Free(1)), "4")
CHK("other_channels_idle", N$(Busy(2) + Busy(4)), "0")
WaitTicks(10)
CHK("period_regs", N$(Per(0)), "239")
CHK("volume_reg", N$(Vol(0)), N$(Want(15)))
CHK("other_volume_silent", N$(Vol(1) + Vol(2)), "0")

REM ---------------- full queue ----------------
ok = 1
FOR i = 1 TO 4
  t0 = Ticks()
  SOUND 1, 300 + i, 1000, 15, 0
  t1 = Ticks()
  IF Free(1) <> 4 - i OR (t1 - t0) > 3 THEN ok = 0
NEXT i
CHK("fill_4", N$(ok), "1")
CHK("full_free_0", N$(Free(1)), "0")
CHK("full_still_busy", N$(Busy(1)), "1")
CHK("full_B_unaffected", N$(Free(2)), "4")
REM the queue is full: the note playing is still the first one
CHK("full_period_unchanged", N$(Per(0)), "239")

REM ---------------- flush ----------------
SoundStop
CHK("stop_free", N$(Free(1)), "4")
CHK("stop_busy", N$(Busy(1)), "0")
CHK("stop_silent", N$(Vol(0) + Vol(1) + Vol(2)), "0")

REM ---------------- a SOUND on a full queue waits ----------------
REM five notes of 0.1 s fill the queue (one playing, four queued): a sixth waits for the first to end
FOR i = 1 TO 5
  SOUND 1, 200 + i, 10, 15, 0
NEXT i
t0 = Ticks()
SOUND 1, 299, 10, 15, 0
t1 = Ticks()
CHK("full_sound_waits", N$(-((t1 - t0) >= 20)), "1")
SoundStop

REM ---------------- channels independent ----------------
SOUND 1, 300, 1000, 15, 0
SOUND 2, 400, 1000, 12, 0
SOUND 4, 500, 1000, 9, 0
WaitTicks(10)
CHK("ind_period_A", N$(Per(0)), "300")
CHK("ind_period_B", N$(Per(1)), "400")
CHK("ind_period_C", N$(Per(2)), "500")
CHK("ind_vol_A", N$(Vol(0)), N$(Want(15)))
CHK("ind_vol_B", N$(Vol(1)), N$(Want(12)))
CHK("ind_vol_C", N$(Vol(2)), N$(Want(9)))
REM fill A only: B and C keep their free slots
FOR i = 1 TO 4
  SOUND 1, 300, 1000, 15, 0
NEXT i
CHK("ind_A_full", N$(Free(1)), "0")
CHK("ind_B_free", N$(Free(2)), "4")
CHK("ind_C_free", N$(Free(4)), "4")
SoundStop
REM several channels in one call: the same note on A and C
SOUND 5, 250, 1000, 14, 0
WaitTicks(10)
CHK("multi_A", N$(Per(0)) + " " + N$(Vol(0)), "250 " + N$(Want(14)))
CHK("multi_C", N$(Per(2)) + " " + N$(Vol(2)), "250 " + N$(Want(14)))
CHK("multi_B_silent", N$(Busy(2)) + " " + N$(Vol(1)), "0 0")
SoundStop

REM ---------------- volume envelope ----------------
REM 15 steps of -1, 0.1 s each
ENV 1, 15, -1, 10
SOUND 1, 239, 200, 15, 1
t0 = Ticks()
ok = 1
prev = 255
n = 0
DO
  v = Vol(0)
  IF v > prev THEN ok = 0
  IF v < prev THEN n = n + 1
  prev = v
LOOP UNTIL Ticks() - t0 >= 450
CHK("env_decreasing", N$(ok), "1")
CHK("env_steps_seen", N$(-(n >= 8)), "1")
CHK("env_reaches_0", N$(prev), "0")
SoundStop
REM start volume 15, first step comes after the first pause
SOUND 1, 239, 200, 15, 1
WaitTicks(5)
CHK("env_starts_high", N$(-(Vol(0) >= 14)), "1")
SoundStop

REM two sections: down by 2 for 5 steps, then up by 2 for 5 steps (0.05 s a step)
ENV 3, 5, -2, 5, 5, 2, 5
SOUND 2, 239, 100, 10, 3
t0 = Ticks()
prev = Vol(1)
ok = 1
n = 0
DO
  v = Vol(1)
  IF v <> prev THEN
    IF v < prev AND n = 1 THEN ok = 0
    IF v > prev THEN n = 1
    prev = v
  END IF
LOOP UNTIL Ticks() - t0 >= 100
CHK("env2_down_then_up", N$(ok) + N$(n), "11")
SoundStop

REM ---------------- order and duration ----------------
REM four notes of 0.15 s on A: the AY holds each period in turn
SOUND 1, 201, 15, 15, 0
SOUND 1, 202, 15, 15, 0
SOUND 1, 203, 15, 15, 0
SOUND 1, 204, 15, 15, 0
t0 = Ticks()
n = 0
last = 0
DO
  p = Per(0)
  IF p <> last AND n < 8 THEN
    seq(n) = p
    n = n + 1
    last = p
  END IF
LOOP UNTIL Ticks() - t0 >= 240
CHK("order_count", N$(n), "4")
CHK("order", N$(seq(0)) + " " + N$(seq(1)) + " " + N$(seq(2)) + " " + N$(seq(3)), "201 202 203 204")
REM 4 x 0.15 s = 0.6 s = 180 ticks: all done at 240
CHK("order_done", N$(Busy(1)), "0")
CHK("order_free", N$(Free(1)), "4")
REM duration: one 0.3 s note, polled until it is done
SOUND 1, 239, 30, 15, 0
t0 = Ticks()
DO
LOOP UNTIL Busy(1) = 0 OR Ticks() - t0 > 300
t1 = Ticks() - t0
CHK("duration_0.3s", N$(-(t1 >= 80 AND t1 <= 105)), "1")

REM ---------------- rendezvous ----------------
REM A (rendezvous with B = 16) holds until B (rendezvous with A = 8) arrives
SOUND 1 + 16, 239, 1000, 15, 0
WaitTicks(15)
CHK("rv_A_waits", N$(Vol(0)), "0")
SOUND 2 + 8, 300, 1000, 15, 0
WaitTicks(15)
CHK("rv_both_start", N$(Vol(0)) + " " + N$(Vol(1)), N$(Want(15)) + " " + N$(Want(15)))
SoundStop

REM ---------------- RELEASE ----------------
REM a note held (channel + 64) does not start until released
SOUND 1 + 64, 239, 1000, 15, 0
WaitTicks(15)
CHK("held_silent", N$(Vol(0)), "0")
RELEASE 1
WaitTicks(15)
CHK("released_plays", N$(Vol(0)), N$(Want(15)))
SoundStop

REM ---------------- BEEP after ----------------
SOUND 1, 239, 1000, 15, 0
SoundStop
t0 = Ticks()
BEEP 0.2, 0
t1 = Ticks()
CHK("beep_after_waits", N$(-((t1 - t0) >= 55 AND (t1 - t0) <= 75)), "1")
CHK("beep_after_idle", N$(Busy(1)), "0")
SOUND 1, 239, 20, 15, 0
CHK("sound_after_beep", N$(Busy(1)), "1")
SoundStop

PRINT
Report()
PRINT "DONE"
END
