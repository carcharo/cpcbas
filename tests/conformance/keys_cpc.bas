REM Conformance: INKEY(n) and JOY(n), the state of a key by its firmware key number, with the KEY_
REM constants of the library (cpcbuild/keyboard.bas). The runner types the keys below, each followed
REM by RETURN; the emulators hold a key for only a few frames, so the program polls in a tight loop.
REM TYPE: a
REM TYPE: A
REM TYPE: m
REM
REM Ported from cpcbuild's keys_cpc (the zx48k keys.bas API mapped onto the CPC matrix: MultiKeys,
REM GetKeyScanCode, GetKey and KEYA ... whose values were a row and a bit mask). Locomotive's API is
REM INKEY(n): n is the firmware key number 0-79 (the values of the KEY_ constants), the result -1 for a
REM key not pressed, 0 pressed, 32 pressed with SHIFT, 128 with CONTROL, 160 with both. So "MultiKeys
REM returns its mask" is "INKEY returns 0", "GetKeyScanCode" is dropped (no equivalent: INKEY(n) takes
REM a key, not the other way round), "GetKey waits for M" is INKEY$ polled until it is "m", and the constants checks
REM (rows 0-9, one bit, distinct, the zx48k aliases) are replaced by the key numbers being distinct,
REM 0-79 and the values the firmware defines.

#include <cpcbuild/keyboard.bas>
#include "lib/chkbuf.bas"

DIM i, j, bad, dup, n AS UINTEGER
DIM c(40) AS UBYTE
DIM seenA, qw, withA, ret, shiftseen, ctrlseen AS INTEGER
DIM held AS UINTEGER
DIM k$ AS STRING

REM --- idle ---
held = 0
FOR i = 0 TO 79
  IF INKEY(i) <> -1 THEN held = held + 1
NEXT i
CHK("idle_all_keys", N$(held), "0")
CHK("idle_joy", N$(JOY(0) + JOY(1)), "0")
CHK("idle_inkey_a", N$(INKEY(KEY_A)), "-1")

REM --- A held (typed lower case, no SHIFT): INKEY(KEY_A) is 0 ---
n = 0
DO
  n = n + 1
LOOP UNTIL INKEY(KEY_A) <> -1 OR n > 30000
seenA = INKEY(KEY_A)
qw = INKEY(KEY_Q) + INKEY(KEY_W)
REM then RETURN (polled before any CHK: STR$ is slow, a typed key is short)
n = 0
DO
  n = n + 1
LOOP UNTIL INKEY(KEY_RETURN) <> -1 OR n > 3000
ret = INKEY(KEY_RETURN)
n = 0
DO
  n = n + 1
LOOP UNTIL INKEY(KEY_RETURN) = -1 OR n > 3000
CHK("a_pressed", N$(seenA), "0")
CHK("a_other_keys", N$(qw), "-2")
CHK("return_pressed", N$(ret), "0")

REM --- SHIFT + A: INKEY(KEY_A) gives 32 (the press can land before SHIFT's row is read: any of the
REM reads while A is held must be 0 or 32, and one of them 32) ---
n = 0
DO
  n = n + 1
LOOP UNTIL INKEY(KEY_A) <> -1 OR n > 30000
shiftseen = 0
ctrlseen = 0
DO WHILE INKEY(KEY_A) <> -1
  IF INKEY(KEY_A) = 32 THEN shiftseen = 1
  IF INKEY(KEY_A) = 128 THEN ctrlseen = 1
LOOP
CHK("shift_with_a", N$(shiftseen), "1")
CHK("no_control_with_a", N$(ctrlseen), "0")
n = 0
DO
  n = n + 1
LOOP UNTIL INKEY(KEY_RETURN) <> -1 OR n > 3000
n = 0
DO
  n = n + 1
LOOP UNTIL INKEY(KEY_RETURN) = -1 OR n > 3000

REM --- INKEY$ waits for M: a firmware build reads the buffer, which still holds the a, RETURN, A and
REM RETURN typed before (Locomotive's INKEY$ is the next buffered key), a bare build sees the key held ---
n = 0
DO
  k$ = INKEY$
  n = n + 1
LOOP UNTIL k$ = "m" OR n > 30000
CHK("inkey_m", k$, "m")

REM (The constants are checked last: the pairwise loop is slow, and the typed keys must not arrive
REM while it runs.)
c(0) = KEY_UP: c(1) = KEY_RIGHT: c(2) = KEY_DOWN: c(3) = KEY_LEFT: c(4) = KEY_ENTER
c(5) = KEY_RETURN: c(6) = KEY_SHIFT: c(7) = KEY_CONTROL: c(8) = KEY_ESC: c(9) = KEY_DEL
c(10) = KEY_SPACE: c(11) = KEY_TAB: c(12) = KEY_A: c(13) = KEY_B: c(14) = KEY_C: c(15) = KEY_D
c(16) = KEY_E: c(17) = KEY_F: c(18) = KEY_G: c(19) = KEY_H: c(20) = KEY_I: c(21) = KEY_J
c(22) = KEY_K: c(23) = KEY_L: c(24) = KEY_M: c(25) = KEY_N: c(26) = KEY_O: c(27) = KEY_P
c(28) = KEY_Q: c(29) = KEY_R: c(30) = KEY_S: c(31) = KEY_T: c(32) = KEY_U: c(33) = KEY_V
c(34) = KEY_W: c(35) = KEY_X: c(36) = KEY_Y: c(37) = KEY_Z: c(38) = KEY_0: c(39) = KEY_1
c(40) = KEY_2
bad = 0
dup = 0
FOR i = 0 TO 40
  IF c(i) > 79 THEN bad = bad + 1
  FOR j = i + 1 TO 40
    IF c(i) = c(j) THEN dup = dup + 1
  NEXT j
NEXT i
CHK("constants_in_range", N$(bad), "0")
CHK("constants_distinct", N$(dup), "0")
CHK("values", N$(KEY_A) + " " + N$(KEY_Q) + " " + N$(KEY_RETURN) + " " + N$(KEY_SPACE) + " " + N$(KEY_SHIFT) + " " + N$(KEY_CONTROL), "69 67 18 47 21 23")
CHK("cpc_only", N$(KEY_UP) + " " + N$(KEY_ESC) + " " + N$(JOY_FIRE1) + " " + N$(KEY_TAB), "0 66 76 68")

REM Give the emulator time to process the end of the typing before END
PAUSE 100
PRINT
Report()
PRINT "DONE"
END
