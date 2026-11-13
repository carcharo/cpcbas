' Spec sections 3 and 9: INPUT, LINE INPUT, DATA, READ, RESTORE and MID$ as a statement.
' High-score entry from the keyboard and a data table.
DIM scores(4) AS INTEGER
INPUT n
INPUT a, b
INPUT "Name"; name$
INPUT "Age", age
INPUT "Two numbers"; p, q
INPUT #9, c, d$
INPUT scores(2)
LINE INPUT a$
LINE INPUT "Text: "; t$
LINE INPUT "Text: ", t$
LINE INPUT #9, row$

RESTORE
FOR i = 0 TO 4
  READ scores(i)
NEXT
READ w$, v, u!
RESTORE Names
READ first$, second$
RESTORE 900
READ k
PRINT k

Table:
DATA 120, 90, 75, 40, 10
DATA "quoted, with comma", plain text , &HFF, 1.5 : REM data stops at the colon
Names: DATA ANN, BOB
900 DATA 42

m$ = "ABCDEFGH"
MID$(m$, 2, 3) = "xyz"
MID$(m$, 5) = "q"
