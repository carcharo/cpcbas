10 DEFREAL a-z:DEFINT i
20 REM the 2026-09-28 float benchmark (cpcbuild bench/locomotive/bench4_float.bas): checksum 6688.08573
30 t=TIME
40 chk=0
50 FOR i=1 TO 200
60 x=SQR(i)*SIN(i)+i/3.0
70 chk=chk+x
80 NEXT i
90 e=TIME
100 PRINT "~";e-t
110 PRINT chk
