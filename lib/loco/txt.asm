; -----------------------------------------------------------------------
; lib/loco/txt.asm -- Locomotive text layer: character output
;
; Written from scratch for this project (MIT, see lib/LICENSE).
;
; Every byte goes to the text screen untouched, as the interpreter sends
; it, so control codes (CHR$(7), CHR$(12), CHR$(31)+x+y ...) act as on the
; CPC. Nothing here goes through print.asm's Spectrum control-code
; translation. Under -D __CPC_PRINTER_ECHO__ (the test harness) each byte
; is also sent to the printer with the harness filter
; ("Printer capture"): 13 becomes a line end (10), 10 and every other code
; below 32 are dropped, the rest is sent as it is. The interpreter side
; applies the same filter to its text output, so the two captures compare.
;
; Entry points (all in namespace core; __LOCO_PUTC, __LOCO_NL and __LOCO_ECHO are in txtout.asm, so that a bare
; program that only positions the cursor does not link the glyph renderer and its 1.8 KB font, L5-HOT, follow-up 186):
;
;   __LOCO_PUTC     A = byte -> text screen (and the printer echo).
;                   Firmware mode: TXT OUTPUT (&BB5A) through the gate.
;                   Bare mode: the text renderer's __BT_PUTC (13 CR, 10 LF,
;                   32-255 drawn, other codes ignored).
;                   Exit: A, BC, DE, HL preserved (flags are not).
;                   Clobbers: BC', DE', HL', AF' (the gate).
;   __LOCO_NL       CR then LF (13, 10), PRINT's line end.
;                   Exit: A clobbered, BC, DE, HL preserved.
;   __LOCO_ECHO     (only with __CPC_PRINTER_ECHO__) A = byte -> printer,
;                   filtered. Firmware mode: MC PRINT CHAR (&BD2B) through
;                   the gate, up to 3 tries (a busy printer makes it give
;                   up); bare mode: bareboot.asm's __CPC_PRN_CHAR.
;                   Exit: AF, BC, DE, HL preserved.
;   __LOCO_ZONE_SET A = ZONE width (1-255) for the `,` separator.
;                   Clobbers: nothing (flags too).
;   __LOCO_ZONE     (data, DEFB) the current zone width, default 13.
;   __LOCO_ZONEN    ZONE n: HL = n, error 5 unless 1-255; then __LOCO_ZONE_SET.
;                   Clobbers AF.
;   __LOCO_CURSOR   Exit: E = column - 1 and D = row - 1 of the next character
;                   of the selected text stream, relative to its window, with a
;                   pending wrap (a character written in the last column)
;                   folded to column 0 of the next row (the last row stays);
;                   H = the window's width and L = its height. BC preserved.
;                   Clobbers AF, DE, HL (+ the gate).
;                   Firmware mode: TXT GET CURSOR (&BB78) and TXT GET WINDOW
;                   (&BB69). Bare mode: the renderer's cursor, the screen.
;   __LOCO_COLW     The same for the output device of the statement (LOCO_DEV):
;                   device 0 is __LOCO_CURSOR; the printer (8) gives E = its
;                   column - 1 and H = its width (D and L meaningless).
;                   PRINT's width and zone rules read the cursor through it.
;
; Output devices (docs/ir.md "Streams"; firmware builds only, a bare build has
; the text screen alone). LOCO_DEV (0 the text screen, 8 the printer, 9 the
; file) is set by __LOCO_STREAM (window.asm). Every device but 0 is handled by
; the jump table LOCO_DEVVEC points at (window.asm): entry +0 puts the byte A
; (every register preserved), +3 is __LOCO_COLW's, +6 is the line end. A program
; that never uses `#8` never links window.asm and never sets LOCO_DEV, so the
; test below is the whole cost: a byte test per printed character.

#include once <fwcall.asm>
#include once <sysvars.asm>
#include once <loco/vars.asm>
#include once <error.asm>
#ifdef CPC_BAREMETAL
#include once <sposn.asm>
#endif

    push namespace core

#ifdef CPC_BAREMETAL
__LOCO_CURSOR:
    call __LOAD_S_POSN      ; D = row, E = column, a pending wrap folded
    ld   a, d
    cp   SCR_ROWS
    jr   c, __LOCO_CUR_ROW
    ld   d, SCR_ROWS - 1    ; a pending scroll (row 25): still the last row
__LOCO_CUR_ROW:
    ld   a, (TXT_COLS)
    ld   h, a
    ld   l, SCR_ROWS
    ret
#else
; The position of the next character is TXT VALIDATE's (docs: the firmware
; guide, entry 45), worked out here with the same signed tests so that no roll
; happens: a column right of the window (the window's width less the column
; is a negative byte) goes to column 1 of the next row, a column left of it
; (the column less one is a negative byte, so 129 and above) to the last
; column of the previous row, then a row below the window is the last row and
; a row above it the first. That is the rule LOCATE past the width measured.
__LOCO_CURSOR:
    push bc
    call .core.__FW_CALL
    defw $BB78              ; TXT GET CURSOR: H = column, L = row (1-based, in the window)
    push hl
    call .core.__FW_CALL
    defw $BB69              ; TXT GET WINDOW: H = left, D = right, L = top, E = bottom
    ld   a, d
    sub  h
    inc  a
    ld   b, a               ; B = the width
    ld   a, e
    sub  l
    inc  a
    ld   c, a               ; C = the height
    pop  hl                 ; H = column, L = row
    ld   a, b
    sub  h
    jp   m, __LOCO_CUR_RIGHT
    ld   a, h
    dec  a
    jp   p, __LOCO_CUR_COL
    ld   h, b               ; left of the window: its last column, the row before
    dec  l
    jr   __LOCO_CUR_COL
__LOCO_CUR_RIGHT:
    ld   h, 1               ; right of it: column 1 of the next row
    inc  l
__LOCO_CUR_COL:
    ld   a, c
    sub  l
    jp   p, __LOCO_CUR_UP
    ld   l, c               ; below the window: the last row (it rolls when a character is written)
    jr   __LOCO_CUR_DONE
__LOCO_CUR_UP:
    ld   a, l
    dec  a
    jp   p, __LOCO_CUR_DONE
    ld   l, 1               ; above it: the first row
__LOCO_CUR_DONE:
    ld   d, l
    dec  d                  ; D = row - 1
    ld   e, h
    dec  e                  ; E = column - 1
    ld   h, b
    ld   l, c
    pop  bc
    ret
#endif

__LOCO_COLW:
#ifndef CPC_BAREMETAL
    ld   a, (LOCO_DEV)
    or   a
    jr   z, __LOCO_CURSOR
    ld   hl, (LOCO_DEVVEC)
    inc  hl
    inc  hl
    inc  hl
    jp   (hl)
#else
    jr   __LOCO_CURSOR
#endif

__LOCO_ZONE_SET:
    ld   (__LOCO_ZONE), a
    ret

__LOCO_ZONEN:
    ld   a, h
    or   a
    jr   nz, __ZN_BAD
    ld   a, l
    or   a
    jr   z, __ZN_BAD
    ld   (__LOCO_ZONE), a
    ret
__ZN_BAD:
    ld   a, 5
    jp   .core.__ERROR

__LOCO_ZONE:
    DEFB 13

    pop namespace
