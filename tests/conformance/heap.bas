REM Conformance: heap / memory allocation patterns via MemAvail()/MaxAvail() (lib/heapinfo.bas,
REM the free-list walks of the reference compiler's stdlib).
REM
REM All measurements are taken into plain UINTEGER variables before any CHK call runs: CHK's
REM own string arguments touch the heap (temporary strings), which would perturb a
REM measurement taken inside the same statement as a check.
REM
REM Ported from cpcbuild. The runtime allocator is the same, so the byte deltas are the same
REM (15 for "HELLO WORLD": 11 characters + 2 length bytes + 2 block header; 26/41 after a$+a$).
REM Changed with the language: `FRE` is not used, the pragma sets the heap size as before.

#pragma heap_size = 4096
#include "lib/heapinfo.bas"
#include "lib/chk.bas"

DIM base AS UINTEGER
DIM baseMem AS UINTEGER
base = MaxAvail()
baseMem = MemAvail()

DIM a$ AS STRING
a$ = "HELLO WORLD"
DIM afterAllocMax AS UINTEGER
DIM afterAllocMem AS UINTEGER
afterAllocMax = MaxAvail()
afterAllocMem = MemAvail()

a$ = a$ + a$
DIM afterConcatMax AS UINTEGER
DIM afterConcatMem AS UINTEGER
afterConcatMax = MaxAvail()
afterConcatMem = MemAvail()

a$ = ""
DIM afterFreeMax AS UINTEGER
afterFreeMax = MaxAvail()

REM ---- churn: allocate/free many strings of varying size in a loop. The allocator can leave a
REM small, fixed residue of free-list bookkeeping behind after a churn of allocation sizes
REM (fragmentation, not a leak). An actual per-iteration leak would keep shrinking as the rep
REM count grows, so the check is that 10x as much churn lands on the same final value. ----
DIM churn$ AS STRING
DIM rep AS UINTEGER
DIM k AS UBYTE

FOR rep = 1 TO 20
  churn$ = ""
  FOR k = 1 TO (rep MOD 10) + 1
    churn$ = churn$ + "XYZ"
  NEXT k
NEXT rep
churn$ = ""
DIM afterChurn20 AS UINTEGER
afterChurn20 = MemAvail()

FOR rep = 1 TO 200
  churn$ = ""
  FOR k = 1 TO (rep MOD 10) + 1
    churn$ = churn$ + "XYZ"
  NEXT k
NEXT rep
churn$ = ""
DIM afterChurn200 AS UINTEGER
afterChurn200 = MemAvail()

REM ---- now that every measurement is captured, check them ----
DIM same AS INTEGER
same = (baseMem = base)
CHK("initial_avail_eq", N$(same), "-1")
CHK("after_alloc_maxavail_delta", N$(base - afterAllocMax), "15")
CHK("after_alloc_memavail_delta", N$(baseMem - afterAllocMem), "15")
CHK("after_concat_maxavail_delta", N$(base - afterConcatMax), "41")
CHK("after_concat_memavail_delta", N$(baseMem - afterConcatMem), "26")
CHK("after_free_recovers", N$(base - afterFreeMax), "4")
CHK("churn_no_growth", N$(afterChurn20), N$(afterChurn200))

PRINT "DONE"
END
