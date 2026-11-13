' CIRCLE and POINT, the Sinclair-style aliases: the current mode's pixels, origin bottom left, graphics pen 1.
' The circles are read back with POINT (lit pixels per row and per column, and single points) before anything is
' printed, so the text does not take part.
#ifndef __CPCBAS__
#include <point.bas>
#endif
DIM x AS INTEGER
DIM y AS INTEGER
DIM n AS INTEGER
DIM rows(14) AS INTEGER
DIM cols(12) AS INTEGER
DIM p(7) AS INTEGER
CIRCLE 160, 100, 50
CIRCLE 40, 40, 30
CIRCLE 300, 20, 25
CIRCLE 10, 190, 0
CIRCLE 100, 100, -5
CIRCLE 160, 100, 3
FOR y = 0 TO 14
    n = 0
    FOR x = 0 TO 319
        n = n + POINT(x, y * 14 + 1)
    NEXT x
    rows(y) = n
NEXT y
FOR x = 0 TO 12
    n = 0
    FOR y = 0 TO 199
        n = n + POINT(x * 26 + 3, y)
    NEXT y
    cols(x) = n
NEXT x
p(0) = POINT(160, 150)
p(1) = POINT(110, 100)
p(2) = POINT(210, 100)
p(3) = POINT(160, 50)
p(4) = POINT(10, 190)
p(5) = POINT(-5, 5)
p(6) = POINT(400, 5)
p(7) = POINT(5, 300)
FOR y = 0 TO 14
    PRINT "row [";y * 14 + 1;"] [";rows(y);"]"
NEXT y
FOR x = 0 TO 12
    PRINT "col [";x * 26 + 3;"] [";cols(x);"]"
NEXT x
FOR x = 0 TO 7
    PRINT "[";p(x);"]"
NEXT x
END
