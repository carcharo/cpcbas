' Spec sections 6, 7 and 9: a title screen with a colour cycle and a start key.
CONST TitleRow = 8
CONST FlashDelay = 6

DIM phase AS UBYTE
DIM pressed AS UBYTE

SUB Centre(row AS UBYTE, text AS STRING)
  LOCATE 20 - LEN(text) \ 2, row
  PRINT text;
END SUB

SUB SetupScreen()
  MODE 0
  BORDER 0
  INK 0, 0
  INK 1, 26
  INK 2, 6
  INK 3, 18, 24
  PAPER 0 : PEN 1
  CLS
END SUB

SetupScreen()
PEN 3
Centre(TitleRow, "SPACE RAIDERS")
PEN 2
Centre(TitleRow + 3, "PRESS SPACE TO START")
PEN 1
Centre(22, "(C) 2026")

pressed = 0
DO
  FRAME
  phase = phase + 1
  IF phase MOD FlashDelay = 0 THEN
    INK 2, 6 + (phase \ FlashDelay AND 1) * 20
  END IF
  IF INKEY(47) = 0 THEN pressed = 1
LOOP UNTIL pressed
CLS
PRINT "GO!"
