; -----------------------------------------------------------------------
; lib/loco/strfmt.asm -- Locomotive string formatting: HEX$, BIN$, DEC$ and
; the MID$ statement
;
; Written from scratch for this project (MIT, see lib/LICENSE). Built on the
; imported runtime's heap (mem/alloc.asm, mem/free.asm) and on real.asm's
; digit generator (__LOCO_FMTDIG) for DEC$. The behaviour is what the real
; interpreter does ("HEX$, BIN$, DEC$ and the
; MID$ statement"; probes p-strfmt.bas and p-dec.bas), not what the manual
; alone says.
;
; Strings are a length word followed by the bytes; the pointer 0 is the empty
; string. Every result is a new heap string owned by the caller (0 when the
; heap is full).
;
; Entry points (namespace core). "Clobbers" lists registers changed; the
; stack is balanced. No firmware entry.
;
;   __LOCO_HEX      stack: n, w (both 16-bit; n is taken as unsigned, so -1 is
;   __LOCO_BIN      FFFF; w is the minimum width). Exit: HL = the digits,
;                   upper case, at least one digit, padded with zeros on the
;                   left to w. w outside 0..16 is error 5. Clobbers AF, BC,
;                   DE, HL.
;
;   __LOCO_MIDSET   MID$(a$, p, n) = b$ : HL = a$ (the string itself, changed
;                   in place: never longer or shorter); stack: p, n, b$ (a
;                   pointer, borrowed).
;   __LOCO_MIDSETF  the same, with b$ a temporary the routine frees.
;   __LOCO_MIDSET2  MID$(a$, p) = b$ : the same without n on the stack.
;   __LOCO_MIDSET2F the same, with b$ a temporary the routine frees.
;                   p outside 1..255 and n outside 0..255 are error 5. A p past
;                   the end of a$, n = 0 and an empty b$ change nothing (no
;                   error: BASIC 1.1). The replacement is min(n, LEN(b$), what
;                   is left of a$) bytes, copied forward, so MID$(a$,2,2)=a$ on
;                   "HELLO" gives "HHHLO", as the interpreter does. Clobbers AF,
;                   BC, DE, HL.
;
;   __LOCO_DEC      DEC$(n, f$) : HL = f$, A = non-zero when f$ is a temporary
;                   the routine frees; stack: n (a REAL, as `param f`). Exit:
;                   HL = the text. The format is the PRINT USING numeric
;                   format restricted to  + - $ (the pound sign, byte 163) * # , . ^
;                   as the manual's DEC$ page says:
;                     [+] [** | **$ | $$ | **£ | ££] {# | ,} [. {#}] [^^^^] [+ | -]
;                   with at least one # or a prefix; anything else is error 5.
;                   The text is as wide as the format (every character counts
;                   one), padded on the left with spaces (or `*` after `**`);
;                   a number that does not fit is preceded by `%` and is as
;                   wide as it needs. The value is rounded to 9 significant
;                   digits (as the interpreter's own number text), then half
;                   up to the decimals asked for. A value of 1E+20 or more is
;                   `%` and the number text (STR$). Format at most 200 long.
;                   Clobbers AF, BC, DE, HL, and real.asm's buffers.

#include once <mem/alloc.asm>
#include once <mem/free.asm>
#include once <error.asm>
#include once <loco/real.asm>

    push namespace core

__SF_BAD:                   ; Improper argument
    ld   a, 5
    jp   __ERROR

; ---- HEX$, BIN$ ------------------------------------------------------------
__LOCO_HEX:
    ld   c, 0Fh
    jr   __SF_RADIX
__LOCO_BIN:
    ld   c, 1
__SF_RADIX:                 ; C = the digit mask (0F or 01); stack: n, w
    pop  hl                 ; return address
    pop  de                 ; DE = w
    ex   (sp), hl           ; HL = n, the return address back in place
    ld   a, d
    or   a
    jp   nz, __SF_BAD
    ld   a, e
    cp   17
    jp   nc, __SF_BAD
    ld   b, a               ; B = w
    push hl
    ld   d, 0               ; D = the digits n needs (at least one)
__SF_CNT:
    inc  d
    ld   a, c
__SF_CSH:
    srl  h
    rr   l
    srl  a
    jr   nz, __SF_CSH
    ld   a, h
    or   l
    jr   nz, __SF_CNT
    pop  hl                 ; HL = n
    ld   a, d
    cp   b
    jr   nc, __SF_LEN
    ld   a, b
__SF_LEN:
    ld   b, a               ; B = the length of the text
    push hl
    push bc
    ld   c, b
    ld   b, 0
    inc  bc
    inc  bc
    call __MEM_ALLOC
    pop  bc                 ; B = length, C = mask
    pop  de                 ; DE = n
    ld   a, h
    or   l
    ret  z                  ; heap full
    push hl
    ld   (hl), b
    inc  hl
    ld   (hl), 0
    inc  hl
    ld   a, l
    add  a, b
    ld   l, a
    jr   nc, __SF_NC
    inc  h
__SF_NC:                    ; HL = one past the last digit
    ex   de, hl             ; HL = n, DE = the end
__SF_FILL:
    dec  de
    ld   a, l
    and  c
    cp   10
    jr   c, __SF_DIG
    add  a, 7
__SF_DIG:
    add  a, '0'
    ld   (de), a
    ld   a, c
__SF_FSH:
    srl  h
    rr   l
    srl  a
    jr   nz, __SF_FSH
    djnz __SF_FILL
    pop  hl
    ret

; ---- the MID$ statement ----------------------------------------------------
__SM_A:     DEFW 0          ; a$ (pointer)
__SM_B:     DEFW 0          ; b$ (pointer)
__SM_N:     DEFW 0          ; the count limit (0FFFFh: to the end)
__SM_DST:   DEFW 0
__SM_RET:   DEFW 0
__SM_FREE:  DEFB 0

__LOCO_MIDSET2:             ; HL = a$; stack: p, b$ (borrowed)
    xor  a
    jr   __SM_E2
__LOCO_MIDSET2F:            ; the same, b$ is a temporary the routine frees
    ld   a, 1
__SM_E2:
    ld   (__SM_FREE), a
    ld   (__SM_A), hl
    pop  hl
    ld   (__SM_RET), hl
    pop  hl
    ld   (__SM_B), hl
    pop  bc                 ; p
    ld   hl, 0FFFFh
    ld   (__SM_N), hl
    jr   __SM_GO

__LOCO_MIDSET:              ; HL = a$; stack: p, n, b$ (borrowed)
    xor  a
    jr   __SM_E3
__LOCO_MIDSETF:             ; the same, b$ is a temporary the routine frees
    ld   a, 1
__SM_E3:
    ld   (__SM_FREE), a
    ld   (__SM_A), hl
    pop  hl
    ld   (__SM_RET), hl
    pop  hl
    ld   (__SM_B), hl
    pop  de                 ; n
    pop  bc                 ; p
    ld   a, d
    or   a
    jp   nz, __SF_BAD       ; n outside 0..255
    ld   (__SM_N), de
__SM_GO:                    ; BC = p
    ld   a, b
    or   a
    jp   nz, __SF_BAD       ; p outside 1..255
    ld   a, c
    or   a
    jp   z, __SF_BAD
    ld   hl, (__SM_A)
    ld   a, h
    or   l
    jr   z, __SM_END        ; a$ is empty
    ld   e, (hl)
    inc  hl
    ld   d, (hl)
    inc  hl                 ; DE = LEN(a$), HL = its text
    ex   de, hl             ; HL = LEN, DE = text
    dec  bc                 ; BC = p - 1
    or   a
    sbc  hl, bc             ; HL = what is left from p on
    jr   c, __SM_END
    jr   z, __SM_END        ; p past the end: nothing changes
    ex   de, hl             ; HL = text, DE = what is left
    add  hl, bc
    ld   (__SM_DST), hl
    ld   hl, (__SM_N)
    call __SM_MIN           ; DE = min(left, n)
    ld   hl, (__SM_B)
    ld   a, h
    or   l
    jr   z, __SM_END        ; b$ is empty
    ld   c, (hl)
    inc  hl
    ld   b, (hl)
    inc  hl                 ; BC = LEN(b$), HL = its text
    push hl
    ld   h, b
    ld   l, c
    call __SM_MIN           ; DE = the count
    pop  hl                 ; source
    ld   b, d
    ld   c, e
    ld   a, b
    or   c
    jr   z, __SM_END
    ld   de, (__SM_DST)
    ldir                    ; forward, like the interpreter (overlap included)
__SM_END:
    ld   a, (__SM_FREE)
    or   a
    jr   z, __SM_RETURN
    ld   hl, (__SM_B)
    call __MEM_FREE
__SM_RETURN:
    ld   hl, (__SM_RET)
    jp   (hl)

__SM_MIN:                   ; DE = min(HL, DE), unsigned. Clobbers HL, AF
    or   a
    sbc  hl, de
    add  hl, de             ; carry set when HL < DE
    ret  nc
    ex   de, hl
    ret

; ---- DEC$ ------------------------------------------------------------------
; Work area. __SD_STATE .. __SD_STATE_END is cleared at each call.
__SD_VAL:       DEFS 5      ; the value, Locomotive's layout (A E D C B)
__SD_FMT:       DEFW 0
__SD_FFLAG:     DEFB 0
__SD_RET:       DEFW 0
__SD_RES:       DEFW 0
__SD_STATE:
__SD_V_W:       DEFB 0      ; the width of the format
__SD_V_LPLUS:   DEFB 0      ; leading +
__SD_V_CUR:     DEFB 0      ; currency character, 0 for none
__SD_V_STARS:   DEFB 0      ; ** fill
__SD_V_COMMA:   DEFB 0      ; a comma in the integer field
__SD_V_NHI:     DEFB 0      ; # in the integer field
__SD_V_NPFX:    DEFB 0      ; characters of the prefix (** $$ **$)
__SD_V_HASPT:   DEFB 0      ; a decimal point
__SD_V_DEC:     DEFB 0      ; # after the point
__SD_V_EXP:     DEFB 0      ; ^^^^
__SD_V_TRC:     DEFB 0      ; trailing sign: '+', '-' or 0
__SD_V_NEG:     DEFB 0
__SD_V_ZERO:    DEFB 0
__SD_V_PCT:     DEFB 0      ; force the % form
__SD_V_OVF:     DEFB 0
__SD_V_LZ:      DEFB 0      ; the integer part is only a zero that may be dropped
__SD_V_K:       DEFB 0      ; integer digits of the mantissa (exponent form)
__SD_V_NI:      DEFB 0      ; integer digits written
__SD_V_NC:      DEFB 0      ; commas written
__SD_V_M3:      DEFB 0
__SD_V_CORE:    DEFB 0
__SD_V_TOT:     DEFB 0
__SD_V_X:       DEFB 0      ; decimal exponent of the first digit (signed)
__SD_V_E:       DEFB 0      ; printed exponent (signed)
__SD_V_BODY:    DEFB 0
__SD_V_SRC:     DEFW 0
__SD_V_N:       DEFB 0
__SD_STATE_END:
__SD_V_D:       DEFS 10     ; the digits, ASCII (9 + a spare)

__LOCO_DEC:                 ; HL = f$, A = free flag; stack: n (REAL)
    ld   (__SD_FFLAG), a
    ld   (__SD_FMT), hl
    pop  hl
    ld   (__SD_RET), hl
    pop  af
    pop  de
    pop  bc
    ld   (__SD_VAL), a
    ld   (__SD_VAL + 1), de
    ld   (__SD_VAL + 3), bc
    call __SD_BUILD
    ld   (__SD_RES), hl
    ld   a, (__SD_FFLAG)
    or   a
    jr   z, __SD_RETURN
    ld   hl, (__SD_FMT)
    call __MEM_FREE
__SD_RETURN:
    ld   hl, (__SD_RET)
    push hl
    ld   hl, (__SD_RES)
    ret

__SD_BAD:
    ld   a, 5
    jp   __ERROR

__SD_PEEK:                  ; HL = text, B = characters left. A = the next one, 0 at the end (a NUL reads as 1)
    ld   a, b
    or   a
    ret  z
    ld   a, (hl)
    or   a
    ret  nz
    inc  a
    ret

__SD_ADV:
    inc  hl
    dec  b
    ret

__SD_ISCUR:                 ; Z when A is a currency character ($ or the pound sign); A kept
    cp   '$'
    ret  z
    cp   163
    ret

__SD_PUT:                   ; the byte A goes before the output pointer DE
    dec  de
    ld   (de), a
    ret

__SD_DIGAT:                 ; HL = index (signed) into the digits -> A = that digit, '0' outside 0..8. Clobbers HL
    bit  7, h
    jr   nz, __SD_DZ
    ld   a, h
    or   a
    jr   nz, __SD_DZ
    ld   a, l
    cp   9
    jr   nc, __SD_DZ
    push de
    ld   de, __SD_V_D
    add  hl, de
    ld   a, (hl)
    pop  de
    ret
__SD_DZ:
    ld   a, '0'
    ret

__SD_XHL:                   ; HL = X (the signed decimal exponent)
    ld   a, (__SD_V_X)
    ld   l, a
    rla
    sbc  a, a
    ld   h, a
    ret

__SD_BUILD:                 ; -> HL = the text (a new heap string), 0 when the heap is full
    ld   hl, __SD_STATE
    ld   de, __SD_STATE + 1
    ld   bc, __SD_STATE_END - __SD_STATE - 1
    ld   (hl), 0
    ldir
    ld   hl, (__SD_FMT)
    ld   a, h
    or   l
    jp   z, __SD_BAD
    ld   c, (hl)
    inc  hl
    ld   b, (hl)
    inc  hl
    ld   a, b
    or   a
    jp   nz, __SD_BAD       ; longer than 255
    ld   a, c
    or   a
    jp   z, __SD_BAD
    cp   201
    jp   nc, __SD_BAD
    ld   (__SD_V_W), a
    ld   b, a               ; B = characters left, HL = the next
    ; ---- the format
    call __SD_PEEK
    cp   '+'
    jr   nz, __SD_P1
    ld   a, 1
    ld   (__SD_V_LPLUS), a
    call __SD_ADV
__SD_P1:
    call __SD_PEEK
    cp   '*'
    jr   nz, __SD_P2
    call __SD_ADV
    call __SD_PEEK
    cp   '*'
    jp   nz, __SD_BAD
    call __SD_ADV
    ld   a, 1
    ld   (__SD_V_STARS), a
    ld   a, 2
    ld   (__SD_V_NPFX), a
    call __SD_PEEK
    call __SD_ISCUR
    jr   nz, __SD_DIG
    ld   (__SD_V_CUR), a
    ld   a, 3
    ld   (__SD_V_NPFX), a
    call __SD_ADV
    jr   __SD_DIG
__SD_P2:
    call __SD_ISCUR
    jr   nz, __SD_DIG
    ld   c, a
    call __SD_ADV
    call __SD_PEEK
    cp   c
    jp   nz, __SD_BAD
    call __SD_ADV
    ld   a, c
    ld   (__SD_V_CUR), a
    ld   a, 2
    ld   (__SD_V_NPFX), a
__SD_DIG:
    call __SD_PEEK
    cp   '#'
    jr   z, __SD_HASH
    cp   ','
    jr   nz, __SD_DEND
    ld   a, (__SD_V_NHI)
    ld   c, a
    ld   a, (__SD_V_NPFX)
    or   c
    jp   z, __SD_BAD        ; a comma needs a digit or a prefix before it
    ld   a, 1
    ld   (__SD_V_COMMA), a
    call __SD_ADV
    jr   __SD_DIG
__SD_HASH:
    ld   a, (__SD_V_NHI)
    inc  a
    ld   (__SD_V_NHI), a
    call __SD_ADV
    jr   __SD_DIG
__SD_DEND:
    cp   '.'
    jr   nz, __SD_NOPT
    ld   a, 1
    ld   (__SD_V_HASPT), a
    call __SD_ADV
__SD_DCL:
    call __SD_PEEK
    cp   '#'
    jr   nz, __SD_NOPT
    ld   a, (__SD_V_DEC)
    inc  a
    ld   (__SD_V_DEC), a
    call __SD_ADV
    jr   __SD_DCL
__SD_NOPT:
    ld   a, (__SD_V_NHI)
    ld   c, a
    ld   a, (__SD_V_DEC)
    or   c
    ld   c, a
    ld   a, (__SD_V_NPFX)
    or   c
    jp   z, __SD_BAD        ; no digit position at all
    call __SD_PEEK
    cp   '^'
    jr   nz, __SD_TRL
    ld   c, 4
__SD_EXP4:
    call __SD_PEEK
    cp   '^'
    jp   nz, __SD_BAD       ; exactly four
    call __SD_ADV
    dec  c
    jr   nz, __SD_EXP4
    ld   a, 1
    ld   (__SD_V_EXP), a
__SD_TRL:
    call __SD_PEEK
    cp   '+'
    jr   z, __SD_TR1
    cp   '-'
    jr   nz, __SD_FIN
__SD_TR1:
    ld   c, a
    ld   a, (__SD_V_LPLUS)
    or   a
    jp   nz, __SD_BAD       ; a leading and a trailing sign
    ld   a, c
    ld   (__SD_V_TRC), a
    call __SD_ADV
__SD_FIN:
    call __SD_PEEK
    or   a
    jp   nz, __SD_BAD       ; anything else
    ; ---- the exponent form: integer digits of the mantissa
    ld   a, (__SD_V_EXP)
    or   a
    jr   z, __SD_VALUE
    ld   a, (__SD_V_NHI)
    ld   c, a
    ld   a, (__SD_V_NPFX)
    add  a, c               ; positions in the integer field
    ld   c, a
    ld   a, (__SD_V_LPLUS)
    ld   b, a
    ld   a, (__SD_V_TRC)
    or   b
    ld   a, c
    jr   nz, __SD_KSET      ; an explicit sign: every position is a digit
    or   a
    jr   z, __SD_KSET
    dec  a                  ; else one position is the sign's
__SD_KSET:
    ld   (__SD_V_K), a
    ld   b, a
    ld   a, (__SD_V_DEC)
    or   b
    jr   nz, __SD_VALUE
    ld   a, 1               ; no digit at all: one, and the text overflows (measured)
    ld   (__SD_V_K), a
    ld   (__SD_V_PCT), a
    ; ---- the value
__SD_VALUE:
    ld   a, (__SD_VAL + 4)  ; the exponent byte: 0 is zero
    or   a
    jr   nz, __SD_NZ
    call __SD_SETZERO
    jp   __SD_LAYOUT
__SD_NZ:
    ld   a, (__SD_VAL)
    ld   de, (__SD_VAL + 1)
    ld   bc, (__SD_VAL + 3)
    call __LOCO_FMTDIG
    ld   hl, __RF_DIG
    ld   de, __SD_V_D
    ld   bc, 9
    ldir
    ld   a, (__RF_X)
    ld   (__SD_V_X), a
    ld   a, (__RF_SIGN)
    cp   '-'
    jr   nz, __SD_POS
    ld   a, 1
    ld   (__SD_V_NEG), a
__SD_POS:
    ld   a, (__SD_V_EXP)
    or   a
    jr   nz, __SD_ROUNDX
    ld   a, (__SD_V_X)      ; 1E+20 and more: % and the number text
    bit  7, a
    jr   nz, __SD_ROUNDF
    cp   20
    jp   nc, __SD_HUGE
__SD_ROUNDF:                ; nkeep = X + decimals + 1
    call __SD_XHL
    ld   a, (__SD_V_DEC)
    ld   e, a
    ld   d, 0
    add  hl, de
    inc  hl
    jr   __SD_ROUND
__SD_ROUNDX:                ; nkeep = k + decimals
    ld   a, (__SD_V_K)
    ld   hl, __SD_V_DEC
    add  a, (hl)
    ld   l, a
    ld   h, 0
; ---- round the digits to HL (signed) of them, half up
__SD_ROUND:
    bit  7, h
    jr   nz, __SD_RZERO
    ld   a, h
    or   l
    jr   z, __SD_RHALF
    ld   a, h
    or   a
    jp   nz, __SD_LAYOUT
    ld   a, l
    cp   9
    jp   nc, __SD_LAYOUT
    ld   e, a
    ld   d, 0
    ld   hl, __SD_V_D
    add  hl, de
    ld   a, (hl)
    cp   '5'
    jp   c, __SD_LAYOUT
    dec  hl
    ld   b, e
__SD_RINC:
    ld   a, (hl)
    inc  a
    cp   '9' + 1
    jr   nz, __SD_RDONE
    ld   (hl), '0'
    dec  hl
    djnz __SD_RINC
    call __SD_SETONE
    jp   __SD_LAYOUT
__SD_RDONE:
    ld   (hl), a
    jp   __SD_LAYOUT
__SD_RHALF:                 ; the first digit is just below the last place
    ld   a, (__SD_V_D)
    cp   '5'
    jr   c, __SD_RZERO
    call __SD_SETONE
    jp   __SD_LAYOUT
__SD_RZERO:
    call __SD_SETZERO
    jp   __SD_LAYOUT

__SD_SETZERO:               ; the value 0: digits 0, no sign
    ld   hl, __SD_V_D
    ld   de, __SD_V_D + 1
    ld   bc, 8
    ld   (hl), '0'
    ldir
    xor  a
    ld   (__SD_V_X), a
    ld   (__SD_V_NEG), a
    inc  a
    ld   (__SD_V_ZERO), a
    ret

__SD_SETONE:                ; the digits 100000000, X = X + 1 (a carry out of the first digit)
    ld   hl, __SD_V_D
    ld   de, __SD_V_D + 1
    ld   bc, 8
    ld   (hl), '0'
    ldir
    ld   a, '1'
    ld   (__SD_V_D), a
    ld   hl, __SD_V_X
    inc  (hl)
    ret

; ---- the number is rounded: lay the text out
__SD_LAYOUT:
    ld   a, (__SD_V_EXP)
    or   a
    jp   nz, __SD_LAYX
    ; fixed: n_i integer digits, commas
    ld   a, (__SD_V_X)
    bit  7, a
    jr   nz, __SD_LNEG
    inc  a
    ld   (__SD_V_NI), a
    ld   a, (__SD_V_ZERO)
    ld   (__SD_V_LZ), a
    jr   __SD_LCOM
__SD_LNEG:
    ld   a, 1
    ld   (__SD_V_NI), a
    ld   (__SD_V_LZ), a
__SD_LCOM:
    ld   a, (__SD_V_COMMA)
    or   a
    jr   z, __SD_LBODY
    ld   a, (__SD_V_NI)
    dec  a
    ld   c, 0
__SD_LC1:
    sub  3
    jr   c, __SD_LC2
    inc  c
    jr   __SD_LC1
__SD_LC2:
    ld   a, c
    ld   (__SD_V_NC), a
__SD_LBODY:                 ; body = n_i + commas + point + decimals
    ld   a, (__SD_V_NI)
    ld   hl, __SD_V_NC
    add  a, (hl)
    ld   b, a
    jr   __SD_LPT
__SD_LAYX:                  ; exponent: mantissa digits, point, decimals, E, sign, two digits
    ld   c, 0
    ld   a, (__SD_V_ZERO)
    or   a
    jr   nz, __SD_LXE
    ld   a, (__SD_V_X)      ; e = X - (k - 1), or X + 1 when k = 0
    ld   c, a
    ld   a, (__SD_V_K)
    or   a
    jr   z, __SD_LX0
    dec  a
    ld   l, a
    ld   a, c
    sub  l
    ld   c, a
    jr   __SD_LXE
__SD_LX0:
    inc  c
__SD_LXE:
    ld   a, c
    ld   (__SD_V_E), a
    ld   a, (__SD_V_K)
    add  a, 4
    ld   b, a
__SD_LPT:
    ld   a, (__SD_V_HASPT)
    or   a
    jr   z, __SD_LCUR
    ld   a, (__SD_V_DEC)
    inc  a
    add  a, b
    ld   b, a
__SD_LCUR:                  ; B = body; add the currency, the sign and the trailing sign
    ld   a, (__SD_V_CUR)
    or   a
    jr   z, __SD_LSGN
    inc  b
__SD_LSGN:
    ld   a, (__SD_V_TRC)
    or   a
    jr   z, __SD_LSG2
    inc  b
    jr   __SD_LFIT
__SD_LSG2:
    ld   a, (__SD_V_NEG)
    ld   c, a
    ld   a, (__SD_V_LPLUS)
    or   c
    jr   z, __SD_LFIT
    inc  b
__SD_LFIT:                  ; B = the core
    ld   a, (__SD_V_PCT)
    or   a
    jr   nz, __SD_LOVF
    ld   a, (__SD_V_W)
    cp   b
    jr   nc, __SD_LOK
    ld   a, (__SD_V_LZ)     ; too wide: a lone leading zero may go
    or   a
    jr   z, __SD_LOVF
    ld   a, (__SD_V_LPLUS)  ; but not before a leading + that is not a minus (measured, BASIC 1.1:
    or   a                  ; DEC$(0.5,"+.##") is "%+0.50", DEC$(-0.5,"+.##") is "-.50")
    jr   z, __SD_LZOK
    ld   a, (__SD_V_NEG)
    or   a
    jr   z, __SD_LOVF
__SD_LZOK:
    ld   a, (__SD_V_HASPT)
    or   a
    jr   z, __SD_LOVF
    ld   a, (__SD_V_EXP)
    or   a
    jr   nz, __SD_LOVF
    dec  b
    xor  a
    ld   (__SD_V_NI), a
    ld   a, (__SD_V_W)
    cp   b
    jr   nc, __SD_LOK
__SD_LOVF:
    ld   a, 1
    ld   (__SD_V_OVF), a
    ld   a, b
    inc  a
    jr   __SD_LALLOC
__SD_LOK:
    ld   a, (__SD_V_W)
__SD_LALLOC:                ; A = the length of the text
    ld   (__SD_V_TOT), a
    ld   a, b
    ld   (__SD_V_CORE), a
    ld   a, (__SD_V_TOT)
    ld   c, a
    ld   b, 0
    inc  bc
    inc  bc
    call __MEM_ALLOC
    ld   a, h
    or   l
    ret  z
    push hl
    ld   a, (__SD_V_TOT)
    ld   (hl), a
    inc  hl
    ld   (hl), 0
    inc  hl
    add  a, l
    ld   e, a
    ld   a, 0
    adc  a, h
    ld   d, a               ; DE = one past the end; the text is written backwards
    ; ---- the trailing sign
    ld   a, (__SD_V_TRC)
    or   a
    jr   z, __SD_WTX
    cp   '+'
    ld   a, (__SD_V_NEG)
    jr   nz, __SD_WTM
    or   a
    ld   a, '+'
    jr   z, __SD_WTP
    ld   a, '-'
    jr   __SD_WTP
__SD_WTM:
    or   a
    ld   a, ' '
    jr   z, __SD_WTP
    ld   a, '-'
__SD_WTP:
    call __SD_PUT
__SD_WTX:
    ld   a, (__SD_V_EXP)
    or   a
    jp   nz, __SD_WEXP
    ; ---- fixed: decimals, point, integer digits with commas
    ld   a, (__SD_V_HASPT)
    or   a
    jr   z, __SD_WINT
    ld   a, (__SD_V_DEC)
    or   a
    jr   z, __SD_WPT
    ld   b, a
__SD_WDEC:                  ; digit j = DEC .. 1 is at index X + j
    call __SD_XHL
    push de
    ld   e, b
    ld   d, 0
    add  hl, de
    pop  de
    call __SD_DIGAT
    call __SD_PUT
    djnz __SD_WDEC
__SD_WPT:
    ld   a, '.'
    call __SD_PUT
__SD_WINT:
    ld   a, (__SD_V_NI)
    or   a
    jp   z, __SD_WTAIL
    ld   b, a
    ld   c, 0               ; C = the place, 0 for the units
    xor  a
    ld   (__SD_V_M3), a
__SD_WIL:
    ld   a, (__SD_V_COMMA)
    or   a
    jr   z, __SD_WNC
    ld   a, (__SD_V_M3)
    cp   3
    jr   nz, __SD_WNC
    ld   a, ','
    call __SD_PUT
    xor  a
    ld   (__SD_V_M3), a
__SD_WNC:                   ; the digit of place C is at index X - C
    call __SD_XHL
    push de
    ld   e, c
    ld   d, 0
    or   a
    sbc  hl, de
    pop  de
    call __SD_DIGAT
    call __SD_PUT
    ld   a, (__SD_V_M3)
    inc  a
    ld   (__SD_V_M3), a
    inc  c
    djnz __SD_WIL
    jp   __SD_WTAIL
; ---- exponent form: E, sign, two digits, decimals, point, integer digits
__SD_WEXP:
    ld   a, (__SD_V_E)
    ld   c, '+'
    bit  7, a
    jr   z, __SD_WE1
    neg
    ld   c, '-'
__SD_WE1:
    ld   b, '0'
__SD_WE2:
    cp   10
    jr   c, __SD_WE3
    sub  10
    inc  b
    jr   __SD_WE2
__SD_WE3:
    add  a, '0'
    call __SD_PUT
    ld   a, b
    call __SD_PUT
    ld   a, c
    call __SD_PUT
    ld   a, 'E'
    call __SD_PUT
    ld   a, (__SD_V_HASPT)
    or   a
    jr   z, __SD_WEI
    ld   a, (__SD_V_DEC)
    or   a
    jr   z, __SD_WEP
    ld   b, a
__SD_WED:                   ; decimal j is mantissa digit k + j - 1
    ld   a, (__SD_V_K)
    add  a, b
    dec  a
    ld   l, a
    ld   h, 0
    call __SD_DIGAT
    call __SD_PUT
    djnz __SD_WED
__SD_WEP:
    ld   a, '.'
    call __SD_PUT
__SD_WEI:
    ld   a, (__SD_V_K)
    or   a
    jp   z, __SD_WTAIL
    ld   b, a
__SD_WEL:                   ; from the right: mantissa digit k-1 .. 0
    ld   l, b
    dec  l
    ld   h, 0
    call __SD_DIGAT
    call __SD_PUT
    djnz __SD_WEL
; ---- currency, sign, fill (or the %)
__SD_WTAIL:
    ld   a, (__SD_V_CUR)
    or   a
    call nz, __SD_PUT
    ld   a, (__SD_V_TRC)
    or   a
    jr   nz, __SD_WFILL
    ld   a, (__SD_V_NEG)
    or   a
    jr   z, __SD_WNN
    ld   a, '-'
    call __SD_PUT
    jr   __SD_WFILL
__SD_WNN:
    ld   a, (__SD_V_LPLUS)
    or   a
    jr   z, __SD_WFILL
    ld   a, '+'
    call __SD_PUT
__SD_WFILL:
    ld   a, (__SD_V_OVF)
    or   a
    jr   z, __SD_WF1
    ld   a, '%'
    call __SD_PUT
    jr   __SD_WDONE
__SD_WF1:
    ld   a, (__SD_V_W)
    ld   hl, __SD_V_CORE
    sub  (hl)
    jr   z, __SD_WDONE
    ld   b, a
    ld   a, (__SD_V_STARS)
    or   a
    ld   a, ' '
    jr   z, __SD_WFL
    ld   a, '*'
__SD_WFL:
    call __SD_PUT
    djnz __SD_WFL
__SD_WDONE:
    pop  hl
    ret

; ---- 1E+20 or more: % and the number text of STR$ (without its sign position's space)
__SD_HUGE:
    ld   a, (__SD_VAL)
    ld   de, (__SD_VAL + 1)
    ld   bc, (__SD_VAL + 3)
    call __LOCO_FMTF        ; HL = text, BC = length
    ld   a, (hl)
    cp   ' '
    jr   nz, __SD_HG1
    inc  hl
    dec  bc
__SD_HG1:
    ld   (__SD_V_SRC), hl
    ld   a, c
    ld   (__SD_V_N), a
    inc  a
    ld   (__SD_V_TOT), a
    ld   c, a
    ld   b, 0
    inc  bc
    inc  bc
    call __MEM_ALLOC
    ld   a, h
    or   l
    ret  z
    push hl
    ld   a, (__SD_V_TOT)
    ld   (hl), a
    inc  hl
    ld   (hl), 0
    inc  hl
    ld   (hl), '%'
    inc  hl
    ex   de, hl
    ld   hl, (__SD_V_SRC)
    ld   a, (__SD_V_N)
    ld   c, a
    ld   b, 0
    ldir
    pop  hl
    ret

    pop namespace
