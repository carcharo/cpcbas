; -----------------------------------------------------------------------
; lib/loco/readf.asm -- Locomotive READ into a REAL variable
;
; Written from scratch for this project (MIT, see lib/LICENSE). Kept apart from read.asm
; (which every program with a READ links) because it pulls the floating-point conversions in.
; It reads the same table (codegen/data.ts) and moves the same data pointer.
;
;   __LOCO_READF    Exit: A E D C B = the next DATA item as a REAL: a REAL item as it is, a
;                   FIXED or integer item converted. Past the last item it raises error 4
;                   (DATA exhausted), a string item error 2 (Syntax error; the item is not
;                   consumed), as __LOCO_READ. Does not return on an error (it jumps to
;                   __ERROR). Clobbers AF, BC, DE, HL and the calculator's stack. No firmware
;                   entry beyond the error path.
;
; __LOCO_READ (into an integer variable) still raises a Syntax error for a REAL item: the
; lowering reads an integer variable through this routine and rounds, when the program has a
; REAL item. Into a string variable __LOCO_READ gives the item's spelling.

#include once <error.asm>
#include once <loco/fmathcv.asm>
#include once <loco/read.asm>

    push namespace core

__LOCO_READF:
    PROC
    LOCAL __RF_EXH, __RF_SYN, __RF_REAL, __RF_F16, __RF_I8, __RF_I16, __RF_S16, __RF_AGAIN
__RF_AGAIN:
    ld   hl, (__LOCO_DATA_ADDR)
    ld   a, (hl)
    or   a
    jp   z, __RF_EXH
    cp   10
    jr   nz, __RF_ITEM
    inc  hl                 ; a spelling entry (type 10 and an address): the number follows
    inc  hl
    inc  hl
    ld   (__LOCO_DATA_ADDR), hl
    jr   __RF_AGAIN
__RF_ITEM:
    cp   1
    jr   z, __RF_SYN
    cp   9
    jr   z, __RF_REAL
    cp   8
    jr   z, __RF_F16
    ld   b, a               ; the item's type, 2..7
    inc  hl
    cp   4
    jr   c, __RF_I8
    cp   6
    jr   c, __RF_I16
    ld   e, (hl)            ; LONG, ULONG: low word first
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
    ld   a, b
    cp   6
    jp   z, __LOCO_FI32
    jp   __LOCO_FU32
__RF_I8:
    ld   c, (hl)
    inc  hl
    ld   (__LOCO_DATA_ADDR), hl
    ld   a, b
    cp   2
    ld   a, c
    jp   z, __LOCO_FI8
    jp   __LOCO_FU8
__RF_I16:
    ld   e, (hl)
    inc  hl
    ld   d, (hl)
    inc  hl
    ld   (__LOCO_DATA_ADDR), hl
    ex   de, hl
    ld   a, b
    cp   4
    jr   z, __RF_S16
    ld   de, 0
    jp   __LOCO_FU32
__RF_S16:
    ld   a, h
    add  a, a
    sbc  a, a
    ld   e, a
    ld   d, a
    jp   __LOCO_FI32
__RF_F16:
    inc  hl
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
    jp   __LOCO_FF16
__RF_REAL:
    inc  hl
    ld   a, (hl)
    inc  hl
    ld   e, (hl)
    inc  hl
    ld   d, (hl)
    inc  hl
    ld   c, (hl)
    inc  hl
    ld   b, (hl)
    inc  hl
    ld   (__LOCO_DATA_ADDR), hl
    ret
__RF_EXH:
    ld   a, 4               ; DATA exhausted
    jp   __ERROR
__RF_SYN:
    ld   a, 2               ; Syntax error
    jp   __ERROR
    ENDP

    pop namespace
