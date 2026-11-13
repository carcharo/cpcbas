' UBYTE, BYTE, UINTEGER, INTEGER and LONG arithmetic with wrap-around.
' Comparisons appear only inside IF; AND/OR/NOT are not used on values.
DIM ub AS UBYTE
DIM sb AS BYTE
DIM ui AS UINTEGER
DIM si AS INTEGER
DIM sl AS LONG
DIM ul AS ULONG
DIM i AS UBYTE

ub = 250
FOR i = 1 TO 8
    ub = ub + 1
    PRINT "ub+ [";ub;"]"
NEXT i
ub = 3
FOR i = 1 TO 5
    ub = ub - 1
    PRINT "ub- [";ub;"]"
NEXT i

sb = 125
FOR i = 1 TO 5
    sb = sb + 1
    PRINT "sb+ [";sb;"]"
NEXT i
sb = -126
FOR i = 1 TO 4
    sb = sb - 1
    PRINT "sb- [";sb;"]"
NEXT i

ui = 65530
FOR i = 1 TO 8
    ui = ui + 1
    PRINT "ui+ [";ui;"]"
NEXT i
ui = 200
ui = ui * 400
PRINT "ui* [";ui;"]"
ui = 7
ui = ui - 9
PRINT "ui- [";ui;"]"

si = 32760
FOR i = 1 TO 10
    si = si + 1
    PRINT "si+ [";si;"]"
NEXT i
si = -300
si = si * 200
PRINT "si* [";si;"]"
si = 1000
PRINT "si mod [";si MOD 3;"] [";(si + 100) MOD 7;"]"

sl = 2147483640
FOR i = 1 TO 10
    sl = sl + 1
    PRINT "sl+ [";sl;"]"
NEXT i
sl = 100000
sl = sl * 1000
PRINT "sl* [";sl;"]"
sl = -100000
sl = sl * 30000
PRINT "sl* [";sl;"]"
ul = 4294967290
FOR i = 1 TO 8
    ul = ul + 1
    PRINT "ul+ [";ul;"]"
NEXT i
ul = 70000
ul = ul * 70000
PRINT "ul* [";ul;"]"
sl = 123456789
PRINT "sl mod [";sl MOD 1000;"] [";sl MOD 97;"]"

' mixed widths
ub = 200
ui = ub + ub
PRINT "mix [";ui;"]"
ub = ub + ub
PRINT "mix [";ub;"]"
si = -1
ui = si
PRINT "mix [";ui;"]"
sl = si
PRINT "mix [";sl;"]"
ub = 255
sb = ub
PRINT "mix [";sb;"]"
END
