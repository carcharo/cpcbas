#!/usr/bin/env node
// `npm run fuzz:opt [-- COUNT [SEED] [LEVELS]]`: the optimisation fuzzer (packages/cpcbas/test/opt-fuzz.shared.ts) with random
// seeds, for development. COUNT programs (default 500) from SEED (default: random, printed), at LEVELS (default 1,2,3,s).
// A failure is shrunk and printed with the seed that repeats it. Exit code: that of vitest.
import { spawnSync } from 'node:child_process';
import console from 'node:console';
import { join, dirname } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [count = '500', seed = String(1 + Math.floor(Math.random() * 1_000_000_000)), levels = ''] = process.argv.slice(2);
console.log(`fuzz:opt: ${count} programs from seed ${seed}${levels === '' ? '' : `, levels ${levels}`}`);
const env = { ...process.env, CPCBAS_FUZZ_COUNT: count, CPCBAS_FUZZ_SEED: seed, ...(levels === '' ? {} : { CPCBAS_OPT_LEVELS: levels }) };
const r = spawnSync('npx', ['vitest', 'run', 'packages/cpcbas/test/opt-fuzz-'], { cwd: root, env, stdio: 'inherit' });
process.exit(r.status ?? 1);
