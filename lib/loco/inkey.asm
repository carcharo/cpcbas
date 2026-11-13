; -----------------------------------------------------------------------
; lib/loco/inkey.asm -- Locomotive text layer: INKEY$
;
; Written from scratch for this project (MIT, see lib/LICENSE).
;
; INKEY$ is the runtime's INKEY (io/keyboard/inkey.asm); this file gives it
; the lib/loco name and pulls it in. Firmware mode is built with
; -D CPC_INKEY_BUFFERED: the next
; character from the firmware key buffer (KM READ CHAR, &BB09), or the empty
; string when none; it never waits. Without that flag (and in bare mode)
; it is the key held down now.
;
;   __LOCO_INKEY    Exit: HL = a new heap string (length 1, or length 0 when no
;                   key), 0 when the heap is full. Clobbers AF, BC, DE, HL
;                   (+ the gate).

#include once <io/keyboard/inkey.asm>

    push namespace core

__LOCO_INKEY:
    jp   INKEY

    pop namespace
