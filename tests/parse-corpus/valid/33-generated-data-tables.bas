' Spec sections 4 and 15: a data file of tables with CONST names and generated-region markers.
'@generated begin sprites
CONST SpriteCount = 2
CONST SpriteBytes = 8
DIM spriteData(15) AS UBYTE => {24, 60, 126, 255, 255, 126, 60, 24, _
                                 129, 66, 36, 24, 24, 36, 66, 129}
'@generated end
'@generated begin palette
DIM palette(3) AS UBYTE => {0, 26, 6, 18}
'@generated end

DIM i AS UBYTE
FOR i = 0 TO 3
  INK i, palette(i)
NEXT i
PRINT SpriteCount * SpriteBytes
