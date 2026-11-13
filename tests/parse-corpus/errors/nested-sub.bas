' Spec section 3: SUBs cannot be nested.
SUB Outer()
  SUB Inner()
    PRINT 1
  END SUB
END SUB
