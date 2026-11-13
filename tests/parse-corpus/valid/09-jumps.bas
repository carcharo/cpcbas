' Spec section 6: GOTO, GOSUB, RETURN and ON ... GOTO/GOSUB.
' Jumping to line numbers and to labels.
Start:
  GOSUB 1000
  GOSUB ShowTitle
  INPUT "Level"; level
  ON level GOTO 100, 200, Hard
  ON level GOSUB 1000, ShowTitle, 1000
  GO TO Finish
100 PRINT "easy" : GOTO Finish
200 PRINT "normal" : GOTO Finish
Hard:
  PRINT "hard"
  GO SUB 1000
  GOTO Finish
Finish:
  RESTORE
  RESTORE 3000
  RESTORE Scores
  PRINT "bye"
  END

ShowTitle:
  PRINT "TITLE"
  RETURN
1000 PRINT "subroutine"
1010 RETURN
3000 DATA 1, 2, 3
Scores: DATA 10, 20, 30
