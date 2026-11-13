' Spec section 9: Locomotive manual, PRINT USING: numeric templates (digits,
' decimal point, thousands comma, sign, floating and trailing signs, fill stars,
' pound sign, exponent) and string templates. Own program.
10 n = 4567.896 : m = -12.5 : s$ = "ocean"
20 PRINT USING "####"; n
30 PRINT USING "###.##"; n
40 PRINT USING "#,###.#"; n
50 PRINT USING "+###.#"; n
60 PRINT USING "###.#-"; m
70 PRINT USING "**###.#"; n
80 PRINT USING "$$####.##"; n
90 PRINT USING "\    \"; s$
100 PRINT USING "!"; s$
110 PRINT USING "&"; s$
120 PRINT USING "###.##^^^^"; n
130 PRINT USING "###.##"; n; m
140 PRINT 123.456, USING "###.##"; n
150 PRINT USING "[##]"; 7; : PRINT USING "[##]"; 8
160 PRINT #1, USING "##.#"; 3.14159
170 PRINT USING "Total: ###"; 12; : PRINT
180 f$ = "###.##" : PRINT USING f$; n
190 PRINT USING "\ \ ##"; s$; 5
