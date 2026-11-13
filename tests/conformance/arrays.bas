REM Conformance: arrays -- 1D/2D/3D, LBOUND/UBOUND, array of strings, array copy. Expected
REM values computed by hand.
REM
REM Ported from cpcbuild. Changed with the language: UBOUND and
REM LBOUND with no dimension argument give the bound of dimension 1 (the original gave the
REM number of dimensions, 1); dimension 0 gives the number of dimensions. STR$ became N$.

#include "lib/chk.bas"

REM -- 1D --
DIM a1(4) AS INTEGER
DIM i AS UBYTE
FOR i = 0 TO 4
  a1(i) = i * 10
NEXT i
CHK("d1_val2", N$(a1(2)), "20")
CHK("d1_val4", N$(a1(4)), "40")
REM changed: UBOUND(a1) with no dimension is dimension 1's bound, 4 (it was the dimension
REM count, 1); the dimension count is UBOUND(a1, 0).
CHK("d1_ubound_default", N$(UBOUND(a1)), "4")
CHK("d1_ndims", N$(UBOUND(a1, 0)), "1")
CHK("d1_lbound", N$(LBOUND(a1, 1)), "0")
CHK("d1_ubound", N$(UBOUND(a1, 1)), "4")

REM -- 2D -- 3 rows (0-2) x 4 cols (0-3)
DIM a2(2, 3) AS INTEGER
DIM r AS UBYTE
DIM c AS UBYTE
FOR r = 0 TO 2
  FOR c = 0 TO 3
    a2(r, c) = r * 10 + c
  NEXT c
NEXT r
CHK("d2_val_1_2", N$(a2(1, 2)), "12")
CHK("d2_val_2_3", N$(a2(2, 3)), "23")
CHK("d2_ndims", N$(UBOUND(a2, 0)), "2")
CHK("d2_ubound_dim1", N$(UBOUND(a2, 1)), "2")
CHK("d2_ubound_dim2", N$(UBOUND(a2, 2)), "3")

REM -- 3D -- 2x2x2
DIM a3(1, 1, 1) AS INTEGER
DIM x AS UBYTE
DIM y AS UBYTE
DIM z AS UBYTE
FOR x = 0 TO 1
  FOR y = 0 TO 1
    FOR z = 0 TO 1
      a3(x, y, z) = x * 4 + y * 2 + z
    NEXT z
  NEXT y
NEXT x
CHK("d3_val_1_1_1", N$(a3(1, 1, 1)), "7")
CHK("d3_val_0_1_0", N$(a3(0, 1, 0)), "2")
CHK("d3_ndims", N$(UBOUND(a3, 0)), "3")
CHK("d3_ubound_dim2", N$(UBOUND(a3, 2)), "1")

REM -- array of strings --
DIM sa$(3) AS STRING
sa$(0) = "ZERO"
sa$(1) = "ONE"
sa$(2) = "TWO"
sa$(3) = "THREE"
DIM joined$ AS STRING
joined$ = ""
DIM j AS UBYTE
FOR j = 0 TO 3
  joined$ = joined$ + sa$(j)
NEXT j
CHK("strarr_concat", joined$, "ZEROONETWOTHREE")

REM -- array copy: element by element (an array is not assignable as a whole with `=`) --
DIM src(3) AS INTEGER
DIM dst(3) AS INTEGER
DIM k AS UBYTE
FOR k = 0 TO 3
  src(k) = k * k
NEXT k
FOR k = 0 TO 3
  dst(k) = src(k)
NEXT k
src(0) = 999
CHK("copy_independent", N$(dst(0)), "0")
CHK("copy_val3", N$(dst(3)), "9")

PRINT "DONE"
END
