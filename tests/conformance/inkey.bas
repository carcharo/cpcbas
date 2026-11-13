REM Conformance: INKEY$ and INKEY(n) with typed keys, and the firmware key translation behind
REM INKEY$. The runner types the keys below while the program runs, each after a delay and followed
REM by RETURN. The emulators hold a typed key for only 2-3 frames, so the program polls in a tight
REM loop. SHIFT is held for the capital letters and the shifted symbols (!, =).
REM TYPE: q
REM TYPE: Q
REM TYPE: 1
REM TYPE: !
REM TYPE: -
REM TYPE: =
REM TYPE: x
REM TYPE: HI
REM
REM Ported from cpcbuild. Changed with the language: the original's "INKEY$ is the key held now"
REM (a design choice of the fork) is Locomotive's INKEY(n) (the state of key n: -1 not pressed, 0
REM pressed, 32 with SHIFT, 128 with CONTROL, 160 both) plus INKEY$ (here the key held now in bare builds, the
REM next key of the buffer in firmware builds: polling it until it returns a character sees every
REM key either way). INPUT(10) is LINE INPUT, and "INPUT must not see the buffered x and RETURN"
REM is dropped: Locomotive keeps the keys in the buffer, so the program reads them with INKEY$
REM before LINE INPUT. The translation seam (__CPC_KEYCHAR) is still the runtime's and is checked as
REM before (the tables in full are in keytables.bas).

#require "io/keyboard/kscan.asm"
#include "lib/chkbuf.bas"

REM The keyboard translation seam of the runtime (__CPC_KEYCHAR): v = key (the firmware key number)
REM + 256 * mods (1 SHIFT, 2 CONTROL). Returns the character, or 999 for "no key".
FUNCTION FASTCALL Xl(v AS UINTEGER) AS UINTEGER
  ASM
  PROC
  LOCAL none, done
  ld b, l
  ld e, h
  call .core.__CPC_KEYCHAR
  jr nc, none
  ld l, a
  ld h, 0
  jr done
none:
  ld hl, 999
done:
  ENDP
  END ASM
END FUNCTION

REM Polls INKEY$ until a key is held (up to ~15 s), then until it is released; returns every distinct
REM character seen on the way (a press landing between the scan's row reads can show the key before
REM SHIFT, e.g. "qQ").
FUNCTION GetHeld() AS STRING
  DIM n AS UINTEGER
  DIM k$, last$, seen$ AS STRING
  n = 0
  seen$ = ""
  last$ = ""
  DO
    k$ = INKEY$
    IF k$ <> "" THEN
      IF k$ <> last$ THEN seen$ = seen$ + k$
    ELSE
      IF LEN(seen$) > 0 THEN EXIT DO
      n = n + 1
    END IF
    last$ = k$
  LOOP UNTIL n > 30000
  RETURN seen$
END FUNCTION

FUNCTION Has(s$ AS STRING, c$ AS STRING) AS UBYTE
  DIM i AS UINTEGER
  IF LEN(s$) = 0 THEN RETURN 0
  FOR i = 1 TO LEN(s$)
    IF MID$(s$, i, 1) = c$ THEN RETURN 1
  NEXT i
  RETURN 0
END FUNCTION

DIM a$, r$, t$ AS STRING
DIM i, held AS UINTEGER

REM --- no key held: empty string, and no key pressed ---
CHK("idle_empty", N$(LEN(INKEY$)), "0")
CHK("idle_empty2", N$(LEN(INKEY$ + INKEY$)), "0")
held = 0
FOR i = 0 TO 79
  IF INKEY(i) <> -1 THEN held = held + 1
NEXT i
CHK("idle_inkey_n", N$(held), "0")

REM --- the translation: tables, modifiers (no key needs to be held; the locks are in
REM inkey_locks.bas, as KM SET LOCKS is not on the 464) ---
CHK("tr_a", N$(Xl(69)), "97")
CHK("tr_shift_a", N$(Xl(69 + 256 * 1)), "65")
CHK("tr_ctrl_a", N$(Xl(69 + 256 * 2)), "1")
CHK("tr_ctrl_beats_shift", N$(Xl(69 + 256 * 3)), "1")
CHK("tr_1", N$(Xl(64)), "49")
CHK("tr_shift_1", N$(Xl(64 + 256 * 1)), "33")
CHK("tr_ctrl_1", N$(Xl(64 + 256 * 2)), "999")
CHK("tr_return", N$(Xl(18)), "13")
CHK("tr_space", N$(Xl(47)), "32")
CHK("tr_del", N$(Xl(79)), "127")
CHK("tr_esc", N$(Xl(66)), "252")
CHK("tr_copy", N$(Xl(9)), "224")
CHK("tr_cursors", N$(Xl(0)) + " " + N$(Xl(2)) + " " + N$(Xl(8)) + " " + N$(Xl(1)), "240 241 242 243")
CHK("tr_ctrl_cursor", N$(Xl(0 + 256 * 2)), "248")
CHK("tr_shift_cursor", N$(Xl(0 + 256 * 1)), "244")
REM modifier keys and the lock keys give no character
CHK("tr_shift_key", N$(Xl(21)), "999")
CHK("tr_ctrl_key", N$(Xl(23)), "999")
CHK("tr_capslock_key", N$(Xl(70)), "999")
REM keypad: expansion tokens give the first character of the string
CHK("tr_keypad", N$(Xl(15)) + " " + N$(Xl(13)) + " " + N$(Xl(3)) + " " + N$(Xl(7)) + " " + N$(Xl(6)), "48 49 57 46 13")

REM --- keys typed by the harness ---
a$ = GetHeld(): r$ = GetHeld()
CHK("held_q", a$, "q")
CHK("held_q_return", r$, CHR$(13))
a$ = GetHeld(): r$ = GetHeld()
CHK("held_shift_q", N$(Has(a$, "Q")), "1")
CHK("held_shift_q_only_q", N$(-(LEN(a$) <= 2)), "1")
a$ = GetHeld(): r$ = GetHeld()
CHK("held_1", a$, "1")
a$ = GetHeld(): r$ = GetHeld()
CHK("held_shift_1_bang", N$(Has(a$, "!")), "1")
a$ = GetHeld(): r$ = GetHeld()
CHK("held_minus", a$, "-")
a$ = GetHeld(): r$ = GetHeld()
CHK("held_shift_minus_equals", N$(Has(a$, "=")), "1")
CHK("released_empty", N$(LEN(INKEY$)), "0")

REM --- the keys typed meanwhile are read, then LINE INPUT sees the next line ---
a$ = GetHeld(): r$ = GetHeld()
CHK("held_x", a$, "x")
LINE INPUT t$
CHK("input_after_held", t$, "HI")

REM Give the emulator time to process the end of the typing before END
PAUSE 100
PRINT
Report()
PRINT "DONE"
END
