10 REM L4-TEXT: PRINT USING, every format of the manual
20 REM numeric fields: # . , + - ** $$ ^^^^ (the pound sign of ££ is BASIC 1.1: text-using11)
30 PRINT USING "###.##";3.14159
40 PRINT USING "###.##";-3.14159
50 PRINT USING "Total: ###.## units";12.5
60 PRINT USING "###";1;22;333;4444
70 PRINT USING "### ";1;22;333
80 PRINT USING "[#]";5;6
90 PRINT USING "##,###.##";12345.678
100 PRINT USING "#,###,###";1234567
110 PRINT USING "+###";5;-5
120 PRINT USING "###-";5;-5
130 PRINT USING "###+";5;-5
140 PRINT USING "**###";5;-5
150 PRINT USING "$$###";5;-5
160 PRINT USING "**$###";5;-5
200 PRINT USING "##.##^^^^";1234.5;0.00123;-5
230 PRINT USING "###";0.5;1.5;2.5;-0.5
240 PRINT USING "##.#";9.96
260 PRINT USING ".##";0.5;5
280 PRINT USING "####";123456
290 PRINT USING "##";-5
300 PRINT USING "# #";5;6;7
310 PRINT USING "#.#.#";5;7
320 PRINT USING "#.#,#";5;7
330 PRINT USING "#^^";5
340 PRINT USING "-##";5
350 PRINT USING "#_#";5
360 PRINT USING "_#.##";5
370 PRINT USING "#.##_!";5
380 PRINT USING "# and #";5
390 PRINT USING "###";1,2,3
400 a%=7:b!=2.5:PRINT USING "## ###.#";a%;b!
410 REM what is text and what joins a field: A + candidate + #B, then A# + candidate + B (5 and 7)
420 FOR r=1 TO 2:RESTORE 460:FOR i=1 TO 13
430 READ f$
440 IF r=1 THEN PRINT USING "A"+f$+"#B";5;7 ELSE PRINT USING "A#"+f$+"B";5;7
450 NEXT:NEXT
460 DATA "+","-",".","*","$",",",",,","**","***","$$$","$#","+.","#+-"
470 REM string fields: ! & backslash
480 PRINT USING "!";"hello"
490 PRINT USING "&";"hello"
500 PRINT USING "!&";"abc","def"
510 PRINT USING "\  \";"hello"
520 PRINT USING "\ \";"hello","x"
530 PRINT USING "\\";"ab";"X"
540 PRINT USING "\    \";"ab"
550 PRINT USING "\ \";"abcdef"
560 PRINT USING "!";""
570 PRINT USING "[&]";""
580 PRINT USING "## \ \";a%;"hi"
590 s$="str":PRINT USING "x\  \y";s$;"abcdefghi"
600 REM statement forms: the line end, a trailing separator, items before USING
610 PRINT USING "###";1;
620 PRINT "x"
630 PRINT USING "###";2,
640 PRINT "y"
650 PRINT "a";USING "#";5
660 PRINT "n=";5;USING "##";6;7
670 PRINT USING "#";5;:PRINT USING "#";6
