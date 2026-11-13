10 REM HEX$, BIN$ and the MID$ statement
20 PRINT HEX$(0);"|";HEX$(255);"|";HEX$(-1);"|";HEX$(65535);"|";HEX$(-32768)
30 PRINT HEX$(255,0);"|";HEX$(255,4);"|";HEX$(255,16);"|";HEX$(0,3);"|";HEX$(2.5);"|";HEX$(3.5)
40 PRINT BIN$(0);"|";BIN$(5);"|";BIN$(5,8);"|";BIN$(-1);"|";BIN$(255,16);"|";BIN$(5,2)
50 n=-2:w=6:PRINT HEX$(n);"|";HEX$(n+1,w);"|";BIN$(w,w)
60 a$="HELLO":MID$(a$,2,2)="XYZ":PRINT a$
70 a$="HELLO":MID$(a$,2)="XYZ":PRINT a$
80 a$="HELLO":MID$(a$,4,5)="12":PRINT a$
90 a$="HELLO":MID$(a$,4)="123456":PRINT a$
100 a$="HELLO":MID$(a$,5)="xy":PRINT a$
110 a$="HELLO":MID$(a$,2,0)="x":PRINT a$
120 a$="HELLO":MID$(a$,2)="":PRINT a$
130 a$="HELLO":MID$(a$,1,1)="xyz":PRINT a$
140 a$="HELLO":b$=a$:MID$(a$,1,1)="J":PRINT a$;b$
150 a$="HELLO":MID$(a$,2,2)=STR$(7):PRINT a$
160 a$="HELLO":MID$(a$,2,2)=a$:PRINT a$
170 a$="HELLO":p=2:q=3:b$="yx":MID$(a$,p,q)=LEFT$(b$,3):PRINT a$
180 a$="HELLO":MID$(a$,p+q)=b$+b$:PRINT a$
190 a$=STRING$(20,"."):FOR i=1 TO 5:MID$(a$,i*4-3,3)=HEX$(i*i*100,3):NEXT:PRINT a$
