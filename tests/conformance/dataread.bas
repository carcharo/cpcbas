REM Conformance: DATA/READ/RESTORE -- numbers and strings, RESTORE to a label. Expected
REM values computed by hand.
REM
REM Ported from cpcbuild; STR$ became N$ (Locomotive's number text has a leading space for a
REM non-negative number, N$ drops it).

#include "lib/chk.bas"

DATA 10, 20, 30
DATA "ALPHA", "BETA"
DATA -5, 300

RESTORE
DIM n1 AS INTEGER
DIM n2 AS INTEGER
DIM n3 AS INTEGER
READ n1, n2, n3
CHK("read_n1", N$(n1), "10")
CHK("read_n2", N$(n2), "20")
CHK("read_n3", N$(n3), "30")

DIM s1$ AS STRING
DIM s2$ AS STRING
READ s1$, s2$
CHK("read_s1", s1$, "ALPHA")
CHK("read_s2", s2$, "BETA")

DIM neg AS INTEGER
DIM big AS INTEGER
READ neg, big
CHK("read_neg", N$(neg), "-5")
CHK("read_big", N$(big), "300")

REM RESTORE with no label continues from the top of all DATA again.
RESTORE
DIM again AS INTEGER
READ again
CHK("restore_plain", N$(again), "10")

REM RESTORE <label>: jump READ's cursor to the DATA statement(s) that textually follow that
REM label, wherever it is in the file.
RESTORE lblMid
DIM midv AS INTEGER
DIM midv2$ AS STRING
READ midv, midv2$
CHK("restore_label_num", N$(midv), "777")
CHK("restore_label_str", midv2$, "LABELDATA")

REM A READ past the last DATA item raises "DATA exhausted" (Locomotive error 4): not
REM exercised here, it would end the program before DONE could print.

GOTO lblSkip
lblMid:
DATA 777, "LABELDATA"
lblSkip:

PRINT "DONE"
END
