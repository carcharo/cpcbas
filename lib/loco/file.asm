; -----------------------------------------------------------------------
; lib/loco/file.asm -- files, the input side: OPENIN, CLOSEIN, EOF, the items of INPUT #9
; and LINE INPUT #9, LOAD, CAT and CHAIN (L4-FILES)
;
; Written from scratch for this project (MIT, see lib/LICENSE).
;
; Firmware builds only (AMSDOS through the CAS entries; a bare build refuses these
; statements with E270). The input stream owns a 2 KB AMSDOS buffer, the top of the
; program's memory below the private block (codegen/memory-map.ts, lib/README.md): the
; link step lowers the heap below it. State: lib/loco/vars.asm ($2F0-$2FF). LOAD, CAT and
; CHAIN use the same stream, so they abandon an open file of either stream and go on
; (__FL_ABANDON in filecom.asm).
;
; Entry points (namespace core). Every one that calls the firmware goes through the gate
; with IX kept (the CAS entries corrupt IX) and clobbers BC', DE', HL', AF'.
;
;   __LOCO_OPENIN   HL = the name (a string, 0 empty), A = non-zero when it is a temporary.
;                   Error 27 when an input file is open already; error 32 (DERR set) when
;                   AMSDOS cannot open it (it has printed its message). Clobbers all but IX.
;   __LOCO_CLOSEIN  closes the input file; nothing happens when none is open.
;   __LOCO_EOF      -> HL = -1 at the end of the file or with no input file open, else 0.
;   __LOCO_FINITEM  A = 0: a string item, 1: a number item. Reads the next item of an INPUT #9
;                   and returns its text as a new heap string in HL (0 when empty); the lowering
;                   converts a number item with VAL. The rules, measured on the interpreter
;: blanks before the item are
;                   skipped; a string item that starts with `"` ends at the next `"` (CR is part
;                   of it) and then at the `,` or CR after it (anything else belongs to the next
;                   item); any other item ends at `,` or CR, trailing blanks kept; LF is never
;                   part of an item; an LF straight after a CR goes with it. End of file ends an
;                   item; at the start of one it is error 24 (EOF met). Error 31 with no
;                   input file, 15 for a string item of more than 255 characters, 13 for a
;                   number item that is a lone sign.
;   __LOCO_FLINE    -> HL = the rest of the line as a new heap string (0 when empty), for
;                   LINE INPUT #9. Same terminators and errors.
;   __LOCO_LOAD     HL = the name, A = free flag; stack: the address (pushed). Loads the file
;                   there with CAS IN DIRECT (a file with an AMSDOS header or a plain one).
;   __LOCO_LOADH    The same, to the address in the file's header.
;   __LOCO_CAT      the disc catalogue, printed by AMSDOS.
;   __LOCO_CHAIN    HL = the name, A = free flag. Checks that the file opens, then hands the
;                   machine to MC BOOT PROGRAM (&BD13) with a loader copied above the private
;                   block: the new program is loaded over the old one and started as by RUN".
;                   Never returns. Our own interrupt vector is put back first.
;
; Firmware entries called: CAS IN OPEN (&BC77), CAS IN CLOSE (&BC7A), CAS IN ABANDON (&BC7D),
; CAS IN CHAR (&BC80), CAS IN DIRECT (&BC83), CAS RETURN (&BC86), CAS TEST EOF (&BC89),
; CAS CATALOG (&BC9B), MC BOOT PROGRAM (&BD13).
; -----------------------------------------------------------------------

#include once <error.asm>
#include once <fwcall.asm>
#include once <sysvars.asm>
#include once <mem/alloc.asm>
#include once <mem/free.asm>
#include once <isr.asm>
#include once <loco/vars.asm>
#include once <loco/filecom.asm>

    push namespace core

#ifndef CPC_BAREMETAL

__LOCO_FINBUF   EQU SYSVAR_BASE - $800     ; the input stream's 2 KB buffer (memory-map.ts)
__FL_STUB_AT    EQU SYSVAR_BASE + $400     ; CHAIN's loader: just above the private block, the bottom of the stack area

; ---- OPENIN, CLOSEIN, EOF ----------------------------------------------------
__LOCO_OPENIN:
    call __FL_NAMEPUSH
    call __FL_INIT
    ld   a, (LOCO_FFLAG)
    and  1
    jr   nz, __OI_BUSY
    ld   hl, 32
    add  hl, sp
    ld   b, (hl)
    ld   hl, 0
    add  hl, sp
    ld   de, __LOCO_FINBUF
    call .core.__FW_CALL_IX
    defw $BC77              ; CAS IN OPEN: Carry = opened
    ld   (LOCO_FERR), a
    sbc  a, a
    ld   (LOCO_FOK), a
    ld   hl, 34
    add  hl, sp
    ld   sp, hl
    ld   a, (LOCO_FOK)
    or   a
    jp   z, __FL_FAIL
    ld   hl, LOCO_FFLAG
    ld   a, (hl)
    and  $FA                ; open, the end not seen
    or   1
    ld   (hl), a
    ret
__OI_BUSY:
    ld   hl, 34
    add  hl, sp
    ld   sp, hl
    ld   a, 27
    jp   __ERROR

__LOCO_CLOSEIN:
    ld   a, (LOCO_FFLAG)
    and  1
    ret  z
    call .core.__FW_CALL_IX
    defw $BC7A              ; CAS IN CLOSE
    ld   hl, LOCO_FFLAG
    ld   a, (hl)
    and  $FA
    ld   (hl), a
    ret

__LOCO_EOF:
    ld   a, (LOCO_FFLAG)
    and  1
    jr   z, __EOF_YES
    bit  2, a
    jr   nz, __EOF_YES      ; the end has been seen: AMSDOS answers a second test differently
    call .core.__FW_CALL_IX
    defw $BC89              ; CAS TEST EOF: Carry = not at the end
    jr   c, __EOF_NO
    ld   hl, LOCO_FFLAG
    set  2, (hl)
__EOF_YES:
    ld   hl, -1
    ret
__EOF_NO:
    ld   hl, 0
    ret

; ---- characters ----------------------------------------------------------------
; __FL_GETC: -> Carry set, A = the next character, an LF skipped; Carry clear at the end of the
; file. A hard error (Zero set with Carry clear: ESC, a disc error) is error 32.
__FL_GETC:
    ld   a, (LOCO_FFLAG)
    bit  2, a
    jr   nz, __GC_END
    call .core.__FW_CALL_IX
    defw $BC80              ; CAS IN CHAR
    jr   nc, __GC_FAIL
    cp   10
    jr   z, __FL_GETC
    scf
    ret
__GC_FAIL:
    jr   z, __GC_HARD
    ld   hl, LOCO_FFLAG
    set  2, (hl)
__GC_END:
    or   a                  ; Carry clear: the end of the file
    ret
__GC_HARD:
    ld   (LOCO_FERR), a
    jp   __FL_FAIL

; __FL_AFTERCR: after a CR, an LF that follows it is read as well; any other character is put back.
__FL_AFTERCR:
    ld   a, (LOCO_FFLAG)
    bit  2, a
    ret  nz
    call .core.__FW_CALL_IX
    defw $BC80
    jr   nc, __AC_END
    cp   10
    ret  z
    call __FL_UNGET
    ret
__AC_END:
    ld   hl, LOCO_FFLAG
    set  2, (hl)
    ret
__FL_UNGET:
    call .core.__FW_CALL_IX
    defw $BC86              ; CAS RETURN
    ret

; ---- INPUT #9 and LINE INPUT #9 ------------------------------------------------
; The frame (IX): -2 the 258-byte buffer, -3 type (0 string, 1 number, 2 LINE INPUT), -4 count
__FI_FRAME:                 ; A = type: builds the frame (the caller's return address is moved)
    pop  de
    push ix
    ld   ix, 0
    add  ix, sp
    ld   hl, -6
    add  hl, sp
    ld   sp, hl
    push de
    ld   (ix-3), a
    xor  a
    ld   (ix-4), a
    ld   bc, 258
    call __MEM_ALLOC
    ld   a, h
    or   l
    jr   nz, __FIF_OK
    ld   a, 7
    jp   __ERROR
__FIF_OK:
    ld   (ix-2), l
    ld   (ix-1), h
    ret

__LOCO_FINITEM:
    ld   b, a
    ld   a, (LOCO_FFLAG)
    and  1
    jp   nz, __FI_GO
    ld   a, 31
    jp   __ERROR
__FI_GO:
    ld   a, b
    call __FI_FRAME
    ; blanks, then the first character
__FI_SKIP:
    call __FL_GETC
    jp   nc, __FI_EOF1
    cp   ' '
    jp   z, __FI_SKIP
    ld   b, a
    ld   a, (ix-3)
    or   a
    jp   nz, __FI_PLAINB    ; a number item: no quotes
    ld   a, b
    cp   '"'
    jp   nz, __FI_PLAIN
__FI_QUOTED:
    call __FL_GETC
    jp   nc, __FI_END
    cp   '"'
    jp   z, __FI_QEND
    call __FI_PUT
    jp   __FI_QUOTED
__FI_QEND:
    call __FL_GETC
    jp   nc, __FI_END
    cp   ' '
    jp   z, __FI_QEND
    cp   ','
    jp   z, __FI_END
    cp   13
    jp   z, __FI_CR
    call __FL_UNGET
    jp   __FI_END
__FI_PLAINB:
    ld   a, b
__FI_PLAIN:                 ; A = the first character of the item, not a blank
    cp   ','
    jp   z, __FI_END
    cp   13
    jp   z, __FI_CR
    call __FI_PUT
    call __FL_GETC
    jp   c, __FI_PLAIN
    jp   __FI_END
__FI_CR:
    call __FL_AFTERCR
__FI_END:
    ld   a, (ix-3)
    cp   1
    jp   nz, __FI_BUILD
    ld   a, (ix-4)          ; a number item that is a lone sign is a Type mismatch
    cp   1
    jp   nz, __FI_BUILD
    ld   l, (ix-2)
    ld   h, (ix-1)
    ld   a, (hl)
    cp   '+'
    jp   z, __FI_BADNUM
    cp   '-'
    jp   nz, __FI_BUILD
__FI_BADNUM:
    call __FI_FREEBUF
    ld   a, 13
    jp   __ERROR
__FI_BUILD:
    ld   c, (ix-4)
    ld   b, 0
    ld   l, (ix-2)
    ld   h, (ix-1)
    call __FI_MKSTR
    push hl
    call __FI_FREEBUF
    pop  hl
    ld   sp, ix
    pop  ix
    ret

__FI_EOF1:                  ; EOF before the first character: EOF met
    call __FI_FREEBUF
    ld   a, 24
    jp   __ERROR

__FI_FREEBUF:
    ld   l, (ix-2)
    ld   h, (ix-1)
    jp   __MEM_FREE

__FI_PUT:                   ; append A to the buffer; a string past 255 characters is error 15
    ld   c, a
    ld   a, (ix-4)
    cp   255
    jr   nz, __FIP_OK
    ld   a, (ix-3)
    cp   1
    ret  z                  ; a number item drops the rest
    call __FI_FREEBUF
    ld   a, 15
    jp   __ERROR
__FIP_OK:
    ld   e, a
    ld   d, 0
    ld   l, (ix-2)
    ld   h, (ix-1)
    add  hl, de
    ld   (hl), c
    inc  (ix-4)
    ret

__FI_MKSTR:                 ; HL = text, BC = length -> HL = a new string (0 for none)
    ld   a, b
    or   c
    jr   nz, __FM_1
    ld   h, a
    ld   l, a
    ret
__FM_1:
    push hl
    push bc
    inc  bc
    inc  bc
    call __MEM_ALLOC
    pop  bc
    pop  de
    ld   a, h
    or   l
    jr   nz, __FM_2
    ld   a, 7
    jp   __ERROR
__FM_2:
    push hl
    ld   (hl), c
    inc  hl
    ld   (hl), b
    inc  hl
    ex   de, hl
    ldir
    pop  hl
    ret

__LOCO_FLINE:
    ld   a, (LOCO_FFLAG)
    and  1
    jp   nz, __FL_GO
    ld   a, 31
    jp   __ERROR
__FL_GO:
    ld   a, 2
    call __FI_FRAME
    call __FL_GETC
    jp   nc, __FI_EOF1
__FL_LOOP:
    cp   13
    jp   z, __FI_CR
    call __FI_PUT
    call __FL_GETC
    jp   c, __FL_LOOP
    jp   __FI_END

; ---- LOAD, CAT, CHAIN ------------------------------------------------------------
__LOCO_LOADH:
    call __FL_NAMEPUSH
    xor  a
    ld   (LOCO_FA2), a
    call __LD_BODY
    ld   hl, 34
    add  hl, sp
    ld   sp, hl
    ret

__LOCO_LOAD:
    call __FL_NAMEPUSH
    ld   hl, 36
    add  hl, sp
    ld   e, (hl)
    inc  hl
    ld   d, (hl)
    ld   (LOCO_FA1), de
    ld   a, 1
    ld   (LOCO_FA2), a
    call __LD_BODY
    ld   hl, 34
    add  hl, sp
    ld   sp, hl
    pop  hl                 ; the return address
    pop  de                 ; the address argument
    jp   (hl)

; __LD_BODY: the name block is at SP + 2. Never returns on a failure.
__LD_BODY:
    call __FL_ABANDON
    call __FL_INIT
    ld   hl, 34
    add  hl, sp
    ld   b, (hl)
    ld   hl, 2
    add  hl, sp
    ld   de, __LOCO_FINBUF
    call .core.__FW_CALL_IX
    defw $BC77              ; CAS IN OPEN: HL = the header, DE = its load address
    jr   c, __LD_OPENED
    ld   (LOCO_FERR), a
    jp   __FL_FAIL
__LD_OPENED:
    ld   a, (LOCO_FA2)
    or   a
    jr   z, __LD_DEST
    ld   de, (LOCO_FA1)
__LD_DEST:
    ex   de, hl             ; HL = where it goes
    call .core.__FW_CALL_IX
    defw $BC83              ; CAS IN DIRECT
    jr   c, __LD_READ
    ld   (LOCO_FERR), a
    call .core.__FW_CALL_IX
    defw $BC7D              ; CAS IN ABANDON
    jp   __FL_FAIL
__LD_READ:
    call .core.__FW_CALL_IX
    defw $BC7A              ; CAS IN CLOSE
    ret

__LOCO_CAT:
    call __FL_ABANDON
    call __FL_INIT
    ld   de, __LOCO_FINBUF
    call .core.__FW_CALL_IX
    defw $BC9B              ; CAS CATALOG: AMSDOS prints its own message when it cannot read the disc
    ret

; CHAIN: the loader below is copied to __FL_STUB_AT with the name block after it, and
; MC BOOT PROGRAM calls it once the firmware has been shut down. It is position independent
; but for the addresses it is given: it runs where it is copied to.
__FL_STUB:
    ld   a, ($BC77)         ; MC BOOT PROGRAM shut AMSDOS down: start it again where the runtime expects it
    cp   $DF
    jr   z, __FS_DISC
    ld   c, 7
    ld   de, $0100
    ld   hl, $B0FF
    call $BCCE              ; KL INIT BACK
    ld   a, ($BC77)
    cp   $DF
    jr   nz, __FS_FAIL
__FS_DISC:
    ld   hl, __FL_STUB_AT + (__FL_STUBN - __FL_STUB)
    ld   de, __FL_STUB_AT + (__FL_STUBN - __FL_STUB) + 32
    ld   a, (de)
    ld   b, a
    ld   de, __LOCO_FINBUF
    call $BC77              ; CAS IN OPEN
    jr   nc, __FS_FAIL
    ex   de, hl             ; HL = the file's load address
    call $BC83              ; CAS IN DIRECT: HL = the entry address
    jr   nc, __FS_FAIL2
    push hl
    call $BC7A              ; CAS IN CLOSE
    pop  hl
    scf
    ret
__FS_FAIL2:
    call $BC7D              ; CAS IN ABANDON
__FS_FAIL:
    or   a
    ret
__FL_STUBN:                 ; the name block is copied here, past the code

__LOCO_CHAIN:
    call __FL_NAMEPUSH
    call __FL_ABANDON
    call __FL_INIT
    ld   hl, 32
    add  hl, sp
    ld   b, (hl)
    ld   hl, 0
    add  hl, sp
    ld   de, __LOCO_FINBUF
    call .core.__FW_CALL_IX
    defw $BC77              ; CAS IN OPEN: does the file exist?
    jr   c, __CH_FOUND
    ld   (LOCO_FERR), a
    jp   __FL_FAIL
__CH_FOUND:
    call .core.__FW_CALL_IX
    defw $BC7D              ; CAS IN ABANDON
    di
    ld   hl, (__CPC_ISR_ORIG + 1)
    ld   ($0039), hl        ; the firmware's own interrupt handler again: this program is about to be overwritten
    ld   hl, 0
    add  hl, sp
    ld   de, __FL_STUB_AT + (__FL_STUBN - __FL_STUB)
    ld   bc, 34
    ldir
    ld   hl, __FL_STUB
    ld   de, __FL_STUB_AT
    ld   bc, __FL_STUBN - __FL_STUB
    ldir
    ld   hl, __FL_STUB_AT
    call .core.__FW_CALL
    defw $BD13              ; MC BOOT PROGRAM: never returns
    jr   $

#endif

    pop namespace
