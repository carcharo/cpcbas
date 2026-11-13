; -----------------------------------------------------------------------
; lib/loco/beep.asm -- BEEP duration, pitch with run-time values
;
; Written from scratch for this project (MIT, see lib/LICENSE).
;
; The statement's arithmetic in one routine, firmware and bare builds alike (L5-GAP). A BEEP
; whose two arguments are constants is folded by the compiler into the period and the duration
; and calls __BEEPER directly.
;
;   __LOCO_BEEP   duration (REAL) pushed as `param` pushes a REAL (the stack operand of
;                 __LOCO_FADD), pitch (REAL) in A E D C B. The routine pops the duration.
;                 The pitch is held to -60..127 and the duration to 0..10 seconds (a value
;                 beyond a limit becomes the limit), then
;                   duration in 1/100 s = CINT(duration * 100)
;                   tone period         = CINT(EXP(pitch * -LN(2) / 12) * 62500 / 261.62556529)
;                 and __BEEPER plays it (period pushed, duration in HL). Not re-entrant (the
;                 pitch and the return address wait in two private cells). Clobbers AF, BC, DE, HL
;                 and what __LOCO_EXP, __LOCO_CINT and __BEEPER clobber.
; -----------------------------------------------------------------------

#include once <loco/realfn.asm>
#include once <loco/fmath.asm>
#include once <io/sound/beeper.asm>

    push namespace core

__LOCO_BEEP:
    push bc                 ; the pitch is a stack operand for MIN and MAX
    push de
    push af
    ld   a, 0
    ld   de, 0
    ld   bc, 34686          ; 127
    push bc
    push de
    push af
    call __LOCO_MINF
    push bc
    push de
    push af
    ld   a, 0
    ld   de, 0
    ld   bc, 34544          ; -60
    push bc
    push de
    push af
    call __LOCO_MAXF
    ld   hl, __BEEP_P
    call __RFN_MM_SAVE      ; the pitch, held
    pop  hl                 ; return address
    ld   (__BEEP_RET), hl   ; the duration is on top of the stack now
    ld   a, 0
    ld   de, 0
    ld   bc, 33824          ; 10
    push bc
    push de
    push af
    call __LOCO_MINF
    push bc
    push de
    push af
    xor  a
    ld   d, a
    ld   e, a
    ld   b, a
    ld   c, a               ; 0
    push bc
    push de
    push af
    call __LOCO_MAXF
    push bc
    push de
    push af
    ld   a, 0
    ld   de, 0
    ld   bc, 34632          ; 100
    call __LOCO_FMUL
    call __LOCO_CINT
    push hl                 ; the duration in 1/100 s
    ld   hl, __BEEP_P
    call __RFN_MM_LOAD
    push bc
    push de
    push af
    ld   a, 246
    ld   de, 38943
    ld   bc, 31980          ; -LN(2) / 12
    call __LOCO_FMUL
    call __LOCO_EXP
    push bc
    push de
    push af
    ld   a, 90
    ld   de, 58394
    ld   bc, 34926          ; 62500 / 261.62556529
    call __LOCO_FMUL
    call __LOCO_CINT        ; HL = the period
    ex   (sp), hl           ; HL = the duration, the period on the stack
    ld   de, (__BEEP_RET)
    push de
    jp   __BEEPER

__BEEP_P:   DEFS 5
__BEEP_RET: DEFW 0

    pop namespace
