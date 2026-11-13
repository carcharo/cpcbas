10 REM DATA and READ
20 DATA 10,20,-30
30 DATA hello, "quoted, with comma",  spaced out ,"x"
40 DATA 7,"seven"
50 READ a,b,c
60 PRINT a;b;c
70 READ a$,b$,c$,d$
80 PRINT "[";a$;"][";b$;"][";c$;"][";d$;"]"
90 READ n,s$
100 PRINT n;s$
110 RESTORE
120 READ x:PRINT x
130 RESTORE 40
140 READ y:PRINT y
150 READ z$:PRINT z$
160 RESTORE 30
170 READ w$:PRINT w$
180 RESTORE 20
190 FOR i=1 TO 3:READ v:PRINT v;:NEXT:PRINT
200 END
