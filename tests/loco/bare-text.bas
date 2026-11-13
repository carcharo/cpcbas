10 REM text statements: bare-metal and firmware mode print the same
20 REM the probes read screen memory in ways the font does not change: a space shows the
30 REM paper pen as a screen byte; a letter, drawn on paper 0, shows which pen planes the
40 REM ink touched (GOSUB 500 ORs the bytes of the cell at a, w bytes wide)
50 MODE 1:w=2
60 PEN 2:PAPER 3
70 PRINT " ";:PRINT PEEK(&C000);PEEK(&C001)
80 PEN 2:PAPER 0:LOCATE 5,2:PRINT "M";
90 a=&C050+8:GOSUB 500
100 PRINT (o AND 240);(o AND 15)>0
110 PEN 1:LOCATE 7,2:PRINT "M";
120 a=&C050+12:GOSUB 500
130 PRINT (o AND 240)>0;(o AND 15)
140 PEN 1:PAPER 0
150 LOCATE 10,5
160 PRINT "x";POS(#0);VPOS(#0)
170 MODE 0:w=4
180 PEN 5:PAPER 9
190 LOCATE 3,2:PRINT " ";
200 PRINT PEEK(&C050+8);PEEK(&C050+11)
210 PAPER 0:LOCATE 4,2:PRINT "M";
220 a=&C050+12:GOSUB 500
230 PRINT (o AND 15);(o AND 240)>0
240 MODE 2
250 PEN 1:PAPER 0
260 PRINT "m2";POS(#0)
270 MODE 1
280 PAPER 2
290 CLS
300 PRINT PEEK(&C000);PEEK(&C04F);POS(#0);VPOS(#0)
310 PAPER 0
320 LOCATE 40,1:PRINT "q";POS(#0);VPOS(#0)
330 LOCATE 1,25:PRINT "last"
340 BORDER 2
350 PRINT "done"
360 END
500 o=0:FOR r=0 TO 7:FOR k=0 TO w-1:o=o OR PEEK(a+r*2048+k):NEXT:NEXT:RETURN
