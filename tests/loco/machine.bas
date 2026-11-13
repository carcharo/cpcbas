10 REM INP, OUT, WAIT, FRE, HIMEM, the flyback wait, STOP
20 MEMORY &8FFF
30 REM FRE and HIMEM differ between the interpreter and the compiled heap: only their sense is compared
40 PRINT FRE(0)>1000, FRE("")>1000, FRE(0)=FRE("")
50 PRINT HIMEM>1000, HIMEM<65535
60 REM a port with nothing on it reads &FF; the PPI's port B reads with bits 5-7 and 0 under the machine's control
70 PRINT INP(&FF00)
80 PRINT INP(&F500) AND &1E
90 OUT &FF00,0
100 REM WAIT with a mask that is already set returns at once; the vsync bit sets within a frame (WAIT with an inversion hangs the interpreter: not used)
110 WAIT &FF00,&80
120 PRINT "wait 1"
140 WAIT &F500,1
150 PRINT "wait 2"
170 PRINT "before stop";
180 STOP
190 PRINT "not reached"
