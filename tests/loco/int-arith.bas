10 REM integer arithmetic: results stay inside -32768..32767
20 a=7:b=3:c=-4
30 a%=7:b%=3:c%=-4
40 PRINT a%+b%;a%-b%;a%*b%;a%\b%;a% MOD b%
50 PRINT c%+b%;c%-b%;c%*b%;c%\b%;c% MOD b%
60 PRINT a%+c%;a%-c%;a%*c%;a%\c%;a% MOD c%
70 PRINT c%\b%;(-c%)\b%;-c%\b%;-17 MOD 5;17 MOD -5;-17 MOD -5;-17\5
80 PRINT 2+3*4;(2+3)*4;2*3+4;20-3-2;20-(3-2)
90 PRINT 100\7\2;100\(7\2);100 MOD 7 MOD 3
100 PRINT -a%;- -a%;-(a%+b%);3*-2;3- -2
110 PRINT 2+3 MOD 2*5;10-6\4*2;-2*-2
120 PRINT 32767;-32768;32000+767;-32000-768
130 PRINT 181*181;-181*181;100*327;1000\3
140 PRINT 1+2+3+4+5;10*10*10*10;9-8-7-6
150 x%=100:y%=-25
160 PRINT x%*y%;x%\y%;x% MOD y%;y%\7;y% MOD 7
170 PRINT x%+y%*2-x%\8
