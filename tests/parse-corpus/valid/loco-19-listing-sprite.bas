' Spec sections 6, 9 and 18: a typed-in joystick mover that draws with graphics
' commands, reads keys with INKEY, uses an EVERY timer for the clock and calls a
' firmware routine. Own program.
10 MODE 0 : CLG : BORDER 0
20 x = 320 : y = 200 : c = 1
30 EVERY 50 GOSUB 500
40 WHILE INKEY(66) <> 0
50 IF INKEY(8) = 0 OR (JOY(0) AND 4) THEN x = x - 4
60 IF INKEY(1) = 0 OR (JOY(0) AND 8) THEN x = x + 4
70 IF INKEY(0) = 0 OR (JOY(0) AND 1) THEN y = y + 4
80 IF INKEY(2) = 0 OR (JOY(0) AND 2) THEN y = y - 4
90 IF x < 0 THEN x = 0 ELSE IF x > 636 THEN x = 636
100 IF y < 0 THEN y = 0 ELSE IF y > 396 THEN y = 396
110 IF JOY(0) AND 16 OR INKEY(47) = 0 THEN c = (c MOD 15) + 1
120 PLOT x, y, c
130 FRAME
140 WEND
150 CALL &BB18
160 END
500 secs = secs + 1
510 LOCATE 1, 1 : PRINT secs;
520 RETURN
