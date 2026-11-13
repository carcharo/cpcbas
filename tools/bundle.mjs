#!/usr/bin/env node
// `npm run bundle` in packages/cpcbas: the whole CLI as one file, dist/cpcbas.mjs (Node 22, no dependencies).
// The SDK ships it next to lib/ (`node cpcbas.mjs --runtime lib ...`, or just `node cpcbas.mjs`).
// Also exports the two esbuild configurations so the tests build the same things into a temporary directory.
/* global console, process */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = join(repo, 'packages', 'cpcbas');

/** The CLI bundle: bin/cpcbas.ts and everything it imports, as one ES module for Node 22. */
export async function bundleCli(outfile) {
  return build({
    entryPoints: [join(pkg, 'bin', 'cpcbas.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    legalComments: 'none',
    logLevel: 'warning',
    metafile: true,
  });
}

/**
 * The browser entry: the library alone (src/index.ts), minified, for a browser. It fails to build if the library
 * (or anything it imports) reaches a `node:` module, which is how the "no Node helpers in the browser entry" rule is checked.
 */
export async function bundleBrowser() {
  return build({
    entryPoints: [join(pkg, 'src', 'index.ts')],
    write: false,
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
    logLevel: 'silent',
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const out = join(pkg, 'dist', 'cpcbas.mjs');
  await bundleCli(out);
  console.log(`bundle: ${out}`);
}
