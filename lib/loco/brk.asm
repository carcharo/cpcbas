; -----------------------------------------------------------------------
; lib/loco/brk.asm -- the Break message, shared by STOP and ON BREAK STOP
;
; Written from scratch for this project (MIT, see lib/LICENSE).
;
; One routine prints what the interpreter prints for STOP and for ESC under
; ON BREAK STOP: a line end unless POS is 1, "Break in <n>" (just "Break"
; when the statement is on an unnumbered line) and a line end. It does not
; end the program (the caller's END does). Kept out of misc.asm, which links
; the heap for FRE, and out of keys.asm, which links the keyboard.
;
; Entry points (namespace core):
;
;   __LOCO_STOP     STOP on an unnumbered line: "Break". Clobbers AF, BC, DE, HL.
;   __LOCO_STOPAT   HL = the line number (65535 = none, "Break"; no line has it).
;                   Clobbers AF, BC, DE, HL.
; -----------------------------------------------------------------------

#include once <loco/txt.asm>
#include once <loco/txtout.asm>
#include once <loco/screen.asm>

    push namespace core

__LOCO_STOP:
    ld   hl, $FFFF
__LOCO_STOPAT:
    PROC
    LOCAL __LS_SKIP, __LS_CMP, __LS_DIG, __LS_SUB, __LS_TEXT, __LS_BREAK, __LS_IN, __LS_POW
    push hl
    call __LOCO_POS         ; a line end unless POS is 1
    dec  hl
    ld   a, h
    or   l
    call nz, __LOCO_NL
    ld   hl, __LS_BREAK
    call __LS_TEXT
    pop  hl
    ld   a, h
    and  l
    inc  a                  ; 65535: no line number
    jp   z, __LOCO_NL
    push hl
    ld   hl, __LS_IN
    call __LS_TEXT
    pop  hl
    ld   de, __LS_POW
__LS_SKIP:                  ; skip the powers of ten above the value (never the last, 1)
    ld   a, (de)
    ld   c, a
    inc  de
    ld   a, (de)
    ld   b, a
    inc  de
    or   a
    jr   nz, __LS_CMP
    ld   a, c
    dec  a
    jr   z, __LS_DIG
__LS_CMP:
    push hl
    or   a
    sbc  hl, bc
    pop  hl
    jr   c, __LS_SKIP
__LS_DIG:                   ; BC = the power, DE = the next table entry
    ld   a, '0' - 1
__LS_SUB:
    inc  a
    or   a
    sbc  hl, bc
    jr   nc, __LS_SUB
    add  hl, bc
    call __LOCO_PUTC
    ld   a, (de)
    ld   c, a
    inc  de
    ld   a, (de)
    ld   b, a
    inc  de
    or   c
    jr   nz, __LS_DIG
    jp   __LOCO_NL

__LS_TEXT:                  ; HL = zero-terminated text
    ld   a, (hl)
    or   a
    ret  z
    inc  hl
    call __LOCO_PUTC
    jr   __LS_TEXT

__LS_BREAK:
    DEFB "Break", 0
__LS_IN:
    DEFB " in ", 0
__LS_POW:
    DEFW 10000, 1000, 100, 10, 1, 0
    ENDP

    pop namespace
