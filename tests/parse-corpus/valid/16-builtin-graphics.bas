' Spec section 9: graphics statements and functions, at their minimum and maximum argument counts.
' Draws a frame and a cross, then reads a pixel back.
CLG
CLG 2
ORIGIN 0, 0
ORIGIN 320, 200, 0, 639, 399, 0
GRAPHICS PEN
GRAPHICS PEN 1
GRAPHICS PEN , 1
GRAPHICS PEN 1, 1
GRAPHICS PAPER 0
PLOT 10, 10
PLOT 10, 10, 2
PLOT 10, 10, 2, 1
PLOT 10, 10, , 1
PLOTR 5, 5
PLOTR 5, 5, 2, 0
MOVE 0, 0
MOVE 0, 0, 1, 0
MOVER 3, 4
MOVER 3, 4, , 1
DRAW 639, 0
DRAW 639, 399, 3
DRAW 0, 399, , 1
DRAW 0, 0, 1, 1
DRAWR 10, 0
DRAWR 0, 10, 2, 0
MASK
MASK 15
MASK , 1
MASK 15, 1
FILL 2
c = TEST(100, 100) + TESTR(1, 1)
PRINT XPOS; YPOS; c
