' Integer loop: sum, bitwise AND, compare (1500 iterations). The 2026-09-28 benchmark 2.
#include "tick.bas"
#ifdef __CPCBAS__
#define BitAnd(a, b) ((a) AND (b))
#else
#define BitAnd(a, b) ((a) BAND (b))
#endif
DIM s, i, t, e AS UINTEGER

s = 0
t = TICK()
FOR i = 1 TO 1500
    s = s + i
    s = BitAnd(s, 8191)
    IF s > 4096 THEN s = s - 1
NEXT i
e = TICK()
PRINT "T [";e - t;"]"
PRINT "s [";s;"]"
END
