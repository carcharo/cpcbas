/**
 * L2-CONF, the fast in-process conformance: every program in tests/loco/blessed.json goes
 * through compile() (the library pipeline the CLI uses), the image runs on the test-only Z80
 * simulator with the printer echo on, and the printer capture, normalised as
 * tools/loco-diff.py does, equals the blessed transcript of the Locomotive interpreter.
 * The emulator version of the same check is `tools/loco-diff.py --all` (tests/loco/README.md).
 *
 * A program blessed for one model only (int-compare-rev, 6128) is compared with that
 * transcript: the compiled build is the same on both models.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile, formatDiagnostic } from '../src/index.js';
import { normalise, transcriptsMatch } from './compile-helper.js';
import { libTree } from './runtime-tree.js';
import { discOf } from './opt-programs.js';
import { repoRoot, runImage } from './z80sim/run.js';

const loco = join(repoRoot, 'tests/loco');
const blessed = JSON.parse(readFileSync(join(loco, 'blessed.json'), 'utf8')) as Record<string, { program: string; files: Record<string, string> }>;
/** Programs compared with the real rule (tools/loco-diff.py `transcripts_match`): numbers to 8 significant digits. */
const rules = JSON.parse(readFileSync(join(loco, 'compare.json'), 'utf8')) as { real?: string[]; 'real-exact'?: string[] };
const realValued = new Set(rules.real ?? []);
/**
 * "real-exact" programs (FWM-CORE): byte for byte on the machine (tools/loco-diff.py --all). The fake firmware's maths are
 * exact for + - * / and for every recorded input, and approximated otherwise (`cpc.approximations`): a run with no
 * approximation must match exactly; a run with some is compared with the five-byte dumps removed, numbers to 8 digits.
 */
const exactReal = new Set(rules['real-exact'] ?? []);
const withoutBytes = (t: string): string => t.replace(/ ?:[0-9A-F]{10}/g, '');

/**
 * Programs that need something not merged yet, by name, with the reason. A skip names the task;
 * remove the entry when that task merges (the test then runs and must pass).
 */
const SKIPS: Readonly<Record<string, string>> = {
  // PEEKs the text screen's pixels; the simulator fakes the firmware and draws nothing.
  // Run on the emulators: tools/loco-diff.py --all, and tools/e2e-bare.py for bare mode.
  'bare-text': 'reads screen memory; emulator only',
  // The fake firmware answers SIN, COS, TAN, LOG10 and the rest with JS Math for any input it did not record, and the real
  // functions are not that accurate (SIN/COS/TAN miss by up to 5e-4 at large arguments): not 8 digits. Emulator only.
  'real-fn': 'the fake firmware approximates the functions; emulator only (tools/loco-diff.py --all, byte for byte)',
  // L5-SIMFW: the fake CPC now has a ticker (timer, err-event), an AMSDOS (files*, files-cross's disc file) and the ink and flash
  // state (ink), and those programs print the blessed transcript. The entries below are only recorded (the simulator differential tests
  // compare them across levels).
  // L4-GFX: the fake firmware draws nothing and does not keep a graphics state; these read it back (TEST, XPOS).
  'gfx-plot': 'reads the screen through TEST; emulator only (tools/loco-diff.py --all, with --shot; --bare)',
  'gfx-origin': 'reads the screen through TEST; emulator only (tools/loco-diff.py --all, with --shot)',
  'gfx-ink': 'reads the screen through TEST; emulator only (tools/loco-diff.py --all)',
  // L4-TEXT: the fake firmware has one text window and no user matrix table; test/text-run.test.ts runs these entries against
  // handlers that record the register contract, and the emulators compare the programs (tools/loco-diff.py --all).
  'text-window': 'streams and windows: the fake firmware has one window; emulator only',
  'text-printer': 'the streams select through TXT STR SELECT, which the fake firmware does not have; emulator only',
  'text-symbol': 'SYMBOL needs the matrix table entries; emulator only (the glyphs are compared as a screen shot)',
  'text-copychr': 'COPYCHR$ reads the screen; emulator only',
  'text-using11': 'prints the pound sign, byte 163: the real printer port drops bit 7, the fake one does not; emulator only',
  // A program the compiler rejects on purpose until a task merges: tests/loco/compare.json "compiled-skip" (R13: one list,
  // read by tools/loco-diff.py, this file and check-corpus.test.ts; the task removes its entry there).
  // The typed keys are translated by the firmware's key tables (KEY DEF changes them); the fake keyboard has none.
  'keys-def': 'needs the real key translation; emulator only (tools/loco-diff.py --all on Caprice32)',
  ...((JSON.parse(readFileSync(join(loco, 'compare.json'), 'utf8')) as { 'compiled-skip'?: Record<string, string> })['compiled-skip'] ?? {}),
};

/**
 * Known differences from the interpreter that are tracked, not hidden: the test asserts the
 * program still fails to match (it.fails), so the entry has to be removed when it is fixed.
 */
const KNOWN_FAILURES: Readonly<Record<string, string>> = {};

function expectedFor(name: string): string {
  const files = blessed[name]?.files ?? {};
  const file = files['all'] ?? files['6128'] ?? Object.values(files)[0];
  if (!file || !existsSync(join(loco, file))) throw new Error(`${name}: no blessed transcript`);
  return readFileSync(join(loco, file), 'latin1');
}

function runCompiled(name: string): { diagnostics: string[]; transcript: string | null; stopped: string; approximations: number } {
  const text = readFileSync(join(loco, blessed[name]!.program), 'latin1');
  const r = compile({
    files: new Map([['t.bas', text]]),
    main: 't.bas',
    defines: { __CPC_PRINTER_ECHO__: '' },
    runtime: libTree(),
    options: { format: 'bin' },
  });
  const diagnostics = r.diagnostics.filter((d) => d.severity === 'error').map((d) => formatDiagnostic(d, r.sources));
  if (!r.ok || !r.binary) return { diagnostics, transcript: null, stopped: 'not built', approximations: 0 };
  // REM LOCO-TYPE: the entries are typed ahead, each followed by RETURN (L4-KEYS); INPUT's cursor and JOY are faked
  const typedKeys = /^\d+ REM LOCO-TYPE: ?(.*)$/m.exec(text)?.[1]?.replace(/\r$/, '').split('|').map((e) => `${e}\r`).join('');
  const run = runImage(r.binary, r.org as number, r.entry as number, {
    maxTStates: 400_000_000,
    ...(typedKeys !== undefined ? { keys: typedKeys } : {}),
    setup: (cpc) => Object.entries(discOf(text, loco).disc ?? {}).forEach(([n, d]) => cpc.disc.put(n, d)),
  });
  return { diagnostics, transcript: normalise(run.printer), stopped: run.stopped, approximations: run.cpc.approximations.length };
}

describe('tests/loco conformance on the simulator (compile() + Z80 sim)', () => {
  for (const name of Object.keys(blessed).sort()) {
    const skip = SKIPS[name];
    const known = KNOWN_FAILURES[name];
    const test = skip ? it.skip : known ? it.fails : it;
    test(`${name} prints the blessed transcript${skip ? ` (skipped: ${skip})` : known ? ` (known difference: ${known})` : ''}`, () => {
      const r = runCompiled(name);
      expect(r.diagnostics).toEqual([]);
      expect(r.stopped).toBe('rst0');
      if (realValued.has(name)) {
        const want = expectedFor(name);
        expect(transcriptsMatch(want, r.transcript ?? '', 'real'), `${name}: got\n${r.transcript}\nexpected\n${want}`).toBe(true);
      } else if (exactReal.has(name) && r.approximations > 0) {
        const want = withoutBytes(expectedFor(name));
        expect(transcriptsMatch(want, withoutBytes(r.transcript ?? ''), 'real'), `${name}: got\n${r.transcript}\nexpected\n${want}`).toBe(true);
      } else expect(r.transcript).toBe(expectedFor(name));
    });
  }
});
