10 ON ERROR GOTO 900
20 e=0:x=-99:x=ASC(""):PRINT "ASC";x;e
30 e=0:s$="?":s$=STRING$(3,""):PRINT "S3[";s$;"]";LEN(s$);e
40 e=0:s$="?":s$=STRING$(0,""):PRINT "S0[";s$;"]";LEN(s$);e
50 END
900 e=ERR:RESUME NEXT
