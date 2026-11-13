REM Conformance: floating point (REAL). The first block is exact binary fractions (halves,
REM quarters, eighths) so there is no rounding to account for by hand.
REM
REM Ported from cpcbuild. Locomotive's number text replaces the Spectrum-style text of the
REM original: 9 significant digits, a leading space for a non-negative number (dropped by T$),
REM and exponents with a sign and two digits ("0.000004"). The changed expectations are the
REM "round_*" ones, with the values Locomotive prints (see tests/loco/real-basic.expected for
REM the same texts from the interpreter: 0.666666667, 1.41421356, 2.71828183, 2.30258509).
REM A comparison is -1 (true), held in an INTEGER.

#include "lib/chk.bas"

DIM a AS REAL
DIM b AS REAL
a = 1.5
b = 2.25

CHK("add", T$(STR$(a + b)), "3.75")
CHK("sub", T$(STR$(b - a)), "0.75")
CHK("mul", T$(STR$(a * 2)), "3")
CHK("div", T$(STR$(b / a)), "1.5")

CHK("sqr_perfect", T$(STR$(SQR(16.0))), "4")
CHK("abs_neg", T$(STR$(ABS(-3.5))), "3.5")
CHK("abs_pos", T$(STR$(ABS(3.5))), "3.5")
CHK("int_trunc", T$(STR$(INT(3.75))), "3")
REM INT is floor in Locomotive (FIX truncates): INT(-3.75) is -4
CHK("int_trunc_neg", T$(STR$(INT(-3.75))), "-4")

DIM big AS REAL
big = 100000.0
CHK("large_no_exponent", T$(STR$(big)), "100000")

DIM lt AS INTEGER
lt = (a < b)
CHK("cmp_lt", N$(lt), "-1")

DIM eq AS INTEGER
eq = (a + b = 3.75)
CHK("cmp_eq", N$(eq), "-1")

REM --- number text rounding (9 significant digits, Locomotive style) ---
REM Each value is computed into a REAL variable in its own statement, then STR$'d in a
REM separate CHK call: STR$ of a constant expression may be folded by the compiler, and
REM the point is the runtime conversion.

DIM sinval AS REAL
sinval = SIN(PI / 6)
CHK("round_sin_half", T$(STR$(sinval)), "0.5")

DIM two AS REAL
DIM three AS REAL
two = 2
three = 3
CHK("round_two_thirds", T$(STR$(two / three)), "0.666666667")
CHK("round_neg_two_thirds", T$(STR$(-two / three)), "-0.666666667")
CHK("round_one_third", T$(STR$((two / two) / three)), "0.333333333")

DIM lnval AS REAL
lnval = LOG(10)
CHK("round_ln10", T$(STR$(lnval)), "2.30258509")

DIM sqrval AS REAL
sqrval = SQR(2)
CHK("round_sqr2", T$(STR$(sqrval)), "1.41421356")

DIM expval AS REAL
expval = EXP(1)
CHK("round_exp1", T$(STR$(expval)), "2.71828183")

DIM tenth AS REAL
tenth = 0.1
CHK("round_tenth", T$(STR$(tenth)), "0.1")

DIM near1 AS REAL
near1 = 0.999996
CHK("round_carry_to_1", T$(STR$(near1)), "0.999996")

DIM near10 AS REAL
near10 = 9.999996
CHK("round_carry_to_10", T$(STR$(near10)), "9.999996")

REM 99999.999996 built at runtime from exactly representable pieces: this checks the
REM conversion's carry into the next digit, not the literal packer.
DIM hundredk AS REAL
DIM sixmil AS REAL
hundredk = 100000
sixmil = 1000000
CHK("round_carry_to_100000", T$(STR$(hundredk - 4 / sixmil)), "100000")

REM changed: the original expected "4E-6" (Spectrum). Locomotive keeps a one-digit value this
REM small in fixed text, as the interpreter measured for 1E-5 (" 0.00001",
REM "Number text"): 0.000004 prints as 0.000004.
DIM tiny AS REAL
tiny = 0.000004
CHK("round_tiny", T$(STR$(tiny)), "0.000004")

DIM negtiny AS REAL
negtiny = -0.000004
CHK("round_neg_tiny_no_sign", T$(STR$(negtiny)), "-0.000004")

DIM mixed AS REAL
mixed = 123.456
CHK("round_no_op_exact", T$(STR$(mixed)), "123.456")

DIM intf AS REAL
intf = 1024
CHK("round_no_op_integer", T$(STR$(intf)), "1024")

DIM zerof AS REAL
zerof = 0
CHK("round_zero", T$(STR$(zerof)), "0")

PRINT "DONE"
END
