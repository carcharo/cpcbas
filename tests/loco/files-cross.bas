10 REM LOCO-DISK: F1.TXT=files-cross.txt
20 REM The other direction (L4-FILES): F1.TXT is what the compiled runtime wrote for lines 70-170 of files.bas (test/files-run.test.ts checks the bytes),
30 REM read here by the interpreter and by the compiled build alike. Its transcript is the interpreter's.
40 OPENIN "F1.TXT"
50 WHILE NOT EOF
60 LINE INPUT #9,l$:PRINT "[";l$;"]"
70 WEND
80 CLOSEIN
90 OPENIN "F1.TXT"
100 FOR i=1 TO 2:LINE INPUT #9,l$:NEXT
110 INPUT #9,x$:PRINT "[";x$;"]"
120 INPUT #9,x$,y$:PRINT "[";x$;"][";y$;"]"
130 LINE INPUT #9,l$
140 LINE INPUT #9,l$:PRINT "[";l$;"]"
150 INPUT #9,p$,n!,m%,q$:PRINT "[";p$;"]";n!;m%;"[";q$;"]"
160 INPUT #9,r!,s!,t!:PRINT r!;s!;t!
170 PRINT "EOF";EOF
180 CLOSEIN
