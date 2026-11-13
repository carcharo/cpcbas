' Spec sections 4 and 7: Locomotive manual, variable types and definitions:
' DEFINT, DEFREAL, DEFSTR letter ranges, the % ! $ suffixes, DIM with several
' arrays, LET, DEF FN with numeric and string parameters, FN calls glued and
' spaced, and the DIM-less variable in long names. Own program.
10 DEFINT i-n
20 DEFREAL a-c, x
30 DEFSTR s, t-u
40 i = 7 : count = 12 : a = 1.5 : s = "text" : note = "more"
50 total% = 40000 - 40000 : ratio! = 2 / 3 : name$ = "nm"
60 DIM table(10), word$(5), mat%(2, 2), cube!(1, 1, 1)
70 table(3) = i : word$(0) = s : mat%(1, 1) = 9 : cube!(0, 1, 0) = a
80 DEF FNsquare(v) = v * v
90 DEF FN half(v) = v / 2
100 DEF FNjoin$(p$, q$) = p$ + "-" + q$
110 DEF FNmix(v, w) = FNsquare(v) + FN half(w)
120 PRINT FNsquare(5); FN half(9); FNjoin$("a", "b"); FNmix(2, 6)
130 PRINT FN square(3) + FNsquare(4)
140 LET z = FNsquare(i)
150 longvariablename1 = 1 : longvariablename2 = 2
160 PRINT longvariablename1 + longvariablename2
170 end2 = 5 : PRINT end2
180 PRINT table(3); word$(0); mat%(1, 1); cube!(0, 1, 0)
