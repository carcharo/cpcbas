; -----------------------------------------------------------------------
; lib/loco/str.asm -- Locomotive string functions: LEN, ASC, LEFT$, RIGHT$,
; MID$, CHR$, SPACE$, STRING$, UPPER$, LOWER$, INSTR
;
; Written from scratch for this project (MIT, see lib/LICENSE). Built on the
; imported runtime's heap (mem/alloc.asm, mem/free.asm) and string slice
; (strslice.asm). ASC wraps the runtime's __ASC (error 5 for the empty
; string, as Locomotive), STR$ is lib/loco's __LOCO_STR* and VAL is in
; strval.asm.
;
; Strings are a length word followed by the bytes; the pointer 0 is the empty
; string. Positions and counts are INTEGER words (1-based positions, as
; Locomotive). A negative count, a position of 0 and a CHR$ code outside
; 0..255 raise error 5 (Improper argument).
;
; Ownership. A string passed in HL with the free flag in A (the `fparam` of a
; string: A = 1 for a temporary, 0 for a variable or a constant) is freed by
; the routine when A is non-zero. A string passed on the stack (the `param`
; of a string) is always a temporary and is always consumed. Every returned
; string is a new heap string owned by the caller (0 when the heap is full or
; the result is empty).
;
; Stack entries take their arguments pushed left to right (the last argument
; on top) and remove them themselves, return address included, as the
; imported __STRSLICE does: the routine replaces the deepest argument by the
; return address, so a plain `ret` finishes the call.
;
; Entry points (namespace core). "Clobbers" lists registers changed; the
; stack is balanced.
;
;   __LOCO_LEN      HL = string, A = free flag. Exit: HL = LEN. Clobbers AF,
;                   BC, DE, HL.
;   __LOCO_STRDESC  HL = string (A ignored: the string is never freed), stack: the
;                   address of a 3-byte buffer. Writes the CALL descriptor there
;                   (spec section 18): byte 0 the length capped at 255, bytes 1-2 the
;                   address of the first character (0 for the empty string). Removes the
;                   buffer address. Clobbers AF, BC, DE, HL.
;   __LOCO_ASC      HL = string, A = free flag. Exit: A = the first code;
;                   error 5 for the empty string (STRING$(n, "") too, which
;                   passes ASC of its string). Clobbers AF, BC, DE, HL, AF'.
;   __LOCO_UPPER    HL = string, A = free flag. Exit: HL = new string with
;   __LOCO_LOWER    a-z (A-Z) mapped. Clobbers AF, BC, DE, HL.
;   __LOCO_CHR      HL = code. Exit: HL = the one-character string.
;                   Clobbers AF, BC, DE, HL.
;   __LOCO_SPACE    HL = count. Exit: HL = that many spaces. Clobbers AF, BC,
;                   DE, HL.
;   __LOCO_STRING   stack: count, code. Exit: HL = the code repeated.
;                   Clobbers AF, BC, DE, HL.
;   __LOCO_LEFT     stack: s$, n. Exit: HL = LEFT$(s$, n). Clobbers AF, BC,
;                   DE, HL, AF'.
;   __LOCO_RIGHT    stack: s$, n. Exit: HL = RIGHT$(s$, n). Same clobbers.
;   __LOCO_MID      stack: s$, p, n. Exit: HL = MID$(s$, p, n). Same clobbers.
;   __LOCO_MID2     stack: s$, p. Exit: HL = MID$(s$, p). Same clobbers.
;   __LOCO_INSTR    stack: a$, b$. Exit: HL = position of b$ in a$ (0 when
;   __LOCO_INSTR3   not found; b$ empty gives the start
;                   while start <= LEN(a$)). The 3 form's stack
;                   is start, a$, b$. Clobbers AF, BC, DE, HL, BC', DE'.
;   No firmware entry.

#include once <mem/alloc.asm>
#include once <mem/free.asm>
#include once <strlen.asm>
#include once <strslice.asm>
#include once <loadstr.asm>
#include once <error.asm>
#include once <asc.asm>

    push namespace core

__LOCO_BADARG:             ; Improper argument
    ld   a, 5
    jp   __ERROR

; ---- LEN -----------------------------------------------------------------
__LOCO_LEN:
    or   a
    jp   z, __STRLEN
    push hl
    call __STRLEN           ; HL = length
    ex   (sp), hl           ; HL = string, (SP) = length
    call __MEM_FREE
    pop  hl
    ret

; ---- ASC -----------------------------------------------------------------
__LOCO_ASC:
    ld   d, a               ; the free flag
    ld   a, h
    or   l
    jp   z, __LOCO_BADARG   ; the empty string (NULL)
    ld   a, (hl)
    inc  hl
    or   (hl)
    dec  hl
    ld   a, d
    jp   nz, __ASC          ; not empty: the runtime's ASC (frees a temp)
    or   a
    call nz, __MEM_FREE     ; an empty temp
    jp   __LOCO_BADARG

; ---- UPPER$, LOWER$ ------------------------------------------------------
__LOCO_UPPER:
    ld   d, 'a'
    jr   __LOCO_CASE
__LOCO_LOWER:
    ld   d, 'A'
__LOCO_CASE:                ; D = first letter of the range to flip (bit 5)
    or   a
    jr   nz, __CASE_OWNED
    push de
    call __LOADSTR          ; a copy we may change
    pop  de
__CASE_OWNED:
    ld   a, h
    or   l
    ret  z
    push hl
    ld   c, (hl)
    inc  hl
    ld   b, (hl)
    inc  hl
__CASE_LOOP:
    ld   a, b
    or   c
    jr   z, __CASE_DONE
    ld   a, (hl)
    sub  d
    cp   26
    jr   nc, __CASE_NEXT
    ld   a, (hl)
    xor  32
    ld   (hl), a
__CASE_NEXT:
    inc  hl
    dec  bc
    jr   __CASE_LOOP
__CASE_DONE:
    pop  hl
    ret

; ---- CHR$, SPACE$, STRING$ -----------------------------------------------
__LOCO_CHR:
    ld   a, h
    or   a
    jp   nz, __LOCO_BADARG
    ld   a, l
    ld   hl, 1
    jr   __LOCO_FILL

__LOCO_SPACE:
    ld   a, 32
    jr   __LOCO_FILL

__LOCO_STRING:              ; stack: count, code
    pop  hl                 ; return address
    pop  bc                 ; code
    ex   (sp), hl           ; HL = count, return address in place
    ld   a, b
    or   a
    jp   nz, __LOCO_BADARG
    ld   a, c

__LOCO_FILL:                ; HL = count, A = byte -> HL = new string
    bit  7, h
    jp   nz, __LOCO_BADARG
    ld   d, a
    ld   a, h
    or   l
    ret  z                  ; HL = 0: the empty string
    push de
    push hl
    ld   b, h
    ld   c, l
    inc  bc
    inc  bc
    call __MEM_ALLOC
    pop  bc                 ; BC = count
    pop  de                 ; D = byte
    ld   a, h
    or   l
    ret  z                  ; heap full
    push hl
    ld   (hl), c
    inc  hl
    ld   (hl), b
    inc  hl
    ld   (hl), d
    dec  bc
    ld   a, b
    or   c
    jr   z, __FILL_DONE
    ld   d, h
    ld   e, l
    inc  de
    ldir
__FILL_DONE:
    pop  hl
    ret

; ---- LEFT$, RIGHT$, MID$ -------------------------------------------------
; __STRSLICE_FAST: HL = string, DE = first index, BC = last index (both
; 0-based, inclusive; clamped to the end), A = free flag. Result in HL.

__LOCO_EMPTY:               ; HL = an owned string to discard -> HL = 0
    call __MEM_FREE
    ld   hl, 0
    ret

__LOCO_LEFT:                ; stack: s$, n
    pop  hl                 ; return address
    pop  de                 ; n
    ex   (sp), hl           ; HL = s$
    bit  7, d
    jp   nz, __LOCO_BADARG
    ld   a, d
    or   e
    jp   z, __LOCO_EMPTY
    ld   b, d
    ld   c, e
    dec  bc                 ; last index = n - 1
    ld   de, 0
    ld   a, 1
    jp   __STRSLICE_FAST

__LOCO_RIGHT:               ; stack: s$, n
    pop  hl
    pop  de                 ; n
    ex   (sp), hl           ; HL = s$
    bit  7, d
    jp   nz, __LOCO_BADARG
    ld   a, d
    or   e
    jp   z, __LOCO_EMPTY
    push hl
    call __STRLEN           ; HL = LEN
    ld   a, h
    or   l
    jr   z, __RIGHT_EMPTY
    ld   b, h
    ld   c, l
    dec  bc                 ; last index = LEN - 1
    or   a
    sbc  hl, de             ; LEN - n
    jr   nc, __RIGHT_CUT
    ld   hl, 0              ; n > LEN: the whole string
__RIGHT_CUT:
    ex   de, hl             ; DE = first index
    pop  hl
    ld   a, 1
    jp   __STRSLICE_FAST
__RIGHT_EMPTY:
    pop  hl
    jp   __LOCO_EMPTY

__LOCO_MID:                 ; stack: s$, p, n
    pop  hl                 ; return address
    pop  de                 ; n
    pop  bc                 ; p
    ex   (sp), hl           ; HL = s$
    bit  7, b
    jp   nz, __LOCO_BADARG
    bit  7, d
    jp   nz, __LOCO_BADARG
    ld   a, b
    or   c
    jp   z, __LOCO_BADARG
    ld   a, d
    or   e
    jp   z, __LOCO_EMPTY
    push hl                 ; s$
    ld   h, b
    ld   l, c
    add  hl, de
    dec  hl
    dec  hl                 ; last index = p + n - 2
    push hl
    ld   h, b
    ld   l, c
    dec  hl
    ex   de, hl             ; DE = first index = p - 1
    pop  bc                 ; BC = last index
    pop  hl
    ld   a, 1
    jp   __STRSLICE_FAST

__LOCO_MID2:                ; stack: s$, p
    pop  hl
    pop  de                 ; p
    ex   (sp), hl           ; HL = s$
    bit  7, d
    jp   nz, __LOCO_BADARG
    ld   a, d
    or   e
    jp   z, __LOCO_BADARG
    dec  de                 ; first index = p - 1
    ld   bc, 0FFFEh         ; to the end
    ld   a, 1
    jp   __STRSLICE_FAST

; ---- INSTR ---------------------------------------------------------------
__LOCO_INSTR:               ; stack: a$, b$
    pop  hl
    pop  de                 ; b$
    ex   (sp), hl           ; HL = a$
    ld   bc, 1
    jr   __INSTR_GO

__LOCO_INSTR3:              ; stack: start, a$, b$
    pop  hl
    pop  de                 ; b$
    pop  bc                 ; a$
    ex   (sp), hl           ; HL = start
    push hl
    push bc
    pop  hl                 ; HL = a$
    pop  bc                 ; BC = start

__INSTR_GO:                 ; HL = a$, DE = b$ (both owned), BC = start
    bit  7, b
    jp   nz, __LOCO_BADARG
    ld   a, b
    or   c
    jp   z, __LOCO_BADARG
    push hl                 ; a$ and b$ stay on the stack to be freed
    push de
    push bc                 ; start
    call __STRLEN           ; HL = LEN(a$)
    ex   de, hl             ; DE = LEN(a$), HL = b$
    call __STRLEN           ; HL = LEN(b$)
    ld   b, h
    ld   c, l               ; BC = LEN(b$)
    ex   de, hl             ; HL = LEN(a$)
    pop  de                 ; DE = start
    or   a
    sbc  hl, bc             ; HL = LEN(a$) - LEN(b$)
    jr   c, __INSTR_NF
    dec  de                 ; DE = first index
    or   a
    sbc  hl, de
    jr   c, __INSTR_NF
    ld   a, b               ; an empty b$ is found only while start <= LEN(a$)
    or   c
    jr   nz, __INSTR_HAVE
    ld   a, h
    or   l
    jr   z, __INSTR_NF
__INSTR_HAVE:
    inc  hl                 ; HL = number of candidate positions
    push hl
    push de
    exx
    pop  de                 ; DE' = first index
    inc  de                 ; DE' = its 1-based position
    pop  bc                 ; BC' = candidates left
    exx
    pop  de                 ; DE = b$
    pop  hl                 ; HL = a$
    push hl
    push de                 ; keep a$, b$ for the frees
    inc  de
    inc  de                 ; DE = b$ bytes
    inc  hl
    inc  hl                 ; HL = a$ bytes
    push bc                 ; LEN(b$)
    exx
    push de
    exx
    pop  bc                 ; BC = 1-based first position
    dec  bc
    add  hl, bc             ; HL = first candidate
    pop  bc                 ; BC = LEN(b$)
__INSTR_CAND:
    push hl
    push de
    push bc
__INSTR_CMP:
    ld   a, b
    or   c
    jr   z, __INSTR_MATCH
    ld   a, (de)
    cpi
    jr   nz, __INSTR_MISS
    inc  de
    jr   __INSTR_CMP
__INSTR_MISS:
    pop  bc
    pop  de
    pop  hl
    inc  hl
    exx
    inc  de
    dec  bc
    ld   a, b
    or   c
    exx
    jr   nz, __INSTR_CAND
__INSTR_NF0:
    ld   hl, 0
    jr   __INSTR_END
__INSTR_MATCH:
    pop  bc
    pop  de
    pop  hl
    exx
    push de
    exx
    pop  hl                 ; HL = position
    jr   __INSTR_END
__INSTR_NF:                 ; stack: a$, b$
    ld   hl, 0
__INSTR_END:                ; HL = result; stack: a$, b$
    ex   de, hl             ; DE = result
    pop  hl                 ; b$
    push de
    call __MEM_FREE
    pop  de
    pop  hl                 ; a$
    push de
    call __MEM_FREE
    pop  hl
    ret

; ---- the CALL descriptor ---------------------------------------------------
__LOCO_STRDESC:
    ex   de, hl             ; DE = string
    pop  hl                 ; return address
    ex   (sp), hl           ; HL = buffer, the return address on top
    ld   a, d
    or   e
    jr   z, __STRDESC_PUT   ; the empty string: length 0, address 0
    ex   de, hl             ; HL = string, DE = buffer
    ld   c, (hl)
    inc  hl
    ld   b, (hl)
    inc  hl                 ; BC = length, HL = first character
    ex   de, hl             ; HL = buffer, DE = first character
    ld   a, b
    or   a
    ld   a, c
    jr   z, __STRDESC_PUT
    ld   a, 255
__STRDESC_PUT:
    ld   (hl), a
    inc  hl
    ld   (hl), e
    inc  hl
    ld   (hl), d
    ret

    pop namespace
