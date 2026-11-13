' Spec section 9: PRINT items with no separator between them print adjacent, as if ; stood
' there (the Locomotive manual's IF entry prints "A is less than B" this way).
10 a = 1 : b = 2 : t$ = "txt"
20 IF a < b THEN PRINT a "is less than" b
30 PRINT a b t$
40 PRINT "x" a "y"
50 PRINT t$ t$
