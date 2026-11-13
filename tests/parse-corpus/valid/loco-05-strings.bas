' Spec section 8: Locomotive manual, string functions: LEN, LEFT$, RIGHT$, MID$
' (function and assignment form), INSTR with and without a start, STRING$ with
' a character code and with a string, SPACE$, UPPER$, LOWER$, CHR$, ASC, VAL,
' STR$, HEX$ and BIN$ with a width, DEC$. Own program.
10 a$ = "Amiga Basic Demo"
20 PRINT LEN(a$); LEFT$(a$, 5); RIGHT$(a$, 4); MID$(a$, 7, 5); MID$(a$, 7)
30 PRINT INSTR(a$, "Basic"); INSTR(8, a$, "a"); INSTR(a$, "zz")
40 PRINT STRING$(5, 42); STRING$(5, "-"); "[" + SPACE$(4) + "]"
50 PRINT UPPER$(a$); LOWER$(a$)
60 PRINT CHR$(65); CHR$(&7F + 1); ASC("Z"); ASC(a$)
70 PRINT VAL("12.5abc"); VAL("&FF"); VAL("")
80 PRINT STR$(42); STR$(-3.5); STR$(1E10)
90 PRINT HEX$(255); HEX$(255, 6); HEX$(-1); BIN$(10); BIN$(10, 8)
100 PRINT DEC$(1234.5, "#####.##"); DEC$(7, "+##")
110 MID$(a$, 1, 5) = "XXXXX"
120 MID$(a$, 7) = "yy"
130 PRINT a$
140 b$ = a$ + " / " + a$
150 IF a$ < b$ THEN PRINT "less"
160 IF LEFT$(a$, 1) = "X" AND LEN(b$) > 3 THEN PRINT "ok"
170 FOR i = 1 TO LEN(a$) : c$ = MID$(a$, i, 1) : n = n + ASC(c$) : NEXT
180 PRINT n
190 c$ = INKEY$ : IF c$ = "" THEN 190
200 PRINT UPPER$(c$) + "!"
