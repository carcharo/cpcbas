; -----------------------------------------------------------------------
; lib/loco/write.asm -- WRITE [#s,] items (L4-FILES)
;
; Written from scratch for this project (MIT, see lib/LICENSE).
;
; WRITE sends each item the way a data file wants it: a string in quotes, a number as text without
; the sign position's space, the items separated by commas, a line end after the last. It goes
; to the current output device through __LOCO_PUTC, so it serves the screen windows, the
; printer and the output file alike. The lowering turns a number into STR$ text first.
;
;   __LOCO_WRITES   HL = a string (0 empty), A = non-zero when it is a temporary to free:
;                   `"`, the characters, `"`.
;   __LOCO_WRITEN   HL = the STR$ text of a number (a new string, freed here): the characters
;                   without a leading space.
;   __LOCO_WRITEC   the comma between two items.
; Clobbers AF, BC, DE, HL (+ the gate). No firmware entry of its own.
; -----------------------------------------------------------------------

#include once <loco/txt.asm>
#include once <loco/txtout.asm>
#include once <mem/free.asm>

    push namespace core

__LOCO_WRITEC:
    ld   a, ','
    jp   __LOCO_PUTC

__LOCO_WRITES:
    push af
    push hl
    ld   a, '"'
    call __LOCO_PUTC
    pop  hl
    push hl
    call __WR_TEXT
    ld   a, '"'
    call __LOCO_PUTC
    pop  hl
    pop  af
    or   a
    ret  z
    ld   a, h
    or   l
    ret  z
    jp   __MEM_FREE

__LOCO_WRITEN:
    push hl
    call __WR_TEXT_NOSPACE
    pop  hl
    ld   a, h
    or   l
    ret  z
    jp   __MEM_FREE

__WR_TEXT_NOSPACE:          ; HL = a string: its characters, but a leading space
    ld   a, h
    or   l
    ret  z
    ld   c, (hl)
    inc  hl
    ld   b, (hl)
    inc  hl
    ld   a, b
    or   c
    ret  z
    ld   a, (hl)
    cp   ' '
    jr   nz, __WR_LOOP
    inc  hl
    dec  bc
    jr   __WR_LOOP

__WR_TEXT:                  ; HL = a string (0 empty): its characters
    ld   a, h
    or   l
    ret  z
    ld   c, (hl)
    inc  hl
    ld   b, (hl)
    inc  hl
__WR_LOOP:
    ld   a, b
    or   c
    ret  z
    ld   a, (hl)
    inc  hl
    push hl
    push bc
    call __LOCO_PUTC
    pop  bc
    pop  hl
    dec  bc
    jr   __WR_LOOP

    pop namespace
