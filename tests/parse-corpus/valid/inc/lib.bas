' Spec section 10: a library file found through the include path (angle-bracket form).
FUNCTION Clamp8(v AS INTEGER) AS UBYTE
  IF v < 0 THEN RETURN 0
  IF v > 255 THEN RETURN 255
  RETURN v
END FUNCTION
