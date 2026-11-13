REM Conformance: 8/16/32-bit signed/unsigned integer arithmetic -- overflow wrap, mul,
REM div/mod by negatives, shifts, bitwise, comparisons. Expected values computed by hand
REM from plain two's-complement, fixed-width arithmetic (no overflow trap: it wraps).
REM
REM Ported from cpcbuild. What changed with the language (each has its REM below):
REM   - `\` is the integer division (Locomotive); `/` on two integers is also an integer
REM     division in cpcbas (a documented difference from Locomotive, checked once).
REM   - DIV truncates toward zero and MOD takes the sign of the dividend, on every path:
REM     the reference compiler's peepholes (floor for a literal 2, magnitude MOD) do not exist.
REM   - A comparison is -1 (true) or 0, held in an INTEGER (Locomotive's truth value).
REM   - Mixed signed/unsigned 16-bit operands are compared as LONGs, not cast to signed.
REM   - SHL/SHR are << and >>, bAND/bOR/bXOR are AND/OR/XOR (bitwise on integers).

#include "lib/chk.bas"

REM ---- overflow wrap (unsigned) ----
DIM ub AS UBYTE
ub = 255
ub = ub + 1
CHK("ubyte_wrap", N$(ub), "0")

DIM ui AS UINTEGER
ui = 65535
ui = ui + 1
CHK("uint_wrap", N$(ui), "0")

DIM ul AS ULONG
ul = 4294967295
ul = ul + 1
CHK("ulong_wrap", T$(STR$(ul)), "0")

REM ---- overflow wrap (signed) ----
DIM sb AS BYTE
sb = 127
sb = sb + 1
CHK("byte_wrap", N$(sb), "-128")

DIM si AS INTEGER
si = 32767
si = si + 1
CHK("int_wrap", N$(si), "-32768")

DIM sl AS LONG
sl = 2147483647
sl = sl + 1
REM changed: the original expected the Spectrum's float text "-2.1474836E+9"; a LONG prints
REM as its integer digits.
CHK("long_wrap", N$(sl), "-2147483648")

REM ---- multiplication overflow wrap ----
DIM m1 AS UBYTE
DIM m2 AS UBYTE
m1 = 200
m2 = 200
m1 = m1 * m2
CHK("ubyte_mul_wrap", N$(m1), "64")

DIM m3 AS BYTE
m3 = 100
m3 = m3 * 2
CHK("byte_mul_wrap", N$(m3), "-56")

REM ---- DIV/MOD by negatives (variable operands, so the general runtime routine) ----
DIM a AS INTEGER
DIM d2 AS INTEGER
DIM d3 AS INTEGER
DIM dm2 AS INTEGER
DIM dm3 AS INTEGER
a = -7
d2 = 2
d3 = 3
dm2 = -2
dm3 = -3

CHK("div_neg_pos", N$(a \ d2), "-3")     REM -7\2, truncate toward 0
CHK("div_pos_neg", N$(7 \ dm2), "-3")    REM 7\-2
CHK("div_neg_neg", N$(a \ dm2), "3")     REM -7\-2
CHK("slash_is_integer", N$(a / d2), "-3")  REM `/` on integers: integer division in cpcbas

REM changed (five MODs): the original expected |a| MOD |b| (never negative); the result
REM now takes the sign of the dividend, as in Locomotive (-17 MOD 5 is -2).
CHK("mod_neg_pos", N$(a MOD d2), "-1")    REM -7 MOD 2
CHK("mod_pos_neg", N$(7 MOD dm2), "1")    REM 7 MOD -2
CHK("mod_neg_neg", N$(a MOD dm2), "-1")   REM -7 MOD -2
CHK("mod_neg_pos3", N$(a MOD d3), "-1")   REM -7 MOD 3
CHK("mod_neg_neg3", N$(a MOD dm3), "-1")  REM -7 MOD -3

REM ---- literal divisors ----
REM changed: the reference compiler turned a variable \ 2 into an arithmetic shift (floor:
REM -4) and a variable MOD 4 into an AND mask (1). cpcbas truncates and keeps the dividend's
REM sign on every path: -7 \ 2 is -3, -7 MOD 4 is -3.
DIM litdiv AS INTEGER
litdiv = -7
CHK("div_by_literal_2", N$(litdiv \ 2), "-3")

DIM litmod AS INTEGER
litmod = -7
CHK("mod_by_literal_4", N$(litmod MOD 4), "-3")

DIM vardiv4 AS INTEGER
vardiv4 = 4
REM changed: was "3" (|-7| MOD |4|); the sign of the dividend gives -3, the same as the literal.
CHK("mod_by_variable_4", N$(litmod MOD vardiv4), "-3")

REM ---- shifts: >> is arithmetic (sign-extending) on signed types, logical on unsigned ----
DIM shs AS INTEGER
shs = -8
CHK("shr_signed", N$(shs >> 1), "-4")

DIM shu AS UINTEGER
shu = 32768
CHK("shr_unsigned", N$(shu >> 1), "16384")

DIM shl1 AS INTEGER
shl1 = 100
CHK("shl", N$(shl1 << 2), "400")

REM ---- bitwise ----
DIM bw1 AS UBYTE
DIM bw2 AS UBYTE
bw1 = 12
bw2 = 10
CHK("band", N$(bw1 AND bw2), "8")
CHK("bor", N$(bw1 OR bw2), "14")
CHK("bxor", N$(bw1 XOR bw2), "6")

DIM bn AS UBYTE
bn = 0
CHK("bnot_ubyte", N$(bn XOR 255), "255")

REM ---- comparisons: true is -1 (changed from 1: the result is held in an INTEGER) ----
DIM c1 AS INTEGER
DIM c2 AS INTEGER
DIM cr AS INTEGER
c1 = -5
c2 = 3
cr = (c1 < c2)
CHK("cmp_signed_lt", N$(cr), "-1")

DIM cu1 AS UINTEGER
DIM cu2 AS UINTEGER
cu1 = 5
cu2 = 3
cr = (cu1 > cu2)
CHK("cmp_unsigned_gt", N$(cr), "-1")

REM Mixed signed/unsigned: UINTEGER 40000 vs INTEGER 100. changed: the reference compiler
REM cast the UINTEGER to signed (-25536 > 100 is false, "0"); cpcbas compares in LONG, so
REM 40000 > 100 is true.
DIM mu AS UINTEGER
DIM mi AS INTEGER
mu = 40000
mi = 100
cr = (mu > mi)
CHK("cmp_mixed_signed", N$(cr), "-1")

PRINT "DONE"
END
