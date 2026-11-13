; -----------------------------------------------------------------------
; lib/loco/fmathcalc.asm -- the bridge to the imported floating-point calculator
;
; Written from scratch for this project (MIT, see lib/LICENSE). Split out of fmath.asm by FWM-CORE.
; Read fmath.asm's header for the REAL layout. The imported calculator (fp_calc.asm) keeps the
; ZX Spectrum's format, the same five bytes in the reverse order: A = exponent, E = top mantissa
; byte (bit 7 = sign), D, C, B = the least significant byte; and it may hand back the
; small-integer form. This file is the one place where the two meet. It is a bare-build file: firmware
; builds link no calculator (L5-HOT, follow-up 59; the comparisons are in fmathcmp.asm and INT and FIX in
; realfn.asm, on the five bytes, the arithmetic and the functions go to the firmware: fwmath.asm).
; In bare builds the calculator does everything (fmath.asm, realfn.asm).
;
;   __LOCO_FREV     (in fmathrev.asm, included here) reverse the byte order of the five registers
;                   (Locomotive <-> calculator). Clobbers L only.
;   __LOCO_FOUT     a calculator result in the Spectrum order (small-integer form allowed) ->
;                   the full form in Locomotive's order. Clobbers HL and the calculator stack
;                   (only for a small integer).
;   __LOCO_FPUSH    push the REAL on the calculator's stack. A value whose exponent byte is 0 is
;                   pushed as the exact zero (the firmware leaves junk in the mantissa bytes of a
;                   zero it computes; the calculator would read that as a small integer).
;                   Clobbers A, E, C, B, HL.
;   __LOCO_FPOP     pop the calculator's stack into the registers (full form). Clobbers HL.
;   __LOCO_FNZ      (in fmathrev.asm) calculator order: exponent byte 0 in A: E, D, C, B := 0.
;   __LOCO_FIN2     (private to the binary operations) b in the registers and a under the stub's and
;                   the caller's return addresses go on the calculator stack, the caller's return
;                   address is parked in __LOCO_FRET; __LOCO_FOUT2 returns the result there.
;
; They are not re-entrant (the maths never runs from an interrupt). No firmware entry.

#include once <fp_calc.asm>
#include once <stackf.asm>
#include once <loco/fmathrev.asm>

    push namespace core

__LOCO_FRET: DEFW 0         ; the return address of the binary operation in progress

; ---- order conversion ------------------------------------------------------------
__LOCO_FOUT:                ; calculator result -> Locomotive's order, full form
    or   a
    jp   nz, __LOCO_FREV
    ld   a, e               ; exponent byte 0: zero, or the small integer (E = sign byte,
    or   d                  ; D C = the 16-bit value)
    or   c
    ret  z                  ; zero: five zero bytes in either order
    xor  a                  ; A = the exponent byte again
    call __FPSTACK_PUSH
    rst  30h
    defb 3Dh                ; re-stack: the small integer becomes a full float
    defb 38h
    call __FPSTACK_POP
    jp   __LOCO_FREV

__LOCO_FPUSH:
    call __LOCO_FREV
    call __LOCO_FNZ
    jp   __FPSTACK_PUSH

__LOCO_FPOP:
    call __FPSTACK_POP
    jp   __LOCO_FOUT

; ---- binary operations ------------------------------------------------------------
; Called by a stub with b in the registers and a under the stub's and the caller's return
; addresses: b, then a, go on the calculator stack, the caller's return address is parked.
__LOCO_FIN2:
    call __LOCO_FREV
    call __LOCO_FNZ
    call __FPSTACK_PUSH     ; b
    pop  hl                 ; the stub's return address
    ex   (sp), hl           ; HL = the caller's, the stub's takes its place
    ld   (__LOCO_FRET), hl
    pop  hl                 ; the stub's again: the six bytes of a are on top
    pop  af
    pop  de
    pop  bc
    push hl
    call __LOCO_FREV
    call __LOCO_FNZ
    jp   __FPSTACK_PUSH     ; a, then back into the stub

__LOCO_FOUT2:               ; the result of the stub's operation, back to the caller
    call __LOCO_FPOP
    ld   hl, (__LOCO_FRET)
    jp   (hl)

    pop namespace
