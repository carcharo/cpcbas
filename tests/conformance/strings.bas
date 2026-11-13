REM Conformance: strings -- concat, slicing, LEN, CHR$/ASC, STR$, comparisons, string arrays,
REM long strings / heap churn. Expected values computed by hand (plain string ops).
REM
REM Ported from cpcbuild. Changed with the language: slicing `h$(2 TO 4)` is MID$ (1-based, so
REM the start is one more and the second argument is the length); CODE is ASC; STR$ gives
REM Locomotive's text with a leading space for a non-negative number (the three STR$ checks
REM expect it; the others go through N$, which drops it).

#include "lib/chk.bas"

DIM a$ AS STRING
DIM b$ AS STRING
DIM c$ AS STRING

a$ = "AB"
b$ = "CD"
c$ = a$ + b$
CHK("concat", c$, "ABCD")

DIM h$ AS STRING
h$ = "HELLO WORLD"
CHK("len", N$(LEN(h$)), "11")
CHK("slice_2_4", MID$(h$, 3, 3), "LLO")
CHK("slice_0_0", MID$(h$, 1, 1), "H")
CHK("slice_last", MID$(h$, 11, 1), "D")
CHK("left", LEFT$(h$, 5), "HELLO")
CHK("right", RIGHT$(h$, 5), "WORLD")

CHK("chr_65", CHR$(65), "A")
CHK("code_A", N$(ASC("A")), "65")
CHK("code_space", N$(ASC(" ")), "32")

REM changed: STR$ of a non-negative number starts with a space (the original expected "42", "0")
CHK("str_pos", STR$(42), " 42")
CHK("str_neg", STR$(-7), "-7")
CHK("str_zero", STR$(0), " 0")

DIM lhs$ AS STRING
DIM rhs$ AS STRING
DIM cmp1 AS INTEGER
DIM cmp2 AS INTEGER
DIM cmp3 AS INTEGER
lhs$ = "ABC"
rhs$ = "ABD"
cmp1 = (lhs$ < rhs$)
rhs$ = "ABC"
cmp2 = (lhs$ = rhs$)
lhs$ = "B"
rhs$ = "A"
cmp3 = (lhs$ > rhs$)
REM changed: true is -1 (it was 1)
CHK("cmp_lt", N$(cmp1), "-1")
CHK("cmp_eq", N$(cmp2), "-1")
CHK("cmp_gt", N$(cmp3), "-1")

REM -- string arrays --
DIM sa$(4) AS STRING
sa$(0) = "ZERO"
sa$(1) = "ONE"
sa$(2) = "TWO"
sa$(3) = "THREE"
sa$(4) = "FOUR"
CHK("strarr_join", sa$(0) + sa$(2) + sa$(4), "ZEROTWOFOUR")
sa$(1) = sa$(1) + "!"
CHK("strarr_mutate", sa$(1), "ONE!")

REM -- long strings / heap churn: build a string to 260 chars (past a single-byte length if
REM this were ever mistaken for one, and enough to exercise a handful of heap growth
REM reallocations), then release it, many times over, checking the length each time.
DIM big$ AS STRING
DIM i AS UINTEGER
DIM reps AS UINTEGER
DIM okBig AS INTEGER
okBig = -1
FOR reps = 1 TO 20
  big$ = ""
  FOR i = 1 TO 26
    big$ = big$ + "ABCDEFGHIJ"
  NEXT i
  IF LEN(big$) <> 260 THEN
    okBig = 0
  END IF
NEXT reps
CHK("heap_churn_len", N$(okBig), "-1")

REM After the loop releases every intermediate buffer, the final buffer is still 260 chars and
REM its content is the expected repeat.
CHK("heap_churn_final_len", N$(LEN(big$)), "260")
CHK("heap_churn_final_head", LEFT$(big$, 10), "ABCDEFGHIJ")
CHK("heap_churn_final_tail", MID$(big$, 251, 10), "ABCDEFGHIJ")

PRINT "DONE"
END
