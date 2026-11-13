' Spec section 9: Locomotive manual, files: CAT, LOAD with and without an
' address, SAVE of binary and other types, OPENIN, INPUT #9, LINE INPUT #9,
' EOF, CLOSEIN, plus tape-style names. Own program.
10 CAT
20 LOAD "pic.scr", &C000
30 LOAD "!quiet.bin", &4000
40 LOAD "prog"
50 LOAD f$
60 SAVE "prog"
70 SAVE "prog", A
80 SAVE "prog", P
90 SAVE "code.bin", B, &4000, 256
100 SAVE "code.bin", B, &4000, 256, &4010
110 SAVE "scr", B, &C000, &4000
120 OPENIN "scores.dat"
130 WHILE NOT EOF
140 INPUT #9, n$, s
150 PRINT n$; s
160 WEND
170 CLOSEIN
180 OPENIN "!tape.dat"
190 LINE INPUT #9, a$
200 IF EOF THEN PRINT "empty"
210 CLOSEIN
220 n$ = "x" + STR$(1) : OPENIN n$
230 INPUT #9, a, b, c$
240 IF EOF = 0 THEN GOTO 230
250 CLOSEIN
