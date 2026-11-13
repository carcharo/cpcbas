' Spec sections 9 and 18: a typed-in disc loader: MEMORY below the program, a
' loading screen, a machine-code block with an entry point, an RSX bar call and
' a firmware wait. Own program.
10 MODE 1 : BORDER 0 : INK 0, 0 : INK 1, 26
20 MEMORY &3FFF
30 PRINT "Loading..."
40 LOAD "!title.scr", &C000
50 |DISC
60 LOAD "game.bin", &4000
70 LOAD "tune.bin"
80 IF PEEK(&4000) <> &C3 THEN PRINT "bad block" : END
90 FOR i = 1 TO 3
100 CALL &BB18
110 NEXT
120 CALL &4000
130 SAVE "hiscore", B, &A000, 32
