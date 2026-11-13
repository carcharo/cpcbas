' Spec section 7: SUB and FUNCTION.
' Parameter kinds, defaults, calling conventions and the two ways to return a value.
DECLARE SUB Later(n AS UBYTE)
DECLARE FUNCTION Soon(n AS UBYTE) AS UBYTE

SUB Chirp()
  BEEP 1, 20
END SUB

SUB PlotTwo(x AS UBYTE, y AS UBYTE)
  PLOT x, y
  PLOT x + 1, y
END SUB

SUB Copy(BYVAL ch AS UBYTE, BYREF dest AS UBYTE, count AS UINTEGER = 16)
  dest = ch
END SUB

SUB SumAll(values() AS UBYTE, n AS UINTEGER)
  DIM i AS UINTEGER
  DIM total AS UINTEGER
  FOR i = 0 TO n - 1
    total = total + values(i)
  NEXT i
END SUB

SUB FASTCALL SetBorder(c AS UBYTE)
  ASM
    ld b, a
    ld c, 0
  END ASM
END SUB

SUB STDCALL Pause2(frames AS UBYTE)
  DIM i AS UBYTE
  DIM scratch(7) AS UBYTE
  FOR i = 1 TO frames
    FRAME
    IF INKEY$ <> "" THEN EXIT SUB
  NEXT
END SUB

FUNCTION Add(a AS INTEGER, b AS INTEGER) AS INTEGER
  RETURN a + b
END FUNCTION

FUNCTION Twice(n AS INTEGER) AS INTEGER
  Twice = n * 2
END FUNCTION

FUNCTION Fact(n AS UINTEGER) AS ULONG
  IF n < 2 THEN RETURN 1
  RETURN n * Fact(n - 1)
END FUNCTION

FUNCTION Clamp(v AS INTEGER, lo AS INTEGER = 0, hi AS INTEGER = 255) AS INTEGER
  IF v < lo THEN RETURN lo
  IF v > hi THEN RETURN hi
  RETURN v
END FUNCTION

FUNCTION FindFirst(BYREF s AS STRING, ch AS UBYTE) AS UINTEGER
  DIM i AS UINTEGER
  FOR i = 1 TO LEN(s)
    IF ASC(MID$(s, i, 1)) = ch THEN EXIT FUNCTION
  NEXT
  RETURN 0
END FUNCTION

DIM buf(9) AS UBYTE
DIM v AS INTEGER
Chirp()
PlotTwo(10, 20)
PlotTwo 10, 20
Copy 65, buf(0)
Copy(65, buf(0), 4)
SumAll(buf, 10)
SetBorder(3)
Pause2 25
v = Add(1, 2) + Twice(4) + Clamp(300) + Clamp(-5, 0, 100)
PRINT Fact(5); FindFirst("HELLO", 76)
Later(1)
PRINT Soon(2)
