REM MODELS: plus
REM Conformance: the cheap paths of the cpcplus calls (Phase 7 speed fixes, Caprice32 and CPCEC):
REM SpriteMove's in-range fast path and its clamping at each edge, SpriteMoveBlock (first/count
REM masking, a table in &4000-&7FFF, PlusPageIn in force, interrupt state), SetPalette12 /
REM SpriteColour on the fast path before and after PlusPageIn/PlusPageOut and PlusLock, the
REM handler-context entries PlusHandlerIn/Out/Poke/SetColour/SetColourRaw/Scroll called from a
REM frame hook (interrupts off, as in a raster handler), and that none of it leaves interrupts
REM off or the ASIC page in. Read back through the ASIC page.
REM
REM Ported from cpcbuild. Changed with the language: $XX is &XX, bAND/bOR/bXOR are AND/OR/XOR,
REM STR$ is N$/T$ (Locomotive puts a space before a number that is not negative), CHR$ 13 is
REM CHR$(13). A true comparison given to STR$ is wrapped in -( ) so the expected values stay 1.
REM POKE UINTEGER a, v is POKE UINTEGER, a, v; Pos is PosOf; tbl is 64 bytes and the coordinate sum is UINTEGER (REMs at both).

#include <cpc.bas>
#include <framehook.bas>
#include <cpcbuild/display.bas>
#include "lib/chk.bas"
#include "lib/plushelp.bas"
#require "cpcplus/plushandler.asm"

REM The hook (interrupt context): pen colours and registers through the handler entries.
FUNCTION FASTCALL FastHook() AS UINTEGER
  ASM
  ld hl, FH_HOOK
  jp FH_SKIP
FH_HOOK:
  ld a, 20
  ld de, $0BAC                  ; red A, green B, blue C = &0ABC
  call .core.PlusHandlerSetColourRaw
  ld a, 21
  ld hl, $0123
  call .core.PlusHandlerSetColour
  ld a, $55
  ld hl, $643E                  ; entry 31's first byte
  call .core.PlusHandlerPoke
  ld bc, $0503
  call .core.PlusHandlerScroll
  call .core.PlusHandlerIn
  ld a, $77
  ld ($6402), a                 ; pen 1: red 7, blue 7 (this code is below &4000)
  call .core.PlusHandlerOut
  ld a, 32                      ; refused: entry above 31
  ld de, $0FFF
  call .core.PlusHandlerSetColourRaw
  ld hl, FH_N
  inc (hl)
  ret
FH_N:
  defb 0
FH_SKIP:
  END ASM
END FUNCTION

FUNCTION FASTCALL FastHookN() AS UBYTE
  ASM
  ld a, (FH_N)
  END ASM
END FUNCTION

REM changed: 64 bytes, not 32. The loop below stores 16 entries of 4 bytes; with 32 the stores ran past the end of
REM the array into the variables after it (here the loop counter, so the run never ended).
DIM tbl(63) AS UBYTE
DIM i, bad AS UINTEGER
DIM v AS UBYTE

FUNCTION Reg(n AS UBYTE, k AS UBYTE) AS UBYTE
  RETURN AsicPeek(24576 + CAST(UINTEGER, n) * 8 + k)
END FUNCTION

FUNCTION PosOf(n AS UBYTE) AS STRING
  REM changed: 256 is an INTEGER literal here (it does not fit a UBYTE), so 256 * 255 wrapped to -256 and the
  REM coordinates 65280 and 65535 printed negative; the bytes are widened to UINTEGER first.
  RETURN T$(STR$(CAST(UINTEGER, Reg(n, 1)) * 256 + Reg(n, 0))) + " " + T$(STR$(CAST(UINTEGER, Reg(n, 3)) * 256 + Reg(n, 2)))
END FUNCTION

PlusUnlock()
REM ---- SpriteMove: the fast path (in range) and the clamp, edges both sides
SpriteMove(2, 200, 100)
CHK("move_plain", PosOf(2), "200 100")
SpriteMove(2, 767, 255)
CHK("move_max", PosOf(2), "767 255")
SpriteMove(2, 768, 256)
CHK("move_over", PosOf(2), "767 255")
SpriteMove(2, -256, -256)
CHK("move_min", PosOf(2), "65280 65280")
SpriteMove(2, -257, -257)
CHK("move_under", PosOf(2), "65280 65280")
SpriteMove(2, -1, -1)
CHK("move_minus1", PosOf(2), "65535 65535")
SpriteMove(2, 255, 0)
SpriteMove(2, 256, 1)
CHK("move_256_1", PosOf(2), "256 1")
SpriteMove(18, 5, 6)
CHK("move_n_masked", PosOf(2), "5 6")
SpriteMove(3, 30000, -30000)
CHK("move_wild", PosOf(3), "767 65280")
CHK("move_neighbours", PosOf(1) + " " + PosOf(4), "0 0 0 0")

REM ---- SpriteMoveBlock
FOR i = 0 TO 15
  POKE UINTEGER, @tbl(0) + (i * 4), 100 + i * 10
  POKE UINTEGER, @tbl(0) + (i * 4) + 2, 50 + i
NEXT i
SpriteMoveBlock(4, 3, @tbl(0))
CHK("block_3", PosOf(4) + " | " + PosOf(5) + " | " + PosOf(6), "100 50 | 110 51 | 120 52")
CHK("block_neighbours", PosOf(3) + " | " + PosOf(7), "767 65280 | 0 0")
SpriteMoveBlock(14, 5, @tbl(0))
CHK("block_cut_at_16", PosOf(14) + " | " + PosOf(15), "100 50 | 110 51")
SpriteMoveBlock(20, 1, @tbl(0))
CHK("block_first_masked", PosOf(4), "100 50")
SpriteMoveBlock(0, 0, @tbl(0))
CHK("block_count0", PosOf(0), "0 0")
SpriteMoveBlock(0, 8, @tbl(0))
CHK("block_8", PosOf(0) + " | " + PosOf(7), "100 50 | 170 57")
REM -1 and -256 and 767 are what the ASIC takes as they are
POKE UINTEGER, @tbl(0), -1
POKE UINTEGER, @tbl(0) + 2, -256
SpriteMoveBlock(9, 1, @tbl(0))
CHK("block_negative", PosOf(9), "65535 65280")
REM a table in &4000-&7FFF is bounced
FOR i = 0 TO 15
  POKE 17000 + i, PEEK(@tbl(0) + i)
NEXT i
SpriteMoveBlock(10, 4, 17000)
CHK("block_table_in_window", PosOf(10) + " | " + PosOf(13), "65535 65280 | 130 53")
REM PlusPageIn in force: plain stores, table outside the window
PlusPageIn()
SpriteMoveBlock(11, 2, @tbl(0))
PlusPageOut()
CHK("block_while_paged_in", PosOf(11) + " | " + PosOf(12), "65535 65280 | 110 51")
CHK("iff_after_blocks", T$(STR$(Iff())), "1")
IntOff()
SpriteMoveBlock(0, 2, @tbl(0))
CHK("block_keeps_di", T$(STR$(Iff())), "0")
IntOn()
CHK("block_leaves_page_out", T$(STR$(PEEK(17000))), T$(STR$(PEEK(@tbl(0)))))

REM ---- the fast paths survive PlusPageIn/Out and PlusLock (flags rebuilt)
SetPalette12(5, &0123)
PlusPageIn()
SetPalette12(5, &0456)
SpriteMove(6, 33, 44)
PlusPageOut()
CHK("pal_while_paged_in", T$(STR$(GetPalette12(5))) + " " + PosOf(6), "1110 33 44")
SetPalette12(5, &0789)
CHK("pal_after_page_out", T$(STR$(GetPalette12(5))), "1929")
PlusLock()
SpriteColour(2, &0ABC)
CHK("auto_unlock_after_lock", T$(STR$(GetPalette12(18))), "2748")
SetPalette12(5, &0F0F)
SpriteMove(6, 7, 8)
CHK("fast_again", T$(STR$(GetPalette12(5))) + " " + PosOf(6), "3855 7 8")
CHK("iff_on", T$(STR$(Iff())), "1")
IntOff()
SetPalette12(5, &0111)
SpriteMove(6, 9, 9)
CHK("window_keeps_di", T$(STR$(Iff())) + " " + T$(STR$(GetPalette12(5))) + " " + PosOf(6), "0 273 9 9")
IntOn()

REM ---- handler context, from a frame hook
POKE 16384, 109
SetPalette12(1, &0000)
SetPalette12(31, &0000)
ScrollFine(0, 0)
FrameHook(FastHook())
WaitRetrace(3)
FrameHookOff()
CHK("handler_hook_ran", T$(STR$(-(FastHookN() >= 2))), "1")
CHK("handler_colour_raw", T$(STR$(GetPalette12(20))), "2748")
CHK("handler_colour", T$(STR$(GetPalette12(21))), "291")
CHK("handler_poke", T$(STR$(AsicPeek(&643E))), "85")
WCHK("handler_scroll", T$(STR$(AsicPeek(&6804) AND &7F)), "53")
CHK("handler_in_out", T$(STR$(AsicPeek(&6402))), "119")
WCHK("handler_entry32_refused", T$(STR$(AsicPeek(&6440))) + " " + T$(STR$(AsicPeek(&6441))), "0 0")
CHK("handler_page_out", T$(STR$(PEEK(16384))), "109")
CHK("handler_iff", T$(STR$(Iff())), "1")
PRINT "DONE"
END
