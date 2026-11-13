; -----------------------------------------------------------------------
; lib/loco/inkset.asm -- Locomotive colour: INK n, c1 [, c2] and SPEED INK a, b
;
; Written from scratch for this project (MIT, see lib/LICENSE).
;
; The colour numbers are the firmware's 0-26 (Locomotive allows 0-31 and
; passes them on); pens are 0-15. Anything outside is error 5.
;
;   __LOCO_INK      INK n, c1, c2   stack: n, c1, c2. Firmware mode:
;                                   SCR SET INK (&BC32; c1 and c2 alternate at
;                                   the SPEED INK rates). Bare mode: the Gate
;                                   Array only, in c1 (no flashing: the same as
;                                   BORDER's rule), through colour.asm's
;                                   __CPC_SET_INK; colours above 26 are ignored.
;   __LOCO_INK1     INK n, c        stack: n, c. Both colours the same.
;   __LOCO_SPEEDINK SPEED INK a, b  stack: a, b; each 1-255 (else error
;                                   5), in 1/50 s. SCR SET FLASHING (&BC3E,
;                                   H = a, L = b). Firmware mode only: a bare
;                                   build refuses it (E270) and this routine
;                                   raises error 2.
;   Clobbers AF, BC, DE, HL (+ the gate).
; -----------------------------------------------------------------------

#include once <error.asm>
#ifdef CPC_BAREMETAL
#include once <gacolour.asm>
#else
#include once <fwcall.asm>
#endif

    push namespace core

__LOCO_INK:
    pop  hl                 ; return address
    pop  de                 ; DE = c2
    pop  bc                 ; BC = c1
    ex   (sp), hl           ; HL = n, the return address back on top
    jr   __IK_GO

__LOCO_INK1:
    pop  hl                 ; return address
    pop  bc                 ; BC = c
    ld   d, b
    ld   e, c               ; DE = c
    ex   (sp), hl           ; HL = n

__IK_GO:                    ; HL = n, BC = c1, DE = c2
    ld   a, h
    or   b
    or   d
    jr   nz, __IK_BAD
    ld   a, l
    cp   16
    jr   nc, __IK_BAD
    ld   a, c
    cp   32
    jr   nc, __IK_BAD
    ld   a, e
    cp   32
    jr   nc, __IK_BAD
    ld   a, l
#ifdef CPC_BAREMETAL
    jp   __CPC_SET_INK      ; A = pen, C = colour
#else
    ld   b, c
    ld   c, e
    call .core.__FW_CALL
    defw $BC32              ; SCR SET INK: A = pen, B = first colour, C = second
    ret
#endif
__IK_BAD:
    ld   a, 5
    jp   __ERROR

__LOCO_SPEEDINK:
#ifdef CPC_BAREMETAL
    ld   a, 2
    jp   __ERROR
#else
    pop  bc
    pop  hl                 ; HL = b
    pop  de                 ; DE = a
    push bc
    ld   a, d
    or   h
    jr   nz, __IK_BAD
    ld   a, e
    or   a
    jr   z, __IK_BAD
    ld   a, l
    or   a
    jr   z, __IK_BAD
    ld   h, e               ; H = a, L = b
    call .core.__FW_CALL
    defw $BC3E              ; SCR SET FLASHING
    ret
#endif

    pop namespace
