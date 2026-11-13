REM MODELS: plus
REM Conformance: the cpcplus library on a CPC Plus (Phase 7 P2), Caprice32 6128 Plus
REM only (no other emulator here has an ASIC): detection, unlock/lock, paging,
REM the 12-bit palette and the sprite registers and pixel RAM, read back through
REM the ASIC page (Caprice32 keeps palette, sprite position and sprite pixels
REM readable; sprite magnification is write-only there, see plus_sprites_vis in
REM tests/screens for what it does), interrupt state, the clock.
REM The ASIC is locked at start-up and PlusAvailable() leaves it so.
REM
REM Ported from cpcbuild. Changed with the language: $XX is &XX, bAND/bOR/bXOR are AND/OR/XOR,
REM STR$ is N$/T$ (Locomotive puts a space before a number that is not negative), CHR$ 13 is
REM CHR$(13). A true comparison given to STR$ is wrapped in -( ) so the expected values stay 1.

#include <cpc.bas>
#include <cpcbuild/display.bas>
#include "lib/chk.bas"
#include "lib/plushelp.bas"
#include "lib/ticks.bas"

DIM img(255) AS UBYTE
DIM i, bad AS UINTEGER
DIM v AS UBYTE
DIM t0 AS ULONG

POKE 16384, &5A
POKE 16385, &A5

REM ---- detection leaves the ASIC locked: RMR2 &BD is then an ordinary RMR
REM (mode 1, both ROMs off, interrupt counter reset: what the program has
REM anyway), so &4000 is still RAM
CHK("avail", T$(STR$(PlusAvailable())), "1")
RawRmr(&BD)
CHK("avail_leaves_locked", T$(STR$(PEEK(16384))), "90")
CHK("avail_again", T$(STR$(PlusAvailable())), "1")
RawRmr(&BD)
CHK("avail_again_locked", T$(STR$(PEEK(16384))), "90")

REM ---- unlock and paging
PlusUnlock()
CHK("unlock_ram_still_ram", T$(STR$(PEEK(16384))), "90")
PlusPageIn()
CHK("pagein_iff_off", T$(STR$(Iff())), "0")
CHK("pagein_hides_ram", T$(STR$(-(PEEK(16384) <> 90))), "1")
PlusPageOut()
CHK("pageout_ram_back", T$(STR$(PEEK(16384))) + " " + T$(STR$(PEEK(16385))), "90 165")
CHK("pageout_iff_on", T$(STR$(Iff())), "1")
CHK("avail_unlocked", T$(STR$(PlusAvailable())), "1")
PlusPageOut()
CHK("pageout_twice", T$(STR$(PEEK(16384))), "90")
PlusPageIn()
PlusPageIn()
PlusPageOut()
CHK("pagein_twice_one_out", T$(STR$(PEEK(16384))) + " " + T$(STR$(Iff())), "90 1")

REM with interrupts off to start with, they stay off
IntOff()
PlusPageIn()
PlusPageOut()
v = Iff()
SetPalette12(2, &0123)
SpriteMove(1, 5, 5)
IntOn()
CHK("iff_off_kept", T$(STR$(v)) + " " + T$(STR$(Iff())), "0 1")

REM ---- lock
PlusLock()
RawRmr(&BD)
CHK("lock_ram_visible", T$(STR$(PEEK(16384))), "90")
SetPalette12(3, &0ABC)
CHK("auto_unlock", T$(STR$(GetPalette12(3))), "2748")
PlusLock()
PlusLock()
PlusUnlock()
PlusUnlock()
CHK("lock_unlock_ok", T$(STR$(GetPalette12(3))), "2748")
PlusPageIn()
PlusLock()
CHK("lock_while_paged_in", T$(STR$(PEEK(16384))) + " " + T$(STR$(Iff())), "90 1")
RawRmr(&BD)
CHK("locked_after_lock", T$(STR$(PEEK(16384))), "90")

REM ---- nothing here may leave the ASIC raising interrupts: PRI (&6800) and the
REM DMA control/status register (&6C0F, bits 0-6: bit 7 is the raster interrupt flag, which
REM CPCEC shows) are untouched, and the CPC's ordinary
REM interrupts still run at their rate (no extra, none lost)
WCHK("pri_zero", T$(STR$(AsicPeek(&6800))), "0")
CHK("dcsr_zero", T$(STR$(AsicPeek(&6C0F) AND 127)), "0")
t0 = Ticks()
WaitRetrace(10)
t0 = Ticks() - t0
CHK("ticks", T$(STR$(-(t0 >= 50 AND t0 <= 70))), "1")

REM ---- END with sprites showing: the harness still sees the END marker
SpriteSetImage(0, @img(0))
SpriteColour(1, &0F00)
SpriteMove(0, 200, 100)
SpriteMag(0, 4, 4)
PRINT "DONE"
END
