/**
 * R16: docs/keywords.md "Bare-metal builds" against the compiler. Every row whose Bare column is `E270` has a sample here,
 * and a bare build (`-D CPC_BAREMETAL`) of the sample is refused with E270 whose message names the statement; the same
 * sample compiles in a firmware build (so the refusal is the bare one, not some other error). Milestone item 2 of L4.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile } from '../src/index.js';
import { libTree } from './runtime-tree.js';
import { repoRoot } from './z80sim/run.js';

/** Row (as the table writes it) -> samples, each with the name its E270 message must contain. */
const SAMPLES: Record<string, { src: string; name: string }[]> = {
  SOUND: [{ src: 'SOUND 1, 100, 10', name: 'SOUND' }],
  ENV: [{ src: 'ENV 1, 10, 1, 1', name: 'ENV' }],
  ENT: [{ src: 'ENT 1, 10, 1, 1', name: 'ENT' }],
  RELEASE: [{ src: 'RELEASE 1', name: 'RELEASE' }],
  SQ: [{ src: 'x = SQ(1)', name: 'SQ' }],
  'SPEED INK': [{ src: 'SPEED INK 10, 10', name: 'SPEED INK' }],
  MASK: [{ src: 'MASK 255', name: 'MASK' }],
  FILL: [{ src: 'FILL 1', name: 'FILL' }],
  WINDOW: [{ src: 'WINDOW 1, 20, 1, 10', name: 'WINDOW' }],
  'WINDOW SWAP': [{ src: 'WINDOW SWAP 0, 1', name: 'WINDOW SWAP' }],
  'TAG, TAGOFF': [
    { src: 'TAG', name: 'TAG' },
    { src: 'TAGOFF', name: 'TAGOFF' },
  ],
  COPYCHR$: [{ src: 'x$ = COPYCHR$(#0)', name: 'COPYCHR$' }],
  '`#s` of PRINT, LOCATE, CLS, PEN, PAPER, POS, VPOS (s = 1-7, 8)': [
    { src: 'PRINT #1, "x"', name: 'PRINT' },
    { src: 'PRINT #8, "x"', name: 'PRINT' },
    { src: 'LOCATE #2, 1, 1', name: 'LOCATE' },
    { src: 'CLS #3', name: 'CLS' },
    { src: 'PEN #4, 1', name: 'PEN' },
    { src: 'PAPER #5, 0', name: 'PAPER' },
    { src: 'x = POS(#6)', name: 'POS' },
    { src: 'x = VPOS(#7)', name: 'VPOS' },
  ],
  WIDTH: [{ src: 'WIDTH 80', name: 'WIDTH' }],
  KEY: [{ src: 'KEY 128, "RUN"', name: 'KEY' }],
  'KEY DEF': [{ src: 'KEY DEF 66, 1, 65', name: 'KEY DEF' }],
  'SPEED KEY': [{ src: 'SPEED KEY 10, 5', name: 'SPEED KEY' }],
  'ON BREAK STOP': [{ src: 'ON BREAK STOP', name: 'ON BREAK STOP' }],
  '`#s` of INPUT and LINE INPUT (s = 1-7)': [
    { src: 'INPUT #1, a$', name: 'INPUT' },
    { src: 'LINE INPUT #7, a$', name: 'LINE INPUT' },
  ],
  'OPENIN, CLOSEIN, EOF': [
    { src: 'OPENIN "A"', name: 'OPENIN' },
    { src: 'CLOSEIN', name: 'CLOSEIN' },
    { src: 'x = EOF', name: 'EOF' },
  ],
  'OPENOUT, CLOSEOUT': [
    { src: 'OPENOUT "A"', name: 'OPENOUT' },
    { src: 'CLOSEOUT', name: 'CLOSEOUT' },
  ],
  'INPUT #9, LINE INPUT #9, PRINT #9, WRITE': [
    { src: 'INPUT #9, a$', name: 'INPUT' },
    { src: 'LINE INPUT #9, a$', name: 'LINE INPUT' },
    { src: 'PRINT #9, "x"', name: 'PRINT' },
    { src: 'WRITE "x"', name: 'WRITE' },
  ],
  'LOAD, SAVE, CAT': [
    { src: 'LOAD "A", &4000', name: 'LOAD' },
    { src: 'SAVE "A", B, &4000, 10', name: 'SAVE' },
    { src: 'CAT', name: 'CAT' },
  ],
  CHAIN: [{ src: 'CHAIN "A"', name: 'CHAIN' }],
  DERR: [{ src: 'x = DERR', name: 'DERR' }],
};

/** The E270 rows of the bare table, by their first column. */
function e270Rows(): string[] {
  const text = readFileSync(join(repoRoot, 'docs/keywords.md'), 'utf8');
  const section = text.slice(text.indexOf('## Bare-metal builds'));
  const rows: string[] = [];
  for (const line of section.split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length >= 5 && cells[3] === 'E270') rows.push(cells[1] as string);
  }
  return rows;
}

function errors(src: string, bare: boolean): { code: string; message: string }[] {
  const r = compile({
    files: new Map([['t.bas', `${src}\n`]]),
    main: 't.bas',
    defines: bare ? { CPC_BAREMETAL: '' } : {},
    runtime: libTree(),
    options: { format: 'bin' },
  });
  return r.diagnostics.filter((d) => d.severity === 'error').map((d) => ({ code: d.code, message: d.message }));
}

describe('the bare table of docs/keywords.md (R16)', () => {
  const rows = e270Rows();
  it('has a sample for every E270 row and no sample for a row it lacks', () => {
    expect(rows.length).toBeGreaterThan(20);
    expect([...rows].sort()).toEqual(Object.keys(SAMPLES).sort());
  });
  for (const row of rows) {
    for (const { src, name } of SAMPLES[row] ?? []) {
      it(`${row}: \`${src}\` is E270 naming ${name} in a bare build, and compiles in a firmware build`, () => {
        const bare = errors(src, true);
        expect(bare.map((e) => e.code)).toEqual(['E270']);
        expect(bare[0]?.message).toContain(name);
        expect(errors(src, false)).toEqual([]);
      });
    }
  }
});

describe('the rows a bare build compiles (R16)', () => {
  const ok = [
    'x = INP(&F500)', 'OUT &BC00, 0', 'WAIT &F500, 1', 'FRAME', 'PAUSE 1', 'x = FRE(0)', 'x = HIMEM', 'x = RANDOM(6)',
    'EVERY 50 GOSUB 10\nx = REMAIN(0)\nDI\nEI\nEND\n10 RETURN', 'x = TIME', 'BEEP 0.1, 0', 'PLOT 1, 1', 'PLOTR 1, 1', 'MOVE 1, 1',
    'MOVER 1, 1', 'DRAW 1, 1', 'DRAWR 1, 1', 'x = TEST(1, 1)', 'x = TESTR(1, 1)', 'x = XPOS + YPOS', 'CLG', 'GRAPHICS PAPER 0',
    'CIRCLE 100, 100, 10', 'ORIGIN 1, 1', 'GRAPHICS PEN 1', 'INK 1, 2', 'ZONE 5', 'SYMBOL 240, 1, 2, 3', 'SYMBOL AFTER 240',
    'PRINT USING "##"; 1', 'ON ERROR GOTO 10\nERROR 5\nEND\n10 PRINT ERR; ERL\nRESUME NEXT', 'x = INKEY(66)', 'x = JOY(0)',
    'CLEAR INPUT', 'INPUT a$', 'LINE INPUT a$', 'ON BREAK CONT', 'STOP',
  ];
  for (const src of ok) {
    it(`\`${src.split('\n')[0]}\` compiles bare`, () => {
      expect(errors(src, true)).toEqual([]);
    });
  }
});
