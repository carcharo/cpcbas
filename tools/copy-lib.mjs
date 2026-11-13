#!/usr/bin/env node
// Part of `npm run build` in packages/cpcbas: copies the runtime library (the repo's lib/) to dist/lib,
// so the package, the bundle and the SDK carry the text the compiler links. Replaces the target whole.
//   node tools/copy-lib.mjs [TARGET]      (default packages/cpcbas/dist/lib)
/* global console, process */
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function copyLib(to = join(repo, 'packages', 'cpcbas', 'dist', 'lib')) {
  const from = join(repo, 'lib');
  if (!existsSync(join(from, 'runtime'))) throw new Error(`copy-lib: ${from} has no runtime/ folder`);
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    copyLib(process.argv[2] === undefined ? undefined : resolve(process.argv[2]));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
