; -----------------------------------------------------------------------
; lib/loco/gfxfill.asm -- Locomotive FILL n (firmware mode only)
;
; Written from scratch for this project (MIT, see lib/LICENSE).
;
;   __LOCO_GFILL    FILL n    HL = n, a pen 0-15 (else error 5). GRA FILL
;                             (&BD52, a CPC664/6128 entry: error 2 on a 464,
;                             as the 464's interpreter has no FILL) fills the
;                             area round the graphics cursor with pen n, up to
;                             the graphics pen's colour, using a 512-byte
;                             buffer in the program. A bare build refuses
;                             FILL (E270); this routine raises error 2 there.
;                             Clobbers AF, BC, DE, HL (+ the gate).
; -----------------------------------------------------------------------

#include once <error.asm>
#ifndef CPC_BAREMETAL
#include once <fwcall.asm>
#endif

    push namespace core

__LOCO_GFILL:
#ifdef CPC_BAREMETAL
    ld   a, 2
    jp   __ERROR
#else
    ld   a, h
    or   a
    jr   nz, __GFL_BAD
    ld   a, l
    cp   16
    jr   nc, __GFL_BAD
    ld   a, ($BD52)
    cp   $CF
    jr   nz, __GFL_464
    ld   a, l
    ld   hl, __LOCO_GFILLBUF
    ld   de, 512
    call .core.__FW_CALL
    defw $BD52              ; GRA FILL: A = pen, HL = buffer, DE = its length
    ret
__GFL_464:
    ld   a, 2
    jp   __ERROR
__GFL_BAD:
    ld   a, 5
    jp   __ERROR

__LOCO_GFILLBUF:
    defs 512
#endif

    pop namespace
