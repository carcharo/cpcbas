' Spec sections 5 and 9: Locomotive manual, number functions and operators:
' ABS, SGN, INT, FIX, CINT, ROUND, CREAL, UNT, SQR, EXP, LOG, LOG10, the
' trigonometric set with DEG and RAD, PI, MIN, MAX, RND, RANDOMIZE, MOD, the
' integer divide, the power operator and the bitwise operators. Own program.
10 DEG
20 PRINT SIN(30); COS(60); TAN(45); ATN(1)
30 RAD
40 PRINT SIN(PI / 2); COS(PI); PI
50 PRINT ABS(-4.5); SGN(-3); SGN(0); INT(-1.5); FIX(-1.5); CINT(2.5); ROUND(3.14159, 2); ROUND(1234, -2)
60 PRINT CREAL(7); UNT(&FFFF); UNT(-1)
70 PRINT SQR(2); EXP(1); LOG(10); LOG10(1000)
80 PRINT MIN(4, 9, 2, 7); MAX(4, 9, 2.5); MAX(1, 2)
90 RANDOMIZE 7
100 RANDOMIZE TIME
110 RANDOMIZE
120 r = RND : s = RND(1) : t = RND(0) : u = RND(-2)
130 PRINT INT(RND * 6) + 1
140 PRINT 17 MOD 5; 17 \ 5; 17 / 5; 2 ^ 10; -2 ^ 2
150 PRINT 12 AND 10; 12 OR 3; 12 XOR 5; NOT 0; NOT 5
160 IF (a > 2) AND (b < 3) OR NOT (c = 4) THEN PRINT "logic"
170 x = &HFF + &X1111 + &A + 100
180 y% = 12 : z! = 1.25 : w = 1E-3 : v = 123456789
190 PRINT x; y%; z!; w; v
200 PRINT 7 + 3 * 2 - 4 / 2
210 q = 5 : q = q + 1 : q = q * q
220 PRINT (1 + 2) * (3 + 4)
230 PRINT 1 = 1 AND 2 > 1
