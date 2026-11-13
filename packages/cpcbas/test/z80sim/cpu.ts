/**
 * Test-only Z80 CPU for executing generated code and runtime routines inside `npm test`
 * (task L2-Z80SIM). Never shipped: it lives under test/, not src/.
 *
 * Documented instruction set with exact S, Z, H, P/V, N and C flags, the alternate
 * registers, IX/IY with displacements, the block instructions, DAA, IM/EI/DI state and
 * HALT. Undocumented: SLL, IXH/IXL/IYH/IYL (the runtime uses SLL; generated code may use the
 * index halves), the DDCB/FDCB register copy, and the Y/X flag bits (3 and 5) for the common
 * operations (block-instruction and BIT (HL) bits are approximate). T-states follow the
 * published timings (no CPC wait states) and drive a 300 Hz maskable interrupt.
 *
 * Decoding follows the x/y/z/p/q scheme of Sean Young's "The Undocumented Z80
 * Documented"; the flag rules were checked against the behaviour of the chips z80.h
 * reference (not copied).
 */

export type Hook = (cpu: Z80Cpu) => void;

const S = 0x80;
const Z = 0x40;
const H = 0x10;
const PV = 0x04;
const N = 0x02;
const CF = 0x01;
const YX = 0x28;

const PARITY = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let b = i;
  b ^= b >> 4;
  b ^= b >> 2;
  b ^= b >> 1;
  PARITY[i] = (b & 1) === 0 ? PV : 0;
}

/** Register order of the opcode encoding; index 6 holds F here (the (HL) slot is special-cased). */
const R_B = 0;
const R_C = 1;
const R_D = 2;
const R_E = 3;
const R_H = 4;
const R_L = 5;
const R_F = 6;
const R_A = 7;

export class Z80Cpu {
  readonly mem = new Uint8Array(0x10000);
  /** B C D E H L F A (the F slot is index 6). */
  readonly r = new Uint8Array(8);
  /** The alternate bank, same layout. */
  readonly r2 = new Uint8Array(8);
  pc = 0;
  sp = 0;
  ix = 0;
  iy = 0;
  i = 0;
  rr = 0;
  iff1 = false;
  iff2 = false;
  im = 0;
  halted = false;
  /** T-states elapsed. */
  t = 0;
  /** Set by a hook (or the CPU on HALT) to end the run; the value is the reason. */
  stop: string | null = null;
  /** Called when PC reaches the address; the hook must "return" itself (`ret()`). */
  readonly hooks: (Hook | undefined)[] = new Array<Hook | undefined>(0x10000).fill(undefined);
  onIn: (port: number) => number = () => 0xff;
  onOut: (port: number, value: number) => void = () => undefined;

  /** The maskable interrupt (IM 1) every `irqInterval` T-states; 0 disables it. */
  irqInterval = 0;
  nextIrq = 0;
  irqPending = false;
  private eiBlock = false;
  /** Number of instructions executed (a hook call counts as one). */
  instructions = 0;

  // ---------- register views ----------
  get a(): number {
    return this.r[R_A];
  }
  set a(v: number) {
    this.r[R_A] = v;
  }
  get f(): number {
    return this.r[R_F];
  }
  set f(v: number) {
    this.r[R_F] = v;
  }
  get b(): number {
    return this.r[R_B];
  }
  set b(v: number) {
    this.r[R_B] = v;
  }
  get c(): number {
    return this.r[R_C];
  }
  set c(v: number) {
    this.r[R_C] = v;
  }
  get d(): number {
    return this.r[R_D];
  }
  set d(v: number) {
    this.r[R_D] = v;
  }
  get e(): number {
    return this.r[R_E];
  }
  set e(v: number) {
    this.r[R_E] = v;
  }
  get h(): number {
    return this.r[R_H];
  }
  set h(v: number) {
    this.r[R_H] = v;
  }
  get l(): number {
    return this.r[R_L];
  }
  set l(v: number) {
    this.r[R_L] = v;
  }
  get af(): number {
    return (this.r[R_A] << 8) | this.r[R_F];
  }
  set af(v: number) {
    this.r[R_A] = v >> 8;
    this.r[R_F] = v & 255;
  }
  get bc(): number {
    return (this.r[R_B] << 8) | this.r[R_C];
  }
  set bc(v: number) {
    this.r[R_B] = v >> 8;
    this.r[R_C] = v & 255;
  }
  get de(): number {
    return (this.r[R_D] << 8) | this.r[R_E];
  }
  set de(v: number) {
    this.r[R_D] = v >> 8;
    this.r[R_E] = v & 255;
  }
  get hl(): number {
    return (this.r[R_H] << 8) | this.r[R_L];
  }
  set hl(v: number) {
    this.r[R_H] = v >> 8;
    this.r[R_L] = v & 255;
  }
  get af2(): number {
    return (this.r2[R_A] << 8) | this.r2[R_F];
  }
  set af2(v: number) {
    this.r2[R_A] = v >> 8;
    this.r2[R_F] = v & 255;
  }
  get bc2(): number {
    return (this.r2[R_B] << 8) | this.r2[R_C];
  }
  set bc2(v: number) {
    this.r2[R_B] = v >> 8;
    this.r2[R_C] = v & 255;
  }
  get de2(): number {
    return (this.r2[R_D] << 8) | this.r2[R_E];
  }
  set de2(v: number) {
    this.r2[R_D] = v >> 8;
    this.r2[R_E] = v & 255;
  }
  get hl2(): number {
    return (this.r2[R_H] << 8) | this.r2[R_L];
  }
  set hl2(v: number) {
    this.r2[R_H] = v >> 8;
    this.r2[R_L] = v & 255;
  }

  // ---------- memory ----------
  rb(addr: number): number {
    return this.mem[addr & 0xffff];
  }
  wb(addr: number, v: number): void {
    this.mem[addr & 0xffff] = v;
  }
  rw(addr: number): number {
    return this.mem[addr & 0xffff] | (this.mem[(addr + 1) & 0xffff] << 8);
  }
  ww(addr: number, v: number): void {
    this.mem[addr & 0xffff] = v & 255;
    this.mem[(addr + 1) & 0xffff] = (v >> 8) & 255;
  }
  push(v: number): void {
    this.sp = (this.sp - 2) & 0xffff;
    this.ww(this.sp, v);
  }
  pop(): number {
    const v = this.rw(this.sp);
    this.sp = (this.sp + 2) & 0xffff;
    return v;
  }
  /** What a hook calls to behave as `RET` (10 T-states). */
  ret(): void {
    this.pc = this.pop();
    this.t += 10;
  }
  load(bytes: ArrayLike<number>, org: number): void {
    for (let k = 0; k < bytes.length; k++) this.mem[(org + k) & 0xffff] = bytes[k];
  }

  private fetch8(): number {
    const v = this.mem[this.pc];
    this.pc = (this.pc + 1) & 0xffff;
    return v;
  }
  private fetch16(): number {
    const lo = this.mem[this.pc];
    const hi = this.mem[(this.pc + 1) & 0xffff];
    this.pc = (this.pc + 2) & 0xffff;
    return lo | (hi << 8);
  }
  private fetchOp(): number {
    const v = this.fetch8();
    this.rr = (this.rr & 0x80) | ((this.rr + 1) & 0x7f);
    return v;
  }

  // ---------- operand helpers ----------
  /** Register by encoding index (not 6) honouring the IX/IY half substitution. */
  private getR(i: number, idx: number): number {
    if (idx !== 0) {
      if (i === R_H) return (idx === 1 ? this.ix : this.iy) >> 8;
      if (i === R_L) return (idx === 1 ? this.ix : this.iy) & 255;
    }
    return this.r[i];
  }
  private setR(i: number, v: number, idx: number): void {
    if (idx !== 0 && (i === R_H || i === R_L)) {
      const cur = idx === 1 ? this.ix : this.iy;
      const nv = i === R_H ? (v << 8) | (cur & 255) : (cur & 0xff00) | v;
      if (idx === 1) this.ix = nv;
      else this.iy = nv;
      return;
    }
    this.r[i] = v;
  }
  private getHLx(idx: number): number {
    return idx === 0 ? this.hl : idx === 1 ? this.ix : this.iy;
  }
  private setHLx(idx: number, v: number): void {
    if (idx === 0) this.hl = v;
    else if (idx === 1) this.ix = v;
    else this.iy = v;
  }
  /** Effective address of the (HL) / (IX+d) / (IY+d) operand; fetches d and adds the time. */
  private ea(idx: number): number {
    if (idx === 0) return this.hl;
    this.t += 8;
    return this.eaNoTime(idx);
  }
  /** (IX+d) address; the displacement is read here, the time is the caller's. */
  private eaNoTime(idx: number): number {
    const d = this.fetch8();
    return ((idx === 1 ? this.ix : this.iy) + (d < 128 ? d : d - 256)) & 0xffff;
  }
  private getRP(p: number, idx: number): number {
    switch (p) {
      case 0:
        return this.bc;
      case 1:
        return this.de;
      case 2:
        return this.getHLx(idx);
      default:
        return this.sp;
    }
  }
  private setRP(p: number, v: number, idx: number): void {
    switch (p) {
      case 0:
        this.bc = v;
        break;
      case 1:
        this.de = v;
        break;
      case 2:
        this.setHLx(idx, v);
        break;
      default:
        this.sp = v & 0xffff;
    }
  }
  private cond(cc: number): boolean {
    const f = this.r[R_F];
    switch (cc) {
      case 0:
        return (f & Z) === 0;
      case 1:
        return (f & Z) !== 0;
      case 2:
        return (f & CF) === 0;
      case 3:
        return (f & CF) !== 0;
      case 4:
        return (f & PV) === 0;
      case 5:
        return (f & PV) !== 0;
      case 6:
        return (f & S) === 0;
      default:
        return (f & S) !== 0;
    }
  }

  // ---------- ALU ----------
  private alu(op: number, v: number): void {
    const a = this.r[R_A];
    let res: number;
    let out: number;
    switch (op) {
      case 0: // ADD
      case 1: {
        // ADC
        const c = op === 1 ? this.r[R_F] & CF : 0;
        res = a + v + c;
        out = res & 255;
        this.r[R_A] = out;
        this.r[R_F] =
          (out & (S | YX)) |
          (out === 0 ? Z : 0) |
          ((a ^ v ^ out) & H) |
          ((a ^ v ^ 0x80) & (a ^ out) & 0x80 ? PV : 0) |
          (res > 255 ? CF : 0);
        return;
      }
      case 2: // SUB
      case 3: // SBC
      case 7: {
        // CP
        const c = op === 3 ? this.r[R_F] & CF : 0;
        res = a - v - c;
        out = res & 255;
        if (op !== 7) this.r[R_A] = out;
        this.r[R_F] =
          (out & S) |
          (op === 7 ? v & YX : out & YX) |
          (out === 0 ? Z : 0) |
          ((a ^ v ^ out) & H) |
          ((a ^ v) & (a ^ out) & 0x80 ? PV : 0) |
          N |
          (res < 0 ? CF : 0);
        return;
      }
      case 4: // AND
        out = a & v;
        this.r[R_A] = out;
        this.r[R_F] = (out & (S | YX)) | (out === 0 ? Z : 0) | H | PARITY[out];
        return;
      case 5: // XOR
        out = a ^ v;
        this.r[R_A] = out;
        this.r[R_F] = (out & (S | YX)) | (out === 0 ? Z : 0) | PARITY[out];
        return;
      default: // OR
        out = a | v;
        this.r[R_A] = out;
        this.r[R_F] = (out & (S | YX)) | (out === 0 ? Z : 0) | PARITY[out];
    }
  }
  private inc8(v: number): number {
    const out = (v + 1) & 255;
    this.r[R_F] =
      (this.r[R_F] & CF) | (out & (S | YX)) | (out === 0 ? Z : 0) | ((v & 15) === 15 ? H : 0) | (v === 0x7f ? PV : 0);
    return out;
  }
  private dec8(v: number): number {
    const out = (v - 1) & 255;
    this.r[R_F] =
      (this.r[R_F] & CF) | (out & (S | YX)) | (out === 0 ? Z : 0) | ((v & 15) === 0 ? H : 0) | (v === 0x80 ? PV : 0) | N;
    return out;
  }
  private add16(a: number, b: number): number {
    const res = a + b;
    this.r[R_F] =
      (this.r[R_F] & (S | Z | PV)) | ((res >> 8) & YX) | ((a ^ b ^ res) & 0x1000 ? H : 0) | (res > 0xffff ? CF : 0);
    return res & 0xffff;
  }
  private adc16(a: number, b: number): number {
    const c = this.r[R_F] & CF;
    const res = a + b + c;
    const out = res & 0xffff;
    this.r[R_F] =
      ((out >> 8) & (S | YX)) |
      (out === 0 ? Z : 0) |
      ((a ^ b ^ res) & 0x1000 ? H : 0) |
      ((a ^ b ^ 0x8000) & (a ^ out) & 0x8000 ? PV : 0) |
      (res > 0xffff ? CF : 0);
    return out;
  }
  private sbc16(a: number, b: number): number {
    const c = this.r[R_F] & CF;
    const res = a - b - c;
    const out = res & 0xffff;
    this.r[R_F] =
      ((out >> 8) & (S | YX)) |
      (out === 0 ? Z : 0) |
      ((a ^ b ^ res) & 0x1000 ? H : 0) |
      ((a ^ b) & (a ^ out) & 0x8000 ? PV : 0) |
      N |
      (res < 0 ? CF : 0);
    return out;
  }
  private rot(op: number, v: number): number {
    let res: number;
    let c: number;
    const oldC = this.r[R_F] & CF;
    switch (op) {
      case 0:
        c = v >> 7;
        res = ((v << 1) | c) & 255;
        break;
      case 1:
        c = v & 1;
        res = (v >> 1) | (c << 7);
        break;
      case 2:
        c = v >> 7;
        res = ((v << 1) | oldC) & 255;
        break;
      case 3:
        c = v & 1;
        res = (v >> 1) | (oldC << 7);
        break;
      case 4:
        c = v >> 7;
        res = (v << 1) & 255;
        break;
      case 5:
        c = v & 1;
        res = (v >> 1) | (v & 0x80);
        break;
      case 6:
        c = v >> 7;
        res = ((v << 1) | 1) & 255;
        break;
      default:
        c = v & 1;
        res = v >> 1;
    }
    this.r[R_F] = (res & (S | YX)) | (res === 0 ? Z : 0) | PARITY[res] | c;
    return res;
  }
  private daa(): void {
    const a = this.r[R_A];
    const f = this.r[R_F];
    let corr = 0;
    let c = f & CF;
    if ((f & H) !== 0 || (a & 15) > 9) corr |= 6;
    if (c !== 0 || a > 0x99) {
      corr |= 0x60;
      c = 1;
    }
    const sub = (f & N) !== 0;
    const out = (sub ? a - corr : a + corr) & 255;
    const hf = sub ? ((f & H) !== 0 && (a & 15) < 6 ? H : 0) : (a & 15) > 9 ? H : 0;
    this.r[R_A] = out;
    this.r[R_F] = (out & (S | YX)) | (out === 0 ? Z : 0) | hf | PARITY[out] | (f & N) | c;
  }

  // ---------- running ----------
  private takeInterrupt(): void {
    this.irqPending = false;
    this.iff1 = false;
    this.iff2 = false;
    this.halted = false;
    this.push(this.pc);
    this.pc = 0x38;
    this.t += 13;
  }

  /** Executes one instruction (or one hook, or one idle HALT step). */
  step(): void {
    const blocked = this.eiBlock;
    this.eiBlock = false;
    if (this.irqPending && this.iff1 && !blocked) {
      this.takeInterrupt();
    } else if (this.halted) {
      if (!this.iff1 || this.irqInterval === 0) {
        this.stop = 'halt';
        return;
      }
      // Idle until the next interrupt request.
      this.t = Math.max(this.t + 4, this.nextIrq);
      this.irqPending = true;
      this.nextIrq += this.irqInterval;
      return;
    }
    this.instructions++;
    const hook = this.hooks[this.pc];
    if (hook !== undefined) hook(this);
    else this.exec();
    if (this.irqInterval > 0 && this.t >= this.nextIrq) {
      this.irqPending = true;
      do this.nextIrq += this.irqInterval;
      while (this.nextIrq <= this.t);
    }
  }

  private exec(): void {
    let op = this.fetchOp();
    let idx = 0;
    while (op === 0xdd || op === 0xfd) {
      idx = op === 0xdd ? 1 : 2;
      this.t += 4;
      op = this.fetchOp();
    }
    if (op === 0xcb) {
      this.execCB(idx);
      return;
    }
    if (op === 0xed) {
      this.t += 4;
      this.execED(this.fetchOp());
      return;
    }
    this.execMain(op, idx);
  }

  private execMain(op: number, idx: number): void {
    const x = op >> 6;
    const y = (op >> 3) & 7;
    const z = op & 7;
    const p = y >> 1;
    const q = y & 1;
    const r = this.r;
    switch (x) {
      case 0:
        this.execX0(y, z, p, q, idx);
        return;
      case 1:
        if (y === 6 && z === 6) {
          this.halted = true;
          this.t += 4;
        } else if (y === 6) {
          // LD (HL),r : the register operand is the plain one
          this.wb(this.ea(idx), r[z]);
          this.t += 7;
        } else if (z === 6) {
          r[y] = this.rb(this.ea(idx));
          this.t += 7;
        } else {
          this.setR(y, this.getR(z, idx), idx);
          this.t += 4;
        }
        return;
      case 2:
        if (z === 6) {
          this.alu(y, this.rb(this.ea(idx)));
          this.t += 7;
        } else {
          this.alu(y, this.getR(z, idx));
          this.t += 4;
        }
        return;
      default:
        this.execX3(y, z, p, q, idx);
    }
  }

  private execX0(y: number, z: number, p: number, q: number, idx: number): void {
    const r = this.r;
    switch (z) {
      case 0:
        switch (y) {
          case 0:
            this.t += 4;
            return;
          case 1: {
            const a = r[R_A];
            const f = r[R_F];
            r[R_A] = this.r2[R_A];
            r[R_F] = this.r2[R_F];
            this.r2[R_A] = a;
            this.r2[R_F] = f;
            this.t += 4;
            return;
          }
          case 2: {
            const d = this.fetch8();
            r[R_B] = (r[R_B] - 1) & 255;
            if (r[R_B] !== 0) {
              this.pc = (this.pc + (d < 128 ? d : d - 256)) & 0xffff;
              this.t += 13;
            } else this.t += 8;
            return;
          }
          case 3: {
            const d = this.fetch8();
            this.pc = (this.pc + (d < 128 ? d : d - 256)) & 0xffff;
            this.t += 12;
            return;
          }
          default: {
            const d = this.fetch8();
            if (this.cond(y - 4)) {
              this.pc = (this.pc + (d < 128 ? d : d - 256)) & 0xffff;
              this.t += 12;
            } else this.t += 7;
            return;
          }
        }
      case 1:
        if (q === 0) {
          this.setRP(p, this.fetch16(), idx);
          this.t += 10;
        } else {
          this.setHLx(idx, this.add16(this.getHLx(idx), this.getRP(p, idx)));
          this.t += 11;
        }
        return;
      case 2:
        switch (p) {
          case 0:
            if (q === 0) this.wb(this.bc, r[R_A]);
            else r[R_A] = this.rb(this.bc);
            this.t += 7;
            return;
          case 1:
            if (q === 0) this.wb(this.de, r[R_A]);
            else r[R_A] = this.rb(this.de);
            this.t += 7;
            return;
          case 2: {
            const nn = this.fetch16();
            if (q === 0) this.ww(nn, this.getHLx(idx));
            else this.setHLx(idx, this.rw(nn));
            this.t += 16;
            return;
          }
          default: {
            const nn = this.fetch16();
            if (q === 0) this.wb(nn, r[R_A]);
            else r[R_A] = this.rb(nn);
            this.t += 13;
            return;
          }
        }
      case 3:
        this.setRP(p, (this.getRP(p, idx) + (q === 0 ? 1 : -1)) & 0xffff, idx);
        this.t += 6;
        return;
      case 4:
      case 5:
        if (y === 6) {
          const ea = this.ea(idx);
          const v = this.rb(ea);
          this.wb(ea, z === 4 ? this.inc8(v) : this.dec8(v));
          this.t += 11;
        } else {
          const v = this.getR(y, idx);
          this.setR(y, z === 4 ? this.inc8(v) : this.dec8(v), idx);
          this.t += 4;
        }
        return;
      case 6:
        if (y === 6) {
          const ea = idx === 0 ? this.hl : this.eaNoTime(idx);
          this.wb(ea, this.fetch8());
          this.t += idx === 0 ? 10 : 15;
        } else {
          this.setR(y, this.fetch8(), idx);
          this.t += 7;
        }
        return;
      default: {
        this.t += 4;
        const a = r[R_A];
        const keep = r[R_F] & (S | Z | PV);
        switch (y) {
          case 0: {
            const c = a >> 7;
            const o = ((a << 1) | c) & 255;
            r[R_A] = o;
            r[R_F] = keep | (o & YX) | c;
            return;
          }
          case 1: {
            const c = a & 1;
            const o = (a >> 1) | (c << 7);
            r[R_A] = o;
            r[R_F] = keep | (o & YX) | c;
            return;
          }
          case 2: {
            const o = ((a << 1) | (r[R_F] & CF)) & 255;
            r[R_A] = o;
            r[R_F] = keep | (o & YX) | (a >> 7);
            return;
          }
          case 3: {
            const o = (a >> 1) | ((r[R_F] & CF) << 7);
            r[R_A] = o;
            r[R_F] = keep | (o & YX) | (a & 1);
            return;
          }
          case 4:
            this.daa();
            return;
          case 5:
            r[R_A] = a ^ 0xff;
            r[R_F] = (r[R_F] & (S | Z | PV | CF)) | H | N | (r[R_A] & YX);
            return;
          case 6:
            r[R_F] = keep | (a & YX) | CF;
            return;
          default: {
            const oldC = r[R_F] & CF;
            r[R_F] = keep | (a & YX) | (oldC !== 0 ? H : 0) | (oldC ^ CF);
            return;
          }
        }
      }
    }
  }

  private execX3(y: number, z: number, p: number, q: number, idx: number): void {
    const r = this.r;
    switch (z) {
      case 0:
        if (this.cond(y)) {
          this.pc = this.pop();
          this.t += 11;
        } else this.t += 5;
        return;
      case 1:
        if (q === 0) {
          const v = this.pop();
          if (p === 0) this.bc = v;
          else if (p === 1) this.de = v;
          else if (p === 2) this.setHLx(idx, v);
          else this.af = v;
          this.t += 10;
          return;
        }
        switch (p) {
          case 0:
            this.pc = this.pop();
            this.t += 10;
            return;
          case 1:
            for (let k = 0; k < 6; k++) {
              const tmp = r[k];
              r[k] = this.r2[k];
              this.r2[k] = tmp;
            }
            this.t += 4;
            return;
          case 2:
            this.pc = this.getHLx(idx);
            this.t += 4;
            return;
          default:
            this.sp = this.getHLx(idx);
            this.t += 6;
            return;
        }
      case 2: {
        const nn = this.fetch16();
        if (this.cond(y)) this.pc = nn;
        this.t += 10;
        return;
      }
      case 3:
        switch (y) {
          case 0:
            this.pc = this.fetch16();
            this.t += 10;
            return;
          case 2: {
            const n = this.fetch8();
            this.onOut((r[R_A] << 8) | n, r[R_A]);
            this.t += 11;
            return;
          }
          case 3: {
            const n = this.fetch8();
            r[R_A] = this.onIn((r[R_A] << 8) | n) & 255;
            this.t += 11;
            return;
          }
          case 4: {
            const v = this.rw(this.sp);
            this.ww(this.sp, this.getHLx(idx));
            this.setHLx(idx, v);
            this.t += 19;
            return;
          }
          case 5: {
            const de = this.de;
            this.de = this.hl;
            this.hl = de;
            this.t += 4;
            return;
          }
          case 6:
            this.iff1 = false;
            this.iff2 = false;
            this.t += 4;
            return;
          default: // 7: EI (1 is the CB prefix, handled before)
            this.iff1 = true;
            this.iff2 = true;
            this.eiBlock = true;
            this.t += 4;
            return;
        }
      case 4: {
        const nn = this.fetch16();
        if (this.cond(y)) {
          this.push(this.pc);
          this.pc = nn;
          this.t += 17;
        } else this.t += 10;
        return;
      }
      case 5:
        if (q === 0) {
          this.push(p === 0 ? this.bc : p === 1 ? this.de : p === 2 ? this.getHLx(idx) : this.af);
          this.t += 11;
        } else {
          // q === 1: p 0 is CALL nn; DD/ED/FD (p 1..3) are prefixes handled before
          const nn = this.fetch16();
          this.push(this.pc);
          this.pc = nn;
          this.t += 17;
        }
        return;
      case 6:
        this.alu(y, this.fetch8());
        this.t += 7;
        return;
      default:
        this.push(this.pc);
        this.pc = y * 8;
        this.t += 11;
    }
  }

  private execCB(idx: number): void {
    const r = this.r;
    let ea = 0;
    if (idx !== 0) ea = this.eaNoTime(idx);
    const op = idx !== 0 ? this.fetch8() : this.fetchOp();
    const x = op >> 6;
    const y = (op >> 3) & 7;
    const z = op & 7;
    if (idx === 0 && z !== 6) {
      const v = r[z];
      if (x === 0) r[z] = this.rot(y, v);
      else if (x === 1) this.bit(y, v, v);
      else if (x === 2) r[z] = v & ~(1 << y);
      else r[z] = v | (1 << y);
      this.t += 8;
      return;
    }
    if (idx === 0) ea = this.hl;
    const v = this.rb(ea);
    // The DD/FD prefix already added 4 T-states to the indexed forms (20 and 23 in total).
    if (x === 1) {
      this.bit(y, v, ea >> 8);
      this.t += idx === 0 ? 12 : 16;
      return;
    }
    let res: number;
    if (x === 0) res = this.rot(y, v);
    else if (x === 2) res = v & ~(1 << y);
    else res = v | (1 << y);
    this.wb(ea, res);
    if (idx !== 0 && z !== 6) r[z] = res; // undocumented DDCB/FDCB register copy
    this.t += idx === 0 ? 15 : 19;
  }
  private bit(n: number, v: number, yxSrc: number): void {
    const set = (v & (1 << n)) !== 0;
    this.r[R_F] = (this.r[R_F] & CF) | H | (set ? (n === 7 ? S : 0) : Z | PV) | (yxSrc & YX);
  }

  private execED(op: number): void {
    const r = this.r;
    const x = op >> 6;
    const y = (op >> 3) & 7;
    const z = op & 7;
    const p = y >> 1;
    const q = y & 1;
    // The ED prefix itself (4 T-states) is already counted: times below are published minus 4.
    if (x === 1) {
      switch (z) {
        case 0: {
          const v = this.onIn(this.bc) & 255;
          r[R_F] = (r[R_F] & CF) | (v & (S | YX)) | (v === 0 ? Z : 0) | PARITY[v];
          if (y !== 6) r[y] = v;
          this.t += 8;
          return;
        }
        case 1:
          this.onOut(this.bc, y === 6 ? 0 : r[y]);
          this.t += 8;
          return;
        case 2:
          this.hl = q === 0 ? this.sbc16(this.hl, this.getRP(p, 0)) : this.adc16(this.hl, this.getRP(p, 0));
          this.t += 11;
          return;
        case 3: {
          const nn = this.fetch16();
          if (q === 0) this.ww(nn, this.getRP(p, 0));
          else this.setRP(p, this.rw(nn), 0);
          this.t += 16;
          return;
        }
        case 4: {
          const a = r[R_A];
          const out = -a & 255;
          r[R_A] = out;
          r[R_F] = (out & (S | YX)) | (out === 0 ? Z : 0) | (a & 15 ? H : 0) | (a === 0x80 ? PV : 0) | N | (a !== 0 ? CF : 0);
          this.t += 4;
          return;
        }
        case 5:
          this.iff1 = this.iff2;
          this.pc = this.pop();
          this.t += 10;
          return;
        case 6:
          this.im = [0, 0, 1, 2, 0, 0, 1, 2][y];
          this.t += 4;
          return;
        default:
          this.edMisc(y);
          return;
      }
    }
    if (x === 2 && y >= 4 && z <= 3) {
      this.block(y - 4, z);
      return;
    }
    this.t += 4; // ED NOP
  }

  private edMisc(y: number): void {
    const r = this.r;
    switch (y) {
      case 0:
        this.i = r[R_A];
        this.t += 5;
        return;
      case 1:
        this.rr = r[R_A];
        this.t += 5;
        return;
      case 2:
      case 3: {
        const v = y === 2 ? this.i : this.rr;
        r[R_A] = v;
        r[R_F] = (r[R_F] & CF) | (v & (S | YX)) | (v === 0 ? Z : 0) | (this.iff2 ? PV : 0);
        this.t += 5;
        return;
      }
      case 4:
      case 5: {
        const hl = this.hl;
        const m = this.mem[hl];
        if (y === 4) {
          this.mem[hl] = ((r[R_A] & 15) << 4) | (m >> 4);
          r[R_A] = (r[R_A] & 0xf0) | (m & 15);
        } else {
          this.mem[hl] = ((m << 4) | (r[R_A] & 15)) & 255;
          r[R_A] = (r[R_A] & 0xf0) | (m >> 4);
        }
        r[R_F] = (r[R_F] & CF) | (r[R_A] & (S | YX)) | (r[R_A] === 0 ? Z : 0) | PARITY[r[R_A]];
        this.t += 14;
        return;
      }
      default:
        this.t += 4;
    }
  }

  private block(kind: number, z: number): void {
    const r = this.r;
    const step = (kind & 1) !== 0 ? -1 : 1;
    const repeat = kind >= 2;
    let again: boolean;
    switch (z) {
      case 0: {
        // LDI/LDD/LDIR/LDDR
        const v = this.mem[this.hl];
        this.mem[this.de] = v;
        this.hl = (this.hl + step) & 0xffff;
        this.de = (this.de + step) & 0xffff;
        const bc = (this.bc - 1) & 0xffff;
        this.bc = bc;
        const n = (v + r[R_A]) & 255;
        r[R_F] = (r[R_F] & (S | Z | CF)) | (bc !== 0 ? PV : 0) | (n & 8) | ((n & 2) !== 0 ? 0x20 : 0);
        again = bc !== 0;
        break;
      }
      case 1: {
        // CPI/CPD/CPIR/CPDR
        const v = this.mem[this.hl];
        const a = r[R_A];
        const res = (a - v) & 255;
        const hf = (a ^ v ^ res) & H;
        this.hl = (this.hl + step) & 0xffff;
        const bc = (this.bc - 1) & 0xffff;
        this.bc = bc;
        const n = (res - (hf !== 0 ? 1 : 0)) & 255;
        r[R_F] =
          (r[R_F] & CF) |
          (res & S) |
          (res === 0 ? Z : 0) |
          hf |
          (bc !== 0 ? PV : 0) |
          N |
          (n & 8) |
          ((n & 2) !== 0 ? 0x20 : 0);
        again = bc !== 0 && res !== 0;
        break;
      }
      case 2: {
        // INI/IND/INIR/INDR
        const v = this.onIn(this.bc) & 255;
        this.mem[this.hl] = v;
        r[R_B] = (r[R_B] - 1) & 255;
        const k = v + ((r[R_C] + step) & 255);
        this.hl = (this.hl + step) & 0xffff;
        this.blockIoFlags(v, k);
        again = r[R_B] !== 0;
        break;
      }
      default: {
        // OUTI/OUTD/OTIR/OTDR
        const v = this.mem[this.hl];
        r[R_B] = (r[R_B] - 1) & 255;
        this.onOut(this.bc, v);
        this.hl = (this.hl + step) & 0xffff;
        this.blockIoFlags(v, v + r[R_L]);
        again = r[R_B] !== 0;
      }
    }
    if (repeat && again) {
      this.pc = (this.pc - 2) & 0xffff;
      this.t += 17; // 4 (prefix) already counted: 21 in all
    } else this.t += 12; // 16 in all
  }
  private blockIoFlags(v: number, k: number): void {
    const b = this.r[R_B];
    this.r[R_F] =
      (b & (S | YX)) | (b === 0 ? Z : 0) | ((v & 0x80) !== 0 ? N : 0) | (k > 255 ? H | CF : 0) | PARITY[(k & 7) ^ b];
  }
}
