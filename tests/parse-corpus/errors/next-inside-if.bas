' Spec section 6 and decisions: a NEXT inside an IF cannot close the FOR outside it.
FOR i = 1 TO 10
  IF i > 5 THEN NEXT
NEXT
