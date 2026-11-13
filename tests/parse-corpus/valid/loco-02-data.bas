' Spec sections 3 and 4: Locomotive manual, DATA, READ and RESTORE with all item
' forms (numbers, unquoted and quoted strings, hex, empty items, trailing comma),
' plus DATA in the middle of a line (BASIC 1.1) and DIM of arrays. Own program.
10 DIM names$(4), score(4)
20 FOR i = 0 TO 4
30 READ names$(i), score(i)
40 NEXT
50 RESTORE 200
60 READ a, b$, c, d$
70 PRINT a; b$; c; d$
80 DATA ann, 10, bob, 20, "cy, jr", 30
90 DATA dee, 40, eve, 50
100 total = 0 : FOR i = 0 TO 4 : total = total + score(i) : NEXT : PRINT total
110 x = 5 : DATA 1, 2 : y = 6
120 ' second pass over the strange items
130 RESTORE 210
140 READ h, e$, z
150 PRINT h; e$; z
160 DIM grid(2, 3), word$(3), flags%(9)
170 grid(1, 2) = 4 : word$(0) = "w" : flags%(9) = -1
180 PRINT grid(1, 2); word$(0); flags%(9)
190 END
200 DATA 3, "q", 4.5, tail
210 DATA &FF, , 1E3,
