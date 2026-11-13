10 REM comparisons print -1 or 0; AND OR XOR NOT work bitwise on 16-bit integers
20 a%=5:b%=9
30 PRINT a%=b%;a%<>b%;a%<b%;a%>b%;a%<=b%;a%>=b%
40 PRINT a%=5;a%<>5;a%<5;a%>5;a%<=5;a%>=5
50 PRINT -3<2;-3>2;-3<-4;-3>-4;0=-0
60 PRINT a%<b% AND b%<20;a%<b% AND b%>20;a%>b% OR b%>5;a%>b% OR b%>20
70 PRINT a%<b% XOR b%<20;a%<b% XOR b%>20
80 PRINT NOT (a%<b%);NOT (a%>b%);NOT 0;NOT -1;NOT 5;NOT -6
90 PRINT 10 AND 6;10 OR 6;10 XOR 6;12 AND 10;12 OR 10;12 XOR 10
100 PRINT -1 AND 255;-1 OR 0;-256 AND 4660;255 XOR -1
110 PRINT 1 AND 2 OR 4;1 OR 2 AND 4;NOT 1 AND 3
120 PRINT 3+4=7;3+4=8;(3<4)+(4<3);(3<4)*7
130 IF a%<b% AND NOT a%=b% THEN PRINT "yes" ELSE PRINT "no"
140 IF a%>b% OR a%=b% THEN PRINT "yes" ELSE PRINT "no"
150 PRINT 32767>-32768;-32768<32767;32767=32767;-32768=-32768
