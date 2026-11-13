' Strings: clear, append, append, LEN (2000 iterations). The 2026-09-28 benchmark 5.
#include "tick.bas"
DIM i, n, t, e AS UINTEGER
DIM s AS STRING

n = 0
t = TICK()
FOR i = 1 TO 2000
    s = ""
    s = s + "ab"
    s = s + "cd"
    n = n + LEN(s)
NEXT i
e = TICK()
PRINT "T [";e - t;"]"
PRINT "n [";n;"]"
END
