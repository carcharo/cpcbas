; -----------------------------------------------------------------------
; lib/loco/arg255.asm -- Locomotive text layer: the 0..255 argument check
;
; Written from scratch for this project (MIT, see lib/LICENSE).
;
; Locomotive raises Improper argument (5) for an ON selector and for a LOCATE
; column or row outside 0..255.
;
;   __LOCO_ARG255   HL = value (a 16-bit pattern: a negative value is above
;                   255). Exit: HL unchanged; error 5 when above 255.
;                   Clobbers AF.

#include once <error.asm>

    push namespace core

__LOCO_ARG255:
    ld   a, h
    or   a
    ret  z
    ld   a, 5
    jp   __ERROR

    pop namespace
