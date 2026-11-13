10 ON ERROR GOTO 900
20 e=0:n=0:ON n GOTO 100,200:PRINT "n=0 fell through";e:GOTO 300
100 PRINT "n=0 went to 100":GOTO 300
200 PRINT "n=0 went to 200"
300 e=0:n=3:ON n GOTO 400,500:PRINT "n=3 fell through";e:GOTO 600
400 PRINT "n=3 went to 400":GOTO 600
500 PRINT "n=3 went to 500"
600 e=0:n=-1:ON n GOTO 700,800:PRINT "n=-1 fell through";e:GOTO 1000
700 PRINT "n=-1 went to 700":GOTO 1000
800 PRINT "n=-1 went to 800"
1000 e=0:n=256:ON n GOTO 1100,1200:PRINT "n=256 fell through";e:GOTO 1300
1100 PRINT "n=256 went to 1100":GOTO 1300
1200 PRINT "n=256 went to 1200"
1300 e=0:n=1:ON n GOTO 1400,1500:PRINT "n=1 fell through";e:GOTO 1600
1400 PRINT "n=1 went to 1400":GOTO 1600
1500 PRINT "n=1 went to 1500"
1600 END
900 e=ERR:PRINT "error";e:RESUME NEXT
