' Spec sections 5 and 18: CALL, RSX bar commands, @, CAST, typed PEEK and POKE, SIZEOF.
DIM buf(15) AS UBYTE
DIM w AS UINTEGER
DIM addr AS UINTEGER
addr = &8000
CALL &BB18
CALL &BC02
CALL KM_WAIT_KEY
CALL addr
CALL addr, 1
CALL &8000, 1, 2, @buf, "text"
CALL @Handler
|DISC
|TAPE
|A : |B
|DIR
|ERA, "old.bas"
|REN, "new.bas", "old.bas"
|USER, 2
|DRIVE, 1
|CPM
|MYCMD, 1, 2, 3
PRINT "after the bar commands" : |DIR

w = @buf
w = @Handler + @Start
b = CAST(UBYTE, w)
l = CAST(LONG, b) * 1000
r = CAST(REAL, w) / 3
x = PEEK(addr)
y = PEEK(UINTEGER, addr)
POKE addr, 5
POKE UINTEGER, addr, 1234
POKE addr + 1, PEEK(addr) + 1
s = SIZEOF(UBYTE) + SIZEOF(UINTEGER) + SIZEOF(buf) + SIZEOF(w)

Start:
SUB Handler()
  PRINT "called from machine code"
END SUB
