' Spec sections 4, 6 and 8: a typed-in string sort and search, using DIM string
' arrays, nested FOR loops, a swap through a temporary, INSTR, UPPER$ and
' ON ERROR GOTO. Own program.
10 DEFSTR w : DEFINT i-k
20 n = 6 : DIM w(n)
30 FOR i = 1 TO n : READ w(i) : NEXT
40 FOR i = 1 TO n - 1
50 FOR j = i + 1 TO n
60 IF w(j) < w(i) THEN t = w(i) : w(i) = w(j) : w(j) = t
70 NEXT j
80 NEXT i
90 FOR i = 1 TO n : PRINT w(i), : NEXT : PRINT
100 ON ERROR GOTO 200
110 INPUT "Find"; f
120 FOR i = 1 TO n
130 IF INSTR(UPPER$(w(i)), UPPER$(f)) > 0 THEN PRINT "found "; w(i)
140 NEXT
150 ON ERROR GOTO 0
160 END
200 PRINT "oops"; ERR : GOTO 110
300 DATA pear, fig, apple, plum, kiwi, lemon
