; -----------------------------------------------------------------------
; lib/loco/input.asm -- Locomotive text layer: INPUT and LINE INPUT on the keyboard
;
; Written from scratch for this project (MIT, see lib/LICENSE).
;
; One runtime call does a whole statement, prompt and redo included, so no state lives in a
; runtime global across quads (docs/ir.md "Events and errors", "Runtime state that spans quads").
;
;   __LOCO_INPUT    HL = the control block (below); stack: the address of __LOCO_INREAL (inputreal.asm)
;                   when an item is a number, else 0. Reads a line, splits it, converts it and stores
;                   the items in the block's result area; the caller then fetches them with
;                   __LOCO_INGETW / __LOCO_INGETF.
;   __LOCO_INGETW   HL = the address of a result slot of type I or S. Exit: HL = the word
;                   (INTEGER, or a string pointer, 0 for the empty string); an S slot is cleared
;                   (the caller owns the string).
;   __LOCO_INGETF   HL = the address of an F slot. Exit: A E D C B = the REAL.
;
; The control block (built by the lowering, in a hidden global, never moved):
;     +0   flags: bit 0 shows "? " after the prompt, bit 1 keeps the cursor (INPUT ;), bit 2 LINE INPUT
;     +1   n, the number of items
;     +2   p, the prompt's length;  +3 the prompt text
;     then n type bytes: "I" (INTEGER, 2 bytes), "F" (REAL, 5 bytes), "S" (a string pointer, 2 bytes)
;     then the result area, the slots in item order
;
; What Locomotive does, measured on the interpreter (tests/loco/probes/p-input*.bas, loco-measured.md):
; "? " is printed when there is no prompt or the prompt ends in `;`; after RETURN a line end is
; printed unless the statement is INPUT ;. The typed characters are not echoed to the printer (only
; to the screen), the prompt, "? " and the line end are. INPUT splits the line at commas: the number of
; items must equal the number of variables, else `?Redo from start` and the whole statement is asked
; again. A string item is trimmed of blanks; a `"` starts a quoted item that may hold commas (a quote
; with text after it is a redo). A number item ignores blanks anywhere in it, may be empty (0) and is
; a decimal (digits, point, E exponent, one sign) or `&` hex / `&H` hex / `&X` binary (16 bits, -1 for
; &FFFF; more bits print Overflow and redo); anything else is a redo. A REAL read into an INTEGER is
; rounded; one beyond 16 bits is error 6, Overflow. LINE INPUT keeps the line as typed.
;
; The editor: printable characters (32-126, 128-223), DEL to delete the last character, RETURN.
; Firmware and bare builds both read keys through __LOCO_GETKEY (keys.asm) and echo to the screen
; only. No cursor keys, COPY or CLR; a line of at most 255 characters. The bare DEL does not go back
; past the start of a screen row.
;
; Clobbers every register but IX. The line buffer is a 258-byte heap block (error 7 when the
; heap cannot give it).

#include once <error.asm>
#include once <mem/alloc.asm>
#include once <mem/free.asm>
#include once <loco/txt.asm>
#include once <loco/txtout.asm>
#include once <loco/keys.asm>
#include once <loco/vars.asm>
#ifdef CPC_BAREMETAL
#include once <txtbare.asm>
#endif

    push namespace core

; The frame (IX): -2 control block, -4 INREAL table, -6 buffer, -8 length (byte), -10 parse pointer,
; -11 type of the item (byte), -12 item index (byte), -14 result slot pointer, -16 types, -18 item
; start, -20 item end, -22 comma seen (byte), -23 digit count (byte), -24 n (byte)

; ---- screen output without the printer echo (typed characters) ---------------
__IN_CH:
#ifdef CPC_BAREMETAL
    push af
    push bc
    push de
    push hl
    call __BT_PUTC
    pop  hl
    pop  de
    pop  bc
    pop  af
    ret
#else
    call .core.__FW_CALL
    defw $BB5A              ; TXT OUTPUT
    ret
#endif

__IN_PUTSN:                 ; HL = text, B = count -> __LOCO_PUTC (the printer sees it)
    ld   a, b
    or   a
    ret  z
__IN_PS1:
    ld   a, (hl)
    inc  hl
    call __LOCO_PUTC
    djnz __IN_PS1
    ret

__IN_LT:                    ; Carry set when HL < BC
    ld   a, h
    cp   b
    ret  nz
    ld   a, l
    cp   c
    ret

__IN_SKIPSP:                ; HL moves over blanks, not past BC
    call __IN_LT
    ret  nc
    ld   a, (hl)
    cp   ' '
    ret  nz
    inc  hl
    jr   __IN_SKIPSP

__IN_MKSTR:                 ; HL = text, BC = length -> HL = a new string (0 for none)
    ld   a, b
    or   c
    jr   nz, __IN_MK1
    ld   h, a
    ld   l, a
    ret
__IN_MK1:
    push hl
    push bc
    inc  bc
    inc  bc
    call __MEM_ALLOC
    pop  bc
    pop  de
    ld   a, h
    or   l
    jr   nz, __IN_MK2
    ld   a, ERROR_OutOfMemory
    jp   __ERROR
__IN_MK2:
    push hl
    ld   (hl), c
    inc  hl
    ld   (hl), b
    inc  hl
    ex   de, hl
    ldir
    pop  hl
    ret

; ---- the statement -------------------------------------------------------------
__LOCO_INPUT:
    pop  de                 ; the return address
    pop  bc                 ; the INREAL table
    push de
    push ix
    ld   ix, 0
    add  ix, sp
    push hl                 ; -2: the control block
    push bc                 ; -4: the table
    ld   hl, -20
    add  hl, sp
    ld   sp, hl
    ld   l, (ix-2)
    ld   h, (ix-1)
    inc  hl
    ld   a, (hl)
    ld   (ix-24), a         ; n
    inc  hl
    ld   a, (hl)            ; the prompt's length
    inc  hl                 ; the prompt
    ld   e, a
    ld   d, 0
    add  hl, de
    ld   (ix-16), l         ; the type bytes
    ld   (ix-15), h
    ld   bc, 258
    call __MEM_ALLOC
    ld   a, h
    or   l
    jr   nz, __IN_OK
    ld   a, ERROR_OutOfMemory
    jp   __ERROR
__IN_OK:
    ld   (ix-6), l
    ld   (ix-5), h
__IN_AGAIN:
    ld   l, (ix-2)
    ld   h, (ix-1)
    inc  hl
    inc  hl
    ld   b, (hl)
    inc  hl
    call __IN_PUTSN
    ld   l, (ix-2)
    ld   h, (ix-1)
    ld   a, (hl)
    and  1
    jr   z, __IN_NOQ
    ld   a, '?'
    call __LOCO_PUTC
    ld   a, ' '
    call __LOCO_PUTC
__IN_NOQ:
    xor  a
    ld   (ix-8), a
#ifdef CPC_BAREMETAL
    call __CPC_KEY_FLUSH
#else
    call .core.__FW_CALL
    defw $BB81              ; TXT CUR ON
#endif
__IN_KEY:
    call __LOCO_GETKEY
    cp   13
    jr   z, __IN_DONE
    cp   127
    jr   z, __IN_DEL
    cp   32
    jr   c, __IN_KEY
    cp   224
    jr   nc, __IN_KEY
    ld   c, a
    ld   a, (ix-8)
    cp   255
    jr   z, __IN_KEY        ; the line is full
    ld   e, a
    ld   d, 0
    ld   l, (ix-6)
    ld   h, (ix-5)
    add  hl, de
    ld   (hl), c
    inc  (ix-8)
    ld   a, c
    call __IN_CH
    jr   __IN_KEY
__IN_DEL:
    ld   a, (ix-8)
    or   a
    jr   z, __IN_KEY
#ifdef CPC_BAREMETAL
    ld   a, (S_POSN)
    or   a
    jr   z, __IN_KEY        ; at the start of a row: nothing to back over
    dec  (ix-8)
    ld   hl, S_POSN
    dec  (hl)
    ld   a, ' '
    call __IN_CH
    ld   hl, S_POSN
    dec  (hl)
#else
    dec  (ix-8)
    ld   a, 8
    call __IN_CH
    ld   a, ' '
    call __IN_CH
    ld   a, 8
    call __IN_CH
#endif
    jr   __IN_KEY
__IN_DONE:
    ld   l, (ix-6)
    ld   h, (ix-5)
    ld   e, (ix-8)
    ld   d, 0
    add  hl, de
    ld   (hl), 0
#ifndef CPC_BAREMETAL
    call .core.__FW_CALL
    defw $BB84              ; TXT CUR OFF
#endif
    ld   l, (ix-2)
    ld   h, (ix-1)
    ld   a, (hl)
    and  2
    jr   nz, __IN_KEPT
    call __LOCO_NL
__IN_KEPT:
    ; the first result slot: after the types
    ld   l, (ix-16)
    ld   h, (ix-15)
    ld   e, (ix-24)
    ld   d, 0
    add  hl, de
    ld   (ix-14), l
    ld   (ix-13), h
    ld   l, (ix-2)
    ld   h, (ix-1)
    ld   a, (hl)
    and  4
    jr   z, __IN_SPLIT
    ; LINE INPUT: the line as typed
    ld   l, (ix-6)
    ld   h, (ix-5)
    ld   c, (ix-8)
    ld   b, 0
    call __IN_MKSTR
    ex   de, hl
    ld   l, (ix-14)
    ld   h, (ix-13)
    ld   (hl), e
    inc  hl
    ld   (hl), d
    jr   __IN_FIN
__IN_SPLIT:
    xor  a
    ld   (ix-12), a
    ld   l, (ix-6)
    ld   h, (ix-5)
    ld   (ix-10), l
    ld   (ix-9), h
__IN_ITEMS:
    ld   a, (ix-12)
    cp   (ix-24)
    jr   z, __IN_FIN
    call __IN_ITEM
    jr   c, __IN_REDO
    inc  (ix-12)
    jr   __IN_ITEMS
__IN_FIN:
    ld   l, (ix-6)
    ld   h, (ix-5)
    call __MEM_FREE
    ld   sp, ix
    pop  ix
    ret
__IN_REDO:
    call __IN_FREESTR
    ld   hl, __IN_REDOTXT
    ld   b, 16
    call __IN_PUTSN
    call __LOCO_NL
    jp   __IN_AGAIN
__IN_REDOTXT:
    DEFB "?Redo from start"
__IN_OVTXT:
    DEFB "Overflow"

__IN_FREESTR:               ; frees the strings of the result slots (a redo) and clears them
    ld   l, (ix-16)
    ld   h, (ix-15)
    ld   b, (ix-24)
    ld   e, b
    ld   d, 0
    push hl
    add  hl, de
    ex   de, hl             ; DE = the first slot
    pop  hl                 ; HL = the types
__IN_FS1:
    ld   a, (hl)
    inc  hl
    cp   'F'
    jr   z, __IN_FS5
    cp   'S'
    jr   nz, __IN_FS2
    push hl
    push de
    push bc
    ex   de, hl
    ld   e, (hl)
    ld   (hl), 0
    inc  hl
    ld   d, (hl)
    ld   (hl), 0
    ex   de, hl
    call __MEM_FREE
    pop  bc
    pop  de
    pop  hl
__IN_FS2:
    inc  de
    inc  de
    djnz __IN_FS1
    ret
__IN_FS5:
    inc  de
    inc  de
    inc  de
    jr   __IN_FS2

; ---- one item: Carry set when the line has to be asked for again -----------------
__IN_ITEM:
    ld   l, (ix-6)
    ld   h, (ix-5)
    ld   e, (ix-8)
    ld   d, 0
    add  hl, de
    ld   b, h
    ld   c, l               ; BC = the end of the line
    ld   e, (ix-12)
    ld   d, 0
    ld   l, (ix-16)
    ld   h, (ix-15)
    add  hl, de
    ld   a, (hl)
    ld   (ix-11), a         ; the type
    ld   l, (ix-10)
    ld   h, (ix-9)
    call __IN_SKIPSP
    ld   a, (ix-11)
    cp   'S'
    jr   nz, __IN_UNQ
    call __IN_LT
    jr   nc, __IN_UNQ
    ld   a, (hl)
    cp   '"'
    jr   nz, __IN_UNQ
    inc  hl                 ; a quoted item
    ld   (ix-18), l
    ld   (ix-17), h
__IN_Q1:
    call __IN_LT
    jr   nc, __IN_Q2
    ld   a, (hl)
    cp   '"'
    jr   z, __IN_Q2
    inc  hl
    jr   __IN_Q1
__IN_Q2:
    ld   (ix-20), l
    ld   (ix-19), h
    call __IN_LT
    jr   nc, __IN_DELIM
    inc  hl
    call __IN_SKIPSP
    jr   __IN_DELIM
__IN_UNQ:
    ld   (ix-18), l
    ld   (ix-17), h
__IN_U1:
    call __IN_LT
    jr   nc, __IN_U2
    ld   a, (hl)
    cp   ','
    jr   z, __IN_U2
    inc  hl
    jr   __IN_U1
__IN_U2:
    ld   (ix-20), l
    ld   (ix-19), h
    ld   a, (ix-11)
    cp   'S'
    jr   nz, __IN_DELIM
    push hl                 ; a string item loses its trailing blanks
    ld   e, (ix-20)
    ld   d, (ix-19)
    ld   l, (ix-18)
    ld   h, (ix-17)
__IN_T1:
    ld   a, l
    sub  e
    ld   a, h
    sbc  a, d
    jr   nc, __IN_T2        ; start >= end
    dec  de
    ld   a, (de)
    cp   ' '
    jr   z, __IN_T1
    inc  de
__IN_T2:
    ld   (ix-20), e
    ld   (ix-19), d
    pop  hl
__IN_DELIM:
    xor  a
    ld   (ix-22), a
    call __IN_LT
    jr   nc, __IN_D1
    ld   a, (hl)
    cp   ','
    jr   nz, __IN_INVALID   ; text after a closing quote
    inc  hl
    ld   a, 1
    ld   (ix-22), a
__IN_D1:
    ld   (ix-10), l
    ld   (ix-9), h
    ld   a, (ix-12)
    inc  a
    cp   (ix-24)
    ld   a, (ix-22)
    jr   z, __IN_LAST
    or   a                  ; not the last item: a comma has to follow
    jr   z, __IN_INVALID
    jr   __IN_VAL
__IN_LAST:
    or   a                  ; the last item: no comma may follow
    jr   nz, __IN_INVALID
__IN_VAL:
    ld   a, (ix-11)
    cp   'S'
    jp   nz, __IN_NUM
    ld   l, (ix-18)
    ld   h, (ix-17)
    ld   c, (ix-20)
    ld   b, (ix-19)
    ld   a, c
    sub  l
    ld   c, a
    ld   a, b
    sbc  a, h
    ld   b, a
    call __IN_MKSTR
    call __IN_PUT2
    or   a
    ret
__IN_INVALID:
    scf
    ret

__IN_PUT2:                  ; HL -> the result slot (2 bytes), which moves on
    ex   de, hl
    ld   l, (ix-14)
    ld   h, (ix-13)
    ld   (hl), e
    inc  hl
    ld   (hl), d
    inc  hl
    ld   (ix-14), l
    ld   (ix-13), h
    ret

__IN_PUT5:                  ; A E D C B -> the result slot (5 bytes), which moves on
    ld   l, (ix-14)
    ld   h, (ix-13)
    ld   (hl), a
    inc  hl
    ld   (hl), e
    inc  hl
    ld   (hl), d
    inc  hl
    ld   (hl), c
    inc  hl
    ld   (hl), b
    inc  hl
    ld   (ix-14), l
    ld   (ix-13), h
    ret

; ---- a number item --------------------------------------------------------------
__IN_DIGITS:                ; HL over digits, D counts them
    ld   a, (hl)
    sub  '0'
    cp   10
    ret  nc
    inc  d
    inc  hl
    jr   __IN_DIGITS

__IN_NUM:
    ld   l, (ix-18)         ; the blanks come out of the item, which ends in a 0
    ld   h, (ix-17)
    ld   e, l
    ld   d, h
    ld   c, (ix-20)
    ld   b, (ix-19)
__IN_N1:
    call __IN_LT
    jr   nc, __IN_N3
    ld   a, (hl)
    inc  hl
    cp   ' '
    jr   z, __IN_N1
    ld   (de), a
    inc  de
    jr   __IN_N1
__IN_N3:
    xor  a
    ld   (de), a
    ld   (ix-20), e
    ld   (ix-19), d
    xor  a
    ld   (ix-23), a
    ld   l, (ix-18)
    ld   h, (ix-17)
    ld   a, (hl)
    or   a
    jp   z, __IN_ZERO
    cp   '&'
    jp   z, __IN_RADIX
    cp   '+'
    jr   z, __IN_SG
    cp   '-'
    jr   nz, __IN_D0
__IN_SG:
    inc  hl
__IN_D0:
    ld   d, 0
    call __IN_DIGITS
    ld   a, (hl)
    cp   '.'
    jr   nz, __IN_D1X
    inc  hl
    call __IN_DIGITS
__IN_D1X:
    ld   a, d
    or   a
    jp   z, __IN_INVALID
    ld   a, (hl)
    or   a
    jr   z, __IN_DEC
    and  $DF
    cp   'E'
    jp   nz, __IN_INVALID
    inc  hl
    ld   a, (hl)
    cp   '+'
    jr   z, __IN_E1
    cp   '-'
    jr   nz, __IN_E2
__IN_E1:
    inc  hl
__IN_E2:
    ld   d, 0
    call __IN_DIGITS
    ld   a, d
    or   a
    jp   z, __IN_INVALID
    ld   a, (hl)
    or   a
    jp   nz, __IN_INVALID
__IN_DEC:                   ; a valid decimal: the text becomes a REAL through the table
    ld   l, (ix-18)
    ld   h, (ix-17)
    ld   (LOCO_KEYTMP), hl
    ld   c, (ix-20)
    ld   b, (ix-19)
    ld   a, c
    sub  l
    ld   c, a
    ld   a, b
    sbc  a, h
    ld   (LOCO_KEYTMP + 3), a
    ld   a, c
    ld   (LOCO_KEYTMP + 2), a
    ld   hl, __IN_R1
    push hl
    ld   l, (ix-4)
    ld   h, (ix-3)
    jp   (hl)               ; __IR_TEXT
__IN_R1:                    ; A E D C B = the value
    push af
    ld   a, (ix-11)
    cp   'F'
    jr   nz, __IN_RI
    pop  af
    call __IN_PUT5
    or   a                  ; Carry clear: the item is good (VAL's Carry on exit is not defined)
    ret
__IN_RI:
    pop  af
    ld   hl, __IN_R2
    push hl
    ld   l, (ix-4)
    ld   h, (ix-3)
    inc  hl
    inc  hl
    inc  hl
    jp   (hl)               ; __IR_TOI
__IN_R2:                    ; HL = the INTEGER, Carry = out of range
    jr   nc, __IN_R3
    ld   a, 6               ; Overflow
    jp   __ERROR
__IN_R3:
    call __IN_PUT2
    or   a
    ret
__IN_ZERO:                  ; an empty item is 0
    ld   a, (ix-11)
    cp   'F'
    jr   z, __IN_ZF
    ld   hl, 0
    call __IN_PUT2
    or   a
    ret
__IN_ZF:
    xor  a
    ld   e, a
    ld   d, a
    ld   c, a
    ld   b, a
    call __IN_PUT5
    or   a
    ret

__IN_RADIX:                 ; &hex, &Hhex, &Xbinary: 16 bits
    inc  hl
    ld   a, (hl)
    and  $DF
    ld   b, 1
    cp   'X'
    jr   z, __IN_RX1
    ld   b, 4
    cp   'H'
    jr   nz, __IN_RX2
__IN_RX1:
    inc  hl
__IN_RX2:
    ld   de, 0
__IN_RL:
    ld   a, (hl)
    or   a
    jr   z, __IN_RDONE
    sub  '0'
    cp   10
    jr   c, __IN_RD
    ld   a, (hl)
    and  $DF
    sub  'A'
    cp   6
    jp   nc, __IN_INVALID
    add  a, 10
__IN_RD:
    push af                 ; the digit
    ld   c, b
__IN_RS:
    sla  e
    rl   d
    jr   c, __IN_ROV
    dec  c
    jr   nz, __IN_RS
    pop  af
    ld   c, a
    ld   a, b
    cp   1
    jr   nz, __IN_RK
    ld   a, c               ; a binary digit is 0 or 1
    cp   2
    jp   nc, __IN_INVALID
__IN_RK:
    ld   a, c
    or   e
    ld   e, a
    inc  (ix-23)
    inc  hl
    jr   __IN_RL
__IN_ROV:
    pop  af
    ld   hl, __IN_OVTXT
    ld   b, 8
    call __IN_PUTSN
    call __LOCO_NL
    scf
    ret
__IN_RDONE:
    ld   a, (ix-23)
    or   a
    jp   z, __IN_INVALID    ; "&" alone
    ld   a, (ix-11)
    cp   'F'
    jr   z, __IN_RF
    ex   de, hl
    call __IN_PUT2
    or   a
    ret
__IN_RF:
    ld   hl, __IN_R4
    push hl
    ld   l, (ix-4)
    ld   h, (ix-3)
    ld   bc, 6
    add  hl, bc
    jp   (hl)               ; __IR_FROMI: DE -> a REAL
__IN_R4:
    call __IN_PUT5
    or   a
    ret

; ---- the results ----------------------------------------------------------------
__LOCO_INGETW:
    ld   e, (hl)
    ld   (hl), 0
    inc  hl
    ld   d, (hl)
    ld   (hl), 0
    ex   de, hl
    ret

__LOCO_INGETF:
    ld   a, (hl)
    inc  hl
    ld   e, (hl)
    inc  hl
    ld   d, (hl)
    inc  hl
    ld   c, (hl)
    inc  hl
    ld   b, (hl)
    ret

    pop namespace
