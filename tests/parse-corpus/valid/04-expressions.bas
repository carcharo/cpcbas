' Spec section 5: expressions, precedence and every operator.
DIM grid(7, 7) AS UBYTE
DIM buf(15) AS UBYTE
a = 2 + 3 * 4 - 6 / 3
b = (2 + 3) * 4
c = 7 \ 2
d = 7 MOD 3
e = 2 ^ 3
e2 = 2 ^ 3 ^ 2
f = -2 ^ 2
g = - a + + b
h = 1 << 4
i = &H80 >> 3
j = a * b \ c MOD d
k = a = b
k = a <> b
k = a < b : k = a > b : k = a <= b : k = a >= b
k = a => b : k = a =< b
m = NOT a AND b OR c XOR d
m = NOT (a > b)
m = a > 1 AND b < 2
n = 1 + 2 << 1
IF a < b AND NOT (c = d) OR e THEN PRINT "x"
s$ = "ab" + "cd" + CHR$(33)
t = "abc" < "abd"
p = @a
v = grid(1, 2) + buf(a) * ABS(a - b)
w = ((a + b) * (c - d)) \ (e + 1)
z = a AND &HFF : z = a OR &H80 : z = a XOR b
