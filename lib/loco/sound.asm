; -----------------------------------------------------------------------
; lib/loco/sound.asm -- Locomotive sound statements: SOUND, ENV, ENT,
; RELEASE and SQ (firmware builds only)
;
; Written from scratch for this project (MIT, see lib/LICENSE). The
; argument ranges, the defaults and the blocks handed to the firmware are
; what the real interpreter does ("Session
; 2026-11-09 (L4-SOUND)"; probes p-sound-1.bas to p-sound-3.bas record the
; calls BASIC makes to the firmware's sound manager and the errors it
; raises). A bare build has no sound manager: the checker refuses these
; statements there (E270), so the file is empty in a bare build.
;
; Every firmware call goes through the IX-preserving gate (the sound manager
; corrupts IX, the BASIC frame pointer). The sound block (SOUND_BLK, 9
; bytes) and the envelope buffer (SND_ENV, 16 bytes) are in the private
; block, in the central 32K where the firmware can read them with its ROMs
; enabled; the firmware copies both, so they are free again at once.
;
; Arguments are 16-bit words pushed by the caller, first argument deepest, and
; removed by the routine. A value is tested as an unsigned 16-bit number, so a
; negative one is above every limit: error 5 (Improper argument), through
; __ERROR with A = 5.
;
;   __LOCO_SOUND    stack: channel status, period, duration, volume, volume
;                   envelope, tone envelope, noise (the caller supplies the
;                   defaults: duration 20, volume 12, the rest 0).
;                   channel 0..255, period 0..4095, duration any (negative:
;                   repeat count of the envelope, 0: its length), volume 0..15,
;                   envelopes 0..15, noise 0..31. Block (SOUND_QUEUE, &BCAA):
;                   0 channel status, 1 volume envelope, 2 tone envelope,
;                   3-4 period, 5 noise, 6 volume, 7-8 duration. A full queue
;                   is waited out (the manager empties it from the 300 Hz
;                   interrupt), as BASIC does. Clobbers AF, BC, DE, HL.
;   __LOCO_ENV      HL = k + 256 * mask; stack: n, then k values. n 1..15.
;   __LOCO_ENT      n -15..-1 (ENT only) means "repeat": the number is |n|
;                   and bit 7 of the section count is set. A section is
;                   steps, size, pause (ENV: 0..127; ENT: 0..239; size
;                   -128..127; pause 0..255) or, when its bit in `mask`
;                   is set (bit 0 = the first section), a hardware section:
;                   ENV = register 0..15 and period (16 bits), written as
;                   &80+register, period low, period high; ENT = period
;                   0..4095 and pause, written as &F0+period high, period
;                   low, pause. The block (SOUND_AMPL_ENVELOPE &BCBC,
;                   SOUND_TONE_ENVELOPE &BCBF; A = n, HL = the block) is the
;                   number of sections (bit 7: repeat) and 3 bytes a section.
;                   The shape (at most 5 sections) is checked by the compiler.
;                   Clobbers AF, BC, DE, HL.
;   __LOCO_RELEASE  HL = channels 0..7 (SOUND_RELEASE &BCB3, A = the mask).
;   __LOCO_SQ       HL = channel 1, 2 or 4. Exit: HL = the status byte of
;                   SOUND_CHECK (&BCAD): bits 0-2 free queue entries, 3-5
;                   rendezvous, bit 6 held, bit 7 playing (H = 0).
;                   Clobbers AF, BC, DE, HL.
; -----------------------------------------------------------------------

#include once <error.asm>
#include once <fwcall.asm>
#include once <sysvars.asm>
#include once <loco/vars.asm>

#ifndef CPC_BAREMETAL

    push namespace core

__SND_BAD:
    ld   a, 5
    jp   __ERROR

__LOCO_SOUND:
    pop  hl                     ; the return address waits in HL
    pop  de                     ; noise 0..31
    ld   a, d
    or   a
    jp   nz, __SND_BAD
    ld   a, e
    cp   32
    jp   nc, __SND_BAD
    ld   (SOUND_BLK + 5), a
    pop  de                     ; tone envelope 0..15
    ld   a, d
    or   a
    jp   nz, __SND_BAD
    ld   a, e
    cp   16
    jp   nc, __SND_BAD
    ld   (SOUND_BLK + 2), a
    pop  de                     ; volume envelope 0..15
    ld   a, d
    or   a
    jp   nz, __SND_BAD
    ld   a, e
    cp   16
    jp   nc, __SND_BAD
    ld   (SOUND_BLK + 1), a
    pop  de                     ; volume 0..15
    ld   a, d
    or   a
    jp   nz, __SND_BAD
    ld   a, e
    cp   16
    jp   nc, __SND_BAD
    ld   (SOUND_BLK + 6), a
    pop  de                     ; duration, as it is
    ld   (SOUND_BLK + 7), de
    pop  de                     ; period 0..4095
    ld   a, d
    cp   16
    jp   nc, __SND_BAD
    ld   (SOUND_BLK + 3), de
    pop  de                     ; channel status 0..255
    ld   a, d
    or   a
    jp   nz, __SND_BAD
    ld   a, e
    ld   (SOUND_BLK + 0), a
    push hl                     ; the return address again
__SND_QUEUE:
    ld   hl, SOUND_BLK
    call .core.__FW_CALL_IX
    defw $BCAA                  ; SOUND_QUEUE: Carry = queued
    jr   nc, __SND_QUEUE
    ret

__LOCO_RELEASE:
    ld   a, h
    or   a
    jp   nz, __SND_BAD
    ld   a, l
    cp   8
    jp   nc, __SND_BAD
    call .core.__FW_CALL_IX
    defw $BCB3                  ; SOUND_RELEASE
    ret

__LOCO_SQ:
    ld   a, h
    or   a
    jp   nz, __SND_BAD
    ld   a, l
    cp   1
    jr   z, __SQ_OK
    cp   2
    jr   z, __SQ_OK
    cp   4
    jp   nz, __SND_BAD
__SQ_OK:
    call .core.__FW_CALL_IX
    defw $BCAD                  ; SOUND_CHECK
    ld   l, a
    ld   h, 0
    ret

; __SND_RD -- BC = the stacked value at (HL), HL = the next one (the values
; were pushed first to last, so the next is two bytes lower).
__SND_RD:
    ld   c, (hl)
    inc  hl
    ld   b, (hl)
    dec  hl
    dec  hl
    dec  hl
    ret

__LOCO_ENT:
    ld   a, 1
    jr   __SND_ENVGO
__LOCO_ENV:
    xor  a
__SND_ENVGO:
    ld   (LOCO_SND_KIND), a
    ld   a, h
    ld   (LOCO_SND_MASK), a
    ld   a, l
    ld   (LOCO_SND_K), a
    ld   (LOCO_SND_CNT), a
    xor  a
    ld   (LOCO_SND_SEC), a
    ld   hl, 2
    add  hl, sp                 ; the last value
    ld   a, (LOCO_SND_K)
    ld   c, a
    ld   b, 0
    add  hl, bc
    add  hl, bc                 ; HL = the envelope number
    call __SND_RD               ; BC = n, HL = the first value
    ld   d, 0                   ; repeat flag
    ld   a, (LOCO_SND_KIND)
    or   a
    jr   z, __SE_NUM
    ld   a, b                   ; ENT: -15..-1 repeats
    inc  a
    jr   nz, __SE_NUM
    ld   a, c
    cp   $F1
    jp   c, __SND_BAD
    neg
    ld   c, a
    ld   b, 0
    ld   d, $80
__SE_NUM:
    ld   a, b
    or   a
    jp   nz, __SND_BAD
    ld   a, c
    or   a
    jp   z, __SND_BAD
    cp   16
    jp   nc, __SND_BAD
    or   d
    ld   (LOCO_SND_NUM), a
    ld   de, SND_ENV + 1
__SE_LOOP:
    ld   a, (LOCO_SND_CNT)
    or   a
    jp   z, __SE_DONE
    ld   a, (LOCO_SND_SEC)
    inc  a
    ld   (LOCO_SND_SEC), a
    ld   a, (LOCO_SND_MASK)
    srl  a
    ld   (LOCO_SND_MASK), a
    jp   c, __SE_HW
    ld   a, (LOCO_SND_CNT)      ; a software section: steps, size, pause
    sub  3
    ld   (LOCO_SND_CNT), a
    call __SND_RD
    ld   a, b
    or   a
    jp   nz, __SND_BAD
    ld   a, (LOCO_SND_KIND)
    or   a
    ld   a, c
    jr   nz, __SE_TONE
    cp   128                    ; ENV: steps 0..127
    jr   __SE_STEPS
__SE_TONE:
    cp   240                    ; ENT: steps 0..239
__SE_STEPS:
    jp   nc, __SND_BAD
    ld   (de), a
    inc  de
    call __SND_RD               ; size -128..127: B is C's sign extension
    ld   a, c
    rla
    sbc  a, a
    cp   b
    jp   nz, __SND_BAD
    ld   a, c
    ld   (de), a
    inc  de
    call __SND_RD               ; pause 0..255
    ld   a, b
    or   a
    jp   nz, __SND_BAD
    ld   a, c
    ld   (de), a
    inc  de
    jp   __SE_LOOP
__SE_HW:
    ld   a, (LOCO_SND_CNT)
    sub  2
    ld   (LOCO_SND_CNT), a
    call __SND_RD
    ld   a, (LOCO_SND_KIND)
    or   a
    jr   nz, __SE_HWT
    ld   a, b                   ; ENV: register 0..15, then the period
    or   a
    jp   nz, __SND_BAD
    ld   a, c
    cp   16
    jp   nc, __SND_BAD
    or   $80
    ld   (de), a
    inc  de
    call __SND_RD
    ld   a, c
    ld   (de), a
    inc  de
    ld   a, b
    ld   (de), a
    inc  de
    jp   __SE_LOOP
__SE_HWT:
    ld   a, b                   ; ENT: period 0..4095, then the pause
    cp   16
    jp   nc, __SND_BAD
    or   $F0
    ld   (de), a
    inc  de
    ld   a, c
    ld   (de), a
    inc  de
    call __SND_RD
    ld   a, b
    or   a
    jp   nz, __SND_BAD
    ld   a, c
    ld   (de), a
    inc  de
    jp   __SE_LOOP
__SE_DONE:
    ld   a, (LOCO_SND_NUM)
    and  $80
    ld   hl, LOCO_SND_SEC
    or   (hl)
    ld   (SND_ENV), a           ; the section count, bit 7 = repeat
    ld   a, (LOCO_SND_NUM)
    and  $0F
    ld   hl, SND_ENV
    ld   b, a
    ld   a, (LOCO_SND_KIND)
    or   a
    ld   a, b
    jr   nz, __SE_CALLT
    call .core.__FW_CALL_IX
    defw $BCBC                  ; SOUND_AMPL_ENVELOPE
    jr   __SE_RET
__SE_CALLT:
    call .core.__FW_CALL_IX
    defw $BCBF                  ; SOUND_TONE_ENVELOPE
__SE_RET:
    pop  de                     ; the return address
    ld   a, (LOCO_SND_K)
    ld   c, a
    ld   b, 0
    ld   hl, 2
    add  hl, bc
    add  hl, bc
    add  hl, sp
    ld   sp, hl                 ; the values and the number are gone
    ex   de, hl
    jp   (hl)

    pop namespace

#endif
