; -----------------------------------------------------------------------
; lib/loco/vars.asm -- L4's slots in the private runtime block
;
; Written from scratch for this project (MIT, see lib/LICENSE).
;
; The names of L4's runtime state, offsets $220-$2FF of SYSVAR_BASE (the
; private block, zeroed at start-up, in the central 32K in both memory maps:
; the firmware reads the tick blocks there). lib/runtime/sysvars.asm is an
; imported file that tools/import-runtime.py --check keeps byte for byte, so
; L4's names live here (as FWM-CORE's live in loco/fwmath.asm). Contract:
; docs/ir.md "Private-block slots". Each wave-1 task adds the EQU lines of its
; own range under its own heading below, and nothing else; the three shared
; names are defined once, here. A file that uses a name includes this one:
; #include once <loco/vars.asm>.
;
; EQUs only: no code, no bytes. Clobbers: nothing.
; -----------------------------------------------------------------------

#include once <sysvars.asm>

    push namespace core

; --- shared by more than one task (R13: defined here so no task adds them)
LOCO_ERRTRAP        EQU SYSVAR_BASE + $220  ; DW -- ON ERROR trap entry for __ERROR, 0 = none (lib/loco/error.asm, L4)
LOCO_ERRPOS         EQU SYSVAR_BASE + $222  ; 6B -- error mark of the main statement in progress: data pointer, SP, IX (L4)
LOCO_DEV            EQU SYSVAR_BASE + $2B0  ; DB -- output device of the statement: 0 text screen, 8 printer, 9 file (L4)

; --- L4-ERR: $228-$23F (after LOCO_ERRTRAP and LOCO_ERRPOS)
LOCO_ERRHAND        EQU SYSVAR_BASE + $228  ; DW -- the ON ERROR GOTO target: where the trap jumps (lib/loco/error.asm)
LOCO_ERRNUM         EQU SYSVAR_BASE + $22A  ; DB -- ERR: the number of the error being handled; 0 before one and after RESUME
LOCO_ERRBUSY        EQU SYSVAR_BASE + $22B  ; DB -- non-zero in error processing (from the trap to RESUME)
LOCO_ERRAT          EQU SYSVAR_BASE + $22C  ; 6B -- the error's position: a copy of LOCO_ERRPOS taken at the trap (ERL, RESUME)

; --- L4-EVENTS: $240-$2AF (lib/loco/event.asm)
LOCO_EVSUM          EQU SYSVAR_BASE + $240  ; DB -- non-zero when an event is pending and DI is off (the poll's one-byte test)
LOCO_EVDI           EQU SYSVAR_BASE + $241  ; DB -- non-zero while DI is in force
LOCO_EVRUN          EQU SYSVAR_BASE + $242  ; DB -- priority of the handler now running: 0 none, else timer + 1
LOCO_EVPEND         EQU SYSVAR_BASE + $243  ; 4B -- pending kicks of timers 0-3 (at most 127 each)
LOCO_EVLAST         EQU SYSVAR_BASE + $247  ; DW -- bare builds: the frame count (low word) the timers were last advanced to
LOCO_EVHAND         EQU SYSVAR_BASE + $249  ; 8B -- the handler address of timers 0-3 (a main-program label)
LOCO_EVBARE         EQU SYSVAR_BASE + $251  ; 16B -- bare builds: per timer a count word and a recharge word (count 0 = stopped)
LOCO_EVTICK         EQU SYSVAR_BASE + $261  ; 52B -- firmware builds: the four 13-byte tick blocks (KL ADD TICKER)
LOCO_EVTMP          EQU SYSVAR_BASE + $295  ; 8B -- EVERY/AFTER/REMAIN scratch: n (2), mode (1), timer (1), handler (2)

; --- L4-TEXT: $2B1-$2BF (after LOCO_DEV)
LOCO_DEVVEC         EQU SYSVAR_BASE + $2B1  ; DW -- the device jump table of window.asm: set by __LOCO_STREAM for the devices 8 and 9, read by txt.asm and print.asm
LOCO_PRCOL          EQU SYSVAR_BASE + $2B3  ; DB -- POS(#8): the column of the next byte sent to the printer (1-based, at most 255); 0 until the first byte, which counts as 1
LOCO_PRWID          EQU SYSVAR_BASE + $2B4  ; DB -- WIDTH: the printer's line width; 0 is the default, 132

; --- L4-KEYS: $2C0-$2CF
LOCO_BRKON          EQU SYSVAR_BASE + $2C0  ; DB -- ON BREAK STOP is in force (1), CONT (0 = ESC ignored) (lib/loco/keys.asm)
LOCO_KEYTMP         EQU SYSVAR_BASE + $2C2  ; 12B -- KEY / KEY DEF scratch, used inside one runtime call only (lib/loco/keys.asm)
LOCO_KEYCNT         EQU SYSVAR_BASE + $2CE  ; DB -- KEY DEF: how many values were given (lib/loco/keys.asm)

; --- L4-GFX: $2D0-$2DF (bare builds only: firmware builds keep this state in the firmware)
LOCO_GCX            EQU SYSVAR_BASE + $2D0  ; DW -- graphics cursor x, absolute (virtual 640x400 units; bare: gfx.asm)
LOCO_GCY            EQU SYSVAR_BASE + $2D2  ; DW -- graphics cursor y, absolute
LOCO_GOX            EQU SYSVAR_BASE + $2D4  ; DW -- ORIGIN x
LOCO_GOY            EQU SYSVAR_BASE + $2D6  ; DW -- ORIGIN y
LOCO_GPEN           EQU SYSVAR_BASE + $2D8  ; DB -- graphics pen (GRAPHICS PEN, the pen argument of PLOT ...), 1 at start-up
LOCO_GPAP           EQU SYSVAR_BASE + $2D9  ; DB -- graphics paper (GRAPHICS PAPER, CLG n), 0 at start-up

; --- L4-SOUND: $2E0-$2E7 (ENV/ENT while a section list is read; lib/loco/sound.asm)
LOCO_SND_KIND       EQU SYSVAR_BASE + $2E0  ; DB -- 0 = ENV, 1 = ENT
LOCO_SND_MASK       EQU SYSVAR_BASE + $2E1  ; DB -- hardware sections still to come (bit 0 = the next section)
LOCO_SND_CNT        EQU SYSVAR_BASE + $2E2  ; DB -- values not yet read
LOCO_SND_NUM        EQU SYSVAR_BASE + $2E3  ; DB -- envelope number 1-15, bit 7 = repeat (ENT with a negative number)
LOCO_SND_SEC        EQU SYSVAR_BASE + $2E4  ; DB -- sections written so far
LOCO_SND_K          EQU SYSVAR_BASE + $2E5  ; DB -- the number of values after the envelope number

; --- L4-SMALL: $2E8-$2EF
LOCO_RANDSTATE      EQU SYSVAR_BASE + $2E8  ; DW -- RANDOM's generator state, 0 = not started (lib/loco/misc.asm)

; --- L4-FILES (wave 2): $2F0-$2FF (lib/loco/filecom.asm, file.asm, fileout.asm, window.asm)
LOCO_FFLAG          EQU SYSVAR_BASE + $2F0  ; DB -- bit 0: the input file is open, bit 1: the output file is open
LOCO_DERR           EQU SYSVAR_BASE + $2F1  ; DB -- DERR: the last AMSDOS error code (bit 7 set), 0 until one happens
LOCO_FDEVVEC        EQU SYSVAR_BASE + $2F2  ; DW -- the device table of stream #9 while an output file is open, else 0
LOCO_FCOL           EQU SYSVAR_BASE + $2F4  ; DB -- the output file's column: printable bytes since the last CR (POS(#9) is this + 1)
LOCO_FERR           EQU SYSVAR_BASE + $2F5  ; DB -- the firmware's error code of the call that failed (filecom.asm)
LOCO_FOK            EQU SYSVAR_BASE + $2F6  ; DB -- 0 when the firmware call failed, $FF when it worked (the Carry kept across a stack clean-up)
LOCO_FFREE          EQU SYSVAR_BASE + $2F7  ; DB -- __FL_NAMEPUSH: the string is a temporary to free
LOCO_FSTR           EQU SYSVAR_BASE + $2F8  ; DW -- __FL_NAMEPUSH: the string
LOCO_FRET           EQU SYSVAR_BASE + $2FA  ; DW -- __FL_NAMEPUSH: its return address
LOCO_FA1            EQU SYSVAR_BASE + $2FC  ; DW -- LOAD: the load address given
LOCO_FA2            EQU SYSVAR_BASE + $2FE  ; DB -- LOAD: 1 when an address was given, 0 for the file's own; DB spare

    pop namespace
