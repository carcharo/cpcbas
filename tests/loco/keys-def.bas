10 REM LOCO-TYPE: a|b|A|c
20 REM KEY, KEY DEF and SPEED KEY: typed keys go through the new translations (key 69 is "a", key 54 is "b")
30 KEY 2,"xyz"
40 KEY DEF 69,1,130,83
50 KEY DEF 54,1,66
60 SPEED KEY 10,5
70 FOR i=1 TO 3
80 INPUT a$
90 PRINT "[";a$;"]"
100 NEXT
110 INPUT a$
120 PRINT "[";a$;"]"
