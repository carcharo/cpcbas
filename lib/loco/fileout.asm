; -----------------------------------------------------------------------
; lib/loco/fileout.asm -- files, the output side: OPENOUT, CLOSEOUT, the device table of `#9`
; (PRINT #9, WRITE #9) and SAVE (L4-FILES)
;
; Written from scratch for this project (MIT, see lib/LICENSE).
;
; Clobbers: see each entry. Firmware builds only. The output stream owns a 2 KB AMSDOS buffer under the private block:
; the top 2 KB when no input file is used (file.asm not linked), the 2 KB below the input
; stream's when it is (codegen/memory-map.ts, lib/README.md; the link defines
; __LOCO_FILE_IN when file.asm is part of the program). State: lib/loco/vars.asm.
;
; Entry points (namespace core). The firmware calls go through the gate with IX kept; every entry
; clobbers AF, BC, DE, HL, BC', DE', HL' and AF' (the gate) unless it says otherwise.
;
;   __LOCO_OPENOUT  HL = the name (a string, 0 empty), A = non-zero when it is a temporary.
;                   Error 27 when an output file is open already, error 32 (DERR set) when
;                   AMSDOS cannot open it. Opens the device of stream #9: window.asm's
;                   __LOCO_STREAM reads LOCO_FDEVVEC, which is set here and cleared by CLOSEOUT.
;   __LOCO_CLOSEOUT closes the output file (AMSDOS writes the last block and gives the file its
;                   name); nothing happens when none is open.
;   __LOCO_SAVE     HL = the name, A = free flag; stack: the address, the length, the entry
;                   address (pushed in that order). Writes a binary file (type 2) with CAS OUT
;                   DIRECT. An open file of either stream is abandoned first (__FL_ABANDON).
;
; The device table of stream #9 (docs/ir.md "Streams"; the three jumps txt.asm calls through
; LOCO_DEVVEC): __LOCO_FPUT puts the byte A with every register preserved (a CR is a line end,
; the column counts the bytes of 32 and above, and a byte that finds the line at 255 characters
; is preceded by CR LF, as the interpreter does); __LOCO_FCOLW gives E = the column less one and
; H = the width, 255; __LOCO_FNL is PRINT's line end (CR LF, no wrap test). A byte the firmware
; refuses is error 31 (nothing open) or error 32 with DERR (a disc error).
;
; Firmware entries called: CAS OUT OPEN (&BC8C), CAS OUT CLOSE (&BC8F), CAS OUT ABANDON (&BC92),
; CAS OUT CHAR (&BC95), CAS OUT DIRECT (&BC98).
; -----------------------------------------------------------------------

#include once <error.asm>
#include once <fwcall.asm>
#include once <sysvars.asm>
#include once <loco/vars.asm>
#include once <loco/filecom.asm>

    push namespace core

#ifndef CPC_BAREMETAL

#ifdef __LOCO_FILE_IN
__LOCO_FOUTBUF  EQU SYSVAR_BASE - $1000
#else
__LOCO_FOUTBUF  EQU SYSVAR_BASE - $800
#endif

__LOCO_OPENOUT:
    call __FL_NAMEPUSH
    call __FL_INIT
    ld   a, (LOCO_FFLAG)
    and  2
    jr   nz, __OO_BUSY
    ld   hl, 32
    add  hl, sp
    ld   b, (hl)
    ld   hl, 0
    add  hl, sp
    ld   de, __LOCO_FOUTBUF
    call .core.__FW_CALL_IX
    defw $BC8C              ; CAS OUT OPEN: Carry = opened
    ld   (LOCO_FERR), a
    sbc  a, a
    ld   (LOCO_FOK), a
    ld   hl, 34
    add  hl, sp
    ld   sp, hl
    ld   a, (LOCO_FOK)
    or   a
    jp   z, __FL_FAIL
    ld   hl, LOCO_FFLAG
    set  1, (hl)
    xor  a
    ld   (LOCO_FCOL), a
    ld   hl, __LOCO_FDEVTAB
    ld   (LOCO_FDEVVEC), hl
    ret
__OO_BUSY:
    ld   hl, 34
    add  hl, sp
    ld   sp, hl
    ld   a, 27
    jp   __ERROR

__LOCO_CLOSEOUT:
    ld   a, (LOCO_FFLAG)
    and  2
    ret  z
    call .core.__FW_CALL_IX
    defw $BC8F              ; CAS OUT CLOSE
    ld   (LOCO_FERR), a
    ld   hl, LOCO_FFLAG
    res  1, (hl)
    ld   hl, 0
    ld   (LOCO_FDEVVEC), hl
    ret  c
    jp   __FL_FAIL

; ---- SAVE --------------------------------------------------------------------------
; The stack after __FL_NAMEPUSH: the name block (34), the return address, the entry address,
; the length, the address.
__LOCO_SAVE:
    call __FL_NAMEPUSH
    call __FL_ABANDON
    call __FL_INIT
    ld   hl, 32
    add  hl, sp
    ld   b, (hl)
    ld   hl, 0
    add  hl, sp
    ld   de, __LOCO_FOUTBUF
    call .core.__FW_CALL_IX
    defw $BC8C              ; CAS OUT OPEN
    jr   c, __SV_OPEN
    ld   (LOCO_FERR), a
    jp   __FL_FAIL
__SV_OPEN:
    ld   hl, 36
    add  hl, sp
    ld   c, (hl)
    inc  hl
    ld   b, (hl)            ; BC = the entry address
    inc  hl
    ld   e, (hl)
    inc  hl
    ld   d, (hl)            ; DE = the length
    inc  hl
    ld   a, (hl)
    inc  hl
    ld   h, (hl)
    ld   l, a               ; HL = the address
    ld   a, 2               ; a binary file
    call .core.__FW_CALL_IX
    defw $BC98              ; CAS OUT DIRECT
    jr   c, __SV_WROTE
    ld   (LOCO_FERR), a
    call .core.__FW_CALL_IX
    defw $BC92              ; CAS OUT ABANDON
    jp   __FL_FAIL
__SV_WROTE:
    call .core.__FW_CALL_IX
    defw $BC8F              ; CAS OUT CLOSE
    jr   c, __SV_DONE
    ld   (LOCO_FERR), a
    jp   __FL_FAIL
__SV_DONE:
    ld   hl, 34
    add  hl, sp
    ld   sp, hl
    pop  hl                 ; the return address
    pop  de
    pop  de
    pop  de                 ; the three arguments
    jp   (hl)

; ---- the device table of #9 ------------------------------------------------------------
__LOCO_FDEVTAB:
    jp   __LOCO_FPUT
    jp   __LOCO_FCOLW
    jp   __LOCO_FNL

__FP_RAW:                   ; A = a byte for CAS OUT CHAR; a refusal is an error
    call .core.__FW_CALL_IX
    defw $BC95
    ret  c
    ld   (LOCO_FERR), a
    jp   z, __FL_FAIL       ; Zero: a hard error (ESC, a disc error)
    ld   a, 31              ; the stream is not open
    jp   __ERROR

__LOCO_FPUT:
    push af
    push bc
    push de
    push hl
    ld   c, a
    ld   a, (LOCO_FCOL)
    cp   255
    jr   nz, __FP_PUT
    ld   a, 13              ; the line is full: CR LF first
    call __FP_RAW
    ld   a, 10
    call __FP_RAW
    xor  a
    ld   (LOCO_FCOL), a
__FP_PUT:
    ld   a, c
    call __FP_RAW
    ld   a, c
    cp   13
    jr   nz, __FP_NOCR
    xor  a
    ld   (LOCO_FCOL), a
    jr   __FP_DONE
__FP_NOCR:
    cp   32
    jr   c, __FP_DONE       ; the other control codes do not move the column
    ld   hl, LOCO_FCOL
    inc  (hl)
__FP_DONE:
    pop  hl
    pop  de
    pop  bc
    pop  af
    ret

__LOCO_FCOLW:
    ld   a, (LOCO_FCOL)
    ld   e, a
    ld   h, 255
    ld   d, 0
    ld   l, 0
    ret

__LOCO_FNL:
    push af
    ld   a, 13
    call __FP_RAW
    ld   a, 10
    call __FP_RAW
    xor  a
    ld   (LOCO_FCOL), a
    pop  af
    ret

#endif

    pop namespace
