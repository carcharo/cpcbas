; -----------------------------------------------------------------------
; lib/loco/screen.asm -- Locomotive text layer: MODE, PEN, PAPER, BORDER,
; LOCATE, CLS, POS, VPOS (firmware mode, and bare-metal mode with
; -D CPC_BAREMETAL)
;
; Written from scratch for this project (MIT, see lib/LICENSE).
;
; PEN and PAPER take pen numbers and BORDER hardware colours (0-26), as in
; Locomotive; the Spectrum colour numbers of the imported ink.asm, paper.asm
; and border.asm do not apply.
; Argument ranges (MODE 0-2, pens, colours) are not checked here: the
; firmware masks them as it does for the interpreter's own calls. Window
; statements (WINDOW) are not part of L2, so the screen is the window.
;
; Entry points (namespace core). In firmware mode every one except POS and
; VPOS goes through the firmware gate, which clobbers BC', DE', HL', AF'. In bare mode (see "Bare-metal mode" below) no firmware entry is
; called and the shadow registers are left alone. The register contracts are
; the same in both modes.
;
;   __LOCO_MODE     A = mode (0-2). SCR SET MODE (&BC0E) clears the screen and
;                   homes the cursor; then colour.asm's __CPC_SET_MODE_VARS
;                   updates the pen map, TXT_COLS and the graphics shifts, so
;                   the imported runtime stays consistent.
;                   Clobbers AF, BC, DE, HL.
;   __LOCO_PEN      A = pen. TXT SET PEN (&BB90). Clobbers AF, HL.
;   __LOCO_PAPER    A = pen. TXT SET PAPER (&BB96). Clobbers AF, HL.
;   __LOCO_BORDER   B = first colour, C = second (flashing; the same as the
;                   first for BORDER c). SCR SET BORDER (&BC38).
;                   Clobbers AF, BC, DE, HL.
;   __LOCO_LOCATE   H = column, L = row, both 1-based, 0..255 (the lowering checks
;                   the range) in the window of the selected stream. A row above the
;                   window's height is its last row, and a row from 129 on is the first;
;                   a column is handed to the firmware as it is (TXT SET CURSOR
;                   &BB75), which wraps it when the next character is written:
;                   with W the window's width, a column W+1..W+128 is column 1
;                   of the next row (the window scrolls up when that is below the
;                   last row), W+129..255 the last column of the previous row
;                   (measured: LOCATE past the
;                   width). Exit: Carry clear when moved; Carry set (nothing
;                   moved, no firmware call) when the column or the row is 0: the
;                   lowering raises Improper argument (5). Clobbers AF, BC, DE, HL.
;   __LOCO_CLS      TXT CLEAR WINDOW (&BB6C): clears with the current paper
;                   and homes the cursor. Clobbers AF, BC, DE, HL.
;   __LOCO_POS      Exit: HL = POS of the selected stream, the column, 1 at the
;                   left edge of its window. A pending wrap (a character written
;                   in the last column, or a column LOCATEd past the edge) counts
;                   as column 1 of the next line (txt.asm __LOCO_CURSOR).
;                   Clobbers AF, DE.
;   __LOCO_VPOS     Exit: HL = VPOS, the row, 1 at the top. As POS.
;                   Clobbers AF, DE.
;
; Bare-metal mode (-D CPC_BAREMETAL): the same entries over the runtime's own
; text renderer (txtbare.asm, txtglyph.asm); no firmware is called.
;   - Pens. The renderer works from the attribute byte ATTR_P/ATTR_T (ink in
;     bits 0-2, paper in bits 3-5, each a Spectrum colour turned into a pen by
;     PEN_MAP). This layer keeps the two pen numbers in __LOCO_PENV and
;     __LOCO_PAPERV (default 1 and 0, as the firmware's) and applies them by
;     setting ATTR_P = ATTR_T = ink 0 / paper 1 and PEN_MAP[0], PEN_MAP[1] to
;     the two pens, then rebuilding the draw tables (__BT_PENMASKS). A pen
;     above the mode's range is masked by the renderer, as the firmware does.
;     Locomotive programs never use the Spectrum INK/PAPER of the imported
;     runtime, so the two PEN_MAP slots are ours. After the first PEN, PAPER or
;     MODE, Spectrum colours 0 and 1 no longer map to their mode's pens: any
;     imported routine that takes a Spectrum colour through __INK_TO_PEN
;     (copy_attr.asm, border.asm) sees the Locomotive pens instead. Bare-mode
;     graphics (gfx.asm, L4-GFX; follow-up 40) take Locomotive pens directly,
;     from their own graphics pen and paper, and do not go through PEN_MAP;
;     MODE only resets their origin and cursor.
;   - MODE: Gate Array mode, then the pens re-applied and the screen cleared to
;     pen 0 (the firmware's SCR SET MODE clears to pen 0, not to PAPER), the
;     cursor home.
;   - BORDER: the Gate Array only, in the first colour (B). The second colour
;     of BORDER a,b is not shown: bare mode has no flashing.
;   - CLS: clears to the current paper pen (BT_FILL) and homes the cursor.
;   - LOCATE: sets the renderer's cursor (S_POSN); a column in the last
;     position is a pending wrap, as in the renderer.
;   - POS/VPOS: the renderer's cursor through sposn.asm (same wrap rule).

#include once <fwcall.asm>
#include once <sysvars.asm>
#include once <colour.asm>
#include once <sposn.asm>
#include once <loco/vars.asm>
#include once <loco/txt.asm>
#ifdef CPC_BAREMETAL
#include once <txtbare.asm>
#include once <gacolour.asm>
#endif

    push namespace core

#ifdef CPC_BAREMETAL
; __LOCO_APPLY -- makes the renderer use the pens in __LOCO_PENV and
; __LOCO_PAPERV (see the header). Registers clobbered: none (__BT_PENMASKS
; preserves them; A is saved here).
__LOCO_APPLY:
    push af
    ld   a, (__LOCO_PENV)
    ld   (PEN_MAP), a
    ld   a, (__LOCO_PAPERV)
    ld   (PEN_MAP + 1), a
    ld   a, 8               ; ink colour 0, paper colour 1
    ld   (ATTR_P), a
    ld   (ATTR_T), a
    call __BT_PENMASKS
    pop  af
    ret

__LOCO_PENV:
    DEFB 1
__LOCO_PAPERV:
    DEFB 0

__LOCO_MODE:
    call __BT_SET_MODE
    call __LOCO_APPLY
    ld   hl, 0              ; the graphics origin and cursor go back to 0, 0 (L4-GFX; the firmware's SCR SET MODE does)
    ld   (LOCO_GOX), hl
    ld   (LOCO_GOY), hl
    ld   (LOCO_GCX), hl
    ld   (LOCO_GCY), hl
    xor  a                  ; pen 0 is the byte 0 in every mode
    jp   __BT_CLEAR

__LOCO_PEN:
    ld   (__LOCO_PENV), a
    jp   __LOCO_APPLY

__LOCO_PAPER:
    ld   (__LOCO_PAPERV), a
    jp   __LOCO_APPLY

__LOCO_BORDER:
    ld   a, b
    jp   __CPC_SET_BORDER

__LOCO_LOCATE:
    PROC
    LOCAL __LC_BAD, __LC_LOW, __LC_ROWOK, __LC_FWD, __LC_SET
    ld   a, h
    or   a
    jr   z, __LC_BAD
    ld   a, l
    or   a
    jr   z, __LC_BAD
    cp   129
    jr   c, __LC_LOW
    ld   l, 1               ; rows 129..255 are above the screen: the first row
    jr   __LC_ROWOK
__LC_LOW:
    cp   SCR_ROWS + 1
    jr   c, __LC_ROWOK
    ld   l, SCR_ROWS        ; a row below the screen is the last
__LC_ROWOK:
    ld   a, (TXT_COLS)
    ld   b, a
    sub  h                  ; W - column, a signed byte: negative is right of the edge
    jp   m, __LC_FWD
    ld   a, h
    dec  a
    jp   p, __LC_SET        ; column 1..128 and not past the edge
    ld   h, b               ; column 129..255: the last column of the previous row
    dec  l
    jr   nz, __LC_SET
    inc  l                  ; (the first row stays: the firmware rolls the window down there, we do not)
    jr   __LC_SET
__LC_FWD:
    ld   h, 1               ; column 1 of the next row; below the last row the screen scrolls
    inc  l                  ; when the next character is drawn (the renderer's lazy scroll, __BT_LF)
__LC_SET:
    dec  h
    dec  l
    ld   d, l               ; D = row, E = column, 0-based
    ld   e, h
    ld   (S_POSN), de
    or   a                  ; Carry clear
    ret
__LC_BAD:
    scf
    ret
    ENDP

__LOCO_CLS:
    ld   a, (BT_FILL)
    jp   __BT_CLEAR

#else
__LOCO_MODE:
    push af
    call .core.__FW_CALL
    defw $BC0E              ; SCR SET MODE
    pop  af
    jp   __CPC_SET_MODE_VARS

__LOCO_PEN:
    call .core.__FW_CALL
    defw $BB90              ; TXT SET PEN
    ret

__LOCO_PAPER:
    call .core.__FW_CALL
    defw $BB96              ; TXT SET PAPER
    ret

__LOCO_BORDER:
    call .core.__FW_CALL
    defw $BC38              ; SCR SET BORDER
    ret

__LOCO_LOCATE:
    PROC
    LOCAL __LC_BAD, __LC_LOW, __LC_GO
    ld   a, h
    or   a
    jr   z, __LC_BAD
    ld   a, l
    or   a
    jr   z, __LC_BAD
    push hl
    call .core.__FW_CALL
    defw $BB69              ; TXT GET WINDOW: L = top row, E = bottom row
    ld   a, e
    sub  l
    inc  a
    ld   b, a               ; B = the window's height
    pop  hl
    ld   a, l
    cp   129
    jr   c, __LC_LOW
    ld   l, 1               ; rows 129..255 are above the window: the first row
    jr   __LC_GO
__LC_LOW:
    ld   a, b
    cp   l
    jr   nc, __LC_GO
    ld   l, b               ; a row below the window is the last
__LC_GO:
    call .core.__FW_CALL
    defw $BB75              ; TXT SET CURSOR: the column as it is, the firmware wraps it
    or   a                  ; Carry clear
    ret
__LC_BAD:
    scf
    ret
    ENDP

__LOCO_CLS:
    call .core.__FW_CALL
    defw $BB6C              ; TXT CLEAR WINDOW
    ret
#endif

__LOCO_POS:
    call __LOCO_CURSOR
    ld   l, e
    ld   h, 0
    inc  hl
    ret

__LOCO_VPOS:
    call __LOCO_CURSOR
    ld   l, d
    ld   h, 0
    inc  hl
    ret

    pop namespace
