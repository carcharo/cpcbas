' Spec section 9: Locomotive manual, PRINT layout: separators, comma zones, ZONE,
' TAB, SPC, the question-mark abbreviation, output streams, and items written
' with no separator at all. Own program.
10 a = 12 : b = 34 : t$ = "txt"
20 PRINT a, b, a + b
30 ZONE 5
40 PRINT a, b, a + b
50 ZONE 13
60 PRINT a; b; t$
90 ? a; b
100 PRINT TAB(5); "five"; TAB(12); "twelve"
110 PRINT "ab"; SPC(3); "cd"
120 PRINT t$;
130 PRINT t$ + t$,
140 PRINT
150 PRINT #0, "window"
160 PRINT #1, "other window"; a
170 PRINT #8, "printer"
180 PRINT #2, a, b
190 PRINT #3,
200 PRINT -a; -(b)
210 PRINT 1.5E3; .25; &H1F; &X101
220 PRINT 10 / 4; 10 \ 4; 10 MOD 4; 2 ^ 8
230 PRINT a > b; a < b; a = b; a <> b; a >= b; a <= b
240 PRINT "quote ""inside"" string"
250 PRINT LEN(t$); LEFT$(t$, 1);
260 PRINT : PRINT
