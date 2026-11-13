' Typed SUB/FUNCTION: BYVAL and BYREF, recursion, early RETURN, a function call as an argument.
' Common subset of CPC BASIC and the Boriel fork. Numbers print as [n].
FUNCTION Fact(n AS UINTEGER) AS ULONG
    IF n < 2 THEN RETURN 1
    RETURN n * Fact(n - 1)
END FUNCTION

FUNCTION Fib(n AS UBYTE) AS UINTEGER
    IF n < 2 THEN RETURN n
    RETURN Fib(n - 1) + Fib(n - 2)
END FUNCTION

FUNCTION Gcd(a AS UINTEGER, b AS UINTEGER) AS UINTEGER
    IF b = 0 THEN RETURN a
    RETURN Gcd(b, a MOD b)
END FUNCTION

FUNCTION Clamp(v AS INTEGER, lo AS INTEGER, hi AS INTEGER) AS INTEGER
    IF v < lo THEN RETURN lo
    IF v > hi THEN RETURN hi
    RETURN v
END FUNCTION

SUB AddTo(BYREF target AS INTEGER, BYVAL amount AS INTEGER)
    target = target + amount
    amount = 0
END SUB

SUB Swap2(BYREF a AS UBYTE, BYREF b AS UBYTE)
    DIM t AS UBYTE
    t = a
    a = b
    b = t
END SUB

SUB ShowPair(label AS STRING, x AS INTEGER, y AS INTEGER)
    PRINT label; " [";x;"] [";y;"]"
END SUB

DIM total AS INTEGER
DIM amt AS INTEGER
DIM p, q AS UBYTE
DIM i AS UBYTE

total = 10
amt = 5
AddTo total, amt
PRINT "total [";total;"] amt [";amt;"]"
AddTo(total, -30)
PRINT "total [";total;"]"

p = 3
q = 200
Swap2 p, q
PRINT "swap [";p;"] [";q;"]"

FOR i = 0 TO 7
    PRINT "fib [";Fib(i);"]"
NEXT i
PRINT "fact [";Fact(1);"] [";Fact(5);"] [";Fact(10);"]"
PRINT "gcd [";Gcd(48, 18);"] [";Gcd(17, 5);"] [";Gcd(100, 75);"]"
ShowPair "clamp", Clamp(300, 0, 255), Clamp(-7, 0, 255)
ShowPair "nested", Clamp(Clamp(5, 10, 20), 0, 12), Clamp(Gcd(12, 18), 1, 4)
END
