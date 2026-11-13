' Known language difference: READ of a numeric DATA item into a string variable.
' CPC BASIC accepts it (the item's text); the fork reads an empty string.
DIM s AS STRING
READ s
PRINT "[" + s + "]"
READ s
PRINT "[" + s + "]"
END
DATA -30, 400
