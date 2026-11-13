' Spec section 6: IF cond GOTO n ELSE m (THEN omitted before GOTO) is in the Locomotive
' manual's IF entry.
10 a = 3 : b = 4
20 IF a > b GOTO 100 ELSE 200
30 IF a < b GOTO 100
100 PRINT "a is bigger"
200 END
