10 REM LOCO: cap32
20 REM Files (L4-FILES): OPENOUT, PRINT #9, WRITE #9, CLOSEOUT, OPENIN, INPUT #9, LINE INPUT #9, EOF, DERR, SAVE and LOAD of a block,
30 REM the errors of a file that is not open or open twice. No AMSDOS message (a name not found) and no read past the end: the
40 REM interpreter prints AMSDOS's text through its hook and leaves the string unset after an EOF error, neither of which compiles the same.
50 ON ERROR GOTO 900
60 PRINT "DERR";DERR;"EOF";EOF
70 OPENOUT "F1.TXT"
80 PRINT #9,"hello";1;-2;3.5;"x"
90 PRINT #9,"a","b";TAB(20);"t";SPC(3);"s"
100 PRINT #9,USING "###.##";3.14159;2.5
110 PRINT #9,POS(#9);:PRINT #9,"abc";:PRINT POS(#9):PRINT #9
120 WRITE #9,"q,r",12,-3.5,"s"
130 WRITE #9,"only"
140 WRITE #9
150 a$="v":b!=7:WRITE #9,a$,b!,a$+"w",b!/4,1E10,.5
160 WRITE #9,1;2
170 CLOSEOUT
180 PRINT "A: written"
190 OPENIN "F1.TXT"
200 WHILE NOT EOF
210 LINE INPUT #9,l$:PRINT "[";l$;"]"
220 WEND
230 PRINT "EOF";EOF:CLOSEIN:PRINT "EOF";EOF
240 OPENIN "F1.TXT"
250 FOR i=1 TO 2:LINE INPUT #9,l$:NEXT
260 INPUT #9,x$:PRINT "[";x$;"]"
270 INPUT #9,x$,y$:PRINT "[";x$;"][";y$;"]"
280 LINE INPUT #9,l$
290 LINE INPUT #9,l$:PRINT "[";l$;"]"
300 INPUT #9,p$,n!,m%,q$:PRINT "[";p$;"]";n!;m%;"[";q$;"]"
310 LINE INPUT #9,l$:PRINT "[";l$;"]"
320 INPUT #9,p$,n!:PRINT "[";p$;"]";n!;"EOF";EOF
330 REM (nothing left to read)
340 CLOSEIN
350 OPENOUT "F2.TXT"
360 PRINT #9,"one,two"
370 PRINT #9,"  three  ,  four  "
380 PRINT #9,CHR$(34);"five,six";CHR$(34);"  ,seven"
390 PRINT #9,"8, 9 ,10"
400 PRINT #9,"1e3,255,.5,+7,abc,-4"
410 CLOSEOUT
420 OPENIN "F2.TXT"
430 DIM s$(3),v!(5)
440 INPUT #9,s$(1),s$(2)
450 INPUT #9,s$(3),a$
460 INPUT #9,a$,b$,c$
470 PRINT "[";s$(1);"][";s$(2);"][";s$(3);"][";a$;"][";b$;"][";c$;"]"
480 INPUT #9,v!(1),v!(2),v!(3):PRINT v!(1);v!(2);v!(3)
490 INPUT #9,v!(1),v!(2),v!(3),v!(4),v!(5):PRINT v!(1);v!(2);v!(3);v!(4);v!(5)
500 PRINT "EOF";EOF:CLOSEIN
510 PRINT "B: reading done"
520 FOR i=0 TO 99:POKE &C100+i,(i*7+3) AND 255:NEXT
530 SAVE "BIN1",B,&C100,100
540 SAVE "BIN2",B,&C100,40,&C120
550 LOAD "BIN1",&C800
560 k=0:FOR i=0 TO 99:IF PEEK(&C800+i)=PEEK(&C100+i) THEN k=k+1
570 NEXT:PRINT "same";k
580 FOR i=0 TO 99:POKE &C100+i,0:NEXT
590 LOAD "BIN1":k=0:FOR i=0 TO 99:IF PEEK(&C100+i)=((i*7+3) AND 255) THEN k=k+1
600 NEXT:PRINT "same";k
610 LOAD "BIN2",&C900:k=0:FOR i=0 TO 39:IF PEEK(&C900+i)=((i*7+3) AND 255) THEN k=k+1
620 NEXT:PRINT "same";k;PEEK(&C900+40)
630 PRINT "C: binary done"
640 PRINT "closing";:CLOSEIN:CLOSEOUT:PRINT " nothing open"
690 REM (INPUT #9 and PRINT #9 with no file open are error 24 and a cassette prompt on the 464, error 31 on the 6128: not compared)
700 OPENIN "F1.TXT":OPENIN "F1.TXT"
710 CLOSEIN
720 OPENOUT "F3.TXT":OPENOUT "F4.TXT"
730 CLOSEOUT
740 PRINT "DERR";DERR
750 OPENOUT "F5.TXT":PRINT #1,"one";:PRINT #9,"nine":WRITE #1,"w":CLOSEOUT:OPENIN "F5.TXT":LINE INPUT #9,l$:PRINT "[";l$;"]":CLOSEIN
760 END
900 PRINT "err";ERR:RESUME NEXT
