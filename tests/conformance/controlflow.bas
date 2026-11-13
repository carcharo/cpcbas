REM CPCBAS: -W 320
REM Conformance: GOTO/GOSUB/ON GOTO/ON GOSUB, DO/WHILE/UNTIL loop variants. Expected
REM values computed by hand.
REM
REM Ported from cpcbuild. Changed with the language: ON ... GOTO/GOSUB count from 1
REM (Locomotive); 0 and a number past the last label fall through.

#include "lib/chk.bas"

REM ---- GOTO ----
DIM trail$ AS STRING
trail$ = ""
trail$ = trail$ + "A"
GOTO lblGotoTarget
trail$ = trail$ + "SKIPPED"
lblGotoTarget:
trail$ = trail$ + "B"
CHK("goto_skips", trail$, "AB")

REM ---- GOSUB/RETURN ----
DIM gscount AS UBYTE
gscount = 0
GOSUB lblSub1
GOSUB lblSub1
CHK("gosub_twice", N$(gscount), "2")
GOTO lblAfterSubs
lblSub1:
gscount = gscount + 1
RETURN
lblAfterSubs:

REM ---- ON ... GOTO ----
REM changed: the index counts from 1 (it was 0-based), so the loop runs 1 to 4 and 4 falls
REM through; the result text is the same.
DIM og AS UBYTE
DIM ogResult$ AS STRING
ogResult$ = ""
FOR og = 1 TO 4
  ON og GOTO lblOg1, lblOg2, lblOg3
  ogResult$ = ogResult$ + "?"
  GOTO lblOgNext
  lblOg1:
  ogResult$ = ogResult$ + "1"
  GOTO lblOgNext
  lblOg2:
  ogResult$ = ogResult$ + "2"
  GOTO lblOgNext
  lblOg3:
  ogResult$ = ogResult$ + "3"
  lblOgNext:
NEXT og
CHK("on_goto", ogResult$, "123?")

REM ---- ON ... GOSUB ----
REM changed: ON 2 (1-based) picks the second label, as ON 1 did when the index was 0-based.
DIM osResult$ AS STRING
osResult$ = ""
ON 2 GOSUB lblOs1, lblOs2, lblOs3
CHK("on_gosub", osResult$, "S2")
GOTO lblOsDone
lblOs1:
osResult$ = osResult$ + "S1"
RETURN
lblOs2:
osResult$ = osResult$ + "S2"
RETURN
lblOs3:
osResult$ = osResult$ + "S3"
RETURN
lblOsDone:

REM ---- DO WHILE ... LOOP (test at top: may run 0 times) ----
DIM w1 AS UBYTE
DIM wsum AS UINTEGER
w1 = 0
wsum = 0
DO WHILE w1 < 5
  wsum = wsum + w1
  w1 = w1 + 1
LOOP
CHK("do_while_sum", N$(wsum), "10")

DIM w2 AS UBYTE
DIM wran AS UBYTE
w2 = 10
wran = 0
DO WHILE w2 < 5
  wran = wran + 1
  w2 = w2 + 1
LOOP
CHK("do_while_zero_runs", N$(wran), "0")

REM ---- DO ... LOOP UNTIL (test at bottom: always runs >=1 time) ----
DIM u1 AS UBYTE
DIM usum AS UINTEGER
u1 = 0
usum = 0
DO
  usum = usum + u1
  u1 = u1 + 1
LOOP UNTIL u1 >= 5
CHK("do_until_sum", N$(usum), "10")

DIM u2 AS UBYTE
DIM uran AS UBYTE
u2 = 10
uran = 0
DO
  uran = uran + 1
  u2 = u2 + 1
LOOP UNTIL u2 >= 5
CHK("do_until_runs_once", N$(uran), "1")

REM ---- WHILE ... WEND ----
DIM ww AS UBYTE
DIM wwsum AS UINTEGER
ww = 0
wwsum = 0
WHILE ww < 4
  wwsum = wwsum + ww
  ww = ww + 1
WEND
CHK("while_wend_sum", N$(wwsum), "6")

PRINT "DONE"
END
