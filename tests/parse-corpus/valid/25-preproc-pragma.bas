' Spec section 10: #pragma forms, #require, #init, and the directives that only matter in dead code.
#pragma org = &4000
#pragma heap_size = 2048
#pragma heap_address = &9000
#pragma case_insensitive = true
#pragma explicit = true
#pragma push(explicit)
#pragma explicit = false
#pragma pop(explicit)
#pragma explicit
#pragma hidata = &A000
#pragma hidata = 0
#require "extra.asm"
#init Startup

#if 0
#error "never reported: the branch is not taken"
#warning "never reported either"
#line 10 "elsewhere.bas"
#line 20
#endif

PRINT "pragmas done"
ASM
Startup:
  ret
END ASM
