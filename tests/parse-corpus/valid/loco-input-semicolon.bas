' Spec section 9: a semicolon straight after INPUT or LINE INPUT keeps the cursor on the line
' after ENTER (Locomotive manual, INPUT entry).
10 INPUT ; "no newline"; w$
20 LINE INPUT ; "keep cursor: "; k$
30 INPUT ; a
