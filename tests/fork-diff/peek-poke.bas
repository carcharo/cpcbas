' PEEK and POKE through @var: a 32-bit, a 16-bit and an 8-bit variable seen as bytes.
' (Arrays are outside the first cpcbas release, so there is no buffer here.)
DIM l AS ULONG
DIM w AS UINTEGER
DIM v AS UBYTE
DIM i AS UBYTE
DIM base AS UINTEGER
DIM sum AS UINTEGER

base = @l
l = 0
FOR i = 0 TO 3
    POKE base + i, 17 * (i + 1)
NEXT i
PRINT "l [";l;"]"
FOR i = 0 TO 3
    PRINT "byte [";PEEK(base + i);"]"
NEXT i

l = 16909060
FOR i = 0 TO 3
    PRINT "byte [";PEEK(@l + i);"]"
NEXT i

w = 0
POKE @w, 52
POKE @w + 1, 18
PRINT "w [";w;"]"
w = 258
PRINT "bytes [";PEEK(@w);"] [";PEEK(@w + 1);"]"

v = 200
POKE @v, PEEK(@v) + 100
PRINT "v [";v;"]"

sum = 0
FOR i = 0 TO 3
    sum = sum + PEEK(@l + i)
NEXT i
PRINT "sum [";sum;"]"
END
