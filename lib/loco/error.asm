; -----------------------------------------------------------------------
; lib/loco/error.asm -- ON ERROR GOTO, RESUME, ERR, ERL, ERROR, the error mark,
; the non-fatal REAL errors and the main-program RETURN check (L4-ERR)
;
; Written from scratch for this project (MIT, see lib/LICENSE).
;
; Contract: docs/ir.md "Events and errors". Every runtime error goes to
; __ERROR (runtime/error.asm) with A = the Locomotive error number. When
; LOCO_ERRTRAP is non-zero __ERROR jumps there (to __LOCO_TRAP below) with the
; number in A; otherwise it prints "Error n" and resets (__ERROR_FATAL).
;
; State (lib/loco/vars.asm):
;   LOCO_ERRTRAP  DW  the trap routine, 0 = no handler
;   LOCO_ERRHAND  DW  the ON ERROR GOTO target
;   LOCO_ERRPOS   6B  the mark of the main-program statement in progress:
;                     the address of the mark's `defw line`, SP, IX
;   LOCO_ERRAT    6B  a copy of LOCO_ERRPOS taken when the error was trapped
;                     (ERL and RESUME read this one: the handler's own
;                     statements move LOCO_ERRPOS)
;   LOCO_ERRNUM   DB  ERR: the trapped error's number; reset to 0 by RESUME
;                     (measured on the interpreter, loco-measured.md), ERL stays
;   LOCO_ERRBUSY  DB  non-zero in error processing, from the trap to RESUME
;
; The mark a program with ON ERROR GOTO n has at the start of every main-program
; statement (src/ir/lower/errors.ts):
;       call __LOCO_MARK
;       defw <line>          ; the statement's line number, 0 when it has none
;       defw <next>          ; the RESUME NEXT point
; The restart point of RESUME is the `call` (the stored address minus 3).
;
;   __LOCO_MARK         the mark (above). Clobbers HL.
;   __LOCO_ONERR        HL = the handler address; sets LOCO_ERRHAND and LOCO_ERRTRAP.
;   __LOCO_ONERR0       ON ERROR GOTO 0: clears both; in error processing the pending
;                       error becomes fatal at once.
;   __LOCO_TRAP         A = the error number. Fatal when already in error processing or
;                       before the first mark; otherwise ERR = A, the mark is copied,
;                       SP and IX come from it, and the handler runs. Never returns.
;   __LOCO_RESUME       RESUME: runs the statement again.  __LOCO_RESUMENEXT: RESUME NEXT.
;   __LOCO_RESUMETO     RESUME n, HL = the target. Each ends error processing, sets ERR to
;                       0, restores SP and IX and jumps. Outside error processing: error
;                       20 (Unexpected RESUME). Never return.
;   __LOCO_ERROR        ERROR n, HL = n (1..255; anything else is error 5). Never returns.
;   __LOCO_ERR          -> HL = ERR.  __LOCO_ERL -> HL = the trapped statement's line (0
;                       before an error and for a line without a number).
;   __LOCO_RETCHK       before a main-program RETURN: error 3 (Unexpected RETURN) when no
;                       GOSUB is pending, that is, SP is the main stack base. Clobbers AF, DE, HL.
;   __LOCO_SOFTERR      A = 6 or 11 (Overflow, Division by zero), the REAL errors that
;                       Locomotive does not stop for (firmware builds). With a handler set
;                       and no error being processed it raises the error; otherwise it
;                       prints the error's name on the current line, CR LF, and returns for
;                       the caller to go on with the firmware's result. Preserves BC, DE, HL,
;                       IX; loses A and F. Bare builds raise the error always.
;
; Firmware entries called (through the gate): TXT STR SELECT (&BBB4) in the trap, and
; through error.asm's output path TXT OUTPUT (&BB5A) and the printer echo.
; -----------------------------------------------------------------------

#include once <error.asm>
#include once <loco/vars.asm>
#include once <fwcall.asm>

    push namespace core

__LOCO_MARK:
    pop  hl                     ; HL = the address of `defw line`; SP is the statement's
    ld   (LOCO_ERRPOS), hl
    ld   (LOCO_ERRPOS + 2), sp
    ld   (LOCO_ERRPOS + 4), ix
    inc  hl
    inc  hl
    inc  hl
    inc  hl
    jp   (hl)                   ; past the two words

__LOCO_ONERR:
    ld   (LOCO_ERRHAND), hl
    ld   hl, __LOCO_TRAP
    ld   (LOCO_ERRTRAP), hl
    ret

__LOCO_ONERR0:
    ld   a, (LOCO_ERRBUSY)
    or   a
    jr   z, __ONERR0_CLEAR
    ld   a, (LOCO_ERRNUM)       ; the pending error is fatal at once
    jr   __TRAP_FATAL
__ONERR0_CLEAR:
    ld   hl, 0
    ld   (LOCO_ERRHAND), hl
    ld   (LOCO_ERRTRAP), hl
    ret

__LOCO_TRAP:
    ld   c, a
    ld   hl, (LOCO_ERRPOS)
    ld   a, h
    or   l
    jr   z, __TRAP_FATAL_C      ; no statement has been marked yet
    ld   a, (LOCO_ERRBUSY)
    or   a
    jr   nz, __TRAP_FATAL_C     ; an error inside the handler
    inc  a
    ld   (LOCO_ERRBUSY), a
    ld   a, c
    ld   (LOCO_ERRNUM), a
    ld   hl, LOCO_ERRPOS
    ld   de, LOCO_ERRAT
    ld   bc, 6
    ldir
    xor  a
    ld   (LOCO_DEV), a          ; output goes to the screen again (docs/ir.md "Streams")
#ifdef CPC_BAREMETAL
    ld   hl, (FP_STKBOT)        ; the calculator's operands of the failed statement are dead
    ld   (FP_STKEND), hl
#else
    call .core.__FW_CALL        ; TXT STR SELECT, A = 0: text stream 0
    defw $BBB4
#endif
    ld   sp, (LOCO_ERRAT + 2)
    ld   ix, (LOCO_ERRAT + 4)
    ei
    ld   hl, (LOCO_ERRHAND)
    jp   (hl)

__TRAP_FATAL_C:
    ld   a, c
__TRAP_FATAL:
    ld   hl, 0
    ld   (LOCO_ERRTRAP), hl
    jp   __ERROR_FATAL

; ---- RESUME ----------------------------------------------------------------
__LOCO_RESUME:
    ld   a, (LOCO_ERRBUSY)
    or   a
    jr   z, __RESUME_BAD
    ld   hl, (LOCO_ERRAT)
    dec  hl
    dec  hl
    dec  hl
    jr   __RESUME_GO

__LOCO_RESUMENEXT:
    ld   a, (LOCO_ERRBUSY)
    or   a
    jr   z, __RESUME_BAD
    ld   hl, (LOCO_ERRAT)
    inc  hl
    inc  hl
    ld   a, (hl)
    inc  hl
    ld   h, (hl)
    ld   l, a
    jr   __RESUME_GO

__LOCO_RESUMETO:
    ld   a, (LOCO_ERRBUSY)
    or   a
    jr   z, __RESUME_BAD
__RESUME_GO:
    xor  a
    ld   (LOCO_ERRBUSY), a
    ld   (LOCO_ERRNUM), a
    ld   sp, (LOCO_ERRAT + 2)
    ld   ix, (LOCO_ERRAT + 4)
    jp   (hl)

__RESUME_BAD:
    ld   a, 20                  ; Unexpected RESUME
    jp   __ERROR

; ---- ERROR n, ERR, ERL ---------------------------------------------------------
__LOCO_ERROR:
    ld   a, h
    or   a
    jr   nz, __ERROR_ARG
    ld   a, l
    or   a
    jp   nz, __ERROR
__ERROR_ARG:
    ld   a, 5                   ; Improper argument
    jp   __ERROR

__LOCO_ERR:
    ld   a, (LOCO_ERRNUM)
    ld   l, a
    ld   h, 0
    ret

__LOCO_ERL:
    ld   hl, (LOCO_ERRAT)
    ld   a, h
    or   l
    ret  z
    ld   a, (hl)
    inc  hl
    ld   h, (hl)
    ld   l, a
    ret

; ---- RETURN with no GOSUB pending ------------------------------------------------
__LOCO_RETCHK:
    ld   hl, 2
    add  hl, sp                 ; SP of the RETURN statement, past our return address
    ld   de, CPC_STACK_TOP
    or   a
    sbc  hl, de
    ld   a, h
    or   l
    ret  nz
    ld   a, 3                   ; Unexpected RETURN
    jp   __ERROR

; ---- Overflow and Division by zero that carry on ---------------------------------
#ifdef CPC_BAREMETAL
__LOCO_SOFTERR:
    jp   __ERROR                ; bare builds: the calculator abandons its own stack at the raise
#else
__LOCO_SOFTERR:
    push hl
    push bc
    ld   c, a
    ld   hl, (LOCO_ERRTRAP)
    ld   a, h
    or   l
    jr   z, __SOFT_PRINT
    ld   a, (LOCO_ERRBUSY)
    or   a
    jr   nz, __SOFT_PRINT
    ld   a, c
    jp   __ERROR                ; a handler is set: raise (the stack is dropped by the trap)
__SOFT_PRINT:
    ld   hl, __SOFT_OVERFLOW
    ld   a, c
    cp   11
    jr   nz, __SOFT_LOOP
    ld   hl, __SOFT_DIVZERO
__SOFT_LOOP:
    ld   a, (hl)
    or   a
    jr   z, __SOFT_END
    inc  hl
    call __ERR_OUT
    jr   __SOFT_LOOP
__SOFT_END:
    ld   a, 13
    call __ERR_SCR              ; the screen gets CR LF, the printer echo a bare LF (as __ERROR does)
    ld   a, 10
    call __ERR_OUT
    pop  bc
    pop  hl
    ret

__SOFT_OVERFLOW: DEFB "Overflow", 0
__SOFT_DIVZERO:  DEFB "Division by zero", 0
#endif

    pop namespace
