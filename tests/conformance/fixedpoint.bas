REM Conformance: fixed-point (16.16, 32-bit) arithmetic. Expected values computed by hand;
REM every literal is an exact multiple of 1/4 or 1/2, well inside the format's 1/65536
REM resolution, so there is no rounding to account for.
REM
REM Ported from cpcbuild. STR$ of a FIXED gives Locomotive's number text (leading space for a
REM non-negative number, T$ drops it; the whole numbers have no point). A comparison is -1
REM (true), held in an INTEGER (changed from 1).

#include "lib/chk.bas"

DIM a AS FIXED
DIM b AS FIXED
a = 1.5
b = 2.25

CHK("add", T$(STR$(a + b)), "3.75")
CHK("sub", T$(STR$(a - b)), "-0.75")
CHK("mul_by_int", T$(STR$(a * 2)), "3")

DIM c AS FIXED
c = 10.5
CHK("div_by_int", T$(STR$(c / 2)), "5.25")

DIM d AS FIXED
d = 5.0
CHK("whole_trims_point", T$(STR$(d)), "5")

DIM e AS FIXED
e = -3.75
CHK("negative", T$(STR$(e)), "-3.75")

DIM lt AS INTEGER
lt = (a < b)
CHK("cmp_lt", N$(lt), "-1")

DIM ge AS INTEGER
ge = (b >= a)
CHK("cmp_ge", N$(ge), "-1")

PRINT "DONE"
END
