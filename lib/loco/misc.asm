; -----------------------------------------------------------------------
; lib/loco/misc.asm -- machine statements and the rest: FRAME, FRE,
; HIMEM, RANDOM
;
; Written from scratch for this project (MIT, see lib/LICENSE).
;
; INP, OUT and WAIT are inline code (the lowering), PAUSE is the imported
; runtime's __PAUSE; this file holds the rest of L4-SMALL. State: the
; RANDOM generator's 16-bit word at LOCO_RANDSTATE (lib/loco/vars.asm).
;
; Entry points (namespace core). "Clobbers" lists registers changed; the
; stack is balanced.
;
;   __LOCO_FRAME    FRAME: waits for the frame flyback. Firmware mode: MC WAIT
;                   FLYBACK (&BD19) through the gate; bare mode: the PPI's
;                   port B bit 0 (the same loop). Returns as soon as the
;                   flyback is on, so it is the start of the flyback, or any
;                   moment inside it. Clobbers AF, BC (+ the gate).
;   __LOCO_FRE      Exit: HL = the bytes that can still be allocated from the
;                   heap: the sum of (block size - 2) over the free blocks, so
;                   it is a total, not the largest block. FRE("") is the same
;                   (the heap has no collection). Clobbers AF, BC, DE, HL.
;   __LOCO_HIMEM    Exit: HL = the address of the last heap byte (a constant
;                   of the build). Clobbers HL.
;   __LOCO_RANDOM   RANDOM(n): HL = n (unsigned), Exit: HL = 0..n-1 (0 for
;                   n = 0), from a 16-bit xorshift (7, 9, 8; period 65535)
;                   scaled by n/65536. Seeded at its first call from the clock
;                   (KL TIME PLEASE; bare builds FH_FRAMES) unless RANDOMIZE
;                   seeded it before (loco/randseed.asm). Clobbers AF, BC, DE, HL.
; -----------------------------------------------------------------------

#include once <loco/vars.asm>
#include once <loco/randseed.asm>
#include once <mem/heapinit.asm>
#ifndef CPC_BAREMETAL
#include once <fwcall.asm>
#endif

    push namespace core

__LOCO_FRAME:
#ifdef CPC_BAREMETAL
    PROC
    LOCAL __LF_WAIT
    ld   b, $F5
__LF_WAIT:
    in   a, (c)
    rra
    jr   nc, __LF_WAIT
    ret
    ENDP
#else
    call .core.__FW_CALL
    defw $BD19              ; MC WAIT FLYBACK
    ret
#endif

__LOCO_FRE:
    PROC
    LOCAL __LF_NODE, __LF_NEXT
    ld   hl, ZXBASIC_MEM_HEAP
    ld   de, 0              ; DE = the total
__LF_NODE:                  ; HL = a node: size, next
    ld   c, (hl)
    inc  hl
    ld   b, (hl)
    inc  hl
    ld   a, b
    or   c
    jr   z, __LF_NEXT       ; the dummy header (size 0)
    ex   de, hl
    add  hl, bc
    dec  hl
    dec  hl                 ; the block's own 2-byte size is not allocatable
    ex   de, hl
__LF_NEXT:
    ld   c, (hl)
    inc  hl
    ld   b, (hl)
    ld   h, b
    ld   l, c
    ld   a, h
    or   l
    jr   nz, __LF_NODE
    ex   de, hl
    ret
    ENDP

__LOCO_HIMEM:
    ld   hl, ZXBASIC_MEM_HEAP + ZXBASIC_HEAP_SIZE - 1
    ret

__LOCO_RANDOM:
    PROC
    LOCAL __LR_SEEDED, __LR_MUL, __LR_CLR, __LR_ROT
    push hl                 ; n
    ld   hl, (LOCO_RANDSTATE)
    ld   a, h
    or   l
    jr   nz, __LR_SEEDED
#ifdef CPC_BAREMETAL
    ld   hl, (FH_FRAMES)
    ld   de, (FH_FRAMES + 2)
#else
    call .core.__FW_CALL
    defw $BD0D              ; KL TIME PLEASE -> DE HL
#endif
    call __LOCO_RANDSEEDT
    ld   hl, (LOCO_RANDSTATE)
__LR_SEEDED:                ; xorshift16: x ^= x << 7; x ^= x >> 9; x ^= x << 8
    ld   d, h
    ld   e, l
    add  hl, hl
    add  hl, hl
    add  hl, hl
    add  hl, hl
    add  hl, hl
    add  hl, hl
    add  hl, hl
    ld   a, h
    xor  d
    ld   h, a
    ld   a, l
    xor  e
    ld   l, a
    ld   a, h
    srl  a
    xor  l
    ld   l, a
    ld   a, l
    xor  h
    ld   h, a
    ld   (LOCO_RANDSTATE), hl
    ld   b, h
    ld   c, l               ; BC = x
    pop  de                 ; DE = n
    ld   hl, 0
    ld   a, 16
__LR_MUL:                   ; HL:DE = x * n, shifting n out of DE as it is used
    bit  0, e
    jr   z, __LR_CLR
    add  hl, bc
    jr   __LR_ROT
__LR_CLR:
    or   a
__LR_ROT:
    rr   h
    rr   l
    rr   d
    rr   e
    dec  a
    jr   nz, __LR_MUL
    ret                     ; HL = (x * n) >> 16
    ENDP

    pop namespace
