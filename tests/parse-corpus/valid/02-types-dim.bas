' Spec section 4: types and DIM forms.
' State and tables for a small tile game.
DIM lives AS UBYTE
DIM delta AS BYTE
DIM address AS UINTEGER
DIM x AS INTEGER, y AS INTEGER
DIM ticks AS ULONG
DIM offset AS LONG
DIM velocity AS FIXED
DIM ratio AS REAL
DIM angle AS FLOAT
DIM title AS STRING
DIM a, b AS UBYTE
DIM px, py, pz AS INTEGER
DIM s$, n%, r!
DIM buf(255) AS UBYTE
DIM m(3, 4) AS INTEGER
DIM cube(2, 2, 2, 2) AS UBYTE
DIM untyped(10)
DIM counter AS UBYTE = 3
DIM banner AS STRING = "READY"
DIM scale AS REAL = 1.5 * 2
DIM t(3) AS UBYTE => {1, 2, 3, 4}
DIM grid(1, 1) AS UBYTE => {{1, 2}, {3, 4}}
DIM words(2) AS STRING => {"ONE", "TWO", "THREE"}
DIM screen_ram(255) AS UBYTE AT &C000
DIM vector AS UINTEGER AT &BE00
DIM p AS UBYTE, q(5) AS INTEGER, z AS STRING
