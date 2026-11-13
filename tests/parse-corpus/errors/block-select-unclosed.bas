' Spec section 6: a SELECT CASE with no END SELECT.
SELECT CASE k
  CASE 1
    PRINT "one"
  CASE ELSE
    PRINT "other"
PRINT "done"
