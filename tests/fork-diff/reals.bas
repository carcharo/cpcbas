' REAL (AS FLOAT) arithmetic and functions in the common subset. cpcbas prints 9 significant digits and the fork 8,
' and the two calculators round differently, so the harness compares the numbers with a fraction to 8 digits
' (FWM-CORE). Integers must match exactly.
#include "common.bas"
#ifdef __CPCBAS__
#define NatLog(x) LOG(x)
#else
#define NatLog(x) LN(x)
#endif

DIM a, b, c, d AS FLOAT
DIM i AS UBYTE

a = 1.5
b = 2.25
c = 0.1
d = 3

PRINT "add [";a + b;"]"
PRINT "sub [";a - b;"]"
PRINT "mul [";a * b;"]"
PRINT "div [";a / b;"]"
PRINT "third [";1.0 / d;"]"
PRINT "tenth [";c + c + c;"]"
PRINT "neg [";-a;"]"
PRINT "abs [";ABS(-b);"]"
PRINT "big [";1000000.0 * 1000.0;"]"
PRINT "small [";c / 1000.0;"]"
PRINT "sqr [";SQR(2.0);"] [";SQR(16.0);"] [";SQR(b);"]"
PRINT "sin [";SIN(1.0);"] [";SIN(0.5);"]"
PRINT "cos [";COS(1.0);"] [";COS(0.5);"]"
PRINT "atn [";ATN(1.0);"] [";ATN(0.5);"]"
PRINT "exp [";EXP(1.0);"] [";EXP(-1.0);"]"
PRINT "log [";NatLog(10.0);"] [";NatLog(2.0);"]"
PRINT "pow [";2.0 ^ 10;"] [";d ^ 3;"]"
PRINT "pi [";PI;"]"
FOR i = 1 TO 4
    d = i
    PRINT "loop [";d / 4.0;"] [";SQR(d);"]"
NEXT i
IF a < b THEN PRINT "lt [1]"
IF b > a THEN PRINT "gt [1]"
IF a = 1.5 THEN PRINT "eq [1]"
IF c * 3 > 0.29 THEN PRINT "near [1]"
END
