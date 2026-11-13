#!/usr/bin/env node
// Development tool for tests/e2e: assemble a compiler-output .asm with cpcbas's own
// assembler and pack it with its own AMSDOS/DSK writer. Drives the assembler the way
// packages/cpcbas/test/asm-golden.test.ts does (resolver over lib/runtime, initMode
// 'zxbasm', flatten, formatMap).
//
//   node tools/e2e-assemble.mjs --asm hello.asm --bin hello.bin --dsk hello.dsk
//        [--map hello.map] [--name HELLO.BIN] [--runtime lib/runtime]
//
// Needs `npm run build` first (it imports packages/cpcbas/dist). Prints one JSON line
// {org, entry, length, name} on success; diagnostics go to stderr and the exit code is 1.
/* global console, process */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: opt } = parseArgs({
  options: {
    asm: { type: 'string' },
    bin: { type: 'string' },
    dsk: { type: 'string' },
    map: { type: 'string' },
    name: { type: 'string', default: 'HELLO.BIN' },
    runtime: { type: 'string', default: join(repo, 'lib/runtime') },
  },
});
for (const k of ['asm', 'bin', 'dsk']) {
  if (!opt[k]) {
    console.error(`e2e-assemble: missing --${k}`);
    process.exit(2);
  }
}

const dist = join(repo, 'packages/cpcbas/dist/src');
const { assemble, flatten, formatMap } = await import(join(dist, 'asm/index.js'));
const { buildDsk } = await import(join(dist, 'pack/index.js'));
const { SourceSet, formatDiagnostic, normalizePath, dirname: vdirname, joinPath } = await import(
  join(dist, 'core/source.js')
).then(async (m) => ({ ...m, formatDiagnostic: (await import(join(dist, 'core/diagnostics.js'))).formatDiagnostic }));

const runtimeDir = resolve(opt.runtime);
function walk(dir, prefix = '') {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (statSync(join(dir, name)).isDirectory()) out.push(...walk(join(dir, name), `${prefix}${name}/`));
    else out.push(`${prefix}${name}`);
  }
  return out;
}
const known = new Set(walk(runtimeDir));
const resolveInclude = (name, fromPath, angle) => {
  const candidates = [];
  if (!angle && fromPath.startsWith('lib/runtime/')) {
    candidates.push(joinPath(vdirname(fromPath).slice('lib/runtime'.length + 1), name));
  }
  candidates.push(normalizePath(name));
  for (const rel of candidates) {
    if (known.has(rel)) return { path: `lib/runtime/${rel}`, text: readFileSync(join(runtimeDir, rel), 'latin1') };
  }
  return undefined;
};

const sources = new SourceSet();
const entry = sources.add(opt.asm, readFileSync(opt.asm, 'latin1'), 'generated');
const result = assemble({ sources, entry, resolveInclude, options: { initMode: 'zxbasm' } });
const problems = result.diagnostics.filter((d) => d.severity !== 'note');
for (const d of problems) console.error(formatDiagnostic(d, sources));
if (!result.ok || problems.some((d) => d.severity === 'error')) process.exit(1);

const image = flatten(result.segments);
// Load and entry at the org: the program starts at .core.__START_PROGRAM (the first label).
const start = result.symbols.get('.core.__START_PROGRAM');
const org = start ? start.value : image.org;
if (org !== image.org) {
  console.error(`e2e-assemble: .core.__START_PROGRAM is at ${org}, but the image starts at ${image.org}`);
  process.exit(1);
}
writeFileSync(opt.bin, image.bytes);
if (opt.map) writeFileSync(opt.map, formatMap(result), 'latin1');
const dsk = buildDsk([
  { name: opt.name, data: image.bytes, loadAddress: org, entryAddress: org, fileType: 2 },
]);
if (!dsk.ok) {
  console.error(`e2e-assemble: ${dsk.error.code} ${dsk.error.message}`);
  process.exit(1);
}
writeFileSync(opt.dsk, dsk.value);
console.log(JSON.stringify({ org, entry: org, length: image.bytes.length, name: opt.name }));
