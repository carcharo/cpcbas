; -----------------------------------------------------------------------
; lib/loco/txtout.asm -- Locomotive text layer: character output (the part that prints)
;
; Written from scratch for this project (MIT, see lib/LICENSE). Split out of txt.asm by L5-HOT (follow-up 186):
; in a bare build __LOCO_PUTC calls the glyph renderer, and txtglyph.asm brings the glyph table (1 792 bytes) and
; an `#init` that installs the renderer, so what includes this file is what prints. A program that only reads the
; cursor or clears the screen (txt.asm's __LOCO_CURSOR, __LOCO_COLW) no longer links them; the runtime's error text
; has a mini font of its own (error.asm). The entries are documented in txt.asm's header:
;
;   __LOCO_PUTC     A = byte -> text screen (and the printer echo)
;   __LOCO_NL       CR then LF
;   __LOCO_ECHO     (only with __CPC_PRINTER_ECHO__) A = byte -> printer, filtered
;
; Clobbers: as txt.asm's header says for each entry (PUTC: A, BC, DE, HL preserved; NL: A clobbered; ECHO: none).
; -----------------------------------------------------------------------

#include once <fwcall.asm>
#include once <sysvars.asm>
#include once <loco/vars.asm>
#ifdef CPC_BAREMETAL
#include once <txtglyph.asm>
#ifdef __CPC_PRINTER_ECHO__
#include once <bareboot.asm>
#endif
#endif

    push namespace core

#ifdef __CPC_PRINTER_ECHO__
__LOCO_ECHO:
    PROC
    LOCAL __LE_NOTCR, __LE_SEND, __LE_DONE
    push af
    cp   13
    jr   nz, __LE_NOTCR
    ld   a, 10              ; the line end
    jr   __LE_SEND
__LE_NOTCR:
    cp   32
    jr   c, __LE_DONE       ; 10 and the other control codes: not echoed
__LE_SEND:
#ifdef CPC_BAREMETAL
    push bc
    push de
    call __CPC_PRN_CHAR
    pop  de
    pop  bc
#else
    PROC
    LOCAL __LE_TRY, __LE_SENT
    push bc
    ld   b, 3
__LE_TRY:
    call .core.__FW_CALL
    defw $BD2B              ; MC PRINT CHAR: Carry = sent
    jr   c, __LE_SENT
    djnz __LE_TRY
__LE_SENT:
    pop  bc
    ENDP
#endif
__LE_DONE:
    pop  af
    ret
    ENDP
#endif

__LOCO_PUTC:
#ifndef CPC_BAREMETAL
    push af
    ld   a, (LOCO_DEV)
    or   a
    jr   nz, __LOCO_PUTC_DEV
    pop  af
#endif
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
#else
    call .core.__FW_CALL
    defw $BB5A              ; TXT OUTPUT: preserves every register
#endif
#ifdef __CPC_PRINTER_ECHO__
    call __LOCO_ECHO
#endif
    ret

#ifndef CPC_BAREMETAL
__LOCO_PUTC_DEV:            ; another device: the table's first entry, with A and HL as they were
    pop  af
    push hl
    ld   hl, (LOCO_DEVVEC)
    ex   (sp), hl
    ret
#endif

__LOCO_NL:
#ifndef CPC_BAREMETAL
    ld   a, (LOCO_DEV)
    or   a
    jr   z, __LOCO_NL0
    push hl                 ; the table's third entry (BC, DE, HL preserved by it)
    ld   hl, (LOCO_DEVVEC)
    inc  hl
    inc  hl
    inc  hl
    inc  hl
    inc  hl
    inc  hl
    ex   (sp), hl
    ret
__LOCO_NL0:
#endif
    ld   a, 13
    call __LOCO_PUTC
    ld   a, 10
    jp   __LOCO_PUTC

    pop namespace
