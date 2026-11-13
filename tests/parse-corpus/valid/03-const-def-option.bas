' Spec section 4: CONST, DEFINT, DEFREAL, DEFSTR and OPTION REAL.
OPTION REAL
DEFINT i-n
DEFREAL a-h, x
DEFSTR s, t-v
DEFINT q
CONST ScreenWidth = 80
CONST MaxLives AS UBYTE = 5
CONST ScreenBase = &C000
CONST HalfWidth = ScreenWidth / 2
CONST BitMask AS UBYTE = &H0F OR &H30
CONST Greeting AS STRING = "HELLO"
CONST Tau AS REAL = 6.28318
i = 3 : n = i * 2
a = 1.5
s = "text"
