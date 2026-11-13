#!/usr/bin/env node
// TEST-ONLY. The deliberately wrong "optimiser pass" of tools/opt-diff.py --inject-bug: it takes the asm text that the CLI wrote
// with --asm, deletes the first `ld (_x), hl` (a store of HL to a user variable), assembles the result the way the compiler's
// pipeline does, and writes the program as the CLI would have (.bin with an AMSDOS header, or a .dsk). It exists to show that the
// differential (opt-diff.py) fails when an optimised build is wrong. Nothing in the compiler, and no other tool, uses it.
//
//   node tools/opt-diff-bug.mjs --asm in.asm --out out.bin|out.dsk [--name PROG.BIN] [--org N] [-D NAME[=V] ...] [--lib lib]
//
// The asm defines must be the CLI's -D list (and --org), as they were for the build that wrote in.asm.
// Needs `npm run build` first (it imports packages/cpcbas/dist).
/* global console, process */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(repo, 'packages/cpcbas/dist/src');
const { values: opt } = parseArgs({
  options: {
    asm: { type: 'string' },
    out: { type: 'string' },
    name: { type: 'string', default: 'PROG.BIN' },
    org: { type: 'string' },
    lib: { type: 'string', default: join(repo, 'lib') },
    D: { type: 'string', short: 'D', multiple: true, default: [] },
  },
});
if (!opt.asm || !opt.out) {
  console.error('usage: opt-diff-bug.mjs --asm in.asm --out out.bin|out.dsk [--name PROG.BIN] [--org N] [-D X ...]');
  process.exit(2);
}
const { assemble, flatten } = await import(join(dist, 'asm/index.js'));
const { makeTarget } = await import(join(dist, 'codegen/index.js'));
const { buildAmsdosHeader, buildDsk } = await import(join(dist, 'pack/index.js'));
const { SourceSet, joinPath, dirname: vdirname, normalizePath } = await import(join(dist, 'core/source.js'));
const { formatDiagnostic } = await import(join(dist, 'core/diagnostics.js'));

// the wrong pass
const lines = readFileSync(opt.asm, 'latin1').split('\n');
const at = lines.findIndex((l) => /^\s*ld \(_[A-Za-z_]\w*\), hl\s*$/.test(l));
if (at < 0) {
  console.error('opt-diff-bug: no `ld (_x), hl` in the asm: nothing to delete');
  process.exit(3);
}
lines.splice(at, 1);
const text = lines.join('\n');

// the include resolver of the link step: `runtime/<name>`, then `<name>`, under lib/
const files = new Map();
const walk = (dir, prefix) => {
  for (const n of readdirSync(dir).sort()) {
    const full = join(dir, n);
    if (statSync(full).isDirectory()) walk(full, `${prefix}${n}/`);
    else if (/\.asm$/.test(n)) files.set(`${prefix}${n}`, readFileSync(full, 'latin1'));
  }
};
walk(resolve(opt.lib), '');
const resolveInclude = (name, fromPath, angle) => {
  const candidates = [];
  if (!angle) candidates.push(joinPath(vdirname(fromPath), name));
  candidates.push(joinPath('runtime', name), normalizePath(name));
  for (const path of candidates) if (files.has(path)) return { path, text: files.get(path) };
  return undefined;
};

const defines = {};
for (const d of opt.D) {
  const i = d.indexOf('=');
  defines[i < 0 ? d : d.slice(0, i)] = i < 0 ? '' : d.slice(i + 1);
}
const target = makeTarget({
  ...(opt.org !== undefined ? { org: Number(opt.org) } : {}),
  defines,
  fileBuffers: { input: text.includes('loco/file.asm'), output: text.includes('loco/fileout.asm') },
});
const sources = new SourceSet();
const entry = sources.add('program.asm', text, 'generated');
const result = assemble({ sources, entry, resolveInclude, options: { initMode: 'collect', defines: target.asmDefines } });
const problems = result.diagnostics.filter((d) => d.severity !== 'note');
for (const d of problems) console.error(formatDiagnostic(d, sources));
if (!result.ok || problems.some((d) => d.severity === 'error')) process.exit(1);
const image = flatten(result.segments);
const start = result.symbols.get('.core.__START_PROGRAM');
const entryAddr = result.entry ?? start?.value ?? image.org;

if (opt.out.endsWith('.dsk')) {
  const dsk = buildDsk([{ name: opt.name, data: image.bytes, loadAddress: image.org, entryAddress: entryAddr, fileType: 2 }]);
  if (!dsk.ok) {
    console.error(`opt-diff-bug: ${dsk.error.code} ${dsk.error.message}`);
    process.exit(1);
  }
  writeFileSync(opt.out, dsk.value);
} else {
  const header = buildAmsdosHeader({ name: opt.name, length: image.bytes.length, loadAddress: image.org, entryAddress: entryAddr });
  if (!header.ok) {
    console.error(`opt-diff-bug: ${header.error.code} ${header.error.message}`);
    process.exit(1);
  }
  const all = new Uint8Array(header.value.length + image.bytes.length);
  all.set(header.value, 0);
  all.set(image.bytes, header.value.length);
  writeFileSync(opt.out, all);
}
console.log(JSON.stringify({ deletedLine: at + 1, org: image.org, length: image.bytes.length }));
