; -----------------------------------------------------------------------
; lib/loco/fmath.asm -- REAL arithmetic on Locomotive's layout (the bare wrappers)
;
; Written from scratch for this project (MIT, see lib/LICENSE).
;
; A REAL in a register set is the five bytes of Locomotive's layout in memory order
; (docs/ir.md, the `f` row): A = byte 0 (the least significant mantissa byte), E = byte 1,
; D = byte 2, C = byte 3 (the top mantissa byte, bit 7 = the sign), B = the exponent
; (biased by 128; 0 means the value is zero). So `ld a,(x) / ld de,(x+1) / ld bc,(x+3)` loads
; one, and `push bc / push de / push af` leaves the five bytes in memory order at sp+1..sp+5
; of a 6-byte slot. A REAL in a register set or in memory is always in the full form: it is
; never the calculator's small-integer form (exponent byte 0 with the value in the mantissa
; bytes), which Locomotive would read as zero.
;
; The arithmetic has two bodies behind the same entries (FWM-CORE):
;   - firmware builds: + - * / go to the firmware's maths through the gate (fwmath.asm). The
;     result is the firmware's, bit for bit what Locomotive BASIC computes. Overflow is error 6.
;   - bare builds (-D CPC_BAREMETAL): the imported floating-point calculator, which keeps the
;     ZX Spectrum's format in the reverse byte order (fmathcalc.asm is the bridge). The results
;     agree with the firmware to 8 significant digits.
; Firmware builds link no calculator at all (L5-HOT).
; Every other routine of lib/loco calls the `__LOCO_F*` entries (and realfn.asm's function wrappers)
; and never the imported REAL routines.
;
; Entry points (namespace core). All registers are in the layout above. This file has + - * /
; and negate; the order conversion is in fmathcalc.asm, the comparisons in fmathcmp.asm and the
; integer and FIXED conversions in fmathcv.asm, so that a program links only what it uses.
;
;   __LOCO_FADD, __LOCO_FSUB, __LOCO_FMUL, __LOCO_FDIV    a on the stack (6 bytes, the pushed
;                   REAL, removed by the routine), b in the registers -> a op b in the registers.
;                   FDIV does not check for a zero divisor (the template raises error 11).
;   __LOCO_FEQ, __LOCO_FNE, __LOCO_FLT, __LOCO_FLE, __LOCO_FGT, __LOCO_FGE    the same operands
;                   -> A = 1 when a op b, else 0
;   __LOCO_FNEG     -b (the sign bit flips, also for zero). Clobbers L.
;   __LOCO_FU8, __LOCO_FI8    the integer in A -> REAL (clobbers HL)
;   __LOCO_FU32, __LOCO_FI32  the integer in DEHL -> REAL (clobbers HL)
;   __LOCO_FF16     the FIXED in DEHL -> REAL (clobbers HL)
;   __LOCO_FTOU32   REAL -> DEHL, floored for a negative value that has a fraction (the imported
;                   __FTOU32REG; __LOCO_FTOI in realfn.asm truncates)
;   __LOCO_FTOF16REG  REAL -> DEHL as a 16.16 FIXED
;
; Bare binary operations take the calculator's usual two steps: the stub pushes b, then a, on the
; calculator stack (__LOCO_FIN2: it also parks the code generator's return address in
; __LOCO_FRET, because the stacked a sits under it), runs the operation and returns the result
; through __LOCO_FOUT2 / __LOCO_FCMPOUT. They are not re-entrant (the maths never runs from an
; interrupt). Firmware: the gate of fwmath.asm.

#ifdef CPC_BAREMETAL
#include once <loco/fmathcalc.asm>

    push namespace core

__LOCO_FADD:
    call __LOCO_FIN2
    rst  30h
    defb 0Fh                ; add
    defb 38h
    jp   __LOCO_FOUT2

__LOCO_FSUB:
    call __LOCO_FIN2
    rst  30h
    defb 01h                ; exchange: a - b
    defb 03h                ; subtract
    defb 38h
    jp   __LOCO_FOUT2

__LOCO_FMUL:
    call __LOCO_FIN2
    rst  30h
    defb 04h                ; multiply
    defb 38h
    jp   __LOCO_FOUT2

__LOCO_FDIV:
    call __LOCO_FIN2
    rst  30h
    defb 01h                ; exchange: a / b
    defb 05h                ; divide
    defb 38h
    jp   __LOCO_FOUT2

    pop namespace
#else
#include once <loco/fwmath.asm>
#endif

    push namespace core

; ---- negate -----------------------------------------------------------------------
__LOCO_FNEG:                ; flips the sign bit and nothing else, like the firmware's NEG (NEG(0) is
    ld   l, a               ; 00 00 00 80 00, which everything reads as zero: exponent byte 0)
    ld   a, c
    xor  0x80
    ld   c, a
    ld   a, l
    ret

    pop namespace
