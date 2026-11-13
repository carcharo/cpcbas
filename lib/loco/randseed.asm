; -----------------------------------------------------------------------
; lib/loco/randseed.asm -- the seed of RANDOM(n)
;
; Written from scratch for this project (MIT, see lib/LICENSE).
;
; RANDOM's 16-bit state (LOCO_RANDSTATE, 0 = not started) is seeded by
; RANDOMIZE n, RANDOMIZE with no number and RND(-n) (lib/loco/realfn.asm), and
; at RANDOM's own first call from the clock (lib/loco/misc.asm) when none of
; them ran. Kept apart so a program with RND does not link RANDOM.
;
;   __LOCO_RANDSEEDT  DE HL = a 32-bit number (the clock, or the bytes of a
;                   seed): LOCO_RANDSTATE = HL xor DE, 1 if that is zero.
;                   Clobbers AF only (HL and DE are kept).
; -----------------------------------------------------------------------

#include once <loco/vars.asm>

    push namespace core

__LOCO_RANDSEEDT:
    PROC
    LOCAL __RS_OK
    push hl
    ld   a, h
    xor  d
    ld   h, a
    ld   a, l
    xor  e
    ld   l, a
    or   h
    jr   nz, __RS_OK
    inc  l                  ; never zero: zero means "not started"
__RS_OK:
    ld   (LOCO_RANDSTATE), hl
    pop  hl
    ret
    ENDP

    pop namespace
