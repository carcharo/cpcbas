' Spec section 10: inline assembly, with preprocessor lines inside the block.
#define SCREEN_BASE &C000
#define BORDER_PORT &7F00

DIM total AS UINTEGER

ASM
  ; wait for the frame flyback
  ld b, &F5
wait:
  in a, (c)
  rra
  jr nc, wait
END ASM

SUB ClearScreen()
  ASM
    ld hl, SCREEN_BASE
    ld de, SCREEN_BASE + 1
    ld bc, &3FFF
    ld (hl), 0
    ldir
  END ASM
END SUB

SUB Beep3()
  ASM
#ifdef CPC464
    call &BB5A
#else
    ld a, 7
    call &BB5A
#endif
    ld a, 'A'
    defm "it's a quote ' and a ""double"" one"
  END ASM
END SUB

FUNCTION GetTotal() AS UINTEGER
  ASM
    ld hl, (_total)
  END ASM
END FUNCTION

SUB Poke2(n AS UBYTE)
  ASM
    ld a, (ix+5)
    ld bc, BORDER_PORT
    out (c), a
  END ASM
END SUB

ClearScreen()
Poke2(3)
ASM
#if defined(CPC6128) || defined(PLUS)
  ld a, 1
#endif
  nop
END ASM
