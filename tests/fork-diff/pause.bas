' PAUSE n: n frames, then on (the same imported routine in both compilers).
DIM i AS UBYTE
PRINT "[start]"
PAUSE 1
FOR i = 1 TO 3
    PAUSE 5
    PRINT "pause [";i;"]"
NEXT i
PRINT "[end]"
END
