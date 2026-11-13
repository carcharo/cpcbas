' Spec sections 4, 7 and 9: a sprite SUB that draws pixels from a table with PLOT.
' Mode 1 sprite, 8 by 8, one byte per row.
DIM ship(7) AS UBYTE => {24, 60, 126, 255, 255, 126, 60, 24}
DIM shipX AS INTEGER = 300
DIM shipY AS INTEGER = 40

SUB DrawSprite(BYREF rows() AS UBYTE, x AS INTEGER, y AS INTEGER, colour AS UBYTE)
  DIM r, c AS UBYTE
  DIM bits AS UBYTE
  FOR r = 0 TO 7
    bits = rows(r)
    FOR c = 0 TO 7
      IF bits AND (128 >> c) THEN PLOT x + c * 2, y - r * 2, colour
    NEXT c
  NEXT r
END SUB

SUB EraseSprite(x AS INTEGER, y AS INTEGER)
  DIM r AS UBYTE
  FOR r = 0 TO 7
    MOVE x, y - r * 2
    DRAWR 16, 0, 0
  NEXT r
END SUB

FUNCTION Clip(v AS INTEGER, lo AS INTEGER, hi AS INTEGER) AS INTEGER
  RETURN MAX(lo, MIN(v, hi))
END FUNCTION

MODE 1
GRAPHICS PEN 1
DrawSprite(ship, shipX, shipY, 1)
EraseSprite(shipX, shipY)
shipX = Clip(shipX + 4, 0, 620)
DrawSprite(ship, shipX, shipY, 2)
