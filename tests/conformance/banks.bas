REM MODELS: 6128 plus
REM SIM: skip the simulator has no RAM banking (the &7Fxx bank port is not modelled); chipsrun runs it
REM Conformance: the 6128's extra 64 KB (lib/cpcbuild/banks.bas) and music
REM played from a bank (MusicInitBank, lib/music/music_cpc.bas).
REM
REM Runs on the 6128 only (chips and Caprice32); banks464.bas is its
REM counterpart for machines without extra RAM.
REM
REM Parts: peek/poke in all four banks (distinct, main RAM at &4000 untouched),
REM the persistent BankSelect and the shadow, copies in and out (every
REM chunk boundary, the window edges, refusals), a frame hook that pages a
REM bank in and out (the selected bank must survive it), drawing into the
REM back screen after bank use, PRINT with a bank selected, and music played
REM from a bank: the AY state tick by tick equals the same song played from
REM main RAM, in normal and game mode, with the main program selecting banks
REM all the time, in manual mode, and after going back to a main-RAM song.
REM
REM Ported from cpcbuild. Changed with the language: $XX is &XX, bAND/bOR/bXOR are AND/OR/XOR,
REM STR$ is N$/T$ (Locomotive puts a space before a number that is not negative), CHR$ 13 is
REM CHR$(13). a true comparison stored for STR$ is wrapped in -( ) so the expected values stay
REM 1.

#include <cpc.bas>
#include <cpcbuild/banks.bas>
#include "lib/chk.bas"

DIM i, j, n AS UINTEGER
DIM b AS UBYTE
DIM ok AS UBYTE
DIM s AS STRING
DIM m0, m1, m2 AS UBYTE
DIM src(599) AS UBYTE
DIM dst(599) AS UBYTE
DIM lens(9) AS UINTEGER

REM ---------------- availability, peek/poke ----------------
CHK("available", T$(STR$(BankAvailable())), "1")
CHK("initially_main", T$(STR$(BankSelected())), "255")
m0 = PEEK(16384): m1 = PEEK(32767): m2 = PEEK(21845)
FOR b = 0 TO 3
  BankPoke(b, 16384, 10 + b)
  BankPoke(b, 32767, 20 + b)
  BankPoke(b, 21845, 30 + b)
NEXT b
s = ""
FOR b = 0 TO 3
  s = s + T$(STR$(BankPeek(b, 16384))) + " " + T$(STR$(BankPeek(b, 32767))) + " " + T$(STR$(BankPeek(b, 21845))) + " "
NEXT b
CHK("peek_all_banks", s, "10 20 30 11 21 31 12 22 32 13 23 33 ")
REM changed: a true comparison is -1 in this language (it was 1); -( ) turns it back into 1, so the expected value is unchanged.
ok = -((PEEK(16384) = m0) AND (PEEK(32767) = m1) AND (PEEK(21845) = m2))
CHK("main_untouched", T$(STR$(ok)), "1")
CHK("peek_bad_bank", T$(STR$(BankPeek(4, 16384))), "0")
CHK("peek_below_window", T$(STR$(BankPeek(0, 16383))), "0")
CHK("peek_above_window", T$(STR$(BankPeek(0, 32768))), "0")
BankPoke(0, 16383, 99): BankPoke(0, 32768, 99): BankPoke(7, 16384, 99)
CHK("poke_refused", T$(STR$(BankPeek(0, 16384))) + " " + T$(STR$(-(PEEK(16383) <> 99 OR PEEK(16383) = m0))), "10 1")

REM ---------------- persistent select and the shadow ----------------
BankSelect(2)
CHK("select_2", T$(STR$(BankSelected())) + " " + T$(STR$(PEEK(16384))) + " " + T$(STR$(PEEK(32767))), "2 12 22")
POKE 16385, 77
BankOff()
CHK("off", T$(STR$(BankSelected())) + " " + T$(STR$(-(PEEK(16384) = m0))), "255 1")
CHK("poke_went_to_bank", T$(STR$(BankPeek(2, 16385))), "77")
BankSelect(3)
CHK("peek_keeps_selection", T$(STR$(BankPeek(1, 16384))) + " " + T$(STR$(BankSelected())) + " " + T$(STR$(PEEK(16384))), "11 3 13")
BankPoke(0, 16390, 5)
CHK("poke_keeps_selection", T$(STR$(BankSelected())) + " " + T$(STR$(PEEK(16384))), "3 13")
BankSelect(9)
CHK("select_out_of_range_is_off", T$(STR$(BankSelected())), "255")
BankSelect(1)
PRINT "printing with a bank selected"
CHK("print_keeps_selection", T$(STR$(BankSelected())) + " " + T$(STR$(PEEK(16384))), "1 11")
BankOff()

REM ---------------- copies ----------------
lens(0) = 1: lens(1) = 2: lens(2) = 255: lens(3) = 256: lens(4) = 257
lens(5) = 300: lens(6) = 511: lens(7) = 512: lens(8) = 513: lens(9) = 600
FOR i = 0 TO 599
  src(i) = CAST(UBYTE, (i * 13 + 5) AND 255)
NEXT i
ok = 1
FOR n = 0 TO 9
  FOR i = 0 TO 599
    dst(i) = 0xEE
  NEXT i
  REM the bank page, 600 bytes at &4100, = &EE, then a copy of lens(n) bytes
  IF BankCopyIn(1, 16640, @dst(0), 600) = 0 THEN ok = 0
  FOR i = 0 TO 599
    dst(i) = 0x55
  NEXT i
  IF BankCopyIn(1, 16640, @src(0), lens(n)) = 0 THEN ok = 0
  IF BankCopyOut(1, 16640, @dst(0), lens(n)) = 0 THEN ok = 0
  FOR i = 0 TO lens(n) - 1
    IF dst(i) <> src(i) THEN ok = 0
  NEXT i
  IF lens(n) < 600 THEN
    IF dst(lens(n)) <> 0x55 THEN ok = 0: PRINT "FAIL_DETAIL copy_out overrun "; lens(n)
    IF BankPeek(1, 16640 + lens(n)) <> 0xEE THEN ok = 0: PRINT "FAIL_DETAIL copy_in overrun "; lens(n)
  END IF
  IF ok = 0 THEN PRINT "FAIL_DETAIL copy length "; lens(n): EXIT FOR
NEXT n
CHK("copy_round_trips", T$(STR$(ok)), "1")
CHK("copy_left_main_alone", T$(STR$(-(PEEK(16384) = m0 AND PEEK(16640) = PEEK(16640)))), "1")

REM other banks untouched by the copy into bank 1: bank 2 at &4100 differs
BankPoke(2, 16640, 33)
IF BankCopyIn(1, 16640, @src(0), 16) = 0 THEN ok = 0
CHK("copy_other_bank_untouched", T$(STR$(BankPeek(2, 16640))), "33")

REM the window's edges
ok = 1
IF BankCopyIn(2, 32512, @src(0), 256) = 0 THEN ok = 0
FOR i = 0 TO 599
  dst(i) = 0
NEXT i
IF BankCopyOut(2, 32512, @dst(0), 256) = 0 THEN ok = 0
FOR i = 0 TO 255
  IF dst(i) <> src(i) THEN ok = 0
NEXT i
IF BankCopyIn(3, 32767, @src(0), 1) = 0 THEN ok = 0
IF BankPeek(3, 32767) <> src(0) THEN ok = 0
IF BankCopyIn(0, 16384, @src(0), 1) = 0 THEN ok = 0
IF BankPeek(0, 16384) <> src(0) THEN ok = 0
CHK("copy_window_edges", T$(STR$(ok)), "1")

REM refusals: bad bank, outside the window, main side in the window, len 0
BankPoke(1, 32767, 66)
CHK("refuse_bad_bank", T$(STR$(BankCopyIn(4, 16640, @src(0), 4))), "0")
CHK("refuse_below", T$(STR$(BankCopyIn(1, 16383, @src(0), 4))), "0")
CHK("refuse_straddles_top", T$(STR$(BankCopyIn(1, 32766, @src(0), 4))) + " " + T$(STR$(BankPeek(1, 32767))), "0 66")
CHK("refuse_above", T$(STR$(BankCopyIn(1, 32768, @src(0), 1))), "0")
CHK("refuse_main_in_window", T$(STR$(BankCopyIn(1, 16640, 16384, 4))) + T$(STR$(BankCopyOut(1, 16640, 32767, 1))), "00")
CHK("refuse_main_straddles", T$(STR$(BankCopyIn(1, 16640, 16380, 8))) + T$(STR$(BankCopyOut(1, 16640, 32760, 16))), "00")
CHK("refuse_main_wraps", T$(STR$(BankCopyOut(1, 16640, 65535, 2))), "0")
CHK("copy_len_0", T$(STR$(BankCopyIn(1, 16640, @src(0), 0))), "1")
CHK("copy_ok_main_top", T$(STR$(BankCopyIn(1, 16640, 65535, 1))), "1")
CHK("copy_selection_untouched", T$(STR$(BankSelected())), "255")

PRINT "DONE"
