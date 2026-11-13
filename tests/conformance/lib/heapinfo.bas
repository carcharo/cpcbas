REM Heap measurements for heap.bas: the free-list walks of the reference compiler's
REM stdlib/alloc.bas memavail and maxavail (the runtime is the same allocator).
REM   MemAvail()  total free bytes in the heap
REM   MaxAvail()  the largest free block

#ifndef __CONFORMANCE_HEAPINFO__
#define __CONFORMANCE_HEAPINFO__

REM the asm leaves its answer here: a function's result is its RETURN, not HL
DIM heapAnswer AS UINTEGER
heapAnswer = 0

FUNCTION MemAvail() AS UINTEGER
  ASM
  push namespace core
  PROC
  LOCAL LOOP
  ld hl, ZXBASIC_MEM_HEAP
  ld de, 0
LOOP:
  ld c, (hl)
  inc hl
  ld b, (hl)
  inc hl
  ld a, (hl)
  inc hl
  ld h, (hl)
  ld l, a
  ex de, hl
  add hl, bc
  ex de, hl
  ld a, h
  or l
  jr nz, LOOP
  ex de, hl
  ENDP
  pop namespace
  ld (_heapAnswer), hl
  END ASM
  RETURN heapAnswer
END FUNCTION

FUNCTION MaxAvail() AS UINTEGER
  ASM
  push namespace core
  PROC
  LOCAL LOOP, CONT
  ld hl, ZXBASIC_MEM_HEAP
  ld de, 0
LOOP:
  ld c, (hl)
  inc hl
  ld b, (hl)
  inc hl
  ld a, (hl)
  inc hl
  ld h, (hl)
  ld l, a
  ex de, hl
  or a
  sbc hl, bc
  add hl, bc
  ex de, hl
  jr nc, CONT
  ld d, b
  ld e, c
CONT:
  ld a, h
  or l
  jr nz, LOOP
  ex de, hl
  ENDP
  pop namespace
  ld (_heapAnswer), hl
  END ASM
  RETURN heapAnswer
END FUNCTION

#endif
