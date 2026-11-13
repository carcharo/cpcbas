REM SIM: skip the simulator's fake firmware draws no pixels into screen memory; chipsrun runs it
REM Conformance: text output and its pixels (runs in firmware and bare mode).
REM
REM The pixels are read straight from screen memory (&C000, 80 bytes per character row, pixel
REM lines &800 apart): both modes draw the same bytes. A glyph row is expanded per mode: mode 2
REM one byte, mode 1 two, mode 0 four; the ink and paper are pens of the mode.
REM
REM Ported from cpcbuild. Changed with the language:
REM - PRINT AT row, col is kept (0-based), but POS and VPOS (the old POS() and CSRLIN()) count
REM   from 1, as Locomotive's do: "1,1" is the top left.
REM - SCREEN$ is COPYCHR$, which is firmware only and BASIC 1.1 (no 464); this program has to run
REM   bare as well, so a cell is recognised by its pixel bytes (Sig) against a reference cell
REM   printed first (the characters round trip of the original is in screen.bas, with COPYCHR$).
REM - INVERSE 1 is PAPER 1: PEN 0 (the swapped default pens; the firmware's CHR$(24) is not in the bare
REM   renderer); PAPER 2 / INK 4 are pens (PAPER 3, PEN 2: Locomotive's PEN and PAPER take pens, not colours).
REM - PRINT AT 0, 39; "ab" puts only "a" in the last column: Locomotive's PRINT starts a new line when the
REM   whole string does not fit (measured on the interpreter), so the wrap is checked with two PRINTs.
REM - The scroll is still pending after a line feed on the last row (the original's "cursor below the
REM   screen"): VPOS stays 25 where the original's CSRLIN said 25 (0-based row count 24 + 1).
REM   TAB(n) and the comma are Locomotive's: TAB to column n (1-based), the comma to the next
REM   zone (ZONE is 13 wide: columns 1, 14, 27).
REM - The runtime error path (__ERR_SCR, "Er!" drawn by the runtime) is not a language feature:
REM   its text is checked by the err-* programs in tests/loco.

#include "lib/chkbuf.bas"
#include "lib/scrolloff.bas"

REM Address of byte n (0-based) of pixel line y (0-7) of text cell (row, col), given the bytes per cell.
REM The firmware scrolls by moving the screen start (ScrollOffset), the bare text by copying.
FUNCTION CellAddr(row AS UBYTE, col AS UBYTE, bpc AS UBYTE, y AS UBYTE, n AS UBYTE) AS UINTEGER
  RETURN &C000 + CAST(UINTEGER, y) * 2048 + ((ScrollOffset() + CAST(UINTEGER, row) * 80 + CAST(UINTEGER, col) * bpc + n) AND &7FF)
END FUNCTION

FUNCTION Cell(row AS UBYTE, col AS UBYTE, bpc AS UBYTE, y AS UBYTE, n AS UBYTE) AS STRING
  RETURN N$(PEEK(CellAddr(row, col, bpc, y, n)))
END FUNCTION

REM A signature of the mode 1 cell (row, col): its sixteen glyph bytes in hex (short: a long string
REM would use up the 4.7 KB heap when a failure is recorded)
FUNCTION Sig(row AS UBYTE, col AS UBYTE) AS STRING
  DIM y AS UBYTE
  DIM s AS STRING
  s = ""
  FOR y = 0 TO 7
    s = s + HEX$(PEEK(CellAddr(row, col, 2, y, 0)), 2) + HEX$(PEEK(CellAddr(row, col, 2, y, 1)), 2)
  NEXT y
  RETURN s
END FUNCTION

FUNCTION Where() AS STRING
  RETURN N$(VPOS(#0)) + "," + N$(POS(#0))
END FUNCTION

DIM y AS UBYTE
DIM s AS STRING

REM --- mode 2: pen 1 on pen 0: the glyph byte itself ---
MODE 2
PRINT AT 0, 0; "A";
s = ""
FOR y = 0 TO 7
  s = s + Cell(0, 0, 1, y, 0) + ","
NEXT y
CHK("mode2_A", s, "24,60,102,102,126,102,102,0,")
PAPER 1: PEN 0
PRINT AT 1, 0; "A";
PAPER 0: PEN 1
s = ""
FOR y = 0 TO 7
  s = s + Cell(1, 0, 1, y, 0) + ","
NEXT y
CHK("mode2_A_inverse", s, "231,195,153,153,129,153,153,255,")
PRINT AT 2, 79; "B";
CHK("mode2_last_col_B", Cell(2, 79, 1, 0, 0), "252")

REM --- mode 1: pen 1 on pen 0: a glyph nibble n -> n << 4 per byte ---
MODE 1
PRINT AT 0, 0; "A";
s = ""
FOR y = 0 TO 7
  s = s + Cell(0, 0, 2, y, 0) + "/" + Cell(0, 0, 2, y, 1) + ","
NEXT y
CHK("mode1_A", s, "16/128,48/192,96/96,96/96,112/224,96/96,96/96,0/0,")
PAPER 1: PEN 0
PRINT AT 1, 0; "A";
PAPER 0: PEN 1
CHK("mode1_A_inverse_row0", Cell(1, 0, 2, 0, 0) + "/" + Cell(1, 0, 2, 0, 1), "224/112")
PAPER 3: PEN 2
PRINT AT 2, 0; "A";
REM paper pen 3 is &FF in mode 1, ink pen 2 is &0F: row 0 of A
CHK("mode1_A_pens_row0", Cell(2, 0, 2, 0, 0) + "/" + Cell(2, 0, 2, 0, 1), "239/127")
PAPER 0: PEN 1

REM --- mode 0: 4 bytes per cell ---
MODE 0
PEN 4: PAPER 5
PRINT AT 0, 0; "A";
s = Cell(0, 0, 4, 0, 0) + "/" + Cell(0, 0, 4, 0, 1) + "/" + Cell(0, 0, 4, 0, 2) + "/" + Cell(0, 0, 4, 0, 3)
REM row 0 of A is &18 = 00 01 10 00: pairs 0, 1, 2, 0
REM pair 0 -> paper both = &F0; pair 1 (right pixel ink) = &F0 xor (&55 and &C0) = &B0;
REM pair 2 (left pixel ink) = &F0 xor (&AA and &C0) = &70
CHK("mode0_A_row0", s, "240/176/112/240")
PRINT AT 24, 19; "Z";
CHK("mode0_last_col_Z", Cell(24, 19, 4, 0, 0) + "/" + Cell(24, 19, 4, 0, 3), "48/112")
MODE 1
PEN 1: PAPER 0

REM --- the cursor: wrap, newline, scroll, AT, CLS. References first: the cell of each letter used ---
PRINT AT 20, 0; "bclzry";
PRINT AT 20, 12; "a";
DIM sa, sb, sc, sl, sz, sr, sy, sp AS STRING
sb = Sig(20, 0)
sc = Sig(20, 1)
sl = Sig(20, 2)
sz = Sig(20, 3)
sr = Sig(20, 4)
sy = Sig(20, 5)
sa = Sig(20, 12)
sp = Sig(20, 10)
CLS
PRINT AT 0, 39; "a";
PRINT "b";
CHK("last_col_char", Sig(0, 39), sa)
CHK("wrap_char", Sig(1, 0), sb)
CHK("wrap_pos", Where(), "2,2")
REM Locomotive's PRINT starts a new line first when the whole string does not fit in the columns
REM left (measured on the interpreter): "bc" from column 40 goes to row 4, columns 1 and 2
PRINT AT 2, 39; "bc";
CHK("string_wrap_char", Sig(3, 0), sb)
CHK("string_wrap_char2", Sig(3, 1), sc)
CHK("string_wrap_pos", Where(), "4,3")
PRINT AT 5, 39; "c";
REM the cursor wraps as soon as a character fills the last column
CHK("wrap_at_once_pos", Where(), "7,1")
PRINT AT 10, 0; "row10";
PRINT AT 24, 0; "last";
PRINT
REM a line feed on the last row does not scroll yet (the firmware scrolls when the next character
REM comes, and VPOS stays 25: checked on the interpreter) ...
CHK("scroll_pending_cursor", Where(), "25,1")
CHK("not_scrolled_yet", Sig(24, 0), sl)
REM ... the next character scrolls first
PRINT "z";
CHK("scroll_cursor", Where(), "25,2")
CHK("scrolled_last", Sig(23, 0), sl)
CHK("scrolled_z", Sig(24, 0), sz)
CHK("scrolled_row10", Sig(9, 0), sr)
CHK("scrolled_new_row_blank", Sig(24, 1), sp)
PRINT
PRINT
CHK("double_lf_cursor", Where(), "25,1")
CHK("double_lf_z", Sig(23, 0), sz)
CHK("double_lf_last", Sig(22, 0), sl)
CLS
CHK("cls_home", Where(), "1,1")
PAPER 3
CLS
CHK("cls_paper3_byte", Cell(0, 0, 2, 0, 0) + "/" + Cell(24, 39, 2, 7, 1), "255/255")
PAPER 0
CLS
PRINT AT 3, 5; "x"; TAB(13); "y"; ,"z";
REM x is at column 6 (1-based), TAB(13) is column 13, the comma goes to the next zone: column 27
CHK("tab_y", Sig(3, 12), sy)
CHK("comma_z", Sig(3, 26), sz)
CHK("pos_after", N$(POS(#0)), "28")
CLS

PRINT AT 0, 0;
PRINT
Report()
PRINT "DONE"
END
