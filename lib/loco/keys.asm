; -----------------------------------------------------------------------
; lib/loco/keys.asm -- Locomotive keyboard layer: INKEY(n), JOY(n), CLEAR INPUT, KEY,
; KEY DEF, SPEED KEY, ON BREAK, and the key reader of INPUT
;
; Written from scratch for this project (MIT, see lib/LICENSE).
;
; Firmware builds call the key manager (KM entries, through the gate, fwcall.asm); bare builds
; read the keyboard matrix (io/keyboard/kscan.asm, kbare.asm). KEY, KEY DEF and SPEED KEY are
; firmware only: their routines are empty in a bare build, which the compiler never reaches
; (E270). Every range error is Improper argument (5), as measured on the interpreter
; (tests/loco/probes/p-keyerr.bas).
;
;   __LOCO_INKEYN   HL = key number (a 16-bit pattern). Exit: HL = -1 (not pressed), 0 (pressed),
;                   32 (with SHIFT), 128 (with CONTROL) or 160 (both). Error 5 above 79.
;                   Firmware: KM TEST KEY (&BB1E). Bare: a scan of the matrix.
;                   Clobbers AF, BC, DE, HL (+ the gate).
;   __LOCO_JOY      HL = 0 or 1 (else error 5). Exit: HL = the joystick's bits: 0 up, 1 down,
;                   2 left, 3 right, 4 fire 2, 5 fire 1. Firmware: KM GET JOYSTICK (&BB24).
;                   Bare: matrix row 9 (joystick 0) or row 6 (joystick 1).
;                   Clobbers AF, BC, DE, HL (+ the gate).
;   __LOCO_CLEARIN  CLEAR INPUT. Firmware: KM READ CHAR (&BB09) until the buffer is empty.
;                   Bare: a key held now is taken as used (there is no buffer).
;                   Clobbers AF, BC, DE, HL (+ the gate).
;   __LOCO_KEY      KEY n, s$: HL = s$ (0 for the empty string), A = free flag (1: a temporary,
;                   freed here); stack: n (16-bit). n in 0..31, s$ at most what the firmware's
;                   expansion buffer holds, else error 5. KM SET EXPAND (&BB0F).
;   __LOCO_KEYDEF   KEY DEF n, repeat [, normal [, shift [, control]]]: HL = how many values were
;                   given (2 to 5); stack: the values in source order, 16 bits each (n deepest).
;                   n in 0..79, repeat 0 or 1, the characters 0..255, else error 5 (all checked
;                   before anything changes). KM SET REPEAT (&BB39), KM SET TRANSLATE (&BB27),
;                   KM SET SHIFT (&BB2D), KM SET CONTROL (&BB33).
;   __LOCO_SPEEDKEY SPEED KEY a, b: HL = b; stack: a. Both in 1..255 else error 5. KM SET DELAY
;                   (&BB3F).
;   __LOCO_ONBREAK  ON BREAK STOP (A = 1) or CONT (A = 0): sets the flag the check reads.
;   __LOCO_CHKBRK   the check at a statement boundary of a program with ON BREAK STOP, in
;                   break.asm's convention (the caller did `push hl` / `ld hl, <line>` / `call`;
;                   it returns with HL and the stack as before the push). The flag clear: returns
;                   at once. ESC down (KM TEST KEY 66): prints what STOP prints (loco/brk.asm:
;                   a fresh line, "Break in <line>", or "Break" when the line is
;                   65535, none) and ends the program as STOP does (__CPC_END: the files stay open). Break is not an error (docs/ir.md "Events and errors").
;   __LOCO_GETKEY   INPUT's key reader: waits for the next typed character, returns it in A.
;                   Firmware: KM WAIT CHAR (&BB06). Bare: __CPC_KEY_NEXT (kbare.asm).
;                   Clobbers AF, BC, DE, HL (+ the gate).

#include once <error.asm>
#include once <bootstrap.asm>
#include once <loco/txt.asm>
#ifndef CPC_BAREMETAL
#include once <loco/brk.asm>
#endif
#include once <loco/vars.asm>
#ifdef CPC_BAREMETAL
#include once <io/keyboard/kscan.asm>
#include once <io/keyboard/kbare.asm>
#else
#include once <fwcall.asm>
#include once <mem/free.asm>
#endif

    push namespace core

__KY_BAD:                   ; Improper argument
    ld   a, 5
    jp   __ERROR

; ---- INKEY(n) ----------------------------------------------------------------
__LOCO_INKEYN:
    ld   a, h
    or   a
    jr   nz, __KY_BAD
    ld   a, l
    cp   80
    jr   nc, __KY_BAD
#ifdef CPC_BAREMETAL
    push af
    ld   de, 10             ; D = 0 (the first row), E = 10 rows
    call __CPC_KSCAN_ROWS
    pop  af
    ld   c, a
    srl  a
    srl  a
    srl  a                  ; the row
    ld   e, a
    ld   d, 0
    ld   hl, __CPC_KEYS
    add  hl, de
    ld   a, c
    and  7
    ld   b, a
    ld   a, 1
    jr   z, __KY_B0
__KY_SH:
    add  a, a
    djnz __KY_SH
__KY_B0:
    and  (hl)
    jr   z, __KY_UP
    ld   a, (__CPC_KEYS + 2)
    and  $A0                ; SHIFT is key 21 (row 2 bit 5), CONTROL key 23 (bit 7)
#else
    call .core.__FW_CALL
    defw $BB1E              ; KM TEST KEY: Z = not pressed, C = shift (bit 5) and control (bit 7)
    jr   z, __KY_UP
    ld   a, c
    and  $A0
#endif
    ld   l, a
    ld   h, 0
    ret
__KY_UP:
    ld   hl, -1
    ret

; ---- JOY(n) ------------------------------------------------------------------
__LOCO_JOY:
    ld   a, h
    or   a
    jr   nz, __KY_BAD
    ld   a, l
    cp   2
    jr   nc, __KY_BAD
#ifdef CPC_BAREMETAL
    push af
    ld   de, $0604          ; rows 6 to 9
    call __CPC_KSCAN_ROWS
    pop  af
    or   a
    ld   a, (__CPC_KEYS + 9) ; joystick 0
    jr   z, __JY_GOT
    ld   a, (__CPC_KEYS + 6) ; joystick 1
__JY_GOT:
    and  $3F
    ld   l, a
    ld   h, 0
    ret
#else
    push af
    call .core.__FW_CALL
    defw $BB24              ; KM GET JOYSTICK: H = joystick 0, L = joystick 1
    pop  af
    or   a
    jr   nz, __JY_ONE
    ld   l, h
__JY_ONE:
    ld   h, 0
    ret
#endif

; ---- CLEAR INPUT -------------------------------------------------------------
__LOCO_CLEARIN:
#ifdef CPC_BAREMETAL
    jp   __CPC_KEY_FLUSH
#else
    call .core.__FW_CALL
    defw $BB09              ; KM READ CHAR: Carry = a character
    jr   c, __LOCO_CLEARIN
    ret
#endif

; ---- INPUT's key reader --------------------------------------------------------
__LOCO_GETKEY:
#ifdef CPC_BAREMETAL
    jp   __CPC_KEY_NEXT
#else
    call .core.__FW_CALL
    defw $BB06              ; KM WAIT CHAR
    ret
#endif

#ifndef CPC_BAREMETAL
; ---- KEY n, s$ ---------------------------------------------------------------
__LOCO_KEY:
    pop  bc                 ; the return address
    ex   (sp), hl           ; HL = n; the stack holds s$
    pop  de                 ; DE = s$
    push bc
    ld   (LOCO_KEYTMP), de
    ld   (LOCO_KEYTMP + 2), a
    xor  a
    ld   (LOCO_KEYTMP + 3), a ; 0 = failed so far
    ld   a, h
    or   a
    jr   nz, __KY_KFREE
    ld   a, l
    cp   32
    jr   nc, __KY_KFREE
    ld   b, a               ; B = the expansion token
    ld   c, 0               ; C = the length, HL = the text
    ld   a, d
    or   e
    jr   z, __KY_KSET
    ex   de, hl
    ld   c, (hl)
    inc  hl
    ld   a, (hl)
    inc  hl
    or   a
    jr   nz, __KY_KFREE     ; longer than 255
__KY_KSET:
    call .core.__FW_CALL
    defw $BB0F              ; KM SET EXPAND: Carry = done
    sbc  a, a
    ld   (LOCO_KEYTMP + 3), a
__KY_KFREE:
    ld   a, (LOCO_KEYTMP + 2)
    or   a
    ld   hl, (LOCO_KEYTMP)
    call nz, __MEM_FREE
    ld   a, (LOCO_KEYTMP + 3)
    or   a
    ret  nz
    jp   __KY_BAD

; ---- KEY DEF -----------------------------------------------------------------
; LOCO_KEYTMP: +0 the return address, +2 .. +11 the five values (n, repeat, normal, shift, control);
; LOCO_KEYCNT: how many were given
__LOCO_KEYDEF:
    pop  de
    ld   (LOCO_KEYTMP), de
    ld   a, l
    cp   2
    jp   c, __KY_BAD
    cp   6
    jp   nc, __KY_BAD
    ld   (LOCO_KEYCNT), a
    add  a, a
    ld   e, a
    ld   d, 0
    ld   hl, LOCO_KEYTMP
    add  hl, de             ; HL = the last value's slot
    ld   a, (LOCO_KEYCNT)
    ld   b, a
__KD_POP:
    pop  de
    ld   (hl), e
    inc  hl
    ld   (hl), d
    dec  hl
    dec  hl
    dec  hl
    djnz __KD_POP
    ; everything is checked before anything changes: n < 80, repeat < 2, the characters < 256
    ld   a, (LOCO_KEYTMP + 3)
    ld   hl, LOCO_KEYTMP + 5
    or   (hl)
    jp   nz, __KY_BAD
    ld   a, (LOCO_KEYTMP + 2)
    cp   80
    jp   nc, __KY_BAD
    ld   a, (LOCO_KEYTMP + 4)
    cp   2
    jp   nc, __KY_BAD
    ld   a, (LOCO_KEYCNT)
    sub  2
    jr   z, __KD_APPLY
    ld   b, a               ; B = how many characters were given
    ld   hl, LOCO_KEYTMP + 7
__KD_CHK:
    ld   a, (hl)
    or   a
    jp   nz, __KY_BAD
    inc  hl
    inc  hl
    djnz __KD_CHK
__KD_APPLY:
    ld   a, (LOCO_KEYTMP + 4)
    neg                     ; repeat 1 is B = &FF
    ld   b, a
    ld   a, (LOCO_KEYTMP + 2)
    call .core.__FW_CALL
    defw $BB39              ; KM SET REPEAT
    ld   a, (LOCO_KEYCNT)
    cp   3
    jr   c, __KD_DONE
    ld   a, (LOCO_KEYTMP + 6)
    ld   b, a
    ld   a, (LOCO_KEYTMP + 2)
    call .core.__FW_CALL
    defw $BB27              ; KM SET TRANSLATE
    ld   a, (LOCO_KEYCNT)
    cp   4
    jr   c, __KD_DONE
    ld   a, (LOCO_KEYTMP + 8)
    ld   b, a
    ld   a, (LOCO_KEYTMP + 2)
    call .core.__FW_CALL
    defw $BB2D              ; KM SET SHIFT
    ld   a, (LOCO_KEYCNT)
    cp   5
    jr   c, __KD_DONE
    ld   a, (LOCO_KEYTMP + 10)
    ld   b, a
    ld   a, (LOCO_KEYTMP + 2)
    call .core.__FW_CALL
    defw $BB33              ; KM SET CONTROL
__KD_DONE:
    ld   hl, (LOCO_KEYTMP)
    jp   (hl)

__LOCO_SPEEDKEY:
    pop  de                 ; the return address
    pop  bc                 ; BC = a
    push de
    ld   a, b
    or   a
    jp   nz, __KY_BAD
    ld   a, c
    or   a
    jp   z, __KY_BAD
    ld   a, h
    or   a
    jp   nz, __KY_BAD
    ld   a, l
    or   a
    jp   z, __KY_BAD
    ld   h, c               ; H = the start-up delay, L = the repeat period
    call .core.__FW_CALL
    defw $BB3F              ; KM SET DELAY
    ret
#endif

; ---- ON BREAK ----------------------------------------------------------------
__LOCO_ONBREAK:
    ld   (LOCO_BRKON), a
    ret

__LOCO_CHKBRK:
    push af
    ld   a, (LOCO_BRKON)
    or   a
    jr   z, __CB_NONE
    push hl                 ; the line number
#ifdef CPC_BAREMETAL
    ld   de, $0801          ; row 8: ESC is its bit 2
    call __CPC_KSCAN_ROWS
    ld   a, (__CPC_KEYS + 8)
    and  4
#else
    ld   a, 66              ; ESC
    call .core.__FW_CALL
    defw $BB1E              ; KM TEST KEY: NZ = pressed
#endif
    pop  hl
    jr   nz, __CB_HIT
__CB_NONE:
    pop  af
    pop  hl                 ; the return address
    ex   (sp), hl           ; HL as the caller had it; the return address on top
    ret
__CB_HIT:                   ; HL = the line number (65535: the statement has none)
#ifndef CPC_BAREMETAL
    call __LOCO_STOPAT
    jp   __CPC_END
#else
    ; ON BREAK STOP is E270 in a bare build, so this is never reached.
    jp   __CPC_END
#endif

    pop namespace
