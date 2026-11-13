' Spec section 9: Locomotive manual, sound: SOUND with all seven parameters and
' with parameters left out, ENV and ENT with several sections, negative
' envelope numbers, RELEASE, SQ, the queue wait loop and ON SQ GOSUB. Own program.
10 ENV 1, 15, -1, 10
20 ENV 2, 1, 5, 2, 3, 0, 10, 2, -2, 8
30 ENT 1, 10, 2, 5
40 ENT -2, 5, 3, 1, 5, -3, 1
50 ENT 3, 100, 1, 2, 100, -1, 2
60 SOUND 1, 478
70 SOUND 1, 478, 100
80 SOUND 1, 478, 100, 12
90 SOUND 2, 400, 50, 10, 1
100 SOUND 4, 300, 50, 10, 1, 2
110 SOUND 129, 200, 20, 15, 2, 1, 7
120 SOUND 1, 200, , 15
130 SOUND 2, 200, 10, , 2
140 SOUND 1, 0, 100, 0, 0, 0, 15
150 FOR n = 1 TO 10
160 WHILE SQ(1) > 127 : WEND
170 SOUND 1, 100 + n * 10, 20, 7
180 NEXT
190 IF SQ(2) AND 4 THEN RELEASE 2
200 RELEASE 1 + 2 + 4
210 s = SQ(1) : s2 = SQ(4)
220 PRINT s; s2
230 SOUND 65, 200
240 SOUND 17, 200
