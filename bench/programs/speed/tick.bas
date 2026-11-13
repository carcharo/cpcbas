' The shared clock of the speed benchmarks (L5-MEASURE): KL TIME PLEASE (&BD0D), the firmware's 300 Hz counter, through
' each compiler's firmware gate; the low 16 bits come back in HL (a wrap every 218 s: the programs subtract as UINTEGER).
' Both compilers build this same text; bench/speed.py copies it next to the program.
FUNCTION FASTCALL TICK() AS UINTEGER
    ASM
        call .core.__FW_CALL
        defw $BD0D
    END ASM
END FUNCTION
