REM Conformance: the restart area &0000-&003F survives a run, whatever the program's origin
REM (the compiler's default origin puts code right above it).
REM
REM It holds the firmware's restarts and RAM vectors; our runtime owns &0038 (IM 1 vector: jp)
REM and, in a bare build, &0030 (RST 6, FP calculator: jp; a firmware build links no
REM calculator, L5-HOT); the firmware's ISR calls the external-
REM interrupt vector at &003B. A copy is taken first thing, then floats (RST 6), printing,
REM firmware calls and a wait (interrupts) run, and every byte must still match.
REM
REM Ported from cpcbuild. Changed: PAUSE is a later-phase keyword, so the waits are counting
REM loops (about a second each, interrupts running); STR$ became N$/T$.

#include "lib/chk.bas"

DIM snap(63) AS UBYTE
DIM i AS UINTEGER
DIM bad AS UINTEGER
DIM f AS REAL
DIM w AS UINTEGER

FOR i = 0 TO 63
  snap(i) = PEEK(i)
NEXT i

#ifdef CPC_BAREMETAL
CHK("rst6_is_jp", N$(PEEK(48)), "195")
#endif
CHK("im1_is_jp", N$(PEEK(56)), "195")

f = 1.5
f = f * 3.25 + SQR(16.0)
CHK("float_works", T$(STR$(f)), "8.875")
PRINT "restart area test"
FOR w = 1 TO 30000
NEXT w
FOR i = 1 TO 20
  PRINT i;
NEXT i
PRINT
FOR w = 1 TO 20000
NEXT w

bad = 0
FOR i = 0 TO 63
  IF snap(i) <> PEEK(i) THEN
    PRINT "FAIL lowram_byte_"; i; " was="; snap(i); " now="; PEEK(i)
    bad = bad + 1
  END IF
NEXT i
CHK("lowram_unchanged", N$(bad), "0")
PRINT "DONE"
END
