' Spec section 6: FOR and NEXT.
DIM i, j AS INTEGER
FOR i = 1 TO 10
  PRINT i
NEXT i
FOR i = 10 TO 1 STEP -1 : PRINT i; : NEXT
FOR i = 0 TO 254 STEP 2
  FOR j = 0 TO 1
    PLOT i, j
  NEXT j
NEXT i
FOR i = 0 TO 3
  FOR j = 0 TO 3
    PLOT i, j
NEXT j, i
FOR i = 0 TO 3
  FOR j = 0 TO 3
    PLOT j, i
NEXT : NEXT
FOR x! = 0 TO 1 STEP 0.25 : PRINT x! : NEXT x!
FOR i = 1 TO 100
  IF i MOD 2 = 0 THEN CONTINUE FOR
  IF i > 50 THEN EXIT FOR
  PRINT i
NEXT
FOR i = first TO last + 1 STEP stride : NEXT
