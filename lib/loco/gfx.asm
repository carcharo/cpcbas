; -----------------------------------------------------------------------
; lib/loco/gfx.asm -- Locomotive graphics: PLOT, PLOTR, MOVE, MOVER, DRAW,
; DRAWR, TEST, TESTR, XPOS, YPOS, CLG, GRAPHICS PEN, GRAPHICS PAPER, ORIGIN,
; MASK (firmware and bare-metal mode with -D CPC_BAREMETAL)
;
; Written from scratch for this project (MIT, see lib/LICENSE).
;
; Coordinates are Locomotive's: 640 x 400 virtual units in every mode, origin
; at the bottom left, moved by ORIGIN; the arguments are 16-bit signed values
; (the lowering rounds a REAL as CINT does). A virtual unit is half a pixel
; across in mode 1, a quarter in mode 0, a whole pixel in mode 2, and half a
; line up (the firmware's own conversion: shift right, so it rounds down).
;
; Calling convention (the IR's temps are the stack, docs/ir.md): a pair of
; coordinates is two words on the stack, y on top of x; a single value is in
; HL. The routine removes its stack arguments. Optional arguments are separate calls made
; first (__LOCO_GPENP for the pen of PLOT ..., __LOCO_GMODE for its ink mode).
;
; Firmware mode calls the GRA/SCR entries of the firmware through the gate
; (fwcall.asm), one routine each, so what is drawn is what the interpreter
; draws. Clobbers AF, BC, DE, HL (+ the gate's BC', DE', HL', AF').
; Bare-metal mode (see "Bare-metal mode" below) draws straight into screen
; memory with gfxbare.asm's pixel and line routines, pixel for pixel the
; firmware's.
;
;   __LOCO_GMOVE   MOVE x, y        stack: x, y        GRA MOVE ABSOLUTE (&BBC0)
;   __LOCO_GMOVER  MOVER dx, dy                        GRA MOVE RELATIVE (&BBC3)
;   __LOCO_GPLOT   PLOT x, y                           GRA PLOT ABSOLUTE (&BBEA)
;   __LOCO_GPLOTR  PLOTR dx, dy                        GRA PLOT RELATIVE (&BBED)
;   __LOCO_GDRAW   DRAW x, y                           GRA LINE ABSOLUTE (&BBF6)
;   __LOCO_GDRAWR  DRAWR dx, dy                        GRA LINE RELATIVE (&BBF9)
;   __LOCO_GTEST   TEST(x, y)       Exit: HL = the pen of the pixel (the
;   __LOCO_GTESTR  TESTR(dx, dy)    graphics paper outside the window); the
;                                   cursor moves there. GRA TEST ABSOLUTE
;                                   (&BBF0) / RELATIVE (&BBF3).
;   __LOCO_GXPOS   XPOS             Exit: HL = the cursor's x / y, relative to
;   __LOCO_GYPOS   YPOS             the origin. GRA ASK CURSOR (&BBC6).
;   __LOCO_GCLG    CLG              Clears the graphics window to the graphics
;                                   paper. GRA CLEAR WINDOW (&BBDB).
;   __LOCO_GCLGP   CLG n  HL = n    The same after GRAPHICS PAPER n. n above 15
;                                   is error 5.
;   __LOCO_GPEN    GRAPHICS PEN n   HL = n (0-15, else error 5). GRA SET PEN
;                                   (&BBDE).
;   __LOCO_GPENP   the pen argument of PLOT/MOVE/DRAW ..: HL = pen; no range
;                                   check (the firmware takes the low bits).
;   __LOCO_GPAPER  GRAPHICS PAPER n HL = n (0-15, else error 5). GRA SET
;                                   PAPER (&BBE4).
;   __LOCO_GMODE   the ink mode argument of PLOT ..: HL = 0 normal, 1 XOR,
;                                   2 AND, 3 OR (else error 5). SCR ACCESS
;                                   (&BC59). The mode stays until changed, as
;                                   on the interpreter. Bare builds: 0 only.
;   __LOCO_GORIGIN ORIGIN x, y      stack: x, y. GRA SET ORIGIN (&BBC9);
;                                   the cursor goes to the new origin.
;   __LOCO_GORIGINW ORIGIN x,y,l,r,t,b  stack: x, y, l, r, t, b. Also
;                                   GRA WIN WIDTH (&BBCF), GRA WIN HEIGHT
;                                   (&BBD2). Firmware mode only.
;   __LOCO_GMASK   MASK n           HL = n (0-255, else error 5). GRA SET LINE
;                                   MASK (&BD4C).
;   __LOCO_GFIRST  MASK ,f          HL = f (0 or 1, else error 5). GRA SET
;                                   FIRST (&BD49): 0 leaves the first point of
;                                   a line out.
;   __LOCO_GBACK   GRAPHICS PEN ,m  HL = m (0 opaque, 1 transparent, else
;                                   error 5). GRA SET BACK (&BD46).
;   MASK, the first point and the background are entries of the CPC664 and
;   6128 firmware (not the 464, whose jumpblock has no such entries there):
;   on a 464 they raise error 2, Syntax error, which is what the 464's
;   interpreter says too.
;
; Bare-metal mode (-D CPC_BAREMETAL). No firmware is called. The graphics
; state is in the private block (vars.asm): the cursor in absolute virtual
; units, the origin, the graphics pen (1 at start-up) and paper (0). It takes
; Locomotive pens directly (they are never mapped through colour.asm's
; Spectrum PEN_MAP, which the text layer's PEN and PAPER own: follow-up 40).
; The pixel at a virtual point is its absolute x shifted right by the mode's
; shift (GFX_XSHIFT) and its y shifted right by one. A line is drawn between
; the pixels of its two ends by gfxbare.asm's rasteriser. MODE resets the
; origin and the cursor (screen.asm), as the firmware's SCR SET MODE does.
; Differences: no graphics window (ORIGIN's last four arguments are E270),
; no ink modes, MASK, FILL or GRAPHICS PEN's second argument (E270), and
; TEST outside the screen gives the graphics paper.
; -----------------------------------------------------------------------

#include once <error.asm>
#include once <sysvars.asm>
#include once <loco/vars.asm>
#ifdef CPC_BAREMETAL
#include once <gfxbare.asm>
#include once <txtbare.asm>
#include once <colour.asm>
#else
#include once <fwcall.asm>
#endif

    push namespace core

; __GF_BAD -- error 5 (Improper argument).
__GF_BAD:
    ld   a, 5
    jp   __ERROR

; __GF_PEN -- HL = a pen -> A = HL; error 5 above 15. Clobbers AF.
__GF_PEN:
    ld   a, h
    or   a
    jp   nz, __GF_BAD
    ld   a, l
    cp   16
    ret  c
    jp   __GF_BAD

#ifdef CPC_BAREMETAL
; =======================================================================
; Bare-metal mode
; =======================================================================

#init .core.CPC_INIT_13_LOCOGFX

; CPC_INIT_13_LOCOGFX -- the graphics pen is 1 at start-up (the private
; block is zero). Clobbers AF.
CPC_INIT_13_LOCOGFX:
    ld   a, 1
    ld   (LOCO_GPEN), a
    ret

; __GB_ADDXY -- DE = x, HL = y (user) -> DE, HL absolute: plus the origin.
; Clobbers AF, BC.
__GB_ADDXY:
    ld   bc, (LOCO_GOX)
    ex   de, hl
    add  hl, bc
    ex   de, hl
    ld   bc, (LOCO_GOY)
    add  hl, bc
    ret

; __GB_ADDCUR -- DE = dx, HL = dy -> DE, HL absolute: plus the cursor. Clobbers AF, BC.
__GB_ADDCUR:
    ld   bc, (LOCO_GCX)
    ex   de, hl
    add  hl, bc
    ex   de, hl
    ld   bc, (LOCO_GCY)
    add  hl, bc
    ret

; __GB_PIX -- DE = x, HL = y absolute virtual -> DE, HL the pixel (x >> shift, y >> 1,
; arithmetic). Clobbers AF.
__GB_PIX:
    PROC
    LOCAL __GP_L, __GP_Y
    ld   a, (GFX_XSHIFT)
    or   a
    jr   z, __GP_Y
__GP_L:
    sra  d
    rr   e
    dec  a
    jr   nz, __GP_L
__GP_Y:
    sra  h
    rr   l
    ret
    ENDP

; __GB_PREP -- gfxbare.asm's pen byte and write mode for the graphics pen, normal write.
; Preserves BC, DE, HL. Clobbers AF.
__GB_PREP:
    push bc
    push de
    ld   a, (LOCO_GPEN)
    call __BT_PENMASK
    ld   (GR_I), a
    ld   a, $FF
    ld   (GR_KEEP), a
    pop  de
    pop  bc
    ret

; __GB_ARGS -- the stack argument x of the pair: pops it into DE, y stays in HL.
; Clobbers BC (the caller's return address is moved out of the way and back).
; Used inline by every statement; kept here as a macro-free pattern:
;     pop bc / pop de / push bc

__LOCO_GMOVE:
    pop  bc
    pop  hl                 ; y
    pop  de                 ; x
    push bc
    call __GB_ADDXY
    jr   __GB_SETCUR
__LOCO_GMOVER:
    pop  bc
    pop  hl                 ; y
    pop  de                 ; x
    push bc
    call __GB_ADDCUR
__GB_SETCUR:
    ld   (LOCO_GCX), de
    ld   (LOCO_GCY), hl
    ret

__LOCO_GPLOT:
    pop  bc
    pop  hl                 ; y
    pop  de                 ; x
    push bc
    call __GB_ADDXY
    jr   __GB_PLOTAT
__LOCO_GPLOTR:
    pop  bc
    pop  hl                 ; y
    pop  de                 ; x
    push bc
    call __GB_ADDCUR
; __GB_PLOTAT -- DE, HL = an absolute point: the cursor goes there and the pixel is drawn.
__GB_PLOTAT:
    call __GB_SETCUR
    call __GB_PREP
    call __GB_PIX
    jp   __GR_PIXEL

__LOCO_GDRAW:
    pop  bc
    pop  hl                 ; y
    pop  de                 ; x
    push bc
    call __GB_ADDXY
    jr   __GB_DRAWTO
__LOCO_GDRAWR:
    pop  bc
    pop  hl                 ; y
    pop  de                 ; x
    push bc
    call __GB_ADDCUR
; __GB_DRAWTO -- DE, HL = an absolute point: a line from the cursor to it, which becomes the cursor.
__GB_DRAWTO:
    push de
    push hl
    ld   de, (LOCO_GCX)
    ld   hl, (LOCO_GCY)
    call __GB_PIX
    ld   (L_X0), de
    ld   (L_Y0), hl
    pop  hl
    pop  de
    call __GB_SETCUR
    call __GB_PIX
    ld   (L_X1), de
    ld   (L_Y1), hl
    call __GB_PREP
    jp   __GR_LINE

__LOCO_GTEST:
    pop  bc
    pop  hl                 ; y
    pop  de                 ; x
    push bc
    call __GB_ADDXY
    jr   __GB_TESTAT
__LOCO_GTESTR:
    pop  bc
    pop  hl                 ; y
    pop  de                 ; x
    push bc
    call __GB_ADDCUR
; __GB_TESTAT -- DE, HL = an absolute point: the cursor goes there; HL = the pen of its pixel
; (the graphics paper outside the screen).
__GB_TESTAT:
    PROC
    LOCAL __GT_OFF
    call __GB_SETCUR
    call __GB_PIX
    push de
    push hl
    call __GR_ADDR
    pop  hl
    pop  de
    jr   c, __GT_OFF
    call __GR_POINT
    ld   l, a
    ld   h, 0
    ret
__GT_OFF:
    ld   a, (LOCO_GPAP)
    ld   l, a
    ld   h, 0
    ret
    ENDP

__LOCO_GXPOS:
    ld   hl, (LOCO_GCX)
    ld   de, (LOCO_GOX)
    jr   __GB_SUBHL
__LOCO_GYPOS:
    ld   hl, (LOCO_GCY)
    ld   de, (LOCO_GOY)
__GB_SUBHL:
    or   a
    sbc  hl, de
    ret

__LOCO_GCLG:
    PROC
    ld   a, (LOCO_GPAP)
    call __BT_PENMASK
    ld   hl, (S_POSN)       ; CLG leaves the text cursor where it is
    push hl
    call __BT_CLEAR
    pop  hl
    ld   (S_POSN), hl
    ld   hl, (LOCO_GOX)     ; and sends the graphics cursor to the origin
    ld   (LOCO_GCX), hl
    ld   hl, (LOCO_GOY)
    ld   (LOCO_GCY), hl
    ret
    ENDP

__LOCO_GCLGP:
    call __GF_PEN
    ld   (LOCO_GPAP), a
    jr   __LOCO_GCLG

__LOCO_GPEN:
    call __GF_PEN
__LOCO_GPENP:
    ld   a, l
    ld   (LOCO_GPEN), a
    ret

__LOCO_GPAPER:
    call __GF_PEN
    ld   (LOCO_GPAP), a
    ret

; Bare builds have normal writes only: the checker refuses any other constant mode, and a
; mode that is not a constant gets the same error 5 as a mode outside 0-3.
__LOCO_GMODE:
    ld   a, h
    or   l
    ret  z
    jp   __GF_BAD

__LOCO_GORIGIN:
    pop  bc
    pop  hl                 ; y
    pop  de                 ; x
    push bc
    ld   (LOCO_GOX), de
    ld   (LOCO_GOY), hl
    jp   __GB_SETCUR

#else
; =======================================================================
; Firmware mode
; =======================================================================

; __GF_FW6128 -- error 2 (Syntax error) unless the firmware has the 664/6128 entries
; (the 464's RAM jumpblock has no &BD43-&BD52 entries: the bytes there are not RST 1).
; Clobbers AF.
__GF_FW6128:
    ld   a, ($BD46)
    cp   $CF
    ret  z
    ld   a, 2
    jp   __ERROR

__LOCO_GMOVE:
    pop  bc
    pop  hl                 ; y
    pop  de                 ; x
    push bc
    call .core.__FW_CALL
    defw $BBC0              ; GRA MOVE ABSOLUTE
    ret

__LOCO_GMOVER:
    pop  bc
    pop  hl                 ; y
    pop  de                 ; x
    push bc
    call .core.__FW_CALL
    defw $BBC3              ; GRA MOVE RELATIVE
    ret

__LOCO_GPLOT:
    pop  bc
    pop  hl                 ; y
    pop  de                 ; x
    push bc
    call .core.__FW_CALL
    defw $BBEA              ; GRA PLOT ABSOLUTE
    ret

__LOCO_GPLOTR:
    pop  bc
    pop  hl                 ; y
    pop  de                 ; x
    push bc
    call .core.__FW_CALL
    defw $BBED              ; GRA PLOT RELATIVE
    ret

__LOCO_GDRAW:
    pop  bc
    pop  hl                 ; y
    pop  de                 ; x
    push bc
    call .core.__FW_CALL
    defw $BBF6              ; GRA LINE ABSOLUTE
    ret

__LOCO_GDRAWR:
    pop  bc
    pop  hl                 ; y
    pop  de                 ; x
    push bc
    call .core.__FW_CALL
    defw $BBF9              ; GRA LINE RELATIVE
    ret

__LOCO_GTEST:
    pop  bc
    pop  hl                 ; y
    pop  de                 ; x
    push bc
    call .core.__FW_CALL
    defw $BBF0              ; GRA TEST ABSOLUTE
    ld   l, a
    ld   h, 0
    ret

__LOCO_GTESTR:
    pop  bc
    pop  hl                 ; y
    pop  de                 ; x
    push bc
    call .core.__FW_CALL
    defw $BBF3              ; GRA TEST RELATIVE
    ld   l, a
    ld   h, 0
    ret

__LOCO_GXPOS:
    call .core.__FW_CALL
    defw $BBC6              ; GRA ASK CURSOR: DE = x, HL = y (user coordinates)
    ex   de, hl
    ret

__LOCO_GYPOS:
    call .core.__FW_CALL
    defw $BBC6
    ret

__LOCO_GCLG:
    call .core.__FW_CALL
    defw $BBDB              ; GRA CLEAR WINDOW
    ret

__LOCO_GCLGP:
    call __LOCO_GPAPER
    jr   __LOCO_GCLG

__LOCO_GPEN:
    call __GF_PEN
    call .core.__FW_CALL
    defw $BBDE              ; GRA SET PEN
    ret

__LOCO_GPENP:
    ld   a, l
    call .core.__FW_CALL
    defw $BBDE
    ret

__LOCO_GPAPER:
    call __GF_PEN
    call .core.__FW_CALL
    defw $BBE4              ; GRA SET PAPER
    ret

__LOCO_GMODE:
    ld   a, h
    or   a
    jp   nz, __GF_BAD
    ld   a, l
    cp   4
    jp   nc, __GF_BAD
    call .core.__FW_CALL
    defw $BC59              ; SCR ACCESS: 0 force, 1 XOR, 2 AND, 3 OR
    ret

__LOCO_GORIGIN:
    pop  bc
    pop  hl                 ; y
    pop  de                 ; x
    push bc
    call .core.__FW_CALL
    defw $BBC9              ; GRA SET ORIGIN
    ret

__LOCO_GORIGINW:
    pop  bc                 ; return address; stack: bottom, top, right, left, y, x
    pop  hl                 ; bottom
    pop  de                 ; top
    push bc
    call .core.__FW_CALL
    defw $BBD2              ; GRA WIN HEIGHT: DE = top, HL = bottom
    pop  bc
    pop  hl                 ; right
    pop  de                 ; left
    push bc
    call .core.__FW_CALL
    defw $BBCF              ; GRA WIN WIDTH: DE = left, HL = right
    pop  bc
    pop  hl                 ; y
    pop  de                 ; x
    push bc
    call .core.__FW_CALL
    defw $BBC9              ; GRA SET ORIGIN
    ret

__LOCO_GMASK:
    ld   a, h
    or   a
    jp   nz, __GF_BAD
    call __GF_FW6128
    ld   a, l
    call .core.__FW_CALL
    defw $BD4C              ; GRA SET LINE MASK
    ret

__LOCO_GFIRST:
    ld   a, h
    or   a
    jp   nz, __GF_BAD
    ld   a, l
    cp   2
    jp   nc, __GF_BAD
    call __GF_FW6128
    ld   a, l
    call .core.__FW_CALL
    defw $BD49              ; GRA SET FIRST: 0 leaves the first point out
    ret

__LOCO_GBACK:
    ld   a, h
    or   a
    jp   nz, __GF_BAD
    ld   a, l
    cp   2
    jp   nc, __GF_BAD
    call __GF_FW6128
    ld   a, l
    call .core.__FW_CALL
    defw $BD46              ; GRA SET BACK: 1 transparent
    ret

#endif

    pop namespace
