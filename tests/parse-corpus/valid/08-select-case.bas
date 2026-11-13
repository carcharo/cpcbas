' Spec section 6: SELECT CASE with every kind of test.
' Reading a key press in a menu.
DIM k AS UBYTE
k = ASC(INKEY$)
SELECT CASE k
  CASE 49
    PRINT "one"
  CASE 50, 51, 53
    PRINT "two, three or five"
  CASE 65 TO 90
    PRINT "upper case"
  CASE IS > 200
    PRINT "high"
  CASE IS <= 8
    PRINT "control"
  CASE ELSE
    PRINT "other"
END SELECT

a$ = INKEY$
SELECT CASE a$
  CASE "Y", "y"
    PRINT "yes"
  CASE "N", "n"
    PRINT "no"
END SELECT

SELECT CASE k
  CASE IS = 3
    SELECT CASE a$
      CASE "A" TO "Z"
        PRINT "letter"
      CASE IS <> ""
        PRINT "something"
    END SELECT
  CASE IS >= 4
    PRINT "never mind"
END SELECT

' Mixed tests in one CASE list, and CASE after a colon on the SELECT line.
SELECT CASE k : CASE 1, 3 TO 5, IS > 9
  PRINT "mixed"
  CASE 2 : PRINT "two" : CASE ELSE : PRINT "rest"
END SELECT
