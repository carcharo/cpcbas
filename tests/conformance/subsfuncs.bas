REM Conformance: SUB/FUNCTION -- byval/byref params, recursion (factorial/fibonacci), local
REM arrays. Expected values computed by hand.
REM
REM Ported from cpcbuild. STR$ became N$ (T$(STR$()) for the ULONG factorial).

#include "lib/chk.bas"

REM ---- byval (default for scalars): callee's changes don't escape ----
SUB BumpVal(x AS INTEGER)
  x = x + 100
END SUB

DIM v1 AS INTEGER
v1 = 5
BumpVal(v1)
CHK("byval_unchanged", N$(v1), "5")

REM ---- byref (explicit keyword): callee's changes do escape ----
SUB BumpRef(BYREF x AS INTEGER)
  x = x + 100
END SUB

DIM v2 AS INTEGER
v2 = 5
BumpRef(v2)
CHK("byref_changed", N$(v2), "105")

REM ---- recursion: factorial ----
FUNCTION Fact(n AS UBYTE) AS ULONG
  IF n <= 1 THEN
    RETURN 1
  END IF
  RETURN n * Fact(n - 1)
END FUNCTION

CHK("fact_0", T$(STR$(Fact(0))), "1")
CHK("fact_1", T$(STR$(Fact(1))), "1")
CHK("fact_5", T$(STR$(Fact(5))), "120")
CHK("fact_10", T$(STR$(Fact(10))), "3628800")

REM ---- recursion: fibonacci ----
FUNCTION Fib(n AS UBYTE) AS UINTEGER
  IF n < 2 THEN
    RETURN n
  END IF
  RETURN Fib(n - 1) + Fib(n - 2)
END FUNCTION

CHK("fib_0", N$(Fib(0)), "0")
CHK("fib_1", N$(Fib(1)), "1")
CHK("fib_10", N$(Fib(10)), "55")
CHK("fib_15", N$(Fib(15)), "610")

REM ---- local arrays inside a FUNCTION body ----
FUNCTION SumSquares(n AS UBYTE) AS UINTEGER
  DIM tmp(9) AS UINTEGER
  DIM i AS UBYTE
  DIM total AS UINTEGER
  FOR i = 0 TO n - 1
    tmp(i) = i * i
  NEXT i
  total = 0
  FOR i = 0 TO n - 1
    total = total + tmp(i)
  NEXT i
  RETURN total
END FUNCTION

REM sum of squares 0..4 = 0+1+4+9+16 = 30
CHK("local_array_sum", N$(SumSquares(5)), "30")

PRINT "DONE"
END
