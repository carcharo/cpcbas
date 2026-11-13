10 REM string functions on the empty string or out of range: Improper argument (5), trapped
20 ON ERROR GOTO 900
30 e$=""
40 PRINT "asc";ASC(e$)
50 PRINT "mid0";MID$("abc",0)
60 PRINT "chr256";CHR$(256)
70 n=-1:PRINT "left";LEFT$("abc",n)
80 PRINT "space";SPACE$(n)
90 PRINT "string";STRING$(n,"a")
100 PRINT "ok";ASC("A");MID$("abc",2);CHR$(65);LEFT$("abc",0)
110 END
900 PRINT "ERR";ERR;"ERL";ERL:RESUME NEXT
