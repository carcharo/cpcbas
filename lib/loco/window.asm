; -----------------------------------------------------------------------
; lib/loco/window.asm -- Locomotive text layer: streams, windows, TAG and the
; printer (WIDTH, `#8`)
;
; Written from scratch for this project (MIT, see lib/LICENSE).
;
; The stream contract is docs/ir.md "Streams". A statement with a stream
; other than the constant 0 runs between __LOCO_STREAM and __LOCO_STREAM0;
; the functions POS, VPOS and COPYCHR$ take the stream in A and select and
; restore it themselves. Streams 0-7 are the firmware's (TXT STR SELECT); `#8`
; is the printer, which this file drives itself: there is no firmware printer
; stream, so the column (POS(#8)), the line width (WIDTH) and the wrap of long
; lines are kept here, as the interpreter does (L4-TEXT). Stream 9 is the output file (L4-FILES): __LOCO_STREAM takes its device table
; from LOCO_FDEVVEC, which fileout.asm's OPENOUT sets and CLOSEOUT clears (no link
; dependency), and raises error 31 (File not open) while it is 0.
;
; Entry points (namespace core). Firmware mode; every one that calls the
; firmware goes through the gate and clobbers BC', DE', HL', AF'.
;
;   __LOCO_STREAM   A = stream 0-9. 0-7: TXT STR SELECT (&BBB4) and LOCO_DEV =
;                   0; 8: LOCO_DEV = 8 and LOCO_DEVVEC = the printer's table; 9: LOCO_DEV =
;                   9 and LOCO_DEVVEC = LOCO_FDEVVEC (error 31 when no file is open).
;                   Above 9: error 5. Clobbers AF, HL.
;   __LOCO_STREAM0  stream 0 and device 0 again. Clobbers AF, HL.
;   __LOCO_WINDOW   WINDOW l, r, t, b: stack: l, r, t (words, pushed in that
;                   order), HL = b. Each is 1-255, else error 5 (a column or a
;                   row off the screen is not an error: the firmware cuts the
;                   window to the screen). TXT WIN ENABLE (&BB66) with the
;                   values less one: the cursor goes to the window's corner
;                   and the window is not cleared. Clobbers AF, BC, DE, HL.
;   __LOCO_WINSWAP  WINDOW SWAP a, b: stack: a, HL = b, each 0-7 else error 5.
;                   TXT SWAP STREAMS (&BBB7). Clobbers AF, BC, DE, HL.
;   __LOCO_TAG      TAG: TXT SET GRAPHIC (&BB63) on. Clobbers AF.
;   __LOCO_TAGOFF   TAGOFF: the same off. Clobbers AF.
;   __LOCO_POSS     A = stream -> HL = POS(#s). Streams 0-7 read the window's
;                   cursor (a pending wrap counts as column 1 of the next row),
;                   8 the printer's column (0 before the first byte), 9 the output
;                   file's (1 at the start of a line; error 31 when none is open),
;                   above 9 and VPOS(#8), VPOS(#9) are error 5.
;   __LOCO_VPOSS    A = stream -> HL = VPOS(#s).
;   __LOCO_WIDTH    WIDTH n: HL = n, 1-255 else error 5; 255 turns the
;                   printer's line wrap off.
;
; The device table (txt.asm calls it through LOCO_DEVVEC): __LOCO_DEVTAB is
; three jumps. __LOCO_PUTDEV (A = the byte; every register preserved), __LOCO_COLDEV
; (E = column - 1, H = width; clobbers AF, HL) and __LOCO_NLDEV (the line end:
; CR LF straight to the printer, no wrap test; BC, DE, HL preserved).
;
; The printer, measured on the interpreter (BASIC 1.1, the 6128: the 464 sends a
; CR LF before the very first byte and starts POS(#8) at 0, which a program
; that begins with `PRINT #8` does not see): POS(#8) is 1 at the start of a line
; and one more for every byte of 32 or more (CR makes it 1 again, the other
; control codes change nothing); a byte that arrives with the counter past the
; width (132, or WIDTH n) is preceded by CR LF (the test is for every byte, a CR
; included); PRINT's own line end is not tested. WIDTH 255 never wraps and the
; counter stays at 255. LOCO_PRCOL is 0 until the first byte, which counts as 1.
;
; Bare builds have stream 0 only: __LOCO_STREAM raises error 5 for any other,
; __LOCO_STREAM0 does nothing, POS(#s) and VPOS(#s) accept 0.
; -----------------------------------------------------------------------

#include once <error.asm>
#include once <fwcall.asm>
#include once <sysvars.asm>
#include once <loco/vars.asm>
#include once <loco/txt.asm>
#ifdef CPC_BAREMETAL
#include once <loco/screen.asm>
#endif

    push namespace core

#ifdef CPC_BAREMETAL
__LOCO_STREAM:
    or   a
    ret  z
    ld   a, 5
    jp   __ERROR

__LOCO_STREAM0:
    ret

__LOCO_POSS:
    or   a
    jr   nz, __LOCO_STREAM
    jp   __LOCO_POS

__LOCO_VPOSS:
    or   a
    jr   nz, __LOCO_STREAM
    jp   __LOCO_VPOS
#else
; ---- selecting a stream ----------------------------------------------------
__LOCO_STREAM:
    cp   8
    jr   c, __WN_TXT
    jr   z, __WN_DEV
    cp   10
    jr   c, __WN_DEV
    ld   a, 5
    jp   __ERROR
__WN_TXT:
    call .core.__FW_CALL
    defw $BBB4              ; TXT STR SELECT
    xor  a
    ld   (LOCO_DEV), a
    ret
__WN_DEV:                   ; 8 the printer, 9 the output file
    cp   9
    jr   z, __WN_FILE
    ld   (LOCO_DEV), a
    ld   hl, __LOCO_DEVTAB
    ld   (LOCO_DEVVEC), hl
    ret
__WN_FILE:
    ld   hl, (LOCO_FDEVVEC)
    ld   a, h
    or   l
    jr   nz, __WN_FOPEN
    ld   a, 31              ; File not open
    jp   __ERROR
__WN_FOPEN:
    ld   (LOCO_DEVVEC), hl
    ld   a, 9
    ld   (LOCO_DEV), a
    ret

__LOCO_STREAM0:
    xor  a
    ld   (LOCO_DEV), a
    call .core.__FW_CALL
    defw $BBB4
    ret

; ---- WINDOW, WINDOW SWAP, TAG ----------------------------------------------
__WN_V:     DEFS 4          ; left, right, top, bottom, each less one
__WN_RET:   DEFW 0

__WN_BYTE:                  ; HL = 1-255 -> A = HL - 1; else error 5
    ld   a, h
    or   a
    jr   nz, __WN_BAD
    ld   a, l
    or   a
    jr   z, __WN_BAD
    dec  a
    ret
__WN_BAD:
    ld   a, 5
    jp   __ERROR

__LOCO_WINDOW:
    call __WN_BYTE
    ld   (__WN_V + 3), a    ; the bottom
    pop  hl
    ld   (__WN_RET), hl
    pop  hl
    call __WN_BYTE
    ld   (__WN_V + 2), a    ; the top
    pop  hl
    call __WN_BYTE
    ld   (__WN_V + 1), a    ; the right
    pop  hl
    call __WN_BYTE
    ld   (__WN_V), a        ; the left
    ld   a, (__WN_V)
    ld   h, a
    ld   a, (__WN_V + 1)
    ld   d, a
    ld   a, (__WN_V + 2)
    ld   l, a
    ld   a, (__WN_V + 3)
    ld   e, a
    call .core.__FW_CALL
    defw $BB66              ; TXT WIN ENABLE
    ld   hl, (__WN_RET)
    jp   (hl)

__LOCO_WINSWAP:
    ld   a, h
    or   a
    jr   nz, __WN_BAD
    ld   a, l
    cp   8
    jr   nc, __WN_BAD
    ld   c, a               ; C = b
    pop  hl                 ; the return address
    pop  de                 ; DE = a
    push hl
    ld   a, d
    or   a
    jr   nz, __WN_BAD
    ld   a, e
    cp   8
    jr   nc, __WN_BAD
    ld   b, a               ; B = a
    call .core.__FW_CALL
    defw $BBB7              ; TXT SWAP STREAMS
    ret

__LOCO_TAG:
    ld   a, 1
    jr   __WN_TAG
__LOCO_TAGOFF:
    xor  a
__WN_TAG:
    call .core.__FW_CALL
    defw $BB63              ; TXT SET GRAPHIC
    ret

; ---- POS, VPOS: the cursor of a stream ------------------------------------
; __WN_CUR: A = stream 0-7 -> D = row - 1, E = column - 1, with the stream
; selected only for the read.
__WN_CUR:
    call .core.__FW_CALL
    defw $BBB4              ; TXT STR SELECT: A = the stream that was selected
    push af
    call __LOCO_CURSOR
    pop  af
    push de
    call .core.__FW_CALL
    defw $BBB4              ; the previous stream again
    pop  de
    ret

__LOCO_POSS:
    cp   8
    jr   c, __WN_POS
    jr   z, __WN_POSP
    cp   10
    jr   nc, __WN_BAD5
    ld   a, (LOCO_FFLAG)    ; #9: the output file's column
    and  2
    jr   nz, __WN_POSF
    ld   a, 31
    jp   __ERROR
__WN_POSF:
    ld   a, (LOCO_FCOL)
    inc  a
    jr   __WN_POSH
__WN_POS:
    call __WN_CUR
    ld   l, e
    ld   h, 0
    inc  hl
    ret
__WN_POSP:                  ; the printer: its POS (1 before the first byte)
    ld   a, (LOCO_PRCOL)
    or   a
    jr   nz, __WN_POSH
    inc  a
__WN_POSH:
    ld   l, a
    ld   h, 0
    ret

__LOCO_VPOSS:
    cp   8
    jr   nc, __WN_BAD5      ; VPOS(#8), VPOS(#9) and above
    call __WN_CUR
    ld   l, d
    ld   h, 0
    inc  hl
    ret
__WN_BAD5:
    ld   a, 5
    jp   __ERROR

; ---- the printer -------------------------------------------------------------
__LOCO_WIDTH:
    ld   a, h
    or   a
    jp   nz, __WN_BAD
    ld   a, l
    or   a
    jp   z, __WN_BAD
    ld   (LOCO_PRWID), a
    ret

__LOCO_DEVTAB:
    jp   __LOCO_PUTDEV
    jp   __LOCO_COLDEV
    jp   __LOCO_NLDEV

__PR_WIDTH:                 ; A = the line width
    ld   a, (LOCO_PRWID)
    or   a
    ret  nz
    ld   a, 132
    ret

__PR_SEND:                  ; A = a byte for MC PRINT CHAR (&BD2B), up to 3 tries. Preserves every register
    push af
    push de
    ld   d, a
    ld   e, 3
__PR_TRY:
    ld   a, d
    call .core.__FW_CALL
    defw $BD2B
    jr   c, __PR_SENT
    dec  e
    jr   nz, __PR_TRY
__PR_SENT:
    pop  de
    pop  af
    ret

__PR_CRLF:                  ; CR LF to the printer, the column back at the start of the line
    ld   a, 13
    call __PR_SEND
    ld   a, 10
    call __PR_SEND
    ld   a, 1
    ld   (LOCO_PRCOL), a
    ret

__LOCO_PUTDEV:
    push af
    push bc
    ld   c, a               ; C = the byte
    ld   a, (LOCO_DEV)
    cp   8
    jr   nz, __PD_FILE
    call __PR_WIDTH
    inc  a
    jr   z, __PD_SEND       ; width 255: no wrap
    dec  a
    ld   b, a               ; B = width
    ld   a, (LOCO_PRCOL)
    or   a
    jr   z, __PD_SEND       ; nothing sent yet: column 1
    dec  a                  ; A = the column, 0-based
    cp   b
    call nc, __PR_CRLF      ; past the width: a new line first
__PD_SEND:
    ld   a, c
    call __PR_SEND
    cp   13
    jr   nz, __PD_NOCR
    ld   a, 1
    ld   (LOCO_PRCOL), a
    jr   __PD_DONE
__PD_NOCR:
    cp   32
    jr   c, __PD_DONE       ; the other control codes do not move the column
    ld   a, (LOCO_PRCOL)
    or   a
    jr   nz, __PD_INC
    inc  a                  ; nothing sent yet: column 1
__PD_INC:
    inc  a
    jr   z, __PD_DONE       ; 255 stays
    ld   (LOCO_PRCOL), a
__PD_DONE:
    pop  bc
    pop  af
    ret
__PD_FILE:                  ; the file: L4-FILES
    pop  bc
    pop  af
    ld   a, 5
    jp   __ERROR

__LOCO_COLDEV:
    ld   a, (LOCO_PRCOL)
    or   a
    jr   z, __CD_HAVE
    dec  a
__CD_HAVE:
    ld   e, a
    call __PR_WIDTH
    ld   h, a
    ld   d, 0
    ld   l, 0
    ret

__LOCO_NLDEV:
    push af
    call __PR_CRLF
    pop  af
    ret
#endif

    pop namespace
