/**
 * Every tests/parse-corpus/valid program and every tests/loco conformance program goes
 * through bind and check. Only the diagnostics listed in EXPECTED may appear (line:col code,
 * with a reason per file); a file listed with `gated` may also give E002 "not implemented
 * yet" for features outside the L2 subset (src/checker/subset.ts).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bind } from '../src/binder/index.js';
import { check, checkProgram } from '../src/checker/index.js';
import { DiagnosticBag } from '../src/core/diagnostics.js';
import { SourceSet } from '../src/core/source.js';
import { runFrontEnd } from '../src/pipeline.js';
import { basFiles, corpusTree, expectations, INCLUDE_PATHS } from './corpus-files.js';

const tree = corpusTree();

interface Expect {
  /** Checker diagnostics (binder ones too) other than E002 that the file is expected to give. */
  readonly diagnostics: string[];
  /** The file uses features outside the L2 subset: E002 diagnostics are allowed (at least one is required). */
  readonly gated: boolean;
  readonly reason: string;
}

const EXPECTED = new Map<string, Expect>([
  [
    'valid/02-types-dim.bas',
    {
      diagnostics: [],
      gated: false,
      reason: 'global arrays are in the subset since L3-ARR-LOWER; nothing else here is gated',
    },
  ],
  [
    'valid/04-expressions.bas',
    {
      diagnostics: [],
      gated: false,
      reason: 'global arrays are in the subset since L3-ARR-LOWER; nothing else here is gated',
    },
  ],
  [
    'valid/05-if-forms.bas',
    {
      diagnostics: [],
      gated: false,
      reason: 'INPUT, INKEY, JOY and ON BREAK are in the subset since L4-KEYS; nothing else here is gated',
    },
  ],
  [
    'valid/06-for-next.bas',
    {
      diagnostics: ['26:9 W301', '26:18 W301', '26:32 W301'],
      gated: false, // L4-GFX: its graphics statements are in the subset
      reason: 'a loop-syntax snippet whose bounds first, last and stride are never assigned',
    },
  ],
  [
    'valid/07-while-do.bas',
    {
      diagnostics: [],
      gated: false,
      reason: 'INPUT, INKEY, JOY and ON BREAK are in the subset since L4-KEYS; nothing else here is gated',
    },
  ],
  [
    'valid/09-jumps.bas',
    {
      diagnostics: [],
      gated: false,
      reason: 'INPUT, INKEY, JOY and ON BREAK are in the subset since L4-KEYS; nothing else here is gated',
    },
  ],
  [
    'valid/10-timers-errors.bas',
    {
      diagnostics: [],
      gated: false,
      reason: 'compiles since L4 wave 1 (timers, errors, keyboard, sound, graphics, text merged)',
    },
  ],
  [
    'valid/11-sub-function.bas',
    {
      diagnostics: ['3:1 W305', '4:1 W305', '81:26 E236', '82:1 E205', '83:7 E204'],
      gated: false,
      reason:
        'DECLARE SUB/FUNCTION with no definition gets W305 and declares nothing (E205, E204, as in the binder test); FindFirst("HELLO", 76) passes a string literal to a BYREF parameter (E236)',
    },
  ],
  [
    'valid/12-def-fn.bas',
    {
      diagnostics: [],
      gated: false,
      reason: 'SQR, INT and RND are in the subset since L2-CG-REAL',
    },
  ],
  [
    'valid/13-print.bas',
    {
      diagnostics: [],
      gated: false,
      reason: 'uses statements or functions outside the L2 subset (src/checker/subset.ts)',
    },
  ],
  [
    'valid/14-input-data.bas',
    {
      diagnostics: [],
      gated: false,
      reason: 'INPUT, INKEY, JOY and ON BREAK are in the subset since L4-KEYS; nothing else here is gated',
    },
  ],
  [
    'valid/15-builtin-screen.bas',
    {
      diagnostics: [],
      gated: false,
      reason: 'compiles since L4 wave 1 (graphics: L4-GFX; windows, streams, SYMBOL: L4-TEXT)',
    },
  ],
  [
    'valid/16-builtin-graphics.bas',
    {
      diagnostics: [],
      gated: false, // L4-GFX: its graphics statements are in the subset
      reason: 'graphics statements are in the subset since L4-GFX; nothing else here is gated',
    },
  ],
  [
    'valid/17-builtin-input-sound.bas',
    {
      diagnostics: [],
      gated: false,
      reason: 'compiles since L4 wave 1 (timers, errors, keyboard, sound, graphics, text merged)',
    },
  ],
  [
    'valid/18-builtin-time-math.bas',
    {
      diagnostics: [],
      gated: false,
      reason: 'FRAME and RANDOM (L4-SMALL) and TIME (L4-EVENTS) compile since L4 wave 1; nothing here is gated',
    },
  ],
  [
    'valid/19-builtin-strings-arrays.bas',
    {
      diagnostics: [],
      gated: false,
      reason: 'arrays (L3-ARR-LOWER) and the string features (L3-STR) are in the subset; nothing here is gated',
    },
  ],
  [
    'valid/20-builtin-memory-files.bas',
    {
      diagnostics: ['13:1 E279'],
      gated: false,
      reason: 'the files compile since L4-FILES; SAVE "SCREEN.BIN" (no B, no address) is E279: a compiled program has no BASIC text to save',
    },
  ],
  [
    'valid/21-call-rsx-address.bas',
    {
      diagnostics: ['35:47 W301'],
      gated: true,
      reason:
        'KM_WAIT_KEY is a built-in firmware constant and binds clean; CALL ..., "text" (a string expression that is not @var) is E002 in L2 (review R6); 35:47 is an unassigned CALL argument',
    },
  ],
  [
    'valid/26-listing-bounce.bas',
    {
      diagnostics: [],
      gated: false, // L4-GFX: its graphics statements are in the subset
      reason: 'graphics statements are in the subset since L4-GFX; nothing else here is gated',
    },
  ],
  [
    'valid/27-listing-unclosed-string.bas',
    {
      diagnostics: [],
      gated: false,
      reason: 'INPUT, INKEY, JOY and ON BREAK are in the subset since L4-KEYS; nothing else here is gated',
    },
  ],
  [
    'valid/28-listing-quiz.bas',
    {
      diagnostics: [],
      gated: false,
      reason: 'INPUT, INKEY, JOY and ON BREAK are in the subset since L4-KEYS; nothing else here is gated',
    },
  ],
  [
    'valid/29-sinclair-aliases.bas',
    {
      diagnostics: [],
      gated: false,
      reason: 'the aliases compile since L4 wave 1 (BEEP: L4-SOUND; CIRCLE, POINT: L4-GFX; PAUSE: L4-SMALL)',
    },
  ],
  [
    'valid/30-game-title-screen.bas',
    {
      diagnostics: [],
      gated: false,
      reason: 'compiles since L4 wave 1 (timers, errors, keyboard, sound, graphics, text merged)',
    },
  ],
  [
    'valid/31-game-sprite-sub.bas',
    {
      diagnostics: [],
      gated: false, // L4-GFX: its graphics statements are in the subset
      reason: 'graphics statements are in the subset since L4-GFX; nothing else here is gated',
    },
  ],
  [
    'valid/32-game-main-loop.bas',
    {
      diagnostics: [],
      gated: false,
      reason: 'compiles since L4 wave 1 (timers, errors, keyboard, sound, graphics, text merged)',
    },
  ],
  [
    'valid/33-generated-data-tables.bas',
    {
      diagnostics: [],
      gated: false, // L4-GFX: its graphics statements are in the subset
      reason: 'graphics statements are in the subset since L4-GFX; nothing else here is gated',
    },
  ],
  [
    'valid/loco-01-flow.bas',
    {
      diagnostics: [],
      gated: false,
      reason: 'STOP is in the subset since L4-SMALL; nothing else here is gated',
    },
  ],
  [
    'valid/loco-02-data.bas',
    {
      diagnostics: [],
      gated: false,
      reason: 'global arrays are in the subset since L3-ARR-LOWER; nothing else here is gated',
    },
  ],
  [
    'valid/loco-03-print-layout.bas',
    {
      diagnostics: [],
      gated: false,
      reason: 'uses statements or functions outside the L2 subset (src/checker/subset.ts)',
    },
  ],
  [
    'valid/loco-04-print-using.bas',
    {
      diagnostics: [],
      gated: false,
      reason: 'uses statements or functions outside the L2 subset (src/checker/subset.ts)',
    },
  ],
  [
    'valid/loco-05-strings.bas',
    {
      diagnostics: [],
      gated: false,
      reason: 'HEX$, BIN$, DEC$ and the MID$ statement are in the subset since L3-STR',
    },
  ],
  [
    'valid/loco-06-numbers.bas',
    {
      diagnostics: ['20:9 W301', '20:21 W301', '20:36 W301'],
      gated: false,
      reason: 'a snippet reading a, b and c that are never assigned (TIME is in the subset since L4-EVENTS)',
    },
  ],
  [
    'valid/loco-07-types-def.bas',
    {
      diagnostics: ['8:55 E230', '11:15 E230', '12:22 E230', '15:23 E230', '18:13 E230'],
      gated: false,
      reason: 'a syntax listing whose DEFINT i-n and DEFSTR s, t-u make note, table, FNsquare and z mix STRING and INTEGER: real type mismatches (E230)',
    },
  ],
  [
    'valid/loco-08-timers.bas',
    {
      diagnostics: [],
      gated: false,
      reason: 'compiles since L4 wave 1 (timers, errors, keyboard, sound, graphics, text merged)',
    },
  ],
  [
    'valid/loco-09-errors.bas',
    {
      diagnostics: [],
      gated: false,
      reason: 'ON ERROR, RESUME, ERROR, ERR and ERL are in the subset since L4-ERR',
    },
  ],
  [
    'valid/loco-10-screen.bas',
    {
      diagnostics: [],
      gated: false,
      reason: 'compiles since L4 wave 1 (timers, errors, keyboard, sound, graphics, text merged)',
    },
  ],
  [
    'valid/loco-11-windows-symbols.bas',
    {
      diagnostics: [],
      gated: false,
      reason: 'compiles since L4 wave 1 (graphics: L4-GFX; windows, streams, SYMBOL: L4-TEXT)',
    },
  ],
  [
    'valid/loco-12-graphics.bas',
    {
      diagnostics: [],
      gated: false, // L4-GFX: its graphics statements are in the subset
      reason: 'graphics statements are in the subset since L4-GFX; nothing else here is gated',
    },
  ],
  [
    'valid/loco-13-keyboard.bas',
    {
      diagnostics: [],
      gated: false,
      reason: 'INPUT, INKEY, JOY and ON BREAK are in the subset since L4-KEYS; nothing else here is gated',
    },
  ],
  [
    'valid/loco-15-memory-machine.bas',
    {
      diagnostics: ['17:17 W301', '17:20 W301', '17:24 W301'],
      gated: true,
      reason: 'SIZEOF(buf), SIZEOF(w) and a CALL argument read variables never assigned in the snippet',
    },
  ],
  [
    'valid/loco-16-files.bas',
    {
      diagnostics: ['8:9 W301', '9:4 E279', '10:17 E279', '11:17 E279'],
      gated: false,
      reason: 'LOAD f$ reads a file name variable never assigned in the snippet; SAVE "prog", SAVE "prog", A and SAVE "prog", P save BASIC, which is E279 (L4-FILES)',
    },
  ],
  [
    'valid/loco-17-listing-guess.bas',
    {
      diagnostics: [],
      gated: false,
      reason: 'compiles since L4 wave 1 (timers, errors, keyboard, sound, graphics, text merged)',
    },
  ],
  [
    'valid/loco-18-listing-bars.bas',
    {
      diagnostics: [],
      gated: false,
      reason: 'uses statements or functions outside the L2 subset (src/checker/subset.ts)',
    },
  ],
  [
    'valid/loco-19-listing-sprite.bas',
    {
      diagnostics: [],
      gated: false,
      reason: 'compiles since L4 wave 1 (timers, errors, keyboard, sound, graphics, text merged)',
    },
  ],
  [
    'valid/loco-20-listing-sort.bas',
    {
      diagnostics: ['5:18 E233', '9:28 E230', '9:56 E230', '16:35 E230'],
      gated: false,
      reason: 'a listing with DIM w(n) (a run-time bound, E233 here) and DEFSTR w with INTEGER t and f: real type mismatches (E230)',
    },
  ],
  [
    'valid/loco-21-listing-loader.bas',
    {
      diagnostics: [],
      gated: true,
      reason: 'uses statements or functions outside the L2 subset (src/checker/subset.ts)',
    },
  ],
  [
    'valid/loco-23-syntax-forms.bas',
    {
      diagnostics: ['8:17 E279', '9:17 E279'],
      gated: true,
      reason: 'uses statements or functions outside the L2 subset (src/checker/subset.ts)',
    },
  ],
  [
    'valid/loco-input-semicolon.bas',
    {
      diagnostics: [],
      gated: false,
      reason: 'INPUT, INKEY, JOY and ON BREAK are in the subset since L4-KEYS; nothing else here is gated',
    },
  ],
]);

function run(path: string, subset: boolean): { front: string[]; rest: string[]; ok: boolean } {
  const sources = new SourceSet();
  const front = new DiagnosticBag();
  const { program } = runFrontEnd({ files: tree, main: path, includePaths: INCLUDE_PATHS }, sources, front);
  const diag = new DiagnosticBag();
  const bound = bind({ program, sources, diagnostics: diag, bareMetal: false });
  const input = { bound, sources, diagnostics: diag };
  const checked = subset ? check(input) : checkProgram(input, { subset: false });
  const fmt = (d: { span: { file: number; start: number }; code: string }): string => {
    const p = sources.position(d.span.file as never, d.span.start);
    return `${p.line}:${p.col} ${d.code}`;
  };
  return {
    front: front.all().map(fmt),
    rest: diag.all().map(fmt),
    ok: checked.ok,
  };
}

const VALID = [...basFiles('valid'), ...basFiles('valid/inc')];

describe('checker over the parse corpus', () => {
  it.each(VALID)('%s checks with no unexpected diagnostic', (path) => {
    const { front, rest, ok } = run(path, true);
    expect(front).toEqual(expectations(path));
    const exp = EXPECTED.get(path);
    const e002 = rest.filter((d) => d.endsWith(' E002'));
    if (exp?.gated) expect(e002.length).toBeGreaterThan(0);
    else expect(e002).toEqual([]);
    expect(rest.filter((d) => !d.endsWith(' E002'))).toEqual(exp?.diagnostics ?? []);
    expect(ok).toBe(!rest.some((d) => /E\d+$/.test(d)));
  });

  it('with the subset gate off, no valid program gives a checker error beyond the listed ones', () => {
    for (const path of VALID) {
      const { rest } = run(path, false);
      const exp = EXPECTED.get(path)?.diagnostics ?? [];
      expect(
        rest.filter((d) => !exp.includes(d) && /E\d+$/.test(d)),
        path,
      ).toEqual([]);
    }
  });

  it('checking twice gives the same diagnostics', () => {
    for (const path of VALID.slice(0, 10)) expect(run(path, true).rest).toEqual(run(path, true).rest);
  });
});

describe('checker over the Locomotive conformance subset (tests/loco)', () => {
  const dir = fileURLToPath(new URL('../../../tests/loco/', import.meta.url));
  const files = readdirSync(dir)
    .filter((n) => n.endsWith('.bas'))
    .sort();
  // Programs that use a statement the compiler does not accept yet (E002): tests/loco/compare.json "compiled-skip" (R13: the one
  // list that tools/loco-diff.py and loco-conformance.test.ts read too; the task that adds the statement removes the entry).
  const pending = (JSON.parse(readFileSync(dir + 'compare.json', 'utf8')) as { 'compiled-skip'?: Record<string, string> })['compiled-skip'];
  const NOT_YET: ReadonlySet<string> = new Set(Object.keys(pending ?? {}).map((n) => `${n}.bas`));
  it.each(files)('%s checks clean', (name) => {
    if (NOT_YET.has(name)) return;
    const sources = new SourceSet();
    const front = new DiagnosticBag();
    const text = readFileSync(dir + name, 'utf8');
    const { program } = runFrontEnd({ files: new Map([[name, text]]), main: name }, sources, front);
    const diag = new DiagnosticBag();
    const bound = bind({
      program,
      sources,
      diagnostics: diag,
      bareMetal: false,
    });
    const checked = check({ bound, sources, diagnostics: diag });
    expect(front.all().map((d) => d.code)).toEqual([]);
    expect(
      diag
        .all()
        .filter((d) => d.severity === 'error')
        .map((d) => d.code),
    ).toEqual([]);
    expect(checked.ok).toBe(true);
  });
});
