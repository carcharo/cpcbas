REM Conformance: LINE INPUT and INPUT on the keyboard, in both modes: firmware (the firmware's key
REM buffer and line editor) and bare metal (the runtime's minimal line editor on the keyboard
REM matrix). The runner types the lines below, each followed by RETURN. Held-key auto-repeat
REM cannot be tested: the emulators hold a typed key for 2-3 frames only.
REM TYPE: HELLO
REM TYPE: ABCDE
REM TYPE: Hi1!
REM TYPE:
REM TYPE: 42
REM TYPE: 1,2
REM
REM Ported from cpcbuild. Changed with the language: INPUT(n) (a line of at most n characters) is
REM LINE INPUT, which has no length limit, so the original's "only 3 characters are accepted" becomes
REM "all five characters of ABCDE are returned"; INPUT n and INPUT a, b are added (a number and two
REM numbers: the typed lines "42" and "1,2"). Spectrum INPUT had no comma form.

#include "lib/chkbuf.bas"

DIM a$, b$, c$, d$ AS STRING
DIM n AS INTEGER
DIM x, y AS INTEGER

LINE INPUT a$
CHK("input_line", a$, "HELLO")

REM no length limit
LINE INPUT b$
CHK("input_long_line", b$, "ABCDE")

REM Lower case, a digit and a shifted symbol.
LINE INPUT c$
CHK("input_mixed", c$, "Hi1!")

REM Just RETURN: the empty string.
LINE INPUT d$
CHK("input_empty", d$, "")

INPUT n
CHK("input_number", N$(n), "42")
INPUT x, y
CHK("input_two_numbers", N$(x) + "," + N$(y), "1,2")

REM Give the emulator time to process the end of the typing before END
PAUSE 100
PRINT
Report()
PRINT "DONE"
END
