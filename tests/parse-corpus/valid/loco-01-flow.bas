' Spec sections 3 and 6: Locomotive manual, program flow keywords (REM, LET,
' GOTO, GOSUB, RETURN, ON n GOTO/GOSUB, IF with line-number branches, FOR with
' STEP and a negative step, WHILE/WEND, END, STOP, RESTORE). Own program.
10 REM countdown and menu
20 LET n = 3
30 FOR i = n TO 1 STEP -1
40 PRINT i;
50 NEXT i
60 PRINT "go"
70 k = 2
80 ON k GOSUB 200, 300, 400
90 ON k GOTO 110, 120
100 STOP
110 PRINT "one": GOTO 130
120 PRINT "two"
130 IF k > 5 THEN 500 ELSE 140
140 IF k = 2 THEN PRINT "k is two" ELSE PRINT "k is other"
150 IF k > 1 THEN GOTO 160 ELSE GOTO 170
160 PRINT "big"
170 total = 0 : j = 1
180 WHILE j <= 4 : total = total + j : j = j + 1 : WEND
190 PRINT total : GOTO 500
200 PRINT "first"
210 RETURN
300 PRINT "second" : RETURN
400 PRINT "third" : RETURN
500 FOR a = 0 TO 10 STEP 5 : PRINT a; : NEXT
510 FOR b = 3 TO 1 : PRINT "never?" : NEXT b
520 FOR x = 1 TO 2 : FOR y = 1 TO 2 : PRINT x * y; : NEXT y, x
530 RESTORE 600
540 READ p, q$
550 PRINT p; q$
560 END
600 DATA 7, seven
