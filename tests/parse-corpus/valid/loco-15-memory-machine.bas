' Spec section 9: Locomotive manual, memory and machine access: MEMORY, HIMEM,
' FRE, PEEK, POKE, INP, OUT, WAIT, CALL with and without parameters, the @
' operator, and RSX bar commands. Own program.
10 MEMORY &7FFF
20 top = HIMEM
30 PRINT FRE(0); FRE(""); top
40 POKE &8000, 255
50 POKE top - 1, PEEK(&8000) AND &F
60 x = PEEK(&C000) + PEEK(&C001) * 256
70 OUT &7F00, &4B
80 OUT &BC00, 1 : OUT &BD00, 40
90 v = INP(&F500) AND 1
100 WAIT &F500, 1
110 WAIT &F500, 1, 1
120 CALL &BD19
130 CALL &BC02, 0
140 CALL &8000, a, b%, c!
150 CALL 0
160 a$ = "name"
170 CALL &9000, @a$, @x
180 |TAPE
190 |DISC
200 |A
210 |DIR, "*.BAS"
220 |DIR, @a$
230 |USER, 1
240 PRINT x; v; a
