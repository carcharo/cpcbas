' (Lines stay under 40 columns on cpcbas, where numbers print with spaces: a longer line wraps.)
' CONST, DIM with scalar initialisers, a FASTCALL SUB, an ASM block reading a global.
CONST CellW AS UBYTE = 40
CONST Limit AS UINTEGER = 1000
CONST Greeting AS STRING = "hi"

DIM a AS UBYTE = 5
DIM b AS INTEGER = -1234
DIM c AS LONG = 100000
DIM d AS UINTEGER = Limit + 1
DIM s AS STRING
DIM g AS UBYTE
DIM e AS UBYTE = CellW * 2

s = "init"
PRINT "init [";a;"] [";b;"] [";c;"]"
PRINT "init [";d;"] [";e;"]"
PRINT s
PRINT Greeting; " [";LEN(Greeting);"] [";CellW;"] [";Limit;"]"

SUB FASTCALL Bump(x AS UBYTE)
    ASM
        inc a
        ld (_g), a
    END ASM
END SUB

Bump(a)
PRINT "g [";g;"]"
Bump(255)
PRINT "g [";g;"]"

' an ASM block reading a global
ASM
    ld a, (_a)
    add a, a
    ld (_g), a
END ASM
PRINT "g [";g;"]"
END
