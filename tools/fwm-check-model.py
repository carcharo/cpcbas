#!/usr/bin/env python3
"""fwm-check-model.py -- the rounding rules of the firmware's REAL + - * / against the recorded vectors.

A reference (Python, BigInt/Fraction) for the rules the recorded vectors show; FWM-SIM
writes the TypeScript model (src/core/locoreal.ts) and its test from these. Reads tests/fixtures/fwmath-vectors.json
and checks every vector of ADD, SUB (464), RSUB, MUL and DIV on the 6128 results (and the 464's SUB):

  MUL, DIV  exactly rounded to 32 mantissa bits, halves away from zero;
  ADD, SUB, RSUB  the smaller operand is aligned by a truncating right shift into a 40-bit field (8 guard bits),
            the magnitudes are added or subtracted, the result is normalised and rounded half up on the 8 guard bits;
  overflow  (exponent above 255) gives +-max, carry clear; the result's exponent byte 0 (underflow, or a
            cancellation) is a zero whose mantissa bytes are junk: checked only for "exponent byte 0, carry set".

Exit 0 when every vector agrees. Usage: python3 tools/fwm-check-model.py [--verbose]
"""
import json
import sys
from fractions import Fraction
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import fwm_ops as O  # noqa: E402

MAXP = bytes.fromhex("FFFFFF7FFF")
MAXN = bytes.fromhex("FFFFFFFFFF")


def neg(x: bytes) -> bytes:
    n, m, e = O.unpack(x)
    return x if m == 0 else O.mk(m, e, not n)


def round_exact(x: Fraction):
    """-> (bytes, carry_ok). Round half away from zero to 32 bits; overflow saturates; underflow -> exponent byte 0."""
    if x == 0:
        return None, True
    sign = x < 0
    x = abs(x)
    e = x.numerator.bit_length() - x.denominator.bit_length()
    while x / Fraction(2) ** e >= 1:
        e += 1
    while x / Fraction(2) ** e < Fraction(1, 2):
        e -= 1
    sc = x / Fraction(2) ** e * (1 << 32)
    m = sc.numerator // sc.denominator
    if sc - m >= Fraction(1, 2):
        m += 1
    if m >> 32:
        m >>= 1
        e += 1
    if e + 128 > 255:
        return (MAXN if sign else MAXP), False
    if e + 128 < 1:
        return b"UNDER", True
    return O.mk(m, e + 128, sign), True


def val(b: bytes) -> Fraction:
    n, m, e = O.unpack(b)
    if m == 0:
        return Fraction(0)
    v = Fraction(m, 1 << 32) * Fraction(2) ** (e - 128)
    return -v if n else v


def add40(a: bytes, b: bytes):
    """a + b with truncating alignment into 32 + 8 bits, round half up on the guard bits."""
    na, ma, ea = O.unpack(a)
    nb, mb, eb = O.unpack(b)
    if ma == 0:
        return b, True
    if mb == 0:
        return a, True
    if ea < eb:
        na, ma, ea, nb, mb, eb = nb, mb, eb, na, ma, ea
    sh = ea - eb
    A = ma << 8
    B = (mb << 8) >> sh if sh < 64 else 0
    s = (-A if na else A) + (-B if nb else B)
    sign = s < 0
    s = abs(s)
    if s == 0:
        return b"ZERO", True
    e = ea
    while s >> 40:
        s >>= 1
        e += 1
    while not s >> 39:
        s <<= 1
        e -= 1
    m = s >> 8
    if s & 0xFF >= 0x80:
        m += 1
    if m >> 32:
        m >>= 1
        e += 1
    if e > 255:
        return (MAXN if sign else MAXP), False
    if e < 1:
        return b"UNDER", True
    return O.mk(m, e, sign), True


def main() -> int:
    verbose = "--verbose" in sys.argv
    d = json.loads((REPO / "tests" / "fixtures" / "fwmath-vectors.json").read_text())
    bad_total = 0
    for op in ("ADD", "SUB", "RSUB", "MUL", "DIV"):
        o = d["ops"][op]
        res = o["results"]["464" if op == "SUB" else "6128"]
        ok = zero = bad = 0
        for inp, r in zip(o["inputs"], res):
            a, b = (bytes.fromhex(x) for x in inp.split())
            got, c = r.split()
            got = bytes.fromhex(got)
            if op == "ADD":
                want, wc = add40(a, b)
            elif op == "SUB":
                want, wc = add40(a, neg(b))
            elif op == "RSUB":
                want, wc = add40(neg(a), b)
            elif op == "MUL":
                want, wc = round_exact(val(a) * val(b))
            else:
                want, wc = round_exact(val(a) / val(b))
            if want in (None, b"ZERO", b"UNDER") or want[4] == 0:
                good = got[4] == 0 and c == "1"
                zero += good
                bad += not good
            else:
                good = got == want and c == ("1" if wc else "0")
                ok += good
                bad += not good
            if not good and verbose:
                print(f"  {op} {inp} -> {r}, model {want.hex() if want else want} carry {wc}")
        print(f"{op}: {ok} exact, {zero} zero/underflow forms, {bad} disagree")
        bad_total += bad
    return 1 if bad_total else 0


if __name__ == "__main__":
    sys.exit(main())
