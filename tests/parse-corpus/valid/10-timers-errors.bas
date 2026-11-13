' Spec section 6: timers (EVERY, AFTER, REMAIN, DI, EI), ON BREAK and error handling.
ON BREAK STOP
ON BREAK CONT
ON ERROR GOTO Handler
EVERY 50 GOSUB Tick
EVERY 25, 1 GOSUB 1000
AFTER 300 GOSUB TimeUp
AFTER 10, 2 GOSUB TimeUp
remaining = REMAIN(1)
PRINT REMAIN(2)
DI
PRINT "critical section"
EI
ERROR 7
IF ERR = 5 THEN PRINT "improper argument"
PRINT ERR; ERL
END

Tick:
  seconds = seconds + 1
  RETURN
1000 beats = beats + 1 : RETURN
TimeUp:
  PRINT "time is up"
  RETURN
Handler:
  PRINT "Error"; ERR; "in line"; ERL
  IF ERL = 0 THEN PRINT "no line number"
  END
