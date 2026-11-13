10 ON ERROR GOTO 900
20 e=0:x=INSTR("abc",""):PRINT "A";x;e
30 e=0:x=INSTR(2,"abc",""):PRINT "B";x;e
40 e=0:x=INSTR(4,"abc",""):PRINT "C";x;e
50 e=0:x=INSTR(5,"abc",""):PRINT "D";x;e
60 e=0:x=INSTR("",""):PRINT "E";x;e
70 END
900 e=ERR:RESUME NEXT
