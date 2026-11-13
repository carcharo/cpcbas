' Spec section 3: a typed-in Locomotive listing (line numbers, ? and chained statements).
10 MODE 1:BORDER 0:INK 0,0:INK 1,24
20 CLS
30 ? "SCORE:";s
40 FOR i=1 TO 10:s=s+i:NEXT i
50 IF s>40 THEN 80
60 GOSUB 200
70 GOTO 40
80 ? "DONE":END
200 PLOT RND*600,RND*390,1:RETURN
