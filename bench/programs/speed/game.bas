' Game-shaped (bench/programs/game.bas in the common subset): a 360-entry SIN/COS table (degrees), then 2000 rotations of
' a point. Radians are explicit (PI / 180): the fork has no DEG. Checksum: the final point, compared to 8 digits.
#include "tick.bas"
DIM s(359) AS FLOAT
DIM c(359) AS FLOAT
DIM x, y, nx, ny AS FLOAT
DIM i, k, m, t, e AS UINTEGER

t = TICK()
FOR i = 0 TO 359
    s(i) = SIN(i * PI / 180)
    c(i) = COS(i * PI / 180)
NEXT i
e = TICK()
PRINT "T1 [";e - t;"]"
x = 100: y = 0
t = TICK()
FOR k = 1 TO 2000
    m = k MOD 360
    nx = x * c(m) - y * s(m)
    ny = x * s(m) + y * c(m)
    x = nx: y = ny
NEXT k
e = TICK()
PRINT "T2 [";e - t;"]"
PRINT "x [";x;"]"
PRINT "y [";y;"]"
END
