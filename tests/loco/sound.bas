5 DEFREAL x
10 REM L4-SOUND: SOUND, ENV, ENT, RELEASE and SQ. SQ is read only where nothing can move by itself:
20 REM idle channels, notes held at the head of the queue, a flush, a rendezvous that waits.
30 PRINT "idle";SQ(1);SQ(2);SQ(4)
40 ENV 1,10,2,5
50 ENV 2,5,1,2,3,-1,10
60 ENV 3,5,15,1,5,0,0,5,1,1,3,3,3,5,5,1
70 ENV 4,=9,500
80 ENV 5,10,1,5,=10,300
90 ENV 15,127,15,255
100 ENT 1,10,2,5
110 ENT -2,5,1,2,3,-1,10
120 ENT 3,=200,20
130 ENT 4,239,-128,255
140 ENT 5,10,-3,4,=100,7,5,5,5
150 ENT -15,1,1,1
160 PRINT "defined";SQ(1)
170 REM the first note is held, so it stays at the head of channel A's queue
180 SOUND 65,200,50,10,1,1
190 PRINT "held 1";SQ(1)
200 SOUND 1,300,50,10,2,2
210 PRINT "held 2";SQ(1)
220 SOUND 1,400,50,10,3,3,5
230 SOUND 1,500,50,10,4,4
240 PRINT "full";SQ(1);SQ(2);SQ(4)
250 REM a flush clears the queue; the new note is held again
260 SOUND 193,100,100
270 PRINT "flushed";SQ(1)
280 c=4:SOUND c+64,150,20,,,,3
290 PRINT "channel C";SQ(4);SQ(1)
300 REM channel B (rendezvous with A) waits for A; both then start
310 SOUND 2+8,200,500,0
320 PRINT "rendezvous";SQ(2);SQ(1)
330 SOUND 1+16,100,500,0
340 REM flush all three channels and hold the new notes
350 SOUND 199,0,1,0
360 PRINT "all held";SQ(1);SQ(2);SQ(4)
370 REM a long held note with one behind it; RELEASE lets the first start, and SQ is read once it has
380 SOUND 193,0,500,0
390 SOUND 1,300,500,0
400 PRINT "behind";SQ(1)
410 RELEASE 1
420 WHILE SQ(1)<128:WEND
430 PRINT "playing";SQ(1);SQ(2)
440 x=2.5:SOUND x+128+64,100,100.5,0
450 PRINT "rounded";SQ(1);SQ(3-1)
460 FOR i=1 TO 3:READ n:SOUND 128+64+n,100+n,i,0,i,i:PRINT i;SQ(n):NEXT
470 DATA 1,2,4
480 END
