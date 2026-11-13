' Spec section 6: Locomotive manual, error trapping: ON ERROR GOTO, ERROR with
' a code, ERR and ERL, and RESUME in its three forms (RESUME compiles since L4-ERR). Own program.
10 ON ERROR GOTO 900
20 ERROR 7
30 PRINT "back"
40 e = ERR : l = ERL
50 PRINT e; l
60 IF ERR = 17 THEN PRINT "break"
70 ON ERROR GOTO 0
80 END
900 PRINT "error"; ERR; "in line"; ERL
910 GOTO 30
920 RESUME
930 RESUME NEXT
940 RESUME 30
950 IF ERR = 5 THEN RESUME NEXT ELSE RESUME 70
