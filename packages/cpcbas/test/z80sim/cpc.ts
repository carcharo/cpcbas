/**
 * A fake Amstrad CPC around the test-only Z80 CPU (task L2-Z80SIM): 64 KB of RAM, no ROMs.
 * A `call`/`jp` that reaches the firmware jumpblock (&B900-&BDFF) or a registered address runs
 * a TypeScript handler that returns as `RET` would. Register contracts are from the Amstrad
 * CPC Firmware Guide (SOFT968), "Exit conditions" of each entry: registers the guide says are
 * corrupt are really corrupted (with fixed junk) so code that relies on them surviving fails
 * here as it could on a real machine.
 *
 * Handled entries (anything else in the jumpblock fails the run with its address):
 *   text      TXT OUTPUT &BB5A, TXT GET WINDOW &BB69, TXT CLEAR WINDOW &BB6C, TXT SET CURSOR
 *             &BB75, TXT GET CURSOR &BB78, TXT SET PEN &BB90, TXT GET PEN &BB93, TXT SET
 *             PAPER &BB96, TXT GET PAPER &BB99, TXT INVERSE &BB9C
 *   keyboard  KM WAIT CHAR &BB06, KM READ CHAR &BB09, KM WAIT KEY &BB18, KM READ KEY &BB1B,
 *             KM TEST KEY &BB1E (no key is ever pressed)
 *   screen    SCR SET OFFSET &BC05, SCR SET BASE &BC08, SCR GET LOCATION &BC0B (state only, the
 *             mode clears the offset), SCR SET MODE &BC0E, SCR SET INK &BC32, SCR GET INK &BC35, SCR SET BORDER &BC38,
 *             SCR GET BORDER &BC3B, SCR ACCESS &BC59 (recorded)
 *   graphics  GRA MOVE ABSOLUTE &BBC0, GRA ASK CURSOR &BBC6, GRA SET PEN &BBDE, GRA PLOT
 *             ABSOLUTE &BBEA, GRA LINE RELATIVE &BBF9 (recorded in `gfx`, nothing is drawn)
 *   machine   KL TIME PLEASE &BD0D, MC WAIT FLYBACK &BD19, MC PRINT CHAR &BD2B, KL PROBE ROM &B915
 *             (C = 0 only: H = 0 / 1 / 2 / 4 for the 464 / 664 / 6128 / Plus, L = 1)
 *   sound     SOUND QUEUE &BCAA, SOUND CHECK &BCAD, SOUND RELEASE &BCB3, the two envelope entries &BCBC and &BCBF (sound.ts:
 *             queues, hold, rendezvous and flush on the CPU's clock; nothing is heard)
 *   maths     the REAL entries of the model's table (FWM-SIM, see fwmaths.ts): the 464, 664 and
 *             6128/Plus tables; the measured register corruption
 *             (IX and IY included), interrupts enabled on return, carry set = success, results
 *             from src/core/locoreal.ts or the recorded vectors, and a failure for any pointer
 *             below &4000 (the lower ROM is enabled during a maths call: SOFT968 section 2.4 b)
 *   interrupt the firmware's 300 Hz handler (&B939 on the 464, &B941 on the 6128): entered
 *             through the RAM vector at &0038, it fails the run unless BC' = &7Fxx and AF'
 *             carry is clear (what lib/runtime/fwcall.asm and isr.asm promise it)
 *   L5-SIMFW  the ticker (ticker.ts: KL ADD TICKER &BCE9, KL DEL TICKER &BCEC, KL INIT EVENT &BCEF, TXT STR SELECT &BBB4; event
 *             routines run from the 300 Hz interrupt), the AMSDOS (disc.ts: the CAS entries and KL INIT BACK &BCCE), TXT WIN
 *             ENABLE &BB66, TXT RD CHAR &BB60, TXT CUR ON/OFF, SCR GET/SET FLASHING &BC41/&BC3E, KM GET JOYSTICK &BB24, and the
 *             entries that are only RECORDED in `gfx` (call and the program's own arguments; nothing is drawn or kept):
 *             TXT SET GRAPHIC, SET MATRIX, SET M TABLE, SWAP STREAMS; KM SET EXPAND, TRANSLATE, SHIFT, CONTROL, REPEAT, DELAY;
 *             the other GRA MOVE/PLOT/LINE/TEST forms (a pixel test reads back what PLOT drew), SET ORIGIN, WIN WIDTH/HEIGHT,
 *             CLEAR WINDOW, SET PAPER, and the 664/6128 SET BACK/FIRST/LINE MASK/FILL. The layer 1 and 2 harness compares
 *             `gfx`, the disc's log and its files across levels, as it compares the transcript.
 * Address 0 (`RST 0`, the program's end) stops the run.
 */
import { Z80Cpu } from './cpu.js';
import { PROBE_H, installMaths } from './fwmaths.js';
import type { CpcModel } from './fwmaths.js';
import { Disc, installDisc } from './disc.js';
import { installSoundManager } from './sound.js';
import { FakeTicker } from './ticker.js';

export type { CpcModel } from './fwmaths.js';
export { FwMathError, mathsEntry } from './fwmaths.js';

export class UnhandledFirmwareError extends Error {
  constructor(
    readonly address: number,
    readonly from: number,
  ) {
    super(`unhandled firmware address &${hex4(address)} (called from &${hex4(from)})`);
    this.name = 'UnhandledFirmwareError';
  }
}

export class FirmwareContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FirmwareContractError';
  }
}

const hex4 = (n: number): string => n.toString(16).toUpperCase().padStart(4, '0');

/** Registers a firmware entry was entered with. */
export interface FwIn {
  a: number;
  f: number;
  b: number;
  c: number;
  d: number;
  e: number;
  h: number;
  l: number;
}

/** One firmware call as the handler saw it (for tests of the gate and of call counts). */
export interface FwCall {
  address: number;
  name: string;
  /** BC' and AF' as the firmware found them (the gate's contract). */
  bc2: number;
  af2: number;
  iff1: boolean;
  /** The return address (where the caller continues). */
  from: number;
}

export interface CpcOptions {
  /** T-states between maskable interrupts (default 13333 = 300 Hz at 4 MHz); 0 disables them. */
  irqInterval?: number;
  /** Corrupt the registers the firmware guide says are corrupt (default true). */
  corruptRegisters?: boolean;
  /** Initial BC' (the firmware's gate-array port and ROM/mode word), default &7F8E. */
  firmwareBc?: number;
  /** The machine whose firmware is faked: its maths entry table and KL PROBE ROM answer. Default '6128'. */
  model?: CpcModel;
  /** Fail a maths call whose result is not a recorded one (instead of approximating it); see fwmaths.ts. */
  fwmStrict?: boolean;
}

export const IRQ_INTERVAL = 13333;
export const FRAME_TSTATES = 80000;
/** The VSYNC pulse on PPI port B bit 0: about four lines of 64 us. */
export const VSYNC_TSTATES = 1000;

type RegName = 'a' | 'f' | 'b' | 'c' | 'd' | 'e' | 'h' | 'l';
const AF: RegName[] = ['a', 'f'];
const AFHL: RegName[] = ['a', 'f', 'h', 'l'];
const ALL4: RegName[] = ['a', 'f', 'b', 'c', 'd', 'e', 'h', 'l'];
const AFDEHL: RegName[] = ['a', 'f', 'd', 'e', 'h', 'l'];
const JUNK: Record<RegName, number> = { a: 0xa1, f: 0xd5, b: 0xb1, c: 0xc1, d: 0xd1, e: 0xe1, h: 0x4b, l: 0x4c };

/** Parameter bytes of each control code 0..31 (TXT OUTPUT, SOFT968 appendix VII). */
const CONTROL_PARAMS = [
  0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 9, 4, 0, 3, 2, 0, 2,
];
const MODE_COLS = [20, 40, 80];
const DEFAULT_INKS: [number, number][] = [
  [1, 1], [24, 24], [20, 20], [6, 6], [26, 26], [0, 0], [2, 2], [8, 8],
  [10, 10], [12, 12], [14, 14], [16, 16], [18, 18], [22, 22], [1, 24], [16, 11],
];

export class Cpc {
  readonly cpu = new Z80Cpu();
  /** Every byte sent to TXT OUTPUT, in order. */
  readonly textBytes: number[] = [];
  /** Every byte sent to the printer through MC PRINT CHAR. */
  readonly printerBytes: number[] = [];
  /** Keys KM READ CHAR / WAIT CHAR / WAIT KEY return, first in first out. */
  readonly keyQueue: number[] = [];
  /**
   * Keys typed ahead: released into `keyQueue` by a KM READ CHAR that finds the queue empty
   * (it still reports "none", so the bootstrap's key flush ends; the keys show from the next
   * call) or by a KM WAIT CHAR / WAIT KEY on an empty queue.
   */
  readonly pendingKeys: number[] = [];
  readonly calls: FwCall[] = [];
  /** The faked machine (see CpcOptions.model). */
  readonly model: CpcModel;
  /** Maths calls whose result was approximated rather than recorded (fwmaths.ts). */
  readonly approximations: string[] = [];
  readonly fwmStrict: boolean;
  /**
   * Recorded calls whose effect is not modelled (graphics, screen access, key-manager setters, matrices and the like), one
   * line per call with the arguments that are the program's own (never an address of the program's code or data).
   */
  readonly gfx: string[] = [];
  /** The fake AMSDOS (disc.ts): files by name and a log of the calls. */
  readonly disc = new Disc();
  /** The firmware's ticker (ticker.ts): EVERY and AFTER run their event routines from the 300 Hz interrupt. */
  ticker!: FakeTicker;
  interrupts = 0;
  border: [number, number] = [1, 1];
  /** The screen base (high byte) and offset (SCR SET BASE / SCR SET OFFSET); nothing is drawn. */
  screenBase = 0xc0;
  screenOffset = 0;
  readonly inks: [number, number][] = DEFAULT_INKS.map(([a, b]) => [a, b]);
  /** The flash periods (SCR SET FLASHING). */
  flashing: [number, number] = [10, 10];
  graphicsPen = 1;
  /** What GRA PLOT drew, by position (`x,y` in user units): the one thing GRA TEST can read back. */
  readonly pixels = new Map<string, number>();
  gx = 0;
  gy = 0;

  // text VDU state
  mode = 1;
  /** The lock keys [caps, shift], 0 off or &FF on (KM SET LOCKS, KM GET STATE). */
  locks = [0, 0];
  private cols = 40;
  private readonly grid: string[][] = [];
  private winL = 1;
  private winR = 40;
  private winT = 1;
  private winB = 25;
  private curCol = 1;
  private curRow = 1;
  private roll = 0;
  /** The selected text stream (TXT STR SELECT); recorded only. */
  stream = 0;
  pen = 1;
  paper = 0;
  private vduOn = true;
  private graphicNext = false;
  private ctl: number[] = [];

  private readonly corrupt: boolean;

  constructor(options: CpcOptions = {}) {
    this.corrupt = options.corruptRegisters ?? true;
    this.model = options.model ?? '6128';
    this.fwmStrict = options.fwmStrict ?? false;
    const cpu = this.cpu;
    cpu.irqInterval = options.irqInterval ?? IRQ_INTERVAL;
    cpu.nextIrq = cpu.irqInterval;
    cpu.bc2 = options.firmwareBc ?? 0x7f8e;
    for (let r = 0; r < 25; r++) this.grid.push(new Array<string>(80).fill(' '));
    this.installFirmware();
    installSoundManager(this);
  }

  // ---------- results ----------
  /** Everything sent to TXT OUTPUT as a string (bytes as Latin-1 characters). */
  get transcript(): string {
    return String.fromCharCode(...this.textBytes);
  }
  get printer(): string {
    return String.fromCharCode(...this.printerBytes);
  }
  /** The 25 screen rows as text, right-trimmed. */
  get rows(): string[] {
    return this.grid.map((row) => row.slice(0, this.cols).join('').replace(/ +$/, ''));
  }
  /** The text cursor in logical (window-relative, 1-based) coordinates. */
  get cursor(): { col: number; row: number } {
    return { col: this.curCol - this.winL + 1, row: this.curRow - this.winT + 1 };
  }

  // ---------- hook plumbing ----------
  /** Registers a plain hook (no register contract, no logging); it must return itself with `cpu.ret()`. */
  hook(address: number, fn: (cpu: Z80Cpu) => void): void {
    this.cpu.hooks[address & 0xffff] = fn;
  }

  /**
   * Registers a firmware entry. `fn` gets the registers the entry was called with; the
   * registers in `corrupt` are overwritten with junk before it runs, so `fn` sets every
   * output it has to produce. Returns as RET.
   */
  fw(address: number, name: string, corrupt: RegName[], fn: (cpu: Z80Cpu, i: FwIn) => void): void {
    this.cpu.hooks[address] = (cpu) => {
      const from = cpu.rw(cpu.sp);
      this.calls.push({ address, name, bc2: cpu.bc2, af2: cpu.af2, iff1: cpu.iff1, from });
      const i: FwIn = { a: cpu.a, f: cpu.f, b: cpu.b, c: cpu.c, d: cpu.d, e: cpu.e, h: cpu.h, l: cpu.l };
      if (this.corrupt) for (const reg of corrupt) cpu[reg] = JUNK[reg];
      fn(cpu, i);
      cpu.ret();
    };
  }
  private setCarry(on: boolean): void {
    this.cpu.f = (this.cpu.f & ~1) | (on ? 1 : 0);
  }

  // ---------- the text VDU ----------
  private clearRect(l: number, r: number, t: number, b: number): void {
    for (let row = t; row <= b; row++) for (let col = l; col <= r; col++) this.grid[row - 1][col - 1] = ' ';
  }
  private clearScreen(): void {
    this.clearRect(1, 80, 1, 25);
  }
  private rollUp(): void {
    for (let row = this.winT; row < this.winB; row++)
      for (let col = this.winL; col <= this.winR; col++) this.grid[row - 1][col - 1] = this.grid[row][col - 1];
    this.clearRect(this.winL, this.winR, this.winB, this.winB);
    this.roll = (this.roll - 1) & 255;
  }
  private rollDown(): void {
    for (let row = this.winB; row > this.winT; row--)
      for (let col = this.winL; col <= this.winR; col++) this.grid[row - 1][col - 1] = this.grid[row - 2][col - 1];
    this.clearRect(this.winL, this.winR, this.winT, this.winT);
    this.roll = (this.roll + 1) & 255;
  }
  /** TXT VALIDATE: force the cursor into the window, wrapping and rolling as the firmware does. */
  private validate(): void {
    if (this.curCol > this.winR) {
      this.curCol = this.winL;
      this.curRow++;
    } else if (this.curCol < this.winL) {
      this.curCol = this.winR;
      this.curRow--;
    }
    if (this.curRow > this.winB) {
      this.rollUp();
      this.curRow = this.winB;
    } else if (this.curRow < this.winT) {
      this.rollDown();
      this.curRow = this.winT;
    }
  }
  private putChar(ch: number): void {
    this.validate();
    this.grid[this.curRow - 1][this.curCol - 1] = String.fromCharCode(ch);
    this.curCol++;
  }
  private setMode(mode: number): void {
    if ((mode & 3) === 3) return;
    this.mode = mode & 3;
    this.cols = MODE_COLS[this.mode];
    this.clearScreen();
    this.winL = 1;
    this.winR = this.cols;
    this.winT = 1;
    this.winB = 25;
    this.curCol = 1;
    this.curRow = 1;
    this.vduOn = true;
    this.ctl = [];
    this.graphicNext = false;
    // The mode lives in the firmware's BC' (C' bits 0-1), where the gate captures it.
    this.cpu.r2[1] = (this.cpu.r2[1] & ~3) | this.mode;
  }
  /** TXT OUTPUT: a character or one byte of a control sequence. */
  textOutput(ch: number): void {
    this.textBytes.push(ch);
    if (this.ctl.length > 0) {
      this.ctl.push(ch);
      if (this.ctl.length - 1 >= CONTROL_PARAMS[this.ctl[0]]) {
        const seq = this.ctl;
        this.ctl = [];
        this.control(seq);
      }
      return;
    }
    if (this.graphicNext) {
      this.graphicNext = false;
      if (this.vduOn) this.putChar(ch);
      return;
    }
    if (ch < 32) {
      if (CONTROL_PARAMS[ch] === 0) this.control([ch]);
      else this.ctl = [ch];
      return;
    }
    if (this.vduOn) this.putChar(ch);
  }
  private control(seq: number[]): void {
    const p = seq.slice(1);
    switch (seq[0]) {
      case 1:
        this.graphicNext = true;
        return;
      case 6:
        this.vduOn = true;
        return;
      case 21:
        this.vduOn = false;
        return;
      case 4:
        this.setMode(p[0]);
        return;
      case 8:
        this.curCol--;
        this.validate();
        return;
      case 9:
        this.curCol++;
        this.validate();
        return;
      case 10:
        this.curRow++;
        this.validate();
        return;
      case 11:
        this.curRow--;
        this.validate();
        return;
      case 12:
        this.clearWindow();
        return;
      case 13:
        this.curCol = this.winL;
        return;
      case 14:
        this.paper = p[0];
        return;
      case 15:
        this.pen = p[0];
        return;
      case 16:
        this.validate();
        this.clearRect(this.curCol, this.curCol, this.curRow, this.curRow);
        return;
      case 17:
        this.validate();
        this.clearRect(this.winL, this.curCol, this.curRow, this.curRow);
        return;
      case 18:
        this.validate();
        this.clearRect(this.curCol, this.winR, this.curRow, this.curRow);
        return;
      case 19:
        this.validate();
        this.clearRect(this.winL, this.winR, this.winT, this.curRow - 1);
        this.clearRect(this.winL, this.curCol, this.curRow, this.curRow);
        return;
      case 20:
        this.validate();
        this.clearRect(this.curCol, this.winR, this.curRow, this.curRow);
        this.clearRect(this.winL, this.winR, this.curRow + 1, this.winB);
        return;
      case 24:
        [this.pen, this.paper] = [this.paper, this.pen];
        return;
      case 26: {
        const l = Math.max(1, Math.min(p[0], p[1], this.cols));
        const r = Math.min(this.cols, Math.max(p[0], p[1], 1));
        const t = Math.max(1, Math.min(p[2], p[3], 25));
        const b = Math.min(25, Math.max(p[2], p[3], 1));
        this.winL = l;
        this.winR = r;
        this.winT = t;
        this.winB = b;
        return;
      }
      case 28:
        this.inks[p[0] & 15] = [p[1] & 31, p[2] & 31];
        return;
      case 29:
        this.border = [p[0] & 31, p[1] & 31];
        return;
      case 30:
        this.curCol = this.winL;
        this.curRow = this.winT;
        return;
      case 31:
        this.curCol = this.winL + p[0] - 1;
        this.curRow = this.winT + p[1] - 1;
        return;
      default:
        // 0, 2, 3, 5, 7, 22, 23, 25, 27: consumed, no effect on the model
        return;
    }
  }
  private clearWindow(): void {
    this.clearRect(this.winL, this.winR, this.winT, this.winB);
    this.curCol = this.winL;
    this.curRow = this.winT;
  }

  // ---------- keyboard ----------
  private releasePending(): void {
    while (this.pendingKeys.length > 0) this.keyQueue.push(this.pendingKeys.shift() as number);
  }
  /** Queues keys (character codes or a string) to be read once the program asks. */
  typeAhead(keys: string | readonly number[]): void {
    if (typeof keys === 'string') for (const ch of keys) this.pendingKeys.push(ch.charCodeAt(0) & 255);
    else this.pendingKeys.push(...keys);
  }
  private readKey(cpu: Z80Cpu, wait: boolean): boolean {
    if (this.keyQueue.length === 0 && wait) this.releasePending();
    if (this.keyQueue.length > 0) {
      cpu.a = this.keyQueue.shift() as number;
      this.setCarry(true);
      return true;
    }
    this.setCarry(false);
    if (wait) cpu.stop = 'waitkey';
    else this.releasePending(); // the poll reports "none"; typed-ahead keys show from the next call
    return false;
  }

  // ---------- installation ----------
  private installFirmware(): void {
    const cpu = this.cpu;
    // Unhandled jumpblock entries fail with their address.
    for (let a = 0xb900; a <= 0xbdff; a++) {
      cpu.hooks[a] = (c) => {
        throw new UnhandledFirmwareError(a, c.rw(c.sp));
      };
    }
    // RST 0 ends the program.
    cpu.hooks[0] = (c) => {
      c.stop = 'rst0';
    };
    // The RAM interrupt vector: JP &B941 (664, 6128, Plus) or JP &B939 (464); both are hooked.
    cpu.mem[0x38] = 0xc3;
    cpu.mem[0x39] = this.model === '464' ? 0x39 : 0x41;
    cpu.mem[0x3a] = 0xb9;
    const irq = (c: Z80Cpu): void => {
      if ((c.bc2 >> 8) !== 0x7f)
        throw new FirmwareContractError(`firmware interrupt handler entered with B' = &${(c.bc2 >> 8).toString(16)}, not &7F`);
      if ((c.af2 & 1) !== 0)
        throw new FirmwareContractError("firmware interrupt handler entered with AF' carry set (nested-interrupt path)");
      this.interrupts++;
      c.iff1 = true; // the handler ends with EI; RET
      c.iff2 = true;
      c.ret();
    };
    cpu.hooks[0xb939] = irq;
    cpu.hooks[0xb941] = irq;

    this.fw(0xb915, 'KL PROBE ROM', ['a', 'f', 'b', 'c', 'd', 'e'], (c, i) => {
      if (i.c !== 0) throw new FirmwareContractError(`KL PROBE ROM is measured for C = 0 only (got C = ${i.c})`);
      c.h = PROBE_H[this.model];
      c.l = 1;
    });
    installMaths(this, this.model);

    this.fw(0xbb5a, 'TXT OUTPUT', [], (_c, i) => this.textOutput(i.a));
    this.fw(0xbb69, 'TXT GET WINDOW', AF, (c) => {
      c.h = this.winL;
      c.d = this.winR;
      c.l = this.winT;
      c.e = this.winB; // the guide's text lists H, D and L; the bottom row is returned in E
      const whole = this.winL === 1 && this.winR === this.cols && this.winT === 1 && this.winB === 25;
      this.setCarry(!whole);
    });
    this.fw(0xbb6c, 'TXT CLEAR WINDOW', ALL4, () => this.clearWindow());
    this.fw(0xbb75, 'TXT SET CURSOR', AFHL, (_c, i) => {
      this.curCol = this.winL + i.h - 1;
      this.curRow = this.winT + i.l - 1;
    });
    this.fw(0xbb78, 'TXT GET CURSOR', ['f'], (c) => {
      c.h = (this.curCol - this.winL + 1) & 255;
      c.l = (this.curRow - this.winT + 1) & 255;
      c.a = this.roll;
    });
    this.fw(0xbb90, 'TXT SET PEN', AFHL, (_c, i) => {
      this.pen = i.a & this.inkMask();
    });
    this.fw(0xbb93, 'TXT GET PEN', AF, (c) => {
      c.a = this.pen;
    });
    this.fw(0xbb96, 'TXT SET PAPER', AFHL, (_c, i) => {
      this.paper = i.a & this.inkMask();
    });
    this.fw(0xbb99, 'TXT GET PAPER', AF, (c) => {
      c.a = this.paper;
    });
    this.fw(0xbb9c, 'TXT INVERSE', AFHL, () => {
      [this.pen, this.paper] = [this.paper, this.pen];
    });
    // TXT STR SELECT (SOFT968): A = the stream; A = the previous stream on exit, HL and the flags corrupt. Only the
    // selection is recorded: the fake draws every stream in the one window. (L4-ERR: the error trap selects stream 0.)
    this.fw(0xbbb4, 'TXT STR SELECT', ['f', 'h', 'l'], (c, i) => {
      c.a = this.stream;
      this.stream = i.a & 7;
    });

    this.fw(0xbb06, 'KM WAIT CHAR', ['f'], (c) => void this.readKey(c, true));
    this.fw(0xbb09, 'KM READ CHAR', AF, (c) => void this.readKey(c, false));
    this.fw(0xbb18, 'KM WAIT KEY', ['f'], (c) => void this.readKey(c, true));
    this.fw(0xbb1b, 'KM READ KEY', AF, (c) => void this.readKey(c, false));
    this.fw(0xbb1e, 'KM TEST KEY', AFHL, (c) => {
      c.f = 0x40; // Z true (not pressed), carry false
      c.c = 0;
    });

    this.fw(0xbc05, 'SCR SET OFFSET', AFHL, (_c, i) => {
      this.screenOffset = ((i.h << 8) | i.l) & 0x7fe;
    });
    this.fw(0xbc08, 'SCR SET BASE', AFHL, (_c, i) => {
      this.screenBase = i.a & 0xc0;
    });
    this.fw(0xbc0b, 'SCR GET LOCATION', ['f'], (c) => {
      c.a = this.screenBase;
      c.hl = this.screenOffset;
    });
    this.fw(0xbc0e, 'SCR SET MODE', ALL4, (_c, i) => {
      this.setMode(i.a);
      this.screenOffset = 0; // the mode change clears the screen, which resets the offset (SCR CLEAR)
    });
    this.fw(0xbc32, 'SCR SET INK', ALL4, (_c, i) => {
      this.inks[i.a & 15] = [i.b & 31, i.c & 31];
    });
    this.fw(0xbc35, 'SCR GET INK', AFDEHL, (c, i) => {
      const ink = this.inks[i.a & 15];
      c.b = ink[0];
      c.c = ink[1];
    });
    this.fw(0xbc38, 'SCR SET BORDER', ALL4, (_c, i) => {
      this.border = [i.b & 31, i.c & 31];
    });
    this.fw(0xbc3b, 'SCR GET BORDER', AFDEHL, (c) => {
      c.b = this.border[0];
      c.c = this.border[1];
    });
    this.fw(0xbc59, 'SCR ACCESS', AFHL, (_c, i) => void this.gfx.push(`access ${i.a}`));

    this.fw(0xbbc0, 'GRA MOVE ABSOLUTE', AFDEHL, (_c, i) => {
      this.gx = (i.d << 8) | i.e;
      this.gy = (i.h << 8) | i.l;
      this.gfx.push(`move ${this.gx},${this.gy}`);
    });
    this.fw(0xbbc6, 'GRA ASK CURSOR', AF, (c) => {
      c.de = this.gx;
      c.hl = this.gy;
    });
    this.fw(0xbbde, 'GRA SET PEN', AFHL, (_c, i) => {
      this.graphicsPen = i.a;
      this.gfx.push(`pen ${i.a}`);
    });
    this.fw(0xbbea, 'GRA PLOT ABSOLUTE', ALL4, (_c, i) => {
      this.gx = (i.d << 8) | i.e;
      this.gy = (i.h << 8) | i.l;
      this.pixels.set(`${this.gx},${this.gy}`, this.graphicsPen);
      this.gfx.push(`plot ${this.gx},${this.gy}`);
    });
    this.fw(0xbbf9, 'GRA LINE RELATIVE', ALL4, (_c, i) => {
      const dx = (((i.d << 8) | i.e) << 16) >> 16;
      const dy = (((i.h << 8) | i.l) << 16) >> 16;
      this.gx = (this.gx + dx) & 0xffff;
      this.gy = (this.gy + dy) & 0xffff;
      this.gfx.push(`line ${this.gx},${this.gy}`);
    });

    this.fw(0xbd0d, 'KL TIME PLEASE', ['d', 'e', 'h', 'l'], (c) => {
      const ticks = Math.floor(c.t / IRQ_INTERVAL);
      c.de = (ticks / 0x10000) & 0xffff;
      c.hl = ticks & 0xffff;
    });
    this.fw(0xbd19, 'MC WAIT FLYBACK', [], (c) => {
      // Waits for the next frame flyback (50 Hz); interrupts that fall in the wait are merged.
      c.t = (Math.floor(c.t / FRAME_TSTATES) + 1) * FRAME_TSTATES;
    });
    this.fw(0xbd2b, 'MC PRINT CHAR', AF, (_c, i) => {
      this.printerBytes.push(i.a);
      this.setCarry(true);
    });

    this.installRecorded();
    installDisc(this, this.disc);
    this.ticker = new FakeTicker(this);
    // PPI port B (&F5xx): bit 0 is the frame flyback (VSYNC), high for the first VSYNC_TSTATES of every 50 Hz frame, so a program that
    // waits for it (WaitRetrace, the game-mode ISR) sees the edge. The other bits read as 1.
    cpu.onIn = (port) => ((port >> 8) === 0xf5 ? 0xfe | (cpu.t % FRAME_TSTATES < VSYNC_TSTATES ? 1 : 0) : 0xff);
  }

  /**
   * Entries whose effect the comparison does not need (L5-SIMFW): each logs its call and arguments in `gfx` and sets the
   * outputs the guide (SOFT968) defines, so a program that calls them runs to its end and two levels can be compared.
   */
  private installRecorded(): void {
    const mem = this.cpu.mem;
    const rec = (address: number, name: string, corrupt: RegName[], fn: (c: Z80Cpu, i: FwIn) => string | void): void =>
      this.fw(address, name, corrupt, (c, i) => {
        const text = fn(c, i);
        this.gfx.push(text === undefined ? name : `${name} ${text}`);
      });
    const s16 = (n: number): number => (n << 16) >> 16;
    const xy = (i: FwIn): string => `${s16((i.d << 8) | i.e)},${s16((i.h << 8) | i.l)}`;
    const none: RegName[] = [];

    // text
    this.fw(0xbb81, 'TXT CUR ON', none, () => undefined);
    this.fw(0xbb84, 'TXT CUR OFF', none, () => undefined);
    // TXT WIN ENABLE: H, D = the left and right columns, L, E = the top and bottom lines, physical and counted from 0;
    // sorted and cut to the screen, the cursor goes to the window's corner, nothing is cleared.
    this.fw(0xbb66, 'TXT WIN ENABLE', ALL4, (_c, i) => {
      const col = (n: number): number => Math.min(this.cols, (n & 255) + 1);
      const row = (n: number): number => Math.min(25, (n & 255) + 1);
      this.winL = Math.min(col(i.h), col(i.d));
      this.winR = Math.max(col(i.h), col(i.d));
      this.winT = Math.min(row(i.l), row(i.e));
      this.winB = Math.max(row(i.l), row(i.e));
      this.curCol = this.winL;
      this.curRow = this.winT;
    });
    // TXT RD CHAR: the character under the cursor, Carry true (the grid holds only characters this program printed).
    this.fw(0xbb60, 'TXT RD CHAR', ['f', 'b', 'c', 'd', 'e', 'h', 'l'], (c) => {
      this.validate();
      c.a = (this.grid[this.curRow - 1][this.curCol - 1] ?? ' ').charCodeAt(0) & 255;
      this.setCarry(true);
    });
    rec(0xbb63, 'TXT SET GRAPHIC', AFHL, (_c, i) => `${i.a === 0 ? 'off' : 'on'}`);
    rec(0xbba8, 'TXT SET MATRIX', ALL4, (_c, i) => `char ${i.a}`);
    // TXT SET M TABLE: DE = the first character, HL = the table (an address of the program's: not logged). Carry true.
    rec(0xbbab, 'TXT SET M TABLE', ALL4, (c, i) => {
      this.setCarry(true);
      return `first ${(i.d << 8) | i.e}`;
    });
    rec(0xbbb7, 'TXT SWAP STREAMS', ALL4, (_c, i) => `${i.b},${i.c}`);

    // keyboard: key-manager setters (recorded), the joysticks (never pressed) and the expansion strings (always room)
    this.fw(0xbb24, 'KM GET JOYSTICK', AF, (c) => {
      c.h = 0;
      c.l = 0;
    });
    this.fw(0xbb0f, 'KM SET EXPAND', ['a', 'b', 'c', 'd', 'e', 'h', 'l'], (c, i) => {
      const at = (i.h << 8) | i.l;
      const text = Array.from(mem.subarray(at, at + i.c), (b) => String.fromCharCode(b)).join('');
      this.gfx.push(`KM SET EXPAND ${i.b} ${JSON.stringify(text)}`);
      this.setCarry(true);
    });
    for (const [a, name] of [[0xbb27, 'KM SET TRANSLATE'], [0xbb2d, 'KM SET SHIFT'], [0xbb33, 'KM SET CONTROL'], [0xbb39, 'KM SET REPEAT']] as const)
      rec(a, name, ['a', 'f', 'b', 'c', 'h', 'l'], (_c, i) => `${i.a} ${i.b}`);
    rec(0xbb3f, 'KM SET DELAY', AF, (_c, i) => `${i.h},${i.l}`);
    // the lock keys: KM SET LOCKS (&BD3A, 6128 and Plus: H = caps lock, L = shift lock, 0 off and &FF on) and KM GET STATE (L = shift lock, H = caps lock)
    rec(0xbd3a, 'KM SET LOCKS', AFHL, (_c, i) => {
      this.locks = [i.h, i.l];
      return `${i.h},${i.l}`;
    });
    this.fw(0xbb21, 'KM GET STATE', AFHL, (c) => {
      c.h = this.locks[0];
      c.l = this.locks[1];
    });
    // KM CHAR RETURN: the character goes back to the head of the key buffer (INKEY$'s peek)
    this.fw(0xbb0c, 'KM CHAR RETURN', [], (_c, i) => void this.keyQueue.unshift(i.a));

    // screen
    // SCR GET MODE: A = the mode; Carry true in mode 0, Zero true in mode 1 (neither in mode 2)
    this.fw(0xbc11, 'SCR GET MODE', AF, (c) => {
      c.a = this.mode;
      c.f = (c.f & ~0x41) | (this.mode === 0 ? 1 : 0) | (this.mode === 1 ? 0x40 : 0);
    });
    // SCR INK ENCODE: the screen byte with every pixel in pen A, for the current mode (layouts as lib/cpcbuild/penbyte.asm documents)
    this.fw(0xbc2c, 'SCR INK ENCODE', AF, (c, i) => {
      const bits = this.mode === 0 ? [0xc0, 0x0c, 0x30, 0x03] : this.mode === 1 ? [0xf0, 0x0f] : [0xff];
      c.a = bits.reduce((v, m, k) => v | ((i.a >> k) & 1 ? m : 0), 0);
    });
    // SOUND RESET: empties the queues (the fake keeps none); every register is corrupt
    this.fw(0xbca7, 'SOUND RESET', ALL4, () => undefined);
    // SCR SET/GET FLASHING: the two periods in 1/50 s (H for the first colour, L for the second); the default is 10 and 10
    rec(0xbc3e, 'SCR SET FLASHING', ALL4, (_c, i) => {
      this.flashing = [i.h, i.l];
      return `${i.h},${i.l}`;
    });
    this.fw(0xbc41, 'SCR GET FLASHING', AF, (c) => {
      c.h = this.flashing[0];
      c.l = this.flashing[1];
    });

    // graphics: positions are the program's (user units); drawing is not modelled, a pixel test reads back what PLOT drew
    const pixels = this.pixels;
    const at = (name: string, address: number, relative: boolean, kind: 'move' | 'plot' | 'line' | 'test'): void =>
      rec(address, name, ALL4, (c, i) => {
        const dx = s16((i.d << 8) | i.e);
        const dy = s16((i.h << 8) | i.l);
        this.gx = relative ? (this.gx + dx) & 0xffff : dx & 0xffff;
        this.gy = relative ? (this.gy + dy) & 0xffff : dy & 0xffff;
        if (kind === 'plot') pixels.set(`${this.gx},${this.gy}`, this.graphicsPen);
        if (kind === 'test') c.a = pixels.get(`${this.gx},${this.gy}`) ?? 0;
        return `${dx},${dy}`;
      });
    at('GRA MOVE RELATIVE', 0xbbc3, true, 'move');
    at('GRA PLOT RELATIVE', 0xbbed, true, 'plot');
    at('GRA TEST ABSOLUTE', 0xbbf0, false, 'test');
    at('GRA TEST RELATIVE', 0xbbf3, true, 'test');
    at('GRA LINE ABSOLUTE', 0xbbf6, false, 'line');
    rec(0xbbc9, 'GRA SET ORIGIN', ALL4, (_c, i) => xy(i));
    rec(0xbbcf, 'GRA WIN WIDTH', ALL4, (_c, i) => xy(i));
    rec(0xbbd2, 'GRA WIN HEIGHT', ALL4, (_c, i) => xy(i));
    rec(0xbbdb, 'GRA CLEAR WINDOW', ALL4, () => undefined);
    rec(0xbbe4, 'GRA SET PAPER', AFHL, (_c, i) => `${i.a}`);
    // the 664/6128/Plus jumpblock has these entries (RST 1 stubs in the ROM); a 464's has none: its maths entries are there
    if (this.model !== '464') {
      for (const [a, name] of [[0xbd46, 'GRA SET BACK'], [0xbd49, 'GRA SET FIRST'], [0xbd4c, 'GRA SET LINE MASK']] as const) {
        mem[a] = 0xcf;
        rec(a, name, AFHL, (_c, i) => `${i.a}`);
      }
      mem[0xbd52] = 0xcf;
      rec(0xbd52, 'GRA FILL', ALL4, (_c, i) => `pen ${i.a}`);
    }
  }
  private inkMask(): number {
    return this.mode === 0 ? 15 : this.mode === 1 ? 3 : 1;
  }
}
