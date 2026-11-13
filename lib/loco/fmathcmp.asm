; -----------------------------------------------------------------------
; lib/loco/fmathcmp.asm -- REAL comparisons on Locomotive's layout
;
; Written from scratch for this project (MIT, see lib/LICENSE). Part of the pair with fmath.asm
; (read its header for the layout and the way a stacked operand is handled).
;
;   __LOCO_FEQ, __LOCO_FNE, __LOCO_FLT, __LOCO_FLE, __LOCO_FGT, __LOCO_FGE
;                   a on the stack (6 bytes, removed by the routine), b in the registers
;                   -> A = 1 when a op b, else 0. Clobbers the other registers (bare builds:
;                   and the calculator's stack). No firmware entry.
;
; Firmware builds compare the five bytes themselves (L5-HOT, follow-up 59): a value with exponent byte 0 is
; zero whatever its mantissa bytes hold (the firmware leaves junk in the mantissa of a zero it computes), then
; the sign, the exponent and the mantissa bytes from the top. That is exactly the order of the values, which is
; what the firmware's CMP returns, so no calculator (fp_calc.asm, 2 KB) is linked. Bare builds keep the
; calculator: it is their maths.

#ifdef CPC_BAREMETAL
#include once <loco/fmathcalc.asm>
#include once <ftou32reg.asm>

    push namespace core

__LOCO_FCMPOUT:             ; the truth value of the stub's comparison (0 or 1), back to the caller
    call __FPSTACK_POP
    call __FTOU8
    ld   hl, (__LOCO_FRET)
    jp   (hl)

__LOCO_FEQ:
    call __LOCO_FIN2
    ld   b, 0Eh             ; for the comparisons the operation is also in B
    rst  30h
    defb 0Eh
    defb 38h
    jp   __LOCO_FCMPOUT

__LOCO_FNE:
    call __LOCO_FIN2
    ld   b, 0Bh
    rst  30h
    defb 0Bh
    defb 38h
    jp   __LOCO_FCMPOUT

__LOCO_FLT:
    call __LOCO_FIN2
    ld   b, 0Ch             ; the operands are stack-reversed: b > a
    rst  30h
    defb 0Ch
    defb 38h
    jp   __LOCO_FCMPOUT

__LOCO_FLE:
    call __LOCO_FIN2
    ld   b, 0Ah
    rst  30h
    defb 0Ah
    defb 38h
    jp   __LOCO_FCMPOUT

__LOCO_FGT:
    call __LOCO_FIN2
    ld   b, 0Dh
    rst  30h
    defb 0Dh
    defb 38h
    jp   __LOCO_FCMPOUT

__LOCO_FGE:
    call __LOCO_FIN2
    ld   b, 09h
    rst  30h
    defb 09h
    defb 38h
    jp   __LOCO_FCMPOUT

    pop namespace
#else

    push namespace core

; ---- the three-way compare ------------------------------------------------------------
; a on the stack above the return address (6 bytes), b in the registers -> A = 1 (a > b), 0 (a = b) or
; 0FFh (a < b). The stack is as at entry; the stubs below map A to 0 or 1 and remove a (__LOCO_FCMPX).
; Clobbers F, BC, DE, HL. HL walks the bytes of a downwards: byte 4 (exponent) to byte 0.
__LOCO_FCMP:
    push af                 ; b's byte 0, taken back for the last comparison
    ld   hl, 11             ; the push, this routine's and the caller's return addresses, the slot's
    add  hl, sp             ; first byte (junk), then a's bytes 0..4: HL -> byte 4
    ld   a, (hl)
    or   a
    jr   z, __FC_AZ         ; a is zero
    ld   a, b
    or   a
    jr   z, __FC_BZ         ; b is zero, a is not: the sign of a
    dec  hl
    ld   a, (hl)            ; a's byte 3: the sign is bit 7
    xor  c
    jp   m, __FC_SIGN       ; different signs: the sign of a decides
    inc  hl                 ; the same sign: the magnitudes, top byte first; carry = b < a
    ld   a, b
    cp   (hl)
    jr   nz, __FC_M
    dec  hl
    ld   a, c               ; the sign bits are equal, so the whole byte compares
    cp   (hl)
    jr   nz, __FC_M
    dec  hl
    ld   a, d
    cp   (hl)
    jr   nz, __FC_M
    dec  hl
    ld   a, e
    cp   (hl)
    jr   nz, __FC_M
    dec  hl
    pop  af                 ; b's byte 0 again
    cp   (hl)
    jr   z, __FC_EQ
    sbc  a, a
    jr   __FC_M2
__FC_EQ:
    xor  a
    ret
__FC_M:                     ; carry: |a| > |b|
    sbc  a, a
    pop  hl
__FC_M2:                    ; A = 0FFh when |a| > |b|, else 0: both have the sign in C bit 7
    or   1                  ; 0FFh or 1
    bit  7, c
    ret  nz                 ; negative: the larger magnitude is the smaller value
    neg
    ret
__FC_BZ:                    ; b is zero, a is not: HL -> byte 4
    dec  hl
__FC_SIGN:                  ; HL -> a's byte 3: a < b when a is negative
    ld   a, (hl)
    add  a, a
    sbc  a, a               ; 0FFh when negative
    or   1
    pop  hl
    ret
__FC_AZ:                    ; a is zero: 0 when b is too, else the opposite of b's sign
    ld   a, b
    or   a
    jr   z, __FC_Z0
    ld   a, c
    add  a, a
    sbc  a, a               ; 0FFh when b is negative
    cpl
    or   1                  ; b negative: 1, positive: 0FFh
__FC_Z0:
    pop  hl
    ret

; The stubs: the truth value in A, then a leaves the stack (the return address goes through HL).
__LOCO_FCMPX:
    ld   a, 0
    rla                     ; the carry the stub made
    pop  hl                 ; the caller's return address
    pop  de                 ; a: 6 bytes
    pop  de
    pop  de
    jp   (hl)

__LOCO_FEQ:
    call __LOCO_FCMP
    cp   1                  ; carry when A = 0
    jr   __LOCO_FCMPX

__LOCO_FNE:
    call __LOCO_FCMP
    cp   1
    ccf
    jr   __LOCO_FCMPX

__LOCO_FLT:
    call __LOCO_FCMP
    add  a, a               ; carry when A = 0FFh
    jr   __LOCO_FCMPX

__LOCO_FGE:
    call __LOCO_FCMP
    add  a, a
    ccf
    jr   __LOCO_FCMPX

__LOCO_FGT:
    call __LOCO_FCMP
    neg                     ; 0FFh when A was 1
    add  a, a
    jr   __LOCO_FCMPX

__LOCO_FLE:
    call __LOCO_FCMP
    neg
    add  a, a
    ccf
    jr   __LOCO_FCMPX

    pop namespace
#endif
