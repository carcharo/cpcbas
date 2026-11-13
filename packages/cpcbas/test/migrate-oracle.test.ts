/**
 * The oracle test of `cpcbas migrate` (L6-MIGRATE). cpcbuild's Boriel BASIC (tests/migrate/oracle/boriel, the
 * sources at cpcbuild commit 9bc23fe) goes through the translator, and the output is compared line by line
 * with the translations cpcbas already has and has reviewed: lib/, tests/conformance/ and
 * tests/games/lamplighter/. Every run of lines that differs must be in tests/migrate/oracle/hand-edits.json
 * with a reason (the list is reviewed by R21); a stale entry, a missing entry or an entry with no reason fails.
 *
 * `MIGRATE_REGEN=1 npx vitest run packages/cpcbas/test/migrate-oracle.test.ts` rewrites hand-edits.json and
 * flag-counts.json from the current translator (keeping the reason of a hunk that is unchanged): read the diff.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run as cliRun, type CliIo } from '../bin/cli.js';
import { MIGRATE_CODES } from '../src/core/codes/migrate.js';
import { compile, formatDiagnostic, migrate } from '../src/index.js';
import { RENAMEABLE } from '../src/migrate/decls.js';
import {
  CATEGORIES,
  conformanceDefines,
  draftReason,
  groups,
  handEditsExist,
  lineDiff,
  loadBoriel,
  loadHandEdits,
  oracleDir,
  readReviewed,
  reviewedPath,
  runGroup,
  splitLines,
  type GroupRun,
  type HandEdits,
} from './migrate-oracle-lib.js';
import { libTree } from './runtime-tree.js';
import { repoRoot } from './z80sim/run.js';

const boriel = loadBoriel();
const allGroups = groups(boriel);
const runs: GroupRun[] = allGroups.map((g) => runGroup(g));
const regen = process.env.MIGRATE_REGEN === '1';

/** (Boriel key) -> the translator's output for it, from the group it is compared in. */
const outputs = new Map<string, string>();
for (const r of runs) for (const key of r.group.compared) outputs.set(key, r.output.get(key) as string);

const fileNote = (text: string): string => {
  const m = /^REM\s+((?:Ported|Changed|Changed with)[^\n]*(?:\nREM [^\n]*)?)/im.exec(text);
  return m ? (m[1] as string).replace(/\nREM\s*/g, ' ').slice(0, 200) : 'see the REM header of the reviewed file';
};

const flagCounts = (): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const r of runs) {
    const compared = new Set(r.group.compared);
    for (const f of r.report.files) if (compared.has(f.path)) for (const d of f.diagnostics) counts[d.code] = (counts[d.code] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1)));
};

if (regen) {
  describe('regenerate the hand-edit list', () => {
    it('writes hand-edits.json and flag-counts.json', () => {
      const old: HandEdits | undefined = handEditsExist() ? loadHandEdits() : undefined;
      const files: HandEdits['files'] = {};
      for (const key of [...boriel.keys()].sort()) {
        const rp = reviewedPath(key);
        const reviewed = readReviewed(key);
        const hunks = lineDiff(splitLines(outputs.get(key) as string), splitLines(reviewed));
        if (hunks.length === 0) continue;
        const note = fileNote(reviewed);
        files[rp] = hunks.map((h) => {
          const same = old?.files[rp]?.find((e) => e.tool.join('\n') === h.tool.join('\n') && e.reviewed.join('\n') === h.reviewed.join('\n'));
          return { at: h.at, tool: h.tool, reviewed: h.reviewed, reason: same?.reason ?? draftReason(h.tool, h.reviewed, note) };
        });
      }
      const doc: HandEdits = {
        version: 1,
        description:
          "Every run of lines where cpcbas's reviewed translation differs from what `cpcbas migrate` writes for cpcbuild's Boriel source (cpcbuild 9bc23fe). `tool` is the translator's output, `reviewed` the reviewed file, `at` the first line of the run in the translator's output. A reason starts with its category: " +
          `${CATEGORIES.join(', ')}.`,
        files,
      };
      writeFileSync(join(oracleDir, 'hand-edits.json'), `${JSON.stringify(doc, null, 1)}\n`);
      writeFileSync(join(oracleDir, 'flag-counts.json'), `${JSON.stringify(flagCounts(), null, 1)}\n`);
    });
  });
}

describe('the oracle set', () => {
  it('is cpcbuild at 9bc23fe: lib 17 files, the conformance programs and helpers 94, Lamplighter 21 and shot.bas', () => {
    const n = (p: string): number => [...boriel.keys()].filter((k) => k.startsWith(p)).length;
    expect(n('lib/')).toBe(17);
    expect(n('tests/conformance/')).toBe(94);
    expect(n('games/lamplighter/')).toBe(21);
    expect(boriel.has('tests/screens/lib/shot.bas')).toBe(true);
    expect(boriel.size).toBe(133);
  });

  it('every Boriel file has a reviewed translation', () => {
    for (const key of boriel.keys()) expect(() => readReviewed(key), key).not.toThrow();
  });

  it('every file is compared once', () => {
    expect([...outputs.keys()].sort()).toEqual([...boriel.keys()].sort());
  });
});

describe.skipIf(regen || !handEditsExist())('translator output against the reviewed translations', () => {
  const edits = handEditsExist() ? loadHandEdits() : { version: 1 as const, description: '', files: {} };
  const stats = { files: 0, lines: 0, identical: 0, hunks: 0, byCategory: {} as Record<string, number> };

  for (const key of [...boriel.keys()].sort()) {
    const rp = reviewedPath(key);
    it(`${rp}: every difference is a listed hand edit`, () => {
      const hunks = lineDiff(splitLines(outputs.get(key) as string), splitLines(readReviewed(key)));
      const listed = edits.files[rp] ?? [];
      expect(
        hunks.map((h) => ({ tool: h.tool, reviewed: h.reviewed })),
        `${rp}: the translator's output and the reviewed file differ somewhere that hand-edits.json does not list (or list differently)`,
      ).toEqual(listed.map((e) => ({ tool: e.tool, reviewed: e.reviewed })));
      for (const e of listed) {
        expect(e.reason, `${rp}:${e.at}: a hand edit needs a reason`).toMatch(/^[a-z-]+: .{12,}/);
        expect(CATEGORIES as readonly string[]).toContain(e.reason.slice(0, e.reason.indexOf(':')));
      }
      const reviewedLines = splitLines(readReviewed(key)).length;
      stats.files++;
      stats.lines += reviewedLines;
      stats.identical += reviewedLines - hunks.reduce((s, h) => s + h.reviewed.length, 0);
      stats.hunks += hunks.length;
      for (const e of listed) {
        const c = e.reason.slice(0, e.reason.indexOf(':'));
        stats.byCategory[c] = (stats.byCategory[c] ?? 0) + 1;
      }
    });
  }

  it('lists no file the oracle does not compare', () => {
    const known = new Set([...boriel.keys()].map(reviewedPath));
    expect(Object.keys(edits.files).filter((f) => !known.has(f))).toEqual([]);
  });

  it('summary', () => {
    // runs after the per-file tests: the figures of the task report
    console.log(`oracle: ${stats.files} files compared, ${stats.identical} of ${stats.lines} reviewed lines produced identically, ${stats.hunks} hand-edit hunks`, JSON.stringify(stats.byCategory));
    expect(stats.files).toBe(133);
  });
});

describe.skipIf(regen)('the flags raised on the Boriel oracle set', () => {
  it('counts per code are the recorded ones (flag-counts.json)', () => {
    const recorded = JSON.parse(readFileSync(join(oracleDir, 'flag-counts.json'), 'utf8')) as Record<string, number>;
    expect(flagCounts()).toEqual(recorded);
  });

  it('a program that carries no must-fix flag compiles: every compile error is explained by a W720-W724 flag', () => {
    for (const r of runs) {
      for (const f of r.report.files) {
        if (!r.group.compared.includes(f.path)) continue;
        const mustFix = f.diagnostics.some((d) => d.code >= 'W720' && d.code <= 'W724');
        const errors = f.diagnostics.filter((d) => d.code === 'W725');
        // E239: Boriel calls a FUNCTION as a statement, CPC BASIC does not (reported by W725, no rewrite: follow-up 226)
        const unexplained = errors.filter((d) => !d.message.startsWith('E239:'));
        if (!mustFix) expect(unexplained.map((d) => `${d.line}: ${d.message}`), `${f.path} compiles but for the flags`).toEqual([]);
      }
    }
  });
});

describe.skipIf(regen)('idempotence', () => {
  it('a second run over the output changes nothing, in every project of the oracle', () => {
    const changed: string[] = [];
    let checked = 0;
    for (const g of allGroups) {
      for (const from of ['auto', 'boriel'] as const) {
        const first = runGroup(g, from, false);
        const second = migrate(first.output, { from: 'auto', renames: g.renames });
        for (const [path, text] of first.output) {
          checked++;
          if (second.files.get(path) !== text) changed.push(`${from}: ${g.name}: ${path}`);
        }
      }
    }
    console.log(`idempotence: ${checked} file runs over ${allGroups.length} projects, ${changed.length} changed by a second run`);
    expect(changed).toEqual([]);
  });
});

describe.skipIf(regen)('the auto reading (follow-up 225)', () => {
  it('each project\'s auto output equals its boriel output, or the difference is a W727 finding', () => {
    const differ: string[] = [];
    const unexplained: string[] = [];
    let checked = 0;
    for (const g of allGroups) {
      const auto = runGroup(g, 'auto', false);
      const boriel = runGroup(g, 'boriel', false);
      for (const [path, text] of boriel.output) {
        checked++;
        if (auto.output.get(path) === text) continue;
        differ.push(`${g.name}: ${path}`);
        const w727 = auto.report.files.find((f) => f.path === path)?.diagnostics.some((d) => d.code === 'W727') ?? false;
        if (!w727) unexplained.push(`${g.name}: ${path}`);
      }
    }
    console.log(`auto reading: ${checked} file runs over ${allGroups.length} projects, ${differ.length} differ from the boriel output, all with a W727 finding`);
    expect(unexplained).toEqual([]);
  });

  it('a second auto run over a project with a must-fix flag still open adds nothing', () => {
    const open = allGroups.filter((g) => runGroup(g, 'boriel', false).report.files.some((f) => f.diagnostics.some((d) => d.code >= 'W720' && d.code <= 'W724')));
    expect(open.length).toBeGreaterThan(0);
    for (const g of open) {
      const first = runGroup(g, 'boriel', false);
      const second = migrate(first.output, { from: 'auto', renames: g.renames });
      expect([...first.output].filter(([path, text]) => second.files.get(path) !== text).map(([path]) => path)).toEqual([]);
    }
  });
});

describe.skipIf(regen)('docs/migrate.md is the rule list', () => {
  const doc = readFileSync(join(repoRoot, 'docs/migrate.md'), 'utf8');
  it('names every code of the table', () => {
    for (const code of Object.keys(MIGRATE_CODES)) expect(doc, code).toContain(`| ${code} |`);
  });
  it('lists the words that are reserved now: the keyword table minus the Boriel keywords', () => {
    const m = /Today it is:\n\n`([^`]+)`/.exec(doc);
    const listed = (m?.[1] ?? '').split(/\s+/).filter(Boolean).sort();
    expect(listed).toEqual([...RENAMEABLE, 'REM'].sort());
    expect(doc).toContain(`(${listed.length} words;`);
  });
});

describe.skipIf(regen)('odd input', () => {
  it('never throws: the oracle files cut, shuffled and with characters dropped', () => {
    let seed = 12345;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const keys = [...boriel.keys()].filter((_, i) => i % 3 === 0);
    for (const key of keys) {
      const text = boriel.get(key) as string;
      const lines = text.split('\n').slice(0, 400);
      for (let round = 0; round < 6; round++) {
        let mutated = lines.slice(rnd(lines.length)).join('\n');
        for (let k = 0; k < 20; k++) {
          const at = rnd(mutated.length + 1);
          mutated = mutated.slice(0, at) + mutated.slice(at + 1 + rnd(3));
        }
        if (round % 2 === 1) mutated = mutated.split('\n').reverse().join('\n');
        const r1 = migrate(new Map([['x.bas', mutated]]), { from: 'boriel' });
        const r2 = migrate(new Map([['x.bas', mutated]]), { from: 'boriel' });
        expect(r1.files.get('x.bas')).toBe(r2.files.get('x.bas'));
      }
    }
  });
});

describe.skipIf(regen)('the reviewed translations', () => {
  it('compile (--parse-only) with no error: Lamplighter and every conformance program', () => {
    const problems: string[] = [];
    const readDir = (dir: string): Map<string, string> => {
      const out = new Map<string, string>();
      const walk = (rel: string): void => {
        for (const e of readdirSync(join(repoRoot, rel), { withFileTypes: true })) {
          const p = `${rel}/${e.name}`;
          if (e.isDirectory()) walk(p);
          else if (e.name.endsWith('.bas')) out.set(p, readFileSync(join(repoRoot, p), 'latin1'));
        }
      };
      walk(dir);
      return out;
    };
    const check = (main: string, files: Map<string, string>, defines: Record<string, string>): void => {
      const r = compile({ files, main, defines, runtime: libTree(), options: { parseOnly: true } });
      for (const d of r.diagnostics) if (d.severity === 'error') problems.push(formatDiagnostic(d, r.sources));
    };
    const conf = readDir('tests/conformance');
    for (const [k, text] of conf) if (/^tests\/conformance\/[^/]+\.bas$/.test(k)) check(k, conf, conformanceDefines(text));
    const lamp = readDir('tests/games/lamplighter');
    for (const main of ['tests/games/lamplighter/main.bas', 'tests/games/lamplighter/tests/logic.bas', 'tests/games/lamplighter/tests/playthrough.bas']) check(main, lamp, { CPC464: '' });
    expect(problems).toEqual([]);
  });

  const checkRun = async (args: string[]): Promise<{ code: number; text: string }> => {
    const out: string[] = [];
    const io: CliIo = {
      readFile: (p) => {
        try {
          return readFileSync(join(repoRoot, p));
        } catch {
          return undefined;
        }
      },
      writeFile: () => {
        throw new Error('--check writes nothing');
      },
      stdout: (t) => void out.push(t),
      stderr: (t) => void out.push(t),
      cwd: repoRoot,
      defaultRuntime: 'lib',
    };
    const code = await cliRun(['migrate', '--check', ...args], io);
    return { code, text: out.join('') };
  };

  it('`cpcbas migrate --check` finds nothing to change and nothing to fix (the library and Lamplighter, compile check on)', async () => {
    const r = await checkRun(['lib', 'tests/games/lamplighter']);
    expect(r.text).toMatch(/41 files read, 0 changed; read as CPC BASIC/);
    expect(r.code).toBe(0);
  });

  it('... and the conformance programs (each builds with its own defines, so the compile check is off)', async () => {
    const r = await checkRun(['--no-compile', 'lib', 'tests/conformance', 'tests/games/lamplighter']);
    expect(r.text).toMatch(/143 files read, 0 changed; read as CPC BASIC/);
    expect(r.code).toBe(0);
  });

  it('with the compile check on, the one conformance helper that builds for bare metal only reports it (E127)', async () => {
    const r = await checkRun(['tests/conformance']);
    expect(r.text.match(/W725/g)?.length).toBeGreaterThanOrEqual(1);
    expect(r.text).toContain('E127');
    expect(r.code).toBe(1);
  });
});
