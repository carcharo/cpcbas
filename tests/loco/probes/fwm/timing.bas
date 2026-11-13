10 MEMORY &7FFF
20 DEFINT i,b
30 FOR i=0 TO 30:READ b:POKE &8000+i,b:NEXT
40 FOR i=0 TO 4:READ b:POKE &8120+i,b:NEXT:FOR i=0 TO 4:READ b:POKE &8108+i,b:NEXT
50 READ n$,e:IF n$="end" THEN END
60 POKE &8016,e AND 255:POKE &8017,((e AND &FF00)\256) AND 255
70 t!=TIME:CALL &8000:t!=TIME-t!
80 IF n$="none" THEN z!=t!
90 PRINT n$;" ";t!;" ";ROUND((t!-z!)/300,3);"ms"
100 GOTO 50
500 DATA 1,&E8,3,&C5,&21,&20,&81,&11,0,&81,1,5,0,&ED,&B0,&21,0,&81,&11,8,&81,&CD,0,0,&C1,&B,&78,&B1,&20,&E5,&C9
510 DATA 0,0,0,&40,&81
520 DATA 0,0,0,&10,&82
530 DATA none,&801E,none,&801E,add,&BD7C,revsub,&BD82,mult,&BD85,div,&BD88,cmp,&BD8E,sqr,&BD9D,pow,&BDA0,log,&BDA3,exp,&BDA9,sin,&BDAC,cos,&BDAF,atn,&BDB5,fix,&BD70,toint,&BD6A,prep,&BD76,end,0
