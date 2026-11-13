; -----------------------------------------------------------------------
; lib/loco/number.asm -- Locomotive text layer: number text
;
; Written from scratch for this project (MIT, see lib/LICENSE).
;
; Locomotive's number text: the sign position
; (a space, or `-`), the digits, no leading zeros, no exponent for
; integers. PRINT adds a trailing space and moves to the next line first
; when the text with that space does not fit; STR$ is the same text
; without the trailing space. 5 -> " 5", -5 -> "-5", 0 -> " 0",
; -32768 -> "-32768", 70000 -> " 70000".
;
; Types: the language types map to the register of the IR table. INTEGER
; and UINTEGER have entries of their own, LONG and ULONG too. BYTE and
; UBYTE have none: the lowering widens a BYTE to INTEGER (sign extension)
; and a UBYTE to UINTEGER (H = 0) before the call. REAL and FIXED text is
; a later task.
;
; Entry points (namespace core). "format" entries leave the text in a
; static buffer; the text is valid until the next call of any entry here.
;
;   __LOCO_FMTI16   HL = INTEGER.   Exit: HL = text, BC = its length (sign
;   __LOCO_FMTU16   HL = UINTEGER.  position and digits); the byte after
;   __LOCO_FMTI32   DEHL = LONG.    the text is a space, so HL, BC+1 is the
;   __LOCO_FMTU32   DEHL = ULONG.   PRINT text. Clobbers AF, DE. No firmware
;                                   entry.
;   __LOCO_PRINTI16 / __LOCO_PRINTU16 / __LOCO_PRINTI32 / __LOCO_PRINTU32
;                   the value as above -> one PRINT item: number text, a
;                   trailing space, wrap check (__LOCO_FIT). No line end.
;                   Clobbers AF, BC, DE, HL (+ the gate). Firmware entries:
;                   TXT OUTPUT, TXT GET CURSOR (via print.asm), MC PRINT CHAR
;                   with the printer echo.
;   __LOCO_STRI16 / __LOCO_STRU16 / __LOCO_STRI32 / __LOCO_STRU32
;                   STR$(value). Exit: HL = a new heap string (length word,
;                   bytes), owned by the caller, or 0 when the heap is full.
;                   Clobbers AF, BC, DE, HL. No firmware entry.

#include once <loco/print.asm>
#include once <mem/alloc.asm>

    push namespace core

; ---- the formatter ------------------------------------------------------
; __LOCO_NUMFMT: A = sign character (space or `-`), DEHL = magnitude
; (unsigned). Exit: HL = sign position, BC = length without the trailing
; space; (HL+BC) holds the space. 16-bit magnitudes use five power-of-ten
; subtractions; larger ones divide by 10 (32 shift-subtract steps per digit).
__LOCO_NUMFMT:
    PROC
    LOCAL __NF_BIG, __NF_DIG, __NF_D1, __NF_STRIP, __NF_FOUND
    LOCAL __NF_BIGLOOP, __NF_D10, __NF_NK, __NF_TAIL
    push af                 ; the sign character
    ld   a, d
    or   e
    jr   nz, __NF_BIG
    ld   de, __LOCO_NUMBUF + 6
    ld   bc, 10000
    call __NF_DIG
    ld   bc, 1000
    call __NF_DIG
    ld   bc, 100
    call __NF_DIG
    ld   bc, 10
    call __NF_DIG
    ld   bc, 1
    call __NF_DIG
    ld   hl, __LOCO_NUMBUF + 6
    ld   b, 4               ; strip leading zeros, keep the last digit
__NF_STRIP:
    ld   a, (hl)
    cp   '0'
    jr   nz, __NF_FOUND
    inc  hl
    djnz __NF_STRIP
__NF_FOUND:
    dec  hl                 ; the sign position
    jr   __NF_TAIL

__NF_DIG:                   ; HL -= BC while it fits; (DE) = '0' + count; DE++
    ld   a, '0' - 1
__NF_D1:
    inc  a
    or   a
    sbc  hl, bc
    jr   nc, __NF_D1
    add  hl, bc
    ld   (de), a
    inc  de
    ret

__NF_BIG:
    ld   bc, __LOCO_NUMBUF + 11
    push bc                 ; the digit pointer, above the sign character
__NF_BIGLOOP:
    ld   b, 32              ; DEHL / 10 -> DEHL, remainder in A
    xor  a
__NF_D10:
    add  hl, hl
    ex   de, hl
    adc  hl, hl
    ex   de, hl
    rla
    cp   10
    jr   c, __NF_NK
    sub  10
    inc  l
__NF_NK:
    djnz __NF_D10
    add  a, '0'
    ld   c, a
    ex   (sp), hl           ; HL = digit pointer, the quotient low word saved
    dec  hl
    ld   (hl), c
    ex   (sp), hl           ; pointer saved again, HL = quotient low word
    ld   a, d
    or   e
    or   h
    or   l
    jr   nz, __NF_BIGLOOP
    pop  hl                 ; digit pointer
    dec  hl                 ; the sign position

__NF_TAIL:                  ; HL = sign position, sign character on the stack
    pop  af
    ld   (hl), a
    ld   a, ' '
    ld   (__LOCO_NUMBUF + 11), a
    ld   de, __LOCO_NUMBUF + 11
    ex   de, hl
    or   a
    sbc  hl, de             ; HL = space position - sign position
    ld   b, h
    ld   c, l
    ex   de, hl             ; HL = sign position again
    ret
    ENDP

__LOCO_FMTI16:
    ld   a, ' '
    bit  7, h
    jr   z, __FI16_POS
    ld   a, l               ; negate HL
    cpl
    ld   l, a
    ld   a, h
    cpl
    ld   h, a
    inc  hl
    ld   a, '-'
__FI16_POS:
    ld   de, 0
    jp   __LOCO_NUMFMT

__LOCO_FMTU16:
    ld   de, 0
    ld   a, ' '
    jp   __LOCO_NUMFMT

__LOCO_FMTI32:
    PROC
    LOCAL __FI32_POS, __FI32_NEG
    ld   a, ' '
    bit  7, d
    jr   z, __FI32_POS
    ld   a, l               ; negate DEHL
    cpl
    ld   l, a
    ld   a, h
    cpl
    ld   h, a
    ld   a, e
    cpl
    ld   e, a
    ld   a, d
    cpl
    ld   d, a
    inc  hl
    ld   a, h
    or   l
    jr   nz, __FI32_NEG
    inc  de
__FI32_NEG:
    ld   a, '-'
__FI32_POS:
    jp   __LOCO_NUMFMT
    ENDP

__LOCO_FMTU32:
    ld   a, ' '
    jp   __LOCO_NUMFMT

; ---- PRINT --------------------------------------------------------------
__LOCO_PRINTI16:
    call __LOCO_FMTI16
    jr   __LOCO_PRINTNUM
__LOCO_PRINTU16:
    call __LOCO_FMTU16
    jr   __LOCO_PRINTNUM
__LOCO_PRINTI32:
    call __LOCO_FMTI32
    jr   __LOCO_PRINTNUM
__LOCO_PRINTU32:
    call __LOCO_FMTU32
__LOCO_PRINTNUM:            ; HL = text, BC = length without the trailing space
    inc  bc
    push hl
    call __LOCO_FIT
    pop  hl
    jp   __LOCO_PUTS

; ---- STR$ ---------------------------------------------------------------
__LOCO_STRI16:
    call __LOCO_FMTI16
    jr   __LOCO_STRNEW
__LOCO_STRU16:
    call __LOCO_FMTU16
    jr   __LOCO_STRNEW
__LOCO_STRI32:
    call __LOCO_FMTI32
    jr   __LOCO_STRNEW
__LOCO_STRU32:
    call __LOCO_FMTU32
__LOCO_STRNEW:              ; HL = text, BC = length -> HL = new heap string
    push hl
    push bc
    inc  bc
    inc  bc
    call __MEM_ALLOC
    pop  bc
    pop  de
    ld   a, h
    or   l
    ret  z                  ; heap full
    push hl
    ld   (hl), c
    inc  hl
    ld   (hl), b
    inc  hl
    ex   de, hl
    ldir
    pop  hl
    ret

__LOCO_NUMBUF:
    DEFS 12

    pop namespace
