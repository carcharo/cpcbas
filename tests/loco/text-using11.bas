10 REM L4-TEXT: PRINT USING with the pound sign (BASIC 1.1: the 6128 only; the 464 prints it as text)
20 p$=CHR$(163)
30 PRINT USING p$+p$+"###";5;-5
40 PRINT USING "**"+p$+"###";5;-5
50 PRINT USING p$+p$+"##,###.##";1234.5
60 PRINT USING "+"+p$+p$+"###";5
90 PRINT USING p$+"#";5

200 PRINT USING "#.###^^^^";12345
210 PRINT USING "####.##";-0.001;0.5;99999
220 PRINT USING "+.##";0.5
230 PRINT USING "#.#";1E10;0.05;-0.04
300 PRINT USING "+.##";-0.5;0;0.05
310 PRINT USING "+.###";0.5
320 PRINT USING "$$.##";0.5;-0.5
330 PRINT USING ".##+";0.5;-0.5
340 PRINT USING ".##-";0.5;-0.5
350 PRINT USING "+.##^^^^";0.5
400 PRINT USING "A#^^^^B";5;7
410 PRINT USING "A^^^^#B";5;7
420 PRINT USING "A##^^^^B";5;70
430 PRINT USING "A#^^^^^B";5;7
440 PRINT USING "A#.#^^^^B";5;7
