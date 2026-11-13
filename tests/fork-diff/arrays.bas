' Global arrays: UBYTE, INTEGER, FLOAT and STRING, two dimensions, an initialiser, UBOUND.
DIM b(9) AS UBYTE
DIM n(3, 4) AS INTEGER
DIM r(2) AS FLOAT
DIM s(3) AS STRING
DIM t(2) AS UBYTE => {7, 8, 9}
DIM i AS UBYTE
DIM j AS UBYTE
DIM total AS INTEGER

FOR i = 0 TO 9
    b(i) = i * 25
NEXT i
PRINT "b [";b(0);"] [";b(1);"] [";b(9);"]"
b(3) = b(3) + 100
PRINT "b3 [";b(3);"]"

FOR i = 0 TO 3
    FOR j = 0 TO 4
        n(i, j) = i * 100 - j * 7
    NEXT j
NEXT i
total = 0
FOR i = 0 TO 3
    FOR j = 0 TO 4
        total = total + n(i, j)
    NEXT j
NEXT i
PRINT "n [";n(0, 0);"] [";n(2, 3);"] [";n(3, 4);"] total [";total;"]"

r(0) = 1.5
r(1) = r(0) * 3
r(2) = r(1) - 0.25
PRINT "r [";r(0);"] [";r(1);"] [";r(2);"]"

s(0) = "one"
s(1) = "two"
s(2) = s(0) + s(1)
FOR i = 0 TO 3
    PRINT "s [";i;"] [";s(i);"]"
NEXT i

PRINT "t [";t(0);"] [";t(1);"] [";t(2);"]"
PRINT "ubound [";UBOUND(b, 1);"] [";UBOUND(n, 1);"] [";UBOUND(n, 2);"] [";UBOUND(s, 1);"]"
END
