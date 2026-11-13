REM Shared self-check helper for tests/conformance/*.bas.
REM
REM CHK prints "PASS <name>" if gotv = wantv, else
REM "FAIL <name> got=<gotv> want=<wantv>". Both sides are strings (the caller formats
REM them) so the helper never has to know which numeric type is under test.
REM
REM Locomotive's number text (STR$ and PRINT) puts a space before a number that is not
REM negative: STR$(5) is " 5". The ported expectations are written without that space
REM ("5"), so the numbers go through one of two helpers:
REM   N$(v)   the text of an integer (BYTE .. LONG, UBYTE .. UINTEGER) without the space
REM   T$(s$)  s$ without one leading space; for STR$ of a REAL, a FIXED or a ULONG,
REM           e.g. T$(STR$(x)), which N$ would convert to LONG on the way in

#ifndef __CONFORMANCE_CHK__
#define __CONFORMANCE_CHK__

SUB CHK(name AS STRING, gotv AS STRING, wantv AS STRING)
  IF gotv = wantv THEN
    PRINT "PASS "; name
  ELSE
    PRINT "FAIL "; name; " got="; gotv; " want="; wantv
  END IF
END SUB

FUNCTION T$(s AS STRING) AS STRING
  IF LEN(s) > 0 THEN
    IF LEFT$(s, 1) = " " THEN RETURN MID$(s, 2)
  END IF
  RETURN s
END FUNCTION

FUNCTION N$(v AS LONG) AS STRING
  RETURN T$(STR$(v))
END FUNCTION

#endif
