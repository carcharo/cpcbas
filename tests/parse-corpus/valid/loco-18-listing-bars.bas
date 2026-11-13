' Spec sections 4, 6 and 9: a typed-in bar chart with DATA, arrays, a text
' window, SYMBOL for the bar block and PRINT USING for the figures. Own program.
10 MODE 1 : DEFINT a-z : SYMBOL AFTER 240
20 SYMBOL 240, 255, 255, 255, 255, 255, 255, 255, 255
30 DIM v(5), n$(5)
40 FOR i = 0 TO 5 : READ n$(i), v(i) : NEXT
50 WINDOW #1, 2, 39, 3, 20 : PAPER #1, 1 : PEN #1, 3 : CLS #1
60 FOR i = 0 TO 5
70 LOCATE #1, 1, i * 3 + 1
80 PRINT #1, n$(i); TAB(8);
90 PRINT #1, STRING$(v(i) / 4, 240);
100 PRINT #1, USING " ###"; v(i)
110 NEXT i
120 m = 0 : FOR i = 0 TO 5 : IF v(i) > m THEN m = v(i)
130 NEXT : PRINT "max"; m
140 DATA north, 80, south, 45, east, 120, west, 60, up, 30, down, 100
