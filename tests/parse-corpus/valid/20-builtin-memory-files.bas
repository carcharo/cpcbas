' Spec section 9: memory, ports and files, at their minimum and maximum argument counts.
' Loads a screen from disc and saves it again.
DIM top AS UINTEGER
MEMORY &8FFF
top = HIMEM
WAIT &FF34, 1
WAIT &FF34, 1, 0
OUT &7F00, &54
b = INP(&F500)
f = FRE(0) + FRE("")
LOAD "SCREEN.BIN"
LOAD "SCREEN.BIN", &C000
SAVE "SCREEN.BIN"
SAVE "SCREEN.BIN", B, &C000, &4000
SAVE "GAME.BIN", B, &4000, 8192, &4000
CAT
OPENIN "DATA.TXT"
WHILE NOT EOF
  LINE INPUT #9, row$
  PRINT row$
WEND
CLOSEIN
PRINT top; b; f
