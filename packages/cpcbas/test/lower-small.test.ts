/**
 * L4-SMALL on the simulator: INP, OUT, WAIT, FRAME, PAUSE, STOP, FRE, HIMEM, RANDOM, and follow-up 66
 * (a local DIM initialiser assigns each time the DIM is reached). Expected values come from the manual
 * (INP/OUT/WAIT: WAIT loops until (value XOR inversion) AND mask is not zero), the measured interpreter
 * transcripts (STOP: L4-SMALL) and the heap layout (lib/runtime/mem/heapinit.asm).
 */
import { describe, expect, it } from 'vitest';
import { normalise, runSource } from './compile-helper.js';
import type { RunOptions } from './z80sim/run.js';

const run = (source: string, options: RunOptions = {}): string => {
  const r = runSource(source, options);
  expect(r.built.problems).toEqual([]);
  expect(r.built.diagnostics.filter((d) => d.startsWith('E'))).toEqual([]);
  expect(r.stopped).toBe('rst0');
  return normalise(r.printer) as string;
};

describe('INP, OUT and WAIT', () => {
  it('INP puts the whole 16-bit port in BC and returns the byte read', () => {
    const ports: number[] = [];
    const out = run('PRINT INP(&F5AB)\nn = &7F00\nPRINT INP(n + 1)', {
      setup: (cpc) => {
        cpc.cpu.onIn = (port) => {
          if (port === 0xf5ab || port === 0x7f01) ports.push(port);
          return port & 0xff;
        };
      },
    });
    expect(out).toBe(' 171 \n 1 \n');
    expect(ports).toEqual([0xf5ab, 0x7f01]);
  });

  it('OUT writes the value to the whole port, constant and computed arguments', () => {
    const writes: [number, number][] = [];
    run('OUT &7F00, 140\np = &BC00\nv = 3\nOUT p + 1, v * 2', {
      setup: (cpc) => {
        cpc.cpu.onOut = (port, value) => {
          if (port === 0x7f00 || port === 0xbc01) writes.push([port, value]);
        };
      },
    });
    expect(writes).toEqual([
      [0x7f00, 140],
      [0xbc01, 6],
    ]);
  });

  const waitReads = (source: string, values: readonly number[]): number => {
    let reads = 0;
    run(source, {
      setup: (cpc) => {
        cpc.cpu.onIn = (port) => {
          if ((port & 0xffff) !== 0xf500) return 0xff;
          const v = values[Math.min(reads, values.length - 1)] as number;
          reads += 1;
          return v;
        };
      },
    });
    return reads;
  };

  it('WAIT port, mask reads until value AND mask is not zero', () => {
    expect(waitReads('WAIT &F500, 4', [0, 3, 8, 5])).toBe(4);
    expect(waitReads('WAIT &F500, 4', [4])).toBe(1);
  });

  it('WAIT port, mask, inversion reads until (value XOR inversion) AND mask is not zero', () => {
    expect(waitReads('WAIT &F500, 1, 1', [1, 1, 3, 0])).toBe(4);
    expect(waitReads('WAIT &F500, 6, 6', [6, 7, 1])).toBe(3);
  });

  it('WAIT evaluates its arguments once, not on every read', () => {
    let reads = 0;
    const out = run('DIM c AS INTEGER\nFUNCTION P() AS UINTEGER\n c = c + 1\n RETURN &HF500\nEND FUNCTION\nWAIT P(), 2, 1\nPRINT c', {
      setup: (cpc) => {
        cpc.cpu.onIn = (port) => {
          if (port !== 0xf500) return 0xff;
          return [1, 1, 0, 2][Math.min(reads++, 3)] as number;
        };
      },
    });
    expect(reads).toBe(4);
    expect(out).toBe(' 1 \n');
  });
});

describe('STOP', () => {
  it('prints Break in <line> on a fresh line and ends the program', () => {
    expect(run('10 PRINT "abc";\n20 STOP\n30 PRINT "not reached"')).toBe('abc\nBreak in 20\n');
  });
  it('needs no extra line end when the cursor is at the left edge', () => {
    expect(run('10 PRINT "x"\n20 STOP')).toBe('x\nBreak in 20\n');
  });
  it('prints the number of the line it stands on, with one and five digits', () => {
    expect(run('9 STOP')).toBe('Break in 9\n');
    expect(run('10 GOTO 60000\n60000 STOP')).toBe('Break in 60000\n');
  });
  it('a program with no line numbers says just Break', () => {
    expect(run('PRINT 1\nSTOP\nPRINT 2')).toBe(' 1 \nBreak\n');
  });
  it('works inside a SUB called from a loop', () => {
    expect(run('SUB S(n AS INTEGER)\n IF n = 2 THEN STOP\n PRINT n;\nEND SUB\nFOR i = 1 TO 3\n S(i)\nNEXT')).toBe(' 1 \nBreak\n');
  });
  it('in a SUB declared above the numbered lines says Break, not the main program\'s last line (R16)', () => {
    expect(run('SUB F\n STOP\nEND SUB\n10 PRINT "a"\n20 F\n30 END')).toBe('a\nBreak\n');
  });
  it('in a SUB with numbered lines says the line it stands on', () => {
    expect(run('10 F\n20 END\n30 SUB F\n40 STOP\n50 END SUB')).toBe('Break in 40\n');
  });
});

describe('FRE, HIMEM and RANDOM', () => {
  it('FRE(0) is the heap less its 4-byte dummy header and one block size word, and FRE("") agrees', () => {
    expect(run('PRINT FRE(0); FRE("")')).toBe(' 4762  4762 \n');
  });
  it('FRE falls when a string is allocated and recovers when it is released (a total: each extra free block costs its size word)', () => {
    expect(run('a = FRE(0)\nb$ = STRING$(100, "x")\nc = FRE(0)\nb$ = ""\nd = FRE(0)\nPRINT a > c; a - c >= 100; d > c; a - d < 8')).toBe('-1 -1 -1 -1 \n');
  });
  it('HIMEM is the last byte of the heap: below the private block at &9E00', () => {
    expect(run('PRINT HIMEM')).toBe(' 40447 \n');
  });
  it('RANDOM(n) stays in 0..n-1 and reaches every value of a small range', () => {
    expect(
      run(
        [
          'DIM seen(5) AS INTEGER',
          'bad = 0',
          'FOR i = 1 TO 300',
          ' r = RANDOM(6)',
          ' IF r < 0 OR r > 5 THEN bad = bad + 1 ELSE seen(r) = 1',
          ' IF RANDOM(1) <> 0 THEN bad = bad + 1',
          ' IF RANDOM(0) <> 0 THEN bad = bad + 1',
          ' IF RANDOM(1000) > 999 THEN bad = bad + 1',
          ' IF RANDOM(65535) > 65534 THEN bad = bad + 1',
          'NEXT',
          'PRINT bad; seen(0) + seen(1) + seen(2) + seen(3) + seen(4) + seen(5)',
        ].join('\n'),
      ),
    ).toBe(' 0  6 \n');
  });
  it('RANDOM varies from call to call', () => {
    expect(run('DIM d AS INTEGER\nFOR i = 1 TO 20\n IF RANDOM(60000) <> RANDOM(60000) THEN d = d + 1\nNEXT\nPRINT d > 15')).toBe('-1 \n');
  });
});

describe('FRAME and PAUSE', () => {
  it('FRAME returns after the firmware flyback wait', () => {
    expect(run('FRAME\nFRAME\nPRINT "ok"')).toBe('ok\n');
  });
  it('PAUSE n lasts about n frames (80000 T-states each)', () => {
    const r = runSource('PAUSE 10');
    expect(r.stopped).toBe('rst0');
    expect(r.tstates).toBeGreaterThan(9 * 80000);
    expect(r.tstates).toBeLessThan(12 * 80000);
  });
  it('PAUSE 0 waits for a key and returns once one is typed', () => {
    const waiting = runSource('PAUSE 0\nPRINT "key"', { maxTStates: 8_000_000, setup: (cpc) => cpc.fw(0xbb0c, 'KM CHAR RETURN', [], () => undefined) });
    expect(waiting.stopped).toBe('limit');
    const keyed = runSource('PAUSE 0\nPRINT "key"', { keys: 'a', setup: (cpc) => cpc.fw(0xbb0c, 'KM CHAR RETURN', [], () => undefined) });
    expect(normalise(keyed.printer)).toBe('key\n');
  });
});

describe('a local DIM initialiser assigns each time the DIM is reached (follow-up 66)', () => {
  it('a constant and a call, in a loop', () => {
    expect(
      run(
        [
          'FUNCTION F() AS INTEGER',
          ' RETURN 5',
          'END FUNCTION',
          'SUB T()',
          ' DIM i AS INTEGER',
          ' FOR i = 1 TO 3',
          '  DIM a AS INTEGER = 5',
          '  a = a + 1',
          '  PRINT a;',
          ' NEXT',
          ' PRINT',
          ' FOR i = 1 TO 3',
          '  DIM b AS INTEGER = F()',
          '  b = b + 1',
          '  PRINT b;',
          ' NEXT',
          ' PRINT',
          'END SUB',
          'T()',
        ].join('\n'),
      ),
    ).toBe(' 6  6  6 \n 6  6  6 \n');
  });
  it('a constant after a GOTO back over the DIM', () => {
    expect(
      run(['SUB T()', ' DIM n AS INTEGER', ' n = 0', '10 DIM a AS INTEGER = 5', ' a = a + 1', ' PRINT a;', ' n = n + 1', ' IF n < 3 THEN GOTO 10', ' PRINT', 'END SUB', 'T()'].join('\n')),
    ).toBe(' 6  6  6 \n');
  });
});
