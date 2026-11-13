' BM7 (Rugg/Feldman): integer arithmetic, GOSUB, array fill. The 2026-09-28 benchmark 1 (800 outer iterations).
#include "tick.bas"
DIM a, k, v, i, t, e AS UINTEGER
DIM m(5) AS UINTEGER

a = 0: k = 5: v = 0
t = TICK()
Top:
a = a + 1
v = k / 2 * 3 + 4 - 5
GOSUB Sub1
FOR i = 1 TO 5
    m(i) = a
NEXT i
IF a < 800 THEN GOTO Top
e = TICK()
PRINT "T [";e - t;"]"
PRINT "v [";v;"]"
PRINT "m [";m(5);"]"
END

Sub1:
RETURN
