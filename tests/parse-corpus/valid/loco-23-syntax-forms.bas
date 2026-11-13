' Spec sections 6, 8 and 9: small Locomotive forms - the <> spelling >< , MIN and MAX of
' one value, PEN with a background mode, WIDTH, SPEED WRITE, DERR and SAVE with a file type.
10 a = 3 : b = 4
20 IF a >< b THEN PRINT MIN(a); MAX(b)
30 PEN 1, 1 : PEN , 0 : PEN #1, 2, 1
40 WIDTH 80 : SPEED WRITE 1
50 PRINT DERR; ERR
60 SAVE "prog", A
70 SAVE "prot", P
80 SAVE "code", B, &4000, 100, &4000
90 ON ERROR GOTO 0
