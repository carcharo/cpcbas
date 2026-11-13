10 REM LOCATE with a column or row of 0, or above 255, is Improper argument (5): trapped, with ERR and ERL
20 ON ERROR GOTO 900
30 LOCATE 0,1:PRINT "after column 0"
40 LOCATE 1,0:PRINT "after row 0"
50 c=256:LOCATE c,1:PRINT "after column 256"
60 r=-1:LOCATE 1,r:PRINT "after row -1"
70 LOCATE 1,1:PRINT "ok"
80 END
900 PRINT "ERR";ERR;"ERL";ERL:RESUME NEXT
