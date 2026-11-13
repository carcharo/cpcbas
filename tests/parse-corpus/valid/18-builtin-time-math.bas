' Spec section 9: time and numbers, at their minimum and maximum argument counts.
DEG
RAD
FRAME
t = TIME
RANDOMIZE
RANDOMIZE TIME
RANDOMIZE 42
r = RND + RND(1) + RND(0)
k = RANDOM(6)
x = ABS(-3) + INT(2.7) + FIX(-2.7) + SGN(-9)
y = ROUND(3.14159) + ROUND(3.14159, 2)
z = SQR(2) + SIN(1) + COS(1) + TAN(1) + ATN(1)
e = EXP(1) + LOG(10) + LOG10(100) + PI
lo = MIN(3, 1) + MIN(3, 1, 2, 7, 5)
hi = MAX(3, 1) + MAX(3, 1, 2, 7, 5)
c = CINT(2.5) + UNT(65535)
d! = CREAL(c) / 3
PRINT t; r; k; x; y; z; e; lo; hi; d!
