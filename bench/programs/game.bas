10 DEFREAL a-z:DEFINT i,k,m
20 REM game-shaped: a 360-entry SIN/COS table (degrees), then 2000 rotations of a point
30 DEG
40 DIM s(359),c(359)
50 t=TIME
60 FOR i=0 TO 359
70 s(i)=SIN(i):c(i)=COS(i)
80 NEXT i
90 e=TIME
100 PRINT "~";e-t
110 x=100:y=0
120 t=TIME
130 FOR k=1 TO 2000
140 m=k MOD 360
150 nx=x*c(m)-y*s(m)
160 ny=x*s(m)+y*c(m)
170 x=nx:y=ny
180 NEXT k
190 e=TIME
200 PRINT "~";e-t
210 PRINT x;y
