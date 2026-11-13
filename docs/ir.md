# The cpcbas IR

The intermediate representation between the checker and the code generator. The types
are in `packages/cpcbas/src/ir/ir.ts`; this page is the prose reference. Change both
together, with the printer (`ir/print.ts`) and the verifier (`ir/verify.ts`).

The IR keeps the shape of the reference compiler's backend (Boriel BASIC 1.19, whose CPC
runtime we reuse): typed quads over a value stack, with results in the registers the
runtime routines expect. That is what lets the runtime, its `REQUIRES` mechanism and the
library's asm wrappers work unchanged. It starts much smaller than the reference's quad
list and does not have to match it.

## Types

| IR type | Language type | Size | Register (result / fastcall argument) |
|---|---|---|---|
| `u8` | UBYTE | 1 | A |
| `i8` | BYTE | 1 | A |
| `u16` | UINTEGER | 2 | HL |
| `i16` | INTEGER | 2 | HL |
| `u32` | ULONG | 4 | DEHL (DE high word) |
| `i32` | LONG | 4 | DEHL |
| `f16` | FIXED (16.16) | 4 | DEHL (DE integer part, HL fraction) |
| `f` | REAL (5-byte float, Locomotive's layout) | 5 | A E D C B = bytes 0..4 of the layout (below) |
| `str` | STRING | 2 | HL (pointer to length word + bytes; 0 is the empty string) |

`sem/types.ts` maps language types to IR types (`irType`). Pushed on the stack, a `u8`/`i8`
takes 2 bytes (`push af`: the value is the high byte), `f` takes 6 (three pushes), the
others their size.

**The REAL layout** (changed by FWM-LAYOUT, 2026-11-08, approved by the firmware-maths design
review). A REAL is Locomotive's 5 bytes,
in memory, in DATA, as an immediate and in a frame or array element: bytes 0..3 are the 32-bit
mantissa, least significant byte first, whose top bit (bit 7 of byte 3) is the sign instead of the
implied leading 1; byte 4 is the exponent biased by 128 (the value is 0.1xxx binary times
2^(byte 4 - 128)). **Exponent byte 0 means zero**, whatever the other bytes hold (measured on the
interpreter). `PEEK(@a + i)` therefore returns what the interpreter returns (`tests/loco/real-bytes.bas`:
1 is `00 00 00 00 81`, -1 is `00 00 00 80 81`, 0.1 is `CD CC CC 4C 7D`). In the registers the
bytes sit in memory order, **A = byte 0, E = byte 1, D = byte 2, C = byte 3 (sign), B = the
exponent**, so a REAL loads with `ld a,(x) / ld de,(x+1) / ld bc,(x+3)` and a stored or
pushed one (`push bc / push de / push af`) has its five bytes in memory order at sp+1..sp+5 of
the 6-byte slot (the frame slot of a by-value parameter, whose address `@p` is then also the
layout). A REAL in a register set or in memory is always in this full form; the imported
calculator's small-integer form (exponent byte 0 with the value in the other bytes) and its
Spectrum byte order exist only inside `lib/loco/fmathcalc.asm`, whose `__LOCO_F*` entries translate
at every boundary (hand-written ASM blocks that load or return a REAL use this register order). Firmware builds
(FWM-CORE) do the arithmetic and the functions in the firmware, which leaves junk in the mantissa bytes of a zero it
computes: **a REAL is zero when its exponent byte is 0**, so `jz`/`jnz` on a REAL test the exponent byte (register B)
only, and no routine tests more.
(The design text proposed swapping the bytes within the register pairs, `C B E D A`, which a
`push` cannot leave in memory order; this order keeps the loads, stores and pushes unchanged.)

## Evaluation model

- A **temp** is a value on the Z80 stack. The quad whose `dst` it is pushes it; the one quad
  that uses it pops it. Temps are used exactly once, in last-in first-out order, and never
  live across a label, a jump or a statement boundary. They may stay live across a `call`
  or an `rtcall`: the callee's frame is above them, and STDCALL's `leave` removes only the
  callee's own parameters, so `PRINT a + f(3)` is `load t0, _a` / `param.i16 #3` /
  `call _f, 2 -> i16 t1` / `add.i16 t2, t0, t1`. The verifier checks all of this.
- **Comparisons** (`eq ne lt le gt ge`) always give an `i16` temp holding -1 (true) or
  0 (false); the quad's `type` is the type of the operands. A condition is tested with
  `jz`/`jnz`, which take any numeric type: zero is false, anything else true (spec §5).
  Code generation may fuse a comparison with the following `jz` (later, in the optimiser).
- **AND, OR, XOR, NOT** are bitwise on integer types. The checker has already converted
  real operands to INTEGER.
- **Integer arithmetic wraps** silently in the quad's type (spec §4). `div` on integers
  truncates towards zero, `mod` has the sign of the dividend (`-7 MOD 2` is -1, as
  Locomotive); division by zero is runtime error 11. The runtime's signed remainder
  (`__MODI16` and DE after `__DIVI16_FAST`, measured; `__MODI8` and `__MODI32` divide the
  absolute values the same way) is |a| mod |b|, never negative, so the `mod` template on a signed type gives the result the dividend's sign
  itself (negate it when the dividend was negative); `test/z80sim/runtime.test.ts` pins
  the runtime's behaviour.
- **Strings.** A `str` temp is *owned*: a fresh heap string that the consuming quad must
  store (taking ownership, no copy) or free. A `str` from a variable (`global`, `frame`) or
  a constant (`strconst`) is *borrowed*: storing it copies it. `concat` and the string
  built-ins return owned strings. This follows the reference's `__STORE_STR` (copy) and
  `__STORE_STR2` (take) and `__PRINTSTR`'s free flag in A.
  - `load` of a borrowed string makes an owned copy (`__LOADSTR`), so the lowering uses a
    variable or a constant as a direct operand wherever the consuming quad takes one
    (`store`, `fparam`, `concat`, the comparisons) and keeps `load` for the stack arguments
    of a runtime routine that consumes them.
  - `fparam:str` puts the pointer in HL and the **free flag in A**: 1 when the operand is a
    temp (owned: the routine frees it), 0 for a variable or a `strconst` (borrowed). This is
    the convention of `__PRINTSTR`, `__LOCO_PRINTSTR`, `__ASC` and lib/loco/str.asm, so a
    PRINT of a literal is `fparam.str s0` / `rtcall .core.__LOCO_PRINTSTR`.

## Operands

| Operand | Meaning |
|---|---|
| `{k: 'imm', value}` | a constant of the quad's type |
| `{k: 'temp', id}` | a stack value |
| `{k: 'global', label}` | the memory at an asm label (`_score`) |
| `{k: 'frame', offset, byref?}` | the memory at `(ix + offset)`; `byref`: the slot holds the address of the value |
| `{k: 'addr', label, offset?}` | the address of a label, as an immediate; in `load` and `store` the memory at that address (a constant-index array element), except a `u16` *source*, which stays the immediate (`@x`): see "Arrays" |
| `{k: 'frameaddr', offset}` | the address `ix + offset` |
| `{k: 'strconst', id}` | the address of string constant `id` |

## Quads

The set needed for the L2 milestone is marked **M**. The others are in the contract so the
tasks that add them do not change its shape.

| Quad | Fields | Meaning |
|---|---|---|
| `load` **M** | type, dst, a | push `a`; for `str` an owned copy of the borrowed `a` (below) |
| `store` **M** | type, dst, a | `dst` (global or frame) = `a` |
| `add sub mul div mod` **M** | type, dst, a, b | arithmetic |
| `pow` | type f, dst, a, b | `a ^ b` |
| `and or xor` **M** | type, dst, a, b | bitwise |
| `shl shr` | type, dst, a, b | shifts; `b` is `u8`; `shr` arithmetic on signed types |
| `concat` | type str, dst, a, b | string `+` (owned result) |
| `eq ne lt le gt ge` **M** | type, dst, a, b | compare; `dst` is `i16` -1/0 |
| `neg not abs` **M** (`neg`, `not`) | type, dst, a | unary |
| `cast` **M** | type, from, dst, a | convert (spec §4: integers by sign, real to integer truncates); template key `cast:<from>-><to>` |
| `peek` **M** | type, dst, a | value at address `a` |
| `poke` **M** | type, a, b | store `b` at address `a` |
| `in` / `out` | u8 | port I/O |
| `aaddr` | type, dst, array, dims | element address from `dims` index temps ("Arrays" below) |
| `aload` / `astore` | type | element read / write through an address temp ("Arrays") |
| `label` **M** | label | |
| `jump` **M** | label | |
| `jz` / `jnz` **M** | type, a, label | conditional jump |
| `jtable` | a, labels, gosub | ON ... GOTO/GOSUB, 1-based; out of range falls through |
| `gosub` **M** / `retsub` **M** | label / - | GOSUB and RETURN |
| `end` **M** | a | END: the single program exit |
| `param` | type, a | push a STDCALL argument |
| `fparam` **M** | type, a | put `a` in the result registers (FASTCALL or runtime call); for `str`, A = the free flag (below) |
| `call` | label, argBytes, ret, dst | call a user procedure (callee pops its arguments) |
| `rtcall` **M** | label, ret, dst | call a runtime routine; its file is linked |
| `enter` / `ret` / `leave` | | procedure frame (below) |
| `asm` | lines, internal? | an ASM block, verbatim, each line preceded by `#line` and a bare `#line` after; `internal`: the lowering's own lines, no `#line` (below) |
| `stmt` **M** | number, span | start of a source statement (code only with `checkBreak`, below) |
| `comment` | text | `; text` in the asm |

## Internal asm

The IR has no quad for loading an arbitrary register or testing a flag, and four
statements of the L2 subset need one. The lowering emits them as `asm` quads marked
`internal: true`; these are the only sanctioned uses:

- **BORDER**: `ld b, ...` / `ld c, ...` before `rtcall .core.__LOCO_BORDER` (B and C).
- **LOCATE**: `jr nc, ok` / `ld a, 5` / `jp .core.__ERROR` after `rtcall .core.__LOCO_LOCATE`,
  which returns Carry for an out-of-range pair (Improper argument).
- **CALL**: IX = the parameter block (`ld hl, 0` / `add hl, sp` / `push ix` / `push hl` /
  `pop ix`), A = the count, the call (through `.core.__FW_CALL` / `defw` for a firmware
  entry, `jp (hl)` for a computed address), then `pop ix` and the block removed.
  The arguments are evaluated first and the computed address last (it is stored in a hidden
  global just before the asm, so a recursive CALL in an argument cannot overwrite it). A STRING
  argument (or `@name$`) is a 3-byte descriptor in a scratch buffer: `param.u16` the buffer's
  address (`addr` or `frameaddr`), `fparam.str` the string, `rtcall .core.__LOCO_STRDESC`; the
  argument is then the buffer's address. An owned temporary is parked in a scratch string slot and
  freed (and the slot cleared) after the CALL.
- **READ with no DATA in the program**: `ld a, 4` / `jp .core.__ERROR` (DATA exhausted at
  once: there is no table for `__LOCO_READ` to read). Added in review R8.

The generate() driver writes no `#line` before internal lines: they are generated code, so an
assembler error in them is a compiler bug (E001 at the generated text), as in a template,
and not the user's error that a line from an ASM block is. A user ASM block is followed by a
bare `#line`, which ends its attribution, so the template lines after it are not blamed on
the BASIC file. Any other register or flag need gets a quad (or a runtime entry) rather than
another internal `asm`. The printer shows internal lines like ASM lines (`asm "<text>"`).

## Arrays

Added in L3 wave 0; the layout is code in `src/ir/arrays.ts`, which the lowering
and the code generator both use. It is the reference compiler's descriptor, so the reused
runtime (`array/array.asm` `__ARRAY`, `array/arraybound.asm` `__LBOUND`/`__UBOUND`,
`array/arraystrfree.asm`, `array/arrayalloc.asm`) and the library's asm work unchanged.

- **Descriptor** (8 bytes): +0 the address of the dimension table, +2 the address of the elements,
  +4 the LBOUND table (always 0: arrays are 0-based), +6 the UBOUND table.
- **Dimension table**: `DEFW` dimension count - 1, `DEFW` the element count of each dimension
  after the first, `DEFB` the element size. **UBOUND table**: `DEFW` the upper bound of each
  dimension (always emitted; the reference emits it only when UBOUND is used).
- **Elements**: row-major, last index fastest (`a(i, j)` of `DIM a(n, m)` is element
  `i * (m + 1) + j`), each `irSize(type)` bytes: a STRING element is a 2-byte heap pointer (0 =
  empty), a REAL 5 bytes. Zeros unless the DIM has an initialiser.
- **A global array** `_a__a` is emitted in the data area as `_a__a:` (descriptor),
  `_a__a.__DATA__.__PTR__:` (its +2 word), `_a__a.__DATA__:` (the elements), `_a__a.__DIMS__:`,
  `_a__a.__UBOUND__:` (`codegen/data.ts`). `IrGlobal.size` is 8 plus the element bytes.
  With `DIM ... AT addr` the element label is `_a__a.__DATA__ EQU addr` and no elements are
  emitted. With `#pragma hidata` (`IrGlobal.hidata`) the elements are assembled at that address in
  an `org` block of their own, then the origin returns to the data area (`codegen/data.ts`). The
  lowering places the initialised arrays of one pragma one after another from its address (the fork's
  HIDATA cursor, restarted by each new setting of the pragma: `BoundProgram.hidataAt`); one that would
  end past &FFFF is E249.
- **A local array** has its descriptor in the frame (8 bytes, inside `enter`'s `localBytes`) and its
  elements on the heap, allocated and zeroed on entry by `.core.__LOCO_ALOCAL` (lib/loco/array.asm,
  L3 wave 2: `param.u16` the descriptor's `frameaddr`, `param.u16` the element bytes, `fparam.u16`
  the `addr` of its dimension table; it fills the descriptor, the UBOUND table word included). The
  lowering emits the two tables as one constant `IrGlobal` (`ctx.hiddenBytes`: the dimension table
  followed by the UBOUND table; the routine finds the second from the first), a numeric initial list
  as another one that an internal `asm` block copies to the elements (`ldir`), a string list as
  `astore`s of constant indexes on every entry, and frees the elements on
  every path to the leave label, after freeing each string of a string array
  (`.core.__ARRAYSTR_FREE`), as it frees string locals. Local arrays are therefore not limited by
  the IX range; a heap that cannot hold them is runtime error 7 (Memory full).
- **An array parameter** is always by reference: the argument is the address of a descriptor (`addr`
  of a global's label, `frameaddr` of a local's descriptor, or the `frame` value of the caller's own
  array parameter), pushed as a `u16`; the callee's slot holds that address.
- **Element access**: `aaddr` gives the element address from the index temps (`__ARRAY`, which
  multiplies by the element size from the dimension table; bounds are not checked, spec §8); `aload`
  and `astore` read and write through it. `astore` of a `str` follows `store`'s rules (an owned temp
  is taken, anything else copied, the old string freed). A global array with constant indexes
  needs no `aaddr`: the lowering uses `{k: 'addr', label: '<label>.__DATA__', offset}` with the
  offset from `elementOffset`, as a `global`-like operand (`load`/`store` take it as a memory
  operand of the element type); a constant index outside the bounds is a compile-time error (E248).
  The one exception is a `u16` element read: an `addr` *source* of `load.u16`/`store.u16` keeps its
  immediate meaning (`p = @x`), so the lowering reads a UINTEGER element with `peek.u16` of the `addr`
  (`codegen/array.ts` `memoryOperand` has the rule). An `addr` *destination* is always memory.
- **`@a(i)`** is the element address (`aaddr` or the `addr` above); **`@a`** (no index) is the
  address of the first element, `<label>.__DATA__` for a global (the reference's choice, so
  `SetPalette(@pal)` and `@pal(0)` agree); for a local or a parameter the +2 word of the descriptor.
- **LBOUND / UBOUND**: of a global or local array they fold to constants in the checker; of an
  array parameter they are `param.u16` the dimension, `fparam.u16` the descriptor address,
  `rtcall .core.__LBOUND` / `__UBOUND` (CALLEE). Dimension 0 is the number of dimensions, as the
  runtime gives it.

## Template keys

The code generator finds a quad's template by `op:type` (`add:i16`, `store:str`), then by
`op` (`codegen/types.ts`, `templateKey`). A `cast` is keyed by both types,
`cast:<from>-><to>` (`cast:u8->i16`, `cast:f->i16`, `cast:i16->str`): the integer table
owns the 36 integer-to-integer keys, L2-CG-REAL every key with `f` or `f16` on either side,
L2-CG-STR every key with `str`. A table never registers a bare `cast:<to>` key.

## Calling conventions

These are the reference's (its `_enter`, `_leave`, `_call` in
`src/arch/z80/backend/generic.py`), so the library's FASTCALL and STDCALL asm wrappers keep
working.

- **STDCALL** (default). The caller pushes the arguments last first, so the first
  argument is nearest the frame. The callee does `push ix / ld ix, 0 / add ix, sp`, so
  `(ix+0)` is the saved IX, `(ix+2)` the return address, and the first argument starts at
  `(ix+4)` (a `u8` argument's value is at `(ix+5)`, the high byte of its pushed word).
  Locals are below: `(ix-1)` downwards, zeroed by `enter`. `leave` restores SP and IX,
  removes the argument bytes and returns. A FUNCTION returns its value in the result
  registers; the caller's `call` pushes it into `dst`.
- **FASTCALL**. The single (first) argument arrives in the result registers (`fparam`
  then `call`); no frame unless the procedure has locals or more parameters (then
  STDCALL rules apply to the rest). The IR has no operand for "the result registers", so
  the lowering gives a FASTCALL procedure whose body reads its first parameter a local
  slot for it: `params[0].offset` negative, inside `enter`'s `localBytes`. `enter` builds
  the frame without touching a register, zeroes the locals, then stores the register
  argument into that slot (a BYREF one is the address in HL); the body reads it as an
  ordinary `frame` operand. `params[0].offset` 0 means no slot: only an ASM body reads
  the registers (the library's wrappers, which have no locals and so no frame).
- **BYREF** parameters hold the address of the variable (`frame` operand with `byref`).
- **`leave` does not free strings.** The template sees no types for the frame slots, so
  the lowering frees owned string locals and BYVAL string parameters (`.core.__MEM_FREE`
  of each slot) on the way out, before the procedure's leave label, on every path that
  reaches it. A FUNCTION's string result is moved to the result registers first and is
  not freed.
- **`argBytes` is even**: a `u8`/`i8` argument is pushed as a word (`push af`), so a
  procedure's argument bytes are the sum of 2 per byte parameter and the others' sizes
  (`f` is 6). An odd count is a lowering bug (`InternalError`).
- **Frame size.** Frame operands are `(ix+d)` with a signed byte: every byte a quad
  touches must lie in -128..127. The operand loaders report E002 ("frames are limited to
  128 bytes") beyond that, through one shared range check (L3). Local arrays keep only their
  8-byte descriptor in the frame (above, "Arrays"), so only a procedure with more than about
  120 bytes of scalar parameters and locals reaches the limit; moving IX for such frames
  (the reference's `_pload.py`) is left to L5.
- **Runtime calls** use each routine's own convention, documented in its asm header
  (most take one argument in the result registers: `fparam` then `rtcall`).
- **Firmware calls** go through the gate: `call .core.__FW_CALL` followed by
  `defw <entry>` (lib/runtime/fwcall.asm); A, F, BC, DE, HL pass through. CAS and AMSDOS
  entries use `.core.__FW_CALL_IX`, which also saves IX.

## Statement boundaries

A `stmt` quad starts each source statement. The generate() driver skips it unless the
program sets the `IrProgram` flag `checkBreak` (filled by the lowering, optional, false
when absent):

- `checkBreak`: the program has `ON BREAK STOP` somewhere (spec §6). Each `stmt` emits `push hl` /
  `ld hl, <line>` / `call .core.__LOCO_CHKBRK` (lib/loco/keys.asm, L4-KEYS; break.asm's convention: it
  returns with HL and the stack as before the push). While `ON BREAK STOP` is in force at run time (a flag
  that `ON BREAK CONT` clears) and ESC is down, it calls the routine STOP uses (lib/loco/brk.asm
  `__LOCO_STOPAT`), which prints `Break in <line>` and ends the program ("Break is not an error", below).
  `<line>` is the `stmt`'s `number`; for a statement with no number it is 65535, which the routine reads as
  "no line" and prints plain `Break` (no real line has that number, and line 0 exists in Locomotive).

The flag is a whole-program one: a statement boundary is the same everywhere, and the
cost is paid only by programs that ask for it. The EVERY/AFTER poll is not a flag: it is
an `rtcall .core.__EVENT_POLL` quad that the statement-boundary hooks emit (below). No
temp is live at a `stmt`, so the emitted code may use any register.

## Events and errors

The contract of L4 wave 1 for ON ERROR, RESUME, ERR, ERL, ERROR, the non-fatal REAL errors, EVERY, AFTER,
REMAIN, DI, EI, TIME and ON BREAK (L4-0, 2026-11-09). L4-ERR, L4-EVENTS and L4-KEYS implement it. A change to anything below is a contract change:
the task stops and reports it, and the wave's reviewer decides.

### The statement-boundary hooks

`src/ir/lower/boundary.ts`. The statement lowering calls `statementStart(ctx, s)` right after the `stmt`
quad of every executable statement (`lowerStmt`, and each `stmt` quad of a local DIM initialiser in
`lowerDimInit`), and `statementEnd(ctx, s)` after every statement of a list (`lowerStmts`), executable or
not. Both run in the main program and in procedure bodies; `ctx.procExit !== null` means a procedure body.
At a statement boundary the code runs in this order, fixed by L4-0:

1. the ESC check of `ON BREAK STOP`: the `stmt` quad's codegen template, as today (`IrProgram.checkBreak`).
   L4-KEYS owns the routine it calls;
2. `eventPoll` (L4-EVENTS): any EVERY/AFTER handler that is due runs here;
3. `erlMark` (L4-ERR): the error mark of a main-program statement.

Then the statement's code, then `erlEnd` (L4-ERR) from `statementEnd`. The poll comes before the mark so
that a handler's own marks are overwritten by the interrupted statement's. Each hook emits nothing for a
program that does not use its feature, so that program's own code is byte-identical to main's before L4 (a
test in each task). The image is not quite: the trap test at `__ERROR`'s entry (below) is in the imported
`error.asm`, which every program links, so every image is 10 bytes (firmware) or 8 (bare) longer than before
L4-ERR (R14, accepted: the cost of one raise entry). `statementStart` and `statementEnd` belong to L4-0; a wave-1 task edits only its own
hook. `setBoundaryProbe` is for tests.

`IrProgram.pollEvents` and the E002 branch of the `stmt` template (codegen/flow.ts) were retired by
L4-EVENTS (done): the poll is an `rtcall` quad that `eventPoll` emits, not a codegen flag. L4-EVENTS removes the
field from `ir/ir.ts`, `codegen/types.ts` and `codegen/generate.ts`, and the sentence about it from
"Statement boundaries" above (a contract change decided here).

New sanctioned internal `asm` (docs/ir.md "Internal asm"): the error mark's three lines (below). Target
addresses (ON ERROR GOTO, RESUME n, EVERY, AFTER) need no asm: `fparam.u16` of an `addr` operand whose
label is the target's (`{k: 'addr', label: '.L.100'}`) puts the address in HL.

### Private-block slots

L4's runtime state lives in the private block (`SYSVAR_BASE`, `lib/runtime/sysvars.asm`), which is in the central 32K in
both memory maps (the firmware reads the tick blocks there) and is zeroed at start-up. Offsets
$220-$2FF are free in both maps; L4 divides them:

| Offsets | Owner | Shared names |
|---|---|---|
| $220-$23F | L4-ERR | `LOCO_ERRTRAP` $220, `LOCO_ERRPOS` $222 (6 bytes) |
| $240-$2AF | L4-EVENTS | |
| $2B0-$2BF | L4-TEXT (L4-FILES adds device 9) | `LOCO_DEV` $2B0 |
| $2C0-$2CF | L4-KEYS | |
| $2D0-$2DF | L4-GFX | |
| $2E0-$2E7 | L4-SOUND | |
| $2E8-$2EF | L4-SMALL | |
| $2F0-$2FF | L4-FILES (wave 2) | |

Its names are defined in `lib/loco/vars.asm` (R13), **not** in `sysvars.asm`: that file is imported from the fork and
`tools/import-runtime.py --check` (run by `npm test`) keeps it byte for byte, as FWM-CORE's slots are defined in
`loco/fwmath.asm`. `vars.asm` already defines the three names that more than one task uses, and has one heading per task
(`; --- L4-ERR: $228-$23F` ...). Each task adds the EQU lines of its own slots under its own heading and nothing else, so
parallel branches merge without conflicts, and a file that uses a name includes `<loco/vars.asm>`. The shared names, as
defined there:

```
LOCO_ERRTRAP        EQU SYSVAR_BASE + $220  ; DW -- ON ERROR trap entry for __ERROR, 0 = none (lib/loco/error.asm, L4)
LOCO_ERRPOS         EQU SYSVAR_BASE + $222  ; 6B -- error mark of the main statement in progress: data pointer, SP, IX (L4)
LOCO_DEV            EQU SYSVAR_BASE + $2B0  ; DB -- output device of the statement: 0 text screen, 8 printer, 9 file (L4)
```

### Errors

**One raise entry.** Every runtime error goes to `__ERROR` (lib/runtime/error.asm) with A = the
**Locomotive** error number (the manual's list, 1-32), from templates, the lowering's internal asm,
`lib/loco` and the imported runtime alike. The fatal path is today's: "Error n" on a fresh line, the
key wait, the reset (printer-echo builds skip the wait).

**The trap.** `error.asm` gets one patch, as `mem/alloc.asm` did in L3-FIX: at `__ERROR`'s entry,
after `ld (ERR_NR), a`, if `LOCO_ERRTRAP` is non-zero it jumps there with A = the number; otherwise it
falls into the message path, which gets a global label `__ERROR_FATAL` (entry A = the number) so the trap
can make an error fatal after all. Nothing else in `error.asm` changes except the `ERROR_*` values
(below). A trap vector in our own layer alone cannot work: every raise site jumps to `__ERROR` itself, and
the runtime's `#include once <error.asm>` always links the imported file. The patch, like every change to an
imported file, goes through `PATCHED` in `tools/import-runtime.py` (so that `--check`, which `npm test` runs, accepts
it) and the patched-file list of lib/README.md "Known defects in `runtime/`"; `PATCHED` holds one (old, new) pair per
file today, so L4-ERR makes it take several pairs for `error.asm` (R13). L4-ERR's own code is
`lib/loco/error.asm` (included as `<loco/error.asm>`): the trap, the mark, RESUME, ERR, ERL, the soft path
and the RETURN check.

**The numbers (follow-up 21).** The imported runtime's `ERROR_*` EQUs in `error.asm` take Locomotive
values. A translation table at `__ERROR` cannot work: templates already raise 5 (Improper argument) and
11 (Division by zero), which are other errors in the Spectrum's numbering.

| EQU | Spectrum | Locomotive | Raised in cpcbas builds by |
|---|---:|---|---|
| `ERROR_SubscriptWrong` | 2 | 9 Subscript out of range | `array/array.asm`, only with `__CHECK_ARRAY_BOUNDARY__`, which cpcbas never defines |
| `ERROR_OutOfMemory` | 3 | 7 Memory full | `fp_calc.asm` (the calculator's stack, bare REAL), `udg.asm` (the SYMBOL table) |
| `ERROR_OutOfScreen` | 4 | 5 Improper argument | `print.asm`'s `__STOP` only (sets ERR_NR, raises nothing) |
| `ERROR_NumberTooBig` | 5 | 6 Overflow | `fp_calc.asm` (bare REAL overflow) |
| `ERROR_InvalidArg` | 9 | 5 Improper argument | `fp_calc.asm` (bare SQR, LN of a bad argument; an unsupported calculator op) |
| `ERROR_IntOutOfRange` | 10 | 5 Improper argument | `fp_calc.asm` STK-TO-A (a value of 256 or more where a byte is wanted) |
| `ERROR_NonsenseInBasic` | 11 | 2 Syntax error | nothing |
| `ERROR_InvalidColour` | 19 | 5 Improper argument | nothing |
| `ERROR_InvalidFileName` | 14 | unchanged | nothing; L4-FILES decides |
| `ERROR_TapeLoadingErr` | 26 | unchanged | nothing; L4-FILES decides |
| `ERROR_BreakIntoProgram` | 20 | unchanged | `break.asm`, which L4-KEYS replaces (Break is not an error: below) |

Our own raise sites already use Locomotive numbers (`lib/loco`: 2, 3, 4, 5, 6, 7, 11; the templates and
the lowering: 4, 5, 11). L4-ERR regenerates the asm goldens of the changed file.

**Which programs pay.** A program pays for the error machinery only if it has `ON ERROR GOTO` with a
target (not 0). ERR and ERL in a program without one read slots that stay 0 (no error can be trapped).
`ERROR n` raises n with or without a trap.

**The mark.** In a program with ON ERROR, `erlMark` emits at the start of every **main-program**
statement (not in procedures):

```
.T.a:                         ; label quad: the RESUME point of this statement
	call .core.__LOCO_MARK    ; internal asm, 3 lines
	defw <line>               ; the statement's line number, 0 when its line has none
	defw .T.b                 ; the RESUME NEXT point
```

and `erlEnd` emits the label quad `.T.b` after the statement's code. `__LOCO_MARK` pops its return
address (the address of `defw <line>`), stores it, SP (the statement's SP, without the call) and IX in
`LOCO_ERRPOS`, and jumps past the two words. The restart point is that address minus 3. Cost: 7 bytes per
main-program statement and about 110 T-states (17 for the call, about 90 in the routine), plus the
routine (about 20 bytes, once). A program without ON ERROR GOTO n gets nothing.

*Loop tests (follow-up 81, L5-HOT).* A WHILE, DO or FOR marks its own statement once, at its start. The test of the second
and later passes runs after the body's last statement has marked, so `erlMarkTest` (boundary.ts, errors.ts `markLoopTest`) emits the
same three-line mark again, with the same RESUME NEXT point, where that test runs: at the end of a WHILE body (`CONTINUE WHILE` goes
there too), at the `LOOP` of a DO (the DO line for a pre-condition, the LOOP line for a post-condition) and at the NEXT of a FOR
(line of the NEXT). 7 bytes and about 110 T-states a loop pass, only in a program with ON ERROR GOTO n, main program only.
Measured on the interpreter: a WHILE test that fails on a later pass is the WHILE's line (`tests/loco/err-loop.bas`).

*The line.* `<line>` is the number of the source line the statement is on, 0 when that line has no
number (spec section 6). `ctx.lineNumber` is the last number seen, which would differ for an unnumbered
line after a numbered one, so the parser marks the first label or statement of such a line with the optional
`NodeBase` field `unnumberedLine` (only once an earlier line has a number), and `lowerStmt` sets
`ctx.lineNumber` to null on a marked node (L4-FIX-A). A procedure body starts on no line
(`beginBody` sets `ctx.lineNumber` to null; review R16), so a SUB declared above the numbered lines
does not inherit the main program's last number. Nothing in the IR changed:
`erlMark` and the `stmt` quad read `ctx.lineNumber` as before.

*Why main-program statements only.* Locomotive has no procedures; its DEF FN runs inside the calling
statement. cpcbas treats a SUB or FUNCTION the same way: an error inside a procedure, at any depth, belongs
to the main-program statement that called it. ERL is that statement's line, RESUME runs that statement
again (calling the procedure again), RESUME NEXT continues after it, and the trap unwinds every procedure
frame by restoring SP and IX from the mark. So RESUME never enters a procedure, and a statement in a
procedure costs nothing. EVERY/AFTER handlers are main-program code, so their statements are marked; the
dispatcher saves and restores `LOCO_ERRPOS` around a handler (Events, below), so a handler that ran inside
a procedure does not leave its own mark behind.

*RESUME NEXT of a compound statement.* `.T.b` is after the statement's whole code. For a simple statement
that is the next statement (in a THEN or ELSE list, the next one in that list; after the last one, the end
of the IF). For an error in the header of a compound statement (an IF condition, the FOR start, limit or
step, a WHILE or DO condition, a SELECT CASE subject, an ON selector), RESUME NEXT continues after the
whole statement (after END IF, NEXT, WEND, LOOP, END SELECT, or the single-line IF's line part). L4-ERR
probes the interpreter for the single-line IF and FOR cases and records what it does in
loco-measured.md; where it differs, the difference is a documented dialect change and the loco-diff
programs avoid it.

**The trap routine** (`LOCO_ERRTRAP` points at it while a handler is set; entry A = the number):
1. If the program is already in error processing (from an earlier trap until RESUME), or no statement has
   been marked yet (an error before the first main statement), the error is fatal: `ld (LOCO_ERRTRAP)`
   cleared, `jp __ERROR_FATAL`. Locomotive also reports an error inside its handler as fatal.
2. Otherwise: ERR = A; the mark is copied to a second 6-byte slot (the error's position: ERL and RESUME read
   that one, because the handler's own statements move the mark); error processing on; SP and IX from the
   mark; firmware builds select text stream 0 (TXT STR SELECT) and every build sets `LOCO_DEV` to 0 (Streams,
   below); bare builds empty the imported calculator's number stack (`FP_STKEND` = `FP_STKBOT`: an error raised
   inside the calculator leaves its operands there, and no calculator value lives from one statement to the next, so
   without this every trapped bare REAL error would leak 5-byte entries until Memory full; R13); interrupts on
   (`ei`: a raise inside a `di` section of the runtime must not leave them off); then
   `jp` to the handler.

The SP from the mark keeps the GOSUBs that were pending when the statement started (the handler is a
GOTO, as in Locomotive) and drops the expression's temps and the frames of procedures it had called.
**Known leak:** owned string temporaries on the dropped stack, and the string locals and heap arrays of the
dropped frames, are not freed. Locomotive collects its garbage; cpcbas has no collector. Documented as a
limitation; a program that traps errors inside string expressions in a loop can run out of heap.

**Statements and functions.**
- `ON ERROR GOTO target`: sets the handler address and `LOCO_ERRTRAP`. Allowed anywhere, procedures
  included, but the target must be a main-program label (the handler is main-program code). Today the binder
  refuses any jump target outside the statement's own body (E207, worded for GOTO and GOSUB). L4-ERR gives
  `bind.ts`'s `jump()` a third kind, `handler`, for the targets of ON ERROR GOTO, RESUME, EVERY and AFTER
  (all four `case`s in `bind.ts`), whose rule is "a label of the main program", with its own error E214.
  Allowed inside the handler (it replaces the handler).
- `ON ERROR GOTO 0`: clears both. In error processing, the pending error becomes fatal at once (Locomotive's
  rule; L4-ERR confirms it with a probe).
- `RESUME` / `RESUME NEXT` / `RESUME target`: allowed anywhere (a procedure the handler calls may resume:
  RESUME restores SP and IX entirely); the target is a main-program label (E214). Outside error processing:
  error 20 (Unexpected RESUME). Each restores SP and IX from the error's position, ends
  error processing, and jumps to the restart point, the RESUME NEXT point, or the target. The parser
  accepts the three forms (L4-ERR replaces the E179 refusal with a `Resume` AST node:
  `{ kind: 'Resume'; mode: 'same' | 'next' | 'target'; target: JumpTarget | null }`, and the keyword table
  entry becomes `compiled`).
- `ERROR n`: n from 1 to 255 (else error 5); raises n. A number that Locomotive does not assign is raised
  the same way (ERR = n); the fatal text is "Error n" for every number.
- `ERR`: the number of the last trapped error, 0 before one; `RESUME` (any form) resets it to 0, as the
  interpreter does (L4-ERR, measured). `ERL`: the line of the last trapped error's statement, 0 before one;
  it stays after `RESUME`. A statement on an unnumbered line gives 0 even after a numbered line (follow-up 80,
  fixed: "The line", above).
- A main-program `RETURN` with no GOSUB pending is error 3 (follow-up 52): the main program's stack base
  is `.core.CPC_STACK_TOP` (the prologue's `ld sp`), so no start-up store is needed. The RETURN calls a
  check (`__LOCO_RETCHK`: SP + 2, past its own return address, equal to `CPC_STACK_TOP` raises 3) before
  `retsub`. Every program with a main-program RETURN pays for it (about 20 bytes once and 3 per RETURN);
  it is a crash fix, so it is not tied to ON ERROR.

**The non-fatal errors (follow-up 60), firmware builds.** Overflow (6) and Division by zero (11) from the
REAL arithmetic and functions, and the LOG errors, go through `__LOCO_SOFTERR` (A = the number) instead of
`jp __ERROR`. With a handler set and not in error processing, it raises the error (`jp __ERROR`, so the
trap takes it). Otherwise it prints the error's name ("Overflow", "Division by zero": the only two names
the program carries) through `error.asm`'s output path (the printer echo included), then CR LF, and
returns; the caller then produces the firmware's result (+-max, or the argument for LOG). It preserves BC,
DE, HL and IX; A and F are lost, so a caller whose result is in A reloads it. The sites: `lib/loco/fwmath.asm`,
`lib/loco/realfn.asm` (their `jp __ERROR` lines), and the REAL division by zero, which firmware builds detect in
`__LOCO_FDIV` from the divisor's exponent (the firmware divide returns +-max for it; L4-ERR) so that `zeroCheckF`
in `codegen/real.ts` emits nothing in firmware builds and still raises 11 in bare builds. `CINT(40000)` stays fatal Overflow, as in Locomotive. Integer `\` and MOD by zero
(`codegen/int.ts`, error 11): L4-ERR probes the interpreter and uses the soft path only if it carries on.
**Bare builds:** the imported calculator abandons its own stack at the raise, so these errors stay errors
(fatal, or trapped by ON ERROR) in bare builds: a documented bare difference.

**An error inside an event handler** (R14, measured on the interpreter: `tests/loco/err-event.bas`). The trap
takes it like any other: the mark is the handler statement's, so `RESUME` and `RESUME NEXT` go back into the
handler and its `RETURN` reaches the dispatcher, which restores the running priority, the device and the stream.
An error handler that leaves with `GOTO` (or `RESUME n` elsewhere) never returns to the dispatcher: the handler's
priority stays set and timers of lower or equal priority stop, which is what Locomotive does too (follow-up 86,
closed without a change).

**Break is not an error.** ESC under `ON BREAK STOP` prints `Break in <line>` (plain `Break` when the statement
has no number) and ends the program as STOP does, through the one routine they share (lib/loco/brk.asm); it
does not go through `__ERROR` and ON ERROR does not trap it (Locomotive's Break is not in the error
list). The routine the `stmt` template calls is `__LOCO_CHKBRK` (lib/loco/keys.asm, which replaced the
Spectrum's `.core.CHECK_BREAK`, error 20), with the same calling convention; it tests a runtime flag that
`ON BREAK STOP` sets and `ON BREAK CONT` clears, so that both can appear in one program as in Locomotive.
`checkBreak` stays a whole-program flag (set when the program has `ON BREAK STOP` anywhere).

### Events

**Model** (spec section 6). Four timers, 0-3; timer 3 has the highest priority. A handler is a main-program
GOSUB target, whichever body the EVERY or AFTER is in. It runs only at a statement boundary, from the poll, so it never runs between two quads of
an expression **in the statement that polls**. A poll in a procedure runs between two quads of the
main-program statement that called the procedure: that is follow-up 39's case, below.

**Which programs pay.** The poll is emitted only when the program has EVERY or AFTER (REMAIN, DI, EI and
TIME alone do not need it). Then every statement start, main program and procedures, gets `rtcall
.core.__EVENT_POLL` (3 bytes). When nothing is due it returns at once: about 45 T-states in firmware builds
(the call and a test of one byte), about 110 in bare builds (also the frame-counter check, below).

**Firmware builds.** EVERY and AFTER use the firmware's ticker (KL INIT EVENT &BCEF, KL ADD TICKER &BCE9,
KL DEL TICKER &BCEC), one 13-byte tick block per timer in L4-EVENTS' private-block slots. The event is
asynchronous with a far address and ROM select &FF (class &80, as `framehook.asm`'s frame event), so both
ROMs are off while its routine runs. The routine only adds one to the timer's pending count (at most
127, as the kernel's own count) and returns; the handler runs later, at the poll. EVERY n: count n,
recharge n. AFTER n: count n, recharge 0 (a one-shot ticker); its block is removed when the kick is
dispatched. The timers stop while the library's game mode is on, as the firmware's clock does (documented).
**Bare builds.** No interrupt code: the poll compares the 16-bit low word of the frame counter `FH_FRAMES`
(counted by `framecore.asm` on every frame) with the value it last saw, and for each frame in between counts
every running timer down, adding one to its pending count when it reaches 0 and recharging it (EVERY) or
stopping it (AFTER). No tick is lost while one statement or runtime call runs for up to 65535 frames (about
21 minutes).

**Dispatch** (`__EVENT_POLL`, shared by both builds). Nothing happens while DI is in force. Otherwise the
highest timer whose pending count is non-zero **and** whose priority is above the handler now running (if
any) is taken: its count goes down by one, the running priority becomes its own, and its handler is called
like a GOSUB. Around the call the dispatcher saves and restores: the running priority; `LOCO_ERRPOS` (all 6
bytes); the output device `LOCO_DEV`, set to 0 for the handler; and in firmware builds the text stream
(TXT STR SELECT &BBB4 with 0, the old stream restored after). The handler's RETURN returns to the
dispatcher, which clears DI (Locomotive: the RETURN of an event subroutine re-enables, 464 manual, DI)
and polls again, so every due event of higher priority than the interrupted code runs at that boundary,
highest first. Pending kicks of a lower timer wait (they are not lost). L4-EVENTS checks the order against
the interpreter in `timer.bas`; where the interpreter differs, the interpreter wins and the task records it.

**Statements and functions.**
- `EVERY n [, t] GOSUB target`, `AFTER n [, t] GOSUB target`: t from 0 to 3 (default 0, else error 5); n in
  1/50 s. Issuing either on a timer replaces what the timer did (AFTER overrides EVERY and back) and clears
  its pending count. Allowed anywhere, procedures included; the target must be a main-program label
  (E214, the binder's `handler` kind, which L4-ERR adds). n = 0 stops the timer (measured on the interpreter:
  no error, nothing runs, `REMAIN` is 0); a negative n is error 5.
- `REMAIN(t)`: the count left on timer t (1/50 s units; firmware: KL DEL TICKER's DE), 0 when the timer is
  not running; the timer is stopped and its pending count cleared. t outside 0-3: error 5.
- `DI` / `EI`: stop and restart the dispatch of handlers (not the Z80's interrupts; timers keep counting).
  DI and EI are allowed anywhere, procedures included.
- `TIME`: ULONG, 1/300 s. Firmware: KL TIME PLEASE (&BD0D) through the gate. Bare: `FH_FRAMES` x 6 (1/50 s
  resolution; follow-up 63, the bench's method).

**Follow-up 39, resolved without handler scratch slots.** In the main program `ctx.scratch` is
`ctx.hidden`, which makes a new hidden global at every call: every site has its own slot, and no two
statements share one (follow-up 39's text says "shared by every statement"; that is not so). A handler
interrupts only at a statement boundary. When the boundary is inside a procedure that a main-program
statement called mid-expression, the handler runs other statements, so it uses other slots. The
interrupted statement's spilled MIN/MAX operand, FOR limit or SELECT subject keeps its value.
`context.ts` does not change. L4-EVENTS proves it with a simulator test: `x = MIN(a, F())` in the main
program, a timer that fires during F's statements, a handler that computes another MIN, and x correct.
The one remaining hazard is a handler that runs the very statement it interrupted (a GOSUB to the line
that is in progress): its slots are then shared, as its variables are in Locomotive. The manual already
tells the programmer to consider "intermediate variable states at the point of interruption"; L4-DOCS
documents it.

**Runtime state that spans quads.** A statement whose runtime keeps state across quads (the selected
stream and device, PRINT USING's format) can be interrupted by a handler when one of its items calls a
procedure. The dispatcher saves the stream and the device (above). Any other such state must live in the
statement's scratch slots, not in a runtime global, or be saved by the dispatcher through a contract
change. Events are not serviced inside one runtime call (an INPUT waiting for its line, PAUSE, FRAME, a
firmware call): they run at the next boundary after it returns.

## Streams

The contract for `#s` on PRINT, LOCATE, CLS, PEN, PAPER, WINDOW, TAG, TAGOFF, INPUT and LINE INPUT, and on
POS, VPOS and COPYCHR$ (L4-0, 2026-11-09). L4-TEXT implements streams 0-8; L4-FILES adds device 9 and the
stream forms of INPUT (wave 2).

**Statements: one selection per statement.** A statement with a stream that is not the constant 0 starts
with `fparam.u8 s` / `rtcall .core.__LOCO_STREAM` (the stream is evaluated before the other arguments, as
in Locomotive) and ends with `rtcall .core.__LOCO_STREAM0` after its last output call. A statement without
a stream, or with `#0`, emits neither, so programs without streams do not change. `__LOCO_STREAM` (A =
stream): 0-7 select the text stream (firmware: TXT STR SELECT &BBB4) and set `LOCO_DEV` to 0; 8 sets
`LOCO_DEV` to 8 (the printer); 9 sets it to 9 (the file, L4-FILES); above 9, error 5. `__LOCO_STREAM0`
selects stream 0 and sets `LOCO_DEV` to 0. Bare builds have stream 0 only: a constant stream other than 0
is E270 (naming the statement and the stream), and a non-constant stream reaches a bare `__LOCO_STREAM`
that raises error 5 for anything but 0.

**Functions: the stream is a parameter.** POS(#s), VPOS(#s) and COPYCHR$(#s) take A = the stream, select it,
read, and select the previous stream again (TXT STR SELECT returns it), so an expression changes no state.
POS(#8) is the printer's column (L4-TEXT keeps it), POS(#9) the file's (L4-FILES).

**One output point.** Every character the program prints, whatever the stream, goes through
`__LOCO_PUTC` (lib/loco/txtout.asm), which dispatches on `LOCO_DEV`: 0 to TXT OUTPUT (firmware: the selected
window) or the bare renderer, with the printer echo; 8 to MC PRINT CHAR (&BD2B), with no echo; 9 to CAS OUT
CHAR (&BC95, L4-FILES). PRINT USING, INPUT's prompt and `?Redo from start`, and the non-fatal error names also go
through it (or through `error.asm`'s output path, which echoes the same way). **Exception (L4-KEYS, accepted by
R14):** the characters the line editor echoes as they are typed go to TXT OUTPUT (bare: the renderer) directly,
on the selected stream but not through the printer echo, because the interpreter's editor echo never reaches the
printer hook either (follow-up 101, closed). INPUT on streams 1-7 (L4-FILES) must select its stream before the
editor runs, so the echo lands in that window. Nothing else calls TXT OUTPUT
directly. The device test costs every printed character a byte test (about 7 bytes and 20 T-states); a
mechanism that leaves programs without `#8` and `#9` unchanged is better if L4-TEXT finds one.

**The printer echo and the harness.** The interpreter's hook sees every byte that reaches TXT OUT ACTION,
which is the output of streams 0-7 whatever the window. The compiled echo is at the same place (device 0
of `__LOCO_PUTC`), so window output compares. `PRINT #8` goes straight to the printer on both sides,
without the hook's filter: the capture gets its bytes raw (CR LF line ends, which the normaliser turns into
`\n`; other control codes are not dropped). A loco-diff program that uses `#8` must expect that, or leave
`#8` out. Output to `#9` is not captured: `files.bas` prints what it reads back.

**Interruptions.** The selection lives from `__LOCO_STREAM` to `__LOCO_STREAM0`. An error trap and an event
dispatch both reset it to stream 0 and device 0 (and the dispatch restores it after the handler), so
neither leaves output going to the wrong window.

**The line editor.** The firmware has no line-editor entry (Locomotive's editor is in the BASIC ROM). INPUT
and LINE INPUT use `lib/loco/input.asm`'s own editor in both builds: printable characters, DEL and RETURN
at least. A firmware build may add more of Locomotive's keys (the cursor keys, CLR, COPY) if L4-KEYS can
match them; each one left out is documented. (For firmware builds, "the firmware line
editor" of the L4 scope table is this editor.)

## Program layout

The link step (`codegen/link.ts`) produces one asm text in the reference CPC backend's
layout (its `emit_prologue` / `emit_epilogue`):

```
	org 64
	.core.CPC_PRIV_BASE EQU 40448        ; firmware mode; bare mode: 48128
	.core.CPC_PRIV_SIZE EQU 1024
	.core.CPC_STACK_TOP EQU 42496        ; bare: 48128
	.core.CPC_MEM_TOP EQU 42619          ; bare: 49151
.core.__START_PROGRAM:
	di
	ld sp, .core.CPC_STACK_TOP
	call .core.CPC_INIT_00_BOOTSTRAP     ; every init label, sorted as strings
	call .core.__MEM_INIT
	jp .core.__MAIN_PROGRAM__
.core.ZXBASIC_USER_DATA:
	; Defines HEAP SIZE                  ; only when the heap is in use
.core.ZXBASIC_HEAP_SIZE EQU 4768
	; Defines HEAP ADDRESS
.core.ZXBASIC_MEM_HEAP EQU 35680
	; Defines USER DATA Length in bytes
.core.ZXBASIC_USER_DATA_LEN EQU .core.ZXBASIC_USER_DATA_END - .core.ZXBASIC_USER_DATA
	.core.__LABEL__.ZXBASIC_USER_DATA_LEN EQU .core.ZXBASIC_USER_DATA_LEN
	.core.__LABEL__.ZXBASIC_USER_DATA EQU .core.ZXBASIC_USER_DATA
<global variables and arrays>
.core.ZXBASIC_USER_DATA_END:
.core.__MAIN_PROGRAM__:
<main program>
	ld hl, 0                             ; the END sequence (end quad)
	ld b, h
	ld c, l
.core.__END_PROGRAM:
	jp .core.__CPC_END
<procedures>
<string constants, DATA>
#include once <bootstrap.asm>            ; every required file, sorted
...
	END .core.__START_PROGRAM
```

The heap is "in use" when a linked file is one of `MEMINITS` (`codegen/requires.ts`) or
`.core.__MEM_INIT` is among the inits; the inits are the source's `#init` labels plus every
`#init` in the linked runtime files (the link step runs the asm preprocessor over the
`#include` lines to find them, as the reference does). A `#require` file that is not in the
runtime tree is E421 at the `#require` (`IrProgram.requireSpans`, passed through
`AsmProgram.requireSpans`); any other missing file is E420. `tests/asm-golden/programs/empty.asm`
and `print_hello.asm` are this layout as the reference emits it.

A second `END` in the program jumps to `.core.__END_PROGRAM`.

## Labels

| What | Label |
|---|---|
| global scalar | `_` + declared spelling, plus `__i` / `__r` / `__s` for `%` / `!` / `$` names (`sem/model.ts`, `globalLabel`) |
| global array | the same plus `__a` |
| SUB / FUNCTION | `_` + declared spelling (`_SetInk`); its exit label `<label>__leave` |
| DEF FN | `_FN__` + declared spelling (`_FN__twice`) |
| line number / named label | `.L.100`, `.L.name` (`lineLabel`) |
| generated | `.T.0`, `.T.1`, ... (`EmitContext.newLabel`, and the lowering's own counter for IR labels) |
| string constant | `.S.<id>` |
| DATA | `.DATA.__DATA__0` (the start of the table, which read_restore.asm names) and `.D.<line>` for RESTORE targets |

## Strings and constants

A string constant is `DEFW <length>` followed by its bytes (`DEFB`), as the reference emits
it (`print_hello.asm`, `.LABEL.__LABEL0`). REAL immediates are encoded in Locomotive's
5-byte layout (`encodeReal5`, above) and FIXED immediates as 16.16 by the templates.

## DATA

DATA items are encoded for `read_restore.asm`: one type byte (1 string, 2 i8, 3 u8,
4 i16, 5 u16, 6 i32, 7 u32, 8 f16, 9 f) then the value; the table ends with a 0 byte.
A numeric item whose text is not the canonical decimal of its value (`007`, `+5`, `&FF`, an
empty item, every REAL item) has `spelling` (`IrDataItem.spelling`): the table then holds a
spelling entry before the item, type byte 10 and the address of a string constant with the
text as written. A READ into a string variable gives that text; into a numeric variable the
spelling entry is skipped. An empty unquoted item is `i16` 0 with an empty spelling; an
integer item outside 32 bits is an `f` item. The IR dump appends ` spelling "<text>"` to the
`data` line.
How a raw Locomotive DATA item becomes a typed entry is decided in L4 ("DATA and READ")
and implemented in `src/ir/lower/data.ts`.

## The `--stage ir` dump

Deterministic text, one item per line, no spans (`ir/print.ts`; the snapshot in
`ir/__snapshots__/kit.test.ts.snap` covers every quad kind).

- `main` introduces the main program, `proc <label> stdcall|fastcall (<params>) [-> <type>]`
  each procedure (a blank line before it); a parameter is `<type> [ix+4]`, or
  `<type> [[ix+4]]` for BYREF.
- Quads are indented two spaces: `op.type dst, a, b`. Labels are at column 0 as `label:`.
  `cast` is `cast.<to><-<from> dst, a`; `jtable` is `jtable a, [l1, l2]` (`jtable.gosub`
  for ON GOSUB); `call` is `call _F, <argBytes> [-> <type> <dst>]`, `rtcall` likewise
  without the byte count; `leave <argBytes> stdcall|fastcall`; `aaddr` ends with the
  dimension count; each ASM line is `asm "<text>"`; `stmt` is `; line 10` or `; stmt`;
  `comment` is `; text`.
- Operands: `#5` (imm), `t3` (temp), `_score` (global), `[ix+4]` / `[ix-2]` (frame),
  `[[ix+4]]` (byref), `@label` / `@label+2` (addr), `@[ix-2]` (frameaddr), `s0` (strconst).
- After a blank line each: `global <label> <type> size=N [dims=[..]] [at=N] [init=<hex>]`,
  `string s<id> <label> "<bytes>"` (non-printable bytes as `\xNN`),
  `data <label|-> <type> <value>`, `require "<file>"`, `init <label>`.

Sample (`PRINT` of a sum, then a FUNCTION):

```
main
  ; line 10
  load.i16 t0, _score
  load.i16 t1, [ix-2]
  add.i16 t2, t0, t1
  store.i16 _score, t2
  param.i16 #1
  call _Twice, 2 -> i16 t3
  store.i16 _score, t3
  end #0

proc _Twice stdcall (i16 [ix+4]) -> i16
_Twice:
  enter 2
  load.i16 t0, [ix+4]
  store.i16 [ix-2], t0
  ret.i16 [ix-2], _Twice__leave
_Twice__leave:
  leave 2 stdcall

global _score i16 size=2
```

The `[ix-2]` in `main` above only shows the operand syntax; main has no frame, so lowering
never gives it `frame` operands.

Verifier conventions: a quad pops its operands from the right (`b` before `a`; for `poke`,
`out` and `astore` the value `b` before the address `a`), so for `add t3, t1, t2` `t1` is
pushed first. `aaddr` pops its `dims` index temps without naming them. A `fparam` must be
the quad directly before its `call`/`rtcall`.

## Optimisation

The contract of the optimiser (phase L5; L5-0, 2026-11-11). L5-PEEP, L5-TEMPS, L5-STRIP, L5-IR, L5-CG, L5-HOT and L5-FLOW implement it. A change to anything below is
a contract change: the task stops and reports it, and the wave's reviewer decides. The code is `src/opt/index.ts` (the
levels, the pass lists and the hooks) and the protocol types in `src/codegen/types.ts`.

### The pipeline

```
IR (lowered, verified; the `ir` dump)
 └─ IR stage      src/ir/opt/   L5-IR    per procedure; the verifier runs after every pass
generate          src/codegen/  L5-TEMPS register forms and compare-and-branch (the template-operand protocol, below)
                                L5-CG    the template style of the level (base, fast, short)
code stage        CodeUnit[]    L5-PEEP  the fork's rules (OLEVEL <= 2), unused labels, our own rules
                                L5-FLOW  -O3 only: basic blocks, CPU state, OLEVEL 3/4 rules
                                L5-CG    -Os: the helper calls, then `jr` (last: it measures distances)
AsmProgram --link--> LinkedAsm
 └─ link stage                  L5-STRIP unreferenced runtime and library chunks dropped
assemble, layout check, pack
```

The hooks are one call each: `pipeline.ts` calls `opt.ir(ir)` after the `ir` dump and `opt.link(...)` between `link` and
`assemble`, and passes `opt.codegen(target)` to `generate` (`GenerateInput.opt`), whose driver runs the code stage over
every unit once all are emitted (`runCodePasses`). `makeOptimizer` builds the three for one compile. Passes register in
`IR_PASSES`, `CODE_PASSES` and `LINK_PASSES` (one appended line per task) and run in their `order` slot, then by name:

| Stage | Slot | Pass (task) |
|---|---:|---|
| IR | 100 | constant and copy propagation (L5-IR) |
| IR | 200 | repeated subexpressions in a statement (planned, `ir-cse`: not registered; follow-up 193) |
| IR | 300 | cheaper equivalents (L5-IR) |
| IR | 400 | dead code, unused temps (L5-IR) |
| code | 100 | `peephole`: the rules, unused-label removal, the second round (L5-PEEP) |
| code | 300 | `flow` (planned: L5-FLOW, -O3, moved to L7; not registered) |
| code | 800 | `tailmerge` (L5-CG, -Os) |
| code | 900 | `jr` (L5-CG, -Os) |
| link | 100 | `strip` (L5-STRIP) |

An **IR pass** returns a new `IrProgram` and changes only `main` and the procedure bodies (`globals`, `strings`, `data`,
`requires`, `inits` and the procedure headers pass through), and it is target-independent (it gets no `Target`). The
verifier runs after it; a failure is E001 naming the pass, and the IR before the pass is used. The `ir` dump shows the
lowered IR of the level, before the IR stage. From `-O1` only the argument parking differs from `-O0`: a call with value
arguments parks fewer of them in spill slots (`minimalSpills`, `ir/lower/proc.ts`). The `-O1`, `-O2`, `-O3` and `-Os` dumps are equal
to each other (`test/opt-studio.test.ts` checks it); a
compile that stops after the `ir` dump runs no IR pass. L5-IR adds `--stage ir-opt`, the IR after the IR stage. A **code pass** returns new units and never changes a unit's `quads`. A **link
pass** gets the linked text before assembly; if it needs symbols it assembles in its own `SourceSet`, and if `assemble`
must honour something new (L5-STRIP's chunks to drop), its owner adds an optional field to `LinkedAsm` and to the
assembler's options together, absent meaning today's behaviour.

### Levels

| Level | `LevelSpec` | Passes |
|---|---|---|
| `-O0` | nothing | none: RC3's output, byte for byte. `generate` gets no options |
| `-O1` | `registerTemps`, `peephole: 1`, `strip` | L5-TEMPS, the OLEVEL 1 rules and our level-1 rules, L5-STRIP |
| `-O2` | `-O1` + `peephole: 2`, `unusedLabels`, `irPasses`, `style: 'fast'` | + L5-IR, the OLEVEL 2 rule, unused-label removal and the second round, the fast templates. **The default.** |
| `-O3` | `-O2` + `flow` | + L5-FLOW (planned, L7). Until it is registered no pass reads `flow`, so `-O3` builds `-O2`'s image byte for byte |
| `-Os` | `-O2` with `style: 'short'`, `sizeRules` | `-O2`'s passes, the short templates, the `-Os` helpers, `jr`, size-only rules; not L5-FLOW |

Passes read the `LevelSpec`, never the level, so `-Os` is "-O2 with short templates and size rules". `-Os` may cost up to
about 15 % of `-O2`'s speed on the speed set (question 2), reported per benchmark.

**Options.** The CLI takes `-O0` .. `-O3`, `-Os` and `-O s`; the library's `CompileOptions.optimize` takes
`0 | 1 | 2 | 3 | 's'`, absent meaning `-O2`; another value is **E570** (the CLI's own check is a usage error, exit 2).
`--opt-disable NAME[,NAME]` (`optDisable`, repeatable) turns off passes, rules or features by name, to bisect a failing
diff; an unknown name is **E571**. The names are lower case (`[a-z0-9][a-z0-9_-]*`):

| Name | What it turns off |
|---|---|
| `temps` | register temps (the template-operand protocol); also turns off `cmpjump` |
| `cmpjump` | compare-and-branch and condition fusion |
| `templates` | the level's template style: back to `base` |
| `peephole` | the whole rule engine (L5-PEEP); a single rule by its file's stem, `000_o1_push_pop`, `504_add_hl_1` |
| `labels` | unused-label removal (L5-PEEP; the second round still runs) |
| `ir-const`, `ir-copy`, `ir-strength`, `ir-dead` | the IR passes (L5-IR; each pass picks one of these names). `ir-cse` is planned (follow-up 193) and is E571 until its pass is registered |
| `tailmerge`, `jr` | `-Os` shared exit sequences and `jr` (L5-CG). `os-helpers` is not a name: the helper-call forms listed under "`-Os`" were measured and not adopted (follow-up 196) |
| `strip` | runtime stripping (L5-STRIP) |
| `flow` | planned: the flow optimiser (L5-FLOW, moved to L7). E571 until its pass is registered |

`optNames()` lists what the registered passes accept; a task that adds a pass or rule adds its name here.
`--opt-trace` (`optTrace`) makes each code pass write a comment line `\t; opt <name>: <what>` (for example
`\t; opt 000_o1_push_pop: push hl / pop hl`) after the lines it changed, so the `--asm` output shows what fired and the
hit counts of a run are a count of those lines (the size set's `--opt-trace` totals). IR passes count their changes in
the same form in the `ir-opt` dump (`--stage ir-opt --opt-trace`), where the lines (`; opt ir-strength: <quad> -> <quad>`)
sit **at the end of the dump**, after the globals, in the order the passes made them: a changed quad has no place for a
comment line next to it (a `comment` quad would break L5-TEMPS's register hand-over and change the image; R19, follow-up
195c). The image never changes with `--opt-trace`.

### The rules every pass keeps

**Globals are memory.** A store to a global, to an `addr` operand or through a pointer is never removed. At `-O1`, `-O2`
and `-Os` no value read from memory is reused across a statement boundary: a *memory fact* ("register or temp X holds the
value at Y") dies at the next `stmt`. Inside a statement, these quads kill every memory fact (globals, `addr` operands and
frame slots alike), because a callee, an ASM block, a handler or a pointer can change any of them:
`call`, `rtcall`, `gosub`, `asm` (internal or user), `poke`, `astore`, `in`, `out`, and any quad whose `dst` is a BYREF
`frame` operand. A `store` to a global kills the facts about every operand with the same label, whatever the offset
(em00k's bug 4: `_x` and `_x-1` overlap); a `store` to a frame slot kills the facts about every slot it overlaps. Temps
are not memory (they never live past their statement).
*Offsets outside the variable (R17).* An operand `label+k` whose bytes are not all inside that label's own object (its size
in `globals` or `data`) can be another variable's cells: `@n0 + 3` is `n1`'s high byte when the two are declared together,
and Locomotive programs poke their globals this way. A store to such an operand kills every memory fact, as a store through
a pointer does, and a fact about such an operand dies at every store to any global. A pass that cannot tell an operand's
object size treats every non-zero offset this way. (`test/opt-bugs.test.ts`: the rule above without this paragraph is
wrong on `bug/alias-next-variable`; the layer-1 programs `bug/1-pointer-store`, `bug/4-overlap` and that one are in
`test/opt-programs.ts`.) At `-O3`, L5-FLOW may keep a value across statements only inside
one basic block that contains none of the killing quads above and no event poll (`rtcall .core.__EVENT_POLL`).

**Basic blocks.**
- *IR stage* (L5-IR): a block starts at a `label`, a `stmt` or the body's start, and ends after a `jump`, `jz`, `jnz`,
  `jtable`, `gosub`, `retsub`, `end`, `ret` or `leave`, or before the next `label`/`stmt`. Facts about temps and constants
  live within the block; memory facts as above.
- *Code stage* (L5-PEEP): a rule's window is consecutive `code` lines of one unit. No window contains a `boundary` or an
  `opaque` line, and no window ends directly before an `opaque` line (an ASM block may read any register). Comment lines
  (text starting with `;` after the tab) are skipped by the matcher and kept in place. A label line is in a window only
  where the rule's pattern names a label.
- *-O3* (L5-FLOW): classic basic blocks over the code lines of a unit (a label starts one; a jump, `ret`, `call`, `rst` or
  `djnz` ends one). An `opaque` line ends a block and destroys all CPU state. A `boundary` line does not end a block, but no
  fact (a register's value, a memory cell's value) survives it unless the block holds none of the killing quads above and no
  poll; the ESC check's `opaque` lines end the block anyway.

**A dead register.** Several of the fork's rules leave a register holding a different value than before (rules 005, 006,
009, 016, 030, ...). That is safe only where nothing reads it, which in cpcbas's code is: after the last line of a
`store`, `poke` or `astore` quad, at a jump (no temp or register value crosses a jump), and after a `call`/`rtcall` that
returns nothing. A rule that kills a value checks that its window ends at one of these points (`CodeLine.quad` gives the
quad of each line), or that the next instruction overwrites the register.

**Labels.** No IR pass removes a `label` quad. A label named in the text of an `asm` quad, internal or user, counts as
referenced (follow-up 74: the RESUME NEXT point `.T.b` of the error mark). Dead code is the code between an unconditional
`jump` (or `end`, `retsub`, `ret`, `leave`) and the next label, and nothing else. In the code stage, unused-label removal
(`-O2`, `-Os`, `-O3`) removes only generated `.T.<n>` labels that no other line of the whole AsmProgram names (main,
procedures, data, constants, `code` and `opaque` lines alike); line labels (`.L.*`), procedure labels, `__leave` labels,
`.S.*`, `.D.*` and every label of the map that the Studio reads stay.

**Statement boundaries stay where they are.** The `stmt` quads, the code the `stmt` template emits (the ESC check), the
event poll (`rtcall .core.__EVENT_POLL`), the error mark (`label` + three internal `asm` lines) and `erlEnd`'s label, and
every `#line` line, stay in place and in order. The poll's `call` is a `code` line, not `opaque` (R17): no code-stage rule
deletes or moves a `call` line, or moves another line across one (the fork's 028 already excludes `call`; a rule that would
needs the poll tagged first). No code moves across a `boundary` line, so ON ERROR, RESUME, ON BREAK and
EVERY/AFTER see the same statement starts at every level. IR passes keep every `stmt` quad and the quads that
`statementStart` and `statementEnd` emit.

**ASM blocks are opaque.** User and internal `asm` quads alike (the conservative choice: internal lines read flags and
registers that the templates set, LOCATE's `jr nc`, and hold data, the mark's `defw`). Their lines are `opaque`: no rule
matches inside one or across its edges; it reads and writes every register and all memory; every label and global it
names is referenced. A SUB, FUNCTION or global named only inside ASM is kept by every pass that removes things.
R17 kept this for waves 1-3: the internal sequences sit at statement edges (the error mark after the boundary and the poll,
LOCATE's check after its call, the DATA error, a FUNCTION's register save), where a window is cut by a `boundary` anyway,
so making them transparent would gain little and needs a per-sequence reading of what each one reads. L5-PEEP reports how
many candidate windows an internal `opaque` line refused over the size set; R18 revisits this only if that count matters.

**The procedure contract.** STDCALL and FASTCALL frames, `argBytes`, the frame layout and `enter`/`leave`'s register
behaviour are unchanged at every level. No local slot is removed, moved or narrowed, even when no BASIC code reads it (an
ASM block may address `(ix-n)`).

**Determinism.** No pass iterates over an unordered collection where it affects output; the same input gives the same
bytes at every level, on every host.

**`-O0` is RC3's compiler.** `makeOptimizer` gives `generate` no options at `-O0`, so the templates' stack forms and
`base` style are all that run. Tests that pin bytes (image identity, codegen snapshots, hashes) build at `-O0` explicitly
(`optimize: 0`, or `generate` without `opt`); `src/opt/index.test.ts` checks that every level builds `-O0`'s image while a
level has no pass.

### The template-operand protocol (L5-TEMPS)

`src/codegen/types.ts`: `TempForm`, `STACK_FORM`, `RegisterForms`/`RegisterFormTable`, `CompareJumpTemplate`/
`CompareJumpTable`.

- **The stack form is unchanged.** A template is `(q, ctx, form?)`; without `form` (or with `STACK_FORM`) it emits
  exactly its RC3 lines. Wrappers such as int.ts's `checkFrameOperands` loop pass `form` through.
- **The hand-over.** The driver decides each quad's form with one quad of look-ahead: quad i hands its result to quad i+1
  when i's `dst` is a temp t, i+1 is the next quad of the body (nothing between, not even `comment`), t is the operand i+1
  pops first (`b` if `b` is a temp, else `a`; `poke`, `out`, `astore` the same; `aaddr`'s `dims` never), both keys allow it
  in the `RegisterFormTable`, the level has `registerTemps`, and `temps` is not disabled. Quad i then gets
  `resultInRegs: true` and omits its push; quad i+1 gets `inRegs: 'a'` or `'b'` and omits that pop. A quad can be both
  (`load`, `add`, `store` in a chain). The verifier's LIFO rule guarantees that t is i+1's first-popped operand whenever
  i+1 uses it at all.
- **The result registers** are those of docs/ir.md "Types": A (`u8`, `i8`), HL (`u16`, `i16`, `str`: an owned temp stays
  owned), DEHL (`u32`, `i32`, `f16`), A E D C B (`f`). Nothing else is handed over: no other register, no flag, nothing in
  the alternate set. A template that wants the operand elsewhere moves it itself (`ex de, hl` for b in DE, `ld b, a`,
  `exx`). The stack below is what the stack form would see after that pop.
- **Which templates offer a register form** (wave 1; a key outside the table keeps the stack form):

  | Must (L5-TEMPS) | result | operand |
  |---|---|---|
  | `load` u8 i8 u16 i16 u32 i32 f f16 | yes | - |
  | `store` same types | - | a |
  | `add sub and or xor` u8 i8 u16 i16 | yes | a, b |
  | `eq ne lt le gt ge` u8 i8 u16 i16 (when not fused) | yes | a, b |
  | `neg not` u8 i8 u16 i16; `cast` between integer types | yes | a |
  | `peek`, `poke` integer types | yes / - | a / a, b |
  | `jz jnz` u8 i8 u16 i16 | - | a |
  | `fparam`, `param` every type | - | a |
  | `call`, `rtcall` with a result (flow.ts) | yes | - |
  | `ret` (flow.ts) | - | a |
  | `add sub mul div` f (CALLEE: b arrives in A E D C B, a stays pushed) | yes | b |
  | `aaddr` / `aload` / `astore` (array.ts; added to L5-TEMPS's files) | yes / yes / - | - / a / a, b |

  *Should* (if the table shows them): the 32-bit arithmetic and compares, `mul`/`div`/`mod`/shifts of 8 and 16 bit,
  `concat` and the `str` loads and stores, `jtable`, the casts with `f` or `f16`. Each register form is tested in the
  simulator against the stack form.
- **Compare-and-branch.** Quad i a comparison with `dst` t, quad i+1 `jz`/`jnz` with `a` = t: when the key
  `cmpjump:<op>:<type>` exists (type = the comparison's operand type), the pair is one template call
  `(cmp, { when, label }, ctx, form)` with `when` `'false'` for `jz` and `'true'` for `jnz`. No boolean is made; the
  sign and overflow handling stays as in the `lt`/`gt` templates (`jp po` / `xor 128` for signed types). Must: the six
  ops on u8 i8 u16 i16. Should: u32 i32, f, str. `--opt-disable cmpjump` emits the pair as two quads.
- **Conditions** (optional in L5-TEMPS). A *condition* is a comparison, `not.i16` of a condition, or `and.i16`/`or.i16`
  of two conditions; its value is exactly -1 or 0, so Locomotive's bitwise AND/OR/NOT equal the logical ones. When a
  condition tree's root is tested by the next `jz`/`jnz`, the driver may emit it as branches: `c1 AND c2` with `jz L` is
  "c1 false: to L; c2 false: to L"; `c1 OR c2` with `jz L` is "c1 true: to S; c2 false: to L; S:" (S from
  `ctx.newLabel`); `jnz` and NOT mirror these. This skips c2's code when c1 decides, so it is allowed only when every quad
  of c2 (from the quad after c1's comparison to c2's comparison) is *pure*: `load` of a numeric operand, `add sub mul and
  or xor not neg shl shr` and comparisons of integer types, `cast` between integer types, `peek`, `aaddr` and `aload` of a
  numeric type (bounds are not checked, spec section 8; if they ever are, `aaddr` leaves this list). Never pure: `div`,
  `mod` (error 11), anything on `f`, `f16` or `str` (errors, heap), `call`, `rtcall`, `param`, `fparam`, `asm`, `in`,
  `out`, `poke`, `store`. A FUNCTION call operand therefore keeps the plain form.

### The rule files (L5-PEEP)

The rule language is the fork's (`REPLACE`, `WITH`, `IF`, `DEFINE`, `$n`, `OLEVEL`, `OFLAG`), ported with its engine to
`src/opt/peephole/`. The rule files live in `src/opt/peephole/rules/*.opt`; `tools/gen-rules.mjs` compiles them into
`rules.gen.ts` (the library reads no file), and `npm test` checks that the generated file is up to date, as
`firmware.gen.ts`. The fork's `.opt` files carry no licence header of their own (they inherit the fork's); a ported file
starts with the project's SPDX line, the fork's copyright line, and a line naming its source:

```
;; SPDX-License-Identifier: AGPL-3.0-or-later
;; © Copyright 2008-2024 José Manuel Rodríguez de la Rosa and contributors.
;; See the file CONTRIBUTORS.md of zxbasic (https://github.com/boriel-basic/zxbasic) for copyright details.
;; Ported from zxbasic src/arch/z80/peephole/opts/000_o1_push_pop.opt at e33cf0cd (cpcbas L5-PEEP; changes: none).
```

The copyright line is the fork's own, word for word (its `.py` files carry it; R17), and the source line names the fork's
commit the rule was read at (`e33cf0cd`, branch `cpc-arch`; the rule files are unchanged there since 2026-07-05). A rule
changed in the port says what changed (`changes: the IF of 022 keeps or a after cp; ...`). `rules.gen.ts` starts with the
same SPDX line and a comment that it holds the rules of `rules/*.opt`, ported and our own, and is generated.

Our own rules carry our header and are numbered from 500 (`5nn_<what>.opt`); the fork's numbers stay. A rule's
`--opt-disable` name is its file's stem. The fork's 52 files were classified in L5-0.

### `-Os` (L5-CG)

The short forms are chosen by `ctx.style === 'short'` in the templates and by size-only passes. Each one is adopted only
if it saves bytes over the size set (`size-diff.py --cpcbas-O 2,s`) and keeps `-Os` within about 15 % of `-O2` on the
simulator kernels (`bench/speed.py --sim`); L5-CG reports both per form.

- **Short templates.** The REAL operand moves become helper calls in `lib/loco/oshelp.asm` (linked through
  `ctx.requires.call`, so only when used): a REAL load from a label `ld hl, x / call .core.__OS_FLD` (6 bytes against 11),
  a store `ld hl, x / call .core.__OS_FST` (6 against 11), a frame load or store with an inline offset byte
  `call .core.__OS_FLDIX / defb d` (4 against 15), and the push of a REAL operand that is not a temp (`pushOperandF`,
  12-19 bytes) through one helper per operand kind. The signed 8- and 16-bit comparison tail (`ld a, h / jp po, L /
  xor 128 / L: rlca / sbc a, a`, 8 bytes) becomes a helper that returns the flags. The STDCALL `leave` with arguments
  (7-11 bytes) jumps to one shared exit per argument count. The 16-bit frame load `ld l, (ix+d) / ld h, (ix+d+1)`
  (6 bytes) is a candidate only (`call` + `defb`, 4 bytes, about 60 T-states slower).
- **`jr` where it reaches.** Decided in the code stage, as the last pass (slot 900), not by the assembler. Each code line
  is sized exactly with the assembler's instruction table (`src/asm/z80`: an instruction's size never depends on a symbol's
  value); a `jp`, `jp z`/`nz`/`c`/`nc` whose target label is in the same unit becomes `jr` when every line between them is
  sized and the distance fits -126..+129 from the jump; a span that holds a line the table cannot size (an `opaque` line
  that is a directive, an `INCLUDE`, a macro) keeps `jp`. The pass repeats until nothing changes: distances only shrink, so
  a converted jump stays in range. `jp po/pe/p/m` have no `jr` form.

**What L5-CG did (2026-11-12).**
- `jr` as designed (`src/opt/jr.ts`, sizing by `src/opt/z80size.ts`).
- `tailmerge` (slot 800, `src/opt/tailmerge.ts`): runs of instructions ending in `ret`/`jp L`/`jr L`/`jp (hl)` that share a tail of identical
  instructions keep one copy (the middle one of the group, with a label) and the others `jp` to it. This is the "shared exit
  sequences": the STDCALL `leave`, `RETURN "text"`'s store-and-jump, the error-11 tails. A tail never holds a label, `boundary`,
  `opaque` line, an instruction the table cannot size, or the event poll's `call`. **It deletes `call` lines of the sites that jump
  to the kept copy** (the call still runs from every path), so the "no code-stage rule deletes a `call` line" rule is kept for the
  poll only at `-Os`; `peephole.test.ts` checks that the poll calls are the same at every level and that every `-Os` call is one of
  `-O0`'s. This refines a R17 rule: R19 to confirm.
- The REAL operand helpers (`__OS_FLD` and the rest of the list above) and the signed compare tail helper were **not adopted**: over
  the size set a REAL pushed from a label is 27 sites, a REAL store 57 and `jp po` 130, 5 and 3 bytes saved each less the helpers
  (about 0.03 % of the image) against the speed they cost; follow-up 196.
- Templates (`ctx.style` `fast` or `short`; `base` is -O0 and -O1): constant shifts by whole-byte moves, rotate-and-mask and the cheapest
  unrolled or looped bit steps, costed with the assembler table (`codegen/shift.ts`; `short` takes the fewest bytes, `fast` the least
  T-states + 8 x bytes); no run-time zero test for an immediate divisor; a plain 32-bit `b` of an add, sub, logic or comparison is read
  through BC (follow-up 184); an 8-bit comparison against an immediate uses the instruction's operand (`xor 5`, `cp 5`);
  a condition tree behind `jz`/`jnz` that cannot be branched (an impure operand) is evaluated as 8-bit booleans (`codegen/cond.ts`
  `BoolStep`: A holds 0/-1, a left operand waits as `push af`, `pop bc / or b`, one `or a / jp` at the root; an OR chain of `<> 0`
  tests ORs the raw values). The planner now counts a call's `param`/`fparam` quads as part of the leaf (this also lets `-O1` branch
  a tree whose first operand is a call with arguments).

### What the passes report

Every task that changes generated code reports the size table's change for its own pass
(`size-diff.py --cpcbas-O 2,s --json` against the merge base), the simulator T-states (`bench/speed.py --sim`), the
differential tests (layers 1 and 2), and its rules' hit counts on the size set (the `--opt-trace` totals). The Studio's
outputs hold at every level: the map has every user global, procedure and line label of the `-O0` map, every `#line` in
`--asm` names a real source line, the JSON diagnostics are `-O0`'s, and the `--stage` dumps work (`test/opt-studio.test.ts`,
L5-DIFF).

**The image is the `--asm` text assembled** (R17). Layers 1 and 2 (`test/opt-harness.ts`) run the `--asm` text of each
level, re-assembled, so they test the program `compile()` builds only while that holds; `opt-harness.test.ts` checks it at
every level. A pass that changes the image without changing the text (L5-STRIP's chunks to drop, given to the assembler)
must make the harness run `compile()`'s image instead, in the same change.
