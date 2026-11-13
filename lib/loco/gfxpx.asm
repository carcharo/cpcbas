; -----------------------------------------------------------------------
; lib/loco/gfxpx.asm -- CIRCLE and POINT, the Sinclair-style aliases
;
; Written from scratch for this project (MIT, see lib/LICENSE).
;
; Unlike the Locomotive graphics statements these two take the current
; mode's own pixels (mode 0 160 x 200, mode 1 320 x 200, mode 2 640 x 200,
; origin bottom left, then the ORIGIN offset), as the Boriel fork's CIRCLE and
; POINT do, so a program ported from there draws the same pixels
; (tests/fork-diff/gfx-alias.bas). They draw in the graphics pen and the
; graphics write mode, like PLOT.
;
;   __LOCO_GCIRCLE  CIRCLE x, y, r   stack: x, y, r. The midpoint circle:
;                                    every pixel once (so XOR drawing erases
;                                    cleanly); a negative r draws nothing and
;                                    r = 0 the centre. In mode 0 and mode 2 the
;                                    pixels are not square, so the circle is
;                                    stretched or squashed. The graphics cursor
;                                    ends at the last point plotted.
;   __LOCO_GPOINT   POINT(x, y)      stack: x, y. Exit: HL = the pen of the
;                                    pixel (the graphics paper off the screen).
;                                    The graphics cursor does not move.
;   Clobbers AF, BC, DE, HL (+ the gate).
; -----------------------------------------------------------------------

#include once <loco/gfx.asm>

    push namespace core

LGC_CX              EQU CIRC_VARS + 0       ; centre x
LGC_CY              EQU CIRC_VARS + 2       ; centre y
LGC_X               EQU CIRC_VARS + 4       ; x offset, 0 up
LGC_Y               EQU CIRC_VARS + 6       ; y offset, r down
LGC_D               EQU CIRC_VARS + 8       ; the decision value

; __GX_V -- DE = x, HL = y in mode pixels -> DE, HL user virtual units (x shifted
; left by the mode's shift, y doubled). Clobbers AF.
__GX_V:
    PROC
    LOCAL __GXV_L
    add  hl, hl
    ld   a, (GFX_XSHIFT)
    or   a
    ret  z
    ex   de, hl
__GXV_L:
    add  hl, hl
    dec  a
    jr   nz, __GXV_L
    ex   de, hl
    ret
    ENDP

; __GX_PLOT -- DE, HL = a user virtual point: plots it (moving the cursor there).
#ifdef CPC_BAREMETAL
__GX_PLOT:
    call __GB_ADDXY
    jp   __GB_PLOTAT
#else
__GX_PLOT:
    call .core.__FW_CALL
    defw $BBEA              ; GRA PLOT ABSOLUTE
    ret
#endif

__LOCO_GCIRCLE:
    PROC
    LOCAL __GC_R, __GC_LOOP, __GC_DPOS, __GC_DSET, __GC_8
    pop  bc                 ; return address; stack: x, y, r
    pop  hl
    ld   (LGC_Y), hl        ; r
    pop  hl
    ld   (LGC_CY), hl
    pop  hl
    ld   (LGC_CX), hl
    push bc
    ld   hl, (LGC_Y)
    bit  7, h
    ret  nz                 ; a negative radius: nothing
    ld   a, h
    or   l
    jr   nz, __GC_R
    ld   d, h
    ld   e, l
    jp   __GC_PT            ; radius 0: just the centre
__GC_R:
    ld   de, 0
    ld   (LGC_X), de
    ex   de, hl             ; DE = r
    ld   hl, 1
    or   a
    sbc  hl, de
    ld   (LGC_D), hl        ; d = 1 - r
    ld   hl, (LGC_Y)
    ld   de, 0
    call __GC_2             ; (0, r), (0, -r)
    ex   de, hl
    call __GC_2             ; (r, 0), (-r, 0)
__GC_LOOP:
    ld   hl, (LGC_D)
    bit  7, h
    jr   z, __GC_DPOS
    ld   de, (LGC_X)        ; d < 0: d += 2x + 3
    ex   de, hl
    add  hl, hl
    inc  hl
    inc  hl
    inc  hl
    add  hl, de
    jr   __GC_DSET
__GC_DPOS:                  ; d >= 0: d += 2(x - y) + 5, y -= 1
    ld   hl, (LGC_X)
    ld   de, (LGC_Y)
    or   a
    sbc  hl, de
    add  hl, hl
    ld   de, 5
    add  hl, de
    ld   de, (LGC_D)
    add  hl, de
    ld   de, (LGC_Y)
    dec  de
    ld   (LGC_Y), de
__GC_DSET:
    ld   (LGC_D), hl
    ld   hl, (LGC_X)
    inc  hl
    ld   (LGC_X), hl
    ex   de, hl             ; DE = x
    ld   hl, (LGC_Y)
    or   a
    sbc  hl, de             ; y - x
    ret  c                  ; x > y: done
    ld   hl, (LGC_Y)
    jr   nz, __GC_8
    ld   h, d               ; x = y: the four diagonal points, then done
    ld   l, e
    jp   __GC_4
__GC_8:
    call __GC_4             ; (+-x, +-y)
    ex   de, hl
    call __GC_4             ; (+-y, +-x)
    jr   __GC_LOOP
    ENDP

; __GC_4 -- plots the centre + (a, b), (-a, -b), (-a, b), (a, -b) for DE = a, HL = b.
; Preserves DE, HL.
__GC_4:
    call __GC_2
    call __GC_NEGDE
    call __GC_2
__GC_NEGDE:
    xor  a
    sub  e
    ld   e, a
    sbc  a, a
    sub  d
    ld   d, a
    ret

; __GC_2 -- plots the centre + (a, b) and (-a, -b) for DE = a, HL = b. Preserves DE, HL.
__GC_2:
    call __GC_PT
    call __GC_NEGDE
    call __GC_NEGHL
    call __GC_PT
    call __GC_NEGDE
__GC_NEGHL:
    xor  a
    sub  l
    ld   l, a
    sbc  a, a
    sub  h
    ld   h, a
    ret

; __GC_PT -- plots the centre + (DE, HL) in pixels. Preserves DE, HL.
__GC_PT:
    push de
    push hl
    ld   bc, (LGC_CY)
    add  hl, bc
    ex   de, hl
    ld   bc, (LGC_CX)
    add  hl, bc
    ex   de, hl             ; DE = x, HL = y
    call __GX_V
    call __GX_PLOT
    pop  hl
    pop  de
    ret

__LOCO_GPOINT:
    pop  bc
    pop  hl                 ; y
    pop  de                 ; x
    push bc
    call __GX_V
#ifdef CPC_BAREMETAL
    ld   (LGC_CX), de       ; the point
    ld   (LGC_CY), hl
    ld   de, (LOCO_GCX)     ; the cursor does not move
    push de
    ld   de, (LOCO_GCY)
    push de
    ld   de, (LGC_CX)
    ld   hl, (LGC_CY)
    call __GB_ADDXY
    call __GB_TESTAT
    pop  de
    ld   (LOCO_GCY), de
    pop  de
    ld   (LOCO_GCX), de
    ret
#else
    ld   (LGC_CX), de       ; the point
    ld   (LGC_CY), hl
    call .core.__FW_CALL
    defw $BBC6              ; GRA ASK CURSOR: the cursor, to put back
    push de
    push hl
    ld   de, (LGC_CX)
    ld   hl, (LGC_CY)
    call .core.__FW_CALL
    defw $BBF0              ; GRA TEST ABSOLUTE: A = the pen
    pop  hl
    pop  de
    push af
    call .core.__FW_CALL
    defw $BBC0              ; GRA MOVE ABSOLUTE
    pop  af
    ld   l, a
    ld   h, 0
    ret
#endif

    pop namespace
