' Spec section 2: lexical structure.
' Comments, numbers, strings, continuation, case and separators.
REM a REM comment runs to the end of the line
REM
x = 1 ' trailing comment
LET z = x + 1 : LET Name$ = "assigned with LET"
/' a block comment
   spanning two lines '/
y = 2 /' inline block comment '/ + 3
DIM Score AS INTEGER
score = 10 : SCORE = score + 1 : Score = SCORE
DIM big_value_2 AS LONG
n% = 5 : r! = 2.5 : s$ = "text"
a = 1.5 : b = .5 : c = 1E3 : d = 2.5E-2 : e = 1e+2
h1 = &FF : h2 = &HFF : h3 = 0xFF : h4 = &hff
b1 = &X1010 : b2 = 0b1010
l1 = 5% : l2 = 5!
q$ = "say ""hi"" twice"
e$ = ""
total = 1 + _
        2 + _   ' continued with a comment
        3
Print "ok" : If x = 1 Then Print "one" : Else Print "other"
