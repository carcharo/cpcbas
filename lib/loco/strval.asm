; -----------------------------------------------------------------------
; lib/loco/strval.asm -- Locomotive VAL
;
; Written from scratch for this project (MIT, see lib/LICENSE). Kept apart
; from str.asm because it pulls the floating-point library in. The imported
; VAL (val.asm) reads from the first byte and leaves garbage for a string of
; length 0 or for NULL; this wrapper skips blanks and a `+` and gives it the
; text "0" when there is none.
;
;   __LOCO_VAL      HL = string, A = free flag (non-zero: the string is a
;                   temporary and is freed). Exit: A E D C B = the REAL value (Locomotive's layout)
;                   of the first numeric literal after leading spaces (and one
;                   `+`); 0 when there is none ("abc"). The imported VAL reads
;                   sign, digits, a point and an exponent (1E3 is 1000).
;                   Clobbers all registers and the floating-point stack.
;   No firmware entry.

#include once <mem/free.asm>
#include once <strslice.asm>
#ifdef CPC_BAREMETAL
#include once <val.asm>
#include once <loco/fmathcalc.asm>
#else
#include once <loco/fwmath.asm>
#endif

    push namespace core

; ---- VAL -----------------------------------------------------------------
; The imported VAL reads a literal from its first byte. Leading spaces and a
; `+` are skipped here by slicing a copy off the front.
__LOCO_VAL:
    push af                 ; free flag
    ld   a, h
    or   l
    jr   z, __VAL_ZERO      ; NULL
    push hl
    ld   c, (hl)
    inc  hl
    ld   b, (hl)
    inc  hl                 ; BC = length, HL = bytes
    ld   de, 0              ; DE = bytes to skip
__VAL_SKIP:
    ld   a, b
    or   c
    jr   z, __VAL_SKIPPED
    ld   a, (hl)
    cp   ' '
    jr   nz, __VAL_PLUS
    inc  hl
    inc  de
    dec  bc
    jr   __VAL_SKIP
__VAL_PLUS:
    cp   '+'
    jr   nz, __VAL_SKIPPED
    inc  de
    dec  bc
__VAL_SKIPPED:
    pop  hl                 ; the string
    ld   a, d
    or   e
    jr   nz, __VAL_SLICE
    ld   a, b
    or   c
    jr   z, __VAL_ZERO      ; no text at all
__VAL_GO:
    pop  af
    jp   __VAL_CALL
__VAL_SLICE:
    pop  af                 ; free flag
    ld   bc, 0FFFEh
    call __STRSLICE_FAST    ; HL = the text after the blanks (owned), 0 if none
    ld   a, h
    or   l
    jr   z, __VAL_NONE
    ld   a, 1
    jp   __VAL_CALL
__VAL_ZERO:                 ; HL = a string to discard, stack: free flag
    pop  af
    or   a
    call nz, __MEM_FREE
__VAL_NONE:
    ld   hl, __VAL_ZEROSTR
    xor  a
    jp   __VAL_CALL
__VAL_ZEROSTR:
    DEFW 1
    DEFB '0'

#ifdef CPC_BAREMETAL
__VAL_CALL:                 ; HL = the text, A = free flag: the imported VAL, on the calculator
    call VAL
    jp   __LOCO_FOUT
#else
; Firmware builds make the REAL the way Locomotive's tokeniser makes a literal (measured on the interpreter's VAL as well): the digits as an integer D (up to 48 bits; further digits only move the
; exponent), rounded once to a REAL, then the firmware's x 10^E in one MUL10A. Grammar of the imported VAL: a minus sign,
; digits, a point, digits, E or e with an optional sign and digits; the first other character ends the number.
__VF_D:     DEFS 6          ; the digits as an integer, least significant byte first
__VF_T:     DEFS 6
__VF_E:     DEFW 0          ; the decimal exponent
__VF_X:     DEFW 0          ; the exponent digits
__VF_NEG:   DEFB 0
__VF_PT:    DEFB 0
__VF_DG:    DEFB 0
__VF_XS:    DEFB 0

__VF_SHL:                   ; the 6 bytes at HL shifted left by one bit
    ld   b, 6
    or   a
__VF_SHL1:
    rl   (hl)
    inc  hl
    djnz __VF_SHL1
    ret

__VF_MULADD:                ; D = D * 10 + A; carry set when D is full and the digit was dropped. Keeps BC and DE.
    ld   (__VF_DG), a
    push bc
    push de
    ld   a, (__VF_D + 5)
    cp   0x19
    jr   nc, __VF_FULL
    ld   hl, __VF_D
    ld   de, __VF_T
    ld   bc, 6
    ldir
    ld   hl, __VF_T
    call __VF_SHL           ; T = 2 D
    ld   hl, __VF_D
    call __VF_SHL
    ld   hl, __VF_D
    call __VF_SHL
    ld   hl, __VF_D
    call __VF_SHL           ; D = 8 D
    ld   hl, __VF_D
    ld   de, __VF_T
    ld   b, 6
    or   a
__VF_ADD:
    ld   a, (de)
    adc  a, (hl)
    ld   (hl), a
    inc  hl
    inc  de
    djnz __VF_ADD
    ld   a, (__VF_DG)
    ld   hl, __VF_D
    add  a, (hl)
    ld   (hl), a
    jr   nc, __VF_MOK
    ld   b, 5
__VF_CY:
    inc  hl
    inc  (hl)
    jr   nz, __VF_MOK
    djnz __VF_CY
__VF_MOK:
    pop  de
    pop  bc
    or   a
    ret
__VF_FULL:
    pop  de
    pop  bc
    scf
    ret

__VAL_CALL:                 ; HL = the text, A = free flag. Exit: A E D C B.
    ld   (__VF_FREE), a
    ld   (__VF_STR), hl
    ld   hl, 0
    ld   (__VF_E), hl
    ld   (__VF_D), hl
    ld   (__VF_D + 2), hl
    ld   (__VF_D + 4), hl
    xor  a
    ld   (__VF_NEG), a
    ld   (__VF_PT), a
    ld   hl, (__VF_STR)
    ld   a, h
    or   l
    jp   z, __VF_CONV       ; NULL: 0
    ld   c, (hl)
    inc  hl
    ld   b, (hl)
    inc  hl
    ex   de, hl             ; DE = the text, BC = its length
    ld   a, b
    or   c
    jp   z, __VF_CONV
    ld   a, (de)
    cp   '-'
    jr   nz, __VF_LOOP
    ld   a, 1
    ld   (__VF_NEG), a
    inc  de
    dec  bc
__VF_LOOP:
    ld   a, b
    or   c
    jp   z, __VF_CONV
    ld   a, (de)
    cp   '.'
    jr   nz, __VF_NOTDOT
    ld   a, 1
    ld   (__VF_PT), a
    jr   __VF_NEXT
__VF_NOTDOT:
    cp   'E'
    jr   z, __VF_EXP
    cp   'e'
    jr   z, __VF_EXP
    sub  '0'
    cp   10
    jp   nc, __VF_CONV      ; any other character ends the number
    call __VF_MULADD
    ld   a, (__VF_PT)
    jr   c, __VF_DROPPED
    or   a
    jr   z, __VF_NEXT
    ld   hl, (__VF_E)       ; a fraction digit: one place to the right
    dec  hl
    ld   (__VF_E), hl
    jr   __VF_NEXT
__VF_DROPPED:
    or   a
    jr   nz, __VF_NEXT      ; a dropped fraction digit changes nothing
    ld   hl, (__VF_E)       ; a dropped integer digit: the value is 10 times larger
    inc  hl
    ld   (__VF_E), hl
__VF_NEXT:
    inc  de
    dec  bc
    jr   __VF_LOOP

__VF_EXP:                   ; E, an optional sign and digits
    inc  de
    dec  bc
    xor  a
    ld   (__VF_XS), a
    ld   hl, 0
    ld   (__VF_X), hl
    ld   a, b
    or   c
    jr   z, __VF_XEND
    ld   a, (de)
    cp   '+'
    jr   z, __VF_XSKIP
    cp   '-'
    jr   nz, __VF_XLOOP
    ld   a, 1
    ld   (__VF_XS), a
__VF_XSKIP:
    inc  de
    dec  bc
__VF_XLOOP:
    ld   a, b
    or   c
    jr   z, __VF_XEND
    ld   a, (de)
    sub  '0'
    cp   10
    jr   nc, __VF_XEND
    ld   l, a               ; the digit
    ld   a, (__VF_X + 1)
    cp   0x10
    jr   nc, __VF_XNEXT     ; far too large already: the rest does not matter
    push bc
    ld   bc, (__VF_X)
    ld   h, 0
    push hl                 ; the digit
    ld   h, b
    ld   l, c
    add  hl, hl
    add  hl, hl
    add  hl, bc
    add  hl, hl             ; 10 X
    pop  bc                 ; the digit
    ld   b, 0
    add  hl, bc
    ld   (__VF_X), hl
    pop  bc
__VF_XNEXT:
    inc  de
    dec  bc
    jr   __VF_XLOOP
__VF_XEND:
    ld   hl, (__VF_X)
    ld   a, (__VF_XS)
    or   a
    jr   z, __VF_XADD
    ex   de, hl
    ld   hl, 0
    or   a
    sbc  hl, de
__VF_XADD:
    ld   de, (__VF_E)
    add  hl, de
    ld   (__VF_E), hl

__VF_CONV:
    ld   a, (__VF_FREE)     ; the text is not needed any more
    or   a
    jr   z, __VF_NOFREE
    ld   hl, (__VF_STR)
    ld   a, h
    or   l
    call nz, __MEM_FREE
__VF_NOFREE:
    ld   hl, __VF_D         ; D = 0: the result is 0
    ld   b, 6
    xor  a
__VF_Z:
    or   (hl)
    inc  hl
    djnz __VF_Z
    jr   nz, __VF_NONZERO
    ld   a, 0
    ld   e, a
    ld   d, a
    ld   c, a
    ld   b, a
    ret
__VF_NONZERO:
    ld   c, 0               ; C = the shifts that make bit 47 the top bit
__VF_NORM:
    ld   a, (__VF_D + 5)
    bit  7, a
    jr   nz, __VF_NORMD
    push bc
    ld   hl, __VF_D
    call __VF_SHL
    pop  bc
    inc  c
    jr   __VF_NORM
__VF_NORMD:
    ld   a, 176             ; the exponent byte: 129 + the position of the top bit (47 - C)
    sub  c
    ld   b, a
    ld   hl, (__VF_D + 2)   ; the top 32 bits
    ld   de, (__VF_D + 4)
    ld   a, (__VF_D + 1)
    bit  7, a               ; the bit below: half rounds up
    jr   z, __VF_RDONE
    inc  hl
    ld   a, h
    or   l
    jr   nz, __VF_RDONE
    inc  de
    ld   a, d
    or   e
    jr   nz, __VF_RDONE
    ld   de, 0x8000         ; 2^32: back to 0x80000000, the exponent grows
    inc  b
__VF_RDONE:
    ld   a, d
    and  0x7F               ; the top bit is implied
    ld   d, a
    ld   (FWM_A), hl
    ld   (FWM_A + 2), de
    ld   a, b
    ld   (FWM_A + 4), a
__VF_SCALE:                 ; x 10^E in one or more MUL10A (a byte of power at a time)
    ld   hl, (__VF_E)
    ld   a, h
    or   a
    jr   nz, __VF_BIGE
    ld   a, l
    cp   128
    jr   c, __VF_LASTE      ; 0..127
    jr   __VF_STEP
__VF_BIGE:
    inc  a
    jr   nz, __VF_STEP      ; not -1..-256
    ld   a, l
    cp   128
    jr   nc, __VF_LASTE     ; -128..-1
__VF_STEP:                  ; out of the byte's range: 127 or -128 first
    bit  7, h
    ld   a, 127
    ld   de, -127
    jr   z, __VF_STEPGO
    ld   a, 0x80
    ld   de, 128
__VF_STEPGO:
    add  hl, de
    ld   (__VF_E), hl
    ld   c, FWMO_MUL10A
    call __FWM_CALLA
    jr   c, __VF_SCALE
    jr   __VF_SIGN          ; overflowed: the largest REAL
__VF_LASTE:
    or   a
    jr   z, __VF_SIGN
    ld   c, FWMO_MUL10A
    call __FWM_CALLA
__VF_SIGN:
    ld   a, (__VF_NEG)
    or   a
    jr   z, __VF_OUT
    ld   a, (FWM_A + 4)
    or   a
    jr   z, __VF_OUT        ; zero has no sign
    ld   hl, FWM_A + 3
    set  7, (hl)
__VF_OUT:
    jp   __FWM_GETA

__VF_FREE:  DEFB 0
__VF_STR:   DEFW 0
#endif

    pop namespace
