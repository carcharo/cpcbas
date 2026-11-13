REM lib-smoke: the library (cpcbuild.bas) draws a sprite, scans the keys, sets a palette
#include <cpcbuild.bas>

CONST SPR = &7000
CONST PAL = &7100

MODE 1
ScreenInit()

REM a 2 x 2 byte sprite
POKE SPR, &F0
POKE SPR + 1, &0F
POKE SPR + 2, &0F
POKE SPR + 3, &F0
PutSprite(10, 20, 2, 2, SPR)
IF PeekScreen(10, 20) = &F0 AND PeekScreen(11, 20) = &0F AND PeekScreen(10, 21) = &0F AND PeekScreen(11, 21) = &F0 THEN
    PRINT "SPRITE OK"
ELSE
    PRINT "SPRITE BAD"
END IF

REM the keyboard: nothing is held
ScanKeys()
IF AnyKeyDown() = 0 AND KeyDown(KEY_SPACE) = 0 THEN
    PRINT "KEYS OK"
ELSE
    PRINT "KEYS BAD"
END IF

REM a palette of four firmware colours
POKE PAL, 0
POKE PAL + 1, 26
POKE PAL + 2, 6
POKE PAL + 3, 18
SetPalette(PAL, 4)
PRINT "PALETTE OK"

PRINT "DONE"
END
