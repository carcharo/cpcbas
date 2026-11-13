' Spec sections 2 and 3: line-layout oddities of typed-in Locomotive listings:
' mixed case keywords, leading and trailing blanks, a bare line number, REM and
' apostrophe comments after statements, a question mark, tabs, colons in a row
' and a statement after a trailing colon. Own program.
10 Print "Mixed" : pRiNt "case"
20     REM   indented comment : not a statement
30 x = 1 : ' trailing comment
40 ::
50 ? x : ? "two" ; x
60 	FOR	i = 1	TO 3 : NEXT
70 IF x = 1 THEN PRINT "one" : PRINT "still in the THEN part"
80 IF x = 2 THEN PRINT "two" ELSE PRINT "not two" : PRINT "also in the ELSE part"
90 PRINT "done" :
100 REM
110 '
120
130 END
