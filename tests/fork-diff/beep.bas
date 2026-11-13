' BEEP duration, pitch with constant and run-time arguments (it waits until the note is over). The tone period and the
' duration (1/100 s) the note was queued with are read back from the runtime's sound block (SOUND_BLK, the private
' block + &AC: period at +3, duration at +7), which both compilers' runtimes share.
#include "common.bas"
DIM d AS FLOAT
DIM p AS INTEGER
DIM per, dur AS UINTEGER

SUB Report()
    per = PEEK(40620 + 3) + 256 * PEEK(40620 + 4)
    dur = PEEK(40620 + 7) + 256 * PEEK(40620 + 8)
    PRINT "period [";per;"] duration [";dur;"]"
END SUB

PRINT "constants"
BEEP 0.05, 0
Report()
BEEP 0.1, 12
Report()
BEEP 0.25, -12
Report()
BEEP 0.02, 60
Report()
BEEP 0.03, -60
Report()
PRINT "run-time values"
d = 0.05: p = 0
BEEP d, p
Report()
d = 0.1: p = 12
BEEP d, p
Report()
d = 0.25: p = -12
BEEP d, p
Report()
d = 0.02: p = 60
BEEP d, p
Report()
d = 0.03: p = -60
BEEP d, p
Report()
END
