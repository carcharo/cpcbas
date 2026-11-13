#!/usr/bin/env node
// Development tool for tools/loco-diff.py: assemble tools/loco-harness/echo.asm with cpcbas's own
// assembler and write the harness disc: RUN.BAS (the loader), ECHO.BIN (the printer hook) and T.BAS
// (the program under test, an ASCII file). Needs `npm run build` (imports packages/cpcbas/dist).
//
//   node tools/loco-harness/build.mjs --bas prog.bas --dsk out.dsk [--bin echo.bin] [--name T.BAS] [--unfiltered] [--run-as T]
//                                     [--shot] [--file NAME=PATH]...
//
// --shot builds the hook for screenshot runs (echo.asm, SHOT: the interpreter's "Ready" is held back and the run stops there).
// --file NAME=PATH (repeatable) puts PATH on the disc as the AMSDOS file NAME (no header), for REM LOCO-DISK.
//
// Prints one JSON line {org, length, install} on success; diagnostics go to stderr, exit code 1.
/* global console, process */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { values: opt } = parseArgs({
  options: {
    bas: { type: 'string' },
    dsk: { type: 'string' },
    bin: { type: 'string' },
    name: { type: 'string', default: 'T.BAS' },
    'run-as': { type: 'string' },
    unfiltered: { type: 'boolean', default: false },
    shot: { type: 'boolean', default: false },
    file: { type: 'string', multiple: true, default: [] },
  },
});
for (const k of ['bas', 'dsk']) {
  if (!opt[k]) {
    console.error(`loco-harness/build: missing --${k}`);
    process.exit(2);
  }
}

const dist = join(repo, 'packages/cpcbas/dist/src');
const { assemble, flatten } = await import(join(dist, 'asm/index.js'));
const { buildDsk } = await import(join(dist, 'pack/index.js'));
const { SourceSet } = await import(join(dist, 'core/source.js'));
const { formatDiagnostic } = await import(join(dist, 'core/diagnostics.js'));

const asmPath = join(repo, 'tools/loco-harness/echo.asm');
const sources = new SourceSet();
const entry = sources.add('tools/loco-harness/echo.asm', (opt.unfiltered ? '#define UNFILTERED\n' : '') + (opt.shot ? '#define SHOT\n' : '') + readFileSync(asmPath, 'latin1'), 'generated');
const result = assemble({ sources, entry, resolveInclude: () => undefined, options: { initMode: 'zxbasm' } });
const problems = result.diagnostics.filter((d) => d.severity !== 'note');
for (const d of problems) console.error(formatDiagnostic(d, sources));
if (!result.ok || problems.some((d) => d.severity === 'error')) process.exit(1);
const image = flatten(result.segments);
if (opt.bin) writeFileSync(opt.bin, image.bytes);

// The ASCII files, as AMSDOS keeps them: CR LF line ends and a Ctrl-Z at the end. The loader keeps
// HIMEM below the hook; the interpreter then runs the program from the same disc.
const ascii = (text) => {
  const lines = text.replace(/\r\n?|\n/g, '\n').replace(/\n+$/, '').split('\n');
  return Uint8Array.from(lines.join('\r\n') + '\r\n\x1a', (c) => c.charCodeAt(0));
};
const loader = [
  `10 MEMORY &${(image.org - 1).toString(16).toUpperCase()}`,
  `20 LOAD "ECHO.BIN",&${image.org.toString(16).toUpperCase()}`,
  `30 CALL &${image.org.toString(16).toUpperCase()}`,
  `40 RUN "${opt['run-as'] ?? opt.name}"`,
].join('\n');
const extra = opt.file.map((spec) => {
  const eq = spec.indexOf('=');
  if (eq <= 0 || eq === spec.length - 1) {
    console.error(`loco-harness/build: --file ${spec}: not NAME=PATH`);
    process.exit(2);
  }
  return { name: spec.slice(0, eq), data: new Uint8Array(readFileSync(spec.slice(eq + 1))), header: 'none' };
});
const dsk = buildDsk([
  { name: 'RUN.BAS', data: ascii(loader), header: 'none' },
  { name: 'ECHO.BIN', data: image.bytes, loadAddress: image.org, entryAddress: image.org, fileType: 2 },
  { name: opt.name, data: ascii(readFileSync(opt.bas, 'latin1')), header: 'none' },
  ...extra,
]);
if (!dsk.ok) {
  console.error(`loco-harness/build: ${dsk.error.code} ${dsk.error.message}`);
  process.exit(1);
}
writeFileSync(opt.dsk, dsk.value);
console.log(JSON.stringify({ org: image.org, length: image.bytes.length, install: image.org }));
