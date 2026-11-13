10 REM L4-ERR: ON ERROR GOTO, ERR, ERL, the three RESUME forms, ERROR n, errors inside a GOSUB and a loop
20 DEFINT m,e,i
30 PRINT "before";ERR;ERL
40 ON ERROR GOTO 900
50 m=1:a$="":PRINT "case 1: retry"
60 x=ASC(a$):PRINT "x=";x
70 PRINT "after 1";ERR;ERL
80 m=2:PRINT "case 2: next"
90 y=ASC(""):PRINT "same line"
100 PRINT "after 2";ERR;ERL
110 m=3:PRINT "case 3: line"
120 z=ASC(""):PRINT "skipped"
130 PRINT "skipped too"
140 PRINT "after 3";ERR;ERL
150 m=2:PRINT "case 4: ERROR n"
160 ERROR 17
170 ERROR 255
180 ERROR 0
190 ERROR 256
200 ERROR -1
210 PRINT "case 5: RESUME outside a handler"
220 RESUME
230 PRINT "case 6: error in a GOSUB"
240 GOSUB 500
250 PRINT "back";ERR;ERL
260 PRINT "case 7: errors in a loop"
270 FOR i=1 TO 4
280 IF i=2 OR i=4 THEN q=ASC("")
290 PRINT "i=";i
300 NEXT
310 PRINT "case 8: ON ERROR GOTO again"
320 ON ERROR GOTO 950
330 ERROR 40
340 PRINT "end"
350 END
500 PRINT "in sub"
510 w=ASC(""):PRINT "sub continues"
520 RETURN
900 PRINT "handler";ERR;ERL
910 ON m GOTO 920,930,940
920 a$="A":RESUME
930 RESUME NEXT
940 RESUME 140
950 PRINT "second handler";ERR;ERL:RESUME NEXT
