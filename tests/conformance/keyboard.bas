REM BARE: skip INKEY$ is buffered only in firmware builds; bare builds have no key buffer (the key held now)
REM Conformance: keyboard input with INKEY$ as Locomotive has it: each key of the firmware's buffer
REM once, then the empty string. (inkey.bas tests the key held now, which is what a bare build's
REM INKEY$ is.) The runner types the keys below, each followed by RETURN:
REM TYPE: HELLO
REM TYPE: ABCDE
REM TYPE: Q
REM
REM Ported from cpcbuild. Changed with the language: INPUT(n) is LINE INPUT (no length limit: "ABCDE" comes
REM back whole); the -D CPC_INKEY_BUFFERED build argument is not needed (firmware builds are always
REM buffered), and CODE is ASC.

#include "lib/chkbuf.bas"

DIM a$, b$, k$, k2$ AS STRING

LINE INPUT a$
CHK("input_line", a$, "HELLO")

LINE INPUT b$
CHK("input_long_line", b$, "ABCDE")

REM INKEY$ returns each buffered key once: Q, then the RETURN after it.
DO
  k$ = INKEY$
LOOP UNTIL k$ <> ""
CHK("inkey_key", k$, "Q")
DO
  k2$ = INKEY$
LOOP UNTIL k2$ <> ""
CHK("inkey_return", N$(ASC(k2$)), "13")
CHK("inkey_then_empty", N$(LEN(INKEY$)), "0")

REM Give the emulator time to process the end of the typing before END
PAUSE 100
PRINT
Report()
PRINT "DONE"
END
