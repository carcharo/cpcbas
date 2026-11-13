10 DEFREAL a-z
20 ON ERROR GOTO 900
30 REM what the interpreter does on a REAL error (FWM-CORE records it; the error numbers are L4)
40 x=1E38:y=0:z=-1
50 PRINT "add";x*1.5+x*1.5
60 PRINT "sub";-x*1.5-x*1.5
70 PRINT "mul";x*10
80 PRINT "div";x/0.001
90 PRINT "div0";1/y
100 PRINT "div00";y/y
110 PRINT "sqr";SQR(z)
120 PRINT "log0";LOG(y)
130 PRINT "logneg";LOG(z)
140 PRINT "log100";LOG10(y)
150 PRINT "exp88";EXP(88)
160 PRINT "exp89";EXP(89)
170 PRINT "expneg";EXP(-100)
180 PRINT "sin1e6";SIN(1E6)
190 PRINT "cos1e6";COS(1E6)
200 PRINT "tan1e6";TAN(1E6)
210 PRINT "sin1e5";SIN(100000)
220 PRINT "pow0neg";y^z
230 PRINT "pow00";y^y
240 PRINT "negfrac";(-2)^0.5
250 PRINT "negint";(-2)^3
260 PRINT "powbig";10^39
270 PRINT "powsmall";10^-39
280 PRINT "atn";ATN(x)
290 PRINT "cint";CINT(40000)
300 PRINT "int";INT(1E10)
310 PRINT "end"
320 END
900 PRINT "ERR";ERR;ERL:RESUME NEXT
