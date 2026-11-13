REM BARE: skip uses the firmware clock (KL_TIME_PLEASE), GameMode and firmware calls; bareframes.bas is the bare counterpart
REM SIM: skip the simulator has no frame flyback events (KL NEW FRAME FLY) and no 300 Hz interrupt; chipsrun runs it
REM Ported from cpcbuild. Changed with the language: the dialect's spelling ($XX is &XX, N$ for STR$, AND for
REM BAND) and a comparison given to N$ is wrapped in -( ). The game mode part is in
REM framehook_game.bas (it hangs in a WaitRetrace loop and a firmware wait takes 3 frames: follow-up 132).
REM Conformance: the frame hook (Phase 5b, zxbasic
REM framehook.bas / runtime/framehook.asm / isr.asm).
REM
REM Normal mode: Frames() follows the firmware clock (6 ticks a frame) and
REM the VSYNC edges; the hook runs once a frame (equal to the Frames()
REM delta) during compute, WaitRetrace, PRINT and INKEY$ loops; it runs
REM with interrupts off and may trash every register; FrameHookOff and
REM re-pointing work.
REM
REM Game mode is in framehook_game.bas.
REM Not tested: the Gate Array palette surviving the firmware's ink
REM refresh in game mode (the GA can't be read back).

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

REM --- references: the work with the hook off, interrupts off ---
DisableInts()
Work(300)
a1 = wAcc : f1 = wF : x1 = wX
EnableInts()
WorkFW(100)
b1 = wAcc : g1 = wF : y1 = wX

REM ================= normal mode =================
PRINT "INFO normal mode"
hcnt = 0
FrameHook(@hkC)

REM compute loop
Begin()
Busy(4)
Finish()
PRINT "INFO compute: frames="; dF; " hook="; dH; " ticks="; dT
HookEqFrames("n_compute")
Rng("n_compute_frames", CAST(LONG, dF), 60, 200)
Rng("n_compute_vs_ticks", CAST(LONG, dF) - CAST(LONG, dT) / 6, -1, 1)
Snap() : bF = sF
PollBusy(2)
Snap()
dF = sF - bF
PRINT "INFO poll: frames="; dF; " vsync edges="; vs
Rng("n_compute_vs_edges", CAST(LONG, dF) - CAST(LONG, vs), -1, 1)

REM WaitRetrace(1) x 20 and WaitRetrace(3) x 10
Begin()
FOR i = 1 TO 20
  WaitRetrace(1)
NEXT i
Finish()
PRINT "INFO wait1 x20: frames="; dF; " hook="; dH
HookEqFrames("n_wait1")
Rng("n_wait1_frames", CAST(LONG, dF), 20, 20)
Begin()
FOR i = 1 TO 10
  WaitRetrace(3)
NEXT i
Finish()
PRINT "INFO wait3 x10: frames="; dF; " hook="; dH
HookEqFrames("n_wait3")
Rng("n_wait3_frames", CAST(LONG, dF), 30, 30)

REM INKEY$ polling (no key is pressed)
Begin()
FOR i = 1 TO 30000
  k$ = INKEY$
NEXT i
Finish()
PRINT "INFO inkey: frames="; dF; " hook="; dH; " ticks="; dT
HookEqFrames("n_inkey")
inkN = dF
Rng("n_inkey_ran", CAST(LONG, dF), 10, 10000)
Rng("n_inkey_vs_ticks", CAST(LONG, dF) - CAST(LONG, dT) / 6, -1, 1)

REM PRINT loop (the printer echo makes it slow)
Begin()
FOR i = 1 TO 12
  PRINT "INFO print line "; i
NEXT i
Finish()
PRINT "INFO print: frames="; dF; " hook="; dH; " ticks="; dT
HookEqFrames("n_print")
Rng("n_print_vs_ticks", CAST(LONG, dF) - CAST(LONG, dT) / 6, -1, 1)

REM --- the hook runs with interrupts off and trashes everything ---
hcnt = 0
ifon = 0
FrameHook(@hkT)
Begin()
Work(300)
a2 = wAcc : f2 = wF : x2 = wX
Finish()
HookEqFrames("n_trash_work")
Rng("n_trash_hook_ran", CAST(LONG, dH), 10, 1000)
CHK("n_trash_long", N$(a2), N$(a1))
CHK("n_trash_float", N$(f2), N$(f1))
CHK("n_trash_fixed", N$(x2), N$(x1))
Begin()
WorkFW(100)
b2 = wAcc : g2 = wF : y2 = wX
Finish()
HookEqFrames("n_trash_fw")
CHK("n_trash_fw_long", N$(b2), N$(b1))
CHK("n_trash_fw_float", N$(g2), N$(g1))
CHK("n_trash_fw_fixed", N$(y2), N$(y1))
CHK("n_hook_ints_off", N$(ifon), "0")

REM --- FrameHookOff, and re-pointing ---
hcnt = 0
hcnt2 = 0
FrameHook(@hkC)
Busy(1)
Snap() : bH = sH : bF = sF
FrameHookOff()
Busy(1)
Snap()
CHK("n_off_hook_stopped", N$(sH), N$(bH))
Rng("n_off_frames_go_on", CAST(LONG, sF - bF), 10, 100)
FrameHook(@hkC)
Busy(1)
Snap()
Rng("n_on_again", CAST(LONG, sH - bH), 10, 100)
hcnt2 = 0
Snap() : bH = sH : bF = sF
FrameHook(@hkD)
Busy(1)
FrameHookOff()
Snap()
CHK("n_switch_old_stopped", N$(sH), N$(bH))
Rng("n_switch_new_runs", CAST(LONG, hcnt2), 10, 100)
CHK("n_switch_new_eq_frames", N$(hcnt2), N$((sF - bF) AND &FFFF))
FrameHookOff()

PRINT "DONE"
