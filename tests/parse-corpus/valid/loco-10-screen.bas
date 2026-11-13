' Spec section 9: Locomotive manual, screen control: MODE, INK with and without
' a flashing colour, BORDER, SPEED INK, PEN and PAPER (with a stream), CLS,
' LOCATE, POS and VPOS, CLEAR INPUT. Own program.
10 MODE 1
20 INK 0, 1 : INK 1, 24 : INK 2, 6, 18 : INK 3, 0
30 BORDER 1 : BORDER 2, 20
40 SPEED INK 10, 15
50 PEN 1 : PAPER 0
60 PEN #1, 2 : PAPER #1, 3
80 CLS
90 CLS #1
100 LOCATE 10, 5 : PRINT "here"
110 LOCATE #1, 1, 1 : PRINT #1, "stream one"
120 LOCATE 5, 5 : x = POS(#0) : y = VPOS(#0)
130 PRINT x; y; POS(#1); VPOS(#1)
140 CLEAR INPUT
150 FOR m = 0 TO 2 : MODE m : PRINT "mode"; m : NEXT
160 PAPER 1 : PEN 0 : BORDER 0
170 PRINT CHR$(22); CHR$(1); CHR$(24)
