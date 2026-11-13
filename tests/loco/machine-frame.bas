10 REM FRAME (BASIC 1.1: the 464 interpreter has no FRAME, so this is blessed on the 6128 only)
20 MEMORY &8FFF
30 PRINT "a"
40 FRAME
50 FOR i=1 TO 25:FRAME:NEXT
60 PRINT "25 frames"
