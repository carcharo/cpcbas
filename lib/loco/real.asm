; -----------------------------------------------------------------------
; lib/loco/real.asm -- Locomotive text layer: REAL number text
;
; Written from scratch for this project (MIT, see lib/LICENSE). The digits
; are generated here, on integers, not with fp_tostr.asm (that routine
; prints the Spectrum's text: 8 digits, no sign position). This file does
; not use the floating-point calculator, so a program that only prints
; reals does not link it.
;
; Locomotive's real number text (and probes
; run on the interpreter for this task):
;   - the sign position (a space, or `-`), then the digits. The value is
;     rounded to 9 significant digits, trailing zeros are dropped.
;   - fixed notation when the value is below 1E+9 and, for a value below 1,
;     the zeros after the point plus the digits are at most 9: 0.000123456
;     is fixed, 0.0001234567 is not. Fixed text has no exponent and no
;     trailing zeros (123456790, 0.333333333, 1234567.9).
;   - otherwise the exponent form: at most 6 mantissa digits (a longer digit
;     string is rounded to 6 and keeps its zeros: 1.00000E+10, 1.20000E+15),
;     a shorter one is written as it is (1E+09, 1.5E-10), then `E`, the
;     sign and two exponent digits.
;   - 0 is `0`. PRINT adds a trailing space and the wrap check (__LOCO_FIT),
;     STR$ is the same text without it.
; The value is the 5-byte REAL in Locomotive's layout, in the registers A E D C B = bytes
; 0..4 (a 32-bit mantissa, least significant byte first, whose top bit holds the sign, then
; the biased exponent; docs/ir.md). Exponent 0 is zero. It is always the full form: the
; calculator's small-integer form never reaches this routine (lib/loco/fmath.asm).
;
; Method: the mantissa becomes a 64-bit integer W with a binary exponent
; (value = W * 2^s); W is multiplied or divided by 10 (truncating, 64 bit
; precision) until it lies in [1E+8, 1E+9); its integer part, rounded, is
; the 9 digits, and the number of steps is the decimal exponent.
;
; Entry points (namespace core):
;
;   __LOCO_FMTF     A E D C B = REAL. Exit: HL = text (the sign position
;                   first), BC = its length; the byte after the text is a
;                   space (PRINT text). The text is in a static buffer, valid
;                   until the next call. Clobbers AF, BC, DE, HL and the
;                   buffer of number.asm. No firmware entry.
;   __LOCO_PRINTF   A E D C B = REAL -> one PRINT item: the text, a trailing
;                   space, the wrap check. Clobbers as __LOCO_PRINTI16.
;   __LOCO_FMTDIG   A E D C B = a REAL that is not zero -> the 9 digits in __RF_DIG, the decimal
;                   exponent in __RF_X and the sign in __RF_SIGN (strfmt.asm's DEC$).
;   __LOCO_STRF     STR$(REAL). Exit: HL = a new heap string (0 when the
;                   heap is full), owned by the caller. Clobbers AF, BC, DE, HL.

#include once <loco/number.asm>
#ifndef CPC_BAREMETAL
#include once <loco/fwmath.asm>
#endif

    push namespace core

; ---- work area -------------------------------------------------------------
__RF_W:     DEFS 10         ; W, little endian (byte 7 is the top); byte 8 is the
                            ; carry byte of the multiply and divide steps
__RF_Q:     DEFS 10         ; second operand of the multiply step
__RF_S:     DEFW 0          ; binary exponent s (signed)
__RF_K:     DEFB 0          ; times multiplied by 10, minus times divided
__RF_SIGN:  DEFB 0          ; ' ' or '-'
__RF_N:     DEFB 0          ; significant digits left after stripping zeros
__RF_X:     DEFB 0          ; decimal exponent of the first digit
__RF_DIG:   DEFS 10         ; the 9 digits, ASCII
__RF_BUF:   DEFS 40         ; the text
__RF_DIGONLY: DEFB 0        ; non-zero while __LOCO_FMTDIG runs: stop after the digits

#ifdef CPC_BAREMETAL
; ---- W = W * 10 (renormalised) ------------------------------------------------
; Q = 2W; W = 8W; W = W + Q (9 bytes); then W is shifted right until byte 8 is 0
; (s grows by the shifts, the low bits are dropped). Clobbers AF, BC, DE, HL.
__RF_MUL10:
    PROC
    LOCAL __RM_SHL, __RM_SHL1, __RM_ADD, __RM_SHR, __RM_SHR1, __RM_3
    xor  a
    ld   (__RF_W + 8), a
    ld   hl, __RF_W
    ld   de, __RF_Q
    ld   bc, 9
    ldir
    ld   hl, __RF_Q
    call __RM_SHL           ; Q = 2W
    ld   c, 3
__RM_3:
    ld   hl, __RF_W
    call __RM_SHL           ; W = 8W
    dec  c
    jr   nz, __RM_3
    ld   hl, __RF_W         ; W = 8W + 2W
    ld   de, __RF_Q
    ld   b, 9
    or   a
__RM_ADD:
    ld   a, (de)
    adc  a, (hl)
    ld   (hl), a
    inc  hl
    inc  de
    djnz __RM_ADD
__RM_SHR:                   ; shift right until byte 8 is zero
    ld   a, (__RF_W + 8)
    or   a
    ret  z
    ld   hl, __RF_W + 8
    ld   b, 9
    or   a
__RM_SHR1:
    rr   (hl)
    dec  hl
    djnz __RM_SHR1
    ld   hl, (__RF_S)
    inc  hl
    ld   (__RF_S), hl
    jr   __RM_SHR
__RM_SHL:                   ; the 9 bytes at HL shifted left by one bit
    ld   b, 9
    or   a
__RM_SHL1:
    rl   (hl)
    inc  hl
    djnz __RM_SHL1
    ret
    ENDP

; ---- W = W / 10 (renormalised) --------------------------------------------------
; D = W * 256 is divided by 10 from the top byte down, in place (byte 0 of D is
; 0), so Q = W * 25.6 and s drops by 8; Q is then shifted right until byte 8 is
; zero (s grows by the shifts). Clobbers AF, BC, DE, HL.
__RF_DIV10:
    PROC
    LOCAL __RD_BYTE, __RD_BIT, __RD_KEEP, __RD_SHR, __RD_SHR1
    ld   hl, __RF_W + 7     ; shift W up one byte: W[i+1] = W[i]
    ld   de, __RF_W + 8
    ld   bc, 8
    lddr
    xor  a
    ld   (__RF_W), a
    ld   hl, __RF_W + 8     ; divide from the top byte
    ld   b, 9
    ld   c, 0               ; remainder
__RD_BYTE:
    push bc
    ld   e, (hl)            ; the dividend byte
    ld   d, 0               ; quotient byte
    ld   b, 8
__RD_BIT:
    sla  e
    rl   c                  ; remainder = remainder * 2 + the bit
    ld   a, c
    sub  10
    jr   c, __RD_KEEP
    ld   c, a
__RD_KEEP:
    ccf                     ; carry = 1 when 10 was subtracted
    rl   d
    djnz __RD_BIT
    ld   (hl), d
    dec  hl
    ld   a, c
    pop  bc
    ld   c, a               ; remainder for the next byte
    djnz __RD_BYTE
    ld   hl, (__RF_S)       ; s = s - 8
    ld   de, -8
    add  hl, de
    ld   (__RF_S), hl
__RD_SHR:                   ; shift right until byte 8 is zero
    ld   a, (__RF_W + 8)
    or   a
    ret  z
    ld   hl, __RF_W + 8
    ld   b, 9
    or   a
__RD_SHR1:
    rr   (hl)
    dec  hl
    djnz __RD_SHR1
    ld   hl, (__RF_S)
    inc  hl
    ld   (__RF_S), hl
    jr   __RD_SHR
    ENDP

#endif

; ---- the formatter ----------------------------------------------------------------
__LOCO_FMTF:
    PROC
    LOCAL __FF_FULL, __FF_ZERO, __FF_CHK, __FF_STRIP
#ifdef CPC_BAREMETAL
    LOCAL __FF_START, __FF_LOOP, __FF_BIG, __FF_SMALL, __FF_XPOS
    LOCAL __FF_INR, __FF_NB30, __FF_NB27, __FF_RND, __FF_NOR
#else
    LOCAL __FF_POS
#endif
    LOCAL __FF_FMT, __FF_NEG, __FF_EXP, __FF_E6, __FF_EXPN, __FF_INC, __FF_INCD, __FF_ED, __FF_EXPE
    LOCAL __FF_TENS, __FF_TDONE, __FF_END, __FF_NOZ, __FF_Z, __FF_FRAC, __FF_NOSTRIP
#ifdef CPC_BAREMETAL
    ld   (__RF_W + 4), a    ; mantissa byte 0
    ld   a, b               ; the exponent byte: 0 is zero
    or   a
    jr   nz, __FF_FULL
    ld   a, ' '
    ld   (__RF_SIGN), a
    jp   __FF_ZERO
__FF_FULL:                  ; a full float: B = exponent, C bit 7 = sign
    ld   l, b
    ld   h, 0
    push de
    ld   de, -192           ; s = exponent - 128 - 64
    add  hl, de
    pop  de
    ld   (__RF_S), hl
    ld   a, ' '
    bit  7, c
    jr   z, __FF_XPOS
    ld   a, '-'
__FF_XPOS:
    ld   (__RF_SIGN), a
    ld   a, c
    or   0x80
    ld   (__RF_W + 7), a
    ld   a, d
    ld   (__RF_W + 6), a
    ld   a, e
    ld   (__RF_W + 5), a
    ld   hl, 0
    ld   (__RF_W), hl
    ld   (__RF_W + 2), hl
__FF_START:
    xor  a
    ld   (__RF_K), a
__FF_LOOP:                  ; classify the value: below 1E+8, in range, 1E+9 or more
    ld   hl, (__RF_S)
    ld   de, 64
    add  hl, de             ; HL = n, value < 2^n
    bit  7, h
    jr   nz, __FF_SMALL
    ld   a, h
    or   a
    jr   nz, __FF_BIG
    ld   a, l
    cp   31
    jr   nc, __FF_BIG
    cp   30
    jr   z, __FF_NB30
    cp   28
    jr   nc, __FF_INR
    cp   27
    jr   z, __FF_NB27
    jr   __FF_SMALL
__FF_NB30:                  ; 1E+9 = 0xEE6B2800 * 2^-2
    ld   a, (__RF_W + 7)
    cp   0xEE
    jr   c, __FF_INR
    jr   nz, __FF_BIG
    ld   a, (__RF_W + 6)
    cp   0x6B
    jr   c, __FF_INR
    jr   nz, __FF_BIG
    ld   a, (__RF_W + 5)
    cp   0x28
    jr   c, __FF_INR
    jr   __FF_BIG
__FF_NB27:                  ; 1E+8 = 0xBEBC2000 * 2^-5
    ld   a, (__RF_W + 7)
    cp   0xBE
    jr   c, __FF_SMALL
    jr   nz, __FF_INR
    ld   a, (__RF_W + 6)
    cp   0xBC
    jr   c, __FF_SMALL
    jr   nz, __FF_INR
    ld   a, (__RF_W + 5)
    cp   0x20
    jr   c, __FF_SMALL
    jr   __FF_INR
__FF_BIG:
    call __RF_DIV10
    ld   hl, __RF_K
    dec  (hl)
    jr   __FF_LOOP
__FF_SMALL:
    call __RF_MUL10
    ld   hl, __RF_K
    inc  (hl)
    jr   __FF_LOOP

__FF_INR:                   ; N = round(W >> -s), -s in 34..37
    ld   hl, (__RF_W + 4)
    ld   de, (__RF_W + 6)   ; DEHL = W >> 32
    ld   a, (__RF_S)
    cpl
    inc  a                  ; -s
    sub  33                 ; 1..4 more bits, minus the rounding bit
    ld   b, a
__FF_RND:
    srl  d
    rr   e
    rr   h
    rr   l
    djnz __FF_RND
    srl  d                  ; the rounding bit goes to carry
    rr   e
    rr   h
    rr   l
    jr   nc, __FF_NOR
    inc  l
    jr   nz, __FF_NOR
    inc  h
    jr   nz, __FF_NOR
    inc  de
__FF_NOR:
    ld   a, d               ; N = 1E+9 after rounding: 1E+8, one step less
    cp   0x3B
    jr   nz, __FF_CHK
    ld   a, e
    cp   0x9A
    jr   nz, __FF_CHK
    ld   a, h
    cp   0xCA
    jr   nz, __FF_CHK
    ld   a, l
    or   a
    jr   nz, __FF_CHK
    ld   de, 0x05F5
    ld   hl, 0xE100
    ld   a, (__RF_K)
    dec  a
    ld   (__RF_K), a
#else
    ld   l, a               ; byte 0 waits in L
    ld   a, b               ; the exponent byte: 0 is zero
    or   a
    jr   nz, __FF_FULL
    ld   a, ' '
    ld   (__RF_SIGN), a
    jp   __FF_ZERO
__FF_FULL:                  ; the firmware's PREP gives the 9 digits as Locomotive's PRINT takes them
    ld   a, l
    call __FWM_PUTA
    ld   a, FWMO_PREP
    call __FWM_CALL         ; (FWM_A) = n, E = the decimal exponent of its last digit, B = &FF if negative
    ld   a, ' '
    inc  b
    jr   nz, __FF_POS
    ld   a, '-'
__FF_POS:
    ld   (__RF_SIGN), a
    ld   a, e
    neg
    ld   (__RF_K), a        ; K = -E (the text rule below takes X = 8 - K)
    ld   hl, (FWM_A)
    ld   de, (FWM_A + 2)    ; DEHL = n
#endif
__FF_CHK:                   ; the 9 digits of DEHL
    ld   a, ' '
    call __LOCO_NUMFMT      ; HL = sign position, the digits follow
    inc  hl
    ld   de, __RF_DIG
    ld   bc, 9
    ldir
    ld   a, (__RF_K)        ; X = 8 - K
    ld   c, a
    ld   a, 8
    sub  c
    ld   (__RF_X), a
    ld   b, 9               ; strip the trailing zeros, keep one digit
    ld   hl, __RF_DIG + 8
__FF_STRIP:
    ld   a, (hl)
    cp   '0'
    jr   nz, __FF_NOSTRIP
    dec  hl
    dec  b
    jr   nz, __FF_STRIP
    inc  b                  ; (cannot happen: the first digit is not 0)
__FF_NOSTRIP:
    ld   a, b
    ld   (__RF_N), a
    ld   a, (__RF_DIGONLY)  ; DEC$ wants the digits only
    or   a
    ret  nz

__FF_FMT:                   ; build the text: DE = the output pointer
    ld   a, (__RF_SIGN)
    ld   de, __RF_BUF
    ld   (de), a
    inc  de
    ld   a, (__RF_X)
    bit  7, a
    jr   nz, __FF_NEG
    cp   9
    jr   nc, __FF_EXP
    inc  a                  ; 0 <= X <= 8: X + 1 integer digits
    ld   c, a
    ld   b, 0
    push bc
    ld   hl, __RF_DIG
    ldir
    pop  bc                 ; C = the integer digits
    ld   a, (__RF_N)
    sub  c
    jp   z, __FF_END
    jp   c, __FF_END
    ld   b, a               ; the fraction digits
    ld   a, '.'
    ld   (de), a
    inc  de
    ld   c, b
    ld   b, 0
    ldir
    jp   __FF_END
__FF_NEG:                   ; X < 0: fixed when the zeros plus the digits are at most 9
    neg
    ld   c, a               ; -X
    ld   a, (__RF_N)
    add  a, c
    cp   11
    jr   nc, __FF_EXP
    ld   a, '0'
    ld   (de), a
    inc  de
    ld   a, '.'
    ld   (de), a
    inc  de
    ld   b, c
    dec  b                  ; -X - 1 zeros
    jr   z, __FF_NOZ
    ld   a, '0'
__FF_Z:
    ld   (de), a
    inc  de
    djnz __FF_Z
__FF_NOZ:
    ld   a, (__RF_N)
    ld   c, a
    ld   b, 0
    ld   hl, __RF_DIG
    ldir
    jp   __FF_END
__FF_EXP:                   ; the exponent form
    ld   a, (__RF_N)
    cp   7
    jr   c, __FF_EXPN
    ld   a, (__RF_DIG + 6)  ; more than 6 digits: round to 6 (the zeros stay)
    cp   '5'
    jr   c, __FF_E6
    ld   hl, __RF_DIG + 5
    ld   b, 6
__FF_INC:
    ld   a, (hl)
    inc  a
    cp   '9' + 1
    jr   nz, __FF_INCD
    ld   (hl), '0'
    dec  hl
    djnz __FF_INC
    ld   a, '1'             ; 999999 + 1
    ld   (__RF_DIG), a
    ld   hl, __RF_X
    inc  (hl)
    jr   __FF_E6
__FF_INCD:
    ld   (hl), a
__FF_E6:
    ld   a, 6
__FF_EXPN:
    ld   b, a               ; mantissa digits
    ld   hl, __RF_DIG
    ld   a, (hl)
    ld   (de), a
    inc  de
    inc  hl
    dec  b
    jr   z, __FF_EXPE
    ld   a, '.'
    ld   (de), a
    inc  de
__FF_ED:
    ld   a, (hl)
    ld   (de), a
    inc  de
    inc  hl
    djnz __FF_ED
__FF_EXPE:
    ld   a, 'E'
    ld   (de), a
    inc  de
    ld   a, (__RF_X)
    ld   h, '+'
    bit  7, a
    jr   z, __FF_FRAC
    neg
    ld   h, '-'
__FF_FRAC:
    ld   c, a
    ld   a, h
    ld   (de), a
    inc  de
    ld   b, '0'
    ld   a, c
__FF_TENS:
    cp   10
    jr   c, __FF_TDONE
    sub  10
    inc  b
    jr   __FF_TENS
__FF_TDONE:
    add  a, '0'
    ld   c, a
    ld   a, b
    ld   (de), a
    inc  de
    ld   a, c
    ld   (de), a
    inc  de
__FF_END:
    ld   a, ' '
    ld   (de), a
    ld   hl, __RF_BUF
    ex   de, hl
    or   a
    sbc  hl, de             ; HL = length (without the trailing space)
    ld   b, h
    ld   c, l
    ld   hl, __RF_BUF
    ret

__FF_ZERO:                  ; 0 and -0 are " 0"
    ld   hl, __RF_BUF
    ld   (hl), ' '
    inc  hl
    ld   (hl), '0'
    inc  hl
    ld   (hl), ' '
    ld   hl, __RF_BUF
    ld   bc, 2
    ret
    ENDP

; ---- the digits only (DEC$, strfmt.asm) ------------------------------------------
; A E D C B = a REAL that is not zero. Exit: __RF_DIG = the 9 digits (ASCII, the value
; rounded to 9 significant digits, trailing zeros still there), __RF_X = the decimal
; exponent of the first digit, __RF_SIGN = ' ' or '-', __RF_N = the digits left after
; the trailing zeros. Clobbers AF, BC, DE, HL and the buffers of __LOCO_FMTF.
__LOCO_FMTDIG:
    ld   hl, __RF_DIGONLY
    ld   (hl), 1
    call __LOCO_FMTF
    ld   hl, __RF_DIGONLY
    ld   (hl), 0
    ret

__LOCO_PRINTF:
    call __LOCO_FMTF
    jp   __LOCO_PRINTNUM

__LOCO_STRF:
    call __LOCO_FMTF
    jp   __LOCO_STRNEW

    pop namespace
