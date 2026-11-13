' Spec section 6: WHILE/WEND and the DO/LOOP forms.
n = 10
WHILE n > 0
  n = n - 1
  IF n = 5 THEN CONTINUE WHILE
  IF n = 2 THEN EXIT WHILE
  PRINT n
WEND
WHILE INKEY$ = "" : WEND

DO
  n = n + 1
  IF n > 20 THEN EXIT DO
LOOP
DO WHILE n > 0
  n = n - 2
LOOP
DO UNTIL n >= 10
  n = n + 3
  IF n = 7 THEN CONTINUE DO
LOOP
DO
  n = n - 1
LOOP WHILE n > 5
DO
  n = n + 1
LOOP UNTIL n = 12
DO : LOOP UNTIL INKEY(47) = 0
DO
  WHILE n < 100
    n = n * 2
  WEND
LOOP UNTIL n > 50
