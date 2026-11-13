' Spec section 9: screen and text statements and functions, at their minimum and maximum argument counts.
MODE 1
INK 0, 1
INK 0, 1, 24
BORDER 0
BORDER 0, 26
SPEED INK 10, 10
PEN 1
PEN #1, 2
PAPER 0
PAPER #2, 3
LOCATE 1, 1
LOCATE #1, 10, 5
CLS
CLS #1
ZONE 8
WINDOW 1, 40, 1, 25
WINDOW #1, 5, 20, 3, 10
WINDOW SWAP 0
WINDOW SWAP 0, 1
TAG
TAG #1
TAGOFF
TAGOFF #1
SYMBOL 255, 1
SYMBOL 240, 24, 60, 126, 255, 255, 126, 60, 24
SYMBOL AFTER 240
col = POS(#0)
row = VPOS(#1)
ch$ = COPYCHR$(#0)
PRINT col; row; ch$
