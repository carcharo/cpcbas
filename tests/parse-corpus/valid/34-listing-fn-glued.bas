' Spec section 7: DEF FN written the Locomotive way, with the name glued to FN.
10 DEF FNdouble(x)=x*2
20 DEF FNarea(w,h)=w*h
30 DEF FNname$(a$)=UPPER$(a$)+"!"
40 PRINT FNdouble(21);FNarea(3,4)
50 PRINT FNname$("zap")
60 IF FNdouble(2)=4 THEN PRINT "ok"
70 y=FN double(5)+FNarea(1,FNdouble(1))
80 END
