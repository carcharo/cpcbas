REM Buffered CHK for programs that check the screen: CHK does not print, because PRINT would
REM scroll the screen or write characters over the area under test. A passing check is counted
REM (npass); a failing one is counted (nfail) and its line is appended to results$ (lines end with
REM CHR$(13); the printer echo turns a CR into a line end, which is what the runner reads).
REM Report() prints the failed lines, the counts and, if any check failed, a FAIL line with the
REM count, so a failure can never be lost.
REM
REM Changed from cpcbuild's copies, which collected a "PASS name" line for every check: a string
REM past about 1 KB makes the next concatenation (its temporaries) run out of the 4.7 KB heap, the
REM allocation fails and results$ silently comes back empty. cb_fill lost its first 40 results
REM that way (in the reference compiler's build too), so a big program counts instead; the
REM failing lines are kept only while results$ is short, the count of failures is not.

#ifndef __CONFORMANCE_CHK__
#define __CONFORMANCE_CHK__

#include "tstr.bas"

DIM results$ AS STRING
DIM npass, nfail AS UINTEGER

SUB CHK(name AS STRING, gotv AS STRING, wantv AS STRING)
  IF gotv = wantv THEN
    npass = npass + 1
  ELSE
    nfail = nfail + 1
    IF LEN(results$) < 500 THEN
      results$ = results$ + "FAIL " + name + " got=" + gotv + " want=" + wantv + CHR$(13)
    END IF
  END IF
END SUB

SUB Report()
  PRINT results$;
  IF nfail > 0 THEN
    PRINT "FAIL "; N$(nfail); " of "; N$(nfail + npass); " checks failed"
  END IF
  PRINT "PASS "; N$(npass); " checks"
END SUB

#endif
