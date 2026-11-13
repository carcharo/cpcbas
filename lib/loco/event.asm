; -----------------------------------------------------------------------
; lib/loco/event.asm -- EVERY, AFTER, REMAIN, DI, EI and TIME
;
; Written from scratch for this project (MIT, see lib/LICENSE).
;
; Four timers, 0-3; timer 3 has the highest priority. A handler is a
; main-program GOSUB target. It runs only at a statement boundary, from the
; poll (__EVENT_POLL), which the lowering emits at every statement start of a
; program that uses EVERY or AFTER (docs/ir.md "Events and errors", "Events").
; Behaviour measured on the interpreter
; ("EVERY, AFTER, REMAIN, DI, EI, TIME"): n = 0 stops the timer; a negative n
; or a timer outside 0-3 is error 5; a kick that arrives while DI is in force
; (or while a handler of higher or equal priority runs) is remembered, so every
; missed period runs its handler later; a handler is interrupted only by a
; higher timer; the RETURN of a handler re-enables (clears DI).
;
; State (the private block, lib/loco/vars.asm "L4-EVENTS"): the pending count
; of each timer (at most 127, as the firmware kernel's own count), the handler
; addresses, the running priority (0 none, else timer + 1), the DI flag, and
; one summary byte LOCO_EVSUM, non-zero when some timer is pending and DI is
; off. The poll tests only that byte when nothing is due (about 45 T-states in
; firmware builds); the kick routine, DI, EI, REMAIN, EVERY/AFTER and the
; dispatcher keep it up to date with interrupts off.
;
; Firmware builds: one 13-byte tick block per timer (KL ADD TICKER &BCE9,
; KL DEL TICKER &BCEC, KL INIT EVENT &BCEF), an asynchronous far event (class
; &80, ROM select &FF, as framehook.asm) whose routine only adds one to the
; timer's pending count. EVERY n: count n, recharge n. AFTER n: count n,
; recharge 0 (the firmware removes the block when it expires). The timers
; stop while the library's game mode is on, as the firmware's clock does.
; Bare builds: no interrupt code. The poll compares the low word of the frame
; counter FH_FRAMES (counted by framecore.asm) with the value it last saw and
; counts every running timer down by the difference, so no tick is lost while
; one statement runs for up to 65535 frames. TIME is FH_FRAMES x 6 there
; (1/50 s resolution).
;
; Around a handler the dispatcher saves and restores the running priority,
; LOCO_ERRPOS (6 bytes), LOCO_DEV (set to 0 for the handler) and, in firmware
; builds, the text stream (TXT STR SELECT &BBB4 with 0).
;
; Entry points (namespace core). "Clobbers" lists registers changed; the stack
; is balanced.
;
;   __EVENT_POLL     no arguments. Returns at once when nothing is due. Else runs
;                    every due handler of a priority above the running one,
;                    highest first. Fast path clobbers AF (firmware) or AF, DE,
;                    HL (bare); the slow path preserves every register.
;   __LOCO_EVERY     HL = the handler address; stack (bottom to top): n, t, both
;   __LOCO_AFTER     16-bit and popped by the routine. n in 1/50 s (0 stops the
;                    timer), t = 0-3. Errors 5: n < 0, t outside 0-3. Replaces what
;                    the timer did and clears its pending count.
;                    Clobbers AF, BC, DE, HL (+ the gate).
;   __LOCO_REMAIN    HL = t -> HL = what is left of timer t (0 when it is not
;                    running); the timer is stopped and its pending count cleared.
;                    Error 5 for t outside 0-3. Clobbers AF, BC, DE, HL (+ the gate).
;   __LOCO_DI        no arguments; handlers stop running. Clobbers AF.
;   __LOCO_EI        no arguments; handlers may run again. Clobbers AF, HL.
;   __LOCO_TIME      -> DEHL = the time in 1/300 s (KL TIME PLEASE &BD0D through
;                    the gate in firmware builds; FH_FRAMES x 6 in bare builds).
;                    Clobbers AF, BC, DE, HL.
;
; Firmware entries called: KL ADD TICKER &BCE9, KL DEL TICKER &BCEC, KL INIT
; EVENT &BCEF, KL TIME PLEASE &BD0D, TXT STR SELECT &BBB4 (all through the gate).

#include once <sysvars.asm>
#include once <loco/vars.asm>
#include once <error.asm>
#ifndef CPC_BAREMETAL
#include once <fwcall.asm>
#endif

    push namespace core

; ---- the poll ----------------------------------------------------------------

#ifndef CPC_BAREMETAL
__EVENT_POLL:
    ld   a, (LOCO_EVSUM)
    or   a
    ret  z
#else
__EVENT_POLL:
    ld   hl, (FH_FRAMES)
    ld   de, (LOCO_EVLAST)
    or   a
    sbc  hl, de
    call nz, __EV_COUNT
    ld   a, (LOCO_EVSUM)
    or   a
    ret  z
#endif
    push af
    push bc
    push de
    push hl
    push ix
    ld   a, (LOCO_EVDI)
    or   a
    jr   nz, __EV_OUT
    call __EV_SCAN
    jr   z, __EV_OUT          ; only timers that the running handler outranks
    ld   hl, (LOCO_ERRPOS)
    push hl
    ld   hl, (LOCO_ERRPOS + 2)
    push hl
    ld   hl, (LOCO_ERRPOS + 4)
    push hl
    ld   a, (LOCO_DEV)
    push af
    xor  a
    ld   (LOCO_DEV), a
#ifndef CPC_BAREMETAL
    call __FW_CALL
    defw $BBB4                ; TXT STR SELECT with A = 0 -> A = the previous stream
    push af
#endif
    ld   a, (LOCO_EVRUN)
    push af                   ; the priority of the interrupted code
    di
__EV_LOOP:
    call __EV_SCAN
    jr   z, __EV_DONE
    dec  (hl)                 ; one kick taken
    ld   a, b
    ld   (LOCO_EVRUN), a      ; the running priority becomes its own
    dec  a
    add  a, a
    ld   e, a
    ld   d, 0
    ld   hl, LOCO_EVHAND
    add  hl, de
    ld   e, (hl)
    inc  hl
    ld   d, (hl)              ; DE = the handler
    call __EV_SUMCALC
    ei
    ld   hl, __EV_RETURNED
    push hl
    push de
    ret                       ; a GOSUB: the handler's RETURN comes back to __EV_RETURNED
__EV_RETURNED:
    di
    xor  a
    ld   (LOCO_EVDI), a       ; the RETURN of an event subroutine re-enables
    pop  af
    push af
    ld   (LOCO_EVRUN), a      ; back to the interrupted priority
    jr   __EV_LOOP
__EV_DONE:
    call __EV_SUMCALC
    pop  af                   ; the interrupted priority (LOCO_EVRUN already holds it)
#ifndef CPC_BAREMETAL
    pop  af
    call __FW_CALL
    defw $BBB4                ; TXT STR SELECT with the previous stream (the gate returns with interrupts on)
#endif
    pop  af
    ld   (LOCO_DEV), a
    pop  hl
    ld   (LOCO_ERRPOS + 4), hl
    pop  hl
    ld   (LOCO_ERRPOS + 2), hl
    pop  hl
    ld   (LOCO_ERRPOS), hl
    ei
__EV_OUT:
    pop  ix
    pop  hl
    pop  de
    pop  bc
    pop  af
    ret

; __EV_SCAN -- the highest timer with a pending kick whose priority is above the
; running one. Exit: NZ with B = its priority (1-4) and HL = its pending byte;
; Z when none. Clobbers AF, BC, HL.
__EV_SCAN:
    ld   a, (LOCO_EVRUN)
    ld   c, a
    ld   b, 4
    ld   hl, LOCO_EVPEND + 3
__EV_SCAN1:
    ld   a, c
    cp   b
    jr   nc, __EV_SCAN0       ; the running priority is not below this one
    ld   a, (hl)
    or   a
    ret  nz
    dec  hl
    djnz __EV_SCAN1
__EV_SCAN0:
    xor  a
    ret

; __EV_SUMCALC -- LOCO_EVSUM = some timer pending and DI off. Call with interrupts
; off. Clobbers AF, HL.
__EV_SUMCALC:
    ld   hl, (LOCO_EVPEND)
    ld   a, h
    or   l
    ld   hl, (LOCO_EVPEND + 2)
    or   h
    or   l
    jr   z, __EV_SUMSET
    ld   a, (LOCO_EVDI)
    or   a
    ld   a, 0
    jr   nz, __EV_SUMSET
    dec  a
__EV_SUMSET:
    ld   (LOCO_EVSUM), a
    ret

; ---- DI, EI -------------------------------------------------------------------

__LOCO_DI:
    ld   a, 1
    ld   (LOCO_EVDI), a
    xor  a
    ld   (LOCO_EVSUM), a
    ret

__LOCO_EI:
    xor  a
    ld   (LOCO_EVDI), a
    di
    call __EV_SUMCALC
    ei
    ret

; ---- EVERY, AFTER, REMAIN -----------------------------------------------------

__EV_BAD:
    ld   a, 5
    jp   __ERROR

__LOCO_EVERY:
    ld   a, 1
    jr   __EV_SET
__LOCO_AFTER:
    xor  a
__EV_SET:                     ; A = 1 for EVERY, HL = handler; stack: return address, t, n
    ld   (LOCO_EVTMP + 2), a
    ld   (LOCO_EVTMP + 4), hl
    pop  hl                   ; return address
    pop  bc                   ; t
    ex   (sp), hl             ; HL = n, the return address in place
    bit  7, h
    jr   nz, __EV_BAD
    ld   a, b
    or   a
    jr   nz, __EV_BAD
    ld   a, c
    cp   4
    jr   nc, __EV_BAD
    ld   (LOCO_EVTMP), hl
    ld   (LOCO_EVTMP + 3), a
#ifndef CPC_BAREMETAL
    call __EV_TB              ; HL = the timer's tick block
    push hl
    call __FW_CALL
    defw $BCEC                ; KL DEL TICKER: what the timer did stops (found or not)
    di
    call __EV_RESET
    ei
    pop  hl                   ; the tick block
    ld   bc, (LOCO_EVTMP)
    ld   a, b
    or   c
    ret  z                    ; n = 0: the timer stays stopped
    push hl
    push bc
    ld   de, 6
    add  hl, de               ; the event block inside the tick block
    ld   a, (LOCO_EVTMP + 3)
    add  a, a
    add  a, a
    ld   c, a
    ld   b, 0
    ld   de, __EV_TICK0
    ex   de, hl
    add  hl, bc
    ex   de, hl               ; DE = this timer's event routine, HL = the event block
    ld   bc, $80FF            ; asynchronous, far address, both ROMs off
    call __FW_CALL
    defw $BCEF                ; KL INIT EVENT
    pop  de                   ; n: the first count
    pop  hl                   ; the tick block
    ld   bc, 0                ; AFTER: no recharge
    ld   a, (LOCO_EVTMP + 2)
    or   a
    jr   z, __EV_SET1
    ld   b, d
    ld   c, e                 ; EVERY: recharge n
__EV_SET1:
    call __FW_CALL
    defw $BCE9                ; KL ADD TICKER
    ret
#else
    call __EV_SYNC
    call __EV_RESET
    ld   a, (LOCO_EVTMP + 3)
    add  a, a
    add  a, a
    ld   e, a
    ld   d, 0
    ld   hl, LOCO_EVBARE
    add  hl, de
    ld   de, (LOCO_EVTMP)
    ld   (hl), e
    inc  hl
    ld   (hl), d              ; count = n (0 leaves the timer stopped)
    inc  hl
    ld   a, (LOCO_EVTMP + 2)
    or   a
    jr   nz, __EV_SET1
    ld   de, 0                ; AFTER: no recharge
__EV_SET1:
    ld   (hl), e
    inc  hl
    ld   (hl), d
    ret
#endif

; __EV_RESET -- handler[t] = LOCO_EVTMP's handler, pending[t] = 0, summary. Interrupts
; off in firmware builds. Exit: DE = t. Clobbers AF, BC, DE, HL.
__EV_RESET:
    ld   a, (LOCO_EVTMP + 3)
    ld   e, a
    ld   d, 0
    ld   hl, LOCO_EVHAND
    add  hl, de
    add  hl, de
    ld   bc, (LOCO_EVTMP + 4)
    ld   (hl), c
    inc  hl
    ld   (hl), b
__EV_CLRP:                    ; DE = t: pending[t] = 0 and the summary
    ld   hl, LOCO_EVPEND
    add  hl, de
    ld   (hl), 0
    jp   __EV_SUMCALC

__LOCO_REMAIN:                ; HL = t
    ld   a, h
    or   a
    jp   nz, __EV_BAD
    ld   a, l
    cp   4
    jp   nc, __EV_BAD
    ld   (LOCO_EVTMP + 3), a
#ifndef CPC_BAREMETAL
    call __EV_TB
    call __FW_CALL
    defw $BCEC                ; KL DEL TICKER: carry and DE = what was left
    jr   c, __EV_REM1
    ld   de, 0
__EV_REM1:
    push de
    ld   a, (LOCO_EVTMP + 3)
    ld   e, a
    ld   d, 0
    di
    call __EV_CLRP
    ei
    pop  hl
    ret
#else
    call __EV_SYNC
    ld   a, (LOCO_EVTMP + 3)
    ld   e, a
    ld   d, 0
    add  a, a
    add  a, a
    ld   c, a
    ld   b, 0
    ld   hl, LOCO_EVBARE
    add  hl, bc
    ld   c, (hl)
    ld   (hl), 0
    inc  hl
    ld   b, (hl)
    ld   (hl), 0
    inc  hl
    ld   (hl), 0
    inc  hl
    ld   (hl), 0
    push bc
    call __EV_CLRP
    pop  hl
    ret
#endif

#ifndef CPC_BAREMETAL
; __EV_TB -- HL = the tick block of timer LOCO_EVTMP+3 (LOCO_EVTICK + 13 x t). Clobbers AF, BC, DE.
__EV_TB:
    ld   a, (LOCO_EVTMP + 3)
    ld   c, a
    add  a, a
    add  a, a
    ld   b, a                 ; 4t
    add  a, a
    add  a, b                 ; 12t
    add  a, c                 ; 13t
    ld   e, a
    ld   d, 0
    ld   hl, LOCO_EVTICK
    add  hl, de
    ret

; The event routines (one per timer, 4 bytes each: __EV_TICK0 + 4 x t is timer t's).
; Entered by the firmware with interrupts on and both ROMs off. Each only adds one
; to the timer's pending count. Timers 1-3 have no label of their own: they are reached
; only as __EV_TICK0 + 4 x t, and a global label would make each a chunk that nothing
; names, which the link pass `strip` (-O1 and above) drops (R18).
__EV_TICK0:
    ld   a, 0
    jr   __EV_KICK
    ld   a, 1               ; timer 1: __EV_TICK0 + 4
    jr   __EV_KICK
    ld   a, 2               ; timer 2: __EV_TICK0 + 8
    jr   __EV_KICK
    ld   a, 3               ; timer 3: __EV_TICK0 + 12
__EV_KICK:
    di
    push af
    push de
    push hl
    ld   e, a
    ld   d, 0
    ld   hl, LOCO_EVPEND
    add  hl, de
    ld   a, (hl)
    cp   127
    jr   nc, __EV_KICK1
    inc  (hl)
__EV_KICK1:
    ld   a, (LOCO_EVDI)
    or   a
    jr   nz, __EV_KICK2
    dec  a
    ld   (LOCO_EVSUM), a
__EV_KICK2:
    pop  hl
    pop  de
    pop  af
    ei
    ret
#endif

; ---- bare builds: counting the frames ------------------------------------------

#ifdef CPC_BAREMETAL
; __EV_SYNC -- counts the frames since the last count into the timers. Clobbers AF, DE, HL.
__EV_SYNC:
    ld   hl, (FH_FRAMES)
    ld   de, (LOCO_EVLAST)
    or   a
    sbc  hl, de
    ret  z

; __EV_COUNT -- HL = frames since the last count (not 0), DE = the old LOCO_EVLAST.
; Counts every running timer down by HL, adds a pending kick for each expiry, recharges
; (EVERY) or stops (AFTER) it. Preserves every register but F.
__EV_COUNT:
    push af
    push bc
    push de
    push hl
    push ix
    push hl                   ; the elapsed frames
    add  hl, de
    ld   (LOCO_EVLAST), hl
    ld   ix, LOCO_EVBARE
    ld   e, 0                 ; the timer
__EV_CT:
    ld   l, (ix + 0)
    ld   h, (ix + 1)
    ld   a, h
    or   l
    jr   z, __EV_CNEXT        ; stopped
    pop  bc
    push bc                   ; BC = the frames left to apply to this timer
__EV_CAGAIN:
    or   a
    sbc  hl, bc               ; count - frames
    jr   z, __EV_CEXP
    jr   c, __EV_CEXP
    ld   (ix + 0), l          ; not yet: what is left
    ld   (ix + 1), h
    jr   __EV_CNEXT
__EV_CEXP:
    ld   a, l                 ; frames left = -(count - frames)
    cpl
    ld   c, a
    ld   a, h
    cpl
    ld   b, a
    inc  bc
    ld   d, 0
    ld   hl, LOCO_EVPEND
    add  hl, de
    ld   a, (hl)
    cp   127
    jr   nc, __EV_CSAT
    inc  (hl)
__EV_CSAT:
    ld   l, (ix + 2)
    ld   h, (ix + 3)
    ld   a, h
    or   l
    jr   nz, __EV_CAGAIN      ; EVERY: the next period starts with the frames still left
    ld   (ix + 0), a          ; AFTER: stopped
    ld   (ix + 1), a
__EV_CNEXT:
    ld   bc, 4
    add  ix, bc
    inc  e
    ld   a, e
    cp   4
    jr   nz, __EV_CT
    pop  bc
    call __EV_SUMCALC
    pop  ix
    pop  hl
    pop  de
    pop  bc
    pop  af
    ret
#endif

; ---- TIME ----------------------------------------------------------------------

__LOCO_TIME:
#ifndef CPC_BAREMETAL
    call __FW_CALL
    defw $BD0D                ; KL TIME PLEASE -> DE HL
    ret
#else
    di
    ld   hl, (FH_FRAMES)
    ld   de, (FH_FRAMES + 2)
    ei
    add  hl, hl
    ex   de, hl
    adc  hl, hl
    ex   de, hl               ; DEHL = 2 x frames
    push de
    push hl
    add  hl, hl
    ex   de, hl
    adc  hl, hl
    ex   de, hl               ; DEHL = 4 x frames
    pop  bc
    add  hl, bc
    ex   de, hl
    pop  bc
    adc  hl, bc
    ex   de, hl               ; DEHL = 6 x frames
    ret
#endif

    pop namespace
