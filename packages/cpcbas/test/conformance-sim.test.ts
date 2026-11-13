/**
 * L3-CONF, the fast in-process version of `tools/conformance.py`: every program under
 * tests/conformance/ that the simulator's fake firmware can run is compiled with compile() (the
 * library pipeline the CLI uses, `-D __CPC_PRINTER_ECHO__ -D CPC6128`, firmware mode), run on the
 * test-only Z80, and must satisfy the runner's rule: it reached the END (RST 0), printed DONE
 * on a line of its own, and printed no FAIL line. The emulator version is
 * `python3 tools/conformance.py --emu chips` (tests/conformance/README.md).
 *
 * The headers are read from the program as the runner reads them. `REM XFAIL: <reason>` programs
 * (waiting for a task that is not merged) are asserted NOT to pass (it.fails), so the line has to
 * be removed when the task merges, as in the runner (XPASS fails the run). `REM BARE: only` and
 * `REM EMUS:` programs (a disc, bare metal) and programs that type keys need an emulator and are
 * left to it; programs whose DISKFILE needs a disc likewise.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile, formatDiagnostic } from '../src/index.js';
import { libTree } from './runtime-tree.js';
import { repoRoot, runImage } from './z80sim/run.js';

const dir = join(repoRoot, 'tests/conformance');

interface Headers {
  xfail: string | null;
  skip: string | null;
  models: string[];
}

/** The header lines the sim cares about (tools/conformance.py parse_headers is the full reader). */
function headers(text: string): Headers {
  const h: Headers = { xfail: null, skip: null, models: [] };
  for (const line of text.split(/\r?\n/)) {
    let m: RegExpMatchArray | null;
    if ((m = /^\s*REM\s+XFAIL:\s*(.*)$/i.exec(line)) && h.xfail === null) h.xfail = m[1]!.trim() || 'expected failure';
    else if ((m = /^\s*REM\s+MODELS:\s*(.*?)\s*$/i.exec(line))) h.models.push(...m[1]!.toLowerCase().split(/\s+/).filter(Boolean));
    else if ((m = /^\s*REM\s+SIM:\s*skip\s*(.*)$/i.exec(line))) h.skip ??= m[1]!.trim() || 'not on the simulator';
    else if ((m = /^\s*REM\s+BARE:\s*(\w+)/i.exec(line)) && m[1]!.toLowerCase() === 'only') h.skip = 'bare metal only';
    else if (/^\s*REM\s+(EMUS|TYPE|DISKFILE):/i.test(line)) h.skip ??= 'needs an emulator (disc or typed keys)';
  }
  if (h.skip === null && h.models.length > 0 && !h.models.includes('6128')) h.skip = `MODELS: ${h.models.join(' ')}`;
  return h;
}

/** All .bas files of tests/conformance, keyed by their path relative to it (for #include "lib/chk.bas"). */
function sources(): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (sub: string): void => {
    for (const entry of readdirSync(join(dir, sub), { withFileTypes: true })) {
      const rel = sub === '' ? entry.name : `${sub}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith('.bas')) files.set(rel, readFileSync(join(dir, rel), 'latin1'));
    }
  };
  walk('');
  return files;
}

interface Outcome {
  diagnostics: string[];
  printer: string;
  stopped: string;
}

function build(name: string, files: Map<string, string>): Outcome {
  const r = compile({
    files,
    main: name,
    defines: { __CPC_PRINTER_ECHO__: '', CPC6128: '' },
    runtime: libTree(),
    options: { format: 'bin' },
  });
  const diagnostics = r.diagnostics.filter((d) => d.severity === 'error').map((d) => formatDiagnostic(d, r.sources));
  if (!r.ok || !r.binary) return { diagnostics, printer: '', stopped: 'not built' };
  const run = runImage(r.binary, r.org as number, r.entry as number, { maxTStates: 400_000_000 });
  // byte 12 (the 464's CLS echo) never matters to the protocol
  return { diagnostics, printer: run.printer.replaceAll('\x0c', ''), stopped: run.stopped };
}

/** The runner's pass rule (tools/conformance.py Result.ok). */
function passes(o: Outcome): boolean {
  return o.diagnostics.length === 0 && o.stopped === 'rst0' && ('\n' + o.printer).includes('\nDONE') && !/^FAIL/m.test(o.printer);
}

describe('tests/conformance on the simulator (compile() + Z80 sim, firmware mode, 6128)', () => {
  const files = sources();
  const programs = [...files.keys()].filter((k) => !k.includes('/')).sort();
  for (const name of programs) {
    const h = headers(files.get(name)!);
    if (h.skip !== null) {
      it.skip(`${name} (${h.skip})`, () => undefined);
      continue;
    }
    const test = h.xfail !== null ? it.fails : it;
    test(`${name} prints no FAIL and ends with DONE${h.xfail !== null ? ` (waiting: ${h.xfail}; remove the REM XFAIL line when it passes)` : ''}`, () => {
      const o = build(name, files);
      expect(o.diagnostics).toEqual([]);
      expect(o.stopped).toBe('rst0');
      expect(o.printer, `${name}: transcript\n${o.printer}`).toMatch(/(^|\n)DONE(\n|$)/);
      expect(o.printer.split('\n').filter((l) => l.startsWith('FAIL'))).toEqual([]);
      expect(passes(o)).toBe(true);
    });
  }

  it('finds the 12 language programs of the milestone', () => {
    const names = new Set(programs.map((p) => p.replace(/\.bas$/, '')));
    for (const want of ['arithint', 'arrays', 'controlflow', 'dataread', 'fixedpoint', 'floats', 'heap', 'strings', 'subsfuncs', 'swap32', 'lowram', 'bareframes']) {
      expect(names.has(want), want).toBe(true);
    }
  });
});
