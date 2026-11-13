' Spec section 9: the output half of the files (L4-FILES): OPENOUT, PRINT #9, WRITE, CLOSEOUT and CHAIN "name".
10 OPENOUT "scores.dat"
20 PRINT #9, "name"; 5
30 WRITE #9, "a,b", 12, -3.5
40 WRITE #9
50 WRITE 1; 2
60 WRITE #2, "x"
70 PRINT POS(#9); DERR
80 CLOSEOUT
90 CHAIN "next"
