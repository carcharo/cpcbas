10 REM strings
20 a$="Hello":b$="World"
30 PRINT a$+" "+b$
40 PRINT LEN(a$);LEN(b$);LEN("");LEN(a$+b$)
50 PRINT LEFT$(a$,2);"|";RIGHT$(a$,2);"|";MID$(a$,2,3);"|";MID$(a$,4);"|";LEFT$(a$,0);"|";LEFT$(a$,9)
60 PRINT CHR$(65);CHR$(97);ASC("A");ASC("abc");ASC(a$)
70 PRINT STR$(5);"|";STR$(-5);"|";STR$(0);"|";STR$(100);"|";STR$(-32768)
80 PRINT LEN(STR$(12345));LEN(STR$(-1))
90 PRINT "[";SPACE$(3);"]";"[";SPACE$(0);"]";STRING$(4,"x");STRING$(3,65)
100 PRINT a$="Hello";a$="hello";a$<>b$;a$<b$;a$>b$;a$<="Hello";"abc"<"abd";"ab"<"abc";""<"a"
110 PRINT "Z"<"a";"10"<"9";"A">"a"
120 c$=a$:c$=c$+"!"
130 PRINT c$;LEN(c$);a$
140 d$=""
150 FOR i=1 TO 3:d$=d$+CHR$(48+i):NEXT
160 PRINT d$;LEN(d$)
170 k$=INKEY$
180 PRINT LEN(k$);LEN(INKEY$);k$=""
200 PRINT MID$(a$,2,1)+MID$(b$,1,1)
220 e$=STRING$(3,"ab")
230 PRINT e$
