' Spec section 9: Locomotive manual, input: INKEY$, INKEY with modifier
' results, JOY, INPUT with prompts and separators, LINE INPUT, KEY, KEY DEF,
' SPEED KEY and CLEAR INPUT. Own program.
10 KEY 140, "RUN" + CHR$(13)
20 KEY 129, "hello"
30 KEY DEF 46, 1, 63
40 KEY DEF 47, 1, 64, 65, 66
50 SPEED KEY 20, 3
60 CLEAR INPUT
70 INPUT a
80 INPUT a, b$
90 INPUT "Name"; n$
100 INPUT "Age", age
110 INPUT "Pair: "; p, q
130 LINE INPUT l$
140 LINE INPUT "Line"; m$
160 INPUT #0, e
170 LINE INPUT #0, g$
180 k$ = INKEY$
190 IF k$ = "" THEN 180
200 IF INKEY(47) = 0 THEN PRINT "space"
210 IF INKEY(21) = 32 OR INKEY(21) = 128 THEN PRINT "modified"
220 j = JOY(0) : j1 = JOY(1)
230 IF JOY(0) AND 1 THEN PRINT "up"
240 IF (j AND 8) = 8 THEN PRINT "right"
250 IF j AND 16 THEN PRINT "fire"
260 a$ = UPPER$(INKEY$)
270 PRINT a$; j1
