REM Text output for bare-metal tests that must not need PRINT: characters go straight to the
REM printer port through the runtime's .core.__CPC_PRN_CHAR (bareboot.asm; A = character),
REM which the harness captures like PRINT's echo. Only for -D CPC_BAREMETAL builds.
REM
REM   BPutCh(c)              one character (10 = newline)
REM   BPrint(s)              a string, no newline
REM   BNum(v)                a signed decimal number (no strings, no heap)
REM   BLine(s)               a string and a newline
REM   BCHK(name, got, want)  "PASS name" / "FAIL name got=G want=W" (numbers)
REM   BRng(name, v, lo, hi)  PASS if lo <= v <= hi
REM   BDone()                "DONE" and a newline
REM   BState()               asks chipsrun for a state dump (see chipsrun.c);
REM                          then spin ~10 frames so the dump sees this state
REM
REM Ported from cpcbuild. Changed with the language: CODE(s(i TO i)) is ASC(MID$(s, i + 1, 1));
REM BNum prints the digits from the largest power of ten down instead of collecting them in a
REM local array (the same output, no array, no heap).

#ifndef __CONFORMANCE_BAREOUT__
#define __CONFORMANCE_BAREOUT__

#include <framehook.bas>

#ifndef CPC_BAREMETAL
#error "bareout.bas is for -D CPC_BAREMETAL builds only"
#endif

SUB FASTCALL BPutCh(c AS UBYTE)
  ASM
  call .core.__CPC_PRN_CHAR
  END ASM
END SUB

SUB BPrint(s AS STRING)
  DIM i AS UINTEGER
  IF LEN(s) = 0 THEN EXIT SUB
  FOR i = 1 TO LEN(s)
    BPutCh(ASC(MID$(s, i, 1)))
  NEXT i
END SUB

SUB BLine(s AS STRING)
  BPrint(s)
  BPutCh(10)
END SUB

SUB BNum(v AS LONG)
  DIM u AS ULONG
  DIM p AS ULONG
  DIM d AS ULONG
  DIM started AS UBYTE
  IF v < 0 THEN
    BPutCh(45)
    u = CAST(ULONG, 0 - v)
  ELSE
    u = CAST(ULONG, v)
  END IF
  p = 1000000000
  started = 0
  DO
    d = u \ p
    u = u MOD p
    IF d > 0 OR started = 1 OR p = 1 THEN
      BPutCh(48 + CAST(UBYTE, d))
      started = 1
    END IF
    p = p \ 10
  LOOP WHILE p > 0
END SUB

SUB BCHK(name AS STRING, got AS LONG, want AS LONG)
  IF got = want THEN
    BPrint("PASS ")
    BLine(name)
  ELSE
    BPrint("FAIL ")
    BPrint(name)
    BPrint(" got=")
    BNum(got)
    BPrint(" want=")
    BNum(want)
    BPutCh(10)
  END IF
END SUB

SUB BRng(name AS STRING, v AS LONG, lo AS LONG, hi AS LONG)
  IF v >= lo AND v <= hi THEN
    BPrint("PASS ")
    BLine(name)
  ELSE
    BPrint("FAIL ")
    BPrint(name)
    BPrint(" got=")
    BNum(v)
    BPrint(" want=")
    BNum(lo)
    BPrint("..")
    BNum(hi)
    BPutCh(10)
  END IF
END SUB

SUB BDone()
  BLine("DONE")
END SUB

SUB BState()
  DIM t AS ULONG
  BPutCh(4)
  BPrint("STATE")
  BPutCh(10)
  t = Frames() + 10
  DO
  LOOP UNTIL Frames() >= t
END SUB

#endif
