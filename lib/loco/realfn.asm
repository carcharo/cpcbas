; -----------------------------------------------------------------------
; lib/loco/realfn.asm -- Locomotive text layer: REAL functions
;
; Written from scratch for this project (MIT, see lib/LICENSE). The
; functions of CPC BASIC that the imported floating-point runtime does not
; have in Locomotive's form: DEG/RAD for the trigonometric functions,
; rounding (CINT, INT, FIX), MIN/MAX of reals, RND, and the FIXED
; conversions that must accept the calculator's small-integer form. Kept
; apart from real.asm (the number text) because these pull the floating-point
; calculator in. Every REAL is A E D C B = bytes 0..4 of Locomotive's layout (B = biased exponent;
; C bit 7 = sign; docs/ir.md) and always in the full form; FIXED is DE.HL (DE the integer
; part). The calculator itself works in the Spectrum's order and may produce the small integer
; form: lib/loco/fmath.asm converts at every boundary, and this file calls only its entries
; and the function wrappers below (__LOCO_FSIN ... __LOCO_FPOW).
;
; Entry points (namespace core). Clobbers: AF, BC, DE, HL and the
; calculator's stack; none calls a firmware entry. Firmware builds do not link the calculator
; (INT and FIX are routines on the five bytes in every build).
;
;   __LOCO_DEG, __LOCO_RAD   the angle unit of SIN COS TAN ATN (RAD at start-up)
;   __LOCO_SIN, __LOCO_COS, __LOCO_TAN   REAL -> REAL (degrees after DEG)
;   __LOCO_ATN       REAL -> REAL (the result in degrees after DEG)
;   __LOCO_SQR, __LOCO_EXP, __LOCO_LOG, __LOCO_LOG10   REAL -> REAL
;   __LOCO_INT       REAL -> REAL, the floor
;   __LOCO_FIX       REAL -> REAL, truncation towards zero
;   __LOCO_CINT      REAL -> HL, rounded half away from zero, wrapped to 16 bits
;   __LOCO_INTF16, __LOCO_FIXF16   DEHL -> DEHL (floor, truncation)
;   __LOCO_FTOF16    REAL -> DEHL (FIXED), any REAL form
;   __LOCO_MINF, __LOCO_MAXF   REAL a and REAL b pushed (a first), both popped by the
;                    routine -> the smaller or larger in A E D C B
;   __LOCO_RND       -> REAL in [0, 1) (the imported xorshift generator); __LOCO_RNDLAST,
;                    __LOCO_RNDARG, __LOCO_RANDOMIZE, __LOCO_RANDTIME: see "RND, RANDOMIZE" below
;   __LOCO_ROUND     ROUND(x [, n]): n (16-bit) in HL, x on the stack; see below
;   __LOCO_POW       REAL a (on the stack, as ADDF) ^ REAL b (A E D C B) -> REAL. As the imported
;                    __POW, and a negative a with an integer b works (-8 ^ 3 is -512); a
;                    negative a with a fraction is error 5 (Improper argument)
;   __LOCO_FNORM     REAL -> REAL: the identity now (a REAL is always in the full form), kept for the label table
;   __LOCO_FTOI       REAL -> DEHL, truncated towards zero (any integer cast of a REAL)
;   __LOCO_ABSF      REAL -> REAL, the absolute value (also for a small integer)

#ifdef CPC_BAREMETAL
#include once <fp_calc.asm>
#include once <stackf.asm>
#include once <loco/fmathcalc.asm>
#endif
#include once <error.asm>
#include once <loco/error.asm>
#include once <loco/fmath.asm>
#include once <loco/fmathcmp.asm>
#include once <loco/fmathcv.asm>
#include once <neg32.asm>
#ifdef CPC_BAREMETAL
#include once <math/sin.asm>
#include once <math/cos.asm>
#include once <math/tan.asm>
#include once <math/atan.asm>
#include once <math/exp.asm>
#include once <math/logn.asm>
#include once <math/sqrt.asm>
#include once <random.asm>
#else
#include once <loco/fwmath.asm>
#endif
#include once <loco/randseed.asm>
#include once <fwcall.asm>
#include once <sysvars.asm>

    push namespace core

__RFN_DEG:  DEFB 0          ; non-zero after DEG
__RFN_SIGN: DEFB 0
__RFN_MODE: DEFB 0
__RFN_RET:  DEFW 0
__RFN_A:    DEFS 5
__RFN_B:    DEFS 5
__RFN_T:    DEFS 5
__RFN_NEG: DEFB 0
__RFN_N16: DEFW 0
__RFN_K:   DEFB 0
__RFN_ONE: DEFB 0x00, 0x00, 0x00, 0x00, 0x81
__RFN_TEN: DEFB 0x00, 0x00, 0x00, 0x20, 0x84
#ifdef CPC_BAREMETAL
; pi / 180, 180 / pi and 1 / ln(10) in Locomotive's 5-byte layout
__RFN_PI180:  DEFB 0x13, 0x35, 0xFA, 0x0E, 0x7B
__RFN_180PI:  DEFB 0xD3, 0xE0, 0x2E, 0x65, 0x86
__RFN_LOG10E: DEFB 0xA9, 0xD8, 0x5B, 0x5E, 0x7F
#endif

#ifdef CPC_BAREMETAL
; ---- the calculator's functions behind fmathcalc.asm's order conversion ---------------
; Each takes and gives a REAL in Locomotive's layout. The unit conversion is not here.
__LOCO_FSIN:
    call __LOCO_FREV
    call SIN
    jp   __LOCO_FOUT

__LOCO_FCOS:
    call __LOCO_FREV
    call COS
    jp   __LOCO_FOUT

__LOCO_FTAN:
    call __LOCO_FREV
    call TAN
    jp   __LOCO_FOUT

__LOCO_FATN:
    call __LOCO_FREV
    call ATAN
    jp   __LOCO_FOUT

__LOCO_FSQR:
    call __LOCO_FREV
    call SQRT
    jp   __LOCO_FOUT

__LOCO_FEXP:
    call __LOCO_FREV
    call EXP
    jp   __LOCO_FOUT

__LOCO_FLN:
    call __LOCO_FREV
    call LN
    jp   __LOCO_FOUT

__LOCO_FPOW:                ; a on the stack ^ b in the registers
    call __LOCO_FIN2
    rst  30h
    defb 01h                ; exchange: a ^ b
    defb 06h                ; power
    defb 38h
    jp   __LOCO_FOUT2

__LOCO_DEG:
    ld   a, 1
    ld   (__RFN_DEG), a
    ret

__LOCO_RAD:
    xor  a
    ld   (__RFN_DEG), a
    ret

; A E D C B = A E D C B * (the constant at HL)
__RFN_MULK:
    push hl
    call __LOCO_FPUSH
    pop  hl
    ld   a, (hl)
    inc  hl
    ld   e, (hl)
    inc  hl
    ld   d, (hl)
    inc  hl
    ld   c, (hl)
    inc  hl
    ld   b, (hl)
    call __LOCO_FPUSH
    rst  30h
    defb 04h                ; multiply
    defb 38h                ; end calc
    jp   __LOCO_FPOP

; the argument of the trigonometric functions in radians
__RFN_ARG:
    push af
    ld   a, (__RFN_DEG)
    or   a
    jr   z, __RFN_ARG_RAD
    pop  af
    ld   hl, __RFN_PI180
    jp   __RFN_MULK
__RFN_ARG_RAD:
    pop  af
    ret

__LOCO_SIN:
    call __RFN_ARG
    jp   __LOCO_FSIN

__LOCO_COS:
    call __RFN_ARG
    jp   __LOCO_FCOS

__LOCO_TAN:
    call __RFN_ARG
    jp   __LOCO_FTAN

__LOCO_ATN:
    call __LOCO_FATN
    push af
    ld   a, (__RFN_DEG)
    or   a
    jr   z, __LOCO_ATN_RAD
    pop  af
    ld   hl, __RFN_180PI
    jp   __RFN_MULK
__LOCO_ATN_RAD:
    pop  af
    ret

; SQR by Newton's method on the calculator (the imported SQRT goes through LN and EXP: about 112 ms; this about 20 ms or
; less). x is kept in the calculator's memory cell 0. The first guess comes from the exponent alone: with
; x = m * 2^t (m in [0.5, 1)), a guess 0.85 * 2^(t/2) for an even t and 0.6 * 2^((t+1)/2) for an odd one is within
; 18 percent of the root, so four steps y = (y + x / y) / 2 (the error squares each time: 0.18, 0.014, 1E-4, 5E-9,
; 1E-17) leave nothing above the last bit; a perfect square is a fixed point, so SQR(16) is exactly 4. A negative
; argument is error 5 (Improper argument), zero gives zero.
__LOCO_SQR:
    ld   l, a               ; byte 0 waits in L
    ld   a, b
    or   a
    jr   nz, __SQR_NZ
    ld   a, l               ; zero
    ret
__SQR_NZ:
    bit  7, c
    jr   z, __SQR_POS
    ld   a, 5               ; Improper argument
    jp   __ERROR
__SQR_POS:
    ld   a, b
    ld   (__SQR_EXP), a
    and  1
    ld   (__SQR_ODD), a
    ld   a, l
    call __LOCO_FPUSH       ; x
    rst  30h
    defb 0C0h               ; st_mem_0
    defb 02h                ; delete
    defb 38h
    ld   a, (__SQR_EXP)
    srl  a                  ; (E + (E and 1)) / 2 + 64 is the exponent byte of the guess
    adc  a, 0
    add  a, 64
    ld   b, a
    ld   a, (__SQR_ODD)
    or   a
    ld   hl, __SQR_G85
    jr   z, __SQR_G
    ld   hl, __SQR_G60
__SQR_G:
    ld   a, (hl)
    inc  hl
    ld   e, (hl)
    inc  hl
    ld   d, (hl)
    inc  hl
    ld   c, (hl)
    call __LOCO_FPUSH       ; the guess y0
    rst  30h
    defb 31h, 0E0h, 01h, 05h, 0Fh, 0A2h, 04h   ; y, x / y, y + x / y, * 0.5
    defb 31h, 0E0h, 01h, 05h, 0Fh, 0A2h, 04h
    defb 31h, 0E0h, 01h, 05h, 0Fh, 0A2h, 04h
    defb 31h, 0E0h, 01h, 05h, 0Fh, 0A2h, 04h
    defb 38h
    jp   __LOCO_FPOP
__SQR_EXP: DEFB 0
__SQR_ODD: DEFB 0
__SQR_G85: DEFB 0x9A, 0x99, 0x99, 0x59      ; 0.85 (the exponent byte is made from x)
__SQR_G60: DEFB 0x9A, 0x99, 0x99, 0x19      ; 0.6

__LOCO_EXP:
    jp   __LOCO_FEXP

__LOCO_LOG:                 ; LOG of zero or less is error 6 (Overflow) in Locomotive; the calculator says 5 (L4-ERR)
    push af
    ld   a, b
    or   a
    jr   z, __LOG_BAD
    bit  7, c
    jr   nz, __LOG_BAD
    pop  af
    jp   __LOCO_FLN
__LOG_BAD:
    ld   a, 6
    jp   __ERROR

__LOCO_LOG10:
    call __LOCO_LOG
    ld   hl, __RFN_LOG10E
    jp   __RFN_MULK

#else
; ---- the firmware's functions (FWM-CORE): the argument goes to FWM_A, the result comes back from it.
; The angle unit is the firmware's own (ANGLE), so DEG, RAD, SIN, COS, TAN and ATN give Locomotive's
; results exactly. A carry-clear return is Improper argument (error 5) for SQR, SIN, COS and TAN, and Overflow
; (error 6) for EXP, LOG and LOG10 (all measured on the interpreter: tests/loco/probes/real-err.bas).
__LOCO_DEG:
    ld   a, 0xFF
    jp   __FWM_ANGLE

__LOCO_RAD:
    xor  a
    jp   __FWM_ANGLE

__LOCO_SIN:
    call __FWM_PUTA
    ld   a, FWMO_SIN
    jp   __FWM_FN5

__LOCO_COS:
    call __FWM_PUTA
    ld   a, FWMO_COS
    jp   __FWM_FN5

__LOCO_TAN:                 ; a pole (TAN(90 degrees)) comes back as +-max with the carry clear: Division by zero (11)
    call __FWM_PUTA
    ld   a, FWMO_TAN
    call __FWM_CALL
    jp   c, __FWM_GETA
    ld   a, (FWM_A + 4)
    inc  a
    ld   a, 5
    jp   nz, __ERROR
    ld   a, 11
    call __LOCO_SOFTERR     ; Division by zero carries on with +-max (L4-ERR)
    jp   __FWM_GETA

__LOCO_ATN:
    call __FWM_PUTA
    ld   a, FWMO_ATN
    jp   __FWM_FN5

__LOCO_SQR:
    call __FWM_PUTA
    ld   a, FWMO_SQR
    jp   __FWM_FN5

__LOCO_EXP:
    call __FWM_PUTA
    ld   a, FWMO_EXP
    jp   __FWM_BIN6

__LOCO_LOG:
    call __FWM_PUTA
    ld   a, FWMO_LOG
    jp   __FWM_BIN6

__LOCO_LOG10:
    call __FWM_PUTA
    ld   a, FWMO_LOG10
    jp   __FWM_BIN6
#endif

; INT and FIX on the five bytes, firmware and bare builds alike, no calculator (L5-HOT, follow-up 59; bare builds since
; L5-GAP, follow-up 199: the calculator's small-integer form holds -65535..65535, so INT(-65536) was -1 and FIX(-65536) 0). A REAL is
; (1.f) x 2^(e - 129) with e in B and the 31 bits f at the bottom of A E D C (C bit 7 is the sign), so
; its fraction is the 160 - e lowest mantissa bits: nothing to do from e = 160 on (the value is an
; integer), and none of the value stays below e = 129 (|x| < 1: FIX gives 0, INT gives 0 or -1).
; In between the n = 160 - e low bits are shifted out and back in as zeros. INT of a negative value
; that lost a 1 bit adds one unit at bit n to the magnitude first (a carry out of bit 30 is the next
; exponent). Zero comes back as five zero bytes (a zero from the firmware may have junk in the mantissa).
; L: bit 0 = a 1 bit was dropped, bit 1 = INT, bit 2 = negative.
__LOCO_FIX:
    ld   l, 0
    jr   __RI_GO

__LOCO_INT:
    ld   l, 2
__RI_GO:
    ld   h, a               ; byte 0 waits in H
    ld   a, b
    or   a
    jr   z, __RI_ZERO
    cp   0xA0
    jr   nc, __RI_SAME      ; 2^31 or more: an integer already
    cp   0x81
    jr   c, __RI_SMALL      ; |x| < 1
    ld   a, 0xA0
    sub  b
    ld   b, a               ; B = n, the exponent is 0A0h - n again at the end
    ld   a, h               ; A = byte 0
    ld   h, b               ; H = the loop counter
    bit  7, c
    jr   z, __RI_R
    set  2, l
    res  7, c
__RI_R:                     ; n bits out to the right
    srl  c
    rr   d
    rr   e
    rra
    jr   nc, __RI_N
    set  0, l
__RI_N:
    dec  h
    jr   nz, __RI_R
    ld   h, a
    ld   a, l
    and  7
    cp   7                  ; INT, negative, and a 1 bit was lost: the magnitude grows by one unit
    ld   a, h
    jr   nz, __RI_L0
    inc  a
    jr   nz, __RI_L0
    inc  e
    jr   nz, __RI_L0
    inc  d
    jr   nz, __RI_L0
    inc  c
__RI_L0:
    ld   h, b
__RI_L:                     ; n zero bits back in from the right
    sla  a
    rl   e
    rl   d
    rl   c
    dec  h
    jr   nz, __RI_L
    ld   h, a
    ld   a, 0xA0
    sub  b
    ld   b, a
    bit  7, c
    jr   z, __RI_NOV
    res  7, c               ; the unit carried out of bit 30: the mantissa is 1.0 and the exponent grows
    inc  b
__RI_NOV:
    bit  2, l
    jr   z, __RI_POS
    set  7, c
__RI_POS:
    ld   a, h
    ret
__RI_SAME:
    ld   a, h
    ret
__RI_SMALL:                 ; |x| < 1
    bit  1, l
    jr   z, __RI_ZERO       ; FIX: 0
    bit  7, c
    jr   z, __RI_ZERO       ; INT of a positive value: 0
    xor  a                  ; INT of a negative value: -1
    ld   e, a
    ld   d, a
    ld   c, 0x80
    ld   b, 0x81
    ret
__RI_ZERO:
    xor  a
    ld   e, a
    ld   d, a
    ld   c, a
    ld   b, a
    ret

__LOCO_ABSF:
    res  7, c               ; the sign is bit 7 of byte 3
    ret

; REAL -> DEHL, truncated towards zero (the imported __FTOU32REG floors a negative
; value that has a fraction).
__LOCO_FTOI:
    bit  7, c
    jp   z, __LOCO_FTOU32
    res  7, c
    call __LOCO_FTOU32
    jp   __NEG32

; A REAL is always in the full form now (fmath.asm normalises what the calculator returns),
; so this is the identity. Kept for the label table.
__LOCO_FNORM:
    ret

; ---- CINT: x + 0.5 (x - 0.5 for a negative x), truncated ------------------------
; A result outside -32768..32767 is error 6 (Overflow), fatal unless trapped, as in Locomotive (L4-ERR).
__LOCO_CINT:
    PROC
    LOCAL __CI_FULL, __CI_OVF, __CI_SIGN
    ld   l, a               ; byte 0 waits in L
    ld   a, b
    or   a
    jr   nz, __CI_FULL
    ld   h, a               ; zero is its own CINT
    ld   l, a
    ret
__CI_FULL:
    ld   a, b
    cp   0x91               ; 65536 or more
    jr   nc, __CI_OVF
    ld   a, c
    and  0x80
    ld   (__RFN_SIGN), a
    res  7, c               ; |x|
    ld   a, l
    ld   hl, 0x8000
    push hl                 ; the stack operand 0.5: bytes 0 and 1 ... 0, byte 3 = 0, exponent 0x80
    ld   hl, 0
    push hl
    push hl
    call __LOCO_FADD        ; |x| + 0.5
    call __LOCO_FTOU32      ; truncated, in DEHL
    ld   a, d
    or   e
    jr   nz, __CI_OVF
    bit  7, h
    jr   z, __CI_SIGN
    ld   a, (__RFN_SIGN)    ; 32768 or more: only -32768 itself is an INTEGER
    or   a
    jr   z, __CI_OVF
    ld   a, h
    cp   0x80
    jr   nz, __CI_OVF
    ld   a, l
    or   a
    jr   nz, __CI_OVF
__CI_SIGN:
    ld   a, (__RFN_SIGN)
    or   a
    ret  z
    ld   a, l               ; HL = -HL
    cpl
    ld   l, a
    ld   a, h
    cpl
    ld   h, a
    inc  hl
    ret
__CI_OVF:
    ld   a, 6               ; Overflow
    jp   __ERROR
    ENDP

; ---- FIXED -------------------------------------------------------------------
__LOCO_INTF16:
    ld   hl, 0              ; the integer part of a two's complement value is already the floor
    ret

__LOCO_FIXF16:
    PROC
    LOCAL __FX_CLEAR
    bit  7, d
    jr   z, __FX_CLEAR
    ld   a, h
    or   l
    jr   z, __FX_CLEAR
    inc  de                 ; negative with a fraction: towards zero
__FX_CLEAR:
    ld   hl, 0
    ret
    ENDP

; REAL -> DEHL. The calculator's small integer is the 16-bit integer part.
__LOCO_FTOF16:
    jp   __LOCO_FTOF16REG

; ---- MIN and MAX of two reals ------------------------------------------------------
; Both values are on the stack, a pushed first and b on top (the code generator's two
; `param` quads); the routine pops them and its return address is kept in memory.
; a < b (MIN) or a > b (MAX) selects a, otherwise b. Exit: A E D C B.
__LOCO_MINF:
    xor  a
    jr   __RFN_MINMAX
__LOCO_MAXF:
    ld   a, 1
__RFN_MINMAX:
    PROC
    LOCAL __MM_MAX, __MM_SEL, __MM_B
    ld   (__RFN_MODE), a
    pop  hl                 ; return address
    ld   (__RFN_RET), hl
    pop  af
    pop  de
    pop  bc                 ; b
    ld   hl, __RFN_B
    call __RFN_MM_SAVE
    pop  af
    pop  de
    pop  bc                 ; a
    ld   hl, __RFN_A
    call __RFN_MM_SAVE
    push bc                 ; a on the stack, b in the registers: the runtime's comparisons
    push de
    push af
    ld   a, (__RFN_MODE)
    or   a
    ld   hl, __RFN_B
    call __RFN_MM_LOAD
    jr   nz, __MM_MAX
    call __LOCO_FLT
    jr   __MM_SEL
__MM_MAX:
    call __LOCO_FGT
__MM_SEL:
    or   a
    ld   hl, __RFN_B
    jr   z, __MM_B
    ld   hl, __RFN_A
__MM_B:
    call __RFN_MM_LOAD
    ld   hl, (__RFN_RET)
    push hl
    ret
    ENDP

__RFN_MM_SAVE:              ; (HL) = A E D C B
    ld   (hl), a
    inc  hl
    ld   (hl), e
    inc  hl
    ld   (hl), d
    inc  hl
    ld   (hl), c
    inc  hl
    ld   (hl), b
    ret

__RFN_MM_LOAD:              ; A E D C B = (HL)
    ld   a, (hl)
    inc  hl
    ld   e, (hl)
    inc  hl
    ld   d, (hl)
    inc  hl
    ld   c, (hl)
    inc  hl
    ld   b, (hl)
    ret

; ---- a ^ b ----------------------------------------------------------------------
#ifndef CPC_BAREMETAL
; The firmware's POW does everything: a negative base with an integer exponent works (carry set), a
; negative base with a fraction gives |a| with the carry clear, 0 ^ negative gives +max with the carry
; clear and an overflow gives +-max. So a carry-clear result that is not +-max is Improper argument
; (error 5), +-max with a base of zero is Division by zero (11), otherwise Overflow (6).
__LOCO_POW:
    call __FWM_PUTB
    pop  hl
    pop  af
    pop  de
    pop  bc
    push hl
    call __FWM_PUTA
    push bc                 ; B = the base's exponent byte (0: the base is zero)
    ld   a, FWMO_POW
    call __FWM_CALL
    pop  bc
    jp   c, __FWM_GETA
    ld   a, (FWM_A + 4)
    inc  a
    ld   a, 5
    jp   nz, __ERROR
    ld   a, b
    or   a
    ld   a, 11
    jr   z, __PW_SOFT
    ld   a, 6
__PW_SOFT:
    call __LOCO_SOFTERR     ; Division by zero and Overflow carry on with +-max (L4-ERR)
    jp   __FWM_GETA
#else
; The calculator computes a ^ b as EXP(b * LN(a)), which does not exist for a negative a. The
; sign is taken off, |a| ^ b computed, and the result negated for an odd integer b.
__LOCO_POW:
    PROC
    LOCAL __PW_SET, __PW_ERR
    ld   hl, __RFN_B
    call __RFN_MM_SAVE      ; b
    pop  hl
    pop  af
    pop  de
    pop  bc                 ; a
    push hl
    ld   h, a               ; byte 0 waits in H
    ld   l, 0
    ld   a, b
    or   a
    jr   z, __PW_SET
    bit  7, c
    jr   z, __PW_SET
    res  7, c
    ld   l, 1
__PW_SET:
    ld   a, l
    ld   (__RFN_SIGN), a
    ld   a, h
    push bc
    push de
    push af                 ; |a| on the stack, b in the registers
    ld   hl, __RFN_B
    call __RFN_MM_LOAD
    call __LOCO_FPOW
    ld   hl, __RFN_SIGN
    bit  0, (hl)
    ret  z
    ld   hl, __RFN_A
    call __RFN_MM_SAVE      ; |a| ^ b
    ld   hl, __RFN_B
    call __RFN_MM_LOAD
    call __LOCO_FPUSH
    rst  30h
    defb 31h                ; duplicate
    defb 27h                ; int
    defb 38h
    call __LOCO_FPOP        ; INT(b)
    ld   hl, __RFN_T
    call __RFN_MM_SAVE
    call __LOCO_FPOP        ; b
    ld   hl, __RFN_T
    cp   (hl)
    jr   nz, __PW_ERR
    inc  hl
    ld   a, e
    cp   (hl)
    jr   nz, __PW_ERR
    inc  hl
    ld   a, d
    cp   (hl)
    jr   nz, __PW_ERR
    inc  hl
    ld   a, c
    cp   (hl)
    jr   nz, __PW_ERR
    inc  hl
    ld   a, b
    cp   (hl)
    jr   nz, __PW_ERR
    ld   hl, __RFN_T
    call __RFN_MM_LOAD
    call __LOCO_FTOI
    bit  0, l               ; an odd integer exponent negates
    ld   hl, __RFN_A
    call __RFN_MM_LOAD
    ret  z
    jp   __LOCO_FNEG
__PW_ERR:
    ld   a, 5               ; Improper argument
    jp   __ERROR
    ENDP
#endif

; ---- RND, RANDOMIZE -------------------------------------------------------------
; __LOCO_RND       -> REAL in [0, 1): the next value, kept as "the last value"
; __LOCO_RNDLAST   -> REAL: the last value again, RND(0) (bare builds: 0 before the first RND;
;                  firmware builds: the firmware's own last value)
; __LOCO_RNDARG    REAL n in A E D C B -> REAL: RND(n) with n known only at run time. n = 0 is
;                  the last value, n < 0 reseeds from n (as RANDOMIZE |n|) and gives the first
;                  value of the new sequence, n > 0 is the next value
; __LOCO_RANDOMIZE REAL n in A E D C B: reseeds from n, the same n always giving the same sequence
;                  (bare builds: from |n|, 0 seeds as 1; firmware builds: from n's first four bytes,
;                  sign bit included, as Locomotive's RANDOMIZE n)
; __LOCO_RANDTIME  RANDOMIZE with no number: reseeds from the time (the firmware's 300 Hz tick
;                  count, KL TIME PLEASE; the frame counter in bare-metal mode), never prompts
#ifndef CPC_BAREMETAL
; Firmware builds: the firmware's own generator, so the sequence is Locomotive's. The state is four bytes
; of the firmware's RAM (the address is in the model table, FWMO_SEED). RANDOMIZE n writes
; 07 6C 65 89 xor the first four bytes of n's REAL; RND(-n) is
; RANDOMIZE n followed by RND; RND(0) is the firmware's RND0 entry.
__LOCO_RND:
    ld   a, FWMO_RND
    jr   __RND_CALL

__LOCO_RNDLAST:
    ld   a, FWMO_RND0
__RND_CALL:
    call __FWM_CALL
    jp   __FWM_GETA

__LOCO_RNDARG:
    ld   l, a
    ld   a, b
    or   a
    ld   a, l
    jr   z, __LOCO_RNDLAST
    bit  7, c
    jr   z, __LOCO_RND
    res  7, c
    call __LOCO_RANDOMIZE
    jr   __LOCO_RND

__LOCO_RANDOMIZE:           ; A E D C B = n
    push hl                 ; RANDOM's state too: the bytes of n folded (RANDOM(n) repeats after RANDOMIZE n)
    push de
    push af
    ld   h, a
    ld   l, e
    ld   e, c               ; HL = A E, DE = D C: the sign bit stays in C, so n and -n differ
    call __LOCO_RANDSEEDT
    pop  af
    pop  de
    pop  hl
    xor  0x07
    ld   (FWM_B), a
    ld   a, e
    xor  0x6C
    ld   (FWM_B + 1), a
    ld   a, d
    xor  0x65
    ld   (FWM_B + 2), a
    ld   a, c
    xor  0x89
    ld   (FWM_B + 3), a
__RND_SEEDSET:              ; the four bytes at FWM_B become the seed
    push ix
    push iy
    call __FWM_TBLHL
    ld   de, FWMO_SEED
    add  hl, de
    ld   e, (hl)
    inc  hl
    ld   d, (hl)
    ld   hl, FWM_B
    ld   bc, 4
    ldir
    pop  iy
    pop  ix
    ret

__LOCO_RANDTIME:            ; RANDOMIZE with no number: the 300 Hz tick count is the seed
    call __FW_CALL
    defw 0xBD0D             ; KL TIME PLEASE -> DE HL
    call __LOCO_RANDSEEDT   ; RANDOM(n) too
    ld   a, l
    ld   (FWM_B), a
    ld   a, h
    ld   (FWM_B + 1), a
    ld   a, e
    ld   (FWM_B + 2), a
    ld   a, d
    ld   (FWM_B + 3), a
    jr   __RND_SEEDSET
#else
__RND_LAST: DEFS 5

__LOCO_RND:
    call RND                ; the calculator's order
    call __LOCO_FREV
    ld   hl, __RND_LAST
    jp   __RFN_MM_SAVE

__LOCO_RNDLAST:
    ld   hl, __RND_LAST
    jp   __RFN_MM_LOAD

__LOCO_RNDARG:
    ld   l, a
    ld   a, b
    or   a
    ld   a, l
    jr   z, __LOCO_RNDLAST
    bit  7, c
    jr   z, __LOCO_RND
    res  7, c
    call __LOCO_FREV
    call __RFN_SEED
    jr   __LOCO_RND

__LOCO_RANDOMIZE:
    res  7, c
    call __LOCO_FREV
    jp   __RFN_SEED

; the seed of |n|, in the calculator's order A E D C B (A the exponent): DE = (mantissa high
; bytes, the exponent folded into D), HL = B C
__RFN_SEED:
    PROC
    LOCAL __SD_OK
    xor  d
    ld   d, a
    ld   h, b
    ld   l, c
    or   e
    or   h
    or   l
    jr   nz, __SD_OK
    inc  l                  ; never zero: zero would mean "take the frame counter"
__SD_OK:
    call __LOCO_RANDSEEDT   ; RANDOM(n) too
    jp   RANDOMIZE
    ENDP

__LOCO_RANDTIME:
#ifdef CPC_BAREMETAL
    ld   hl, (FH_FRAMES)
    ld   de, (FH_FRAMES + 2)
#else
    call __FW_CALL
    defw 0xBD0D             ; KL TIME PLEASE -> DE HL
#endif
    call __LOCO_RANDSEEDT   ; RANDOM(n) too
    jp   RANDOMIZE          ; (a zero count takes the frame counter instead)
#endif

; ---- ROUND(x [, n]) ---------------------------------------------------------------
; n (a signed 16-bit value, already rounded to an integer) in HL, x on the stack as A, DE, BC
; (the REAL pushed by a `param`). Rounds x half away from zero to n decimal places (a negative n to tens,
; hundreds, ...): y = x * 10^n (x / 10^-n), r = SGN(y) * INT(ABS(y) + 0.5), r / 10^n (r * 10^-n).
; As measured on the interpreter: n outside -39..39 is error 5; n = 39 is taken as 38; a value
; that has no fraction after scaling (large |x|) comes back unchanged. Exit: A E D C B.
#ifndef CPC_BAREMETAL
; Firmware builds: y = x * 10^n with the firmware's own MUL10A (the instruction the interpreter's tokeniser uses
; for literals), r = y rounded half away from zero to an integer (REAL2BIN, then BIN2REAL), r * 10^-n. A y of
; 2^32 or more has no fraction and stays. 10^39 does not exist: n = 39 is tried as it is and, when x * 10^39
; overflows, taken as 38 (the interpreter's ROUND(1,39) is 1).
__LOCO_ROUND:
    PROC
    LOCAL __RD_NEG, __RD_CHK, __RD_ZERO, __RD_ERR, __RD_SCALED, __RD_NOBIN, __RD_KEEP
    bit  7, h
    jr   z, __RD_CHK
    ld   a, h               ; n = -n
    cpl
    ld   h, a
    ld   a, l
    cpl
    ld   l, a
    inc  hl
__RD_NEG:
    ld   a, h
    or   a
    jp   nz, __RD_ERR
    ld   a, l
    cp   40
    jp   nc, __RD_ERR       ; |n| > 39: Improper argument
    neg
    jr   __RD_SCALED
__RD_CHK:
    ld   a, h
    or   a
    jp   nz, __RD_ERR
    ld   a, l
    cp   40
    jp   nc, __RD_ERR
__RD_SCALED:
    ld   (__RFN_K), a       ; the signed power of ten
    pop  hl
    ld   (__RFN_RET), hl
    pop  af
    pop  de
    pop  bc                 ; x
    ld   l, a
    ld   a, b
    or   a
    jr   z, __RD_ZERO       ; 0 stays 0
    ld   a, l
    ld   hl, __RFN_A
    call __RFN_MM_SAVE
    call __FWM_PUTA
    ld   a, (__RFN_K)
    ld   c, FWMO_MUL10A
    call __FWM_CALLA        ; y = x * 10^n
    jr   c, __RD_NOBIN
    ld   a, (__RFN_K)       ; overflow
    cp   39
    jr   nz, __RD_KEEP
    ld   a, 38
    ld   (__RFN_K), a
    ld   hl, __RFN_A
    call __RFN_MM_LOAD
    call __FWM_PUTA
    ld   a, 38
    ld   c, FWMO_MUL10A
    call __FWM_CALLA
    jr   c, __RD_NOBIN
__RD_KEEP:                  ; x * 10^n does not exist: x has no fraction there, it comes back unchanged
    ld   hl, __RFN_A
    call __RFN_MM_LOAD
    ld   hl, (__RFN_RET)
    push hl
    ret
__RD_NOBIN:
    ld   a, FWMO_REAL2BIN
    call __FWM_CALL         ; the integer, rounded half away from zero (B bit 7 = the sign)
    jr   nc, __RD_KEEP      ; 2^32 or more: no fraction, x comes back unchanged
    ld   a, b
    and  0x80
    ld   c, FWMO_BIN2REAL
    call __FWM_CALLA
    ld   a, (__RFN_K)       ; r * 10^-n
    neg
    ld   c, FWMO_MUL10A
    call __FWM_CALLA
    call __FWM_GETA
    ld   hl, (__RFN_RET)
    push hl
    ret
__RD_ZERO:
    xor  a
    ld   e, a
    ld   d, a
    ld   c, a
    ld   b, a
    ld   hl, (__RFN_RET)
    push hl
    ret
__RD_ERR:
    ld   a, 5               ; Improper argument
    jp   __ERROR
    ENDP
#else
__LOCO_ROUND:
    PROC
    LOCAL __RD_POS, __RD_PLOOP, __RD_PDONE, __RD_RET, __RD_ZERO, __RD_ERR
     LOCAL __RD_DIV1, __RD_P2, __RD_DIV2, __RD_OUT, __RD_NEGK, __RD_BUILD
    ld   (__RFN_N16), hl    ; n
    pop  hl
    ld   (__RFN_RET), hl
    pop  af
    pop  de
    pop  bc                 ; x
    ld   hl, __RFN_A
    call __RFN_MM_SAVE
    ld   hl, (__RFN_N16)
    xor  a
    bit  7, h
    jr   z, __RD_POS
    ld   a, h               ; n = -n
    cpl
    ld   h, a
    ld   a, l
    cpl
    ld   l, a
    inc  hl
    ld   a, 1
__RD_POS:
    ld   (__RFN_NEG), a
    ld   a, h
    or   a
    jp   nz, __RD_ERR
    ld   a, l
    cp   40
    jp   nc, __RD_ERR       ; |n| > 39: Improper argument
    ld   (__RFN_K), a
    ld   a, (__RFN_A + 4)
    or   a
    jp   z, __RD_RET        ; 0 stays 0
    ld   a, (__RFN_NEG)
    or   a
    jp   nz, __RD_NEGK
    ld   a, (__RFN_K)       ; n >= 0: no fraction left after scaling when exponent + 3 n >= 34
    ld   c, a
    add  a, a
    add  a, c
    ld   c, a
    ld   a, (__RFN_A + 4)
    add  a, c
    jp   c, __RD_RET
    cp   0xA2
    jp   nc, __RD_RET       ; unchanged
    ld   a, (__RFN_K)
    cp   39
    jp   nz, __RD_BUILD
    dec  a                  ; 10^39 does not exist
    ld   (__RFN_K), a
    jp   __RD_BUILD
__RD_NEGK:
    ld   a, (__RFN_K)
    cp   39
    jp   z, __RD_ZERO       ; |x| < 1.7E38: x / 10^39 < 0.5
__RD_BUILD:
    ld   hl, __RFN_ONE      ; P = 10^k
    call __RFN_MM_LOAD
    ld   hl, __RFN_B
    call __RFN_MM_SAVE
__RD_PLOOP:
    ld   a, (__RFN_K)
    or   a
    jr   z, __RD_PDONE
    dec  a
    ld   (__RFN_K), a
    ld   hl, __RFN_B
    call __RFN_MM_LOAD
    call __LOCO_FPUSH
    ld   hl, __RFN_TEN
    call __RFN_MM_LOAD
    call __LOCO_FPUSH
    rst  30h
    defb 04h                ; multiply
    defb 38h
    call __LOCO_FPOP
    ld   hl, __RFN_B
    call __RFN_MM_SAVE
    jr   __RD_PLOOP
__RD_PDONE:
    ld   hl, __RFN_A        ; y = x * P (x / P for a negative n)
    call __RFN_MM_LOAD
    call __LOCO_FPUSH
    ld   hl, __RFN_B
    call __RFN_MM_LOAD
    call __LOCO_FPUSH
    ld   a, (__RFN_NEG)
    or   a
    jr   nz, __RD_DIV1
    rst  30h
    defb 04h                ; multiply
    defb 38h
    jr   __RD_P2
__RD_DIV1:
    rst  30h
    defb 05h                ; division
    defb 38h
__RD_P2:
    rst  30h                ; r = SGN(y) * INT(ABS(y) + 0.5)
    defb 31h                ; duplicate
    defb 29h                ; sgn
    defb 01h                ; exchange
    defb 2Ah                ; abs
    defb 0A2h               ; stack 0.5
    defb 0Fh                ; add
    defb 27h                ; int
    defb 04h                ; multiply
    defb 38h
    call __LOCO_FPOP
    ld   hl, __RFN_T
    call __RFN_MM_SAVE
    ld   hl, __RFN_T
    call __RFN_MM_LOAD
    call __LOCO_FPUSH
    ld   hl, __RFN_B
    call __RFN_MM_LOAD
    call __LOCO_FPUSH
    ld   a, (__RFN_NEG)
    or   a
    jr   nz, __RD_DIV2
    rst  30h
    defb 05h                ; division: r / P
    defb 38h
    jr   __RD_OUT
__RD_DIV2:
    rst  30h
    defb 04h                ; multiply: r * P
    defb 38h
__RD_OUT:
    call __LOCO_FPOP
    jp   __RD_EXIT
__RD_ZERO:
    xor  a
    ld   e, a
    ld   d, a
    ld   c, a
    ld   b, a
    jp   __RD_EXIT
__RD_RET:
    ld   hl, __RFN_A
    call __RFN_MM_LOAD
__RD_EXIT:
    ld   hl, (__RFN_RET)
    push hl
    ret
__RD_ERR:
    ld   a, 5               ; Improper argument
    jp   __ERROR
    ENDP
#endif


    pop namespace
