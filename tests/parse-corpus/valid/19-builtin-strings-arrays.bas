' Spec section 8: string and array functions, at their minimum and maximum argument counts.
DIM a(3, 5) AS INTEGER
a$ = "HELLO WORLD"
n = LEN(a$)
l$ = LEFT$(a$, 5) + RIGHT$(a$, 5)
m$ = MID$(a$, 3) + MID$(a$, 3, 2)
p = INSTR(a$, "O") + INSTR(5, a$, "O")
s$ = STRING$(10, 45) + STRING$(5, "*")
b$ = SPACE$(4) + UPPER$(a$) + LOWER$(a$)
c$ = CHR$(65)
v = ASC(a$) + VAL("12.5")
t$ = STR$(42)
h$ = HEX$(255) + HEX$(255, 4)
q$ = BIN$(5) + BIN$(5, 8)
d$ = DEC$(3.14159, "##.##")
lo = LBOUND(a) + LBOUND(a, 2)
hi = UBOUND(a) + UBOUND(a, 2)
PRINT n; l$; m$; p; s$; b$; c$; v; t$; h$; q$; d$; lo; hi
