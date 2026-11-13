; echo.asm -- the printer hook of the Locomotive printer-diff harness (tools/loco-diff.py).
;
; Installed by the harness loader (RUN.BAS: MEMORY &8FFF, LOAD "ECHO.BIN", CALL &9000). It patches the
; TXT OUT ACTION indirection (&BDD9, a 3-byte JP in RAM on the 464 and the 6128) so that every byte
; the interpreter sends to the text screen also goes to the printer (MC PRINT CHAR, &BD2B), then
; continues with the original routine. Filter: 13 becomes the
; line end 10, 10 and every other code below 32 are dropped, the rest is echoed as it is.
; When "Ready" appears at the start of a line, the interpreter has finished the program: the hook
; then sends the END marker (4, "END", 10) after it, which stops the emulator run.
;
; Built with UNFILTERED defined (loco-diff.py --unfiltered) it echoes every byte untouched, for probes.
;
; Built with SHOT defined (screenshot runs, `REM LOCO: shot`) the interpreter's own "Ready" is never drawn: the hook
; holds back the characters of a line-start "Ready" (they are drawn only if the line turns out to be something else),
; and when "Ready" is complete it sends the END marker and stops there, in a loop, with interrupts on. The screen is then
; exactly what the program left (no "Ready", no prompt cursor), which is what a compiled program leaves when it ends
; without the printer echo (it waits for a key). The emulator takes the shot a fixed time after the start.
;
; Registers: all preserved (the indirection is called from TXT OUTPUT, which preserves them).

        org     $9000

install:
        ld      hl, $BDD9
        ld      de, orig
        ld      bc, 3
        ldir                    ; keep the original indirection (JP routine) to continue with
        di
        ld      hl, $BDD9
        ld      (hl), $C3       ; JP hook
        inc     hl
        ld      (hl), hook & $FF
        inc     hl
        ld      (hl), hook >> 8
        ei
        ret

hook:
        push    af
        push    bc
        push    de
        push    hl
        ld      e, a
#ifdef SHOT
        cp      32
        call    c, flush        ; a control code while part of "Ready" is held back: draw what was held
#endif
#ifdef UNFILTERED
        call    send            ; probe build: every byte as the interpreter sent it
        ld      a, e
#endif
        cp      13
        jr      z, is_cr
        cp      10
        jr      z, done
        cp      32
        jr      c, done
#ifndef UNFILTERED
        call    send            ; a printable byte: echo it as it is
#endif
        ld      a, (matched)
        ld      c, a
        or      a
        jr      nz, compare
        ld      a, (linestart)
        or      a
        jr      z, nomatch
compare:
        ld      b, 0
        ld      hl, ready
        add     hl, bc
        ld      a, (hl)
        cp      e
        jr      nz, nomatch
        inc     c
        ld      a, c
        ld      (matched), a
        xor     a
        ld      (linestart), a
        ld      a, c
        cp      5
#ifdef SHOT
        jr      nz, held
#else
        jr      nz, done
#endif
        xor     a               ; "Ready" complete: send the END marker
        ld      (matched), a
        ld      hl, marker
mloop:
        ld      a, (hl)
        or      a
#ifdef SHOT
        jr      z, hold
#else
        jr      z, done
#endif
        inc     hl
        push    hl
        call    send
        pop     hl
        jr      mloop
nomatch:
#ifdef SHOT
        call    flush           ; not "Ready" after all: draw the characters held back
#endif
        xor     a
        ld      (matched), a
        ld      (linestart), a
        jr      done
is_cr:
        xor     a
        ld      (matched), a
        inc     a
        ld      (linestart), a
#ifndef UNFILTERED
        ld      a, 10
        call    send
#endif
done:
        pop     hl
        pop     de
        pop     bc
        pop     af
        jp      orig

#ifdef SHOT
held:                           ; a character of "Ready": not drawn
        pop     hl
        pop     de
        pop     bc
        pop     af
        ret

hold:                           ; the program is over and its screen is complete: wait for the shot
        ei
hold1:  halt
        jr      hold1

; flush: draw the held-back characters of "Ready" (matched of them) through the original routine, matched := 0.
; Preserves everything.
flush:
        push    af
        push    bc
        push    de
        push    hl
        ld      a, (matched)
        or      a
        jr      z, flush2
        ld      b, a
        ld      hl, ready
flush1: ld      a, (hl)
        push    hl
        push    bc
        call    orig
        pop     bc
        pop     hl
        inc     hl
        djnz    flush1
        xor     a
        ld      (matched), a
flush2: pop     hl
        pop     de
        pop     bc
        pop     af
        ret
#endif

; send: A to the printer, up to 3 tries (a busy printer makes MC PRINT CHAR give up), as the
; compiled runtime's __PRN_ECHO does.
send:
        push    de
        ld      b, 3
send1:
        push    bc
        call    $BD2B
        pop     bc
        jr      c, send2
        djnz    send1
send2:
        pop     de
        ret

ready:  defb    "Ready"
marker: defb    4, "END", 10, 0
matched: defb   0
linestart: defb 1
orig:   defs    3
