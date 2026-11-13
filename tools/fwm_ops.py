"""fwm_ops.py -- the firmware maths entries per model and the input generators (FWM-0).

Addresses: the 6128 and 6128 Plus table is the published guide's; the 664's maths block sits 3 bytes
lower (measured, tools/fwm-record.py entries); the 464's is the guide's, with RND and RND(0)
identified by measurement. Everything is re-checked by behaviour by `fwm-record.py entries`.
"""
import random

# name -> (6128/Plus address, 464 address or None); the 664 address is the 6128's minus 3
ENTRIES = {
    "MOVE":    (0xBD61, 0xBD3D),
    "INT2REAL": (0xBD64, 0xBD40),
    "BIN2REAL": (0xBD67, 0xBD43),
    "REAL2INT": (0xBD6A, 0xBD46),
    "REAL2BIN": (0xBD6D, 0xBD49),
    "FIX":     (0xBD70, 0xBD4C),
    "INT":     (0xBD73, 0xBD4F),
    "PREP":    (0xBD76, 0xBD52),
    "MUL10A":  (0xBD79, 0xBD55),
    "ADD":     (0xBD7C, 0xBD58),
    "SUB":     (None,   0xBD5B),
    "RSUB":    (0xBD82, 0xBD5E),
    "MUL":     (0xBD85, 0xBD61),
    "DIV":     (0xBD88, 0xBD64),
    "EXPADD":  (None,   0xBD67),
    "RND":     (0xBD7F, 0xBD9D),
    "RND0":    (0xBD8B, 0xBDA0),
    "CMP":     (0xBD8E, 0xBD6A),
    "NEG":     (0xBD91, 0xBD6D),
    "SGN":     (0xBD94, 0xBD70),
    "ANGLE":   (0xBD97, 0xBD73),
    "PI":      (0xBD9A, 0xBD76),
    "SQR":     (0xBD9D, 0xBD79),
    "POW":     (0xBDA0, 0xBD7C),
    "LOG":     (0xBDA3, 0xBD7F),
    "LOG10":   (0xBDA6, 0xBD82),
    "EXP":     (0xBDA9, 0xBD85),
    "SIN":     (0xBDAC, 0xBD88),
    "COS":     (0xBDAF, 0xBD8B),
    "TAN":     (0xBDB2, 0xBD8E),
    "ATN":     (0xBDB5, 0xBD91),
    "INT1":    (0xBDB8, 0xBD94),
    "INT2":    (0xBDBB, 0xBD97),
    "INT3":    (0xBDBE, 0xBD9A),
}

# the RST 5 entries of the maths block per model: first, last
BLOCK = {"464": (0xBD3D, 0xBDCA), "664": (0xBD5E, 0xBDBB), "6128": (0xBD61, 0xBDBE), "plus": (0xBD61, 0xBDBE)}


def addr(name: str, model: str) -> int | None:
    a6, a4 = ENTRIES[name]
    if model == "464":
        return a4
    if a6 is None:
        return None
    return a6 - 3 if model == "664" else a6


# ---------------------------------------------------------------------------------------------
# Locomotive REAL helpers (bytes: mantissa LS first, byte 3 bit 7 = sign, exponent last, bias &80)
# ---------------------------------------------------------------------------------------------

def mk(mant32: int, exp: int, neg: bool = False) -> bytes:
    """mant32 has bit 31 set (the implied 1 is stored as the sign)."""
    assert mant32 >> 31 == 1 and 1 <= exp <= 255
    b3 = ((mant32 >> 24) & 0x7F) | (0x80 if neg else 0)
    return bytes([mant32 & 255, (mant32 >> 8) & 255, (mant32 >> 16) & 255, b3, exp])


ZERO = bytes(5)


def unpack(b: bytes):
    """-> (neg, mant32 or 0, exp)"""
    if b[4] == 0:
        return (False, 0, 0)
    m = (b[3] & 0x7F) | 0x80
    return (bool(b[3] & 0x80), (m << 24) | (b[2] << 16) | (b[1] << 8) | b[0], b[4])


def from_float(x: float) -> bytes:
    """Nearest REAL (round half even on the 32-bit mantissa), for choosing inputs only."""
    import math
    from fractions import Fraction
    if x == 0:
        return ZERO
    neg = x < 0
    f = Fraction(abs(x))
    e = math.frexp(abs(x))[1]  # abs(x) = m * 2**e, 0.5 <= m < 1
    m = f / Fraction(2) ** e * (1 << 32)
    mi = round(m)
    if mi >> 32:
        mi >>= 1
        e += 1
    return mk(mi, e + 128, neg)


def to_float(b: bytes) -> float:
    neg, m, e = unpack(b)
    if m == 0:
        return 0.0
    v = m / 2 ** 32 * 2.0 ** (e - 128)
    return -v if neg else v


def rand_real(r: random.Random, elo: int, ehi: int, sparse: bool = False) -> bytes:
    if sparse:
        m = 0x80000000
        for _ in range(r.randint(0, 5)):
            m |= 1 << r.randint(0, 30)
    else:
        m = r.getrandbits(32) | 0x80000000
    return mk(m, r.randint(elo, ehi), r.random() < 0.5)


def curated_values() -> list[bytes]:
    vals = [ZERO]
    for x in (1, -1, 0.5, -0.5, 2, 3, -3, 10, 0.1, -0.1, 0.2, 0.3, 100, 255, 256, 32767, 32768, 65535, 65536,
              1e5, 1e10, 123456789, 0.001, 1 / 3, 2 / 3, 3.14159265, 2.5, 1.5, 2.25, 7, 1e-5, 1e15, 1e30, 1e-30,
              1.7e38, 1e38, 1e-38, 4294967295.0, 2147483647.0, 16777216.0):
        vals.append(from_float(x))
    return vals
