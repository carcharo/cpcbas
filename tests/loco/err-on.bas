10 REM ON n GOTO / GOSUB with n outside 0..255 is Improper argument (5); 0 and n above the list fall through
20 ON ERROR GOTO 900
30 n=-1:ON n GOTO 100,100
40 PRINT "after -1"
50 n=256:ON n GOSUB 200,200
60 PRINT "after 256"
70 n=0:ON n GOTO 100,100:PRINT "fell through 0"
80 n=3:ON n GOTO 100,100:PRINT "fell through 3"
90 n=2:ON n GOSUB 200,210:PRINT "back from 2"
95 END
100 PRINT "wrong target":END
200 PRINT "wrong sub 1":RETURN
210 PRINT "sub 2":RETURN
900 PRINT "ERR";ERR;"ERL";ERL:RESUME NEXT
