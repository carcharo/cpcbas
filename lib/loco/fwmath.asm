; -----------------------------------------------------------------------
; lib/loco/fwmath.asm -- REAL arithmetic through the CPC firmware's maths (firmware builds only)
;
; Written from scratch for this project (MIT, see lib/LICENSE). FWM-CORE. Addresses and register
; conventions are the measured ones; no ROM code is read or copied.
; Bare-metal builds (-D CPC_BAREMETAL) have no firmware: this file is empty there and the same
; entry points are the calculator's (fmath.asm).
;
; The firmware's maths pack works on 5-byte REALs in Locomotive's layout, by pointer, and reads
; them with the lower ROM enabled, so an operand must never be passed from where the program
; lives (below &4000). Two 5-byte slots in the private runtime block hold the operands:
;   FWM_A (CPC_PRIV_BASE + &F3)  the first operand and the result (HL on entry)
;   FWM_B (CPC_PRIV_BASE + &F8)  the second operand (DE on entry)
;   FWM_TBL (+ &FD)              the address of the entry table of the machine (0: not detected yet)
; (&F3-&FF are free in the firmware layout; lib/README.md lists them.) The slots and the gate are not
; re-entrant: the interrupt handler never calls the maths.
;
; Three entry tables, 464 / 664 / 6128 and Plus, chosen at the first call by KL PROBE ROM (&B915,
; C = 0: H = 0, 1, 2 or 4). Each is a record of 21 words in the order of the FWMO_ constants below:
; the entries, then the address of the RND seed (four bytes of the firmware's own RAM).
;
; Entry points (namespace core):
;
;   __FWM_CALL      A = FWMO_ entry offset. The operands are in FWM_A / FWM_B. Saves IX and IY (the
;                   entries corrupt them), makes the call through the gate (fwcall.asm's contract:
;                   IN_FW, BC', interrupts on). Exit: carry set = the result is valid, clear = the
;                   firmware's error (overflow, SQR of a negative, LOG(0), ...); the result, if
;                   any, is at FWM_A. Every other register is destroyed (the firmware's BC DE AF
;                   are junk, HL is unreliable on the 464 after an error); the stack needs 64 free
;                   bytes. Detects the machine on the first call.
;   __FWM_TBLHL     HL = the entry table of the machine (detects on the first call). Destroys all.
;   __FWM_ANGLE     A = 0 RAD, other DEG: the firmware's angle mode (ANGLE). Destroys all.
;   __FWM_PUTA      FWM_A = A E D C B.        __FWM_PUTB   FWM_B = A E D C B.
;   __FWM_GETA      A E D C B = FWM_A (exit through RET; the caller's registers are lost).
;   __FWM_ERR       A = Locomotive's error number, jumps to the error printer.
;   __LOCO_FADD, __LOCO_FSUB, __LOCO_FMUL, __LOCO_FDIV: the entries of fmath.asm. Overflow is error 6, a zero
;                   divisor error 11; both are Locomotive's non-fatal errors (__LOCO_SOFTERR, L4-ERR): with a
;                   handler they are raised, without one the name is printed and the firmware's result (+-max) stands.
;                   __LOCO_FSUB uses the firmware's reverse subtraction ((HL) = (DE) - (HL)), the 6128
;                   having no plain one, so a goes to FWM_B and b to FWM_A.
;
; Clobbers AF, BC, DE, HL (and IX, IY are preserved).

#ifndef CPC_BAREMETAL

#include once <fwcall.asm>
#include once <sysvars.asm>
#include once <error.asm>
#include once <loco/error.asm>      ; __LOCO_SOFTERR (L4-ERR)

    push namespace core

FWM_A       EQU SYSVAR_BASE + 0xF3  ; 5B -- first operand and result
FWM_B       EQU SYSVAR_BASE + 0xF8  ; 5B -- second operand
FWM_TBL     EQU SYSVAR_BASE + 0xFD  ; DW -- the entry table of this machine (0 = not yet detected)

FWMO_ADD    EQU 0
FWMO_RSUB   EQU 2
FWMO_MUL    EQU 4
FWMO_DIV    EQU 6
FWMO_POW    EQU 8
FWMO_SQR    EQU 10
FWMO_EXP    EQU 12
FWMO_LOG    EQU 14
FWMO_LOG10  EQU 16
FWMO_SIN    EQU 18
FWMO_COS    EQU 20
FWMO_TAN    EQU 22
FWMO_ATN    EQU 24
FWMO_RND    EQU 26
FWMO_RND0   EQU 28
FWMO_ANGLE  EQU 30
FWMO_PREP   EQU 32
FWMO_MUL10A EQU 34
FWMO_REAL2BIN EQU 36
FWMO_BIN2REAL EQU 38
FWMO_SEED   EQU 40                  ; the address of the RND seed, not an entry

__FWM_T464:
    DEFW 0xBD58, 0xBD5E, 0xBD61, 0xBD64, 0xBD7C, 0xBD79, 0xBD85, 0xBD7F, 0xBD82
    DEFW 0xBD88, 0xBD8B, 0xBD8E, 0xBD91, 0xBD9D, 0xBDA0, 0xBD73, 0xBD52, 0xBD55
    DEFW 0xBD49, 0xBD43, 0xB8E4
__FWM_T664:
    DEFW 0xBD79, 0xBD7F, 0xBD82, 0xBD85, 0xBD9D, 0xBD9A, 0xBDA6, 0xBDA0, 0xBDA3
    DEFW 0xBDA9, 0xBDAC, 0xBDAF, 0xBDB2, 0xBD7C, 0xBD88, 0xBD94, 0xBD73, 0xBD76
    DEFW 0xBD6A, 0xBD64, 0xB100
__FWM_T6128:
    DEFW 0xBD7C, 0xBD82, 0xBD85, 0xBD88, 0xBDA0, 0xBD9D, 0xBDA9, 0xBDA3, 0xBDA6
    DEFW 0xBDAC, 0xBDAF, 0xBDB2, 0xBDB5, 0xBD7F, 0xBD8B, 0xBD97, 0xBD76, 0xBD79
    DEFW 0xBD6D, 0xBD67, 0xB100

; ---- the gate -------------------------------------------------------------------
; fwcall.asm's protocol with the entry address in __FWM_T (patched by the caller) and the
; operand pointers HL = FWM_A, DE = FWM_B. A is passed on to the entry.
__FWM_GATE:
    di                      ; IN_FW and BC' must change together (isr.asm)
    exx
    ld   hl, IN_FW
    ld   (hl), 1
    ld   bc, (FW_BC)
    ex   af, af'
    or   a                  ; AF' carry clear, or the ISR takes its nested path
    ex   af, af'
    exx
    ld   hl, FWM_A
    ld   de, FWM_B
    ei
__FWM_T:
    call 0xFFFF             ; operand patched by the caller
    di
    exx
    ld   (FW_BC), bc
    ld   hl, IN_FW
    ld   (hl), 0
    exx
    ei
    ret

; HL = the table of this machine
__FWM_TBLHL:
    ld   hl, (FWM_TBL)
    ld   a, h
    or   a
    ret  nz
    ld   c, 0
    call __FW_CALL
    defw 0xB915             ; KL PROBE ROM: H = 0 (464), 1 (664), 2 (6128), 4 (Plus)
    ld   a, h
    ld   hl, __FWM_T464
    or   a
    jr   z, __FWM_TBLSET
    ld   hl, __FWM_T664
    dec  a
    jr   z, __FWM_TBLSET
    ld   hl, __FWM_T6128
__FWM_TBLSET:
    ld   (FWM_TBL), hl
    push hl                 ; the firmware may be in DEG mode left over from BASIC: start in RAD
    xor  a
    call __FWM_ANGLE1
    pop  hl
    ret

__FWM_ANGLE:                ; A = 0 RAD, other DEG
    push ix
    push iy
    push af
    call __FWM_TBLHL
    pop  af
    call __FWM_ANGLE1
    pop  iy
    pop  ix
    ret
__FWM_ANGLE1:               ; HL = the table, A = the mode
    ld   de, FWMO_ANGLE
    add  hl, de
    ld   e, (hl)
    inc  hl
    ld   d, (hl)
    ld   (__FWM_T + 1), de
    jp   __FWM_GATE

__FWM_CALL:
    ld   c, a
    xor  a
__FWM_CALLA:                ; C = the entry offset, A = the value the entry takes in A (MUL10A: the power of ten)
    push ix
    push iy
    push bc
    push af
    call __FWM_TBLHL
    pop  af
    pop  bc
    ld   e, c
    ld   d, 0
    add  hl, de
    ld   e, (hl)
    inc  hl
    ld   d, (hl)
    ld   (__FWM_T + 1), de
    call __FWM_GATE
    pop  iy
    pop  ix
    ret                     ; (pop and ret leave the flags the firmware set)

; ---- operands and results ----------------------------------------------------------
__FWM_PUTA:
    ld   (FWM_A), a
    ld   (FWM_A + 1), de
    ld   (FWM_A + 3), bc
    ret

__FWM_PUTB:
    ld   (FWM_B), a
    ld   (FWM_B + 1), de
    ld   (FWM_B + 3), bc
    ret

__FWM_GETA:
    ld   a, (FWM_A)
    ld   de, (FWM_A + 1)
    ld   bc, (FWM_A + 3)
    ret

__FWM_ERR:
    jp   __ERROR

; ---- + - * / ----------------------------------------------------------------------------
; b in A E D C B, a on the stack (six bytes pushed as push bc / push de / push af) under the
; return address; the result in A E D C B. Overflow (carry clear) is error 6.
__LOCO_FADD:
    call __FWM_PUTB
    pop  hl
    pop  af
    pop  de
    pop  bc
    push hl
    call __FWM_PUTA
    ld   a, FWMO_ADD
    jr   __FWM_BIN

__LOCO_FSUB:                ; (HL) = (DE) - (HL): b is the HL operand, a the DE operand
    call __FWM_PUTA
    pop  hl
    pop  af
    pop  de
    pop  bc
    push hl
    call __FWM_PUTB
    ld   a, FWMO_RSUB
    jr   __FWM_BIN

__LOCO_FMUL:
    call __FWM_PUTB
    pop  hl
    pop  af
    pop  de
    pop  bc
    push hl
    call __FWM_PUTA
    ld   a, FWMO_MUL
    jr   __FWM_BIN

__LOCO_FDIV:                ; a zero divisor is Division by zero (11), not Overflow, and the firmware gives +-max
    call __FWM_PUTB
    pop  hl
    pop  af
    pop  de
    pop  bc
    push hl
    call __FWM_PUTA
    ld   a, FWMO_DIV
    call __FWM_CALL
    jp   c, __FWM_GETA
    ld   a, (FWM_B + 4)     ; the divisor's exponent byte: 0 is zero
    or   a
    ld   a, 11
    jr   z, __FWM_SOFT
    ld   a, 6
    jr   __FWM_SOFT
__FWM_BIN:
__FWM_BIN6:                 ; A = the entry offset: carry set = the result at FWM_A, clear = Overflow (6)
    call __FWM_CALL
    jp   c, __FWM_GETA
    ld   a, 6
__FWM_SOFT:                 ; A = 6 or 11: raised with a handler, else printed, and the firmware's result stands
    call __LOCO_SOFTERR
    jp   __FWM_GETA

__FWM_FN5:                  ; as __FWM_BIN6, the error is Improper argument (5)
    call __FWM_CALL
    jp   c, __FWM_GETA
    ld   a, 5
    jp   __ERROR

    pop namespace
#endif
