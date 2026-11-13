' Spec section 7: DEF FN and FN.
DEF FN Double(x) = x * 2
DEF FN Dist(dx, dy) = SQR(dx * dx + dy * dy)
DEF FN Full$(a$, b$) = a$ + " " + b$
DEF FN Pick(n) = INT(RND * n) + 1
PRINT FN Double(21)
y = FN Dist(3, 4) + FN Double(1)
t$ = FN Full$("JOE", "BLOGGS")
IF FN Pick(6) = 6 THEN PRINT "a six"
FOR i = 1 TO FN Double(3) : NEXT
