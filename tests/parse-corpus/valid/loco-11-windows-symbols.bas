' Spec section 9: Locomotive manual, text windows and user-defined characters:
' WINDOW with a stream, WINDOW SWAP, TAG and TAGOFF, SYMBOL with one to eight
' rows, SYMBOL AFTER, COPYCHR$ (BASIC 1.1), and printing to numbered streams.
' Own program.
10 MODE 1
20 SYMBOL AFTER 240
30 SYMBOL 240, &18, &3C, &7E, &FF, &FF, &7E, &3C, &18
40 SYMBOL 241, 255
50 SYMBOL 242, 1, 2, 4
60 SYMBOL 243, &X11110000, &X00001111, 0, 0, 0, 0, 0, 255
70 WINDOW 1, 20, 1, 10
80 WINDOW #1, 22, 40, 12, 24
90 WINDOW #2, 5, 15, 5, 8
100 PAPER #1, 2 : PEN #1, 0 : CLS #1
110 PRINT #1, CHR$(240); CHR$(241); "boxed"
120 PRINT #2, "small"
130 WINDOW SWAP 0, 1
140 WINDOW SWAP 1, 0
150 LOCATE #2, 2, 2
160 c$ = COPYCHR$(#2)
170 PRINT c$; COPYCHR$(#0)
180 MOVE 100, 100 : TAG
190 PRINT "graphic text";
200 TAGOFF
210 TAG #1 : PRINT #1, "x"; : TAGOFF #1
220 FOR s = 0 TO 7 : PRINT #s, "stream"; s : NEXT
