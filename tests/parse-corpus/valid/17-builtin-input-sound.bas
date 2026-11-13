' Spec section 9: keyboard, joystick and sound.
' A joystick read, a key test and a short tune set-up.
CLEAR INPUT
k$ = INKEY$
IF INKEY(47) = 0 THEN PRINT "space held"
j = JOY(0)
IF j AND 1 THEN PRINT "up"
KEY 128, "RUN" + CHR$(13)
KEY DEF 10, 1
KEY DEF 10, 1, 65
KEY DEF 10, 1, 65, 97, 1
SPEED KEY 10, 2
SOUND 1, 100
SOUND 1, 100, 20, 12, 1, 1, 15
SOUND 1, 200, , 15
SOUND 2, 200, 10, , 2
ENV 1
ENV 1, 3, 4, 10
ENV 2, 1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3
ENT 1, 5, -2, 3
ENT -1
RELEASE 7
q = SQ(1)
IF q AND 128 THEN PRINT "channel 1 is full"
