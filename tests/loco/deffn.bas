10 DEF FNdouble%(x%)=x%*2
20 DEF FNadd%(a%,b%)=a%+b%
30 DEF FNhi$(n$)="Hi "+n$
40 DEF FNrep$(s$,n%)=STRING$(n%,s$)
50 DEF FNbig%(a%,b%)=-(a%>b%)*a%-(a%<=b%)*b%
60 PRINT FNdouble%(21);FNdouble%(-4);FNdouble%(FNdouble%(5))
70 PRINT FNadd%(3,4);FNadd%(-3,FNadd%(1,1))
80 PRINT FNhi$("there")
90 PRINT FNrep$("ab",3);"|";LEN(FNrep$("z",5))
100 PRINT FNbig%(3,9);FNbig%(9,3);FNbig%(-2,-5)
110 x%=50
120 PRINT FNdouble%(x%+1);x%
130 PRINT FNhi$("a"+"b")+"!"
