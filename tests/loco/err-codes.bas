10 REM each runtime error the compiled code can raise, trapped, with its ERR and the line it happened in
20 ON ERROR GOTO 900:d=0
30 PRINT "3:":RETURN
40 PRINT "4:":READ a,b,c
60 PRINT "5:":x=ASC("")
70 PRINT "6:":y=CINT(40000)
80 PRINT "11:":z=5\d
90 PRINT "11:":w=5 MOD d
100 PRINT "11:":v=5/d
110 PRINT "20:":RESUME
120 PRINT "ERROR n:":ERROR 33
130 PRINT "done"
140 END
150 DATA 1,2
900 PRINT "ERR";ERR;"ERL";ERL:RESUME NEXT
