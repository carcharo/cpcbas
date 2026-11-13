' Spec section 9: every PRINT item form.
a$ = "text" : x = 1 : y = 2 : n = 7
PRINT
PRINT "Hello"
PRINT "a"; "b";
PRINT
PRINT "a", "b"
PRINT 1; 2; 3
PRINT x, y;
PRINT
PRINT #0, "to the window"
PRINT #8, "to the printer"
PRINT #1,
PRINT #2, a$; x
PRINT AT 3, 5; "at"
PRINT #1, AT 1, 1; "stream and position"
PRINT TAB(10); "tabbed"
PRINT SPC(5); "spaced"; TAB(20); x; SPC(2); y
PRINT USING "###.##"; 3.14159
PRINT USING "###.## ###.##"; x; y
PRINT USING "\   \"; a$
PRINT USING "&"; a$;
PRINT #1, USING "##"; n
PRINT USING "+###"; n; : PRINT USING "**###"; n
? "question mark"
? x; y
?
PRINT CHR$(7);
PRINT a$ + "!"; LEFT$(a$, 2)
PRINT -x; (x + 1) * 2
PRINT "total:"; x + y, "avg:"; (x + y) / 2
