' Spec section 6: IF in single-line and block forms.
' A tiny menu.
INPUT "Choice"; c
IF c = 1 THEN PRINT "Start"
IF c = 2 THEN PRINT "Options" ELSE PRINT "Quit"
IF c = 3 THEN 100
IF c = 4 THEN 100 ELSE 200
IF c = 5 THEN PRINT "five" : PRINT "again" ELSE PRINT "other" : PRINT "other2"
IF c = 6 THEN GOTO Done ELSE GOTO 100
IF c = 7 THEN IF c > 1 THEN PRINT "nested on one line"
IF c = 8 THEN IF c > 1 THEN y = 1 ELSE y = 2
IF c = 9 THEN PRINT "nine": ELSE PRINT "not nine"

IF c = 1 THEN
  PRINT "one"
END IF
IF c = 1 THEN
  PRINT "one"
ELSE
  PRINT "not one"
END IF
IF c = 1 THEN
  PRINT "one"
ELSEIF c = 2 THEN
  PRINT "two"
ELSEIF c = 3 THEN
  PRINT "three"
ELSE
  PRINT "many"
END IF
IF c > 0 THEN
  IF c > 10 THEN
    PRINT "big"
  ELSE
    PRINT "small"
  END IF
  IF c = 5 THEN PRINT "five inside a block"
END IF
100 PRINT "line 100"
200 PRINT "line 200"
Done:
END
