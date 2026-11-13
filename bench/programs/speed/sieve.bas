' Sieve of Eratosthenes below 2000, a byte array. The 2026-09-28 benchmark 3 (303 primes).
#include "tick.bas"
DIM c(2000) AS UBYTE
DIM i, j, n, t, e AS UINTEGER

n = 0
t = TICK()
FOR i = 2 TO 1999
    IF c(i) = 0 THEN
        n = n + 1
        j = i + i
        WHILE j <= 1999
            c(j) = 1
            j = j + i
        WEND
    END IF
NEXT i
e = TICK()
PRINT "T [";e - t;"]"
PRINT "n [";n;"]"
END
