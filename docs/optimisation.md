# Optimisation

cpcbas has five optimisation levels. They trade compile-time work for smaller
and faster programs, and none of them changes what your program does.

This page says what each level does, what never changes at any level, how to
narrow down a suspected optimiser bug, and how the output compares with the
frozen Boriel fork (the fork, for short).

## Choose a level

```
cpcbas -D CPC6128 -O2 -o game.dsk game.bas
```

| Option | What it is for |
|---|---|
| `-O0` | No optimisation. The plainest code the compiler makes. Use it to check that a problem is not the optimiser's. |
| `-O1` | Register temporaries, compare-and-branch, the first set of peephole rules, and removal of unused runtime code. |
| `-O2` | Everything in `-O1`, plus IR passes, the second set of peephole rules, removal of unused labels and faster code templates. **The default.** |
| `-O3` | Today the same code as `-O2`. See "What `-O3` is for". |
| `-Os` | `-O2` with the shortest code templates and size-only passes. Smallest programs. |

You can also write `-O s`. Any other level is a usage error (exit code 2).
Leave `-O` out and you get `-O2`.

### What each level does

- **`-O0`** runs no optimiser pass. Every statement is compiled with the plain
  stack-based code.
- **`-O1`** hands temporary values over in registers instead of the stack and
  joins a comparison to the jump that uses it. The peephole pass rewrites short
  instruction sequences (for example `push hl` followed by `pop hl`), and the
  link step drops runtime and library routines that nothing calls.
- **`-O2`** adds four passes on the compiler's intermediate form: constant and
  copy propagation, cheaper equivalents (for example a shift for a multiply by
  a power of two) and removal of dead code. It also adds the second set of
  peephole rules, removes labels that nothing jumps to, and picks the faster
  code for shifts and similar operations.
- **`-Os`** runs the same passes as `-O2`. It picks the shortest template where
  `-O2` picks the fastest. It turns a `jp` into a `jr` wherever the target is
  in range, and it shares identical exit sequences between procedures.

### What `-O3` is for

`-O3` is accepted, and today it builds the same program as `-O2`, byte for
byte. It is kept for a flow optimiser that a later version will add. Until
then there is no reason to use it. If you do, you lose nothing.

## What `-Os` costs

`-Os` makes programs smaller than `-O2` at a small cost in speed.

- **Size.** Over 152 builds (78 firmware and 74 bare-metal test and library
  programs), `-Os` images total 1 261 502 bytes against 1 273 184 at `-O2`: 11 682
  bytes, or 0.92 %, smaller. The saving is 0.3 % to 1.0 % on the test programs
  and 2.2 % to 2.3 % on the game-sized program, Lamplighter.
- **Speed.** On an emulated CPC 6128 the benchmark programs below take the same
  ticks at `-Os` as at `-O2`, except the sieve, which is 2 ticks faster. On exact
  Z80 timings of four small kernels `-Os` is 0.04 % to 0.51 % slower.
- **Lamplighter.** At `-Os` the builds `lamp464`, `lampplus` and `lamppluc` are
  26 509, 29 748 and 30 041 bytes against 27 155, 30 435 and 30 721 at `-O2`. On
  the speed test (250 steps, no frame pacing, CPC464) the game takes 430 frames
  at `-Os` and 427 at `-O2`.

Use `-Os` when memory is tight. Use `-O2` when you want the default.

## What never changes

Every level produces a program with the same visible behaviour as `-O0`. These
rules hold at every level.

- **Output.** Screen, sound, files, errors and the values of your variables are
  the same. The test suites compare every level against `-O0` on emulated CPCs.
- **Statement boundaries.** Each statement still starts where it did. The
  ESC check, the poll for `EVERY` and `AFTER`, the marks `ON ERROR` and
  `RESUME` use, and the line numbers in the `--asm` output stay in place and in
  order. An event, a break or an error is seen at the same statement at every
  level.
- **ASM blocks are not touched.** The optimiser does not rewrite inside an
  `ASM` block or move code across its edges. It assumes the block reads and
  writes every register and all of memory. A SUB, FUNCTION or variable that is
  named only inside an `ASM` block is kept.
- **Globals live in memory.** A store to a global variable is never removed, and
  a value read from memory is not reused across statements. A call, an `ASM`
  block, an event handler or a pointer can change a global at any time.
- **Every variable is in the memory map.** The `-M` map lists every global,
  procedure and line label at every level. (A SUB or FUNCTION that nothing
  calls is left out at every level, `-O0` included, with warning W306.)
- **Procedure calls keep their shape.** Frames, argument layout and the order in
  which arguments are evaluated are the same. One rule for `ASM` procedures: an
  8-bit parameter is pushed as a word whose high byte is the value. The low byte
  is undefined.

`--opt-trace` never changes the image. It only adds comments to the `--asm`
output.

One thing does differ at `-O0`: a `BEEP` with run-time values calls a shared
routine at every level, `-O0` included, instead of working out the note inline.
The sound is the same, and the program is smaller.

## Report a suspected optimiser bug

If your program works at `-O0` and goes wrong at `-O2`, you may have found a
bug in the optimiser. Two options help you narrow it down.

- `--opt-disable NAME[,NAME]` turns off optimiser passes, rules or features by
  name. You can repeat it. An unknown name is error E571.
- `--opt-trace` writes a comment `; opt <name>: <what changed>` into the
  `--asm` output after each place where a pass changed the code.

### The names

| Name | What it turns off |
|---|---|
| `temps` | Register temporaries (also turns off `cmpjump`) |
| `cmpjump` | Compare-and-branch and condition fusion |
| `templates` | The level's template style (back to the plain `-O0` form) |
| `ir-const`, `ir-copy`, `ir-strength`, `ir-dead` | The four IR passes of `-O2` and above |
| `peephole` | The whole peephole pass |
| `labels` | Removal of unused labels |
| `strip` | Removal of unused runtime and library code |
| `tailmerge`, `jr` | The two `-Os` size passes |
| a rule name | One peephole rule, named by its file: `003_o1_useless_jp`, `504_add_hl_1` and so on |

The `--opt-trace` comments show rule names, so you can copy one straight
into `--opt-disable`. `cpcbas --help` lists the options.

### A worked example

Say `game.bas` draws the wrong thing at `-O2` and the right thing at `-O0`.
Check that the level is the cause:

```
cpcbas -D CPC6128 -O0 -o good.dsk game.bas
cpcbas -D CPC6128 -O2 -o bad.dsk  game.bas
```

Turn off one group at a time at `-O2` and run the result each time:

```
cpcbas -D CPC6128 -O2 --opt-disable ir-const,ir-copy,ir-strength,ir-dead -o t1.dsk game.bas
cpcbas -D CPC6128 -O2 --opt-disable peephole -o t2.dsk game.bas
cpcbas -D CPC6128 -O2 --opt-disable temps -o t3.dsk game.bas
cpcbas -D CPC6128 -O2 --opt-disable strip -o t4.dsk game.bas
```

Say turning off `peephole` fixes it. Now find the rule. Write the trace:

```
cpcbas -D CPC6128 -O2 --opt-trace --asm game.s -o game.dsk game.bas
```

Open `game.s` and search for `; opt`. The lines look like this:

```
	; opt labels: .T.6
	; opt 003_o1_useless_jp: jp _Best__leave / _Best__leave:
```

Turn off the rule you suspect:

```
cpcbas -D CPC6128 -O2 --opt-disable 003_o1_useless_jp -o t5.dsk game.bas
```

When the program is right again, you have the culprit. Send us:

- the smallest `.bas` file that shows the problem;
- the command that fails and the `--opt-disable` command that fixes it;
- the `; opt` line of the rule.

The IR passes write their trace lines at the end of the IR dump instead:
`cpcbas -O2 --stage ir-opt --opt-trace game.bas`.

## Size and speed against the fork

These figures compare cpcbas with the fork at the fork's default level, `-O2`.
Programs are test and library programs that both compilers build, plus
Lamplighter. Sizes are image bytes.

### Size

Sum of the images at each level. Lower is better.

| Programs | Build | Fork `-O2` | cpcbas `-O0` | `-O1` | `-O2` | `-O3` | `-Os` |
|---|---|---:|---:|---:|---:|---:|---:|
| 78 | firmware | 773 954 | 689 444 | 545 212 | 540 875 | 540 875 | 534 513 |
| 74 | bare-metal | 948 505 | 891 935 | 736 357 | 732 309 | 732 309 | 726 989 |

At `-Os`, cpcbas images total 239 441 bytes fewer than the fork's in firmware
builds (about 31 % smaller) and 221 516 bytes fewer in bare-metal builds (about
23 % smaller).

Counted program by program, at `-Os`:

- **Firmware builds: no program is larger than the fork's.** One program,
  `input`, is 1 847 bytes larger (3 116 in bare-metal). We list it apart and do
  not count it against the target.
- **Bare-metal builds: one program is larger than the fork's.** It is
  `bare_sound`, a bare-metal test program for the sound chip and `BEEP`: 8 384
  bytes against 7 955, which is 429 bytes (5.4 %) more. This is the one target
  we do not meet. The biggest causes are procedure frames (cpcbas gives every
  procedure a frame; the fork gives none to a small procedure without parameters
  or locals), 32-bit local variables and 32-bit arithmetic in the main program.
  We have not planned a fix for this program alone.
- **Lamplighter** is smaller than the fork's in every build at `-Os`: 240 bytes
  under for `lamp464` and `lamp6128`, 757 under for `lampplus` and 15 under for
  `lamppluc`.

At `-O2`, three of the four Lamplighter builds are larger than the fork's:
`lamp464` and `lamp6128` by 406 bytes and `lamppluc` by 665. If size
matters to you, use `-Os`.

### Speed

Time on an emulated CPC 6128, in ticks of the 300 Hz firmware counter. Lower is
better. The last column is cpcbas at `-O2` divided by the fork at `-O2`: below
1 means cpcbas is faster.

| Program | Fork `-O2` | cpcbas `-O0` | `-O1` | `-O2` | `-Os` | `-O2` / fork |
|---|---:|---:|---:|---:|---:|---:|
| BM7 | 347 | 514 | 457 | 357 | 357 | 1.029 |
| integer loop | 48 | 73 | 44 | 44 | 44 | 0.917 |
| sieve | 392 | 470 | 390 | 390 | 388 | 0.995 |
| float | 11 039 | 2 684 | 2 676 | 2 676 | 2 676 | 0.242 |
| strings | 989 | 1 015 | 981 | 981 | 981 | 0.992 |
| screen PRINT | 2 983 | 4 333 | 4 124 | 4 100 | 4 100 | 1.374 |
| game-shaped, part 1 | 11 658 | 3 901 | 3 888 | 3 888 | 3 888 | 0.334 |
| game-shaped, part 2 | 7 633 | 5 828 | 5 670 | 5 667 | 5 667 | 0.742 |

In plain terms:

- Integer, string and BM7 programs run within 3 % of the fork's speed, or
  faster. Every program gives the same checksum as the fork's at every level.
- Float programs are much faster: the `float` program takes 2 676 ticks against
  the fork's 11 039.
- Printing to the screen is slower than the fork's: 4 100 ticks against 2 983.
  We have not tuned `PRINT` yet.
- `-O2` matters most for BM7: 457 ticks at `-O1`, 357 at `-O2`.

Lamplighter, run for 250 steps with frame pacing switched off on an emulated
CPC464, takes 427 frames at `-O2` and 430 at `-Os`. The fork's build takes 431.

## Where to go next

- [README.md](../README.md) lists every command-line option.
- [docs/keywords.md](keywords.md) says how each statement is compiled.
