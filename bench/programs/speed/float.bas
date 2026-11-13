' Float maths: 200 iterations of x = SQR(i)*SIN(i) + i/3. The 2026-09-28 benchmark 4. Checksum 6688.08573 (Locomotive).
#include "tick.bas"
DIM i AS FLOAT
DIM x, chk AS FLOAT
DIM t, e AS UINTEGER

chk = 0
t = TICK()
FOR i = 1 TO 200
    x = SQR(i) * SIN(i) + i / 3
    chk = chk + x
NEXT i
e = TICK()
PRINT "T [";e - t;"]"
PRINT "chk [";chk;"]"
END
