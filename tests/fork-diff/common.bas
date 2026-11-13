' Spellings that differ between CPC BASIC (cpcbas) and the Boriel fork. __CPCBAS__ is predefined by cpcbas only.
' Numbers are printed as PRINT "[";x;"]" and the harness strips the spaces cpcbas puts inside the brackets.
' The fork has no ASC, MID$, LEFT$ or RIGHT$ (it has CODE and 0-based inclusive slices s(a TO b)); the first
' argument of MidS, LeftS and RightS must be a string variable in the fork.
#ifdef __CPCBAS__
#define CharCode(s) ASC(s)
#define MidS(s, i, n) MID$(s, i, n)
#define LeftS(s, n) LEFT$(s, n)
#define RightS(s, n) RIGHT$(s, n)
#else
#define CharCode(s) CODE (s)
#define MidS(s, i, n) s((i) - 1 TO (i) + (n) - 2)
#define LeftS(s, n) s(0 TO (n) - 1)
#define RightS(s, n) s(LEN(s) - (n) TO LEN(s) - 1)
#endif
