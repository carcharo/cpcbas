' Spec sections 2 and 3: a typed-in listing whose PRINT string is never closed.
' The string ends at the end of the line and the lexer warns (W102).
10 MODE 1
20 PRINT"HELLO WORLD
30 PRINT"WHAT IS YOUR NAME";:INPUT n$
40 PRINT"HELLO ";n$
50 END
