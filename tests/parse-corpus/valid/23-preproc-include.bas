' Spec section 10: #include in its three forms and include once.
' The test runner passes valid/inc as the include path for the angle-bracket form.
#include "inc/banner.bas"
#include once "inc/helpers.bas"
#include once <lib.bas>
#include once "inc/helpers.bas"

MODE 1
CentreText(ScreenH \ 2, "INCLUDED")
PRINT Clamp8(300)
