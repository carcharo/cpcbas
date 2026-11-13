; -----------------------------------------------------------------------
; lib/loco/filecom.asm -- files: what the input and the output side share (L4-FILES)
;
; Written from scratch for this project (MIT, see lib/LICENSE).
;
; Firmware builds only: a bare build has no AMSDOS, and the checker refuses the file
; statements there (E270). Contract: docs/ir.md "Streams" (device 9) and the header of
; file.asm / fileout.asm. State: lib/loco/vars.asm ($2F0-$2FF).
;
;   __LOCO_DERR     -> HL = DERR, the last AMSDOS error code (bit 7 set; 0 before the first).
;                   Clobbers AF, HL. No firmware entry.
;   __FL_NAMEPUSH   HL = a string (0 is the empty one), A = non-zero when it is a temporary
;                   to free. Called from the entry that owns the name: the stack then holds,
;                   under the return address of that call, a 34-byte block: the name in
;                   capitals (at most 32 characters), the length at +32 (a name longer than
;                   32 is given the length 33, which AMSDOS refuses) and a spare byte.
;                   The block is on the stack because AMSDOS wants the name in the central
;                   32 KB of RAM and the program's own strings may be in the low 16 KB.
;                   Clobbers AF, BC, DE, HL. The caller removes the block with
;                   `ld hl, 34 / add hl, sp / ld sp, hl`.
;   __FL_ABANDON    LOAD, SAVE, CAT and CHAIN abandon an open file of either stream (CAS IN ABANDON, CAS OUT ABANDON; the
;                   file is not written) and go on, as Locomotive does (follow-up 142; loco-measured.md "R15").
;                   Clears the stream flags and the device vector of #9. Clobbers AF, BC, DE, HL, BC', DE', HL', AF'.
;   __FL_FAIL       a firmware file call failed with the code in (LOCO_FERR): remembers it as
;                   DERR when its bit 7 is set (an AMSDOS error) and raises error 32 (the
;                   interpreter's "disc error"; AMSDOS has printed its own message). Never
;                   returns.
;
;   __FL_INIT       makes sure AMSDOS is patched into the cassette jump block: a program started by
;                   RUN" has the disc routines shut down (the loader's MC START PROGRAM re-initialises
;                   the firmware), so the first file statement starts the disc ROM again with
;                   KL INIT BACK, giving it the workspace under HIMEM that the boot gave it
;                   (&A67C-&B0FF, where the runtime's memory map expects it). Without a disc ROM
;                   (a 464 with no DDI-1) the cassette routines stay, as in Locomotive BASIC. Clobbers
;                   AF, BC, DE, HL.
;
; Firmware entries called (through the gate with IX kept): KL INIT BACK (&BCCE), in __FL_INIT.
; -----------------------------------------------------------------------

#include once <error.asm>
#include once <fwcall.asm>
#include once <mem/free.asm>
#include once <loco/vars.asm>

    push namespace core

#ifndef CPC_BAREMETAL

__LOCO_DERR:
    ld   a, (LOCO_DERR)
    ld   l, a
    ld   h, 0
    ret

__FL_NAMEPUSH:
    ld   (LOCO_FFREE), a
    ld   (LOCO_FSTR), hl
    pop  de
    ld   (LOCO_FRET), de
    ld   hl, -34
    add  hl, sp
    ld   sp, hl
    ex   de, hl             ; DE = the block
    ld   c, 0               ; C = the length
    ld   hl, (LOCO_FSTR)
    ld   a, h
    or   l
    jr   z, __NP_GO
    ld   c, (hl)
    inc  hl
    ld   a, (hl)
    inc  hl
    or   a
    jr   z, __NP_LEN
    ld   c, 255
__NP_LEN:
    ld   a, c
    cp   33
    jr   c, __NP_GO
    ld   c, 33
__NP_GO:
    ld   a, c
    or   a
    jr   z, __NP_DONE
    cp   33
    jr   c, __NP_CNT
    ld   a, 32
__NP_CNT:
    ld   b, a
__NP_COPY:
    ld   a, (hl)
    cp   'a'
    jr   c, __NP_STORE
    cp   'z' + 1
    jr   nc, __NP_STORE
    sub  32                 ; capitals
__NP_STORE:
    ld   (de), a
    inc  hl
    inc  de
    djnz __NP_COPY
__NP_DONE:
    ld   hl, 32
    add  hl, sp
    ld   (hl), c
    ld   a, (LOCO_FFREE)
    or   a
    jr   z, __NP_RET
    ld   hl, (LOCO_FSTR)
    ld   a, h
    or   l
    call nz, __MEM_FREE
__NP_RET:
    ld   hl, (LOCO_FRET)
    jp   (hl)

__FL_ABANDON:
    ld   a, (LOCO_FFLAG)
    and  1
    jr   z, __FA_OUT
    call .core.__FW_CALL_IX
    defw $BC7D              ; CAS IN ABANDON
    ld   hl, LOCO_FFLAG
    ld   a, (hl)
    and  $FA
    ld   (hl), a
__FA_OUT:
    ld   a, (LOCO_FFLAG)
    and  2
    ret  z
    call .core.__FW_CALL_IX
    defw $BC92              ; CAS OUT ABANDON
    ld   hl, LOCO_FFLAG
    res  1, (hl)
    ld   hl, 0
    ld   (LOCO_FDEVVEC), hl
    ret

__FL_INIT:
    ld   a, ($BC77)         ; CAS IN OPEN's jump block entry: RST 3 (a far call) with AMSDOS in, RST 1 for the tape
    cp   $DF
    ret  z
    ld   c, 7               ; AMSDOS is ROM 7
    ld   de, $0100
    ld   hl, $B0FF
    call .core.__FW_CALL_IX
    defw $BCCE              ; KL INIT BACK
    ret

__FL_FAIL:
    ld   a, (LOCO_FERR)
    bit  7, a
    jr   z, __FF_RAISE
    ld   (LOCO_DERR), a
__FF_RAISE:
    ld   a, 32
    jp   __ERROR

#endif

    pop namespace
