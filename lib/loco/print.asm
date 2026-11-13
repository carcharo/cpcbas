; -----------------------------------------------------------------------
; lib/loco/print.asm -- Locomotive text layer: strings, zones, SPC, TAB
;
; Written from scratch for this project (MIT, see lib/LICENSE).
;
; Behaviour measured on the real interpreter:
; a PRINT item that does not fit on the rest of the line moves whole to the
; next line (the line is TXT_COLS wide: 20, 40 or 80 by mode); `,` sends
; real spaces up to the next zone start (zones are ZONE wide, columns 1,
; 1+z, 1+2z ...) and sends CR LF instead when the next zone would not fit
; whole on the line. Columns below are 1-based as BASIC shows them. The
; cursor is read with __LOAD_S_POSN (sposn.asm), which folds a pending
; wrap (a character written in the last column) to column 1 of the next row.
;
; Not measured, chosen here (open for the owner to confirm):
;  - an item longer than the whole line, or any item met at column 1, never
;    gets a CR LF first (there is nothing to gain);
;  - TAB(n): n is reduced to the line width (n = 0 counts as 1); a target
;    left of the cursor starts a new line first, as the manual describes;
;  - the zone rule and the width reduction are applied unchanged in modes 0
;    and 2 (only mode 1 was measured).
;
; The cursor column and the line width come from __LOCO_COLW (txt.asm): the
; window of the selected stream, or the printer's column and WIDTH for `#8`.
;
; Entry points (namespace core):
;
;   __LOCO_FIT       BC = width of the item about to be printed: sends CR LF
;                    first when it does not fit on the rest of the line.
;                    Exit: BC preserved. Clobbers AF, DE, HL (+ the gate).
;   __LOCO_PUTS      HL = bytes, BC = count: every byte to __LOCO_PUTC.
;                    Exit: HL past the bytes, BC = 0. Clobbers AF.
;   __LOCO_PRINTSTR  HL = string (length word, then the bytes; 0 = empty),
;                    A = free flag as __PRINTSTR (non-zero: the string is a
;                    temporary and is freed after printing). One PRINT item:
;                    wrap check, then the bytes. Does not print a line end.
;                    Clobbers AF, BC, DE, HL (+ the gate, mem/free.asm).
;   __LOCO_COMMA     PRINT's `,`. Clobbers AF, BC, DE, HL (+ the gate).
;   __LOCO_SPC       A = n (0-255): n MOD the line width spaces (measured on the
;                    interpreter: SPC(40) in mode 1 sends none, SPC(41) one, and the
;                    same for a window and for the printer). Clobbers AF, BC, DE, HL.
;   __LOCO_TAB       A = n: moves to column n with spaces. Clobbers AF, BC,
;                    DE, HL (+ the gate).
;   Firmware entries called, through the gate: TXT OUTPUT (&BB5A) via
;   __LOCO_PUTC, TXT GET CURSOR (&BB78) via __LOAD_S_POSN, MC PRINT CHAR
;   (&BD2B) via the echo. Bare mode calls none.

#include once <loco/txt.asm>
#include once <loco/txtout.asm>
#include once <sposn.asm>
#include once <sysvars.asm>
#include once <mem/free.asm>

    push namespace core

__LOCO_FIT:
    PROC
    LOCAL __FIT_NL, __FIT_DONE
    push bc
    call __LOCO_COLW        ; E = column - 1, H = the line width
    ld   a, e
    or   a
    jr   z, __FIT_DONE      ; column 1: never moves
    ld   d, 0
    ld   a, h               ; A = the line width
    cp   255
    jr   z, __FIT_DONE      ; WIDTH 255 turns the printer's wrapping off (measured)
    ld   h, b
    ld   l, c
    add  hl, de             ; HL = column - 1 + width
    jr   c, __FIT_NL
    ld   e, a
    or   a
    sbc  hl, de             ; > 0: does not fit
    jr   c, __FIT_DONE
    ld   a, h
    or   l
    jr   z, __FIT_DONE
__FIT_NL:
    call __LOCO_NL
__FIT_DONE:
    pop  bc
    ret
    ENDP

__LOCO_PUTS:
    PROC
    LOCAL __PUTS_LOOP
__PUTS_LOOP:
    ld   a, b
    or   c
    ret  z
    ld   a, (hl)
    call __LOCO_PUTC
    inc  hl
    dec  bc
    jr   __PUTS_LOOP
    ENDP

__LOCO_PRINTSTR:
    PROC
    ld   d, a               ; free flag
    ld   a, h
    or   l
    ret  z                  ; NULL: the empty string, nothing to print or free
    push hl                 ; start, for the free
    ld   c, (hl)
    inc  hl
    ld   b, (hl)
    inc  hl
    push hl
    push de
    call __LOCO_FIT         ; BC preserved
    pop  de
    pop  hl
    call __LOCO_PUTS
    pop  hl
    ld   a, d
    or   a
    ret  z
    jp   __MEM_FREE
    ENDP

__LOCO_COMMA:
    PROC
    LOCAL __CM_LOOP, __CM_FOUND, __CM_NL, __CM_NL_POP, __CM_SPACES
    call __LOCO_COLW        ; E = column - 1, H = the line width
    ld   d, h
    ld   a, (__LOCO_ZONE)
    ld   c, a
    ld   b, 0               ; BC = zone width
    ld   hl, 0
__CM_LOOP:                  ; HL = first zone start (0-based) beyond the cursor
    add  hl, bc
    ld   a, h
    or   a
    jr   nz, __CM_FOUND
    ld   a, l
    cp   e
    jr   c, __CM_LOOP
    jr   z, __CM_LOOP
__CM_FOUND:
    ld   a, h
    or   a
    jr   nz, __CM_NL
    push hl                 ; the zone start
    add  hl, bc             ; where that zone would end
    ld   a, h
    or   a
    jr   nz, __CM_NL_POP
    ld   a, d
    cp   l
    jr   c, __CM_NL_POP     ; it would not fit whole
    pop  hl
    ld   a, l
    sub  e
    ld   b, a               ; spaces to the zone start
__CM_SPACES:
    ld   a, ' '
    call __LOCO_PUTC
    djnz __CM_SPACES
    ret
__CM_NL_POP:
    pop  hl
__CM_NL:
    jp   __LOCO_NL
    ENDP

__LOCO_SPC:
    PROC
    LOCAL __SPC_RED, __SPC_LOOP
    or   a
    ret  z
    ld   c, a
    call __LOCO_COLW        ; H = the line width
    ld   b, h
    ld   a, c
__SPC_RED:                  ; SPC(n) is n MOD the width spaces (measured: SPC(40) in mode 1 is none)
    cp   b
    jr   c, __SPC_GO
    sub  b
    jr   __SPC_RED
__SPC_GO:
    or   a
    ret  z
    ld   b, a
__SPC_LOOP:
    ld   a, ' '
    call __LOCO_PUTC
    djnz __SPC_LOOP
    ret
    ENDP

__LOCO_TAB:
    PROC
    LOCAL __TAB_RED, __TAB_GO, __TAB_SPACES, __TAB_FWD, __TAB_COUNT
    ld   c, a               ; C = n
    call __LOCO_COLW        ; E = column - 1, H = the line width
    ld   b, h
    ld   a, c
    or   a
    jr   nz, __TAB_RED
    inc  a
__TAB_RED:
    dec  a                  ; A = target column - 1, reduced to the line
__TAB_GO:
    cp   b
    jr   c, __TAB_SPACES
    sub  b
    jr   __TAB_GO
__TAB_SPACES:
    ld   c, a               ; C = target (0-based)
    cp   e
    jr   nc, __TAB_FWD      ; target at or right of the cursor
    push bc
    call __LOCO_NL          ; a target left of the cursor: new line first
    pop  bc
    ld   a, c               ; spaces = target
    jr   __TAB_COUNT
__TAB_FWD:
    sub  e                  ; spaces = target - cursor
__TAB_COUNT:
    jp   __LOCO_SPC
    ENDP

    pop namespace
