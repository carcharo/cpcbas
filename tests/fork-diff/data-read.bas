' DATA / READ / RESTORE: integers, negatives, strings, restoring and re-reading.
DIM i AS UBYTE
DIM n AS INTEGER
DIM total AS INTEGER
DIM s AS STRING

total = 0
FOR i = 1 TO 6
    READ n
    total = total + n
    PRINT "n [";n;"] total [";total;"]"
NEXT i

RESTORE
READ n
PRINT "again [";n;"]"
READ n
PRINT "again [";n;"]"

RESTORE Strs
FOR i = 1 TO 3
    READ s
    PRINT s
NEXT i

RESTORE Names
READ s
PRINT "names " + s
READ s
PRINT "names " + s

RESTORE Mixed
READ s, n
PRINT s; " [";n;"]"
READ s, n
PRINT s; " [";n;"]"
END

DATA 10, 20, -30, 400, -5000, 32000
Strs:
DATA "alpha", "beta", "gamma"
Names:
DATA "one", "two"
Mixed:
DATA "x", 1, "yy", -22
