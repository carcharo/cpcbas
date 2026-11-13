; -----------------------------------------------------------------------
; lib/loco/inputreal.asm -- INPUT's number conversions (the REAL side)
;
; Written from scratch for this project (MIT, see lib/LICENSE). Kept apart from input.asm so a
; program that only INPUTs strings does not link the floating-point library. input.asm reaches
; these three entries through the address of __LOCO_INREAL, which the lowering passes (0 when no
; item is a number); the entries are jumps, 3 bytes each:
;
;   __LOCO_INREAL + 0   text to REAL: (LOCO_KEYTMP) = the text, (LOCO_KEYTMP+2) = its length (a valid
;                       decimal literal without blanks, with an optional sign: the caller checked it).
;                       Exit: A E D C B = the REAL (Locomotive's layout). Clobbers all registers.
;   __LOCO_INREAL + 3   REAL to INTEGER: A E D C B = the REAL. Exit: HL = the value rounded half away
;                       from zero; Carry set when it does not fit 16 bits. Clobbers all registers.
;   __LOCO_INREAL + 6   DE = a signed 16-bit value. Exit: A E D C B = the REAL.
;
; The caller pushes the address to return to and jumps to the entry (its own registers are the
; arguments), so none of the entries needs a register for its own address.

#include once <error.asm>
#include once <mem/alloc.asm>
#include once <loco/strval.asm>
#include once <loco/fmathcv.asm>
#include once <loco/vars.asm>

    push namespace core

__LOCO_INREAL:
    jp   __IR_TEXT
    jp   __IR_TOI
    jp   __IR_FROMI

__IR_TEXT:
    ld   bc, (LOCO_KEYTMP + 2)
    ld   hl, (LOCO_KEYTMP)
    push hl
    push bc
    inc  bc
    inc  bc
    call __MEM_ALLOC
    pop  bc
    pop  de                 ; DE = the text
    ld   a, h
    or   l
    jr   nz, __IR_T1
    ld   a, ERROR_OutOfMemory
    jp   __ERROR
__IR_T1:
    push hl
    ld   (hl), c
    inc  hl
    ld   (hl), b
    inc  hl
    ex   de, hl
    ldir
    pop  hl
    ld   a, 1               ; VAL frees the string
    jp   __LOCO_VAL

; A E D C B = b0 b1 b2 b3 b4: the mantissa 0.5 <= m < 1 with the implicit top bit, the sign in bit 7 of
; b3, the exponent byte b4 (biased by 128, 0 for zero). With s = b4 - 128 the integer part is
; m32 >> (32 - s); adding the next bit rounds half away from zero.
__IR_TOI:
    push bc                 ; the sign (C bit 7)
    ld   h, c
    set  7, h               ; H = the mantissa's top byte
    ld   l, d
    ld   d, e
    ld   e, a               ; HL:DE = the mantissa
    ld   a, b
    or   a
    jr   z, __IR_ZERO
    sub  $80                ; s
    jr   z, __IR_ONE        ; 0.5 <= |x| < 1: 1
    jp   m, __IR_ZERO       ; |x| < 0.5
    cp   17
    jr   nc, __IR_OVF       ; |x| >= 65536
    ld   b, a
    ld   a, 31
    sub  b
    ld   b, a               ; the shift, 15 to 30
__IR_SH:
    srl  h
    rr   l
    rr   d
    rr   e
    djnz __IR_SH
    ex   de, hl             ; DE = the high word, HL = t
    inc  hl                 ; (t + 1) >> 1
    ld   a, h
    or   l
    jr   nz, __IR_H1
    inc  de
__IR_H1:
    srl  e
    rr   h
    rr   l
    jr   __IR_FIN
__IR_ONE:
    ld   hl, 1
    ld   de, 0
__IR_FIN:
    ld   a, d
    or   e
    jr   nz, __IR_OVF       ; 65536
    pop  bc
    bit  7, c
    jr   nz, __IR_NEG
    bit  7, h
    jr   nz, __IR_OVFP      ; 32768 or more
    or   a
    ret
__IR_NEG:
    ld   a, h
    or   l
    ret  z
    bit  7, h
    jr   z, __IR_NEG1
    ld   a, h
    and  $7F
    or   l
    jr   nz, __IR_OVFP      ; below -32768
__IR_NEG1:
    ld   a, l
    cpl
    ld   l, a
    ld   a, h
    cpl
    ld   h, a
    inc  hl
    or   a
    ret
__IR_ZERO:
    pop  bc
    ld   hl, 0
    or   a
    ret
__IR_OVF:
    pop  bc
__IR_OVFP:
    scf
    ret

__IR_FROMI:
    ex   de, hl
    ld   a, h
    rla
    sbc  a, a
    ld   e, a
    ld   d, a
    jp   __LOCO_FI32

    pop namespace
