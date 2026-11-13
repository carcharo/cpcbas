' Strings: concatenation, LEN, LEFT$, RIGHT$, MID$ (three-argument form), CHR$, ASC (spelled through common.bas), building in a loop.
' PRINT of a string is exact on both compilers, so strings print bare, numbers in [ ].
#include "common.bas"
FUNCTION Shout(s AS STRING, n AS UBYTE) AS STRING
    DIM r AS STRING
    DIM k AS UBYTE
    r = ""
    FOR k = 1 TO n
        r = r + s + "!"
    NEXT k
    RETURN r
END FUNCTION

FUNCTION CountChar(s AS STRING, ch AS UBYTE) AS UBYTE
    DIM k AS UBYTE
    DIM n AS UBYTE
    n = 0
    FOR k = 1 TO LEN(s)
        IF CharCode(MidS(s, k, 1)) = ch THEN n = n + 1
    NEXT k
    RETURN n
END FUNCTION

DIM a AS STRING
DIM b AS STRING
DIM c AS STRING
DIM i AS UBYTE

a = "Hello"
b = "World"
c = a + ", " + b + "!"
PRINT c
PRINT "len [";LEN(c);"] [";LEN(a);"] [";LEN("");"]"
PRINT LeftS(c, 5)
PRINT RightS(c, 6)
PRINT MidS(c, 8, 5)
PRINT MidS(c, 1, 1) + MidS(c, 13, 1)
PRINT "asc [";CharCode(a);"] [";CharCode("z");"] [";CharCode(MidS(c, 6, 1));"]"
PRINT CHR$(72) + CHR$(105) + CHR$(33)

c = ""
FOR i = 0 TO 9
    c = c + CHR$(65 + i)
NEXT i
PRINT c
PRINT "len [";LEN(c);"]"

c = ""
FOR i = 1 TO 5
    c = c + LeftS(a, i) + "-"
NEXT i
PRINT c

' reversal, character by character
b = ""
FOR i = 1 TO LEN(a)
    b = MidS(a, i, 1) + b
NEXT i
PRINT b

' an empty slice and an over-long LEFT$ (an over-long RIGHT$ is not expressible as a fork slice)
PRINT "[" + LeftS(a, 0) + "]"
PRINT LeftS(a, 20) + "|" + RightS(a, 5)
PRINT "[" + MidS(a, 2, 0) + "]"

' comparison inside IF
IF a = "Hello" THEN PRINT "eq"
IF a <> b THEN PRINT "ne"
IF a < b THEN PRINT "lt" ELSE PRINT "ge"

' function returning a string, and a string parameter
c = Shout("abc", 3)
PRINT c
PRINT "count [";CountChar("banana", 97);"] [";CountChar("banana", 110);"] [";CountChar("", 97);"]"
END
