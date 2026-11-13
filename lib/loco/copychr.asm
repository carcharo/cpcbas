; -----------------------------------------------------------------------
; lib/loco/copychr.asm -- Locomotive text layer: COPYCHR$(#s)
;
; Written from scratch for this project (MIT, see lib/LICENSE).
;
;   __LOCO_COPYCHR   A = stream 0-7, else error 5 (the printer and the file
;                    cannot be read). Exit: HL = the character at the stream's
;                    cursor as a new heap string of one byte, or 0 (the empty
;                    string) when the firmware does not recognise one there
;                    (measured: an empty string, ASC of which is error 5).
;                    TXT RD CHAR (&BB60) with the stream selected for the read
;                    and the previous one selected again (TXT STR SELECT
;                    &BBB4). Firmware builds only: a bare build refuses
;                    COPYCHR$ (E270). Clobbers AF, BC, DE, HL (+ the gate).
; -----------------------------------------------------------------------

#include once <error.asm>
#include once <fwcall.asm>
#include once <loco/str.asm>

    push namespace core

#ifdef CPC_BAREMETAL
__LOCO_COPYCHR:             ; never called: the checker refuses COPYCHR$ in a bare build (E270)
    ld   a, 5
    jp   __ERROR
#else
__LOCO_COPYCHR:
    cp   8
    jr   c, __CC_OK
    ld   a, 5
    jp   __ERROR
__CC_OK:
    call .core.__FW_CALL
    defw $BBB4              ; TXT STR SELECT: A = the stream that was selected
    ld   b, a
    call .core.__FW_CALL
    defw $BB60              ; TXT RD CHAR: Carry and A = the character, or no Carry
    push af
    ld   a, b
    call .core.__FW_CALL
    defw $BBB4
    pop  af
    ld   hl, 0
    ret  nc                 ; none recognised: the empty string
    ld   hl, 1
    jp   __LOCO_FILL        ; A = the byte -> a new one-byte string
#endif

    pop namespace
