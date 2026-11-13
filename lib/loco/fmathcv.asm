; -----------------------------------------------------------------------
; lib/loco/fmathcv.asm -- REAL <-> integer and FIXED conversions on Locomotive's layout
;
; Written from scratch for this project (MIT, see lib/LICENSE). Part of the pair with fmath.asm
; (read its header for the layout). The imported conversions work in the calculator's order;
; these entries translate.
;
;   __LOCO_FU8, __LOCO_FI8    the integer in A -> REAL (clobbers HL)
;   __LOCO_FU32, __LOCO_FI32  the integer in DEHL -> REAL (clobbers HL)
;   __LOCO_FF16     the FIXED in DEHL -> REAL (clobbers HL)
;   __LOCO_FTOU32   REAL -> DEHL, floored for a negative value that has a fraction (the imported
;                   __FTOU32REG; __LOCO_FTOI in realfn.asm truncates)
;   __LOCO_FTOF16REG  REAL -> DEHL as a 16.16 FIXED
;   Clobbers the other registers. No firmware entry.

#include once <loco/fmathrev.asm>   ; not fmathcalc.asm: a conversion needs no calculator (R12, follow-up 64)
#include once <u32tofreg.asm>
#include once <f16tofreg.asm>
#include once <ftou32reg.asm>
#include once <ftof16reg.asm>

    push namespace core

; The imported integer conversions give the full form (or zero) in the Spectrum's order.
__LOCO_FU8:
    call __U8TOFREG
    jp   __LOCO_FREV

__LOCO_FI8:
    call __I8TOFREG
    jp   __LOCO_FREV

__LOCO_FU32:
    call __U32TOFREG
    jp   __LOCO_FREV

__LOCO_FI32:
    call __I32TOFREG
    jp   __LOCO_FREV

__LOCO_FF16:
    call __F16TOFREG
    jp   __LOCO_FREV

__LOCO_FTOU32:
    call __LOCO_FREV
    call __LOCO_FNZ         ; a zero with a junk mantissa (the firmware's) is the exact zero
    jp   __FTOU32REG

__LOCO_FTOF16REG:
    call __LOCO_FREV
    call __LOCO_FNZ
    jp   __FTOF16REG

    pop namespace
