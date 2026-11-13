REM Conformance: 32-bit operations with the interrupt handler running. The reference
REM runtime's __SWAP32 (used when the compiler swaps the operands of a 32-bit division, MOD,
REM ...) moves SP over the stacked value for a few instructions, leaving that value below SP
REM where an interrupt's pushes overwrite it. Compiled cpc code runs with interrupts at 300 Hz
REM and about one ULONG division in 200 gave a wrong answer. The cpc runtime has its own
REM swap32.asm that only PUSHes and POPs. 6000 divisions and 6000 MODs here, each against the
REM value computed once, would show about 30 bad results with the original.
REM
REM Ported from cpcbuild; the `DIM i, badDiv, badMod, badSub AS ULONG` list form is kept.

#include "lib/chk.bas"

DIM i, badDiv, badMod, badSub AS ULONG
DIM x, a, wantDiv, wantMod, wantSub AS ULONG
DIM d AS UBYTE

a = 1920000
d = 120
wantDiv = a \ 120
wantMod = a MOD 1000
wantSub = 5000000 - a
FOR i = 1 TO 6000
  x = a \ 120
  IF x <> wantDiv THEN badDiv = badDiv + 1
  x = a MOD 1000
  IF x <> wantMod THEN badMod = badMod + 1
  x = 5000000 - a
  IF x <> wantSub THEN badSub = badSub + 1
NEXT i
CHK("ulong_div_const", T$(STR$(badDiv)), "0")
CHK("ulong_mod_const", T$(STR$(badMod)), "0")
CHK("ulong_sub", T$(STR$(badSub)), "0")
CHK("div_value", T$(STR$(wantDiv)), "16000")
CHK("mod_value", T$(STR$(wantMod)), "0")
PRINT "DONE"
