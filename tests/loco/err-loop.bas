10 REM L5-HOT (follow-up 81): an error in a WHILE test, on a later pass, belongs to the WHILE line, not to the body's last statement
20 ON ERROR GOTO 900
30 i=0
40 WHILE ASC(MID$("abc",i+1))>0
50 i=i+1
60 j=j+1
70 WEND
80 PRINT "after while";i;j
90 k=0
100 WHILE ASC(MID$("a",k+1))>0 AND k<5:k=k+1:WEND
110 PRINT "after one-line while";k
120 END
900 PRINT "ERR";ERR;"ERL";ERL
910 IF ERL=40 THEN RESUME 80
920 RESUME 110
