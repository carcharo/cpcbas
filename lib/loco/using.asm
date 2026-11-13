; -----------------------------------------------------------------------
; lib/loco/using.asm -- Locomotive text layer: PRINT USING
;
; Written from scratch for this project (MIT, see lib/LICENSE).
;
; PRINT USING format$; item [; item ...] is a call of __LOCO_USING with the
; format, one call per item (__LOCO_USINGN for a number, __LOCO_USINGS for a
; string, in order) and __LOCO_USINGE at the end; the line end and a
; trailing `;` or `,` are PRINT's. The behaviour is the interpreter's
;:
;
;  - An item takes the next field of the format: the literal text before it
;    is printed, then the field, then the literal text up to the next field
;    (or the end of the format, where the format starts again for the next
;    item). So "# and #" with one item prints "5 and ", and "[#]" with two
;    prints "[5][6]". A format with no field at all prints its text and then
;    is error 5; a number for a string field and a string for a numeric field
;    is error 13 (the literal text before the field is printed first).
;  - A numeric field is [+] [** [$|pound] | $$ | pound pound] {# | ,} [. {#}]
;    [^^^^] [+ | -], with at least one # or a prefix; the number is printed by
;    DEC$'s code (strfmt.asm), so the rounding, the `%` of a number that does
;    not fit and the widths are DEC$'s. A + before a field not followed by a
;    digit position, a comma with nothing before it, a lone $ or *, fewer than
;    four ^ and a ^ run of more than four are literal text.
;  - A string field is `!` (the first character, a space for the empty
;    string), `&` (the whole string) or a backslash, n spaces and a backslash
;    (n + 2 characters, cut or padded with spaces on the right). An underscore
;    makes the next character literal. Anything else is literal text.
;  - The output goes through __LOCO_PUTC, one byte at a time, with no
;    "does it fit on the line" test (the interpreter has none for USING).
;
; Entry points (namespace core; all clobber every register):
;
;   __LOCO_USING    HL = format (a string, 0 = empty), A = non-zero when it is
;                   a temporary the routine frees at __LOCO_USINGE.
;   __LOCO_USINGN   A E D C B = the REAL (as `fparam f`): the next number.
;   __LOCO_USINGS   HL = the string (0 = empty), A = non-zero when it is a
;                   temporary the routine frees.
;   __LOCO_USINGE   the end of the statement.
; -----------------------------------------------------------------------

#include once <error.asm>
#include once <mem/free.asm>
#include once <loco/txt.asm>
#include once <loco/txtout.asm>
#include once <loco/print.asm>
#include once <loco/strfmt.asm>

    push namespace core

__UF_FMT:   DEFW 0          ; the format string
__UF_FREE:  DEFB 0          ; the format is a temporary
__UF_POS:   DEFB 0          ; offset of the next unread byte of the format
__UF_LEN:   DEFB 0          ; the format's length
__UF_WANT:  DEFB 0          ; 1 a number is being printed, 2 a string
__UF_VAL:   DEFS 5          ; the number
__UF_STR:   DEFW 0          ; the string
__UF_SFREE: DEFB 0          ; the string is a temporary
__UF_FLEN:  DEFB 0          ; the length of the field being printed
__UF_FBUF:  DEFS 202        ; a numeric field as DEC$'s format: length word, bytes

__LOCO_USING:
    ld   (__UF_FMT), hl
    ld   (__UF_FREE), a
    xor  a
    ld   (__UF_POS), a
    ld   (__UF_LEN), a
    ld   a, h
    or   l
    ret  z                  ; the empty string: no field
    ld   a, (hl)
    ld   (__UF_LEN), a
    inc  hl
    ld   a, (hl)
    or   a
    ret  z
    ld   a, 255             ; longer than a string can be: the first 255
    ld   (__UF_LEN), a
    ret

__LOCO_USINGN:
    ld   (__UF_VAL), a
    ld   (__UF_VAL + 1), de
    ld   (__UF_VAL + 3), bc
    ld   a, 1
    jr   __UF_ITEM

__LOCO_USINGS:
    ld   (__UF_STR), hl
    ld   (__UF_SFREE), a
    ld   a, 2

__UF_ITEM:
    ld   (__UF_WANT), a
    call __UF_LITS          ; the text before the field
    or   a
    jp   z, __UF_NOFIELD
    ld   b, a
    ld   a, c
    ld   (__UF_FLEN), a
    ld   a, (__UF_WANT)
    cp   b
    jp   nz, __UF_TYPE
    ld   a, b
    cp   1
    jr   nz, __UF_STRFIELD
    ; ---- a number: the field is DEC$'s format
    ld   a, c
    cp   201
    jp   nc, __UF_NOFIELD   ; DEC$'s limit: error 5
    call __UF_FIELDPTR      ; HL = the field in the format
    ld   de, __UF_FBUF
    ld   a, c
    ld   (de), a
    inc  de
    xor  a
    ld   (de), a
    inc  de
    ld   b, 0
    ldir
    ld   a, (__UF_VAL)
    ld   de, (__UF_VAL + 1)
    ld   bc, (__UF_VAL + 3)
    push bc
    push de
    push af
    ld   hl, __UF_FBUF
    xor  a
    call __LOCO_DEC
    ld   a, h
    or   l
    jr   z, __UF_AFTER      ; the heap was full: nothing to print
    push hl
    ld   c, (hl)
    inc  hl
    ld   b, (hl)
    inc  hl
    call __LOCO_PUTS
    pop  hl
    call __MEM_FREE
    jr   __UF_AFTER

__UF_STRFIELD:
    call __UF_FIELDPTR
    ld   a, (hl)
    ld   d, a               ; D = the field's first character
    ld   a, (__UF_FLEN)
    ld   e, a               ; E = its length
    ld   hl, (__UF_STR)
    ld   bc, 0              ; BC = the string's length
    ld   a, h
    or   l
    jr   z, __UF_HAVELEN
    ld   c, (hl)
    inc  hl
    ld   b, (hl)
    inc  hl                 ; HL = the bytes
__UF_HAVELEN:
    ld   a, d
    cp   '&'
    jr   z, __UF_PUTALL
    cp   '!'
    jr   z, __UF_BANG
    ld   a, b               ; a backslash field of E characters, cut or padded
    or   a
    jr   nz, __UF_CUT       ; 256 or more: longer than the field
    ld   a, c
    cp   e
    jr   c, __UF_PAD
__UF_CUT:
    ld   c, e
    ld   b, 0
    call __UF_PUTBYTES
    jr   __UF_STRDONE
__UF_PAD:                   ; A = the length: the bytes, then E - A spaces
    push af
    ld   b, 0
    ld   c, a
    call __UF_PUTBYTES
    pop  af
    ld   b, a
    ld   a, e
    sub  b
    call __UF_SPACES
    jr   __UF_STRDONE
__UF_BANG:
    ld   a, b
    or   c
    jr   nz, __UF_FIRST
    ld   a, ' '
    call __LOCO_PUTC
    jr   __UF_STRDONE
__UF_FIRST:
    ld   bc, 1
__UF_PUTALL:
    call __UF_PUTBYTES
__UF_STRDONE:
    ld   a, (__UF_SFREE)
    or   a
    jr   z, __UF_AFTER
    ld   hl, (__UF_STR)
    ld   a, h
    or   l
    call nz, __MEM_FREE
__UF_AFTER:                 ; past the field, and the text up to the next one
    ld   a, (__UF_FLEN)
    ld   c, a
    ld   a, (__UF_POS)
    add  a, c
    ld   (__UF_POS), a
    call __UF_LITS
    or   a
    ret  nz                 ; stopped at a field
    xor  a
    ld   (__UF_POS), a      ; the end of the format: it starts again
    ret

__UF_NOFIELD:
    ld   a, 5
    jp   __ERROR
__UF_TYPE:
    ld   a, 13
    jp   __ERROR

__LOCO_USINGE:
    ld   a, (__UF_FREE)
    or   a
    ret  z
    ld   hl, (__UF_FMT)
    ld   a, h
    or   l
    ret  z
    xor  a
    ld   (__UF_FREE), a
    jp   __MEM_FREE

; __UF_FIELDPTR: HL = the format's byte at the position.
__UF_FIELDPTR:
    ld   hl, (__UF_FMT)
    inc  hl
    inc  hl
    ld   a, (__UF_POS)
    ld   e, a
    ld   d, 0
    add  hl, de
    ret

; __UF_PUTBYTES: HL = bytes, BC = count: the first BC of them. __UF_SPACES: A = count.
__UF_PUTBYTES:
    ld   a, b
    or   c
    ret  z
    jp   __LOCO_PUTS
__UF_SPACES:
    or   a
    ret  z
    ld   b, a
__UF_SPL:
    ld   a, ' '
    call __LOCO_PUTC
    djnz __UF_SPL
    ret

; __UF_LITS: prints the literal text from the position on, to the next field
; or the end of the format. Exit: A = 0 at the end; else A = 1 (a number
; field) or 2 (a string field), C = its length, the position at its first byte.
__UF_LITS:
    PROC
    LOCAL __UL_LOOP, __UL_ESC, __UL_LIT
__UL_LOOP:
    ld   a, (__UF_POS)
    ld   b, a
    ld   a, (__UF_LEN)
    sub  b
    jr   nz, __UL_MORE
    ret                     ; the end: A = 0
__UL_MORE:
    ld   c, a               ; C = the bytes left
    call __UF_FIELDPTR
    ld   a, (hl)
    cp   '_'
    jr   z, __UL_ESC
    call __UF_CLASS
    or   a
    ret  nz
__UL_LIT:
    call __UF_FIELDPTR
    ld   a, (hl)
    call __LOCO_PUTC
    ld   hl, __UF_POS
    inc  (hl)
    jr   __UL_LOOP
__UL_ESC:                   ; _x prints x (a lone _ at the end prints itself)
    ld   a, c
    cp   2
    jr   c, __UL_LIT
    inc  hl
    ld   a, (hl)
    call __LOCO_PUTC
    ld   hl, __UF_POS
    inc  (hl)
    inc  (hl)
    jr   __UL_LOOP
    ENDP

; __UF_CLASS: HL = a byte of the format, C = the bytes from there to the end.
; Exit: A = 0 for a literal; 1 a numeric field; 2 a string field, with C = its
; length. Clobbers B, DE, HL.
__UF_PEEK:                  ; A = the next byte, 0 at the end (a NUL reads as 1)
    ld   a, b
    or   a
    ret  z
    ld   a, (hl)
    or   a
    ret  nz
    inc  a
    ret
__UF_ADV:
    inc  hl
    dec  b
    ret
__UF_PEEK2:                 ; A = the byte after the next, 0 when there is none
    ld   a, b
    cp   2
    jr   nc, __UP2_HAVE
    xor  a
    ret
__UP2_HAVE:
    inc  hl
    ld   a, (hl)
    dec  hl
    or   a
    ret  nz
    inc  a
    ret
__UF_ISCUR:                 ; Z when A is $ or the pound sign (163)
    cp   '$'
    ret  z
    cp   163
    ret

__UF_CLASS:
    PROC
    LOCAL __UC_PFX, __UC_P2, __UC_DIG, __UC_DLOOP, __UC_HASH, __UC_DEND, __UC_PT, __UC_NOPT
    LOCAL __UC_EXP, __UC_CHK, __UC_NOCHK, __UC_TRL, __UC_TR1, __UC_DONE, __UC_LIT, __UC_ONE, __UC_BSL
    LOCAL __UC_BSP, __UC_BSD
    push hl                 ; the start, for the length
    ld   b, c               ; B = the bytes left
    ld   a, (hl)
    cp   '!'
    jp   z, __UC_ONE
    cp   '&'
    jp   z, __UC_ONE
    cp   92                 ; the backslash
    jp   z, __UC_BSL
    ld   d, 0               ; D = the digit positions (prefix characters count)
    ld   e, 0               ; E = a leading + was taken
    cp   '+'
    jr   nz, __UC_PFX
    inc  e
    call __UF_ADV
__UC_PFX:
    call __UF_PEEK
    cp   '*'
    jr   nz, __UC_P2
    call __UF_PEEK2
    cp   '*'
    jr   nz, __UC_DIG       ; a lone *: no prefix
    call __UF_ADV
    call __UF_ADV
    ld   d, 2
    call __UF_PEEK
    call __UF_ISCUR
    jr   nz, __UC_DIG
    call __UF_ADV
    inc  d
    jr   __UC_DIG
__UC_P2:
    call __UF_ISCUR
    jr   nz, __UC_DIG
    ld   c, a
    call __UF_PEEK2
    cp   c
    jr   nz, __UC_DIG       ; a lone $: literal
    call __UF_ADV
    call __UF_ADV
    ld   d, 2
__UC_DIG:
__UC_DLOOP:
    call __UF_PEEK
    cp   '#'
    jr   z, __UC_HASH
    cp   ','
    jr   nz, __UC_DEND
    ld   a, d
    or   a
    jr   z, __UC_DEND       ; a comma needs a digit or a prefix before it
    call __UF_ADV
    jr   __UC_DLOOP
__UC_HASH:
    inc  d
    call __UF_ADV
    jr   __UC_DLOOP
__UC_DEND:
    call __UF_PEEK
    cp   '.'
    jr   nz, __UC_NOPT
    call __UF_ADV
__UC_PT:
    call __UF_PEEK
    cp   '#'
    jr   nz, __UC_NOPT
    inc  d
    call __UF_ADV
    jr   __UC_PT
__UC_NOPT:
    ld   a, d
    or   a
    jr   z, __UC_LIT        ; no digit position: not a field
    call __UF_PEEK
    cp   '^'
    jr   nz, __UC_TRL
    ld   a, b
    cp   4
    jr   c, __UC_TRL
    push hl
    ld   c, 4
__UC_CHK:
    ld   a, (hl)
    cp   '^'
    jr   nz, __UC_NOCHK
    inc  hl
    dec  c
    jr   nz, __UC_CHK
    pop  hl                 ; exactly four: part of the field
    ld   c, 4
__UC_EXP:
    call __UF_ADV
    dec  c
    jr   nz, __UC_EXP
    jr   __UC_TRL
__UC_NOCHK:
    pop  hl
__UC_TRL:
    ld   a, e
    or   a
    jr   nz, __UC_DONE      ; a leading + and no trailing sign
    call __UF_PEEK
    cp   '+'
    jr   z, __UC_TR1
    cp   '-'
    jr   nz, __UC_DONE
__UC_TR1:
    call __UF_ADV
__UC_DONE:
    pop  de                 ; the start
    or   a
    sbc  hl, de
    ld   c, l
    ld   a, 1
    ret
__UC_LIT:
    pop  hl
    xor  a
    ret
__UC_ONE:
    pop  hl
    ld   c, 1
    ld   a, 2
    ret
__UC_BSL:                   ; a backslash field: spaces, then the closing backslash
    call __UF_ADV
__UC_BSP:
    call __UF_PEEK
    cp   ' '
    jr   nz, __UC_BSD
    call __UF_ADV
    jr   __UC_BSP
__UC_BSD:
    cp   92                 ; the backslash
    jr   nz, __UC_LIT
    call __UF_ADV
    pop  de
    or   a
    sbc  hl, de
    ld   c, l
    ld   a, 2
    ret
    ENDP

    pop namespace
