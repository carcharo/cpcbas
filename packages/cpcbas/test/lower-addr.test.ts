/**
 * L3-ADDR on the simulator: `@` of locals, parameters, SUBs and line labels; the CALL string
 * descriptor (spec section 18); a recursive CALL with a computed
 * address (follow-up 33). Expected values come from the spec and hand-assembled Z80 routines.
 */
import { describe, expect, it } from 'vitest';
import { normalise, runSource } from './compile-helper.js';
import type { AssembledRun } from './z80sim/run.js';

function exec(source: string): AssembledRun {
  const r = runSource(source, {}, true);
  expect(r.built.problems).toEqual([]);
  expect(r.stopped).toBe('rst0');
  return r;
}
const run = (source: string): string => normalise(exec(source).printer) as string;
const word = (r: AssembledRun, a: number): number => (r.memory[a] as number) | ((r.memory[a + 1] as number) << 8);

/** Heap bytes free: the sum of the free list's blocks (as lower-str.test.ts). */
function heapFree(r: AssembledRun): number {
  const heap = r.image.addr('.core.ZXBASIC_MEM_HEAP');
  let total = 0;
  let p = word(r, heap + 2);
  let guard = 0;
  while (p !== 0 && guard++ < 10000) {
    total += word(r, p);
    p = word(r, p + 2);
  }
  return total;
}

// Routine at &C7D0: HL = the descriptor (the single CALL argument); (&C7F0) = its length byte,
// (&C7F1) = the first character, read through the text address.
//   ld l,(ix+0) / ld h,(ix+1) / ld a,(hl) / ld (&C7F0),a / inc hl / ld e,(hl) / inc hl / ld d,(hl)
//   / ld a,(de) / ld (&C7F1),a / ret
const READER = [0xdd, 0x6e, 0x00, 0xdd, 0x66, 0x01, 0x7e, 0x32, 0xf0, 0xc7, 0x23, 0x5e, 0x23, 0x56, 0x1a, 0x32, 0xf1, 0xc7, 0xc9];
const pokeReader = READER.map((b, i) => `POKE &C7D0+${i},${b}`).join(':');

describe('the CALL string descriptor', () => {
  it('@a$ gives the length and the first character through the descriptor', () => {
    expect(run(`${pokeReader}\na$="hello"\nCALL &C7D0, @a$\nPRINT PEEK(&C7F0); PEEK(&C7F1)`)).toBe(' 5  104 \n');
  });
  it('a computed string ("xy" + b$) gets a descriptor and is freed after the CALL', () => {
    const src = `${pokeReader}\nb$="z"\nCALL &C7D0, "xy" + b$\nPRINT PEEK(&C7F0); PEEK(&C7F1)`;
    expect(run(src)).toBe(' 3  120 \n');
    const loop = (n: number): AssembledRun => exec(`${pokeReader}\nb$="z"\nFOR i=1 TO ${n}\nCALL &C7D0, "xy" + b$\nNEXT`);
    expect(heapFree(loop(200))).toBe(heapFree(loop(2)));
  });
  it('a literal and a string variable work as arguments, the empty string has length 0', () => {
    expect(run(`${pokeReader}\nCALL &C7D0, "Q"\nPRINT PEEK(&C7F0); PEEK(&C7F1)\nc$="abc"\nCALL &C7D0, c$\nPRINT PEEK(&C7F0); PEEK(&C7F1)\nd$=""\nCALL &C7D0, d$\nPRINT PEEK(&C7F0)`)).toBe(' 1  81 \n 3  97 \n 0 \n');
  });
  it('the length byte is capped at 255', () => {
    expect(run(`${pokeReader}\na$=STRING$(300,"k")\nCALL &C7D0, @a$\nPRINT PEEK(&C7F0); PEEK(&C7F1); LEN(a$)`)).toBe(' 255  107  300 \n');
  });
  it('the text address is the variable\'s own text: a routine that writes into it changes the variable', () => {
    // ld l,(ix+0) / ld h,(ix+1) / inc hl / ld e,(hl) / inc hl / ld d,(hl) / ld a,66 / ld (de),a / ret
    const code = [0xdd, 0x6e, 0x00, 0xdd, 0x66, 0x01, 0x23, 0x5e, 0x23, 0x56, 0x3e, 0x42, 0x12, 0xc9];
    const pokes = code.map((b, i) => `POKE &C7D0+${i},${b}`).join(':');
    expect(run(`${pokes}\na$="hello"\nCALL &C7D0, @a$\nPRINT a$`)).toBe('Bello\n');
  });
  it('two computed strings in one CALL get two descriptors, both freed after it (R11)', () => {
    // ld l,(ix+0) / ld h,(ix+1) / ld a,(hl) / ld (&C7F0),a / ld l,(ix+2) / ld h,(ix+3) / ld a,(hl) / ld (&C7F1),a / ret
    const code = [0xdd, 0x6e, 0x00, 0xdd, 0x66, 0x01, 0x7e, 0x32, 0xf0, 0xc7, 0xdd, 0x6e, 0x02, 0xdd, 0x66, 0x03, 0x7e, 0x32, 0xf1, 0xc7, 0xc9];
    const pokes = code.map((b, i) => `POKE &C7D0+${i},${b}`).join(':');
    const call = 'CALL &C7D0, "abc" + b$, b$ + "z"';
    expect(run(`${pokes}\nb$="pq"\n${call}\nPRINT PEEK(&C7F1); PEEK(&C7F0)`)).toBe(' 5  3 \n');
    const loop = (n: number): AssembledRun => exec(`${pokes}\nb$="pq"\nFOR i=1 TO ${n}\n${call}\nNEXT`);
    expect(heapFree(loop(200))).toBe(heapFree(loop(2)));
  });
  it('a descriptor in a procedure works, with the numbers around it in order', () => {
    // two arguments, the last at ix+0: the descriptor (its length to &C7F0), then the number at ix+2 (to &C7F2)
    const code = [0xdd, 0x6e, 0x00, 0xdd, 0x66, 0x01, 0x7e, 0x32, 0xf0, 0xc7, 0xdd, 0x6e, 0x02, 0xdd, 0x66, 0x03, 0x22, 0xf2, 0xc7, 0xc9];
    const pokes = code.map((b, i) => `POKE &C7D0+${i},${b}`).join(':');
    const src = `${pokes}\nSUB Go(s AS STRING)\nCALL &C7D0, 77, s + "!"\nEND SUB\nGo("abc")\nPRINT PEEK(&C7F0); PEEK(UINTEGER, &C7F2)`;
    expect(run(src)).toBe(' 4  77 \n');
  });
});

describe('@ of a string variable outside CALL', () => {
  it('is the 2-byte slot: PEEK of it gives the heap pointer of the text', () => {
    // the pointer addresses the length word, then the text
    expect(run('a$="hey"\np=PEEK(UINTEGER,@a$)\nPRINT PEEK(UINTEGER,p); PEEK(p+2)')).toBe(' 3  104 \n');
  });
  it('a local string variable', () => {
    expect(run('SUB S()\nDIM t$ AS STRING\nt$="ab"\np=PEEK(UINTEGER,@t$)\nPRINT PEEK(UINTEGER,p)\nEND SUB\nS()')).toBe(' 2 \n');
  });
});

describe('@ of locals, parameters, SUBs and labels', () => {
  it('@local POKEd changes the local', () => {
    expect(run('SUB S()\nDIM x AS UBYTE\nPOKE @x, 7\nPRINT x\nEND SUB\nS()')).toBe(' 7 \n');
  });
  it('@parameter is the parameter, a BYREF parameter gives the caller\'s variable', () => {
    const src = 'SUB B(v AS UINTEGER)\nPOKE UINTEGER, @v, 4660\nPRINT v\nEND SUB\nSUB R(BYREF w AS UBYTE)\nPOKE @w, 9\nEND SUB\nB(1)\nq=1\nDIM z AS UBYTE\nR(z)\nPRINT z';
    expect(run(src)).toBe(' 4660 \n 9 \n');
  });
  it('CALL @Sub runs the SUB', () => {
    expect(run('SUB Hi()\nPRINT "hi"\nEND SUB\nCALL @Hi\nPRINT "after"')).toBe('hi\nafter\n');
  });
  it('@Sub is a plain address: stored in a variable, called later', () => {
    expect(run('SUB Hi()\nPRINT "hi"\nEND SUB\na=@Hi\nCALL a\nPRINT a=@Hi')).toBe('hi\n-1 \n');
  });
  it('@ of a line label is its code address (a number after @ is a syntax error)', () => {
    expect(run('x=@one\ny=@two\nPRINT y>x; y<x; y-x>0\none:\nPRINT 1\ntwo:\nPRINT @one=x')).toBe('-1  0 -1 \n 1 \n-1 \n');
  });
});

describe('CALL with a computed address (follow-up 33)', () => {
  it('a recursive CALL keeps each level\'s own address', () => {
    // routine i at &C800+16*i: ld a,i / ld (&C900+i),a / ret
    const src = [
      'FOR i=1 TO 2',
      'base=&C800+16*i',
      'POKE base,&3E:POKE base+1,i:POKE base+2,&32:POKE base+3,i:POKE base+4,&C9:POKE base+5,&C9',
      'NEXT',
      'FUNCTION F(n AS UINTEGER) AS UINTEGER',
      'IF n > 0 THEN CALL &C800 + n * 16, F(n - 1)',
      'RETURN n',
      'END FUNCTION',
      'x = F(2)',
      'PRINT PEEK(&C901); PEEK(&C902); x',
    ].join('\n');
    expect(run(src)).toBe(' 1  2  2 \n');
  });
});
