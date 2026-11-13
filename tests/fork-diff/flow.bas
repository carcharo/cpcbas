' DO/LOOP (WHILE and UNTIL forms, EXIT DO), nested FOR with STEP, GOSUB/RETURN.
DIM i, j AS UBYTE
DIM n AS INTEGER
DIM acc AS INTEGER

n = 1
DO
    n = n * 2
    PRINT "do [";n;"]"
LOOP WHILE n < 100

n = 10
DO WHILE n > 0
    n = n - 3
    PRINT "while [";n;"]"
LOOP

n = 0
DO
    n = n + 1
    IF n = 3 THEN PRINT "skip"
    IF n = 6 THEN EXIT DO
LOOP UNTIL n > 100
PRINT "exit [";n;"]"

FOR i = 1 TO 3
    FOR j = 3 TO 1 STEP -1
        PRINT "ij [";i;"] [";j;"] [";i * 10 + j;"]"
    NEXT j
NEXT i

FOR i = 0 TO 20 STEP 7
    PRINT "step [";i;"]"
NEXT i
FOR n = -2 TO 2
    PRINT "neg [";n;"]"
NEXT n

acc = 0
FOR i = 1 TO 4
    GOSUB AddSquare
NEXT i
PRINT "acc [";acc;"]"
GOSUB Report
GOSUB Report
END

AddSquare:
    acc = acc + i * i
    RETURN

Report:
    PRINT "report [";acc;"]"
    acc = acc + 1
    RETURN
