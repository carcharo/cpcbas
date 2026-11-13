; -----------------------------------------------------------------------
; lib/loco/gosubchk.asm -- RETURN alone inside a SUB or FUNCTION
;
; Written from scratch for this project (MIT, see lib/LICENSE).
;
; A GOSUB in a procedure pushes its return address below the procedure's
; frame. When none is pending the stack pointer is the frame's bottom,
; IX - (frame bytes). Locomotive's RETURN without a GOSUB is error 3
; "Unexpected RETURN" (BASIC 1.1 manual, error list).
;
;   __LOCO_GOSUBCHK   HL = the procedure's frame bytes (localBytes), called
;                     from the RETURN statement with IX the procedure's frame.
;                     Exit: returns when a GOSUB is pending; error 3 otherwise.
;                     Clobbers AF, BC, DE, HL.

#include once <error.asm>

    push namespace core

__LOCO_GOSUBCHK:
    ex   de, hl             ; DE = frame bytes
    push ix
    pop  bc                 ; BC = IX
    ld   hl, 2
    add  hl, sp             ; HL = SP of the RETURN statement (past our return address)
    or   a
    sbc  hl, bc             ; HL = SP - IX, -(frame bytes) when nothing is pending
    add  hl, de
    ld   a, h
    or   l
    ret  nz
    ld   a, 3
    jp   __ERROR

    pop namespace
