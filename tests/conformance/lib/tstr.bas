REM T$ and N$ for programs that carry their own CHK (lib/chk.bas has the same two functions
REM with a printing CHK; lib/chkbuf.bas includes this file). Locomotive's STR$ puts a space before
REM a number that is not negative: STR$(5) is " 5". N$(v) is the text of an integer without the
REM space; T$(s$) drops one leading space from any text (T$(STR$(x)) for a REAL, FIXED or ULONG).

#ifndef __CONF_TSTR__
#define __CONF_TSTR__

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
