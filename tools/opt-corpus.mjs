#!/usr/bin/env node
// Rewrites packages/cpcbas/test/opt-corpus.json: the programs that the `*-run.test.ts` files run through runSource
// (test/compile-helper.ts), recorded by running the whole suite with CPCBAS_OPT_RECORD, sorted and without duplicates.
// Development only. Run it after adding or changing a run test: `npm run opt:corpus`.
import { spawnSync } from 'node:child_process';
import console from 'node:console';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const log = join(mkdtempSync(join(tmpdir(), 'opt-corpus-')), 'corpus.jsonl');
writeFileSync(log, '');
const r = spawnSync('npx', ['vitest', 'run'], { cwd: root, env: { ...process.env, CPCBAS_OPT_RECORD: log }, stdio: 'inherit' });
if (r.status !== 0) {
  console.error('the test run failed; the corpus is not rewritten');
  process.exit(r.status ?? 1);
}
const seen = new Map();
for (const line of readFileSync(log, 'utf8').split('\n')) {
  if (line === '') continue;
  seen.set(line, JSON.parse(line));
}
const entries = [...seen.values()].sort((a, b) => (a.src < b.src ? -1 : a.src > b.src ? 1 : (a.keys ?? '') < (b.keys ?? '') ? -1 : 1));
writeFileSync(join(root, 'packages/cpcbas/test/opt-corpus.json'), `${JSON.stringify(entries, null, 1)}\n`);
console.log(`${entries.length} programs written to packages/cpcbas/test/opt-corpus.json`);
