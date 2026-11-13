' Screen PRINT: 600 times PRINT i;" ";. The 2026-09-28 benchmark 6. Firmware-bound in both compilers.
' SPEED-NOECHO: built without -D __CPC_PRINTER_ECHO__ (the echo would double the timed loop's printer traffic, and the
' two compilers echo differently: the 2026-09-28 "clean" build). The results reach the printer through PrnChar, MC_PRINT_CHAR
' (&BD2B) through the firmware gate, ended by the END marker line that bench/speed.py's emulator stops on.
#include "tick.bas"

SUB FASTCALL PrnChar(c AS UBYTE)
    ASM
        call .core.__FW_CALL
        defw $BD2B
    END ASM
END SUB

SUB PrnNum(n AS UINTEGER)
    DIM p, d AS UINTEGER
    DIM k AS UBYTE
    p = 10000
    FOR k = 1 TO 5
        d = n / p
        PrnChar(48 + d)
        n = n - d * p
        p = p / 10
    NEXT k
END SUB

SUB PrnLine(ch AS UBYTE, n AS UINTEGER)
    PrnChar(ch)
    PrnChar(32)
    PrnChar(91)
    PrnNum(n)
    PrnChar(93)
    PrnChar(10)
END SUB

DIM i, sum, t, e AS UINTEGER

sum = 0
t = TICK()
FOR i = 1 TO 600
    PRINT i;" ";
    sum = (sum + i) MOD 10000
NEXT i
e = TICK()
PrnLine(84, e - t)
PrnLine(83, sum)
PrnChar(4)
PrnChar(69)
PrnChar(78)
PrnChar(68)
PrnChar(10)
END
