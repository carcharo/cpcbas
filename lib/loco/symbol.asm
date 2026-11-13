; -----------------------------------------------------------------------
; lib/loco/symbol.asm -- Locomotive text layer: SYMBOL and SYMBOL AFTER
;
; Written from scratch for this project (MIT, see lib/LICENSE).
;
; SYMBOL c, r1 [, ... r8] redefines the 8 x 8 matrix of character c, which
; has to be at or above the first redefinable character (SYMBOL AFTER n, 240
; by default); a missing row is 0. The lowering passes nine values, the
; missing rows as 0.
;
;   __LOCO_SYMBOL     stack: c, r1 .. r7 (words, pushed in that order), HL = r8.
;                     Each is 0-255, else error 5, and so is a c below the
;                     first redefinable character. Clobbers AF, BC, DE, HL.
;   __LOCO_SYMAFTER   HL = n, 0-256 (256: none), else error 5. Clobbers AF,
;                     BC, DE, HL.
;
; Firmware mode: the matrices are the firmware's user table. The table holds
; the characters from n up to 255 ((256 - n) * 8 bytes) and has to be in the
; central 32K with no ROM over it (the firmware reads it with the ROMs on), so
; it is taken from the heap at the first SYMBOL or SYMBOL AFTER (240 for the
; first, as BASIC's) and installed with TXT SET M TABLE (&BBAB), which fills it
; with the shapes the characters have now, so a character that is not
; redefined keeps its look, a SYMBOL AFTER n keeps the earlier definitions,
; and the old table is given back. SYMBOL is TXT SET MATRIX (&BBA8), with the
; eight bytes copied to the stack first (the firmware reads them with the lower
; ROM on, so they cannot stay in the program's low addresses): the firmware
; refuses a character below the table, which is error 5. A heap that
; cannot hold the table is error 7 (Memory full). Clobbers BC', DE', HL', AF'.
;
; Bare mode: the character matrices are the renderer's own table
; (__CPC_FONT, characters 32-255, txtglyph.asm); SYMBOL writes there, and
; SYMBOL AFTER only moves the limit. A character below 32 has no glyph and is
; ignored.
; -----------------------------------------------------------------------

#include once <error.asm>
#include once <fwcall.asm>
#ifdef CPC_BAREMETAL
#include once <txtglyph.asm>
#else
#include once <mem/alloc.asm>
#include once <mem/free.asm>
#endif

    push namespace core

__SY_ROWS:  DEFS 8
__SY_CHAR:  DEFB 0
__SY_RET:   DEFW 0

__SY_BYTE:                  ; HL = 0-255 -> A; else error 5
    ld   a, h
    or   a
    jr   nz, __SY_BAD
    ld   a, l
    ret
__SY_BAD:
    ld   a, 5
    jp   __ERROR

__LOCO_SYMBOL:
    call __SY_BYTE
    ld   (__SY_ROWS + 7), a
    pop  hl
    ld   (__SY_RET), hl
    pop  hl
    call __SY_BYTE
    ld   (__SY_ROWS + 6), a
    pop  hl
    call __SY_BYTE
    ld   (__SY_ROWS + 5), a
    pop  hl
    call __SY_BYTE
    ld   (__SY_ROWS + 4), a
    pop  hl
    call __SY_BYTE
    ld   (__SY_ROWS + 3), a
    pop  hl
    call __SY_BYTE
    ld   (__SY_ROWS + 2), a
    pop  hl
    call __SY_BYTE
    ld   (__SY_ROWS + 1), a
    pop  hl
    call __SY_BYTE
    ld   (__SY_ROWS), a
    pop  hl
    call __SY_BYTE
    ld   (__SY_CHAR), a
    call __SY_SET
    ld   hl, (__SY_RET)
    jp   (hl)

#ifdef CPC_BAREMETAL
__SY_N:     DEFW 240        ; the first redefinable character

__SY_SET:
    ld   a, (__SY_CHAR)
    ld   e, a
    ld   d, 0
    ld   hl, (__SY_N)
    or   a
    sbc  hl, de             ; n - c
    jr   c, __SY_OK         ; c above n
    ld   a, h
    or   l
    jr   nz, __SY_BAD       ; c below n
__SY_OK:
    ld   a, e
    cp   32
    ret  c                  ; no glyph below 32
    ld   l, a
    ld   h, 0
    ld   de, 32
    or   a
    sbc  hl, de
    add  hl, hl
    add  hl, hl
    add  hl, hl
    ld   de, __CPC_FONT
    add  hl, de
    ex   de, hl
    ld   hl, __SY_ROWS
    ld   bc, 8
    ldir
    ret

__LOCO_SYMAFTER:
    ld   a, h
    or   a
    jr   z, __SA_OK
    dec  a
    jp   nz, __SY_BAD
    ld   a, l
    or   a
    jp   nz, __SY_BAD       ; 256 at most
__SA_OK:
    ld   (__SY_N), hl
    ret
#else
__SY_TAB:   DEFW 0          ; the table this file took from the heap, 0 if none
__SY_HAVE:  DEFB 0          ; non-zero once a table is installed

__SY_SET:                   ; the matrix in __SY_ROWS for __SY_CHAR
    ld   a, (__SY_HAVE)
    or   a
    jr   nz, __SY_DO
    ld   hl, 240
    call __SY_INSTALL
__SY_DO:                    ; the firmware reads the matrix with the lower ROM on, so it must not be
    ld   hl, -8             ; in the program's low addresses: it goes on the stack for the call
    add  hl, sp
    ld   sp, hl
    ex   de, hl
    ld   hl, __SY_ROWS
    ld   bc, 8
    ldir
    ld   hl, 0
    add  hl, sp             ; HL = the copy
    ld   a, (__SY_CHAR)
    call .core.__FW_CALL
    defw $BBA8              ; TXT SET MATRIX: Carry false for a character below the table
    sbc  a, a               ; 0 refused, -1 set
    ld   hl, 8
    add  hl, sp
    ld   sp, hl
    or   a
    ret  nz
    jp   __SY_BAD

__LOCO_SYMAFTER:
    ld   a, h
    or   a
    jr   z, __SY_INSTALL
    dec  a
    jp   nz, __SY_BAD
    ld   a, l
    or   a
    jp   nz, __SY_BAD       ; 256 at most
__SY_INSTALL:               ; HL = the first character, 0-256
    PROC
    LOCAL __SI_NONE, __SI_SET, __SI_NOMEM
    push hl
    ld   de, 256
    ex   de, hl             ; HL = 256, DE = n
    or   a
    sbc  hl, de             ; HL = characters in the table
    add  hl, hl
    add  hl, hl
    add  hl, hl             ; HL = bytes
    ld   a, h
    or   l
    jr   z, __SI_NONE
    ld   b, h
    ld   c, l
    call __MEM_ALLOC
    ld   a, h
    cp   $40
    jr   c, __SI_NOMEM      ; none, or under the lower ROM
    jr   __SI_SET
__SI_NONE:
    ld   hl, 0
__SI_SET:
    pop  de                 ; DE = the first character
    push hl                 ; the new table
    call .core.__FW_CALL
    defw $BBAB              ; TXT SET M TABLE: DE = first character, HL = table
    ld   hl, (__SY_TAB)
    ld   a, h
    or   l
    call nz, __MEM_FREE     ; the old table back
    pop  hl
    ld   (__SY_TAB), hl
    ld   a, 1
    ld   (__SY_HAVE), a
    ret
__SI_NOMEM:
    pop  de
    ld   a, ERROR_OutOfMemory
    jp   __ERROR
    ENDP
#endif

    pop namespace
