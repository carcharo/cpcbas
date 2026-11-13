10 REM R14 (follow-up 86): errors trapped inside an event handler
20 REM RESUME NEXT goes back into the handler, whose RETURN re-enables the lower timer;
30 REM a GOTO out of the error handler leaves the handler's priority set (timer 0 stops), as Locomotive
40 ON ERROR GOTO 500
50 c=0:h=0:e=0:m=0:t=TIME:WHILE TIME-t<300:WEND
60 EVERY 5,0 GOSUB 300
70 AFTER 10,1 GOSUB 400
80 t=TIME:WHILE TIME-t<450:WEND
90 PRINT "h";h;"e";e:c1=c:t=TIME:WHILE TIME-t<300:WEND:PRINT "on";c-c1>5
100 m=1:AFTER 10,1 GOSUB 400
110 t=TIME:WHILE TIME-t<450:WEND
120 PRINT "h";h;"e";e:c1=c:t=TIME:WHILE TIME-t<300:WEND:PRINT "on";c-c1>5
130 END
300 c=c+1:RETURN
400 h=h+1:ERROR 5:h=h+10:RETURN
500 e=e+1:IF m=0 THEN RESUME NEXT ELSE GOTO 120
