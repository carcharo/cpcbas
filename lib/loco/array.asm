; -----------------------------------------------------------------------
; lib/loco/array.asm -- Locomotive layer: local arrays
;
; Written from scratch for this project (MIT, see lib/LICENSE).
;
;   __LOCO_ALOCAL   Allocates and zeroes the elements of a local array on the
;                   heap and fills its descriptor (docs/ir.md, "Arrays").
;                   Entry: HL = the dimension table; the UBOUND table (2 bytes
;                          per dimension) follows it in memory.
;                          Stack (CALLEE): the element bytes on top, below it
;                          the descriptor's address (a frame address).
;                   Sets: +0 the dimension table, +2 the elements, +4 the
;                         LBOUND table (0: every array is 0-based), +6 the
;                         UBOUND table.
;                   Exit: nothing; raises Memory full (error 7) when the heap
;                         cannot hold the elements.
;                   Clobbers AF, BC, DE, HL.
;
; Uses the runtime's heap (__MEM_CALLOC); the caller's code frees the elements
; on every exit (__MEM_FREE, or __ARRAYSTR_FREE_MEM for a string array).

#include once <error.asm>
#include once <mem/calloc.asm>

    push namespace core

__LOCO_ALOCAL:
    ex   de, hl             ; DE = dimension table
    pop  hl                 ; return address
    pop  bc                 ; BC = element bytes
    ex   (sp), hl           ; HL = descriptor, (SP) = return address
    ld   (hl), e
    inc  hl
    ld   (hl), d            ; +0 the dimension table
    inc  hl
    push hl                 ; the +2 word, filled once the elements exist
    ld   a, (de)            ; dimension count - 1 (a word, at most 3)
    add  a, a
    add  a, 3               ; the UBOUND table follows the dimension table
    ld   l, a
    ld   h, 0
    add  hl, de
    ex   de, hl             ; DE = UBOUND table
    pop  hl
    push hl
    inc  hl
    inc  hl                 ; +4 the LBOUND table: 0
    ld   (hl), 0
    inc  hl
    ld   (hl), 0
    inc  hl
    ld   (hl), e            ; +6 the UBOUND table
    inc  hl
    ld   (hl), d
    call __MEM_CALLOC       ; BC bytes -> HL (0 when the heap is full)
    pop  de                 ; DE = the +2 word
    ld   a, h
    or   l
    jr   z, __LOCO_ALOCAL_FULL
    ex   de, hl
    ld   (hl), e
    inc  hl
    ld   (hl), d            ; +2 the elements
    ret
__LOCO_ALOCAL_FULL:
    ld   a, 7               ; Memory full
    jp   __ERROR

    pop namespace
