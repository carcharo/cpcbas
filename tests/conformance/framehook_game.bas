REM BARE: skip uses the firmware clock (KL_TIME_PLEASE), GameMode and firmware calls; bareframes.bas is the bare counterpart
REM TIMEOUT: 200
REM SIM: skip the simulator has no frame flyback events (KL NEW FRAME FLY) and no 300 Hz interrupt; chipsrun runs it
REM Ported from cpcbuild. Changed with the language: the dialect's spelling ($XX is &XX, N$ for STR$, AND for
REM BAND, REAL for FLOAT) and a comparison given to N$ is wrapped in -( ). This is the game mode half of cpcbuild's
REM framehook.bas (the normal mode half is framehook.bas). It was marked as hanging (follow-ups 132, 144); it only needs about 90 s
REM of emulated time (the INKEY, switch and DI sections), more than the default 60, hence the TIMEOUT line above; and its
REM g_waitfly check took 3 frames for ten calls because MC WAIT FLYBACK returns at once during a flyback (lib/fhlib.bas WaitFly).
REM inkN, the INKEY$ loop's normal mode frames, is measured here (framehook.bas has it in its normal half).
REM Conformance: game mode (Phase 5b, zxbasic framehook.bas / runtime/framehook.asm / isr.asm).
REM
REM Game mode: the frame hook counts the same frames; the firmware clock stands still outside
REM firmware calls and runs in them; GameMode(0) restores it; switching many times loses and
REM doubles no frame; DI sections of 2000-8000 T (the 6th-interrupt fallback) lose and double none.
REM Split from framehook.bas.

#include "lib/fhlib.bas"

DIM bF, dF AS ULONG
DIM bH, dH AS UINTEGER
DIM bT, eT, dT AS ULONG
DIM a1, a2, b1, b2 AS ULONG
DIM f1, f2, g1, g2 AS FLOAT
DIM x1, x2, y1, y2 AS FIXED
DIM i, j AS UINTEGER
DIM refN, refG, runF, inkN AS LONG
DIM k$ AS STRING

SUB Begin()
  Snap()
  bF = sF
  bH = sH
  bT = Ticks()
END SUB

SUB Finish()
  eT = Ticks()
  Snap()
  dF = sF - bF
  dH = sH - bH
  dT = eT - bT
END SUB

REM PASS if lo <= v <= hi
SUB Rng(name AS STRING, v AS LONG, lo AS LONG, hi AS LONG)
  IF v >= lo AND v <= hi THEN
    PRINT "PASS "; name
  ELSE
    PRINT "FAIL "; name; " got="; v; " want="; lo; ".."; hi
  END IF
END SUB

REM The hook count equals the Frames() delta; the frame count is
REM plausible; the clock (if running) agrees.
SUB HookEqFrames(name AS STRING)
  CHK(name + "_hook_eq_frames", N$(dH), N$(dF AND &FFFF))
END SUB

ScreenInit()

REM the INKEY$ loop in normal mode (the reference of g_inkey_vs_normal below)
Begin()
FOR i = 1 TO 30000
  k$ = INKEY$
NEXT i
Finish()
inkN = dF
PRINT "INFO normal inkey: frames="; dF

REM --- references: the work with the hook off, interrupts off ---
DisableInts()
Work(300)
a1 = wAcc : f1 = wF : x1 = wX
EnableInts()
WorkFW(100)
b1 = wAcc : g1 = wF : y1 = wX

REM ================= game mode =================
PRINT "INFO game mode"
hcnt = 0
FrameHook(@hkC)
GameMode(1)

REM compute: the clock stands still, frames are counted
Begin()
Busy(4)
Finish()
GameMode(0)
PRINT "INFO g compute: frames="; dF; " hook="; dH; " ticks="; dT
HookEqFrames("g_compute")
Rng("g_compute_frames", CAST(LONG, dF), 60, 200)
Rng("g_compute_clock_stopped", CAST(LONG, dT), 0, 2)
GameMode(1)
Snap() : bF = sF
PollBusy(2)
Snap()
dF = sF - bF
PRINT "INFO g poll: frames="; dF; " vsync edges="; vs
Rng("g_compute_vs_edges", CAST(LONG, dF) - CAST(LONG, vs), -1, 1)

REM the clock runs during firmware calls (10 x MC WAIT FLYBACK)
Begin()
FOR i = 1 TO 10
  WaitFly()
NEXT i
Finish()
PRINT "INFO g waitfly x10: frames="; dF; " hook="; dH; " ticks="; dT
HookEqFrames("g_waitfly")
REM 10 frames are 60 ticks; WaitFly spends the end of each flyback outside the call (47 on the 464, 6128 higher)
Rng("g_waitfly_clock_runs", CAST(LONG, dT), 44, 66)
Rng("g_waitfly_frames", CAST(LONG, dF), 9, 11)

REM WaitRetrace loops. The count of interrupts between two reads depends on where the frame interrupt falls
REM against the flyback (CPCEC's Plus gave 21 for 20 waits, hook and counter agreeing), so start the measurement
REM at the flyback, as the loop's own waits do: the same phase at the start and at the end.
WaitRetrace(1)
Begin()
FOR i = 1 TO 20
  WaitRetrace(1)
NEXT i
Finish()
PRINT "INFO g wait1 x20: frames="; dF; " hook="; dH
HookEqFrames("g_wait1")
Rng("g_wait1_frames", CAST(LONG, dF), 20, 20)
Begin()
FOR i = 1 TO 10
  WaitRetrace(3)
NEXT i
Finish()
PRINT "INFO g wait3 x10: frames="; dF; " hook="; dH
HookEqFrames("g_wait3")
Rng("g_wait3_frames", CAST(LONG, dF), 30, 30)

REM PRINT loop (firmware calls with compute between): frames follow the
REM clock, which runs inside the calls only; compare with the same loop
REM in normal mode.
GameMode(0)
Begin()
FOR i = 1 TO 12
  PRINT "INFO print line "; i
NEXT i
Finish()
refN = dF
GameMode(1)
Begin()
FOR i = 1 TO 12
  PRINT "INFO print line "; i
NEXT i
Finish()
PRINT "INFO g print: frames="; dF; " hook="; dH; " ticks="; dT; " normal="; refN
HookEqFrames("g_print")
REM 12 lines through the printer echo take about 57-60 frames here (46 in cpcbuild, whose PRINT was shorter): the band is a tenth of the
REM normal mode count, plus one (measured: game 61, normal 57 on chips, 6128)
Rng("g_print_frames_vs_normal", CAST(LONG, dF) - refN, -refN / 10 - 1, refN / 10 + 1)

REM INKEY$ polling (all firmware calls)
Begin()
FOR i = 1 TO 30000
  k$ = INKEY$
NEXT i
Finish()
PRINT "INFO g inkey: frames="; dF; " hook="; dH; " ticks="; dT
HookEqFrames("g_inkey")
Rng("g_inkey_ran", CAST(LONG, dF), 10, 10000)
REM mostly compute between the calls: no slower than normal mode, and
REM not more than about 25 % faster (the firmware handler's load is 12-23 %)
Rng("g_inkey_vs_normal", CAST(LONG, dF) - inkN, -inkN / 4 - 2, 2)

REM register preservation in game mode
FrameHook(@hkT)
ifon = 0
hcnt = 0
Begin()
Work(300)
a2 = wAcc : f2 = wF : x2 = wX
Finish()
HookEqFrames("g_trash_work")
Rng("g_trash_hook_ran", CAST(LONG, dH), 10, 1000)
CHK("g_trash_long", N$(a2), N$(a1))
CHK("g_trash_float", N$(f2), N$(f1))
CHK("g_trash_fixed", N$(x2), N$(x1))
Begin()
WorkFW(100)
b2 = wAcc : g2 = wF : y2 = wX
Finish()
HookEqFrames("g_trash_fw")
CHK("g_trash_fw_long", N$(b2), N$(b1))
CHK("g_trash_fw_float", N$(g2), N$(g1))
CHK("g_trash_fw_fixed", N$(y2), N$(y1))
CHK("g_hook_ints_off", N$(ifon), "0")
FrameHook(@hkC)

REM GameMode(0): the clock runs again in compute
GameMode(0)
Begin()
Busy(2)
Finish()
PRINT "INFO back to normal: frames="; dF; " ticks="; dT
HookEqFrames("back_normal")
Rng("back_normal_clock_runs", CAST(LONG, dT), 60, 1000)
Rng("back_normal_vs_ticks", CAST(LONG, dF) - CAST(LONG, dT) / 6, -1, 1)

REM --- many switches: no frame lost or doubled ---
GameMode(0)
Begin()
FOR i = 1 TO 20
  Busy(1)
NEXT i
Finish()
refN = dF
GameMode(1)
Begin()
FOR i = 1 TO 20
  Busy(1)
NEXT i
Finish()
refG = dF
GameMode(0)
Begin()
FOR i = 1 TO 20
  GameMode(1)
  Busy(1)
  GameMode(0)
  Busy(1)
NEXT i
Finish()
runF = dF
PRINT "INFO switches: ref normal="; refN; " ref game="; refG; " run="; runF; " hook="; dH
HookEqFrames("sw")
Rng("sw_total", runF - (refN + refG), -4, 4)

REM --- DI sections of dp x 28 T: the hook still runs once a frame ---
REM Each run does the same loop with the section DI (frames counted by
REM Frames(), time kept by the CPU) and with it EI (reference).
GameMode(1)
DIM dp, m AS UINTEGER
DIM dpv(4) AS UINTEGER => {70, 100, 143, 200, 300}
FOR j = 0 TO 4
  dp = dpv(j)
  m = 60000 / (dp + 30)
  Begin()
  FOR i = 1 TO 7 * m
    EiBusy(dp)
    EiBusy(20)
  NEXT i
  Finish()
  refN = dF
  Begin()
  FOR i = 1 TO 7 * m
    DiBusy(dp)
    EiBusy(20)
  NEXT i
  Finish()
  PRINT "INFO di "; dp * 28; " T: ref frames="; refN; " di frames="; dF; " hook="; dH
  HookEqFrames("di" + N$(dp * 28))
  Rng("di" + N$(dp * 28) + "_vs_ref", CAST(LONG, dF) - refN, -3, 3)
NEXT j
GameMode(0)

PRINT "DONE"
