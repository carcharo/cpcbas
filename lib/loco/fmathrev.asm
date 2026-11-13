; -----------------------------------------------------------------------
; lib/loco/fmathrev.asm -- the byte-order swap between Locomotive's REAL layout and the calculator's
;
; Written from scratch for this project (MIT, see lib/LICENSE). Split out of fmathcalc.asm by review
; R12 (follow-up 64): the integer and FIXED conversions (fmathcv.asm) need only these two routines,
; and taking them from fmathcalc.asm linked the whole calculator (fp_calc.asm, about 2.4 KB) into
; programs that use no REAL arithmetic at all (a FIXED printed with STR$). Read fmathcalc.asm's
; header for the two orders.
;
;   __LOCO_FREV     reverse the byte order of the five registers (A with B, C with E; D stays).
;                   Clobbers L only.
;   __LOCO_FNZ      (calculator order) exponent byte 0 in A: E, D, C, B := 0 (A is kept).
;
; No firmware entry, no calculator.

    push namespace core

__LOCO_FREV:                ; A <-> B, C <-> E (D stays)
    ld   l, a
    ld   a, b
    ld   b, l
    ld   l, c
    ld   c, e
    ld   e, l
    ret

__LOCO_FNZ:                 ; calculator order: exponent byte 0 -> all five bytes 0
    or   a
    ret  nz
    ld   e, a
    ld   d, a
    ld   c, a
    ld   b, a
    ret

    pop namespace
