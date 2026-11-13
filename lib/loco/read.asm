; -----------------------------------------------------------------------
; lib/loco/read.asm -- Locomotive READ and RESTORE
;
; Written from scratch for this project (MIT, see lib/LICENSE). It replaces
; the imported read_restore.asm for compiled Locomotive programs, which
; restarts silently at the end of the data, raises the Spectrum's error 9
; and converts between types the way Boriel does. The table it reads is the
; one codegen/data.ts emits (.DATA.__DATA__0: one type byte then the value,
; 1 string by pointer, 2..7 integers, 9 REAL, a 0 byte at the end). A numeric
; item whose text differs from its canonical decimal (007, &FF, 1.50, an
; empty item) is preceded by a spelling entry: type byte 10 and the address
; of a string constant.
;
; Behaviour (measured on the interpreter):
;   - READ past the last item: error 4 ("DATA exhausted").
;   - a string item read into a numeric variable: error 2 (Syntax error);
;     the item is not consumed, so a second READ fails the same way.
;   - a numeric item read into a string variable gives its text as written:
;     the spelling entry when there is one, else the digits with a leading
;     `-` and no sign position blank.
;   - an empty item is 0 for a numeric variable and "" for a string one.
;   - a numeric item read into a numeric variable of another width is
;     converted as an assignment would (wraps to the width).
;
; Entry points (namespace core):
;
;   __LOCO_RESTORE  HL = address of the item to read next (a table label).
;                   Clobbers nothing.
;   __LOCO_READ     A = type of the variable: 1 string, 2 BYTE, 3 UBYTE,
;                   4 INTEGER, 5 UINTEGER, 6 LONG, 7 ULONG.
;                   Exit: string in HL (a new heap string, owned by the
;                   caller; 0 when empty or the heap is full); BYTE and
;                   UBYTE in A; INTEGER and UINTEGER in HL; LONG and ULONG
;                   in DEHL. Clobbers AF, BC, DE, HL.
;                   Does not return on an error (it jumps to __ERROR).
;   No firmware entry beyond the error path.

#include once <error.asm>
#include once <loadstr.asm>
#include once <loco/number.asm>

    push namespace core

__LOCO_RESTORE:
    ld   (__LOCO_DATA_ADDR), hl
    ret

__LOCO_READ:
    PROC
    LOCAL __LR_NUM, __LR_I8, __LR_I16, __LR_DONE, __LR_TEXT, __LR_EXH, __LR_SYNTAX, __LR_NOSIGN
    LOCAL __LR_SX8, __LR_SX16, __LR_SXD, __LR_VALUE, __LR_TI16, __LR_TU16, __LR_TI32
    LOCAL __LR_AGAIN, __LR_SPELL, __LR_SKIP3, __LR_SIZE
    ld   c, a               ; the variable's type
__LR_AGAIN:
    ld   hl, (__LOCO_DATA_ADDR)
    ld   a, (hl)
    or   a
    jr   z, __LR_EXH
    cp   10
    jr   z, __LR_SPELL
    ld   b, a               ; the item's type
    cp   1
    jr   nz, __LR_NUM
    ; a string item
    ld   a, c
    cp   1
    jr   nz, __LR_SYNTAX    ; into a number: not consumed
    inc  hl
    ld   e, (hl)
    inc  hl
    ld   d, (hl)
    inc  hl
    ld   (__LOCO_DATA_ADDR), hl
    ex   de, hl
    jp   __LOADSTR

__LR_SPELL:                 ; HL -> a spelling entry; the numeric entry follows it
    ld   a, c
    cp   1
    jr   nz, __LR_SKIP3     ; a number wanted: step over the spelling
    inc  hl
    ld   e, (hl)
    inc  hl
    ld   d, (hl)
    inc  hl                 ; DE = the spelling, HL -> the numeric entry
    ld   a, (hl)
    inc  hl
    ld   bc, 1              ; BYTE, UBYTE
    cp   4
    jr   c, __LR_SIZE
    ld   c, 2               ; INTEGER, UINTEGER
    cp   6
    jr   c, __LR_SIZE
    ld   c, 4               ; LONG, ULONG
    cp   9
    jr   c, __LR_SIZE
    ld   c, 5               ; REAL
__LR_SIZE:
    add  hl, bc
    ld   (__LOCO_DATA_ADDR), hl
    ex   de, hl
    jp   __LOADSTR
__LR_SKIP3:
    inc  hl
    inc  hl
    inc  hl
    ld   (__LOCO_DATA_ADDR), hl
    jr   __LR_AGAIN

__LR_EXH:
    ld   a, 4               ; DATA exhausted
    jp   __ERROR
__LR_SYNTAX:
    ld   a, 2               ; Syntax error
    jp   __ERROR

__LR_NUM:                   ; B = item type, HL -> its type byte
    cp   8
    jr   nc, __LR_SYNTAX    ; REAL and FIXED items are not read yet
    inc  hl
    cp   4
    jr   c, __LR_I8         ; 2 BYTE, 3 UBYTE
    cp   6
    jr   c, __LR_I16        ; 4 INTEGER, 5 UINTEGER
    ; 6, 7: four bytes, low word first
    ld   e, (hl)
    inc  hl
    ld   d, (hl)
    inc  hl
    push de
    ld   e, (hl)
    inc  hl
    ld   d, (hl)
    inc  hl
    ld   (__LOCO_DATA_ADDR), hl
    pop  hl
    jr   __LR_DONE
__LR_I8:
    ld   a, (hl)
    inc  hl
    ld   (__LOCO_DATA_ADDR), hl
    ld   l, a
    ld   h, 0
    ld   de, 0
    jr   __LR_DONE
__LR_I16:
    ld   e, (hl)
    inc  hl
    ld   d, (hl)
    inc  hl
    ld   (__LOCO_DATA_ADDR), hl
    ex   de, hl
    ld   de, 0
__LR_DONE:                  ; DEHL = the value as stored (item type in B)
    ld   a, b
    cp   2
    jr   z, __LR_SX8
    cp   4
    jr   z, __LR_SX16
    jr   __LR_VALUE
__LR_SX8:
    ld   a, l
    rla
    sbc  a, a
    ld   h, a
    jr   __LR_SXD
__LR_SX16:
    ld   a, h
    rla
    sbc  a, a
__LR_SXD:
    ld   d, a
    ld   e, a
__LR_VALUE:
    ld   a, c
    cp   1
    jr   z, __LR_TEXT
    cp   4
    ret  nc                 ; INTEGER, UINTEGER in HL; LONG, ULONG in DEHL
    ld   a, l               ; BYTE, UBYTE
    ret

__LR_TEXT:                  ; a number as text, by the item's type
    ld   a, b
    cp   2
    jr   z, __LR_TI16
    cp   3
    jr   z, __LR_TU16
    cp   4
    jr   z, __LR_TI16
    cp   5
    jr   z, __LR_TU16
    cp   6
    jr   z, __LR_TI32
    call __LOCO_FMTU32
    jr   __LR_NOSIGN
__LR_TI32:
    call __LOCO_FMTI32
    jr   __LR_NOSIGN
__LR_TI16:
    call __LOCO_FMTI16
    jr   __LR_NOSIGN
__LR_TU16:
    call __LOCO_FMTU16
__LR_NOSIGN:                ; HL = text with a sign position, BC = length
    ld   a, (hl)
    cp   ' '
    jp   nz, __LOCO_STRNEW
    inc  hl
    dec  bc
    jp   __LOCO_STRNEW
    ENDP

__LOCO_DATA_ADDR:
    dw   .DATA.__DATA__0

    pop namespace
