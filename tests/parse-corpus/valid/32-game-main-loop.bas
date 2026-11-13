' Spec sections 6 and 9: a main loop with keyboard control, a timer and a score line.
CONST LeftKey = 8
CONST RightKey = 1
CONST FireKey = 47

DIM px AS INTEGER = 320
DIM bx AS INTEGER
DIM by AS INTEGER
DIM firing AS UBYTE
DIM score AS UINTEGER
DIM lives AS UBYTE = 3
DIM seconds AS UINTEGER

SUB ShowScore()
  LOCATE 1, 1
  PRINT USING "SCORE #####"; score;
  PRINT TAB(30); "LIVES"; lives;
END SUB

MODE 1
EVERY 50 GOSUB OneSecond
ON BREAK STOP
ShowScore()

MainLoop:
  FRAME
  IF INKEY(LeftKey) = 0 AND px > 8 THEN px = px - 4
  IF INKEY(RightKey) = 0 AND px < 620 THEN px = px + 4
  IF INKEY(FireKey) = 0 AND NOT firing THEN
    firing = -1
    bx = px
    by = 40
  END IF
  IF firing THEN
    by = by + 8
    PLOT bx, by, 2
    IF by > 380 THEN firing = 0
    SELECT CASE TEST(bx, by + 8)
      CASE 0, 255
        score = score + 1
      CASE 1 TO 3
        score = score + 10
        firing = 0
      CASE ELSE
        score = score + 2
    END SELECT
  END IF
  IF score > 999 OR lives = 0 THEN GOTO GameOver
  ShowScore()
GOTO MainLoop

OneSecond:
  seconds = seconds + 1
  RETURN

GameOver:
  CLS
  PRINT "GAME OVER after"; seconds; "seconds"
  END
