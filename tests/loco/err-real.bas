10 REM L4-ERR (follow-up 60): the REAL errors Locomotive does not stop for. No handler: the name is printed on the current
20 REM line, a newline, and the program goes on with the firmware's result
30 DEFREAL a-z
40 x=1E38:y=0:z=-1
50 PRINT "add";x*1.5+x*1.5
60 PRINT "sub";-x*1.5-x*1.5
70 PRINT "mul";x*10
80 PRINT "div";x/0.001
90 PRINT "div0";1/y
100 PRINT "negdiv0";z/y
110 PRINT "div00";y/y
120 PRINT "log0";LOG(y)
130 PRINT "logneg";LOG(z)
140 PRINT "log100";LOG10(y)
150 PRINT "exp88";EXP(88)
160 PRINT "exp89";EXP(89)
170 PRINT "expneg";EXP(-100)
180 PRINT "pow0neg";y^z
190 PRINT "pow00";y^y
200 PRINT "powbig";10^39
210 PRINT "powsmall";10^-39
220 PRINT 1/y
230 DEG
240 PRINT "tan90";TAN(90)
250 RAD
260 PRINT "sin1e5";SIN(100000)
270 PRINT "int";INT(1E10)
280 PRINT "atn";ATN(x)
290 a=1/y:b=a+1
300 PRINT "after";b
310 PRINT "end"
