' Known difference: MOD with a negative dividend. CPC BASIC keeps the dividend's sign
' (-7 MOD 3 = -1); the fork's signed MOD returns 1.
DIM a, b AS INTEGER
DIM l, m AS LONG
a = -7
b = 3
PRINT "int [";a MOD b;"] [";a MOD -b;"]"
a = 7
PRINT "int [";a MOD -b;"]"
l = -100000
m = 7
PRINT "long [";l MOD m;"]"
END
