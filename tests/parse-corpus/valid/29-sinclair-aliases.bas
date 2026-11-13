' Spec section 11: the Sinclair forms that are kept as aliases.
PAPER 0
BORDER 1
CLS
PRINT AT 0, 0; "top left"
PRINT AT 10, 5; "row 10, column 5"
BEEP 0.5, 12
BEEP 1, -3
PAUSE 50
CIRCLE 100, 100, 30
c = POINT(100, 130)
IF POINT(10, 10) = 0 THEN PLOT 10, 10
GO TO 100
100 GO SUB 200
END
200 RANDOMIZE
RETURN
