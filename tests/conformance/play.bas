REM BARE: skip uses the firmware clock (KL TIME PLEASE) and BEEP waits on the firmware sound manager; bare_sound.bas is the bare counterpart
REM SIM: skip the simulator has no AY chip to read back; chipsrun runs it
REM Conformance: the AY primitive (AyWrite / AyRead) and what the Locomotive sound statements leave behind.
REM
REM Ported from cpcbuild's play.bas (the AY primitive and Play, the MML library: zxbasic's stdlib/play.bas).
REM Left out: every Play check (the divider table, lengths, repeats, channels, mixer, envelope, noise): Play
REM is a Spectrum/Next statement that Locomotive BASIC does not have and the library is not part of the
REM dialect; the AY side that remains is checked here, with the keyboard-port, interrupt and clock checks the
REM original made after a Play, now made after the AY writes and a BEEP: that interrupts are back on and the
REM firmware clock runs, that BEEP works after AyWrite, and that the keyboard port stays an input (AY
REM register 7 bit 6). The Caprice32 AY returns what was last written, unused bits included, so reads are
REM masked. Changed with the language: Mask is RegMask (MASK is a statement now), STR$ is N$, BAND/BOR are AND/OR, $XX is &XX.

#include <cpc.bas>
#include "lib/chkbuf.bas"
#include "lib/ticks.bas"

REM P/V after LD A,I is IFF2 (bit 2 of F); an interrupt during that
REM instruction can make an NMOS Z80 report 0, so callers try twice.
FUNCTION FASTCALL IntsOn() AS UBYTE
  ASM
  ld a, i
  push af
  pop hl
  ld a, l
  and 4
  END ASM
END FUNCTION


REM The raw routines with interrupts off by hand: port C is set to the
REM cassette bits ($30 = motor and write data) first; the routine must
REM leave them (the function returns port C & $30 after the write).
FUNCTION FASTCALL CassAfterWrite() AS UBYTE
  ASM
  di
  ld bc, $F630
  out (c), c
  ld a, 8
  ld c, 0
  call .core.__CPC_AY_WRITE
  ld b, $F6
  in a, (c)
  and $30
  push af
  ld bc, $F600
  out (c), c
  pop af
  ei
  END ASM
END FUNCTION

FUNCTION FASTCALL CassAfterRead() AS UBYTE
  ASM
  di
  ld bc, $F630
  out (c), c
  ld a, 8
  call .core.__CPC_AY_READ
  ld b, $F6
  in a, (c)
  and $30
  push af
  ld bc, $F600
  out (c), c
  pop af
  ei
  END ASM
END FUNCTION

REM The AY register's implemented bits (the emulator returns unused bits as written).
FUNCTION RegMask(reg AS UBYTE) AS UBYTE
  IF reg = 1 OR reg = 3 OR reg = 5 OR reg = 13 THEN RETURN 15
  IF reg = 6 OR reg = 8 OR reg = 9 OR reg = 10 THEN RETURN 31
  IF reg = 7 THEN RETURN 63
  RETURN 255
END FUNCTION

REM Tone divider of the channel (0-2) as the AY holds it.
FUNCTION Tone(ch AS UBYTE) AS UINTEGER
  RETURN CAST(UINTEGER, AyRead(ch * 2 + 1) AND 15) * 256 + AyRead(ch * 2)
END FUNCTION

FUNCTION VolSum() AS UBYTE
  RETURN (AyRead(8) AND 31) + (AyRead(9) AND 31) + (AyRead(10) AND 31)
END FUNCTION

DIM r, v, pat, ok AS UBYTE
DIM t0, t1 AS ULONG
DIM i AS UINTEGER

REM ---------------- AyWrite / AyRead ----------------
CHK("ints_on_start", N$(IntsOn() OR IntsOn()), "4")
FOR pat = 0 TO 2
  ok = 1
  FOR r = 0 TO 13
    IF pat = 0 THEN v = &A5
    IF pat = 1 THEN v = &5A
    IF pat = 2 THEN v = r * 3 + 1
    IF r = 7 THEN v = v AND &3F : REM keep the keyboard port an input
    AyWrite r, v
    IF AyRead(r) <> (v AND RegMask(r)) THEN
      ok = 0
    END IF
  NEXT r
  CHK("roundtrip_" + N$(pat), N$(ok), "1")
NEXT pat
REM registers are independent: write all, then read all back
FOR r = 0 TO 13
  v = (r * 17 + 3)
  IF r = 7 THEN v = v AND &3F
  AyWrite r, v
NEXT r
ok = 1
FOR r = 0 TO 13
  v = (r * 17 + 3)
  IF r = 7 THEN v = v AND &3F
  IF AyRead(r) <> (v AND RegMask(r)) THEN ok = 0
NEXT r
CHK("registers_independent", N$(ok), "1")
CHK("ints_on_after_ay", N$(IntsOn() OR IntsOn()), "4")
CHK("cass_bits_kept_write", N$(CassAfterWrite()), "48")
CHK("cass_bits_kept_read", N$(CassAfterRead()), "48")
REM silence again
AyWrite 8, 0 : AyWrite 9, 0 : AyWrite 10, 0 : AyWrite 7, &3F
CHK("silent_after", N$(VolSum()), "0")
CHK("mixer_silent", N$(AyRead(7)), "63")

REM a tone set by hand reads back as the 12-bit divider
AyWrite 0, 239 : AyWrite 1, 0
CHK("tone_c4", N$(Tone(0)), "239")
AyWrite 0, &EE : AyWrite 1, &E
CHK("tone_c0", N$(Tone(0)), "3822")
AyWrite 0, 0 : AyWrite 1, 0

REM ---------------- interrupts, clock, keyboard port ----------------
CHK("ints_on_after_writes", N$(IntsOn() OR IntsOn()), "4")
t0 = Ticks()
FOR i = 1 TO 30000
  REM a compute loop with no firmware calls: the clock must move
NEXT i
t1 = Ticks()
CHK("clock_runs", N$(-(t1 - t0 > 5)), "1")
CHK("kbd_port_input", N$(AyRead(7) AND 64), "0")

REM ---------------- BEEP after AyWrite ----------------
REM BEEP 0.2 s waits about 60 ticks (1/300 s)
t0 = Ticks()
BEEP 0.2, 0
t1 = Ticks()
CHK("beep_after_ay", N$(-(t1 - t0 >= 50 AND t1 - t0 <= 90)), "1")
CHK("tone_after_beep", N$(Tone(0)), "239")
AyWrite 8, 0 : AyWrite 9, 0 : AyWrite 10, 0
CHK("ints_on_end", N$(IntsOn() OR IntsOn()), "4")

PRINT
Report()
PRINT "DONE"
END
