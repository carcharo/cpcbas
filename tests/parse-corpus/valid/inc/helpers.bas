' Spec section 10: an included file that includes another (used by 23-preproc-include.bas).
#include once "consts.bas"

SUB CentreText(row AS UBYTE, text AS STRING)
  LOCATE (ScreenW - LEN(text)) \ 2 + 1, row
  PRINT text;
END SUB
